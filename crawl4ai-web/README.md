# Crawl4AI Web

A web interface for Crawl4AI, featuring GitHub integration and webhook handling.

## Features

- GitHub webhook handler with event processing
- Rate limiting and request validation
- Event storage and metrics collection
- Support for GitHub push, pull request, issue, and comment events

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## GitHub Webhook Setup

1. **Configure Environment Variables**

   Create a `.env.local` file with the following variables:

   ```bash
   # Database
   DATABASE_URL="postgresql://user:password@localhost:5432/crawl4ai"
   
   # GitHub
   GITHUB_WEBHOOK_SECRET=your_webhook_secret
   GITHUB_TOKEN=your_github_token
   ```

2. **Run Database Migrations**

   ```bash
   npx prisma migrate dev --name init
   ```

3. **Set up GitHub Webhook**
   - Go to your GitHub repository settings
   - Navigate to Webhooks
   - Add a new webhook with the following settings:
     - Payload URL: `https://your-domain.com/api/webhooks/github`
     - Content type: `application/json`
     - Secret: Match your `GITHUB_WEBHOOK_SECRET`
     - Events: Select the events you want to receive

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

## API Endpoints

- `POST /api/webhooks/github` - GitHub webhook handler
  - Handles all GitHub webhook events
  - Validates webhook signatures
  - Processes events asynchronously
  - Returns 200 OK on success

## Database Schema

Webhook events are stored in the `WebhookEvent` table with the following schema:

```prisma
model WebhookEvent {
  id             String   @id @default(cuid())
  deliveryId     String   @unique
  event          String
  action         String?
  repositoryId   String?
  repositoryName String?
  senderId       String?
  senderLogin    String?
  status         String
  payload        Json
  processedAt    DateTime @default(now())
}
```

## Deployment

Deploy using [Vercel](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) or your preferred platform.
