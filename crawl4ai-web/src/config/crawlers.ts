export interface CrawlerConfig {
  id: string;
  name: string;
  description: string;
  parameters: {
    name: string;
    type: 'string' | 'number' | 'boolean';
    required: boolean;
    description: string;
  }[];
}

export const AVAILABLE_CRAWLERS: Record<string, CrawlerConfig> = {
  'amazon-product': {
    id: 'amazon-product',
    name: 'Amazon Product Crawler',
    description: 'Crawls product information from Amazon product pages',
    parameters: [
      {
        name: 'url',
        type: 'string',
        required: true,
        description: 'URL of the Amazon product page',
      },
      {
        name: 'extract_price',
        type: 'boolean',
        required: false,
        description: 'Whether to extract the product price',
      },
    ],
  },
  'google-search': {
    id: 'google-search',
    name: 'Google Search Crawler',
    description: 'Performs Google searches and extracts results',
    parameters: [
      {
        name: 'query',
        type: 'string',
        required: true,
        description: 'Search query',
      },
      {
        name: 'max_results',
        type: 'number',
        required: false,
        description: 'Maximum number of results to return',
      },
    ],
  },
};

export type CrawlerType = keyof typeof AVAILABLE_CRAWLERS;
