import { NextResponse } from 'next/server';
import { AVAILABLE_CRAWLERS, CrawlerType } from '@/config/crawlers';

export async function POST(request: Request) {
  try {
    const { crawlerId, parameters } = await request.json();
    
    if (!AVAILABLE_CRAWLERS[crawlerId as CrawlerType]) {
      return NextResponse.json(
        { error: 'Crawler not found' },
        { status: 404 }
      );
    }

    // TODO: Implement actual crawler execution
    // For now, we'll just return a mock response
    const result = {
      crawlerId,
      parameters,
      result: `Crawler ${crawlerId} executed with parameters: ${JSON.stringify(parameters)}`,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error executing crawler:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Return list of available crawlers
  return NextResponse.json({
    crawlers: Object.values(AVAILABLE_CRAWLERS),
  });
}
