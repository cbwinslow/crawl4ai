// Mock environment variables
process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
process.env.GITHUB_TOKEN = 'test-token';

// Mock the Prisma client
jest.mock('../../src/app/_lib/prisma', () => {
  const mockPrisma = {
    webhookEvent: {
      create: jest.fn().mockResolvedValue({ id: 'test-id' }),
    },
  };
  return mockPrisma;
});

// Mock the crypto module for webhook signature verification
jest.mock('crypto', () => ({
  createHmac: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  digest: jest.fn().mockReturnValue('mocked-signature'),
}));

// Mock the Octokit client
jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    rest: {
      issues: {
        createComment: jest.fn().mockResolvedValue({}),
      },
    },
  })),
}));

// Mock the RateLimiter
jest.mock('rate-limiter-flexible', () => ({
  RateLimiterMemory: jest.fn().mockImplementation(() => ({
    consume: jest.fn().mockResolvedValue(true),
    get: jest.fn().mockResolvedValue({ remainingPoints: 100 }),
  })),
}));
