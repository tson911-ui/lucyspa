import type {
  WebsiteSlideEnabledRequest,
  WebsiteSlideInput,
  WebsiteSlideListResponse,
  WebsiteSlideReorderRequest,
  WebsiteSlideResponse,
  WebsiteSlideUpdateRequest,
} from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
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
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { SlideService } from './slide.service.js';

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

class SlideDto implements WebsiteSlideInput {
  @ApiProperty() @IsString() @MaxLength(36) mediaId!: string;
  @NullableText(36) mobileMediaId!: string | null;
  @NullableText(TEXT_BOUND) titleVi!: string | null;
  @NullableText(TEXT_BOUND) titleEn!: string | null;
  @NullableText(TEXT_BOUND) subtitleVi!: string | null;
  @NullableText(TEXT_BOUND) subtitleEn!: string | null;
  @NullableText(TEXT_BOUND) linkUrl!: string | null;
  @NullableText(TEXT_BOUND) linkLabelVi!: string | null;
  @NullableText(TEXT_BOUND) linkLabelEn!: string | null;
  @NullableText(TEXT_BOUND) altVi!: string | null;
  @NullableText(TEXT_BOUND) altEn!: string | null;
  @NullableText(40) @Matches(/^\d{4}-\d{2}-\d{2}T/) startsAt!: string | null;
  @NullableText(40) @Matches(/^\d{4}-\d{2}-\d{2}T/) endsAt!: string | null;
  @ApiProperty() @IsBoolean() isEnabled!: boolean;
  /** Optional: a client that knows nothing of seasons may leave it out. */
  @ApiProperty({ nullable: true, required: false, type: String })
  @ValidateIf((_object: unknown, value: unknown) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(36)
  seasonId?: string | null;
}

class SlideUpdateDto extends SlideDto implements WebsiteSlideUpdateRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
}

class SlideEnabledDto implements WebsiteSlideEnabledRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
  @ApiProperty() @IsBoolean() isEnabled!: boolean;
}

class SlideReorderDto implements WebsiteSlideReorderRequest {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(1_000)
  @IsString({ each: true })
  @MaxLength(36, { each: true })
  orderedIds!: string[];
}

/**
 * UX/UI Step 13: the homepage slider, admin side. `MANAGE_WEBSITE_CONTENT` is GLOBAL_ONLY, decided inside
 * each command. Every mutation is JSON `POST` like the rest of the API. `reorder` is declared before the
 * `:id` routes so it is never read as an id.
 */
@Controller('api/v1/website/slides')
export class SlideController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(SlideService) private readonly slides: SlideService,
  ) {}

  @Get()
  @ApiOkResponse({ description: 'Every slide in slider order with its derived status.' })
  list(@Req() request: Request): Promise<WebsiteSlideListResponse> {
    return this.slides.list(this.session(request));
  }

  @Post('reorder')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Save the whole slider order in one transaction. The ids must be exactly the existing slides (CONFLICT otherwise).',
  })
  reorder(
    @Body() body: SlideReorderDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WebsiteSlideListResponse> {
    return this.slides.reorder(this.session(request), body, this.requestId(response));
  }

  @Get(':id')
  @ApiOkResponse({ description: 'One slide (MANAGE_WEBSITE_CONTENT).' })
  get(@Param('id') id: string, @Req() request: Request): Promise<WebsiteSlideResponse> {
    return this.slides.get(this.session(request), id);
  }

  @Post()
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Create a slide at the end of the slider. More than 8 visible at once is refused (SLIDE_LIMIT).',
  })
  create(
    @Body() body: SlideDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WebsiteSlideResponse> {
    return this.slides.create(this.session(request), body, this.requestId(response));
  }

  @Post(':id/update')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Replace the content and schedule of one slide (versioned).' })
  update(
    @Param('id') id: string,
    @Body() body: SlideUpdateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WebsiteSlideResponse> {
    return this.slides.update(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/enabled')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Show or hide one slide without touching its content.' })
  setEnabled(
    @Param('id') id: string,
    @Body() body: SlideEnabledDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WebsiteSlideResponse> {
    return this.slides.setEnabled(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/delete')
  @HttpCode(204)
  @ApiOkResponse({
    description: 'Delete one slide at any time; the order closes up and the audit event keeps it.',
  })
  async remove(
    @Param('id') id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.slides.remove(this.session(request), id, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
