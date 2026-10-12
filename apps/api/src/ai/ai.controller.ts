import type {
  AI_CAPPED_FEATURES,
  AiKeyCheckRequest,
  AiSettingsEditRequest,
  AiSettingsResponse,
} from '@lucy-spa/contracts';
import { AI_EFFORT_LEVELS, AI_LIMITS, AI_MODEL_IDS } from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { AiService } from './ai.service.js';

/*
 * Only the contract's fields are accepted (the global pipe forbids unknown ones). The core validates every value again with exact rules;
 * the decorators only keep the wrong types out. Optional keys are detected by presence: an absent key leaves the stored value alone.
 */
class VersionDto {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedRowVersion!: number;
}

class SettingsEditDto extends VersionDto implements AiSettingsEditRequest {
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() rewriteEnabled?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(20) monthlyCapVnd?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  featureCapsVnd?: Partial<Record<(typeof AI_CAPPED_FEATURES)[number], string>>;
  @ApiProperty({ required: false, nullable: true })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(AI_LIMITS.vndPerUsdMin)
  @Max(AI_LIMITS.vndPerUsdMax)
  vndPerUsd?: number | null;
  @ApiProperty({ required: false, enum: AI_MODEL_IDS })
  @IsOptional()
  @IsIn(AI_MODEL_IDS as unknown as string[])
  rewriteModel?: (typeof AI_MODEL_IDS)[number];
  @ApiProperty({ required: false, enum: AI_EFFORT_LEVELS })
  @IsOptional()
  @IsIn(AI_EFFORT_LEVELS as unknown as string[])
  rewriteEffort?: (typeof AI_EFFORT_LEVELS)[number];
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(AI_LIMITS.concurrencyMax)
  concurrency?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() refusalFallback?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() allowAuthenticityClaims?: boolean;
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AI_LIMITS.bannedPhrasesMax)
  @IsString({ each: true })
  @MaxLength(AI_LIMITS.bannedPhraseMax * 2, { each: true })
  bannedPhrases?: string[];
}

class KeyCheckDto extends VersionDto implements AiKeyCheckRequest {}

@Controller('api/v1/ai')
export class AiController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(AiService) private readonly ai: AiService,
  ) {}

  @Get('settings')
  @ApiOkResponse({
    description:
      'The AI settings, the key status (never the key) and this month’s cost card (MANAGE_AI_SETTINGS, GLOBAL).',
  })
  settings(@Req() request: Request): Promise<AiSettingsResponse> {
    return this.ai.getSettings(this.session(request));
  }

  @Post('settings')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Changes the keys present; a stale expectedRowVersion is a conflict; audited.',
  })
  edit(
    @Body() body: SettingsEditDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AiSettingsResponse> {
    return this.ai.editSettings(this.session(request), body, this.requestId(response));
  }

  @Post('settings/check')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Asks the worker to test the key with a free call; the answer appears in the key status.',
  })
  check(
    @Body() body: KeyCheckDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AiSettingsResponse> {
    return this.ai.requestKeyCheck(this.session(request), body, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
