import { createHmac } from 'crypto';

// GitHub Webhook Event Types
export type GitHubEvent =
  | 'check_run'
  | 'check_suite'
  | 'code_scanning_alert'
  | 'commit_comment'
  | 'create'
  | 'delete'
  | 'deploy_key'
  | 'deployment'
  | 'deployment_status'
  | 'fork'
  | 'github_app_authorization'
  | 'gollum'
  | 'installation'
  | 'installation_repositories'
  | 'issue_comment'
  | 'issues'
  | 'label'
  | 'marketplace_purchase'
  | 'member'
  | 'membership'
  | 'meta'
  | 'milestone'
  | 'organization'
  | 'org_block'
  | 'package'
  | 'page_build'
  | 'ping'
  | 'project'
  | 'project_card'
  | 'project_column'
  | 'public'
  | 'pull_request'
  | 'pull_request_review'
  | 'pull_request_review_comment'
  | 'push'
  | 'release'
  | 'repository'
  | 'repository_import'
  | 'repository_vulnerability_alert'
  | 'security_advisory'
  | 'sponsorship'
  | 'star'
  | 'status'
  | 'team'
  | 'team_add'
  | 'watch'
  | 'workflow_dispatch'
  | 'workflow_run';

// Common Interfaces
export interface User {
  login: string;
  id: number;
  node_id: string;
  avatar_url: string;
  html_url: string;
  type: 'User' | 'Bot' | 'Organization' | 'Mannequin';
  site_admin: boolean;
}

export interface Repository {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  private: boolean;
  owner: User;
  html_url: string;
  description: string | null;
  fork: boolean;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  git_url: string;
  ssh_url: string;
  clone_url: string;
  default_branch: string;
}

// Webhook Payload Interfaces
export interface WebhookPayload {
  action?: string;
  sender: User;
  repository: Repository;
  organization?: {
    login: string;
    id: number;
    node_id: string;
    url: string;
    html_url: string;
  };
  installation?: {
    id: number;
    node_id: string;
  };
  // Event-specific properties
  pull_request?: {
    html_url: string;
    number: number;
    title: string;
    user: User;
    state: string;
    merged: boolean;
    base: {
      repo: Repository;
    };
  };
  issue?: {
    html_url: string;
    number: number;
    title: string;
    user: User;
    state: string;
    repository: Repository;
  };
  comment?: {
    html_url: string;
    body: string;
    user: User;
  };
  ref?: string;
  before?: string;
  after?: string;
  commits?: Array<{
    id: string;
    message: string;
    author: {
      name: string;
    };
    added: string[];
    modified: string[];
    removed: string[];
  }>;
  created?: boolean;
  deleted?: boolean;
  forced?: boolean;
  // Add more specific payload types as needed
}

// Specific Event Payloads
export interface PushEventPayload extends WebhookPayload {
  ref: string;
  before: string;
  after: string;
  created: boolean;
  deleted: boolean;
  forced: boolean;
  base_ref: string | null;
  compare: string;
  commits: Array<{
    id: string;
    tree_id: string;
    distinct: boolean;
    message: string;
    timestamp: string;
    url: string;
    author: {
      name: string;
      email: string;
      username?: string;
    };
    committer: {
      name: string;
      email: string;
      username?: string;
    };
    added: string[];
    removed: string[];
    modified: string[];
  }>;
  head_commit: {
    id: string;
    tree_id: string;
    distinct: boolean;
    message: string;
    timestamp: string;
    url: string;
    author: {
      name: string;
      email: string;
      username?: string;
    };
    committer: {
      name: string;
      email: string;
      username?: string;
    };
    added: string[];
    removed: string[];
    modified: string[];
  } | null;
  pusher: {
    name: string;
    email: string;
  };
}

