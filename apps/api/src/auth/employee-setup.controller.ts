import type { EmployeeSetupCompleteRequest } from '@lucy-spa/contracts';
import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiNoContentResponse, ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { EmployeeSetupService } from './employee-setup.service.js';
import { peer, retryAfter } from './password-reset.controller.js';

class EmployeeSetupCompleteDto implements EmployeeSetupCompleteRequest {
  @ApiProperty({ writeOnly: true }) @IsString() @MaxLength(64) setupToken!: string;
  @ApiProperty({ writeOnly: true }) @IsString() @MaxLength(1_024) newPassword!: string;
}

/** The global guard enforces JSON, exact Origin and the session-bound CSRF token. */
@Controller('api/v1/auth/employee-setup')
export class EmployeeSetupController {
  constructor(@Inject(EmployeeSetupService) private readonly setups: EmployeeSetupService) {}

  @Post('complete')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Password established; no login cookie, sign in.' })
  async complete(
    @Body() body: EmployeeSetupCompleteDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const requestId = response.getHeader('x-request-id');
    await retryAfter(response, () =>
      this.setups.complete(
        body.setupToken,
        body.newPassword,
        peer(request),
        typeof requestId === 'string' ? requestId : undefined,
      ),
    );
  }
}
