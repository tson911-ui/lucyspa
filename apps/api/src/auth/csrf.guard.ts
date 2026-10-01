import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { AuthError } from './auth.error.js';
import { sessionCookie } from './cookies.js';
import { verifyCsrfToken } from './crypto.js';
import { PUBLIC_WEBHOOK } from './public-webhook.js';
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
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
    // The one declared exemption (design 16.4): a server-to-server provider webhook. It has no session or
    // cookie; its authenticity is the provider signature, checked by the handler before any state change.
    if (this.reflector.get<boolean>(PUBLIC_WEBHOOK, context.getHandler()) === true) return true;
    const contentType = request.headers['content-type'];
    const supplied = request.headers['x-csrf-token'];
    const token = sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
    if (
      !allowedRequestOrigin(request, this.environment.webOrigin) ||
      request.headers['sec-fetch-site'] === 'cross-site' ||
      typeof contentType !== 'string' ||
      !/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(contentType) ||
      token === undefined
    )
      throw new AuthError('REQUEST_NOT_ALLOWED');
    try {
      const session = await this.sessions.resolve(token);
      if (!session) {
        // A signed-in session that ended (revoked, expired, permissions changed) is a 401 with the
        // reason, decided before the CSRF token is looked at; anything else keeps the plain 403.
        // Optional: narrow test doubles of SessionService may not implement it.
        const ended = await (this.sessions as Partial<SessionService>).endedSession?.(token);
        if (ended) {
          throw ended === 'AUTHORIZATION_CHANGED'
            ? new AuthError('AUTHENTICATION_REQUIRED', undefined, 'AUTHORIZATION_CHANGED')
            : new AuthError('AUTHENTICATION_REQUIRED');
        }
        throw new AuthError('REQUEST_NOT_ALLOWED');
      }
      const key = this.environment.auth.csrfKeys.get(session.csrfKeyVersion);
      if (
        typeof supplied !== 'string' ||
        !key ||
        !verifyCsrfToken(supplied, session.id, token, key)
      ) {
        throw new AuthError('REQUEST_NOT_ALLOWED');
      }
      return true;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError('SERVICE_UNAVAILABLE');
    }
  }
}
