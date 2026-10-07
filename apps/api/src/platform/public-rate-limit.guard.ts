import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthError } from '../auth/auth.error.js';
import { budgetOf, clientIdentity } from './public-rate-limit.core.js';
import { PublicRateLimitService } from './public-rate-limit.service.js';

/**
 * Limits the anonymous `/api/v1/public/*` reads per client address (Phase 6 P6-7). A request without `X-Forwarded-For` is the
 * website's own server rendering a page and is not limited (it speaks for every visitor); a visitor's request always carries
 * the header, because it reaches this API through the web server's proxy (and nginx before it).
 */
@Injectable()
export class PublicRateLimitGuard implements CanActivate {
  constructor(@Inject(PublicRateLimitService) private readonly limiter: PublicRateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const client = clientIdentity(request.headers['x-forwarded-for']);
    if (!client) return true;
    const decision = await this.limiter.consume(budgetOf(request.path), client);
    if (decision.allowed) return true;
    const response = http.getResponse<Response>();
    response.setHeader('retry-after', String(decision.retryAfterSeconds));
    throw new AuthError('RATE_LIMITED');
  }
}
