'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ChevronLeft,
  Loader2,
  Search,
  Play,
  Download,
  Eye,
  Plus,
  X
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { BrowserType, BrowserMode, CacheMode } from '@/types/crawl4ai';

// Types
interface CrawlResponse {
  success: boolean;
  data?: any;
  error?: string;
  s3_key?: string;
}

interface CrawlerConfig {
  cache_mode?: CacheMode;
  word_count_threshold?: number;
  wait_until?: string;
  page_timeout?: number;
  screenshot?: boolean;
  pdf?: boolean;
  verbose?: boolean;
}

interface BrowserConfig {
  browser_type?: BrowserType;
  browser_mode?: BrowserMode;
  viewport_width?: number;
  viewport_height?: number;
  headless?: boolean;
  ignore_https_errors?: boolean;
  java_script_enabled?: boolean;
}

export default function NewCrawlerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedCrawler, setSelectedCrawler] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Form state
  const [crawlerName, setCrawlerName] = useState('');
  const [urls, setUrls] = useState(['']);
  const [description, setDescription] = useState('');
  const [crawlerConfig, setCrawlerConfig] = useState<CrawlerConfig>({});
  const [browserConfig, setBrowserConfig] = useState<BrowserConfig>({});

  // Crawl state
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawlResult, setCrawlResult] = useState<CrawlResponse | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [crawlProgress, setCrawlProgress] = useState(0);

  useEffect(() => {
    const crawlerId = searchParams.get('crawler');
    if (crawlerId) {
      setSelectedCrawler(crawlerId);
    }
    setIsLoading(false);
  }, [searchParams]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  // Add URL
  const addUrl = () => {
    setUrls([...urls, ""]);
  };

  // Remove URL
  const removeUrl = (index: number) => {
    if (urls.length > 1) {
      setUrls(urls.filter((_, i) => i !== index));
    }
  };

  // Update URL
  const updateUrl = (index: number, value: string) => {
    const newUrls = [...urls];
    newUrls[index] = value;
    setUrls(newUrls);
  };

  // Start crawl
  const startCrawl = async () => {
    if (urls.length === 0 || !urls[0]) {
      alert("Please enter at least one URL");
      return;
    }

    setIsCrawling(true);
    setCrawlProgress(0);
    setCrawlResult(null);

    try {
      const crawlRequest = {
        urls: urls.filter(u => u.trim()),
        browser_config: browserConfig,
        crawler_config: crawlerConfig
      };

      const response = await fetch('http://localhost:11235/crawl/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(crawlRequest),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (result.task_id) {
        setCurrentJobId(result.task_id);
        pollCrawlStatus(result.task_id);
      } else {
        setCrawlResult({
          success: false,
          error: 'Failed to start crawl job'
        });
        setIsCrawling(false);
      }
    } catch (error) {
      console.error('Crawl error:', error);
      setCrawlResult({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      });
      setIsCrawling(false);
    }
  };

  // Poll crawl status
  const pollCrawlStatus = async (jobId: string) => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`http://localhost:11235/crawl/jobs/${jobId}`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const status = await response.json();

        setCrawlProgress(status.progress || 0);

        if (status.status === 'completed') {
          setCrawlResult({
            success: true,
            data: status.result?.results?.[0] || status.result,
            s3_key: status.result?.s3_key
          });
          clearInterval(pollInterval);
          setIsCrawling(false);
          setCurrentJobId(null);
        } else if (status.status === 'failed' || status.status === 'cancelled') {
          setCrawlResult({
            success: false,
            error: status.error || 'Job failed'
          });
          clearInterval(pollInterval);
          setIsCrawling(false);
          setCurrentJobId(null);
        }
      } catch (error) {
        console.error('Status poll error:', error);
      }
    }, 1000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/crawlers">
            <ChevronLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">New Crawler</h2>
          <p className="text-muted-foreground">
            Configure a new web crawler with crawl4ai integration
          </p>
        </div>
      </div>

      {/* Crawl Progress */}
      {isCrawling && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center space-x-4">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Crawling in progress...</span>
                  <span className="text-sm text-muted-foreground">{crawlProgress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${crawlProgress}%` }}
                  />
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsCrawling(false);
                  setCurrentJobId(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Crawl Results */}
      {crawlResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Eye className="h-5 w-5" />
              <span>Crawl Results</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {crawlResult.success ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-4 bg-green-50 rounded-lg">
                    <div className="text-2xl font-bold text-green-600">✓</div>
                    <div className="text-sm text-green-800">Success</div>
                  </div>
                  <div className="text-center p-4 bg-blue-50 rounded-lg">
                    <div className="text-2xl font-bold text-blue-600">
                      {crawlResult.data?.markdown?.raw_markdown?.length || 0}
                    </div>
                    <div className="text-sm text-blue-800">Characters</div>
                  </div>
                  <div className="text-center p-4 bg-purple-50 rounded-lg">
                    <div className="text-2xl font-bold text-purple-600">
                      {crawlResult.data?.status_code || 'N/A'}
                    </div>
                    <div className="text-sm text-purple-800">Status</div>
                  </div>
                  <div className="text-center p-4 bg-orange-50 rounded-lg">
                    <div className="text-2xl font-bold text-orange-600">
                      {crawlResult.data?.screenshot ? '✓' : '✗'}
                    </div>
                    <div className="text-sm text-orange-800">Screenshot</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center p-8 text-red-600">
                <div className="text-lg font-medium">Crawl Failed</div>
                <div className="text-sm mt-2">{crawlResult.error}</div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="basic" className="space-y-4">
        <TabsList>
          <TabsTrigger value="basic">Basic</TabsTrigger>
          <TabsTrigger value="crawl4ai">Crawl4AI Config</TabsTrigger>
          <TabsTrigger value="browser">Browser Config</TabsTrigger>
        </TabsList>

        <form className="space-y-6">
          <TabsContent value="basic" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Basic Information</CardTitle>
                <CardDescription>
                  Configure the basic settings for your crawler
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Crawler Name</Label>
                  <Input
                    id="name"
                    placeholder="My Awesome Crawler"
                    value={crawlerName}
                    onChange={(e) => setCrawlerName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Target URLs</Label>
                  <div className="space-y-2">
                    {urls.map((url, index) => (
                      <div key={index} className="flex space-x-2">
                        <Input
                          placeholder="https://example.com"
                          value={url}
                          onChange={(e) => updateUrl(index, e.target.value)}
                        />
                        {urls.length > 1 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => removeUrl(index)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addUrl}
                      className="w-full"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add URL
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="crawl4ai" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Crawl4AI Configuration</CardTitle>
                <CardDescription>
                  Configure crawl4ai-specific settings
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="cache-mode">Cache Mode</Label>
                    <Select
                      value={crawlerConfig.cache_mode}
                      onValueChange={(value: CacheMode) =>
                        setCrawlerConfig({...crawlerConfig, cache_mode: value})
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select cache mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={CacheMode.ENABLED}>Enabled</SelectItem>
                        <SelectItem value={CacheMode.DISABLED}>Disabled</SelectItem>
                        <SelectItem value={CacheMode.BYPASS}>Bypass</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="word-threshold">Word Count Threshold</Label>
                    <Input
                      id="word-threshold"
                      type="number"
                      min="0"
                      value={crawlerConfig.word_count_threshold || 200}
                      onChange={(e) =>
                        setCrawlerConfig({...crawlerConfig, word_count_threshold: parseInt(e.target.value)})
                      }
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="browser" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Browser Configuration</CardTitle>
                <CardDescription>
                  Configure browser settings
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="browser-type">Browser Type</Label>
                    <Select
                      value={browserConfig.browser_type}
                      onValueChange={(value: BrowserType) =>
                        setBrowserConfig({...browserConfig, browser_type: value})
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select browser" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={BrowserType.CHROMIUM}>Chromium</SelectItem>
                        <SelectItem value={BrowserType.FIREFOX}>Firefox</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="viewport-width">Viewport Width</Label>
                    <Input
                      id="viewport-width"
                      type="number"
                      min="800"
                      max="1920"
                      value={browserConfig.viewport_width || 1080}
                      onChange={(e) =>
                        setBrowserConfig({...browserConfig, viewport_width: parseInt(e.target.value)})
                      }
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="headless"
                      checked={browserConfig.headless || false}
                      onChange={(e) =>
                        setBrowserConfig({...browserConfig, headless: e.target.checked})
                      }
                      className="rounded border-gray-300"
                    />
                    <Label htmlFor="headless" className="!m-0">Headless Mode</Label>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <div className="flex justify-end space-x-4">
            <Button type="button" variant="outline" asChild>
              <Link href="/crawlers">Cancel</Link>
            </Button>
            <Button
              type="button"
              onClick={startCrawl}
              disabled={isCrawling || !urls[0]}
              className="min-w-[150px]"
            >
              <Play className="mr-2 h-4 w-4" />
              {isCrawling ? 'Crawling...' : 'Start Crawl'}
            </Button>
          </div>
        </form>
      </Tabs>
    </div>
  );
}
