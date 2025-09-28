// Core crawl4ai TypeScript types for web interface integration

// Enum types
export enum CacheMode {
  ENABLED = "enabled",
  DISABLED = "disabled",
  BYPASS = "bypass",
  READ_ONLY = "read_only",
  WRITE_ONLY = "write_only"
}

export enum BrowserType {
  CHROMIUM = "chromium",
  FIREFOX = "firefox",
  WEBKIT = "webkit"
}

export enum BrowserMode {
  BUILTIN = "builtin",
  DEDICATED = "dedicated",
  CDP = "cdp",
  DOCKER = "docker",
  CUSTOM = "custom"
}

export enum MatchMode {
  OR = "or",
  AND = "and"
}

// Generic types for extensibility
export interface SerializableObject {
  [key: string]: unknown;
}

export interface Cookie {
  name: string;
  value: string;
  url?: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

// Configuration interfaces
export interface GeolocationConfig {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
  ip?: string;
}

export interface BrowserConfig {
  browser_type?: BrowserType;
  headless?: boolean;
  browser_mode?: BrowserMode;
  use_managed_browser?: boolean;
  cdp_url?: string;
  use_persistent_context?: boolean;
  user_data_dir?: string;
  chrome_channel?: string;
  channel?: string;
  proxy?: string;
  proxy_config?: ProxyConfig;
  viewport_width?: number;
  viewport_height?: number;
  viewport?: { width: number; height: number };
  accept_downloads?: boolean;
  downloads_path?: string;
  storage_state?: SerializableObject;
  ignore_https_errors?: boolean;
  java_script_enabled?: boolean;
  cookies?: Cookie[];
  headers?: Record<string, string>;
  user_agent?: string;
  user_agent_mode?: string;
  user_agent_generator_config?: Record<string, unknown>;
  text_mode?: boolean;
  light_mode?: boolean;
  extra_args?: string[];
  debugging_port?: number;
  host?: string;
  enable_stealth?: boolean;
  sleep_on_close?: boolean;
  verbose?: boolean;
}

export interface VirtualScrollConfig {
  container_selector: string;
  scroll_count?: number;
  scroll_by?: string | number;
  wait_after_scroll?: number;
}

export interface LinkPreviewConfig {
  include_internal?: boolean;
  include_external?: boolean;
  include_patterns?: string[];
  exclude_patterns?: string[];
  concurrency?: number;
  timeout?: number;
  max_links?: number;
  query?: string;
  score_threshold?: number;
  verbose?: boolean;
}

export interface HTTPCrawlerConfig {
  method?: string;
  headers?: Record<string, string>;
  data?: Record<string, unknown>;
  json?: Record<string, unknown>;
  follow_redirects?: boolean;
  verify_ssl?: boolean;
}

export interface CrawlerRunConfig {
  // Content Processing Parameters
  word_count_threshold?: number;
  extraction_strategy?: SerializableObject;
  chunking_strategy?: SerializableObject;
  markdown_generator?: SerializableObject;
  only_text?: boolean;
  css_selector?: string;
  target_elements?: string[];
  excluded_tags?: string[];
  excluded_selector?: string;
  keep_data_attributes?: boolean;
  keep_attrs?: string[];
  remove_forms?: boolean;
  prettiify?: boolean;
  parser_type?: string;
  scraping_strategy?: SerializableObject;
  proxy_config?: ProxyConfig;
  proxy_rotation_strategy?: SerializableObject;

  // Browser Location and Identity Parameters
  locale?: string;
  timezone_id?: string;
  geolocation?: GeolocationConfig;

  // SSL Parameters
  fetch_ssl_certificate?: boolean;

  // Caching Parameters
  cache_mode?: CacheMode;
  session_id?: string;
  bypass_cache?: boolean;
  disable_cache?: boolean;
  no_cache_read?: boolean;
  no_cache_write?: boolean;
  shared_data?: Record<string, unknown>;

  // Page Navigation and Timing Parameters
  wait_until?: string;
  page_timeout?: number;
  wait_for?: string;
  wait_for_timeout?: number;
  wait_for_images?: boolean;
  delay_before_return_html?: number;
  mean_delay?: number;
  max_range?: number;
  semaphore_count?: number;

  // Page Interaction Parameters
  js_code?: string | string[];
  c4a_script?: string | string[];
  js_only?: boolean;
  ignore_body_visibility?: boolean;
  scan_full_page?: boolean;
  scroll_delay?: number;
  max_scroll_steps?: number;
  process_iframes?: boolean;
  remove_overlay_elements?: boolean;
  simulate_user?: boolean;
  override_navigator?: boolean;
  magic?: boolean;
  adjust_viewport_to_content?: boolean;

  // Media Handling Parameters
  screenshot?: boolean;
  screenshot_wait_for?: number;
  screenshot_height_threshold?: number;
  pdf?: boolean;
  capture_mhtml?: boolean;
  image_description_min_word_threshold?: number;
  image_score_threshold?: number;
  table_score_threshold?: number;
  table_extraction?: SerializableObject;
  exclude_external_images?: boolean;
  exclude_all_images?: boolean;

