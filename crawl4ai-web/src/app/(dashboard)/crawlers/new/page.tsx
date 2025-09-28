'use client';

import { useState } from "react";
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Plus, X, ChevronLeft, Play, Download, Eye } from "lucide-react"
import Link from "next/link"
import {
  CrawlerRunConfig,
  BrowserConfig,
  LLMConfig,
  CrawlRequest,
  CrawlResponse,
  CacheMode,
  BrowserType,
  BrowserMode
} from "@/types/crawl4ai"

export default function NewCrawlerPage() {
  // Form state
  const [crawlerName, setCrawlerName] = useState("");
  const [urls, setUrls] = useState<string[]>([""]);
  const [description, setDescription] = useState("");

  // Crawl4AI configuration state
  const [crawlerConfig, setCrawlerConfig] = useState<Partial<CrawlerRunConfig>>({
    cache_mode: CacheMode.BYPASS,
    verbose: true,
    screenshot: false,
    pdf: false,
    word_count_threshold: 200,
    wait_until: "domcontentloaded",
    page_timeout: 60000,
    semaphore_count: 5
  });

  const [browserConfig, setBrowserConfig] = useState<Partial<BrowserConfig>>({
    browser_type: BrowserType.CHROMIUM,
    headless: true,
    browser_mode: BrowserMode.DEDICATED,
    viewport_width: 1080,
    viewport_height: 600,
    ignore_https_errors: true,
    java_script_enabled: true,
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
      const crawlRequest: CrawlRequest = {
        url: urls[0],
        config: crawlerConfig,
        browser_config: browserConfig,
        llm_config: llmConfig
      };

      const response = await fetch('/api/crawl', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(crawlRequest),
      });

      const result: CrawlResponse = await response.json();

      if (result.success && result.job_id) {
        setCurrentJobId(result.job_id);
        // Poll for status updates
        pollCrawlStatus(result.job_id);
      } else {
        setCrawlResult(result);
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
        const response = await fetch(`/api/crawl/status?job_id=${jobId}`);
        const status = await response.json();

        if (status.success) {
          setCrawlProgress(status.progress || 0);

          if (status.status === 'completed') {
            setCrawlResult({ success: true, data: status.results?.[0] });
            clearInterval(pollInterval);
            setIsCrawling(false);
            setCurrentJobId(null);
          } else if (status.status === 'failed') {
            setCrawlResult({ success: false, error: status.error });
            clearInterval(pollInterval);
            setIsCrawling(false);
            setCurrentJobId(null);
          }
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
                  <Input id="name" placeholder="My Awesome Crawler" />
                </div>
                <div className="space-y-2">
                  <Label>Target URLs</Label>
                  <div className="space-y-2">
                    <div className="flex space-x-2">
                      <Input placeholder="https://example.com" />
                      <Button type="button" variant="outline" size="icon">
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary" className="flex items-center gap-1">
                        example.com
                        <button className="rounded-full hover:bg-muted p-0.5">
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description (Optional)</Label>
                  <Textarea id="description" placeholder="What does this crawler do?" />
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
            <Button type="button" variant="outline">
              Cancel
            </Button>
            <Button type="submit">
              Save & Start Crawler
            </Button>
          </div>
        </form>
      </Tabs>
    </div>
  )
}
