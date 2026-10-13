import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'experimental-edge';

export function GET(request: NextRequest) {
  const country = request.geo?.country ?? 'unknown';
  return NextResponse.json({ country });
}