  // Link and Domain Handling Parameters
  exclude_social_media_domains?: string[];
  exclude_external_links?: boolean;
  exclude_social_media_links?: boolean;
  exclude_domains?: string[];
  exclude_internal_links?: boolean;
  score_links?: boolean;

  // Debugging and Logging Parameters
  verbose?: boolean;
  log_console?: boolean;

  // Network and Console Capturing Parameters
  capture_network_requests?: boolean;
  capture_console_messages?: boolean;

  // Connection Parameters
  method?: string;
  stream?: boolean;
  url?: string;
  check_robots_txt?: boolean;
  user_agent?: string;
  user_agent_mode?: string;
  user_agent_generator_config?: Record<string, unknown>;

  // Deep Crawl Parameters
  deep_crawl_strategy?: SerializableObject;

  // Link Extraction Parameters
  link_preview_config?: LinkPreviewConfig;

  // Virtual Scroll Parameters
  virtual_scroll_config?: VirtualScrollConfig;

  // URL Matching Parameters
  url_matcher?: string | ((url: string) => boolean) | Array<string | ((url: string) => boolean)>;
  match_mode?: MatchMode;

  // Experimental Parameters
  experimental?: Record<string, unknown>;
}

export interface LLMConfig {
  provider?: string;
  api_token?: string;
  base_url?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string[];
  n?: number;
}

export interface SeedingConfig {
  source?: string;
  pattern?: string;
  live_check?: boolean;
  extract_head?: boolean;
  max_urls?: number;
  concurrency?: number;
  hits_per_sec?: number;
  force?: boolean;
  base_directory?: string;
  llm_config?: LLMConfig;
  verbose?: boolean;
  query?: string;
  score_threshold?: number;
  scoring_method?: string;
  filter_nonsense_urls?: boolean;
}

// Result interfaces
export interface MarkdownGenerationResult {
  raw_markdown: string;
  fit_markdown?: string;
  markdown?: string;
  images?: SerializableObject[];
  links?: SerializableObject[];
  metadata?: Record<string, unknown>;
}

export interface MediaResult {
  images?: SerializableObject[];
  videos?: SerializableObject[];
  audios?: SerializableObject[];
  tables?: SerializableObject[];
  links?: SerializableObject[];
}

export interface CrawlResult {
  url: string;
  html: string;
  fit_html?: string;
  cleaned_html?: string;
  markdown?: MarkdownGenerationResult;
  media?: MediaResult;
  tables?: SerializableObject[];
  links?: SerializableObject[];
  metadata?: Record<string, unknown>;
  screenshot?: string;
  pdf?: string;
  extracted_content?: string;
  success: boolean;
  status_code?: number;
  error_message?: string;
  response_headers?: Record<string, string>;
  redirected_url?: string;
  downloaded_files?: SerializableObject[];
  js_execution_result?: SerializableObject;
  mhtml?: string;
  ssl_certificate?: SerializableObject;
  network_requests?: SerializableObject[];
  console_messages?: SerializableObject[];
  session_id?: string;
  dispatch_result?: SerializableObject;
}

export interface CrawlResultContainer {
  result: CrawlResult;
}

// RunManyReturn is a type alias for CrawlResult array
export type RunManyReturn = CrawlResult[];

// API Request/Response interfaces
export interface CrawlRequest {
  url: string;
  config?: CrawlerRunConfig;
  browser_config?: BrowserConfig;
  llm_config?: LLMConfig;
}

export interface CrawlResponse {
  success: boolean;
  data?: CrawlResult;
  error?: string;
}

export interface BatchCrawlRequest {
  urls: string[];
  config?: CrawlerRunConfig;
  browser_config?: BrowserConfig;
  llm_config?: LLMConfig;
}

export interface BatchCrawlResponse {
  success: boolean;
  data?: CrawlResult[];
  errors?: Array<{ url: string; error: string }>;
}

export interface CrawlStatusResponse {
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number;
  current_url?: string;
  results?: CrawlResult[];
  error?: string;
}

export interface ExportRequest {
  format: 'json' | 'csv' | 'pdf';
  data: CrawlResult | CrawlResult[];
  filename?: string;
}

export interface ExportResponse {
  success: boolean;
  download_url?: string;
  error?: string;
}

// Component prop interfaces
export interface CrawlerInterfaceProps {
  initialUrl?: string;
  onCrawlStart?: (request: CrawlRequest) => void;
  onCrawlComplete?: (response: CrawlResponse) => void;
}

export interface ConfigurationPanelProps {
  config: Partial<CrawlerRunConfig>;
  onConfigChange: (config: Partial<CrawlerRunConfig>) => void;
  title: string;
}

export interface ResultDisplayProps {
  result: CrawlResult;
  onExport?: (format: 'json' | 'csv' | 'pdf') => void;
}

export interface ProgressTrackerProps {
  status: CrawlStatusResponse;
  onCancel?: () => void;
}

// Utility types
export type UrlMatcher = string | ((url: string) => boolean) | Array<string | ((url: string) => boolean)>;

export interface ValidationError {
  field: string;
  message: string;
}

export interface FormState<T> {
  data: T;
  errors: ValidationError[];
  isSubmitting: boolean;
  isDirty: boolean;
}
