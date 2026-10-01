import type {
  MediaAssetDetail,
  MediaListResponse,
  MediaUpdateRequest,
  MediaUploadResponse,
  MediaVariantName,
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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthError } from '../auth/auth.error.js';
import { sessionCookie } from '../auth/cookies.js';
import { MultipartUpload } from '../auth/multipart-upload.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { MEDIA_LIMITS, type VariantKind } from './media.processing.js';
import { MediaService, type UploadedFile as UploadedMedia } from './media.service.js';

const MAX_VERSION = 2_147_483_647;
const VARIANTS: Record<MediaVariantName, VariantKind> = { thumb: 'THUMB', md: 'MD', lg: 'LG' };

class UploadDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(600) altVi?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(600) altEn?: string;
}

class AltDto implements MediaUpdateRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
  @ApiProperty({ nullable: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(600)
  altVi!: string | null;
  @ApiProperty({ nullable: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(600)
  altEn!: string | null;
}

/**
 * UX/UI Step 11: the website media library. `MANAGE_WEBSITE_CONTENT` is GLOBAL_ONLY, decided inside each
 * command. Uploads are multipart (declared with `@MultipartUpload()`, still Origin + session + CSRF); every
 * other mutation is JSON like the rest of the API.
 */
@Controller('api/v1/website/media')
export class MediaController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  @Get()
  @ApiOkResponse({
    description: 'The library, newest first, 24 per page (MANAGE_WEBSITE_CONTENT).',
  })
  list(
    @Req() request: Request,
    @Query('search') search?: string,
    @Query('page') page?: string,
  ): Promise<MediaListResponse> {
    if (search !== undefined && typeof search !== 'string') {
      throw new AuthError('VALIDATION_FAILED', 'search');
    }
    if (page !== undefined && !/^[0-9]{1,6}$/.test(String(page))) {
      throw new AuthError('VALIDATION_FAILED', 'page');
    }
    return this.media.list(this.session(request), {
      search,
      page: page === undefined ? undefined : Number(page),
    });
  }

  @Get(':id')
  @ApiOkResponse({ description: 'One image with where it is used (MANAGE_WEBSITE_CONTENT).' })
  get(@Param('id') id: string, @Req() request: Request): Promise<MediaAssetDetail> {
    return this.media.get(this.session(request), id);
  }

  @Get(':id/:variant')
  @ApiOkResponse({ description: 'One WebP rendition for the admin library (thumb, md or lg).' })
  async variant(
    @Param('id') id: string,
    @Param('variant') variant: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const kind = Object.hasOwn(VARIANTS, variant) ? VARIANTS[variant as MediaVariantName] : null;
    if (!kind) throw new AuthError('NOT_FOUND');
    const { stream, bytes, etag } = await this.media.variant(this.session(request), id, kind);
    response.setHeader('etag', etag);
    // Identified content, private to the signed-in admin: a short browser cache, revalidated by ETag.
    response.setHeader('cache-control', 'private, max-age=300');
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

  @Post()
  @HttpCode(200)
  @MultipartUpload()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MEDIA_LIMITS.maxBytes, files: 1, fields: 2, fieldSize: 2_048, parts: 4 },
    }),
  )
  @ApiOkResponse({
    description:
      'Upload one JPEG/PNG/WebP (multipart: file, altVi?, altEn?). A repeat of the same bytes returns the existing image.',
  })
  upload(
    @UploadedFile() file: UploadedMedia | undefined,
    @Body() body: UploadDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MediaUploadResponse> {
    return this.media.upload(
      this.session(request),
      file,
      { altVi: body.altVi, altEn: body.altEn },
      this.requestId(response),
    );
  }

  @Post(':id/alt')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Edit the alt text VI/EN of one image (MANAGE_WEBSITE_CONTENT).' })
  updateAlt(
    @Param('id') id: string,
    @Body() body: AltDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MediaAssetDetail> {
    return this.media.updateAlt(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/delete')
  @HttpCode(204)
  @ApiOkResponse({ description: 'Delete an unused image and its files (MANAGE_WEBSITE_CONTENT).' })
  async remove(
    @Param('id') id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.media.remove(this.session(request), id, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
