import { RateLimiterMemory } from 'rate-limiter-flexible';

// Rate limiting configuration
const rateLimiter = new RateLimiterMemory({
  points: 100, // 100 requests
  duration: 60, // per 60 seconds per IP
  blockDuration: 60 * 15, // Block for 15 minutes if limit is exceeded
});

export async function rateLimit(ip: string): Promise<{ allowed: boolean; headers: Record<string, string>; error?: string }> {
  try {
    const res = await rateLimiter.consume(ip);
    const headers = {
      'Retry-After': String(res.msBeforeNext / 1000),
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Remaining': String(res.remainingPoints),
      'X-RateLimit-Reset': new Date(Date.now() + res.msBeforeNext).toISOString(),
    };
    
    return {
      allowed: true,
      headers,
    };
  } catch (error) {
    const rateLimitError = error as { msBeforeNext: number };
    const headers = {
      'Retry-After': String(rateLimitError.msBeforeNext / 1000),
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': new Date(Date.now() + rateLimitError.msBeforeNext).toISOString(),
    };
    
    return {
      allowed: false,
      headers,
      error: 'Too Many Requests',
    };
  }
}

export function getClientIp(request: Request): string {
  // Get the client IP from the X-Forwarded-For header (common in proxy setups)
  const xForwardedFor = request.headers.get('x-forwarded-for');
  if (xForwardedFor) {
    return xForwardedFor.split(',')[0].trim();
  }
  
  // Fallback to the remote address
  const remoteAddress = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-host');
  if (remoteAddress) {
    return remoteAddress;
  }
  
  // Last resort, use a default value (not ideal for production)
  return 'unknown';
}
