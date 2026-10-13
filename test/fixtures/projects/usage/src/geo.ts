import type { NextRequest } from 'next/server';

export function country(request: NextRequest) {
  return request.geo?.country;
}
