import { NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { Octokit } from '@octokit/rest';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { z } from 'zod';
import prisma from '../../../_lib/prisma';
import type { 
  WebhookPayload, 
  User, 
  Repository,
  PushEventPayload,
  PullRequestEventPayload,
  IssueEventPayload
} from '@/types/github';

// Rate limiting configuration
const rateLimiter = new RateLimiterMemory({
  points: 100, // 100 points
  duration: 60, // per 60 seconds
});

// Metrics collection
const metrics = {
  requests: 0,
  errors: 0,
  events: new Map<string, number>(),
  processingTimes: [] as number[],

  recordEvent(event: string, processingTime: number) {
    this.requests++;
    this.events.set(event, (this.events.get(event) || 0) + 1);
    this.processingTimes.push(processingTime);

    // Keep only last 1000 samples
    if (this.processingTimes.length > 1000) {
      this.processingTimes.shift();
    }
  },

  recordError() {
    this.errors++;
  },

  getStats() {
    const sum = this.processingTimes.reduce((a, b) => a + b, 0);
    const avg = sum / this.processingTimes.length || 0;

    return {
      totalRequests: this.requests,
      totalErrors: this.errors,
      events: Object.fromEntries(this.events.entries()),
      avgProcessingTime: avg,
      p95: this.calculatePercentile(95),
      p99: this.calculatePercentile(99),
    };
  },

  calculatePercentile(p: number) {
    if (this.processingTimes.length === 0) return 0;

    const sorted = [...this.processingTimes].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }
};

// Zod schemas for payload validation
const webhookSchemas = {
  push: z.object({
    ref: z.string(),
    before: z.string(),
    after: z.string(),
    repository: z.object({
      id: z.number(),
      name: z.string(),
      full_name: z.string(),
      private: z.boolean(),
      owner: z.object({
        name: z.string().optional(),
        email: z.string().optional(),
        login: z.string(),
      }),
    }),
    commits: z.array(z.any()),
    head_commit: z.any().optional(),
  }),

  pull_request: z.object({
    action: z.string(),
    number: z.number(),
    pull_request: z.object({
      id: z.number(),
      number: z.number(),
      state: z.string(),
      title: z.string(),
      user: z.object({
        login: z.string(),
        id: z.number(),
      }),
      body: z.string().nullable(),
      created_at: z.string(),
      updated_at: z.string(),
      closed_at: z.string().nullable(),
      merged_at: z.string().nullable(),
      merge_commit_sha: z.string().nullable(),
      head: z.object({
        ref: z.string(),
        sha: z.string(),
      }),
      base: z.object({
        ref: z.string(),
        sha: z.string(),
      }),
    }),
    repository: z.object({
      id: z.number(),
      name: z.string(),
      full_name: z.string(),
      private: z.boolean(),
      owner: z.object({
        login: z.string(),
        id: z.number(),
      }),
    }),
    sender: z.object({
      login: z.string(),
      id: z.number(),
    }),
  }),
};

// Event Handler Type
type WebhookHandler = (payload: unknown) => Promise<void>;

// Store webhook handlers
const webhookHandlers: Record<string, WebhookHandler> = {
  // Ping event - GitHub sends this when you create/update a webhook
  async ping() {
    console.log('GitHub Webhook successfully configured');
  },

  // Push event - Code was pushed to a repository
  async push(payload: any) {
    const { ref, repository, sender, commits, created, deleted, forced } = payload;
    const branch = ref.replace('refs/heads/', '');
    
    console.log(`[Push] ${repository.full_name}:${branch} - ${sender.login} (${commits.length} commits)`);
    console.log(`Created: ${created}, Deleted: ${deleted}, Forced: ${forced}`);
    
    // Process commits
    for (const commit of commits) {
      console.log(`Commit: ${commit.id.slice(0, 7)} - ${commit.message} (${commit.author.name})`);
      console.log(`  Added: ${commit.added.length}, Modified: ${commit.modified.length}, Removed: ${commit.removed.length}`);
    }
  },

  // Pull Request events
  async pull_request(payload: any) {
    const { action, pull_request, repository, sender } = payload;
    const { title, number, state, merged, user, html_url } = pull_request;
    
    console.log(`[PR #${number} ${action}] ${title} (${state}${merged ? ', merged' : ''})`);
    console.log(`  By: ${user.login} in ${repository.full_name}`);
    console.log(`  URL: ${html_url}`);
    
    // Handle different PR actions
    switch (action) {
      case 'opened':
        await handleNewPullRequest(pull_request);
        break;
      case 'closed':
        await handleClosedPullRequest(pull_request);
        break;
      case 'synchronize':
        await handleUpdatedPullRequest(pull_request);
        break;
    }
  },

  // Issue events
  async issues(payload: any) {
    const { action, issue, repository, sender } = payload;
    console.log(`[Issue #${issue.number} ${action}] ${issue.title} (${issue.state})`);
    console.log(`  By: ${sender.login} in ${repository.full_name}`);
    
    // Handle different issue actions
    switch (action) {
      case 'opened':
        await handleNewIssue(issue);
        break;
      case 'closed':
        await handleClosedIssue(issue);
        break;
      case 'labeled':
        await handleLabeledIssue(issue, payload.label);
        break;
    }
  },

  // Issue comment events
  async issue_comment(payload: any) {
    const { action, issue, comment, repository, sender } = payload;
    console.log(`[Comment ${action} on #${issue.number}] ${comment.user.login}: ${comment.body.substring(0, 50)}...`);
    
    // Handle comment commands
    if (action === 'created' && comment.body.startsWith('/')) {
      await handleCommentCommand(issue, comment, repository, sender);
    }
  },

  // Release events
  async release(payload: any) {
    const { action, release, repository } = payload;
    console.log(`[Release ${action}] ${release.tag_name} - ${release.name || 'Untitled'}`);
    console.log(`  Published: ${release.published_at}, Prerelease: ${release.prerelease}`);
    
    if (action === 'published') {
      await handleNewRelease(release, repository);
    }
  },

  // Deployment status events
  async deployment_status(payload: any) {
    const { deployment_status, deployment, repository } = payload;
    console.log(`[Deployment ${deployment_status.state}] ${deployment.ref} - ${deployment.task}`);
    console.log(`  Environment: ${deployment.environment}, Status: ${deployment_status.state}`);
    
    if (deployment_status.state === 'success') {
      await handleDeploymentSuccess(deployment, deployment_status, repository);
    }
  }
};

// Helper function to verify webhook signature


// Handler implementations
async function handleNewPullRequest(pr: any) {
  // Example: Add welcome comment
  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN
  });
  
  try {
    await octokit.issues.createComment({
      owner: pr.base.repo.owner.login,
      repo: pr.base.repo.name,
      issue_number: pr.number,
      body: `Thanks for opening this pull request, @${pr.user.login}! I'll review it soon.`
    });
  } catch (error) {
    console.error('Error creating PR comment:', error);
  }
}

