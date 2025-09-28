export interface CrawlerJob {
  id: string;
  crawlerId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  parameters?: Record<string, any>;
  result?: any;
  error?: string;
}

export interface CrawlerExecutionParams {
  [key: string]: any;
}

export interface CrawlerResult {
  crawlerId: string;
  parameters: CrawlerExecutionParams;
  result: any;
  timestamp: string;
}
