import { z } from 'zod';
import { 
  BrowserType, 
  BrowserMode, 
  CacheMode,
  type BrowserConfig,
  type CrawlerRunConfig,
  type LLMConfig
} from '@/types/crawl4ai';

// Helper schemas
const urlSchema = z.string().url('Invalid URL format');

const proxyConfigSchema = z.object({
  server: z.string(),
  username: z.string().optional(),
  password: z.string().optional(),
  ip: z.string().ip().optional(),
});

const browserConfigSchema: z.ZodType<Partial<BrowserConfig>> = z.object({
  browser_type: z.nativeEnum(BrowserType).optional(),
  headless: z.boolean().optional(),
  browser_mode: z.nativeEnum(BrowserMode).optional(),
  use_managed_browser: z.boolean().optional(),
  cdp_url: z.string().url().optional(),
  use_persistent_context: z.boolean().optional(),
  user_data_dir: z.string().optional(),
  chrome_channel: z.string().optional(),
  channel: z.string().optional(),
  proxy: z.string().optional(),
  proxy_config: proxyConfigSchema.optional(),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).optional(),
  viewport_width: z.number().int().positive().optional(),
  viewport_height: z.number().int().positive().optional(),
  accept_downloads: z.boolean().optional(),
  downloads_path: z.string().optional(),
  ignore_https_errors: z.boolean().optional(),
  java_script_enabled: z.boolean().optional(),
  cookies: z.array(z.any()).optional(),
  headers: z.record(z.string()).optional(),
  user_agent: z.string().optional(),
  user_agent_mode: z.string().optional(),
  user_agent_generator_config: z.record(z.unknown()).optional(),
  text_mode: z.boolean().optional(),
  light_mode: z.boolean().optional(),
  extra_args: z.array(z.string()).optional(),
  debugging_port: z.number().int().positive().optional(),
  host: z.string().optional(),
  enable_stealth: z.boolean().optional(),
  sleep_on_close: z.boolean().optional(),
  verbose: z.boolean().optional(),
});

const crawlerRunConfigSchema: z.ZodType<Partial<CrawlerRunConfig>> = z.object({
  word_count_threshold: z.number().int().nonnegative().optional(),
  only_text: z.boolean().optional(),
  css_selector: z.string().optional(),
  target_elements: z.array(z.string()).optional(),
  excluded_tags: z.array(z.string()).optional(),
  excluded_selector: z.string().optional(),
  keep_data_attributes: z.boolean().optional(),
  keep_attrs: z.array(z.string()).optional(),
  remove_forms: z.boolean().optional(),
  prettify: z.boolean().optional(),
  parser_type: z.string().optional(),
  proxy_config: proxyConfigSchema.optional(),
  cache_mode: z.nativeEnum(CacheMode).optional(),
  session_id: z.string().optional(),
  bypass_cache: z.boolean().optional(),
  disable_cache: z.boolean().optional(),
  no_cache_read: z.boolean().optional(),
  no_cache_write: z.boolean().optional(),
  shared_data: z.record(z.unknown()).optional(),
  wait_until: z.string().optional(),
  page_timeout: z.number().int().positive().optional(),
  wait_for: z.string().optional(),
  wait_for_timeout: z.number().int().positive().optional(),
  wait_for_images: z.boolean().optional(),
  delay_before_return_html: z.number().int().nonnegative().optional(),
  mean_delay: z.number().int().nonnegative().optional(),
  max_range: z.number().int().positive().optional(),
  semaphore_count: z.number().int().positive().optional(),
  js_code: z.union([z.string(), z.array(z.string())]).optional(),
  c4a_script: z.union([z.string(), z.array(z.string())]).optional(),
  js_only: z.boolean().optional(),
  ignore_body_visibility: z.boolean().optional(),
  scan_full_page: z.boolean().optional(),
  scroll_delay: z.number().int().nonnegative().optional(),
  max_scroll_steps: z.number().int().nonnegative().optional(),
  process_iframes: z.boolean().optional(),
  remove_overlay_elements: z.boolean().optional(),
  simulate_user: z.boolean().optional(),
  override_navigator: z.boolean().optional(),
  magic: z.boolean().optional(),
  adjust_viewport_to_content: z.boolean().optional(),
  screenshot: z.boolean().optional(),
  screenshot_wait_for: z.number().int().nonnegative().optional(),
  screenshot_height_threshold: z.number().int().nonnegative().optional(),
  pdf: z.boolean().optional(),
  capture_mhtml: z.boolean().optional(),
  image_description_min_word_threshold: z.number().int().nonnegative().optional(),
  image_score_threshold: z.number().int().nonnegative().optional(),
  table_score_threshold: z.number().int().nonnegative().optional(),
  exclude_external_images: z.boolean().optional(),
  exclude_all_images: z.boolean().optional(),
  exclude_social_media_domains: z.array(z.string()).optional(),
  exclude_external_links: z.boolean().optional(),
  exclude_social_media_links: z.boolean().optional(),
  exclude_domains: z.array(z.string()).optional(),
  exclude_internal_links: z.boolean().optional(),
  score_links: z.boolean().optional(),
  verbose: z.boolean().optional(),
  log_console: z.boolean().optional(),
  capture_network_requests: z.boolean().optional(),
  capture_console_messages: z.boolean().optional(),
  method: z.string().optional(),
  stream: z.boolean().optional(),
  url: z.string().url().optional(),
  check_robots_txt: z.boolean().optional(),
  user_agent: z.string().optional(),
  user_agent_mode: z.string().optional(),
  user_agent_generator_config: z.record(z.unknown()).optional(),
});

const llmConfigSchema: z.ZodType<Partial<LLMConfig>> = z.object({
  provider: z.string().optional(),
  api_token: z.string().optional(),
  base_url: z.string().url().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  stop: z.array(z.string()).optional(),
  n: z.number().int().positive().optional(),
});

// Main crawl request schema
export const crawlRequestSchema = z.object({
  url: urlSchema,
  config: crawlerRunConfigSchema.optional(),
  browser_config: browserConfigSchema.optional(),
  llm_config: llmConfigSchema.optional(),
});

// Type inference for TypeScript
export type CrawlRequestInput = z.infer<typeof crawlRequestSchema>;

// Validation function
export function validateCrawlRequest(data: unknown): { success: boolean; data?: CrawlRequestInput; error?: string } {
  const result = crawlRequestSchema.safeParse(data);
  if (!result.success) {
    return {
      success: false,
      error: result.error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ')
    };
  }
  return { success: true, data: result.data };
}

// Status check schema
export const statusCheckSchema = z.object({
  job_id: z.string().uuid('Invalid job ID format'),
});

export type StatusCheckInput = z.infer<typeof statusCheckSchema>;

export function validateStatusCheck(data: unknown): { success: boolean; data?: StatusCheckInput; error?: string } {
  const result = statusCheckSchema.safeParse(data);
  if (!result.success) {
    return {
      success: false,
      error: result.error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ')
    };
  }
  return { success: true, data: result.data };
}
