import type { HealthResponse } from '@lucy-spa/contracts';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json({ status: 'ok', service: 'web' } satisfies HealthResponse, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