async function handleClosedPullRequest(pr: any) {
  // Example: Log PR closure
  console.log(`PR #${pr.number} was ${pr.merged ? 'merged' : 'closed'}`);
}

async function handleUpdatedPullRequest(pr: any) {
  // Example: Check for WIP in title
  if (pr.title.match(/\bWIP\b/i)) {
    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN
    });
    
    try {
      await octokit.issues.addLabels({
        owner: pr.base.repo.owner.login,
        repo: pr.base.repo.name,
        issue_number: pr.number,
        labels: ['work in progress']
      });
    } catch (error) {
      console.error('Error adding WIP label:', error);
    }
  }
}

async function handleNewIssue(issue: any) {
  // Example: Add welcome comment to new issues
  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN
  });
  
  try {
    await octokit.issues.createComment({
      owner: issue.repository.owner.login,
      repo: issue.repository.name,
      issue_number: issue.number,
      body: `Thanks for opening this issue, @${issue.user.login}! We'll look into it.`
    });
  } catch (error) {
    console.error('Error creating issue comment:', error);
  }
}

async function handleClosedIssue(issue: any) {
  // Handle closed issues
  console.log(`Issue #${issue.number} was closed by ${issue.user.login}`);
}

async function handleLabeledIssue(issue: any, label: any) {
  // Handle issue labels
  console.log(`Label "${label.name}" added to issue #${issue.number}`);
}

async function handleCommentCommand(issue: any, comment: any, repository: any, sender: any) {
  // Handle slash commands in comments
  const command = comment.body.trim().split(' ')[0].toLowerCase();
  console.log(`Processing command: ${command}`);
  
  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN
  });
  
  try {
    switch (command) {
      case '/assign':
        await octokit.issues.addAssignees({
          owner: repository.owner.login,
          repo: repository.name,
          issue_number: issue.number,
          assignees: [sender.login]
        });
        break;
        
      case '/close':
        await octokit.issues.update({
          owner: repository.owner.login,
          repo: repository.name,
          issue_number: issue.number,
          state: 'closed'
        });
        break;
        
      // Add more commands as needed
    }
  } catch (error) {
    console.error(`Error processing command ${command}:`, error);
  }
}

