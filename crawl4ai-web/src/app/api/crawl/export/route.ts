import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { validateRequest } from '@/app/_middleware/validate-request';
import { exportRequestSchema } from '@/validations/crawl';
import { CrawlResult } from '@/types/crawl4ai';

// In-memory store for export files (in production, use a persistent storage)
const EXPORT_FILE_TTL = 60 * 60 * 1000; // 1 hour
const EXPORT_CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 minutes

interface ExportFileInfo {
  filepath: string;
  created: number;
  mimetype: string;
  filename: string;
}

const exportFiles = new Map<string, ExportFileInfo>();

// Cleanup old export files periodically
let cleanupInitialized = false;

function initializeCleanup() {
  if (cleanupInitialized) return;
  
  setInterval(async () => {
    const now = Date.now();
    for (const [exportId, fileInfo] of exportFiles.entries()) {
      if (now - fileInfo.created > EXPORT_FILE_TTL) {
        try {
          await fs.unlink(fileInfo.filepath);
          exportFiles.delete(exportId);
        } catch (error) {
          console.error('Failed to clean up export file:', error);
        }
      }
    }
  }, EXPORT_CLEANUP_INTERVAL);
  
  cleanupInitialized = true;
}

// Initialize cleanup on first import
initializeCleanup();

interface ExportResponse {
  success: boolean;
  download_url?: string;
  error?: string;
}


function convertToCSV(data: unknown[]): string {
  if (!Array.isArray(data) || data.length === 0) {
    return 'No data available';
  }

  // Flatten nested objects for CSV
  const flattenObject = (obj: unknown, prefix = ''): Record<string, string> => {
    if (obj === null || typeof obj !== 'object') {
      return { [prefix.slice(0, -1) || 'value']: String(obj) };
    }

    if (Array.isArray(obj)) {
      return { [prefix.slice(0, -1) || 'value']: obj.join('; ') };
    }

    const flattened: Record<string, string> = {};
    for (const [key, value] of Object.entries(obj)) {
      const newKey = prefix + key;
      if (value === null || typeof value !== 'object') {
        flattened[newKey] = String(value || '');
      } else if (Array.isArray(value)) {
        flattened[newKey] = value.join('; ');
      } else {
        Object.assign(flattened, flattenObject(value, newKey + '_'));
      }
    }
    return flattened;
  };

  const flattenedData = data.map(item => flattenObject(item));

  if (flattenedData.length === 0) {
    return 'No data available';
  }

  const headers = Array.from(new Set(flattenedData.flatMap(Object.keys))).sort();

  const csvRows = [
    headers.join(','),
    ...flattenedData.map(row =>
      headers.map(header => {
        const value = row[header] || '';
        // Escape quotes and wrap in quotes if contains comma, quote, or newline
        return value.includes(',') || value.includes('"') || value.includes('\n')
          ? `"${value.replace(/"/g, '""')}"`
          : value;
      }).join(',')
    )
  ];

  return csvRows.join('\n');
}

function generatePDFContent(data: unknown): string {
  // Simple HTML content for PDF generation
  // In a real implementation, you might use a library like Puppeteer or jsPDF
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Crawl4AI Export</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            .header { border-bottom: 2px solid #333; margin-bottom: 20px; padding-bottom: 10px; }
            .data-section { margin: 20px 0; }
            .data-item { margin: 10px 0; padding: 10px; background: #f5f5f5; border-radius: 4px; }
            pre { background: #f8f8f8; padding: 10px; border-radius: 4px; overflow-x: auto; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>Crawl4AI Export Results</h1>
            <p>Generated on: ${new Date().toLocaleString()}</p>
        </div>
        <div class="data-section">
            <h2>Crawl Results</h2>
            <pre>${JSON.stringify(data, null, 2)}</pre>
        </div>
    </body>
    </html>
  `;

  return htmlContent;
}

async function generateExportFile(
  request: {
    format: 'json' | 'csv' | 'pdf';
    data: CrawlResult | CrawlResult[];
    filename?: string;
  }
): Promise<{ filepath: string; filename: string; mimetype: string }> {
  const exportId = randomUUID();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseFilename = request.filename || `crawl4ai-export-${timestamp}`;

  let filename: string;
  let content: string;
  let mimetype: string;

  switch (request.format) {
    case 'json':
      filename = `${baseFilename}.json`;
      content = JSON.stringify(request.data, null, 2);
      mimetype = 'application/json';
      break;

    case 'csv':
      filename = `${baseFilename}.csv`;
      content = convertToCSV(Array.isArray(request.data) ? request.data : [request.data]);
      mimetype = 'text/csv';
      break;

    case 'pdf':
      filename = `${baseFilename}.html`; // We'll generate HTML that can be converted to PDF
      content = generatePDFContent(request.data);
      mimetype = 'text/html';
      break;

    default:
      throw new Error(`Unsupported export format: ${request.format}`);
  }

  const filepath = path.join('/tmp', filename);

  // Write file
  await fs.writeFile(filepath, content, 'utf8');

  // Store file info for cleanup
  exportFiles.set(exportId, {
    filepath,
    filename,
    mimetype,
    created: Date.now()
  });

  return { filepath, filename, mimetype };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Validate request with rate limiting
    const validation = await validateRequest(request, {
      schema: exportRequestSchema,
      rateLimit: true,
      requireAuth: true,
    });

    if (!validation.valid) {
      return validation.response;
    }

    const body = validation.data;

    // Generate export file
    const { filepath, filename, mimetype } = await generateExportFile(body);
    const exportId = randomUUID();

    // Store file info for download
    exportFiles.set(exportId, {
      filepath,
      filename,
      mimetype,
      created: Date.now(),
    });

    // Return download URL with export ID
    const downloadUrl = `/api/crawl/export/download?id=${exportId}`;

    return NextResponse.json({
      success: true,
      download_url: downloadUrl,
      filename: filename,
      format: body.format
    }, { status: 200 });

  } catch (error) {
    console.error('Export API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const exportId = searchParams.get('id');

    if (!exportId) {
      return NextResponse.json(
        { success: false, error: 'Export ID is required' },
        { status: 400 }
      );
    }

    const fileInfo = exportFiles.get(exportId);
    if (!fileInfo) {
      return NextResponse.json(
        { success: false, error: 'Export not found or expired' },
        { status: 404 }
      );
    }

    // Check if file exists
    try {
      await fs.access(fileInfo.filepath);
    } catch {
      exportFiles.delete(exportId);
      return NextResponse.json(
        { success: false, error: 'File not found' },
        { status: 404 }
      );
    }

    // Read file
    const content = await fs.readFile(fileInfo.filepath, 'utf8');
    const { filename, mimetype } = fileInfo;

    // Schedule file cleanup
    setTimeout(() => {
      try {
        fs.unlink(fileInfo.filepath).catch(console.error);
        exportFiles.delete(exportId);
      } catch (error) {
        console.error('Failed to clean up export file:', error);
      }
    }, 1000);

    return new NextResponse(content, {
      headers: {
        'Content-Type': mimetype,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });

  } catch (error) {
    console.error('Export download API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}
