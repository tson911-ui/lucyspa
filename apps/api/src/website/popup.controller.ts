import type {
  PublicPopupResponse,
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
