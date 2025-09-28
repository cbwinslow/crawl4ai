'use client';

import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CrawlerJob } from '@/types/crawler';

export default function JobDetailsPage() {
  const { jobId } = useParams<{ jobId: string }>();
  
  const { data: job, isLoading, error } = useQuery<CrawlerJob>({
    queryKey: ['job', jobId],
    queryFn: async () => {
      // In a real app, you would fetch the job details from your API
      // const response = await fetch(`/api/crawlers/jobs/${jobId}`);
      // if (!response.ok) throw new Error('Failed to fetch job');
      // return response.json();
      
      // Mock data for now
      return {
        id: jobId,
        crawlerId: 'amazon-product',
        status: 'completed',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        parameters: {
          url: 'https://www.amazon.com/dp/B08N5KWB9H',
          extract_price: true,
        },
        result: {
          product: {
            name: 'Test Amazon Product',
            price: '$19.99',
            description: 'This is a test product description.',
            url: 'https://www.amazon.com/dp/B08N5KWB9H',
          }
        }
      };
    }
  });

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

  if (isLoading) {
    return (
      <div className="container mx-auto py-6">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-gray-900"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto py-6">
        <div className="bg-red-50 border-l-4 border-red-500 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-red-700">
                Failed to load job details: {error.message}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="container mx-auto py-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900">Job not found</h2>
          <p className="mt-2 text-gray-600">The requested job could not be found.</p>
          <Link href="/crawlers" className="mt-4 inline-block">
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Crawlers
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Job Details</h1>
          <p className="text-muted-foreground">
            ID: {job.id}
          </p>
        </div>
        <Link href="/crawlers">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Crawlers
          </Button>
        </Link>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Results</span>
                {getStatusBadge(job.status)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {job.status === 'completed' && job.result ? (
                <div className="space-y-4">
                  <pre className="bg-muted p-4 rounded-md overflow-auto text-sm">
                    {JSON.stringify(job.result, null, 2)}
                  </pre>
                </div>
              ) : job.status === 'failed' ? (
                <div className="bg-red-50 border-l-4 border-red-500 p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <p className="text-sm text-red-700">
                        {job.error || 'An unknown error occurred during execution'}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-32">
                  <div className="animate-pulse text-muted-foreground">
                    {job.status === 'running' ? 'Job is running...' : 'Job is pending...'}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Job Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Crawler</h3>
                <p className="mt-1">{job.crawlerId}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Started</h3>
                <p className="mt-1">{new Date(job.startedAt).toLocaleString()}</p>
              </div>
              {job.completedAt && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground">Completed</h3>
                  <p className="mt-1">{new Date(job.completedAt).toLocaleString()}</p>
                </div>
              )}
              {job.parameters && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">Parameters</h3>
                  <div className="bg-muted p-3 rounded-md">
                    <pre className="text-xs overflow-auto">
                      {JSON.stringify(job.parameters, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
