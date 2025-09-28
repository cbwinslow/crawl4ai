import { NextRequest, NextResponse } from 'next/server';
import { validateRequest } from '@/app/_middleware/validate-request';
import { statusCheckSchema } from '@/validations/crawl';
import { CrawlResult } from '@/types/crawl4ai';

// Define the job status type
type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

// Define the job interface
interface Job {
  status: JobStatus;
  progress?: number;
  current_url?: string;
  results?: CrawlResult[];
  error?: string;
  start_time: number;
}

// In-memory store for jobs (in production, use a database)
const activeJobs = new Map<string, Job>();

// Cleanup old jobs periodically
const JOB_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Initialize cleanup interval
let cleanupInitialized = false;

function initializeCleanup() {
  if (cleanupInitialized) return;
  
  setInterval(() => {
    const now = Date.now();
    for (const [jobId, job] of activeJobs.entries()) {
      if (now - job.start_time > JOB_TIMEOUT_MS) {
        activeJobs.delete(jobId);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  
  cleanupInitialized = true;
}

// Initialize cleanup on first import
initializeCleanup();


export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Validate request with rate limiting
    const validation = await validateRequest(request, {
      schema: statusCheckSchema,
      rateLimit: true,
      requireAuth: true,
    });

    if (!validation.valid) {
      return validation.response;
    }

    const { job_id: jobId } = validation.data;
    const job = activeJobs.get(jobId);

    if (!job) {
      return NextResponse.json(
        { success: false, error: 'Job not found or expired' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      status: job.status,
      progress: job.progress,
      current_url: job.current_url,
      results: job.results,
      error: job.error,
      start_time: job.start_time,
      elapsed_time: Date.now() - job.start_time
    }, { 
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });

  } catch (error) {
    console.error('Status API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}

// Helper function to update job status (called by main crawl route)
export function updateJobStatus(
  jobId: string,
  updates: Partial<Omit<Job, 'start_time'>>
): void {
  const existingJob = activeJobs.get(jobId);
  if (existingJob) {
    activeJobs.set(jobId, { ...existingJob, ...updates });
  } else {
    activeJobs.set(jobId, {
      status: updates.status || 'pending',
      progress: updates.progress,
      current_url: updates.current_url,
      results: updates.results,
      error: updates.error,
      start_time: Date.now()
    });
  }
}

// Helper function to create new job
export function createJob(jobId: string, initialData: Partial<Job> = {}): void {
  activeJobs.set(jobId, {
    status: 'pending',
    start_time: Date.now(),
    ...initialData,
  });
}

// Helper function to get job status
export function getJobStatus(jobId: string): Job | undefined {
  return activeJobs.get(jobId);
}

// Helper function to check if job exists
export function jobExists(jobId: string): boolean {
  return activeJobs.has(jobId);
}

// Helper function to get all active job IDs
export function getActiveJobIds(): string[] {
  return Array.from(activeJobs.keys());
}

// Helper function to remove job
export function removeJob(jobId: string): void {
  activeJobs.delete(jobId);
}
