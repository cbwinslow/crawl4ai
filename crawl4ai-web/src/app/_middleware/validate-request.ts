import { NextRequest, NextResponse } from 'next/server';
import { z, ZodType } from 'zod';
import { rateLimit } from '../_lib/rate-limit';

export type ValidationResult<T> = 
  | { valid: true; data: T }
  | { valid: false; response: NextResponse };

interface ValidateRequestOptions<T extends ZodType> {
  schema: T;
  rateLimit?: boolean;
  requireAuth?: boolean;
  skipBodyParsing?: boolean;
}

export async function validateRequest<T extends ZodType>(
  request: NextRequest,
  options: ValidateRequestOptions<T>
): Promise<ValidationResult<z.infer<T>>> {
  const { 
    schema, 
    rateLimit: shouldRateLimit = false, 
    requireAuth = false,
    skipBodyParsing = false,
  } = options;

  // Check API key if required
  if (requireAuth) {
    const authResult = await checkApiKey(request);
    if (!authResult.valid) return authResult;
  }

  // Apply rate limiting if enabled
  if (shouldRateLimit) {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.valid) return rateLimitResult;
  }

  // Skip body parsing if requested (e.g., for file uploads)
  if (skipBodyParsing) {
    return { valid: true, data: {} as z.infer<T> };
  }

  // Parse and validate request body
  try {
    const body = await parseRequestBody(request);
    const result = await schema.safeParseAsync(body);

    if (!result.success) {
      return {
        valid: false,
        response: NextResponse.json(
          { 
            success: false, 
            error: 'Validation failed',
            details: result.error.format(),
            code: 'VALIDATION_ERROR',
          },
          { status: 400 }
        )
      };
    }

    return { valid: true, data: result.data };
  } catch (error) {
    console.error('Request validation error:', error);
    return {
      valid: false,
      response: NextResponse.json(
        { 
          success: false, 
          error: 'Invalid request format',
          details: error instanceof Error ? error.message : 'Unknown error',
          code: 'INVALID_REQUEST',
        },
        { status: 400 }
      )
    };
  }
}

// Helper function to check API key
async function checkApiKey(
  request: NextRequest
): Promise<ValidationResult<never>> {
  const apiKey = request.headers.get('x-api-key') || 
                new URL(request.url).searchParams.get('api_key');
  
  const validApiKeys = process.env.API_KEYS?.split(',').map(k => k.trim()) || [];
  
  if (!apiKey || !validApiKeys.includes(apiKey)) {
    return {
      valid: false,
      response: NextResponse.json(
        { 
          success: false, 
          error: 'Invalid or missing API key',
          code: 'UNAUTHORIZED',
        },
        { status: 401 }
      )
    };
  }
  
  return { valid: true } as ValidationResult<never>;
}

// Helper function to check rate limit
async function checkRateLimit(
  request: NextRequest
): Promise<ValidationResult<never>> {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
            request.headers.get('x-real-ip') || 
            'unknown';
  
  const rateLimitResult = await rateLimit(ip);
  
  if (!rateLimitResult.allowed) {
    return {
      valid: false,
      response: new NextResponse(
        JSON.stringify({ 
          success: false, 
          error: 'Too many requests',
          code: 'RATE_LIMIT_EXCEEDED',
        }),
        { 
          status: 429,
          headers: {
            ...rateLimitResult.headers,
            'Content-Type': 'application/json',
          },
        }
      )
    };
  }
  
  return { valid: true } as ValidationResult<never>;
}

// Helper function to parse request body based on content type
async function parseRequestBody(request: NextRequest): Promise<unknown> {
  const contentType = request.headers.get('content-type') || '';
  
  if (contentType.includes('application/json')) {
    return request.json();
  }
  
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const formData = await request.formData();
    return Object.fromEntries(formData.entries());
  }
  
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const result: Record<string, unknown> = {};
    
    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        result[key] = {
          name: value.name,
          type: value.type,
          size: value.size,
        };
      } else {
        result[key] = value;
      }
    }
    
    return result;
  }
  
  // For other content types, try to parse as text
  try {
    const text = await request.text();
    if (!text) return {};
    
    // Try to parse as JSON if it looks like JSON
    if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
      try {
        return JSON.parse(text);
      } catch {
        // Not valid JSON, continue
      }
    }
    
    return text;
  } catch {
    return {};
  }
}