export interface PullRequestEventPayload extends WebhookPayload {
  action: 'opened' | 'closed' | 'reopened' | 'assigned' | 'unassigned' | 'review_requested' | 'review_request_removed' | 'ready_for_review' | 'converted_to_draft' | 'labeled' | 'unlabeled' | 'synchronize';
  number: number;
  pull_request: {
    url: string;
    id: number;
    node_id: string;
    html_url: string;
    diff_url: string;
    patch_url: string;
    issue_url: string;
    number: number;
    state: 'open' | 'closed';
    locked: boolean;
    title: string;
    user: User;
    body: string | null;
    created_at: string;
    updated_at: string;
    closed_at: string | null;
    merged_at: string | null;
    merge_commit_sha: string | null;
    assignee: User | null;
    assignees: User[];
    requested_reviewers: User[];
    requested_teams: Array<{
      id: number;
      node_id: string;
      url: string;
      name: string;
      slug: string;
      description: string | null;
      privacy: string;
      permission: string;
      members_url: string;
      repositories_url: string;
      parent: null;
    }>;
    labels: Array<{
      id: number;
      node_id: string;
      url: string;
      name: string;
      color: string;
      default: boolean;
      description: string | null;
    }>;
    head: {
      label: string;
      ref: string;
      sha: string;
      user: User;
      repo: Repository;
    };
    base: {
      label: string;
      ref: string;
      sha: string;
      user: User;
      repo: Repository;
    };
    author_association: string;
    auto_merge: null | {
      enabled_by: User;
      merge_method: 'merge' | 'squash' | 'rebase';
      commit_title: string;
      commit_message: string;
    };
    draft: boolean;
    merged: boolean;
    mergeable: boolean | null;
    rebaseable: boolean | null;
    mergeable_state: string;
    merged_by: User | null;
    comments: number;
    review_comments: number;
    maintainer_can_modify: boolean;
    commits: number;
    additions: number;
    deletions: number;
    changed_files: number;
  };
}

// Add more specific event payload interfaces as needed

export interface IssueEventPayload extends WebhookPayload {
  action: 'opened' | 'edited' | 'deleted' | 'transferred' | 'pinned' | 'unpinned' | 'closed' | 'reopened' | 'assigned' | 'unassigned' | 'labeled' | 'unlabeled' | 'locked' | 'unlocked' | 'milestoned' | 'demilestoned';
  issue: {
    url: string;
    repository_url: string;
    labels_url: string;
    comments_url: string;
    events_url: string;
    html_url: string;
    id: number;
    node_id: string;
    number: number;
    title: string;
    user: User;
    labels: Array<{
      id: number;
      node_id: string;
      url: string;
      name: string;
      color: string;
      default: boolean;
      description: string | null;
    }>;
    state: 'open' | 'closed';
    locked: boolean;
    assignee: User | null;
    assignees: User[];
    milestone: {
      url: string;
      html_url: string;
      labels_url: string;
      id: number;
      node_id: string;
      number: number;
      title: string;
      description: string | null;
      creator: User;
      open_issues: number;
      closed_issues: number;
      state: 'open' | 'closed';
      created_at: string;
      updated_at: string;
      due_on: string | null;
      closed_at: string | null;
    } | null;
    comments: number;
    created_at: string;
    updated_at: string;
    closed_at: string | null;
    author_association: string;
    active_lock_reason: string | null;
    body: string | null;
    performed_via_github_app: any | null;
    repository: Repository; // Add missing repository property
  };
  changes?: {
    title?: {
      from: string;
    };
    body?: {
      from: string;
    };
  };
  assignee?: User;
  label?: {
    id: number;
    node_id: string;
    url: string;
    name: string;
    color: string;
    default: boolean;
    description: string | null;
  };
}

// Add more event payload interfaces as needed

export interface WebhookHandler<T extends WebhookPayload = WebhookPayload> {
  (payload: T): Promise<void> | void;
}

export interface WebhookHandlers {
  [event: string]: WebhookHandler;
}

export function isEventType<T extends WebhookPayload>(
  payload: WebhookPayload,
  type: string
): payload is T {
  return payload.action === type || payload.action === undefined;
}

export function logWebhookEvent(event: string, payload: any) {
  const logData = {
    timestamp: new Date().toISOString(),
    event,
    repository: payload.repository?.full_name,
    action: payload.action,
    sender: payload.sender?.login,
    payload: JSON.stringify(payload, null, 2)
  };
  
  console.log(`[${logData.timestamp}] ${event}.${payload.action || ''}`, logData);
  
  // Here you could also log to a database or external logging service
  // Example: logToDatabase('webhook_event', logData);
}

export function validateWebhookSignature(
  signature: string | null,
  payload: string,
  secret: string
): boolean {
  if (!signature) {
    console.error('Missing X-Hub-Signature-256 header');
    return false;
  }

  const hmac = createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  const isValid = signature === digest;

  if (!isValid) {
    console.error('Invalid webhook signature');
    console.error(`Expected: ${digest}`);
    console.error(`Received: ${signature}`);
  }

  return isValid;
}

// Helper function to safely parse JSON with error handling
export function safeJsonParse<T>(text: string): { success: true; data: T } | { success: false; error: Error } {
  try {
    return { success: true, data: JSON.parse(text) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}