async function handleNewRelease(release: any, repository: any) {
  // Handle new releases
  console.log(`New release published: ${release.tag_name} - ${release.name || 'Untitled'}`);
  
  // Example: Post to Slack, notify team, etc.
  if (release.body) {
    console.log(`Release notes:\n${release.body}`);
  }
}

async function handleDeploymentSuccess(deployment: any, status: any, repository: any) {
  // Handle successful deployments
  console.log(`Deployment to ${deployment.environment} succeeded!`);
  console.log(`  Ref: ${deployment.ref}, Task: ${deployment.task}`);
  console.log(`  Description: ${deployment.description || 'No description'}`);
  
  // Example: Notify team, run post-deploy tasks, etc.
}



// Store webhook event in database
async function storeWebhookEvent(delivery: string, event: string, payload: unknown, status: string): Promise<void> {
  if (typeof payload !== 'object' || payload === null) {
    console.error('Invalid payload type:', typeof payload);
    return;
  }
  
  try {
    const payloadObj = payload as Record<string, unknown>;
    const repo = payloadObj?.repository as Record<string, unknown> | undefined;
    const sender = payloadObj?.sender as Record<string, unknown> | undefined;
    
    await prisma.webhookEvent.create({
      data: {
        deliveryId: delivery,
        event,
        action: payloadObj?.action as string | undefined,
        repositoryId: repo?.id?.toString(),
        repositoryName: repo?.full_name as string | undefined,
        senderId: sender?.id?.toString(),
        senderLogin: sender?.login as string | undefined,
        status,
        payload: payload as any, // Using any here since we're storing raw JSON
      },
    });
  } catch (error) {
    console.error('Failed to store webhook event:', error);
  }
}

// Validate payload against schema
function validatePayload(event: string, payload: WebhookPayload) {
  const schema = webhookSchemas[event as keyof typeof webhookSchemas];
  if (!schema) return { valid: true as const };
  
  const result = schema.safeParse(payload);
  return {
    valid: result.success,
    error: result.success ? undefined : result.error,
  };
}

// Retry wrapper for API calls
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 1000
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries === 0) throw error;
    await new Promise(resolve => setTimeout(resolve, delay));
    return withRetry(fn, retries - 1, delay * 2);
  }
}

export async function POST(request: Request) {
  const startTime = Date.now();
  let event: string | null = null;
  let delivery: string | null = null;
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  
  // Apply rate limiting
  try {
    await rateLimiter.consume(ip, 1);
  } catch (error) {
    console.warn(`Rate limit exceeded for IP: ${ip}`, error);
    return new NextResponse('Too Many Requests', { status: 429 });
  }
  
  try {
    // Get webhook headers
    const signature = request.headers.get('x-hub-signature-256');
    event = request.headers.get('x-github-event');
    delivery = request.headers.get('x-github-delivery') || 'unknown';
    
    // Validate required headers
    if (!event) {
      console.error('Missing X-GitHub-Event header');
      return new NextResponse('Missing X-GitHub-Event header', { status: 400 });
    }
    
    if (!delivery) {
      console.error('Missing X-GitHub-Delivery header');
      return new NextResponse('Missing X-GitHub-Delivery header', { status: 400 });
    }
    
    // Clone the request to read the body for verification and processing
    const requestClone = request.clone();
    const payloadText = await requestClone.text();
    let payload: any;
    
    try {
      payload = JSON.parse(payloadText);
    } catch (error) {
      console.error('Failed to parse JSON payload:', error);
      return new NextResponse('Invalid JSON payload', { status: 400 });
    }
    
    // Verify webhook signature if secret is configured
    if (process.env.GITHUB_WEBHOOK_SECRET) {
      if (!verifyWebhookSignature(signature, payloadText)) {
        console.error('Webhook signature verification failed');
        return new NextResponse('Invalid signature', { status: 401 });
      }
    } else {
      console.warn('Running without webhook signature verification (GITHUB_WEBHOOK_SECRET not set)');
    }
    
    // Log the incoming webhook
    console.log(`[${new Date().toISOString()}] Received ${event}.${payload.action || ''} event (${delivery})`);
    console.log(`  Repository: ${payload.repository?.full_name || 'unknown'}`);
    console.log(`  Sender: ${payload.sender?.login || 'unknown'} (${payload.sender?.type || 'unknown'})`);
    
    // Validate payload against schema
    const validation = validatePayload(event, payload);
    if (!validation.valid) {
      console.error('Payload validation failed:', validation.error);
      await storeWebhookEvent(delivery, event, payload, 'validation_failed');
      return new NextResponse('Invalid payload', { status: 400 });
    }
    
    // Store the incoming webhook
    await storeWebhookEvent(delivery, event, payload, 'received');
    
    // Find and execute the appropriate handler with retry logic
    const handler = webhookHandlers[event as keyof typeof webhookHandlers];
    if (handler) {
      try {
        console.log(`Executing handler for ${event} event`);
        await withRetry(async () => {
          await handler(payload);
          return Promise.resolve();
        });
        await storeWebhookEvent(delivery, event, payload, 'processed');
      } catch (error) {
        console.error(`Error in ${event} handler:`, error);
        await storeWebhookEvent(delivery, event, payload, 'error');
        metrics.recordError();
      }
    } else {
      console.warn(`No handler registered for event type: ${event}`);
      await storeWebhookEvent(delivery, event, payload, 'unhandled');
    }
    
    // Record metrics and log successful processing
    const processingTime = Date.now() - startTime;
    metrics.recordEvent(event, processingTime);
    
    console.log(`Processed ${event} event in ${processingTime}ms`);
    
    // Return success response with metrics
    return NextResponse.json({
      status: 'processed',
      event,
      delivery,
      processing_time_ms: processingTime,
      timestamp: new Date().toISOString(),
      metrics: {
        ...metrics.getStats(),
        currentRateLimit: await rateLimiter.get(ip)
      }
    }, {
      headers: {
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': (await rateLimiter.get(ip))?.remainingPoints.toString() || 'unknown'
      }
    });
    
  } catch (error) {
    // Log the error with as much context as possible
    console.error('Error processing webhook:', {
      event,
      delivery,
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : error,
      timestamp: new Date().toISOString()
    });
    
    // Return error response
    return new NextResponse(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
        event,
        delivery,
        timestamp: new Date().toISOString()
      }), 
      { 
        status: 500, 
        headers: { 
          'Content-Type': 'application/json',
          'X-Webhook-Event': event || 'unknown',
          'X-GitHub-Delivery': delivery || 'unknown'
        } 
      }
    );
  }
}

