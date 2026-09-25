import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Logger } from 'pino';
import { finalize, type Observable } from 'rxjs';
import { API_ENVIRONMENT, API_LOGGER, type ApiEnvironment } from '../platform/tokens.js';
import { sessionCookie } from './cookies.js';
import { SessionService } from './session.service.js';

/** Request header the workforce client sets on reads a user caused (`user`). */
export const ACTIVITY_HEADER = 'x-lucy-activity';

/** Session-resolution endpoints: always passive, even if marked. */
const PASSIVE_PATHS = new Set(['/api/v1/auth/context', '/api/v1/auth/me']);

/**
 * What counts as genuine user activity (refreshing the idle timeout):
 * - every authenticated `POST` command under `/api/v1` (create, update, status, check-in,
 *   leave decisions, …). Commands are user-initiated, and they reach this point only after
 *   the global JSON, exact-Origin and CSRF guard has accepted them;
 * - a `GET` under `/api/v1` that the client marks `X-Lucy-Activity: user` (page loads and
 *   reloads caused by navigation or an explicit user action).
 *
 * What never counts: unmarked `GET`s (background or automatic reads), the session-resolution
 * endpoints `/api/v1/auth/context` and `/api/v1/auth/me` (even if marked), health checks and
 * any other path, and `HEAD`/`OPTIONS`. Login, logout and reauthentication are not refreshed
 * here either: they replace or revoke the session, so there is nothing valid to refresh.
 */
export function isUserActivity(method: string, path: string, marker: unknown): boolean {
  if (!path.startsWith('/api/v1/') || PASSIVE_PATHS.has(path)) return false;
  if (method === 'POST') return true;
  return method === 'GET' && marker === 'user';
}

/**
 * Records genuine activity after the handler finishes (success or error). Guards run first,
 * so a request rejected by CSRF/Origin checks never reaches this interceptor. Recording only
 * moves `lastActivityAt` of a still-valid session (see `SessionService.recordActivity`); it
 * never authenticates or authorizes anything, and a failure to record never fails the request.
 */
@Injectable()
export class SessionActivityInterceptor implements NestInterceptor {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(SessionService) private readonly sessions: Pick<SessionService, 'recordActivity'>,
    @Inject(API_LOGGER) private readonly logger: Logger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<Request>();
    if (!isUserActivity(request.method, request.path, request.headers[ACTIVITY_HEADER])) {
      return next.handle();
    }
    const token = sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
    if (token === undefined) return next.handle();
    return next.handle().pipe(finalize(() => this.record(token)));
  }

  private record(token: string): void {
    try {
      void Promise.resolve(this.sessions.recordActivity(token)).catch(() => this.failed());
    } catch {
      this.failed();
    }
  }

  private failed(): void {
    // Never log the token; the request itself already completed.
    this.logger.warn('Session activity could not be recorded');
  }
}
