import type {
  AcceptedFlowResponse,
  PasswordResetCompleteRequest,
  PasswordResetRealm,
  PasswordResetRequest,
} from '@lucy-spa/contracts';
import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiAcceptedResponse, ApiNoContentResponse, ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { RateLimitedError } from './otp-flow.js';
import { PasswordResetService } from './password-reset.service.js';

class PasswordResetRequestDto implements PasswordResetRequest {
  @ApiProperty({ enum: ['CUSTOMER', 'WORKFORCE'] })
  @IsIn(['CUSTOMER', 'WORKFORCE'])
  realm!: PasswordResetRealm;
  @ApiProperty() @IsString() @MaxLength(1_024) email!: string;
  @ApiProperty({ enum: ['vi', 'en'] }) @IsIn(['vi', 'en']) locale!: 'vi' | 'en';
}

class PasswordResetCompleteDto implements PasswordResetCompleteRequest {
  @ApiProperty({ writeOnly: true }) @IsString() @MaxLength(64) flowToken!: string;
  @ApiProperty({ writeOnly: true }) @IsString() @Matches(/^[0-9]{6}$/) otp!: string;
  @ApiProperty({ writeOnly: true }) @IsString() @MaxLength(1_024) newPassword!: string;
}

/** The global guard enforces JSON, exact Origin and the session-bound CSRF token. */
@Controller('api/v1/auth/password-reset')
export class PasswordResetController {
  constructor(@Inject(PasswordResetService) private readonly resets: PasswordResetService) {}

  @Post('request')
  @HttpCode(202)
  @ApiAcceptedResponse({ description: 'AcceptedFlow; identical for every account state.' })
  request(
    @Body() body: PasswordResetRequestDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AcceptedFlowResponse> {
    return retryAfter(response, () =>
      this.resets.request(body.email, body.locale, peer(request), body.realm),
    );
  }

  @Post('complete')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Password changed; all sessions revoked; log in again.' })
  async complete(
    @Body() body: PasswordResetCompleteDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const requestId = response.getHeader('x-request-id');
    await retryAfter(response, () =>
      this.resets.complete(
        body.flowToken,
        body.otp,
        body.newPassword,
        peer(request),
        typeof requestId === 'string' ? requestId : undefined,
      ),
    );
  }
}

// Forwarded headers are untrusted until deployment configures an explicit proxy list.
export function peer(request: Request): string {
  return request.socket.remoteAddress ?? 'unknown';
}

export async function retryAfter<T>(response: Response, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof RateLimitedError) {
      response.setHeader('Retry-After', error.retryAfterSeconds.toString());
    }
    throw error;
  }
}
