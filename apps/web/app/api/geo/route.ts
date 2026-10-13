import type { NextRequest } from 'next/server';

export function GET(request: NextRequest) {
  return Response.json({ country: request.geo?.country ?? 'unknown', ip: request.ip });
}
