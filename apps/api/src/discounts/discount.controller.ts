import type {
  DiscountActiveRequest,
  DiscountCreateRequest,
  DiscountDetailResponse,
  DiscountKindName,
  DiscountListResponse,
  DiscountScopeModeName,
  DiscountScopeName,
  DiscountTerminateRequest,
  DiscountVersionInput,
  DiscountVersionRequest,
  VoucherActiveRequest,
  VoucherCreateRequest,
} from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { DiscountService } from './discount.service.js';

const MAX_VERSION = 2_147_483_647;
const VND = /^(?:0|[1-9][0-9]{0,17})$/;
const KINDS: DiscountKindName[] = ['PERCENT', 'FIXED_AMOUNT'];
const SCOPES: DiscountScopeModeName[] = ['ALL_SERVICES', 'SELECTED'];
const DISCOUNT_SCOPES: DiscountScopeName[] = ['SERVICES', 'PRODUCTS', 'BOTH'];

class VersionInputDto implements DiscountVersionInput {
  @ApiProperty({ enum: KINDS }) @IsIn(KINDS) kind!: DiscountKindName;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() percentBp?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Matches(VND) fixedAmountVnd?: string;
  @ApiProperty() @IsString() @MaxLength(40) validFrom!: string;
  @ApiProperty() @IsString() @MaxLength(40) validUntil!: string;
  @ApiProperty() @IsString() @Matches(VND) minSpendVnd!: string;
  @ApiProperty({ enum: SCOPES }) @IsIn(SCOPES) scopeMode!: DiscountScopeModeName;
  @ApiProperty() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) serviceIds!: string[];
  @ApiProperty() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) categoryIds!: string[];
  // Phase 6 P6-9 (Q7, OQ-P6-21): optional; absent means SERVICES and no product target.
  @ApiProperty({ enum: DISCOUNT_SCOPES, required: false })
  @IsOptional()
  @IsIn(DISCOUNT_SCOPES)
  scope?: DiscountScopeName;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  brandIds?: string[];
  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  productCategoryIds?: string[];
  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  productIds?: string[];
  @ApiProperty({ nullable: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsInt()
  usageLimitTotal!: number | null;
  @ApiProperty({ nullable: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsInt()
  usageLimitPerCustomer!: number | null;
}

class CreateDto implements DiscountCreateRequest {
  @ApiProperty() @IsString() @MaxLength(64) code!: string;
  @ApiProperty() @IsString() @MaxLength(400) nameVi!: string;
  @ApiProperty() @IsString() @MaxLength(400) nameEn!: string;
  @ApiProperty() @IsBoolean() requiresCode!: boolean;
  @ApiProperty({ type: VersionInputDto })
  @ValidateNested()
  @Type(() => VersionInputDto)
  version!: VersionInputDto;
}

class NewVersionDto implements DiscountVersionRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(400) nameVi?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(400) nameEn?: string;
  @ApiProperty({ type: VersionInputDto })
  @ValidateNested()
  @Type(() => VersionInputDto)
  version!: VersionInputDto;
}

class ActiveDto implements DiscountActiveRequest, VoucherActiveRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
  @ApiProperty() @IsBoolean() isActive!: boolean;
}

class TerminateDto implements DiscountTerminateRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
  @ApiProperty() @IsString() @MaxLength(2_048) reason!: string;
}

class VoucherCreateDto implements VoucherCreateRequest {
  @ApiProperty({ required: false, description: 'Omit to generate an unguessable code.' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  code?: string;
}

/**
 * Phase 4 Step 6: Owner-configured discount programs and voucher codes. `MANAGE_DISCOUNTS` and
 * `CREATE_VOUCHERS` are GLOBAL_ONLY, decided inside each command; the global guard enforces JSON, exact
 * Origin and CSRF. Staff at the POS never reach this controller's write routes.
 */
@Controller('api/v1/discounts')
export class DiscountController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(DiscountService) private readonly discounts: DiscountService,
  ) {}

  @Get()
  @ApiOkResponse({
    description:
      'Every program with its current version (MANAGE_DISCOUNTS or CREATE_VOUCHERS, GLOBAL).',
  })
  list(@Req() request: Request): Promise<DiscountListResponse> {
    return this.discounts.list(this.session(request));
  }

  @Get(':id')
  @ApiOkResponse({ description: 'One program: all versions and its voucher codes.' })
  get(@Param('id') id: string, @Req() request: Request): Promise<DiscountDetailResponse> {
    return this.discounts.get(this.session(request), id);
  }

  @Post()
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Create a program with its first version (MANAGE_DISCOUNTS, GLOBAL).',
  })
  create(
    @Body() body: CreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DiscountDetailResponse> {
    return this.discounts.create(this.session(request), body, this.requestId(response));
  }

  @Post(':id/versions')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Append an immutable version (MANAGE_DISCOUNTS, GLOBAL).' })
  addVersion(
    @Param('id') id: string,
    @Body() body: NewVersionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DiscountDetailResponse> {
    return this.discounts.addVersion(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/active')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Pause or resume a program (MANAGE_DISCOUNTS, GLOBAL).' })
  setActive(
    @Param('id') id: string,
    @Body() body: ActiveDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DiscountDetailResponse> {
    return this.discounts.setActive(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/terminate')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Terminate a program early and permanently, with a reason (MANAGE_DISCOUNTS, GLOBAL).',
  })
  terminate(
    @Param('id') id: string,
    @Body() body: TerminateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DiscountDetailResponse> {
    return this.discounts.terminate(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/vouchers')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Create a voucher code under a code-requiring program (CREATE_VOUCHERS, GLOBAL).',
  })
  createVoucher(
    @Param('id') id: string,
    @Body() body: VoucherCreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DiscountDetailResponse> {
    return this.discounts.createVoucher(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/vouchers/:voucherId/active')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Deactivate or reactivate one voucher code (CREATE_VOUCHERS, GLOBAL).',
  })
  setVoucherActive(
    @Param('id') id: string,
    @Param('voucherId') voucherId: string,
    @Body() body: ActiveDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DiscountDetailResponse> {
    return this.discounts.setVoucherActive(
      this.session(request),
      id,
      voucherId,
      body,
      this.requestId(response),
    );
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