function verifyWebhookSignature(signature: string | null, payload: string): boolean {
  if (!signature) {
    console.error('Missing X-Hub-Signature-256 header');
    return false;
  }
  
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.error('GITHUB_WEBHOOK_SECRET is not set in environment variables');
    return false;
  }
  
  try {
    const hmac = createHmac('sha256', secret);
    const digest = 'sha256=' + hmac.update(payload).digest('hex');
    const isValid = signature === digest;
    
    if (!isValid) {
      console.error('Invalid webhook signature');
      console.error(`Expected: ${digest}`);
      console.error(`Received: ${signature}`);
    }
    
    return isValid;
  } catch (error) {
    console.error('Error verifying webhook signature:', error);
    return false;
  }
}

// Event handlers
async function handlePushEvent(payload: WebhookPayload) {
  const { repository, sender } = payload;
  if (!repository) {
    throw new Error('Missing repository information in push event');
  }
  
  console.log(`[Push] ${repository.full_name} - ${sender?.login || 'unknown user'}`);
  
  // Add your push event handling logic here
  // Example: Process commits, trigger builds, etc.
}

async function handlePullRequestEvent(payload: WebhookPayload) {
  const { pull_request, action, sender } = payload;
  if (!pull_request) {
    throw new Error('Missing pull request information in PR event');
  }
  
  console.log(`[PR ${action}] #${pull_request.number} ${pull_request.title} - ${sender?.login || 'unknown user'}`);
  
  // Add your PR event handling logic here
  // Example: Run tests, add labels, notify team, etc.
}

async function handleIssuesEvent(payload: WebhookPayload) {
  const { issue, action, sender } = payload;
  if (!issue) {
    throw new Error('Missing issue information in issues event');
  }
  
  console.log(`[Issue ${action}] #${issue.number} ${issue.title} - ${sender?.login || 'unknown user'}`);
  
  // Add your issue event handling logic here
  // Example: Triage issues, assign labels, etc.
}

async function handleIssueCommentEvent(payload: WebhookPayload) {
  const { comment, issue, action, sender } = payload;
  if (!comment || !issue) {
    throw new Error('Missing comment or issue information in comment event');
  }
  
  console.log(`[Comment ${action}] on #${issue.number} by ${sender?.login || 'unknown user'}`);
  
  // Add your comment handling logic here
  // Example: Process commands, notify users, etc.
}
