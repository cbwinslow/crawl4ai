import { NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '../_lib/rate-limit';
import { z, ZodSchema } from 'zod';

type ValidationOptions = {
  schema?: ZodSchema;
  requireAuth?: boolean;
  rateLimit?: boolean;
};

export async function validateRequest(
  request: Request,
  options: ValidationOptions = {}
) {
  const { schema, requireAuth = false, rateLimit: shouldRateLimit = true } = options;
  const ip = getClientIp(request);

  // Handle rate limiting
  if (shouldRateLimit) {
    const rateLimitResult = await rateLimit(ip);
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests' },
        { 
          status: 429,
          headers: {
            ...rateLimitResult.headers,
            'Content-Type': 'application/json',
          },
        }
      );
    }
  }

  // Handle authentication
  if (requireAuth) {
    const authHeader = request.headers.get('authorization');
    const apiKey = authHeader?.split(' ')[1]; // Bearer <token>
    
    // Replace with your actual API key validation logic
    const isValidApiKey = await validateApiKey(apiKey);
    if (!isValidApiKey) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
  }

  // Handle request body validation if schema is provided
  if (schema && request.method !== 'GET') {
    try {
      const body = await request.json();
      const result = schema.safeParse(body);
      
      if (!result.success) {
        return NextResponse.json(
          { 
            success: false, 
            error: 'Validation error',
            details: result.error.errors.map(err => ({
              path: err.path.join('.'),
              message: err.message,
            })),
          },
          { status: 400 }
        );
      }

      // Return the parsed data to be used in the route handler
      return { success: true, data: result.data };
    } catch (error) {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }
  }

  // If no validation needed, return success
  return { success: true };
}

// Replace with your actual API key validation logic
async function validateApiKey(apiKey: string | undefined): Promise<boolean> {
  if (!apiKey) return false;
  
  // In a real application, you would validate against a database or auth service
  // This is a placeholder implementation
  return process.env.API_KEYS?.split(',').includes(apiKey) ?? false;
}
