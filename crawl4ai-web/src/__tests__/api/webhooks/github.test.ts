// Import the webhook handler directly
import { POST } from '../../../../src/app/api/webhooks/github/route';
// Import the mocked prisma client
import prisma from '@/app/_lib/prisma';
// Import the mocked crypto module
import crypto from 'crypto';

// Setup mocks
jest.mock('crypto');

// Mock the NextResponse
const mockNextResponse = {
  json: jest.fn().mockReturnThis(),
  status: jest.fn().mockReturnThis(),
};

// Mock the route module
jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn().mockImplementation((data) => ({
      ...mockNextResponse,
      ...data,
    })),
  },
}));

// Setup environment variables
process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
process.env.GITHUB_TOKEN = 'test-token';

// Helper to create a mock request
const createRequest = (event: string, payload: any, signature?: string) => {
  const headers = new Headers();
  headers.set('x-github-event', event);
  headers.set('x-github-delivery', 'test-delivery-id');
  if (signature) {
    headers.set('x-hub-signature-256', signature);
  }
  
  return new Request('http://localhost/api/webhooks/github', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
};

// Mock the crypto functions
const mockCreateHmac = jest.fn().mockReturnValue({
  update: jest.fn().mockReturnThis(),
  digest: jest.fn().mockReturnValue('mocked-signature'),
});

(crypto.createHmac as jest.Mock) = mockCreateHmac;

describe('GitHub Webhook Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should handle ping event', async () => {
    const request = createRequest('ping', { zen: 'Test zen message' }, 'sha256=mocked-signature');
    const response = await POST(request);
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('status', 'processed');
    expect(data).toHaveProperty('event', 'ping');
  });

  it('should validate webhook signature', async () => {
    const request = createRequest('ping', { zen: 'Test' }, 'sha256=mocked-signature');
    const response = await POST(request);
    
    expect(response.status).toBe(200);
    expect(mockCrypto.createHmac).toHaveBeenCalledWith('sha256', 'test-secret');
  });

  it('should handle push event', async () => {
    // Mock the prisma response
    (prisma.webhookEvent.create as jest.Mock).mockResolvedValueOnce({ id: 'test-event-id' });
    
    const pushPayload = {
      ref: 'refs/heads/main',
      repository: {
        id: 123,
        name: 'test-repo',
        full_name: 'test-org/test-repo',
        private: false,
        owner: {
          login: 'test-user',
          id: 456,
        },
      },
      sender: {
        login: 'test-user',
        id: 456,
      },
      commits: [
        {
          id: 'abc123',
          message: 'Test commit',
        },
      ],
    };

    const request = createRequest('push', pushPayload, 'sha256=mocked-signature');
    const response = await POST(request);
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.event).toBe('push');
    expect(prisma.webhookEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event: 'push',
        repositoryName: 'test-org/test-repo',
        status: 'processed',
      }),
    });
  });

  it('should handle pull request event', async () => {
    // Mock the prisma response
    (prisma.webhookEvent.create as jest.Mock).mockResolvedValueOnce({ id: 'test-event-id' });
    
    const prPayload = {
      action: 'opened',
      number: 1,
      pull_request: {
        id: 123,
        number: 1,
        title: 'Test PR',
        user: {
          login: 'test-user',
          id: 456,
        },
        body: 'Test PR body',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        head: {
          ref: 'test-branch',
          sha: 'abc123',
        },
        base: {
          ref: 'main',
          sha: 'def456',
        },
      },
      repository: {
        id: 123,
        name: 'test-repo',
        full_name: 'test-org/test-repo',
        private: false,
        owner: {
          login: 'test-org',
          id: 789,
        },
      },
      sender: {
        login: 'test-user',
        id: 456,
      },
    };

    const request = createRequest('pull_request', prPayload, 'sha256=mocked-signature');
    const response = await POST(request);
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.event).toBe('pull_request');
    expect(prisma.webhookEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event: 'pull_request',
        action: 'opened',
        repositoryName: 'test-org/test-repo',
        status: 'processed',
      }),
    });
  });

  it('should return 400 for invalid JSON', async () => {
    const request = new Request('http://localhost/api/webhooks/github', {
      method: 'POST',
      headers: {
        'x-github-event': 'push',
        'x-github-delivery': 'test-delivery-id',
        'x-hub-signature-256': 'sha256=mocked-signature',
      },
      body: 'invalid-json',
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});
