import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { createJob, updateJobStatus, removeJob } from '../crawl/status/route';
import { validateRequest } from '@/app/_middleware/validate-request';
import { crawlRequestSchema } from '@/validations/crawl';

// Types
interface CrawlRequest {
  url: string;
  config?: Record<string, unknown>;
  browser_config?: Record<string, unknown>;
  llm_config?: Record<string, unknown>;
}

interface CrawlResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  job_id?: string;
}

// Store active crawl jobs
const activeJobs = new Map<string, { process: ReturnType<typeof spawn>; startTime: number }>();

// Cleanup old jobs periodically
setInterval(() => {
  const now = Date.now();
  for (const [jobId, job] of activeJobs.entries()) {
    if (now - job.startTime > 30 * 60 * 1000) { // 30 minutes timeout
      job.process?.kill();
      activeJobs.delete(jobId);
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes

function createPythonScript(request: CrawlRequest): string {
  return `
import asyncio
import json
import sys
from crawl4ai import AsyncWebCrawler
from crawl4ai.async_configs import BrowserConfig, CrawlerRunConfig, LLMConfig

async def crawl_url():
    try:
        url = "${request.url.replace(/"/g, '\\"')}"
        config_data = json.loads('${JSON.stringify(request.config || {}).replace(/"/g, '\\"')}')
        browser_config_data = json.loads('${JSON.stringify(request.browser_config || {}).replace(/"/g, '\\"')}')
        llm_config_data = json.loads('${JSON.stringify(request.llm_config || {}).replace(/"/g, '\\"')}')

        # Create configurations
        browser_config = BrowserConfig(**browser_config_data) if browser_config_data else BrowserConfig()
        crawler_config = CrawlerRunConfig(**config_data) if config_data else CrawlerRunConfig()
        llm_config = LLMConfig(**llm_config_data) if llm_config_data else None

        # Initialize crawler
        async with AsyncWebCrawler(config=browser_config) as crawler:
            result = await crawler.arun(
                url=url,
                config=crawler_config,
                # Note: LLM config integration would need to be added to crawl4ai
                # llm_config=llm_config
            )

            # Convert result to JSON-serializable format
            result_data = {
                "url": result.url,
                "html": result.html,
                "fit_html": result.fit_html,
                "cleaned_html": result.cleaned_html,
                "markdown": {
                    "raw_markdown": result.markdown.raw_markdown if hasattr(result.markdown, 'raw_markdown') else str(result.markdown),
                    "fit_markdown": getattr(result.markdown, 'fit_markdown', None),
                    "markdown": getattr(result.markdown, 'markdown', None),
                } if result.markdown else None,
                "media": result.media.model_dump() if hasattr(result.media, 'model_dump') else result.media,
                "tables": result.tables,
                "links": result.links.model_dump() if hasattr(result.links, 'model_dump') else result.links,
                "metadata": result.metadata,
                "screenshot": result.screenshot,
                "pdf": result.pdf,
                "extracted_content": result.extracted_content,
                "success": result.success,
                "status_code": getattr(result, 'status_code', None),
                "error_message": result.error_message,
                "response_headers": result.response_headers,
                "redirected_url": result.redirected_url,
                "downloaded_files": result.downloaded_files,
                "js_execution_result": result.js_execution_result,
                "mhtml": result.mhtml,
                "ssl_certificate": result.ssl_certificate,
                "network_requests": result.network_requests,
                "console_messages": result.console_messages,
                "session_id": result.session_id,
            }

            print(json.dumps(result_data))

    except Exception as e:
        error_data = {
            "success": False,
            "error": str(e),
            "url": "${request.url.replace(/"/g, '\\"')}"
        }
        print(json.dumps(error_data))
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(crawl_url())
`;
}

async function runPythonCrawl(request: CrawlRequest): Promise<CrawlResponse> {
  return new Promise((resolve) => {
    const jobId = randomUUID();
    const scriptPath = path.join('/tmp', `crawl_script_${jobId}.py`);

    // Create job status entry
    createJob(jobId);
    updateJobStatus(jobId, {
      status: 'running',
      current_url: request.url,
      progress: 10
    });

    // Create Python script
    const scriptContent = createPythonScript(request);

    // Write script to temporary file
    fs.writeFile(scriptPath, scriptContent)
      .then(() => {
        // Spawn Python process
        const pythonProcess = spawn('python3', [scriptPath], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PYTHONPATH: process.env.PYTHONPATH || '',
          }
        });

        let stdout = '';
        let stderr = '';

        pythonProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        pythonProcess.on('close', async (code) => {
          // Clean up temporary file
          try {
            await fs.unlink(scriptPath);
          } catch (error) {
            console.error('Failed to clean up temp file:', error);
          }

          // Remove from active jobs
          activeJobs.delete(jobId);
          removeJob(jobId);

          if (code === 0 && stdout.trim()) {
            try {
              const result = JSON.parse(stdout.trim());
              updateJobStatus(jobId, {
                status: 'completed',
                progress: 100,
                results: [result]
              });
              resolve({
                success: true,
                data: result,
                job_id: jobId
              });
            } catch (parseError) {
              updateJobStatus(jobId, {
                status: 'failed',
                error: `Failed to parse crawl result: ${parseError}`
              });
              resolve({
                success: false,
                error: `Failed to parse crawl result: ${parseError}`,
                job_id: jobId
              });
            }
          } else {
            const errorMsg = stderr || `Python process exited with code ${code}`;
            updateJobStatus(jobId, {
              status: 'failed',
              error: errorMsg
            });
            resolve({
              success: false,
              error: errorMsg,
              job_id: jobId
            });
          }
        });

        pythonProcess.on('error', async (error) => {
          // Clean up temporary file
          try {
            await fs.unlink(scriptPath);
          } catch (cleanupError) {
            console.error('Failed to clean up temp file:', cleanupError);
          }

          activeJobs.delete(jobId);
          removeJob(jobId);
          resolve({
            success: false,
            error: `Failed to start Python process: ${error.message}`,
            job_id: jobId
          });
        });

        // Store job info
        activeJobs.set(jobId, {
          process: pythonProcess,
          startTime: Date.now()
        });

        // Set timeout
        setTimeout(() => {
          if (activeJobs.has(jobId)) {
            pythonProcess.kill();
            activeJobs.delete(jobId);
            updateJobStatus(jobId, {
              status: 'failed',
              error: 'Crawl operation timed out'
            });
            resolve({
              success: false,
              error: 'Crawl operation timed out',
              job_id: jobId
            });
          }
        }, 10 * 60 * 1000); // 10 minutes timeout

      })
      .catch((error) => {
        updateJobStatus(jobId, {
          status: 'failed',
          error: `Failed to write script file: ${error.message}`
        });
        resolve({
          success: false,
          error: `Failed to write script file: ${error.message}`,
          job_id: jobId
        });
      });
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Validate request with rate limiting
    const validation = await validateRequest(request, {
      schema: crawlRequestSchema,
      rateLimit: true,
      requireAuth: true, // Require API key for crawl endpoint
    });

    if (!validation.valid) {
      return validation.response;
    }

    // If we have data from validation, use it
    const body = validation.data;

    // Run crawl operation
    const result = await runPythonCrawl(body);

    if (result.success) {
      return NextResponse.json(result, { status: 200 });
    } else {
      return NextResponse.json(result, { status: 500 });
    }

  } catch (error) {
    console.error('Crawl API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      message: 'Crawl4AI Web Interface API',
      endpoints: {
        'POST /api/crawl': 'Start a new crawl operation',
        'GET /api/crawl/status': 'Check crawl job status',
        'POST /api/crawl/export': 'Export crawl results'
      }
    },
    { status: 200 }
  );
}
