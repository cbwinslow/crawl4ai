'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AVAILABLE_CRAWLERS } from '@/config/crawlers';
import { CrawlerConfigForm } from '@/components/crawler/CrawlerConfigForm';

export default function NewCrawlerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedCrawler, setSelectedCrawler] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const crawlerId = searchParams.get('crawler');
    if (crawlerId && AVAILABLE_CRAWLERS[crawlerId as keyof typeof AVAILABLE_CRAWLERS]) {
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

  if (!selectedCrawler) {
    return <CrawlerSelection onSelectCrawler={setSelectedCrawler} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center">
        <Button variant="ghost" size="icon" onClick={() => setSelectedCrawler(null)}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold">Configure Crawler</h1>
      </div>
      <CrawlerConfigForm 
        crawlerId={selectedCrawler} 
        onSuccess={() => router.push('/crawlers')}
      />
    </div>
  );
}

function CrawlerSelection({ onSelectCrawler }: { onSelectCrawler: (id: string) => void }) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredCrawlers = Object.values(AVAILABLE_CRAWLERS).filter(crawler =>
    crawler.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    crawler.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    crawler.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Select a Crawler</h1>
          <p className="text-muted-foreground">
            Choose a crawler to configure and run
          </p>
        </div>
      </div>

      <div className="relative">
        <Input
          placeholder="Search crawlers..."
          className="pl-9 w-full sm:w-[300px] md:w-[400px]"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredCrawlers.map((crawler) => (
          <Card 
            key={crawler.id} 
            className="cursor-pointer hover:bg-accent/50 transition-colors"
            onClick={() => onSelectCrawler(crawler.id)}
          >
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                {crawler.name}
                <Badge variant="outline">{crawler.id}</Badge>
              </CardTitle>
              <CardDescription>{crawler.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="text-sm font-medium">Parameters:</div>
                <div className="space-y-1">
                  {crawler.parameters.map((param) => (
                    <div key={param.name} className="text-sm">
                      <span className="font-mono">{param.name}</span>
                      <span className="text-muted-foreground">: {param.type}</span>
                      {param.required && (
                        <span className="text-red-500 ml-1">*</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
    verbose: true
  });

  const [llmConfig, setLlmConfig] = useState<Partial<LLMConfig>>({
    provider: "openai",
    temperature: 0.7,
    max_tokens: 1000
  });

  // Crawl state
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawlResult, setCrawlResult] = useState<CrawlResponse | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [crawlProgress, setCrawlProgress] = useState(0);

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
        urls: urls.filter(u => u.trim()), // Filter empty URLs
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
        // Poll for status updates
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

  // Export results
  const exportResults = async (format: 'json' | 'csv' | 'pdf') => {
    if (!crawlResult?.data) return;

    try {
      const response = await fetch('/api/crawl/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          format,
          data: crawlResult.data,
          filename: `${crawlerName || 'crawl'}_result`
        }),
      });

      const exportResult = await response.json();

      if (exportResult.success && exportResult.download_url) {
        // Trigger download
        const link = document.createElement('a');
        link.href = exportResult.download_url;
        link.download = exportResult.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (error) {
      console.error('Export error:', error);
    }
  };

  // Download from MinIO
  const downloadFromMinIO = async (s3Key: string) => {
    if (!s3Key) return;

    try {
      // For now, open MinIO console link. In production, proxy through backend
      const objectKey = s3Key.replace('s3://crawl-results/', '')
      window.open(`http://localhost:9001/bucket/crawl-results/object/${objectKey}`, '_blank')
    } catch (error) {
      console.error('Download error:', error)
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/crawlers">
            <ChevronLeft className="h-4 w-4" />
            <span className="sr-only">Back</span>
          </Link>
        </Button>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">New Crawler</h2>
          <p className="text-muted-foreground">
            Configure a new web crawler with crawl4ai integration
          </p>
        </div>
        {crawlResult && (
          <div className="ml-auto flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportResults('json')}
            >
              <Download className="mr-2 h-4 w-4" />
              Export JSON
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportResults('csv')}
            >
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
        )}
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
                {crawlResult.s3_key && (
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-base font-medium">MinIO Storage</Label>
                        <p className="text-sm text-blue-800 mt-1">{crawlResult.s3_key}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => downloadFromMinIO(crawlResult.s3_key!)}
                      >
                        View in MinIO
                      </Button>
                    </div>
                  </div>
                )}
                {crawlResult.data?.markdown?.raw_markdown && (
                  <div>
                    <Label className="text-base font-medium">Extracted Content</Label>
                    <div className="mt-2 p-4 bg-gray-50 rounded-lg max-h-64 overflow-y-auto">
                      <pre className="text-sm whitespace-pre-wrap">
                        {crawlResult.data.markdown.raw_markdown.substring(0, 1000)}
                        {crawlResult.data.markdown.raw_markdown.length > 1000 ? '...' : ''}
                      </pre>
                    </div>
                  </div>
                )}
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
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
          <TabsTrigger value="scheduling">Scheduling</TabsTrigger>
          <TabsTrigger value="processing">Processing</TabsTrigger>
          <TabsTrigger value="storage">Storage</TabsTrigger>
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
                <div className="space-y-2">
                  <Label htmlFor="description">Description (Optional)</Label>
                  <Textarea
                    id="description"
                    placeholder="What does this crawler do?"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="crawl4ai" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Crawl4AI Configuration</CardTitle>
                <CardDescription>
                  Configure crawl4ai-specific settings for content extraction and processing
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
                        <SelectItem value={CacheMode.READ_ONLY}>Read Only</SelectItem>
                        <SelectItem value={CacheMode.WRITE_ONLY}>Write Only</SelectItem>
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
                  <div className="space-y-2">
                    <Label htmlFor="wait-until">Wait Until</Label>
                    <Select
                      value={crawlerConfig.wait_until}
                      onValueChange={(value) =>
                        setCrawlerConfig({...crawlerConfig, wait_until: value})
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select wait condition" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="domcontentloaded">DOM Content Loaded</SelectItem>
                        <SelectItem value="load">Load</SelectItem>
                        <SelectItem value="networkidle">Network Idle</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="page-timeout">Page Timeout (ms)</Label>
                    <Input
                      id="page-timeout"
                      type="number"
                      min="1000"
                      value={crawlerConfig.page_timeout || 60000}
                      onChange={(e) =>
                        setCrawlerConfig({...crawlerConfig, page_timeout: parseInt(e.target.value)})
                      }
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="screenshot"
                      checked={crawlerConfig.screenshot || false}
                      onChange={(e) =>
                        setCrawlerConfig({...crawlerConfig, screenshot: e.target.checked})
                      }
                      className="rounded border-gray-300"
                    />
                    <Label htmlFor="screenshot" className="!m-0">Take Screenshot</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="pdf"
                      checked={crawlerConfig.pdf || false}
                      onChange={(e) =>
                        setCrawlerConfig({...crawlerConfig, pdf: e.target.checked})
                      }
                      className="rounded border-gray-300"
                    />
                    <Label htmlFor="pdf" className="!m-0">Generate PDF</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="verbose"
                      checked={crawlerConfig.verbose || false}
                      onChange={(e) =>
                        setCrawlerConfig({...crawlerConfig, verbose: e.target.checked})
                      }
                      className="rounded border-gray-300"
                    />
                    <Label htmlFor="verbose" className="!m-0">Verbose Logging</Label>
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
                  Configure browser settings for crawl4ai
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
                        <SelectItem value={BrowserType.WEBKIT}>WebKit</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="browser-mode">Browser Mode</Label>
                    <Select
                      value={browserConfig.browser_mode}
                      onValueChange={(value: BrowserMode) =>
                        setBrowserConfig({...browserConfig, browser_mode: value})
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={BrowserMode.DEDICATED}>Dedicated</SelectItem>
                        <SelectItem value={BrowserMode.BUILTIN}>Built-in</SelectItem>
                        <SelectItem value={BrowserMode.CDP}>CDP</SelectItem>
                        <SelectItem value={BrowserMode.DOCKER}>Docker</SelectItem>
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
                  <div className="space-y-2">
                    <Label htmlFor="viewport-height">Viewport Height</Label>
                    <Input
                      id="viewport-height"
                      type="number"
                      min="600"
                      max="1080"
                      value={browserConfig.viewport_height || 600}
                      onChange={(e) =>
                        setBrowserConfig({...browserConfig, viewport_height: parseInt(e.target.value)})
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
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="ignore-https-errors"
                      checked={browserConfig.ignore_https_errors || false}
                      onChange={(e) =>
                        setBrowserConfig({...browserConfig, ignore_https_errors: e.target.checked})
                      }
                      className="rounded border-gray-300"
                    />
                    <Label htmlFor="ignore-https-errors" className="!m-0">Ignore HTTPS Errors</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="java-script-enabled"
                      checked={browserConfig.java_script_enabled || false}
                      onChange={(e) =>
                        setBrowserConfig({...browserConfig, java_script_enabled: e.target.checked})
                      }
                      className="rounded border-gray-300"
                    />
                    <Label htmlFor="java-script-enabled" className="!m-0">Enable JavaScript</Label>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="advanced" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Advanced Settings</CardTitle>
                <CardDescription>
                  Configure advanced crawling options
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="max-depth">Max Depth</Label>
                    <Input id="max-depth" type="number" min="1" defaultValue="3" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="max-pages">Max Pages</Label>
                    <Input id="max-pages" type="number" min="1" defaultValue="1000" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="crawl-speed">Crawl Speed</Label>
                    <Select defaultValue="normal">
                      <SelectTrigger>
                        <SelectValue placeholder="Select speed" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="slow">Slow (be nice to servers)</SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="fast">Fast (use with caution)</SelectItem>
                        <SelectItem value="custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="parallel-requests">Parallel Requests</Label>
                    <Input id="parallel-requests" type="number" min="1" max="50" defaultValue="5" />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <input type="checkbox" id="respect-robots" className="rounded border-gray-300" defaultChecked />
                    <Label htmlFor="respect-robots" className="!m-0">Respect robots.txt</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <input type="checkbox" id="follow-sitemap" className="rounded border-gray-300" defaultChecked />
                    <Label htmlFor="follow-sitemap" className="!m-0">Follow sitemap.xml if available</Label>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="scheduling" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Scheduling</CardTitle>
                <CardDescription>
                  Configure when and how often the crawler should run
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Schedule Type</Label>
                  <Select defaultValue="manual">
                    <SelectTrigger>
                      <SelectValue placeholder="Select schedule" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Manual (run on demand)</SelectItem>
                      <SelectItem value="once">Run once at specific time</SelectItem>
                      <SelectItem value="recurring">Recurring schedule</SelectItem>
                      <SelectItem value="cron">Custom cron expression</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Start Date</Label>
                    <Input type="datetime-local" />
                  </div>
                  <div className="space-y-2">
                    <Label>Time Zone</Label>
                    <Select defaultValue="utc">
                      <SelectTrigger>
                        <SelectValue placeholder="Select timezone" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="utc">UTC</SelectItem>
                        <SelectItem value="local">Local Time</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="processing" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Content Processing</CardTitle>
                <CardDescription>
                  Configure how the crawler should process content
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Content Types to Extract</Label>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <input type="checkbox" id="extract-text" className="rounded border-gray-300" defaultChecked />
                      <Label htmlFor="extract-text" className="!m-0">Text content</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input type="checkbox" id="extract-images" className="rounded border-gray-300" defaultChecked />
                      <Label htmlFor="extract-images" className="!m-0">Images</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input type="checkbox" id="extract-pdfs" className="rounded border-gray-300" defaultChecked />
                      <Label htmlFor="extract-pdfs" className="!m-0">PDFs</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input type="checkbox" id="extract-media" className="rounded border-gray-300" />
                      <Label htmlFor="extract-media" className="!m-0">Audio/Video</Label>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="content-selectors">Content Selectors (CSS)</Label>
                  <Textarea 
                    id="content-selectors" 
                    placeholder="main, article, .content"
                    className="font-mono text-sm"
                  />
                  <p className="text-sm text-muted-foreground">
                    CSS selectors to extract content (one per line)
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="storage" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Storage & Output</CardTitle>
                <CardDescription>
                  Configure where and how to store the crawled data
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Output Format</Label>
                  <Select defaultValue="json">
                    <SelectTrigger>
                      <SelectValue placeholder="Select format" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="json">JSON</SelectItem>
                      <SelectItem value="csv">CSV</SelectItem>
                      <SelectItem value="markdown">Markdown</SelectItem>
                      <SelectItem value="sqlite">SQLite</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Storage Location</Label>
                  <Select defaultValue="local">
                    <SelectTrigger>
                      <SelectValue placeholder="Select storage" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="local">Local File System</SelectItem>
                      <SelectItem value="s3">AWS S3</SelectItem>
                      <SelectItem value="gcs">Google Cloud Storage</SelectItem>
                      <SelectItem value="azure">Azure Blob Storage</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="output-path">Output Path</Label>
                  <Input id="output-path" placeholder="/data/crawls/{name}_{timestamp}" />
                  <p className="text-sm text-muted-foreground">
                    Available variables: {'{name}, {timestamp}, {date}, {id}'}
                  </p>
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
  )
}
