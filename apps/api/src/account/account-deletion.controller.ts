import type { AccountDeletionCheckResponse, AccountDeletionRequest } from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { clearSessionCookie, sessionCookie } from '../auth/cookies.js';
import { peer, retryAfter } from '../auth/password-reset.controller.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { AccountDeletionService } from './account-deletion.service.js';

/** The current password only: identity is the session (no user id is accepted). */
class AccountDeletionDto implements AccountDeletionRequest {
  @ApiProperty({ writeOnly: true }) @IsString() @MaxLength(1_024) currentPassword!: string;
}

/**
 * Session 10 A2: "Xóa tài khoản" of the signed-in customer. The global guard enforces JSON, exact Origin and the session-bound CSRF
 * token on the write; unknown body fields are rejected by the DTO. On success the session cookie is cleared (every session of the
 * account was revoked in the same transaction).
 */
@Controller('api/v1/me/account-deletion')
export class AccountDeletionController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(AccountDeletionService) private readonly deletion: AccountDeletionService,
  ) {}

  @Get()
  @ApiOkResponse({
    description:
      'What stops the deletion now (unused combo sessions, unfinished orders, open returns, a visit in progress) and what is lost.',
  })
  check(@Req() request: Request): Promise<AccountDeletionCheckResponse> {
    return this.deletion.check(
      sessionCookie(request.headers.cookie, this.environment.auth.cookieName),
    );
  }

  @Post()
  @HttpCode(204)
  @ApiNoContentResponse({
    description: 'Account deleted; every session ended and the cookie cleared.',
  })
  async delete(
    @Body() body: AccountDeletionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const requestId = response.getHeader('x-request-id');
    await retryAfter(response, () =>
      this.deletion.delete(
        sessionCookie(request.headers.cookie, this.environment.auth.cookieName),
        body.currentPassword,
        peer(request),
        typeof requestId === 'string' ? requestId : undefined,
      ),
    );
    clearSessionCookie(response, this.environment.auth);
  }
}
