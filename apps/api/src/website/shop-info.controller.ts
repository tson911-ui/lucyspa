import type {
  WebsiteWhyCard,
  WebsiteFeaturedGroup,
  WebsiteFooterBlock,
  WebsiteShopFact,
  WebsiteShopInfoResponse,
  WebsiteShopInfoUpdateRequest,
} from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { ShopInfoService } from './shop-info.service.js';

const MAX_VERSION = 2_147_483_647;
// Bounds the body before the core normalizes it; the DB and the core hold the real limits.
const TEXT_BOUND = 1_200;

/** `string | null`, never `undefined`: the form always sends every field. */
const NullableText = (max: number) => (target: object, key: string) => {
  ApiProperty({ nullable: true, type: String })(target, key);
  ValidateIf((_object: unknown, value: unknown) => value !== null)(target, key);
  IsString()(target, key);
  MaxLength(max)(target, key);
};

class ShopInfoUpdateDto implements WebsiteShopInfoUpdateRequest {
  @ApiProperty() @IsString() @MaxLength(TEXT_BOUND) taglineVi!: string;
  @ApiProperty() @IsString() @MaxLength(TEXT_BOUND) taglineEn!: string;
  @NullableText(TEXT_BOUND) introVi!: string | null;
  @NullableText(TEXT_BOUND) introEn!: string | null;
  @ApiProperty() @IsString() @MaxLength(TEXT_BOUND) address!: string;
  @ApiProperty() @IsString() @MaxLength(100) hotline!: string;
  @NullableText(TEXT_BOUND) mapUrl!: string | null;
  @NullableText(TEXT_BOUND) facebookUrl!: string | null;
  @NullableText(TEXT_BOUND) zaloContact!: string | null;
  @NullableText(36) hoursBranchId!: string | null;
  @NullableText(36) heroMediaId!: string | null;
  @ApiProperty() @IsBoolean() factsVisible!: boolean;
  // Bounded here; the core checks every item and names `facts` / `featuredGroups` when one is refused.
  @ApiProperty({ type: [Object] }) @IsArray() @ArrayMaxSize(32) facts!: WebsiteShopFact[];
  @ApiProperty({ type: [Object] })
  @IsArray()
  @ArrayMaxSize(32)
  featuredGroups!: WebsiteFeaturedGroup[];
  @ApiProperty() @IsBoolean() whyVisible!: boolean;
  @NullableText(TEXT_BOUND) whyTitleVi!: string | null;
  @NullableText(TEXT_BOUND) whyTitleEn!: string | null;
  @ApiProperty({ type: [Object] }) @IsArray() @ArrayMaxSize(32) whyCards!: WebsiteWhyCard[];
  // Bounded here; the core checks every block and names `footerBlocks` when one is refused.
  @ApiProperty({ type: [Object] })
  @IsArray()
  @ArrayMaxSize(32)
  footerBlocks!: WebsiteFooterBlock[];
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
}

/**
 * UX/UI Part 2 (P2-2): the public shop profile, admin side. `MANAGE_WEBSITE_CONTENT` is GLOBAL_ONLY, decided
 * inside each command. The mutation is a JSON `POST` like the rest of the API.
 */
@Controller('api/v1/website/shop-info')
export class ShopInfoController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(ShopInfoService) private readonly shopInfo: ShopInfoService,
  ) {}

  @Get()
  @ApiOkResponse({
    description:
      'The shop profile, the branches the hours can come from and a preview of the hours (MANAGE_WEBSITE_CONTENT).',
  })
  get(@Req() request: Request): Promise<WebsiteShopInfoResponse> {
    return this.shopInfo.get(this.session(request));
  }

  @Post()
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Replace the shop profile (versioned; a stale version is CONFLICT).',
  })
  update(
    @Body() body: ShopInfoUpdateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WebsiteShopInfoResponse> {
    return this.shopInfo.update(this.session(request), body, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
