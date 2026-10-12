import { AI_RUN_SCOPES } from '@lucy-spa/contracts';
import type {
  AiRunCommandRequest,
  AiRunCreateRequest,
  AiRunList,
  AiRunPreview,
  AiRunRow,
  AiRunUnlockRequest,
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
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { AiService } from './ai.service.js';

/*
 * Claude integration Wave A (CI-R3): the runs that write drafts of product text (`USE_AI_CONTENT`, GLOBAL; unlocking is
 * `MANAGE_AI_SETTINGS`). Starting a run makes no call to Anthropic; the worker does the calls.
 */
class VersionDto {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedRowVersion!: number;
}

class CreateDto implements AiRunCreateRequest {
  @ApiProperty({ enum: AI_RUN_SCOPES }) @IsIn(AI_RUN_SCOPES) scope!: AiRunCreateRequest['scope'];
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  productIds?: string[];
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(1) @Max(400) limit?: number;
}

class CommandDto extends VersionDto implements AiRunCommandRequest {}
class UnlockDto extends VersionDto implements AiRunUnlockRequest {}

@Controller('api/v1/ai/product-runs')
export class AiRunsController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(AiService) private readonly ai: AiService,
  ) {}

  @Get()
  @ApiOkResponse({
    description: 'The latest runs with their item counts, and what starting more needs.',
  })
  list(@Req() request: Request): Promise<AiRunList> {
    return this.ai.listRuns(this.session(request));
  }

  @Get('preview')
  @ApiOkResponse({
    description:
      'What a run would take, its most likely cost, the cap left and why it cannot start.',
  })
  preview(
    @Req() request: Request,
    @Query('scope') scope?: string,
    @Query('limit') limit?: string,
  ): Promise<AiRunPreview> {
    const parsed = limit === undefined ? undefined : Number(limit);
    return this.ai.previewRun(this.session(request), {
      scope,
      limit: parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
      productIds: undefined,
    });
  }

  @Post()
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Starts a run: writes the run and its items; makes no call to Anthropic. Audited.',
  })
  create(
    @Body() body: CreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AiRunRow> {
    return this.ai.createRun(this.session(request), body, this.requestId(response));
  }

  @Post('unlock')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      '"Cho phép chạy tiếp": after three drafts were judged, runs of more than three are allowed (MANAGE_AI_SETTINGS).',
  })
  unlock(
    @Body() body: UnlockDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AiRunList> {
    return this.ai.unlockRuns(this.session(request), body, this.requestId(response));
  }

  @Post(':id/pause')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Pauses an open run; drafts already written stay.' })
  pause(
    @Param('id') id: string,
    @Body() body: CommandDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AiRunRow> {
    return this.ai.commandRun(this.session(request), id, 'pause', body, this.requestId(response));
  }

  @Post(':id/resume')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Resumes a paused run.' })
  resume(
    @Param('id') id: string,
    @Body() body: CommandDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AiRunRow> {
    return this.ai.commandRun(this.session(request), id, 'resume', body, this.requestId(response));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Cancels a run; queued items are released, written drafts stay.' })
  cancel(
    @Param('id') id: string,
    @Body() body: CommandDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AiRunRow> {
    return this.ai.commandRun(this.session(request), id, 'cancel', body, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
