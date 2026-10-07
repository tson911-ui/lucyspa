import type {
  PublicPopupResponse,
  PublicProductCodesResponse,
  PublicProductDetailResponse,
  PublicProductsResponse,
  PublicSeasonResponse,
  PublicServiceDetailResponse,
  PublicServicesResponse,
  PublicSiteResponse,
  PublicSlidesResponse,
  WebsitePopupEnabledRequest,
  WebsitePopupInput,
  WebsitePopupListResponse,
  WebsitePopupResponse,
  WebsitePopupUpdateRequest,
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
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { Request, Response } from 'express';
import { AuthError } from '../auth/auth.error.js';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { parsePublicProductsQuery } from '../products/public-products.logic.js';
import { VARIANT_KINDS, type VariantKind } from './media.processing.js';
import { PopupService, PublicWebsiteService } from './popup.service.js';

const MAX_VERSION = 2_147_483_647;
const VARIANTS: Readonly<Record<string, VariantKind>> = { thumb: 'THUMB', md: 'MD', lg: 'LG' };
// Bounds the body before the core normalizes it; the DB and the core hold the real limits.
const TEXT_BOUND = 1_200;

/** `string | null`, never `undefined`: the form always sends every field. */
const NullableText = (max: number) => (target: object, key: string) => {
  ApiProperty({ nullable: true, type: String })(target, key);
  ValidateIf((_object: unknown, value: unknown) => value !== null)(target, key);
  IsString()(target, key);
  MaxLength(max)(target, key);
};

class PopupDto implements WebsitePopupInput {
  @NullableText(36) mediaId!: string | null;
  @NullableText(TEXT_BOUND) titleVi!: string | null;
  @NullableText(TEXT_BOUND) titleEn!: string | null;
  @NullableText(TEXT_BOUND) bodyVi!: string | null;
  @NullableText(TEXT_BOUND) bodyEn!: string | null;
  @NullableText(TEXT_BOUND) ctaLabelVi!: string | null;
  @NullableText(TEXT_BOUND) ctaLabelEn!: string | null;
  @NullableText(TEXT_BOUND) ctaUrl!: string | null;
  @ApiProperty() @IsString() @MaxLength(40) @Matches(/^\d{4}-\d{2}-\d{2}T/) startsAt!: string;
  @ApiProperty() @IsString() @MaxLength(40) @Matches(/^\d{4}-\d{2}-\d{2}T/) endsAt!: string;
  @ApiProperty() @IsBoolean() isEnabled!: boolean;
  /** Optional: a client that knows nothing of seasons may leave it out. */
  @ApiProperty({ nullable: true, required: false, type: String })
  @ValidateIf((_object: unknown, value: unknown) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(36)
  seasonId?: string | null;
}

class PopupUpdateDto extends PopupDto implements WebsitePopupUpdateRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
}

class PopupEnabledDto implements WebsitePopupEnabledRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
  @ApiProperty() @IsBoolean() isEnabled!: boolean;
}

/**
 * UX/UI Step 12: the promotional popup, admin side. `MANAGE_WEBSITE_CONTENT` is GLOBAL_ONLY, decided inside
 * each command. Every mutation is JSON `POST` like the rest of the API.
 */
