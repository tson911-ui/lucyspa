import type {
  WebsiteSeasonEnabledRequest,
  WebsiteSeasonInput,
  WebsiteSeasonListResponse,
  WebsiteSeasonResponse,
  WebsiteSeasonUpdateRequest,
} from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
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
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { SeasonService } from './season.service.js';

const MAX_VERSION = 2_147_483_647;
// Bounds the body before the core normalizes it; the DB and the core hold the real limits.
const TEXT_BOUND = 400;

/** `string | null`, never `undefined`: the form always sends every field. */
const NullableText = (max: number) => (target: object, key: string) => {
  ApiProperty({ nullable: true, type: String })(target, key);
  ValidateIf((_object: unknown, value: unknown) => value !== null)(target, key);
  IsString()(target, key);
  MaxLength(max)(target, key);
};

class SeasonDto implements WebsiteSeasonInput {
  @ApiProperty() @IsString() @MaxLength(40) presetKey!: string;
  @ApiProperty() @IsString() @MaxLength(TEXT_BOUND) label!: string;
  @ApiProperty() @IsString() @MaxLength(40) @Matches(/^\d{4}-\d{2}-\d{2}T/) startsAt!: string;
  @ApiProperty() @IsString() @MaxLength(40) @Matches(/^\d{4}-\d{2}-\d{2}T/) endsAt!: string;
  @NullableText(TEXT_BOUND) greetingVi!: string | null;
  @NullableText(TEXT_BOUND) greetingEn!: string | null;
  @ApiProperty() @IsBoolean() applyCustomer!: boolean;
  @ApiProperty() @IsBoolean() applyAdmin!: boolean;
  @ApiProperty() @IsBoolean() particlesEnabled!: boolean;
  @ApiProperty() @IsBoolean() isEnabled!: boolean;
}

class SeasonUpdateDto extends SeasonDto implements WebsiteSeasonUpdateRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
}

class SeasonEnabledDto implements WebsiteSeasonEnabledRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
  @ApiProperty() @IsBoolean() isEnabled!: boolean;
}

/**
 * UX/UI Step S3: seasonal themes, admin side. `MANAGE_WEBSITE_CONTENT` is GLOBAL_ONLY, decided inside each
 * command. Every mutation is JSON `POST` like the rest of the API.
 */
@Controller('api/v1/website/seasons')
export class SeasonController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(SeasonService) private readonly seasons: SeasonService,
  ) {}

  @Get()
  @ApiOkResponse({ description: 'Every season with its derived status (MANAGE_WEBSITE_CONTENT).' })
  list(@Req() request: Request): Promise<WebsiteSeasonListResponse> {
    return this.seasons.list(this.session(request));
  }

  @Get(':id')
  @ApiOkResponse({ description: 'One season (MANAGE_WEBSITE_CONTENT).' })
  get(@Param('id') id: string, @Req() request: Request): Promise<WebsiteSeasonResponse> {
    return this.seasons.get(this.session(request), id);
  }

  @Post()
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Create a season. An enabled season that overlaps another enabled season is refused (SEASON_OVERLAP).',
  })
  create(
    @Body() body: SeasonDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WebsiteSeasonResponse> {
    return this.seasons.create(this.session(request), body, this.requestId(response));
  }

  @Post(':id/update')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Replace the look and schedule of one season (versioned); the popups and slides that follow it move with it.',
  })
  update(
    @Param('id') id: string,
    @Body() body: SeasonUpdateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WebsiteSeasonResponse> {
    return this.seasons.update(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/enabled')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Switch one season on or off without touching its content.' })
  setEnabled(
    @Param('id') id: string,
    @Body() body: SeasonEnabledDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WebsiteSeasonResponse> {
    return this.seasons.setEnabled(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/delete')
  @HttpCode(204)
  @ApiOkResponse({
    description:
      'Delete one season at any time; the popups and slides that follow it are unlinked and hidden, and the audit events keep what was removed.',
  })
  async remove(
    @Param('id') id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.seasons.remove(this.session(request), id, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
