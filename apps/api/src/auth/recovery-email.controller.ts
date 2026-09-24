import type { AcceptedFlowResponse, RecoveryEmailVerifyRequest } from '@lucy-spa/contracts';
import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiAcceptedResponse, ApiNoContentResponse, ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { sessionCookie } from './cookies.js';
import { peer, retryAfter } from './password-reset.controller.js';
import { RecoveryEmailService } from './recovery-email.service.js';
import { requireEmptyObject } from './session-auth.controller.js';

class RecoveryEmailVerifyDto implements RecoveryEmailVerifyRequest {
  @ApiProperty({ writeOnly: true }) @IsString() @MaxLength(64) flowToken!: string;
  @ApiProperty({ writeOnly: true }) @IsString() @Matches(/^[0-9]{6}$/) otp!: string;
}

/** The global guard enforces JSON, exact Origin and the session-bound CSRF token. */
@Controller('api/v1/auth/recovery-email')
export class RecoveryEmailController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(RecoveryEmailService) private readonly recovery: RecoveryEmailService,
  ) {}

  @Post('request')
  @HttpCode(202)
  @ApiAcceptedResponse({
    description: 'AcceptedFlow for the stored unverified recovery email; fresh password proof.',
  })
  request(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AcceptedFlowResponse> {
    requireEmptyObject(body);
    return retryAfter(response, () =>
      this.recovery.request(
        sessionCookie(request.headers.cookie, this.environment.auth.cookieName),
        peer(request),
      ),
    );
  }

  @Post('verify')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'The stored recovery email is marked verified.' })
  async verify(
    @Body() body: RecoveryEmailVerifyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const requestId = response.getHeader('x-request-id');
    await retryAfter(response, () =>
      this.recovery.verify(
        sessionCookie(request.headers.cookie, this.environment.auth.cookieName),
        body.flowToken,
        body.otp,
        peer(request),
        typeof requestId === 'string' ? requestId : undefined,
      ),
    );
  }
}