@Controller('api/v1/website/popups')
export class PopupController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(PopupService) private readonly popups: PopupService,
  ) {}

  @Get()
  @ApiOkResponse({ description: 'Every popup with its derived status (MANAGE_WEBSITE_CONTENT).' })
  list(@Req() request: Request): Promise<WebsitePopupListResponse> {
    return this.popups.list(this.session(request));
  }

  @Get(':id')
  @ApiOkResponse({ description: 'One popup (MANAGE_WEBSITE_CONTENT).' })
  get(@Param('id') id: string, @Req() request: Request): Promise<WebsitePopupResponse> {
    return this.popups.get(this.session(request), id);
  }

  @Post()
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Create a popup. An enabled popup that overlaps another enabled popup is refused (POPUP_OVERLAP).',
  })
  create(
    @Body() body: PopupDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WebsitePopupResponse> {
    return this.popups.create(this.session(request), body, this.requestId(response));
  }

  @Post(':id/update')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Replace the content and schedule of one popup (versioned).' })
  update(
    @Param('id') id: string,
    @Body() body: PopupUpdateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WebsitePopupResponse> {
    return this.popups.update(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/enabled')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Publish or unpublish one popup without touching its content.' })
  setEnabled(
    @Param('id') id: string,
    @Body() body: PopupEnabledDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WebsitePopupResponse> {
    return this.popups.setEnabled(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/delete')
  @HttpCode(204)
  @ApiOkResponse({
    description: 'Delete one popup at any time; the audit event keeps its content.',
  })
  async remove(
    @Param('id') id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.popups.remove(this.session(request), id, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}

/**
 * UX/UI Step 12: what the public website reads, anonymously and read-only (design 16.3, 16.5). No session,
 * no cookie, nothing that reveals a draft.
 */
@Controller('api/v1/public')
export class PublicWebsiteController {
  constructor(@Inject(PublicWebsiteService) private readonly website: PublicWebsiteService) {}

  @Get('website/popup')
  @ApiOkResponse({
    description:
      'The one popup that is live now in the visitor language (`locale=vi|en`), or 204. Cached for 60 seconds.',
  })
  async popup(
    @Query('locale') locale: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicPopupResponse | undefined> {
    if (locale !== 'vi' && locale !== 'en') throw new AuthError('VALIDATION_FAILED', 'locale');
    const popup = await this.website.popup(locale);
    // `Vary` keeps a shared cache from handing one language to the other; nothing here is per person.
    response.setHeader('cache-control', 'public, max-age=60');
    response.setHeader('vary', 'Accept-Encoding');
    if (!popup) {
      response.status(204);
      return undefined;
    }
    return popup;
  }

  @Get('website/season')
  @ApiOkResponse({
    description:
      'The one season that is live now in the visitor language (`locale=vi|en`), or 204. No cookie, no personal data. Cached for 60 seconds.',
  })
  async season(
    @Query('locale') locale: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicSeasonResponse | undefined> {
    if (locale !== 'vi' && locale !== 'en') throw new AuthError('VALIDATION_FAILED', 'locale');
    const season = await this.website.season(locale);
    response.setHeader('cache-control', 'public, max-age=60');
    response.setHeader('vary', 'Accept-Encoding');
    if (!season) {
      response.status(204);
      return undefined;
    }
    return season;
  }

  @Get('website/slides')
  @ApiOkResponse({
    description:
      'The slides that are visible now, in order and in the visitor language (`locale=vi|en`, at most 8, possibly none). Cached for 60 seconds.',
  })
  async slides(
    @Query('locale') locale: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicSlidesResponse> {
    if (locale !== 'vi' && locale !== 'en') throw new AuthError('VALIDATION_FAILED', 'locale');
    const items = await this.website.slides(locale);
    response.setHeader('cache-control', 'public, max-age=60');
    response.setHeader('vary', 'Accept-Encoding');
    return { items };
  }

  @Get('site')
  @ApiOkResponse({
    description:
      'The shop profile in the visitor language (`locale=vi|en`): tagline, address, hotline, map link, grouped opening hours of the shop branch and the hero image. Cached for 60 seconds.',
  })
  async site(
    @Query('locale') locale: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicSiteResponse> {
    if (locale !== 'vi' && locale !== 'en') throw new AuthError('VALIDATION_FAILED', 'locale');
    const site = await this.website.site(locale);
    response.setHeader('cache-control', 'public, max-age=60');
    response.setHeader('vary', 'Accept-Encoding');
    return site;
  }

  @Get('services')
  @ApiOkResponse({
    description:
      'The service catalogue in the visitor language: groups with their active services, price range, per-nail flag and customer-facing time estimate. The internal scheduling duration is never included. Cached for 60 seconds.',
  })
  async services(
    @Query('locale') locale: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicServicesResponse> {
    if (locale !== 'vi' && locale !== 'en') throw new AuthError('VALIDATION_FAILED', 'locale');
    const catalogue = await this.website.services(locale);
    response.setHeader('cache-control', 'public, max-age=60');
    response.setHeader('vary', 'Accept-Encoding');
    return catalogue;
  }

  @Get('services/:code')
  @ApiOkResponse({
    description:
      'One visible service by its code with its group and the other services of that group; 404 for an unknown, inactive or unavailable service. Cached for 60 seconds.',
  })
  async serviceDetail(
    @Param('code') code: string,
    @Query('locale') locale: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicServiceDetailResponse> {
    if (locale !== 'vi' && locale !== 'en') throw new AuthError('VALIDATION_FAILED', 'locale');
    const detail = await this.website.serviceDetail(locale, code);
    response.setHeader('cache-control', 'public, max-age=60');
    response.setHeader('vary', 'Accept-Encoding');
    return detail;
  }

  @Get('products')
  @ApiOkResponse({
    description:
      'One page of the cosmetics catalog (`locale=vi|en`, `q`, `category`, `brand`, `sort=featured|newest|price_asc|price_desc`, `page`; 20 per page) with the categories and brands that hold products and the Owner-written hero and commitment box. Only published, priced products; stock is a state, never a quantity; no cost. Cached for 60 seconds.',
  })
  async products(
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicProductsResponse> {
    const locale = query['locale'];
    if (locale !== 'vi' && locale !== 'en') throw new AuthError('VALIDATION_FAILED', 'locale');
    const result = await this.website.products(locale, parsePublicProductsQuery(query));
    response.setHeader('cache-control', 'public, max-age=60');
    response.setHeader('vary', 'Accept-Encoding');
    return result;
  }

  @Get('products/codes')
  @ApiOkResponse({
    description:
      'The codes of every visible product (at most 5000), for the sitemap. Cached for 60 seconds.',
  })
  async productCodes(
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicProductCodesResponse> {
    const codes = await this.website.productCodes();
    response.setHeader('cache-control', 'public, max-age=60');
    response.setHeader('vary', 'Accept-Encoding');
    return codes;
  }

  @Get('products/:code')
  @ApiOkResponse({
    description:
      'One visible product by its code with its variants, pictures and related products; 404 for a draft, discontinued or unknown product. Cached for 60 seconds.',
  })
  async productDetail(
    @Param('code') code: string,
    @Query('locale') locale: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicProductDetailResponse> {
    if (locale !== 'vi' && locale !== 'en') throw new AuthError('VALIDATION_FAILED', 'locale');
    const detail = await this.website.productDetail(locale, code);
    response.setHeader('cache-control', 'public, max-age=60');
    response.setHeader('vary', 'Accept-Encoding');
    return detail;
  }

  @Get('media/:id/:variant')
  @ApiOkResponse({
    description:
      'One WebP rendition of an image that live website content uses; any other image is 404.',
  })
  async variant(
    @Param('id') id: string,
    @Param('variant') variant: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const kind = Object.hasOwn(VARIANTS, variant) ? VARIANTS[variant] : undefined;
    if (!kind || !VARIANT_KINDS.includes(kind)) throw new AuthError('NOT_FOUND');
    const { stream, bytes, etag } = await this.website.variant(id, kind);
    response.setHeader('etag', etag);
    // Content-addressed by the file's own hash and never edited in place (a new upload is a new id).
    response.setHeader('cache-control', 'public, max-age=31536000, immutable');
    response.setHeader('x-content-type-options', 'nosniff');
    if (request.headers['if-none-match'] === etag) {
      stream.destroy();
      response.status(304).end();
      return;
    }
    response.setHeader('content-type', 'image/webp');
    response.setHeader('content-length', String(bytes));
    response.setHeader('content-disposition', 'inline');
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  }
}
