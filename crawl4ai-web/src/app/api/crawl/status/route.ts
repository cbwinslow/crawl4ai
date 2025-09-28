import { NextRequest, NextResponse } from 'next/server';

// This would typically come from the main crawl route
// For now, we'll use a simple in-memory store
const activeJobs = new Map<string, {
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number;
  current_url?: string;
  results?: unknown[];
  error?: string;
  start_time: number;
}>();

// Cleanup old jobs periodically
setInterval(() => {
  const now = Date.now();
  for (const [jobId] of activeJobs.entries()) {
    const job = activeJobs.get(jobId);
    if (job && now - job.start_time > 30 * 60 * 1000) { // 30 minutes timeout
      activeJobs.delete(jobId);
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('job_id');

    if (!jobId) {
      return NextResponse.json(
        { success: false, error: 'job_id parameter is required' },
        { status: 400 }
      );
    }

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
    }, { status: 200 });

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
  updates: Partial<{
    status: 'pending' | 'running' | 'completed' | 'failed';
    progress?: number;
    current_url?: string;
    results?: unknown[];
    error?: string;
  }>
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
export function createJob(jobId: string): void {
  activeJobs.set(jobId, {
    status: 'pending',
    start_time: Date.now()
  });
}

// Helper function to remove job
export function removeJob(jobId: string): void {
  activeJobs.delete(jobId);
}
