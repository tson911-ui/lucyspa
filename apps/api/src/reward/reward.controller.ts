import type {
  RewardCatalogCreateRequest,
  RewardCatalogEditRequest,
  RewardCatalogItemResponse,
  RewardCatalogListResponse,
  RewardEntitlementPageResponse,
  RewardEntitlementResponse,
  RewardIssueOptionsResponse,
  RewardIssueRequest,
  RewardLookupResponse,
  RewardReasonRequest,
  RewardUseRequest,
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
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { RewardService } from './reward.service.js';

/** Only the contract's fields: no code, issuer, owner, time, expiry or version can be supplied. */
class CatalogCreateDto implements RewardCatalogCreateRequest {
  @ApiProperty() @IsIn(['FREE_SERVICE', 'VOUCHER', 'PRODUCT_GIFT']) kind!:
    'FREE_SERVICE' | 'VOUCHER' | 'PRODUCT_GIFT';
  @ApiProperty({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(64)
  serviceId!: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(64)
  variantId?: string | null;
  @ApiProperty() @IsString() @MaxLength(200) nameVi!: string;
  @ApiProperty() @IsString() @MaxLength(200) nameEn!: string;
  @ApiProperty() @IsBoolean() active!: boolean;
  @ApiProperty({ nullable: true }) @ValidateIf((_, value) => value !== null) @IsInt() expiryDays!:
    number | null;
}

class CatalogEditDto implements RewardCatalogEditRequest {
  @ApiProperty() @IsInt() expectedRowVersion!: number;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(64)
  variantId?: string | null;
  @ApiProperty() @IsString() @MaxLength(200) nameVi!: string;
  @ApiProperty() @IsString() @MaxLength(200) nameEn!: string;
  @ApiProperty() @IsBoolean() active!: boolean;
  @ApiProperty({ nullable: true }) @ValidateIf((_, value) => value !== null) @IsInt() expiryDays!:
    number | null;
}

class LookupQueryDto {
  @IsOptional() @IsString() @MaxLength(128) phone?: string;
}

class PageQueryDto {
  @IsOptional() @IsString() @MaxLength(8) page?: string;
}

class IssueDto implements RewardIssueRequest {
  @ApiProperty() @IsString() @MaxLength(64) catalogItemId!: string;
  @ApiProperty() @IsInt() quantity!: number;
  @ApiProperty() @IsString() @MaxLength(2_048) reason!: string;
}

class UseDto implements RewardUseRequest {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2_048) note?: string;
}

class ReasonDto implements RewardReasonRequest {
  @ApiProperty() @IsString() @MaxLength(2_048) reason!: string;
}

/**
 * Phase 5 P5-9: the reward catalog and the customers' entitlements. Definitions need `MANAGE_REWARD_CATALOG` (global); granting, using
 * and revoking need `ISSUE_REWARDS` at the branch; restoring a mistaken use is a manager's (`MANAGE_REWARD_CATALOG`). Each command
 * decides again inside its transaction. The global guard enforces JSON, exact Origin and CSRF.
 */
@Controller('api/v1/rewards')
export class RewardController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(RewardService) private readonly rewards: RewardService,
  ) {}

  @Get('catalog')
  @ApiOkResponse({ description: 'Every catalog item, newest first (MANAGE_REWARD_CATALOG).' })
  catalog(@Req() request: Request): Promise<RewardCatalogListResponse> {
    return this.rewards.catalog(this.session(request));
  }

  @Post('catalog')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Creates a catalog item (MANAGE_REWARD_CATALOG).' })
  createItem(
    @Body() body: CatalogCreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RewardCatalogItemResponse> {
    return this.rewards.createItem(this.session(request), body, this.requestId(response));
  }

  @Post('catalog/:id/edit')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Edits names, active flag and expiry rule (MANAGE_REWARD_CATALOG).',
  })
  editItem(
    @Param('id') id: string,
    @Body() body: CatalogEditDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RewardCatalogItemResponse> {
    return this.rewards.editItem(this.session(request), id, body, this.requestId(response));
  }

  @Post('uses/:useId/restore')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Restores a mistaken use as an offset row with a reason (MANAGE_REWARD_CATALOG).',
  })
  restore(
    @Param('useId') useId: string,
    @Body() body: ReasonDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RewardEntitlementResponse> {
    return this.rewards.restore(this.session(request), useId, body, this.requestId(response));
  }

  @Get('branches/:branchId/options')
  @ApiOkResponse({ description: 'The active items staff can grant (ISSUE_REWARDS at the branch).' })
  options(
    @Param('branchId') branchId: string,
    @Req() request: Request,
  ): Promise<RewardIssueOptionsResponse> {
    return this.rewards.options(this.session(request), branchId);
  }

  @Get('branches/:branchId/lookup')
  @ApiOkResponse({ description: 'Exact phone of a member, masked (ISSUE_REWARDS at the branch).' })
  lookup(
    @Param('branchId') branchId: string,
    @Query() query: LookupQueryDto,
    @Req() request: Request,
  ): Promise<RewardLookupResponse> {
    return this.rewards.lookup(this.session(request), branchId, query);
  }

  @Get('branches/:branchId/customers/:userId/entitlements')
  @ApiOkResponse({
    description:
      "A customer's rewards with their history, 20 per page (ISSUE_REWARDS at the branch).",
  })
  list(
    @Param('branchId') branchId: string,
    @Param('userId') userId: string,
    @Query() query: PageQueryDto,
    @Req() request: Request,
  ): Promise<RewardEntitlementPageResponse> {
    return this.rewards.list(this.session(request), branchId, userId, query);
  }

  @Post('branches/:branchId/customers/:userId/entitlements')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Grants a catalog item to a member (ISSUE_REWARDS; go-live ON).' })
  issue(
    @Param('branchId') branchId: string,
    @Param('userId') userId: string,
    @Body() body: IssueDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RewardEntitlementResponse> {
    return this.rewards.issue(
      this.session(request),
      branchId,
      userId,
      body,
      this.requestId(response),
    );
  }

  @Post('branches/:branchId/entitlements/:id/use')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Marks one unit as used (ISSUE_REWARDS; go-live ON).' })
  use(
    @Param('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: UseDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RewardEntitlementResponse> {
    return this.rewards.use(this.session(request), branchId, id, body, this.requestId(response));
  }

  @Post('branches/:branchId/entitlements/:id/revoke')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Revokes a grant with a reason (ISSUE_REWARDS; go-live ON).' })
  revoke(
    @Param('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: ReasonDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RewardEntitlementResponse> {
    return this.rewards.revoke(this.session(request), branchId, id, body, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
