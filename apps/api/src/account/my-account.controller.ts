import type {
  AcceptedFlowResponse,
  EmailChangeRequest,
  EmailChangeResendRequest,
  EmailChangeVerifyRequest,
  MyAccountResponse,
  SelfPasswordChangeRequest,
} from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiProperty,
} from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie, setSessionCookie } from '../auth/cookies.js';
import { LoginService } from '../auth/login.service.js';
import { peer, retryAfter } from '../auth/password-reset.controller.js';
import { EmployeeProfileDto } from '../employees/employee.controller.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { EmailChangeService } from './email-change.service.js';
import { MyAccountService } from './my-account.service.js';

/** The same allowlisted, strict profile DTO as the management command (no ID field). */
class MyAccountProfileDto extends EmployeeProfileDto {}

/** Password and address only: identity is the session (no user or employee identifier). */
class EmailChangeDto implements EmailChangeRequest {
  @ApiProperty({ writeOnly: true }) @IsString() @MaxLength(1_024) currentPassword!: string;
  @ApiProperty() @IsString() @MaxLength(320) newEmail!: string;
}

class EmailChangeResendDto implements EmailChangeResendRequest {
  @ApiProperty({ writeOnly: true }) @IsString() @MaxLength(64) flowToken!: string;
}

class EmailChangeVerifyDto implements EmailChangeVerifyRequest {
  @ApiProperty({ writeOnly: true }) @IsString() @MaxLength(64) flowToken!: string;
  @ApiProperty({ writeOnly: true }) @IsString() @Matches(/^[0-9]{6}$/) otp!: string;
}

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

/**
 * "Đổi email / Change email" (follow-up Step 5) for the signed-in Owner or employee. The
 * global guard enforces JSON, exact Origin and the session-bound CSRF token on every call.
 * Verification rotates the session cookie (every other session is revoked); refetch CSRF.
 */
@Controller('api/v1/me/email')
export class MyEmailController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(EmailChangeService) private readonly emails: EmailChangeService,
  ) {}

  @Post('request')
  @HttpCode(202)
  @ApiAcceptedResponse({ description: 'A code was sent to the new address only.' })
  request(
    @Body() body: EmailChangeDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AcceptedFlowResponse> {
    const requestId = response.getHeader('x-request-id');
    return retryAfter(response, () =>
      this.emails.request(
        sessionCookie(request.headers.cookie, this.environment.auth.cookieName),
        body.currentPassword,
        body.newEmail,
        peer(request),
        typeof requestId === 'string' ? requestId : undefined,
      ),
    );
  }

  @Post('resend')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'A new code for the caller’s own live flow.' })
  async resend(
    @Body() body: EmailChangeResendDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await retryAfter(response, () =>
      this.emails.resend(
        sessionCookie(request.headers.cookie, this.environment.auth.cookieName),
        body.flowToken,
        peer(request),
      ),
    );
  }

  @Post('verify')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Email changed and verified; rotated session cookie.' })
  async verify(
    @Body() body: EmailChangeVerifyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const requestId = response.getHeader('x-request-id');
    const token = await retryAfter(response, () =>
      this.emails.verify(
        sessionCookie(request.headers.cookie, this.environment.auth.cookieName),
        body.flowToken,
        body.otp,
        peer(request),
        typeof requestId === 'string' ? requestId : undefined,
      ),
    );
    setSessionCookie(response, this.environment.auth, token);
  }
}
