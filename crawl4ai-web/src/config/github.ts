// GitHub App Configuration
export const githubConfig = {
  // Webhook secret - make sure this matches what you set in GitHub App settings
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || 'your-webhook-secret-here',

  // GitHub App credentials (for webhooks and API access)
  appId: process.env.GITHUB_APP_ID || 'your-app-id',
  privateKey: process.env.GITHUB_PRIVATE_KEY || 'your-private-key',

  // OAuth settings (for user authentication)
  clientId: process.env.GITHUB_ID || 'your-oauth-client-id',
  clientSecret: process.env.GITHUB_SECRET || 'your-oauth-client-secret',

  // Installation settings (if using GitHub App)
  installationId: process.env.GITHUB_INSTALLATION_ID || 'your-installation-id',

  // API Token (Personal Access Token or GitHub App token)
  token: process.env.GITHUB_TOKEN || 'your-github-token',

  // Webhook events to subscribe to
  events: [
    'push',
    'pull_request',
    'pull_request_review',
    'issues',
    'issue_comment',
    'deployment_status',
    'workflow_run',
    'release',
    'deployment'
  ],

  // Base URL for GitHub API
  baseUrl: process.env.GITHUB_API_URL || 'https://api.github.com',

  // Enterprise GitHub (if applicable)
  enterprise: process.env.GITHUB_ENTERPRISE_URL || null
} as const;

export default githubConfig;
