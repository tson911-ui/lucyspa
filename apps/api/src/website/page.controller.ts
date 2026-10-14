import type {
  WebsitePageInput,
  WebsitePageListResponse,
  WebsitePagePublishRequest,
  WebsitePageResponse,
  WebsitePageRole,
  WebsitePageUpdateRequest,
} from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { PageService } from './page.service.js';

const MAX_VERSION = 2_147_483_647;
// Bounds the body before the core normalizes it (UTF-16 units; the core and the database hold the real limits in code points).
const BODY_BOUND = 14_000;
const SHORT_BOUND = 400;

/** `string | null`, never `undefined`: the form always sends every field. */
const NullableText = (max: number) => (target: object, key: string) => {
  ApiProperty({ nullable: true, type: String })(target, key);
  ValidateIf((_object: unknown, value: unknown) => value !== null)(target, key);
  IsString()(target, key);
  MaxLength(max)(target, key);
};

class PageDto implements WebsitePageInput {
  @ApiProperty() @IsString() @MaxLength(120) slug!: string;
  @ApiProperty({ enum: ['INFO', 'POLICY', 'TERMS', 'PRIVACY'] })
  @IsIn(['INFO', 'POLICY', 'TERMS', 'PRIVACY'])
  role!: WebsitePageRole;
  @ApiProperty() @IsString() @MaxLength(SHORT_BOUND) titleVi!: string;
  @NullableText(SHORT_BOUND) titleEn!: string | null;
  @ApiProperty() @IsString() @MaxLength(BODY_BOUND) bodyVi!: string;
  @NullableText(BODY_BOUND) bodyEn!: string | null;
  @NullableText(SHORT_BOUND) seoTitleVi!: string | null;
  @NullableText(SHORT_BOUND) seoTitleEn!: string | null;
  @NullableText(SHORT_BOUND * 2) seoDescriptionVi!: string | null;
  @NullableText(SHORT_BOUND * 2) seoDescriptionEn!: string | null;
  @ApiProperty() @IsBoolean() isPublished!: boolean;
}

class PageUpdateDto extends PageDto implements WebsitePageUpdateRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
}

class PagePublishDto implements WebsitePagePublishRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
  @ApiProperty() @IsBoolean() isPublished!: boolean;
}

/**
 * Session 7b: the information pages, admin side. `MANAGE_WEBSITE_CONTENT` is GLOBAL_ONLY, decided inside each command. Every
 * mutation is JSON `POST` like the rest of the API. A page is unpublished, never deleted.
 */
@Controller('api/v1/website/pages')
export class PageController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(PageService) private readonly pages: PageService,
  ) {}

  @Get()
  @ApiOkResponse({ description: 'Every page, newest change first (MANAGE_WEBSITE_CONTENT).' })
  list(@Req() request: Request): Promise<WebsitePageListResponse> {
    return this.pages.list(this.session(request));
  }

  @Get(':id')
  @ApiOkResponse({ description: 'One page with its full text (MANAGE_WEBSITE_CONTENT).' })
  get(@Param('id') id: string, @Req() request: Request): Promise<WebsitePageResponse> {
    return this.pages.get(this.session(request), id);
  }

  @Post()
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Create a page. A taken address is 409 `slug`; a second published terms or privacy page is 409 PAGE_ROLE_TAKEN.',
  })
  create(
    @Body() body: PageDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WebsitePageResponse> {
    return this.pages.create(this.session(request), body, this.requestId(response));
  }

  @Post(':id/update')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Replace the text and settings of one page (versioned).' })
  update(
    @Param('id') id: string,
    @Body() body: PageUpdateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WebsitePageResponse> {
    return this.pages.update(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/publish')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Publish or unpublish one page without touching its text.' })
  publish(
    @Param('id') id: string,
    @Body() body: PagePublishDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WebsitePageResponse> {
    return this.pages.setPublished(this.session(request), id, body, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
