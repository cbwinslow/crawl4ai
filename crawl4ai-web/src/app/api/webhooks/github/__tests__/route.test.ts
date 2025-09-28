import { NextRequest } from 'next/server';
import { POST } from '../route';
import prisma from '@/app/_lib/prisma';

// Mock the Prisma client
jest.mock('@/app/_lib/prisma', () => ({
  webhookEvent: {
    create: jest.fn().mockResolvedValue({ id: 'test-id' })
  }
}));

describe('GitHub Webhook Handler', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
    
    // Mock environment variables
    process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
  });

  it('should handle ping event', async () => {
    // Mock request with ping event
    const req = new NextRequest('http://localhost:3000/api/webhooks/github', {
      method: 'POST',
      headers: {
        'x-github-event': 'ping',
        'x-github-delivery': 'test-delivery-id',
        'x-hub-signature-256': 'sha256=test-signature'
      },
      body: JSON.stringify({
        zen: 'Test zen message',
        hook_id: 12345,
        hook: {
          type: 'Repository',
          id: 12345,
          active: true,
          events: ['push', 'pull_request'],
          config: {
            url: 'https://example.com/api/webhooks/github',
            content_type: 'json',
            secret: 'test-secret'
          },
          updated_at: '2023-01-01T00:00:00Z',
          created_at: '2023-01-01T00:00:00Z'
        },
        repository: {
          id: 12345,
          name: 'test-repo',
          full_name: 'test-org/test-repo',
          private: false,
          owner: {
            login: 'test-org',
            id: 12345,
            type: 'Organization'
          }
        },
        sender: {
          login: 'test-user',
          id: 12345,
          type: 'User'
        }
      })
    });

    // Mock crypto.createHmac to return a fixed signature
    const mockHmacUpdate = jest.fn().mockReturnThis();
    const mockHmacDigest = jest.fn().mockReturnValue('test-signature');
    jest.spyOn(require('crypto'), 'createHmac').mockImplementation(() => ({
      update: mockHmacUpdate,
      digest: mockHmacDigest
    }));

    // Call the handler
    const response = await POST(req);
    const data = await response.json();

    // Verify the response
    expect(response.status).toBe(200);
    expect(data).toEqual({ message: 'Ping received' });
    
    // Verify the webhook event was stored
    expect(prisma.webhookEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event: 'ping',
        deliveryId: 'test-delivery-id',
        status: 'processed'
      })
    });
  });

  // Add more test cases for other event types
});
