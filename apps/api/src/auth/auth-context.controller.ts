import type { AuthContextResponse } from '@lucy-spa/contracts';
import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { AuthError } from './auth.error.js';
import { ContextThrottleService } from './context-throttle.service.js';
import { clearSessionCookie, sessionCookie, setSessionCookie } from './cookies.js';
import { csrfToken } from './crypto.js';
import { allowedRequestOrigin } from './csrf.guard.js';
import { SessionService } from './session.service.js';

class AuthContextResponseDto implements AuthContextResponse {
  @ApiProperty() csrfToken!: string;
  @ApiProperty() authenticated!: boolean;
}

@Controller('api/v1/auth')
export class AuthContextController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(ContextThrottleService) private readonly throttle: ContextThrottleService,
  ) {}

  @Get('context')
  @ApiOkResponse({ type: AuthContextResponseDto })
  async context(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthContextResponse> {
    response.setHeader('Cache-Control', 'no-store');
    // Reject identifiable foreign browser requests before allocating a session.
    if (
      request.headers['sec-fetch-site'] === 'cross-site' ||
      ((request.headers.origin !== undefined || request.headers.referer !== undefined) &&
        !allowedRequestOrigin(request, this.environment.webOrigin))
    ) {
      throw new AuthError('REQUEST_NOT_ALLOWED');
    }
    const config = this.environment.auth;
    let token = sessionCookie(request.headers.cookie, config.cookieName);
    try {
      let session = await this.sessions.resolve(token);
      if (!session) {
        // HEAD must remain read-only even though Express can route it to GET.
        if (request.method === 'HEAD') throw new AuthError('AUTHENTICATION_REQUIRED');
        const issued = await this.sessions.withTransaction(async (transaction) => {
          // Forwarded headers are deliberately untrusted. A proxy's direct peer
          // shares its configured quota until deployment adds an explicit trust list.
          await this.throttle.consume(transaction, request.socket.remoteAddress ?? 'unknown');
          return this.sessions.createAnonymous(transaction);
        });
        session = issued.session;
        token = issued.token;
        setSessionCookie(response, config, token);
      }
      const key = config.csrfKeys.get(session.csrfKeyVersion);
      if (!key || !token) throw new AuthError('SERVICE_UNAVAILABLE');
      return {
        csrfToken: csrfToken(session.id, token, key),
        authenticated: session.kind === 'AUTHENTICATED',
      };
    } catch (error) {
      if (error instanceof AuthError) {
        if (error.code === 'RATE_LIMITED') {
          response.setHeader('Retry-After', config.contextWindowSeconds.toString());
          if (token) clearSessionCookie(response, config);
        }
        throw error;
      }
      throw new AuthError('SERVICE_UNAVAILABLE');
    }
  }
}
