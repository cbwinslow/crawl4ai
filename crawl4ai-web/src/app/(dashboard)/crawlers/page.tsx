'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, Play, Loader2, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useCrawlers } from '@/hooks/useCrawlers';
import { AVAILABLE_CRAWLERS, type CrawlerType } from '@/config/crawlers';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface CrawlerJob {
  id: string;
  crawlerId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  result?: any;
  error?: string;
}

export default function CrawlersPage() {
  const { listCrawlers, executeCrawler } = useCrawlers();
  const [jobs, setJobs] = useState<CrawlerJob[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('crawlers');
  const [isExecuting, setIsExecuting] = useState<Record<string, boolean>>({});

  const handleExecuteCrawler = async (crawlerId: string) => {
    try {
      setIsExecuting(prev => ({ ...prev, [crawlerId]: true }));
      
      const job: CrawlerJob = {
        id: Date.now().toString(),
        crawlerId,
        status: 'running',
        startedAt: new Date().toISOString(),
      };
      
      setJobs(prev => [job, ...prev]);
      
      const result = await executeCrawler.mutateAsync({
        crawlerId,
        params: { /* Default parameters can go here */ },
      });
      
      setJobs(prev => prev.map(j => 
        j.id === job.id 
          ? { ...j, status: 'completed', completedAt: new Date().toISOString(), result }
          : j
      ));
    } catch (error) {
      setJobs(prev => prev.map(j => 
        j.id === job.id 
          ? { 
              ...j, 
              status: 'failed', 
              completedAt: new Date().toISOString(),
              error: error instanceof Error ? error.message : 'Unknown error'
            }
          : j
      ));
    } finally {
      setIsExecuting(prev => ({ ...prev, [crawlerId]: false }));
    }
  };

  const filteredCrawlers = Object.values(AVAILABLE_CRAWLERS).filter(crawler =>
    crawler.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    crawler.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredJobs = jobs.filter(job =>
    job.crawlerId.toLowerCase().includes(searchTerm.toLowerCase()) ||
    job.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-500">Completed</Badge>;
      case 'running':
        return <Badge className="bg-blue-500">Running</Badge>;
      case 'failed':
        return <Badge className="bg-red-500">Failed</Badge>;
      default:
        return <Badge>Pending</Badge>;
    }
  };

  return (
    <div className="container mx-auto py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Crawlers</h1>
        <Link href="/crawlers/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Crawler
          </Button>
        </Link>
      </div>

      <Tabs defaultValue="crawlers" className="space-y-4">
        <TabsList>
          <TabsTrigger value="crawlers" onClick={() => setActiveTab('crawlers')}>
            Available Crawlers
          </TabsTrigger>
          <TabsTrigger value="jobs" onClick={() => setActiveTab('jobs')}>
            Job History
          </TabsTrigger>
        </TabsList>

        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={`Search ${activeTab === 'crawlers' ? 'crawlers' : 'jobs'}...`}
            className="pl-9 w-full sm:w-[300px] md:w-[400px]"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <TabsContent value="crawlers">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredCrawlers.map((crawler) => (
              <Card key={crawler.id} className="flex flex-col">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    {crawler.name}
                    <Badge variant="outline" className="ml-2">
                      {crawler.id}
                    </Badge>
                  </CardTitle>
                  <CardDescription>{crawler.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col">
                  <div className="mb-4">
                    <h4 className="text-sm font-medium mb-2">Parameters:</h4>
                    <div className="space-y-2">
                      {crawler.parameters.map((param) => (
                        <div key={param.name} className="text-sm">
                          <span className="font-mono font-medium">{param.name}</span>
                          <span className="text-muted-foreground">: {param.type}</span>
                          {param.required && (
                            <Badge variant="outline" className="ml-2 text-xs">
                              required
                            </Badge>
                          )}
                          <p className="text-xs text-muted-foreground">{param.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-auto pt-4">
                    <Button
                      className="w-full"
                      onClick={() => handleExecuteCrawler(crawler.id)}
                      disabled={isExecuting[crawler.id]}
                    >
                      {isExecuting[crawler.id] ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Running...
                        </>
                      ) : (
                        <>
                          <Play className="mr-2 h-4 w-4" />
                          Run Crawler
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="jobs">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Crawler</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredJobs.length > 0 ? (
                  filteredJobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="font-medium">
                        {job.id.slice(-8)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {AVAILABLE_CRAWLERS[job.crawlerId as CrawlerType]?.name || job.crawlerId}
                        </Badge>
                      </TableCell>
                      <TableCell>{getStatusBadge(job.status)}</TableCell>
                      <TableCell>
                        {new Date(job.startedAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {job.status === 'completed' && job.result && (
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/crawlers/jobs/${job.id}`}>
                              <ExternalLink className="h-4 w-4 mr-2" />
                              View Results
                            </Link>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No jobs found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

        const data = await response.json()
        setJobs(data.jobs || [])
      }
    } catch (error) {
      console.error('Error fetching jobs:', error)
    } finally {
      setLoading(false)
    }
  }

  const getStatusVariant = (status: string) => {
    switch (status.toLowerCase()) {
      case 'running':
      case 'processing':
        return 'default'
      case 'completed':
        return 'secondary'
      case 'failed':
      case 'cancelled':
        return 'destructive'
      default:
        return 'outline'
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString()
  }

  const cancelJob = async (jobId: string) => {
    try {
      const response = await fetch(`http://localhost:11235/crawl/jobs/${jobId}`, {
        method: 'DELETE'
      })
      if (response.ok) {
        fetchJobs() // Refresh list
      }
    } catch (error) {
      console.error('Error cancelling job:', error)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="h-8 w-48 bg-gray-200 animate-pulse rounded" />
            <div className="h-4 w-72 mt-2 bg-gray-200 animate-pulse rounded" />
          </div>
          <div className="h-10 w-32 bg-gray-200 animate-pulse rounded" />
        </div>
        <Card>
          <CardContent className="p-6 space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center space-x-4 p-4 border rounded-lg">
                <div className="h-12 w-12 bg-gray-200 animate-pulse rounded-full" />
                <div className="space-y-2">
                  <div className="h-4 w-48 bg-gray-200 animate-pulse rounded" />
                  <div className="h-4 w-32 bg-gray-200 animate-pulse rounded" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Active Jobs</h2>
          <p className="text-muted-foreground">
            Monitor and manage your crawling jobs
          </p>
        </div>
        <Button asChild>
          <a href="/crawlers/new">
            <Plus className="mr-2 h-4 w-4" /> New Job
          </a>
        </Button>
      </div>

      <Card>
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center space-x-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search jobs by URL or ID..."
                className="w-[300px] pl-8"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Button variant="outline" size="sm" className="h-9" onClick={fetchJobs}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
          <div className="text-sm text-muted-foreground">
            {jobs.length} total jobs
          </div>
        </div>
        <CardContent className="p-0">
          {filteredJobs.length === 0 ? (
            <div className="p-8 text-center">
              <Search className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold">No jobs found</h3>
              <p className="text-muted-foreground mt-2">
                {searchTerm ? 'Try adjusting your search terms.' : 'Get started by creating a new crawling job.'}
              </p>
              {!searchTerm && (
                <Button asChild className="mt-4">
                  <a href="/crawlers/new">
                    <Plus className="mr-2 h-4 w-4" />
                    Create Job
                  </a>
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>S3 Key</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredJobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="font-mono text-sm">{job.id}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(job.status)}>
                        {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate" title={job.url}>
                      {job.url}
                    </TableCell>
                    <TableCell className="text-sm">{formatDate(job.created_at)}</TableCell>
                    <TableCell className="text-sm font-mono">
                      {job.s3_key ? (
                        <a
                          href={`http://localhost:9001/bucket/crawl-results/object/${job.s3_key.replace('s3://crawl-results/', '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          {job.s3_key.split('/').pop()}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">No storage</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      {job.status.toLowerCase() === 'processing' && (
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => cancelJob(job.id)}
                          title="Cancel Job"
                        >
                          <StopCircle className="h-4 w-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" title="View Details">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
