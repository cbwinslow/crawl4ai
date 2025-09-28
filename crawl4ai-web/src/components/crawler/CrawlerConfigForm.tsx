'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Save, Play } from 'lucide-react';
import { AVAILABLE_CRAWLERS, type CrawlerType } from '@/config/crawlers';
import { useCrawlers } from '@/hooks/useCrawlers';

type CrawlerConfigFormProps = {
  crawlerId: string;
  onSuccess?: () => void;
};\n
export function CrawlerConfigForm({ crawlerId, onSuccess }: CrawlerConfigFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { executeCrawler } = useCrawlers();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  const crawler = AVAILABLE_CRAWLERS[crawlerId as CrawlerType];
  
  if (!crawler) {
    return (
      <div className="container mx-auto py-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900">Crawler not found</h2>
          <p className="mt-2 text-gray-600">The requested crawler could not be found.</p>
        </div>
      </div>
    );
  }

  // Create form schema based on crawler parameters
  const formSchema = z.object(
    crawler.parameters.reduce((schema, param) => {
      let validator = z.any();
      
      switch (param.type) {
        case 'string':
          validator = z.string();
          break;
        case 'number':
          validator = z.coerce.number();
          break;
        case 'boolean':
          validator = z.boolean();
          break;
      }
      
      if (param.required) {
        validator = validator.min(1, { message: 'This field is required' });
      } else {
        validator = validator.optional();
      }
      
      return { ...schema, [param.name]: validator };
    }, {} as Record<string, z.ZodTypeAny>)
  );

  type FormValues = z.infer<typeof formSchema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: crawler.parameters.reduce((defaults, param) => {
      let value: any = '';
      
      switch (param.type) {
        case 'boolean':
          value = false;
          break;
        case 'number':
          value = 0;
          break;
      }
      
      return { ...defaults, [param.name]: value };
    }, {} as Record<string, any>)
  });

  const onSubmit = async (data: FormValues) => {
    try {
      setIsSubmitting(true);
      // In a real app, you would save the crawler configuration
      // For now, we'll just show a success message
      toast({
        title: 'Configuration saved',
        description: 'Crawler configuration has been saved successfully.',
      });
      
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      console.error('Error saving crawler configuration:', error);
      toast({
        title: 'Error',
        description: 'Failed to save crawler configuration.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExecute = async () => {
    try {
      setIsExecuting(true);
      const values = form.getValues();
      
      const result = await executeCrawler.mutateAsync({
        crawlerId,
        params: values,
      });
      
      toast({
        title: 'Crawler started',
        description: 'The crawler has been started successfully.',
      });
      
      // Navigate to the jobs page or show the result
      router.push(`/crawlers/jobs/${Date.now()}`);
    } catch (error) {
      console.error('Error executing crawler:', error);
      toast({
        title: 'Error',
        description: 'Failed to start the crawler.',
        variant: 'destructive',
      });
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Configure {crawler.name}</CardTitle>
          <CardDescription>{crawler.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {crawler.parameters.map((param) => (
                <FormField
                  key={param.name}
                  control={form.control}
                  name={param.name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {param.name}
                        {param.required && <span className="text-red-500 ml-1">*</span>}
                      </FormLabel>
                      <FormDescription>{param.description}</FormDescription>
                      <FormControl>
                        {param.type === 'boolean' ? (
                          <div className="flex items-center space-x-2">
                            <Switch
                              id={param.name}
                              checked={field.value as boolean}
                              onCheckedChange={field.onChange}
                            />
                            <label
                              htmlFor={param.name}
                              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                            >
                              {field.value ? 'Enabled' : 'Disabled'}
                            </label>
                          </div>
                        ) : param.type === 'number' ? (
                          <Input
                            type="number"
                            placeholder={param.name}
                            required={param.required}
                            {...field}
                            value={field.value as number}
                            onChange={(e) => field.onChange(e.target.valueAsNumber)}
                          />
                        ) : (
                          <Input
                            placeholder={param.name}
                            required={param.required}
                            {...field}
                            value={field.value as string}
                          />
                        )}
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
              
              <div className="flex justify-end space-x-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push('/crawlers')}
                  disabled={isSubmitting || isExecuting}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleExecute}
                  disabled={isSubmitting || isExecuting}
                >
                  {isExecuting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Running...
                    </>
                  ) : (
                    <>
                      <Play className="mr-2 h-4 w-4" />
                      Run Now
                    </>
                  )}
                </Button>
                <Button type="submit" disabled={isSubmitting || isExecuting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save Configuration
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
