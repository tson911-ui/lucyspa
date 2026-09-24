import type { CurrentAccountResponse, LoginRequest } from '@lucy-spa/contracts';
import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { AuthError } from './auth.error.js';
import { clearSessionCookie, sessionCookie, setSessionCookie } from './cookies.js';
import { LoginService } from './login.service.js';
import { RateLimitedError } from './registration.service.js';
import { SessionService } from './session.service.js';

class LoginDto implements LoginRequest {
  @ApiProperty({ enum: ['CUSTOMER'] }) @IsIn(['CUSTOMER']) realm!: 'CUSTOMER';
  @ApiProperty({ enum: ['EMAIL'] }) @IsIn(['EMAIL']) identifierType!: 'EMAIL';
  @ApiProperty() @IsString() @MaxLength(1_024) identifier!: string;
  @ApiProperty({ writeOnly: true }) @IsString() @MaxLength(1_024) password!: string;
}

class AuthorizationDto {
  @ApiProperty() version!: number;
  @ApiProperty({ type: [Object] }) grants!: [];
  @ApiProperty({ type: [Object] }) denies!: [];
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
    const token = sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
    if (token === undefined) throw new AuthError('REQUEST_NOT_ALLOWED');
    const requestId = response.getHeader('x-request-id');
    try {
      const result = await this.logins.login(
        body.identifier,
        body.password,
        token,
        // Forwarded headers are untrusted until deployment configures an explicit proxy list.
        request.socket.remoteAddress ?? 'unknown',
        typeof requestId === 'string' ? requestId : undefined,
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

  @Post('logout')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Current session revoked and cookie cleared.' })
  async logout(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    // The contract input is an empty object. The global pipe cannot validate a
    // property-less DTO under forbidUnknownValues, so reject any property here.
    if (
      typeof body !== 'object' ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).length > 0
    ) {
      throw new AuthError('VALIDATION_FAILED');
    }
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
