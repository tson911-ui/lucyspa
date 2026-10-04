import type {
  ReferralLookupResponse,
  ReferralPageResponse,
  ReferralResultResponse,
} from '@lucy-spa/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { ReferralService } from './referral.service.js';

class ListQueryDto {
  @IsOptional() @IsString() @MaxLength(6) page?: string;
  @IsOptional() @IsString() @MaxLength(16) status?: string;
}

class LookupQueryDto {
  @IsOptional() @IsString() @MaxLength(128) phone?: string;
}

/** Only what the contract permits: no referral id, referred customer, actor, time or award can be supplied. */
class BindDto {
  @ApiProperty() @IsString() @MaxLength(128) referrerPhone!: string;
}

class ChangeDto {
  @ApiProperty() @IsString() @MaxLength(128) referrerPhone!: string;
  @ApiProperty() @IsString() @MaxLength(2000) reason!: string;
}

/**
 * Phase 5 P5-5: referral (admin). Binding at the counter needs `MANAGE_REFERRALS` at the branch, reading follows
 * `VIEW_LOYALTY`, and changing a referrer is the Owner's (`CHANGE_REFERRER`, fresh re-authentication); each command decides again
 * inside its transaction. The global guard enforces JSON, exact Origin and CSRF.
 */
@Controller('api/v1/referrals')
export class ReferralController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(ReferralService) private readonly referrals: ReferralService,
  ) {}

  @Get('branches/:branchId')
  @ApiOkResponse({ description: 'Referrals, newest first, 20 per page (VIEW_LOYALTY).' })
  list(
    @Param('branchId') branchId: string,
    @Query() query: ListQueryDto,
    @Req() request: Request,
  ): Promise<ReferralPageResponse> {
    return this.referrals.list(this.session(request), branchId, query);
  }

  @Get('branches/:branchId/lookup')
  @ApiOkResponse({
    description: 'Exact phone of an existing member for a referral (MANAGE_REFERRALS; masked).',
  })
  lookup(
    @Param('branchId') branchId: string,
    @Query() query: LookupQueryDto,
    @Req() request: Request,
  ): Promise<ReferralLookupResponse> {
    return this.referrals.lookup(this.session(request), branchId, query);
  }

  @Post('branches/:branchId/customers/:userId/bind')
  @HttpCode(200)
  @ApiOkResponse({
    description: "Record a brand-new customer's referrer at the counter (MANAGE_REFERRALS).",
  })
  bind(
    @Param('branchId') branchId: string,
    @Param('userId') userId: string,
    @Body() body: BindDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ReferralResultResponse> {
    return this.referrals.bind(
      this.session(request),
      branchId,
      userId,
      body,
      this.requestId(response),
    );
  }

  @Post('customers/:userId/change')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      "Change a customer's referrer before the reward (CHANGE_REFERRER, Owner only, fresh re-authentication).",
  })
  change(
    @Param('userId') userId: string,
    @Body() body: ChangeDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ReferralResultResponse> {
    return this.referrals.change(this.session(request), userId, body, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
