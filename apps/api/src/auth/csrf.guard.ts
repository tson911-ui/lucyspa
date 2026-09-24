import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { AuthError } from './auth.error.js';
import { sessionCookie } from './cookies.js';
import { verifyCsrfToken } from './crypto.js';
import { SessionService } from './session.service.js';

/** Origin is an exact serialized origin; Referer is a URL whose origin must match. */
export function allowedRequestOrigin(request: Pick<Request, 'headers'>, origin: string): boolean {
  const supplied = request.headers.origin;
  if (supplied !== undefined) return supplied === origin;
  const referer = request.headers.referer;
  if (typeof referer !== 'string' || !URL.canParse(referer)) return false;
  const parsed = new URL(referer);
  return !parsed.username && !parsed.password && parsed.origin === origin;
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
    const contentType = request.headers['content-type'];
    const supplied = request.headers['x-csrf-token'];
    const token = sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
    if (
      !allowedRequestOrigin(request, this.environment.webOrigin) ||
      request.headers['sec-fetch-site'] === 'cross-site' ||
      typeof contentType !== 'string' ||
      !/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(contentType) ||
      typeof supplied !== 'string' ||
      token === undefined
    )
      throw new AuthError('REQUEST_NOT_ALLOWED');
    try {
      const session = await this.sessions.resolve(token);
      const key = session && this.environment.auth.csrfKeys.get(session.csrfKeyVersion);
      if (!session || !key || !verifyCsrfToken(supplied, session.id, token, key)) {
        throw new AuthError('REQUEST_NOT_ALLOWED');
      }
      return true;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError('SERVICE_UNAVAILABLE');
    }
  }
}
