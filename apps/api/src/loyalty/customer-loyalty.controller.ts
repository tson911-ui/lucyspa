import type {
  CustomerComboPageResponse,
  CustomerComboUsePageResponse,
  CustomerGiftPageResponse,
  CustomerLedgerPageResponse,
  CustomerLoyaltySummaryResponse,
  CustomerReferralPageResponse,
} from '@lucy-spa/contracts';
import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { CustomerLoyaltyService } from './customer-loyalty.service.js';

class PageQueryDto {
  @IsOptional() @IsString() @MaxLength(8) page?: string;
}

/**
 * The signed-in customer's own membership page (Phase 5 P5-10, design 15). Read only: identity is the session cookie, no
 * customer id is accepted, and while the loyalty go-live switch is OFF every answer is empty.
 */
@Controller('api/v1/me/loyalty')
export class CustomerLoyaltyController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(CustomerLoyaltyService) private readonly loyalty: CustomerLoyaltyService,
  ) {}

  @Get()
  @ApiOkResponse({ description: 'Spa and Beauty points, tier, Member Discount and the next tier.' })
  summary(@Req() request: Request): Promise<CustomerLoyaltySummaryResponse> {
    return this.loyalty.summary(this.session(request));
  }

  @Get('history')
  @ApiOkResponse({ description: 'The points history in simple wording, newest first.' })
  history(
    @Query() query: PageQueryDto,
    @Req() request: Request,
  ): Promise<CustomerLedgerPageResponse> {
    return this.loyalty.history(this.session(request), query.page);
  }

  @Get('combos')
  @ApiOkResponse({ description: 'The combos bought, with the sessions left (paid and bonus).' })
  combos(
    @Query() query: PageQueryDto,
    @Req() request: Request,
  ): Promise<CustomerComboPageResponse> {
    return this.loyalty.combos(this.session(request), query.page);
  }

  @Get('combo-uses')
  @ApiOkResponse({
    description: 'Uses of the customer’s combos, by the customer and by relatives.',
  })
  comboUses(
    @Query() query: PageQueryDto,
    @Req() request: Request,
  ): Promise<CustomerComboUsePageResponse> {
    return this.loyalty.comboUses(this.session(request), query.page);
  }

  @Get('referrals')
  @ApiOkResponse({
    description: 'The people the customer referred (masked names) and their status.',
  })
  referrals(
    @Query() query: PageQueryDto,
    @Req() request: Request,
  ): Promise<CustomerReferralPageResponse> {
    return this.loyalty.referrals(this.session(request), query.page);
  }

  @Get('gifts')
  @ApiOkResponse({ description: 'The gifts granted to the customer, with status and expiry.' })
  gifts(@Query() query: PageQueryDto, @Req() request: Request): Promise<CustomerGiftPageResponse> {
    return this.loyalty.gifts(this.session(request), query.page);
  }

  private session(request: Request): string | undefined {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }
}
