import { useQuery, useMutation } from '@tanstack/react-query';
import { AVAILABLE_CRAWLERS, CrawlerType, type CrawlerConfig } from '@/config/crawlers';

export interface CrawlerExecutionParams {
  [key: string]: any;
}

export interface CrawlerResult {
  crawlerId: string;
  parameters: CrawlerExecutionParams;
  result: any;
  timestamp: string;
}

export function useCrawlers() {
  const listCrawlers = useQuery<CrawlerConfig[]>({
    queryKey: ['crawlers'],
    queryFn: async () => {
      const response = await fetch('/api/crawlers');
      if (!response.ok) {
        throw new Error('Failed to fetch crawlers');
      }
      const data = await response.json();
      return data.crawlers;
    },
  });

  const executeCrawler = useMutation<CrawlerResult, Error, { crawlerId: string; params: CrawlerExecutionParams }>({
    mutationFn: async ({ crawlerId, params }) => {
      const response = await fetch('/api/crawlers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          crawlerId,
          parameters: params,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to execute crawler');
      }

      return response.json();
    },
  });

  const getCrawlerConfig = (crawlerId: string): CrawlerConfig | undefined => {
    return AVAILABLE_CRAWLERS[crawlerId as CrawlerType];
  };

  return {
    listCrawlers,
    executeCrawler,
    getCrawlerConfig,
  };
}
