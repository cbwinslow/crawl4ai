// Mock for next/server module
export class NextResponse extends Response {
  static json(data: any, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(data), {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
  }
}

export function NextRequest(url: string | URL, init?: RequestInit) {
  return new Request(url, {
    ...init,
    headers: {
      ...init?.headers,
    },
  });
}
