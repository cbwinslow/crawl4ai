'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Plus, Search, RefreshCw, StopCircle, MoreHorizontal } from 'lucide-react';
import Link from 'next/link';

interface CrawlerJob {
  id: string;
  status: string;
  url: string;
  created_at: string;
  s3_key?: string;
}

export default function CrawlersPage() {
  const [jobs, setJobs] = useState<CrawlerJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchJobs();
  }, []);

  const fetchJobs = async () => {
    try {
      setLoading(true);
      const response = await fetch('http://localhost:11235/crawl/jobs');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setJobs(data.jobs || []);
    } catch (error) {
      console.error('Error fetching jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredJobs = jobs.filter(job =>
    job.url.toLowerCase().includes(searchTerm.toLowerCase()) ||
    job.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusVariant = (status: string) => {
    switch (status.toLowerCase()) {
      case 'running':
      case 'processing':
        return 'default';
      case 'completed':
        return 'secondary';
      case 'failed':
      case 'cancelled':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const cancelJob = async (jobId: string) => {
    try {
      const response = await fetch(`http://localhost:11235/crawl/jobs/${jobId}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        fetchJobs(); // Refresh list
      }
    } catch (error) {
      console.error('Error cancelling job:', error);
    }
  };

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
    );
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
          <Link href="/crawlers/new">
            <Plus className="mr-2 h-4 w-4" /> New Job
          </Link>
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
                  <Link href="/crawlers/new">
                    <Plus className="mr-2 h-4 w-4" />
                    Create Job
                  </Link>
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
  );
}
