import type { MyAccountResponse, SelfPasswordChangeRequest } from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie, setSessionCookie } from '../auth/cookies.js';
import { LoginService } from '../auth/login.service.js';
import { peer, retryAfter } from '../auth/password-reset.controller.js';
import { EmployeeProfileDto } from '../employees/employee.controller.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { MyAccountService } from './my-account.service.js';

/** The same allowlisted, strict profile DTO as the management command (no ID field). */
class MyAccountProfileDto extends EmployeeProfileDto {}

/** Passwords only: no user, employee ID or code is accepted (identity is the session). */
class SelfPasswordChangeDto implements SelfPasswordChangeRequest {
  @ApiProperty({ writeOnly: true }) @IsString() @MaxLength(1_024) currentPassword!: string;
  @ApiProperty({ writeOnly: true }) @IsString() @MaxLength(1_024) newPassword!: string;
}

/**
 * "Tài khoản của tôi / My Account". The session cookie is the only identity: there is no
 * employee ID in the path or body. The global guard enforces JSON, exact Origin and the
 * session-bound CSRF token on the write; unknown body fields are rejected by the DTO.
 */
@Controller('api/v1/me/account')
export class MyAccountController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(MyAccountService) private readonly account: MyAccountService,
  ) {}

  @Get()
  @ApiOkResponse({ description: 'The signed-in workforce account (Owner or employee).' })
  get(@Req() request: Request): Promise<MyAccountResponse> {
    return this.account.get(
      sessionCookie(request.headers.cookie, this.environment.auth.cookieName),
    );
  }

  @Post('profile')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Own name, phone, date of birth, address or language.' })
  updateProfile(
    @Body() body: MyAccountProfileDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MyAccountResponse> {
    const requestId = response.getHeader('x-request-id');
    return this.account.updateProfile(
      sessionCookie(request.headers.cookie, this.environment.auth.cookieName),
      body,
      typeof requestId === 'string' ? requestId : undefined,
    );
  }
}

/**
 * "Đổi mật khẩu / Change password" (follow-up Step 4) for the signed-in Owner or employee.
 * The global guard enforces JSON, exact Origin and the session-bound CSRF token. On success
 * the session cookie is rotated (every other session is revoked); refetch the CSRF context.
 */
@Controller('api/v1/me/password')
export class MyPasswordController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(LoginService) private readonly logins: LoginService,
  ) {}

  @Post()
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Password changed; rotated session cookie.' })
  async change(
    @Body() body: SelfPasswordChangeDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const requestId = response.getHeader('x-request-id');
    const token = await retryAfter(response, () =>
      this.logins.changePassword(
        sessionCookie(request.headers.cookie, this.environment.auth.cookieName),
        body.currentPassword,
        body.newPassword,
        peer(request),
        typeof requestId === 'string' ? requestId : undefined,
      ),
    );
    setSessionCookie(response, this.environment.auth, token);
  }
}
