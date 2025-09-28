import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs/promises';

// Types
interface ExportRequest {
  format: 'json' | 'csv' | 'pdf';
  data: unknown;
  filename?: string;
}

interface ExportResponse {
  success: boolean;
  download_url?: string;
  error?: string;
}

// Store generated export files temporarily
const exportFiles = new Map<string, { filepath: string; created: number }>();

// Cleanup old export files periodically
setInterval(() => {
  const now = Date.now();
  for (const [exportId, fileInfo] of exportFiles.entries()) {
    if (now - fileInfo.created > 60 * 60 * 1000) { // 1 hour timeout
      fs.unlink(fileInfo.filepath).catch(console.error);
      exportFiles.delete(exportId);
    }
  }
}, 10 * 60 * 1000); // Check every 10 minutes

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

async function generateExportFile(request: ExportRequest): Promise<{ filepath: string; filename: string }> {
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
    created: Date.now()
  });

  return { filepath, filename };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: ExportRequest = await request.json();

    // Validate request
    if (!body.format || !['json', 'csv', 'pdf'].includes(body.format)) {
      return NextResponse.json(
        { success: false, error: 'Valid format (json, csv, pdf) is required' },
        { status: 400 }
      );
    }

    if (!body.data) {
      return NextResponse.json(
        { success: false, error: 'Data is required' },
        { status: 400 }
      );
    }

    // Generate export file
    const { filepath, filename } = await generateExportFile(body);

    // Return download URL
    const downloadUrl = `/api/crawl/export/download?file=${encodeURIComponent(filename)}`;

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
    const filename = searchParams.get('file');

    if (!filename) {
      return NextResponse.json(
        { success: false, error: 'file parameter is required' },
        { status: 400 }
      );
    }

    const filepath = path.join('/tmp', filename);

    // Check if file exists
    try {
      await fs.access(filepath);
    } catch {
      return NextResponse.json(
        { success: false, error: 'File not found' },
        { status: 404 }
      );
    }

    // Read and return file
    const content = await fs.readFile(filepath, 'utf8');

    // Determine content type
    const ext = path.extname(filename).toLowerCase();
    let contentType = 'application/octet-stream';

    switch (ext) {
      case '.json':
        contentType = 'application/json';
        break;
      case '.csv':
        contentType = 'text/csv';
        break;
      case '.html':
        contentType = 'text/html';
        break;
    }

    // Clean up file after serving
    setTimeout(async () => {
      try {
        await fs.unlink(filepath);
      } catch (error) {
        console.error('Failed to clean up export file:', error);
      }
    }, 1000);

    return new NextResponse(content, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache'
      }
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
