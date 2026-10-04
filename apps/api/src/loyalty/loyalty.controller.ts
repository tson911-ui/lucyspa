import type {
  LoyaltyAdjustmentRequest,
  LoyaltyAdjustmentResponse,
  LoyaltyExceptionPageResponse,
  LoyaltyGoLiveResponse,
  LoyaltyLedgerPageResponse,
  LoyaltyProfileResponse,
  LoyaltyWalletName,
  WalkInMemberLookupResponse,
} from '@lucy-spa/contracts';
import { LOYALTY_ADJUSTMENT_MAX_POINTS } from '@lucy-spa/contracts';
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
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { requireEmptyObject } from '../auth/session-auth.controller.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { LoyaltyService } from './loyalty.service.js';

const WALLETS: LoyaltyWalletName[] = ['SPA', 'BEAUTY'];

class MemberQueryDto {
  @IsOptional() @IsString() @MaxLength(128) phone?: string;
  @IsOptional() @IsString() @MaxLength(320) email?: string;
}

class LedgerQueryDto {
  @IsOptional() @IsIn(WALLETS) wallet?: string;
  @IsOptional() @IsString() @MaxLength(6) page?: string;
}

class PageQueryDto {
  @IsOptional() @IsString() @MaxLength(6) page?: string;
}

/** Only the choices the contract permits: no balance, tier, time or actor can be supplied. */
class AdjustmentDto implements LoyaltyAdjustmentRequest {
  @ApiProperty({ enum: WALLETS }) @IsIn(WALLETS) wallet!: LoyaltyWalletName;
  @ApiProperty()
  @IsInt()
  @Min(-LOYALTY_ADJUSTMENT_MAX_POINTS)
  @Max(LOYALTY_ADJUSTMENT_MAX_POINTS)
  points!: number;
  @ApiProperty() @IsString() @MaxLength(2000) reason!: string;
  @ApiProperty() @IsString() @MaxLength(64) clientRequestId!: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  correctsEntryId?: string;
}

/**
 * Phase 5 P5-3: loyalty points (admin). Reading follows the branch (`VIEW_LOYALTY`); adjustments, the
 * exceptions list and the go-live switch are GLOBAL_ONLY and decided inside each command; the global guard
 * enforces JSON, exact Origin and CSRF.
 */
@Controller('api/v1/loyalty')
export class LoyaltyController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(LoyaltyService) private readonly loyalty: LoyaltyService,
  ) {}

  @Get('branches/:branchId/members')
  @ApiOkResponse({
    description: 'Exact phone or email match of an active member (VIEW_LOYALTY; masked).',
  })
  members(
    @Param('branchId') branchId: string,
    @Query() query: MemberQueryDto,
    @Req() request: Request,
  ): Promise<WalkInMemberLookupResponse> {
    return this.loyalty.members(this.session(request), branchId, query);
  }

  @Get('branches/:branchId/customers/:userId')
  @ApiOkResponse({ description: "A customer's wallets, tiers and go-live state (VIEW_LOYALTY)." })
  profile(
    @Param('branchId') branchId: string,
    @Param('userId') userId: string,
    @Req() request: Request,
  ): Promise<LoyaltyProfileResponse> {
    return this.loyalty.profile(this.session(request), branchId, userId);
  }

  @Get('branches/:branchId/customers/:userId/ledger')
  @ApiOkResponse({
    description: "A customer's point ledger, newest first, 20 per page (VIEW_LOYALTY).",
  })
  ledger(
    @Param('branchId') branchId: string,
    @Param('userId') userId: string,
    @Query() query: LedgerQueryDto,
    @Req() request: Request,
  ): Promise<LoyaltyLedgerPageResponse> {
    return this.loyalty.ledger(this.session(request), branchId, userId, query);
  }

  @Post('customers/:userId/adjustments')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Manual points adjustment as a new ledger entry (ADJUST_LOYALTY_POINTS, GLOBAL, fresh re-authentication).',
  })
  adjust(
    @Param('userId') userId: string,
    @Body() body: AdjustmentDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoyaltyAdjustmentResponse> {
    return this.loyalty.adjust(this.session(request), userId, body, this.requestId(response));
  }

  @Get('exceptions')
  @ApiOkResponse({
    description:
      'Ledger entries that could not take their whole deduction (VIEW_LOYALTY_EXCEPTIONS, GLOBAL).',
  })
  exceptions(
    @Query() query: PageQueryDto,
    @Req() request: Request,
  ): Promise<LoyaltyExceptionPageResponse> {
    return this.loyalty.exceptions(this.session(request), query);
  }

  @Get('go-live')
  @ApiOkResponse({ description: 'Whether loyalty is switched on (ACTIVATE_LOYALTY, Owner only).' })
  goLive(@Req() request: Request): Promise<LoyaltyGoLiveResponse> {
    return this.loyalty.goLive(this.session(request));
  }

  @Post('go-live')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Switch loyalty on, once (ACTIVATE_LOYALTY, Owner only, fresh re-authentication).',
  })
  activate(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoyaltyGoLiveResponse> {
    requireEmptyObject(body);
    return this.loyalty.activate(this.session(request), this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
