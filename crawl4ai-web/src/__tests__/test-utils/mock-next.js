// Mock the Next.js Response
class NextResponse extends Response {
  constructor(body, { status = 200, headers = {} } = {}) {
    super(JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
  }
  
  static json(data, init) {
    return new NextResponse(data, init);
  }
  
  static redirect(url, status = 307) {
    return new NextResponse(null, {
      status,
      headers: { Location: url },
    });
  }
}

// Make NextResponse available globally
global.NextResponse = NextResponse;
