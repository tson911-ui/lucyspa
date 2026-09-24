import type {
  AcceptedFlowResponse,
  ActivationVerifyRequest,
  ChallengeResendRequest,
  ChallengeResendResponse,
  RegisterCustomerRequest,
} from '@lucy-spa/contracts';
import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiAcceptedResponse, ApiNoContentResponse, ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { RateLimitedError, RegistrationService } from './registration.service.js';

class RegisterCustomerDto implements RegisterCustomerRequest {
  @ApiProperty() @IsString() @MaxLength(1_024) fullName!: string;
  @ApiProperty({ example: '1990-01-31' }) @IsString() @MaxLength(10) dateOfBirth!: string;
  @ApiProperty() @IsString() @MaxLength(2_048) address!: string;
  @ApiProperty() @IsString() @MaxLength(1_024) email!: string;
  @ApiProperty() @IsString() @MaxLength(128) phone!: string;
  @ApiProperty({ writeOnly: true }) @IsString() @MaxLength(1_024) password!: string;
  @ApiProperty({ enum: ['vi', 'en'] }) @IsIn(['vi', 'en']) locale!: 'vi' | 'en';
}

class ActivationVerifyDto implements ActivationVerifyRequest {
  @ApiProperty({ writeOnly: true }) @IsString() @MaxLength(64) flowToken!: string;
  @ApiProperty({ writeOnly: true }) @IsString() @Matches(/^[0-9]{6}$/) otp!: string;
}

class ChallengeResendDto implements ChallengeResendRequest {
  @ApiProperty({ writeOnly: true }) @IsString() @MaxLength(64) flowToken!: string;
}

class AcceptedFlowDto implements AcceptedFlowResponse {
  @ApiProperty({ enum: ['accepted'] }) status!: 'accepted';
  @ApiProperty() flowToken!: string;
  @ApiProperty({ enum: [300] }) codeLifetimeSeconds!: 300;
  @ApiProperty({ enum: [60] }) resendAfterSeconds!: 60;
}

class ChallengeResendResponseDto implements ChallengeResendResponse {
  @ApiProperty({ enum: ['accepted'] }) status!: 'accepted';
  @ApiProperty({ enum: [60] }) resendAfterSeconds!: 60;
}

/** Customer self-registration. The global guard enforces JSON, exact Origin and CSRF. */
@Controller('api/v1/auth')
export class RegistrationController {
  constructor(@Inject(RegistrationService) private readonly registration: RegistrationService) {}

  @Post('register')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: AcceptedFlowDto })
  register(
    @Body() body: RegisterCustomerDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AcceptedFlowResponse> {
    return retryAfter(response, () => this.registration.register(body, peer(request)));
  }

  @Post('activation/verify')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Account activated; no login cookie is issued.' })
  async verify(
    @Body() body: ActivationVerifyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const requestId = response.getHeader('x-request-id');
    await retryAfter(response, () =>
      this.registration.verify(
        body.flowToken,
        body.otp,
        peer(request),
        typeof requestId === 'string' ? requestId : undefined,
      ),
    );
  }

  @Post('challenges/resend')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: ChallengeResendResponseDto })
  async resend(
    @Body() body: ChallengeResendDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ChallengeResendResponse> {
    await retryAfter(response, () => this.registration.resend(body.flowToken, peer(request)));
    return { status: 'accepted', resendAfterSeconds: 60 };
  }
}

// Forwarded headers are untrusted until deployment configures an explicit proxy list.
function peer(request: Request): string {
  return request.socket.remoteAddress ?? 'unknown';
}

async function retryAfter<T>(response: Response, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    // Coarse window length only; IP limits are independent of account existence.
    if (error instanceof RateLimitedError) {
      response.setHeader('Retry-After', error.retryAfterSeconds.toString());
    }
    throw error;
  }
}
