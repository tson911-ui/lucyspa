import type { CurrentAccountResponse, ReauthenticateRequest } from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { AuthError } from './auth.error.js';
import { clearSessionCookie, sessionCookie, setSessionCookie } from './cookies.js';
import { LoginService } from './login.service.js';
import { RateLimitedError } from './registration.service.js';
import { SessionService } from './session.service.js';

class LoginDto {
  @ApiProperty({ enum: ['CUSTOMER', 'WORKFORCE'] })
  @IsIn(['CUSTOMER', 'WORKFORCE'])
  realm!: 'CUSTOMER' | 'WORKFORCE';
  @ApiProperty({ enum: ['EMAIL', 'EMPLOYEE_ID'] })
  @IsIn(['EMAIL', 'EMPLOYEE_ID'])
  identifierType!: 'EMAIL' | 'EMPLOYEE_ID';
  @ApiProperty() @IsString() @MaxLength(1_024) identifier!: string;
  @ApiProperty({ writeOnly: true }) @IsString() @MaxLength(1_024) password!: string;
}

class ReauthenticateDto implements ReauthenticateRequest {
  @ApiProperty({ writeOnly: true }) @IsString() @MaxLength(1_024) password!: string;
}

class AuthorizationDto {
  @ApiProperty() version!: number;
  @ApiProperty({ type: [Object], required: false }) grants?: [];
  @ApiProperty({ type: [Object], required: false }) denies?: [];
  @ApiProperty({ required: false, description: 'Present only for the Owner.' }) owner?: true;
}

class CurrentAccountDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['CUSTOMER', 'EMPLOYEE', 'OWNER'] }) kind!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: ['vi', 'en'] }) locale!: string;
  @ApiProperty({ type: AuthorizationDto }) authorization!: AuthorizationDto;
}

/** The global guard enforces JSON, exact Origin and the session-bound CSRF token. */
@Controller('api/v1/auth')
export class SessionAuthController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(LoginService) private readonly logins: LoginService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({
    type: CurrentAccountDto,
    description: 'New session cookie; fetch a new CSRF context.',
  })
  async login(
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CurrentAccountResponse> {
    // CUSTOMER accounts sign in only by email; EMPLOYEE_ID exists only in WORKFORCE.
    if (body.realm === 'CUSTOMER' && body.identifierType !== 'EMAIL') {
      throw new AuthError('VALIDATION_FAILED', 'identifierType');
    }
    const token = sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
    if (token === undefined) throw new AuthError('REQUEST_NOT_ALLOWED');
    const requestId = response.getHeader('x-request-id');
    try {
      const result = await this.logins.login(
        body.identifier,
        body.password,
        token,
        peer(request),
        typeof requestId === 'string' ? requestId : undefined,
        { realm: body.realm, identifierType: body.identifierType },
      );
      // The previous session and its CSRF token are revoked; the client refetches context.
      setSessionCookie(response, this.environment.auth, result.token);
      return result.account;
    } catch (error) {
      if (error instanceof RateLimitedError) {
        response.setHeader('Retry-After', error.retryAfterSeconds.toString());
      }
      throw error;
    }
  }

  @Get('me')
  @ApiOkResponse({ type: CurrentAccountDto })
  me(@Req() request: Request): Promise<CurrentAccountResponse> {
    return this.logins.currentAccount(
      sessionCookie(request.headers.cookie, this.environment.auth.cookieName),
    );
  }

  @Post('reauthenticate')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Rotated session cookie; fetch a new CSRF context.' })
  async reauthenticate(
    @Body() body: ReauthenticateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const requestId = response.getHeader('x-request-id');
    try {
      const token = await this.logins.reauthenticate(
        sessionCookie(request.headers.cookie, this.environment.auth.cookieName),
        body.password,
        peer(request),
        typeof requestId === 'string' ? requestId : undefined,
      );
      setSessionCookie(response, this.environment.auth, token);
    } catch (error) {
      if (error instanceof RateLimitedError) {
        response.setHeader('Retry-After', error.retryAfterSeconds.toString());
      }
      throw error;
    }
  }

  @Post('logout-all')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Every session of this User revoked; cookie cleared.' })
  async logoutAll(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    requireEmptyObject(body);
    const requestId = response.getHeader('x-request-id');
    await this.logins.logoutAll(
      sessionCookie(request.headers.cookie, this.environment.auth.cookieName),
      typeof requestId === 'string' ? requestId : undefined,
    );
    clearSessionCookie(response, this.environment.auth);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Current session revoked and cookie cleared.' })
  async logout(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    requireEmptyObject(body);
    const token = sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
    const requestId = response.getHeader('x-request-id');
    try {
      if (token !== undefined) {
        await this.sessions.revoke(token, typeof requestId === 'string' ? requestId : undefined);
      }
    } catch {
      throw new AuthError('SERVICE_UNAVAILABLE');
    }
    clearSessionCookie(response, this.environment.auth);
  }
}

// Forwarded headers are untrusted until deployment configures an explicit proxy list.
function peer(request: Request): string {
  return request.socket.remoteAddress ?? 'unknown';
}

/**
 * The contract input is an empty object. The global pipe cannot validate a
 * property-less DTO under forbidUnknownValues, so reject any property here.
 */
export function requireEmptyObject(body: unknown): void {
  if (
    typeof body !== 'object' ||
    body === null ||
    Array.isArray(body) ||
    Object.keys(body).length > 0
  ) {
    throw new AuthError('VALIDATION_FAILED');
  }
}
