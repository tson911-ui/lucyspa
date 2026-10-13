import type {
  AiSeoApplyResponse,
  AiSeoContent,
  AiSeoCreateRequest,
  AiSeoCreateResponse,
  AiSeoDetail,
  AiSeoList,
  AiSeoPreview,
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
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { AiSeoService } from './ai-seo.service.js';

/*
 * Claude integration Wave B (CI-E1): the drafts of search descriptions and English texts for services and the home page
 * (`USE_AI_CONTENT`, GLOBAL; applying also `MANAGE_SERVICES` or `MANAGE_WEBSITE_CONTENT`). The decorators keep wrong types out; the core
 * validates every value again (lengths, control characters, state, row version).
 */
class VersionDto {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedRowVersion!: number;
}

class CreateDto implements AiSeoCreateRequest {
  @ApiProperty({ enum: ['MISSING_SERVICES', 'SERVICES', 'SHOP'] })
  @IsIn(['MISSING_SERVICES', 'SERVICES', 'SHOP'])
  scope!: AiSeoCreateRequest['scope'];
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  serviceIds?: string[];
}

class EditDto extends VersionDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  content!: AiSeoContent;
}

class ApplyDto extends VersionDto {}

class RejectDto extends VersionDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(600) reason?: string;
}

class RegenerateDto extends VersionDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(600) instruction?: string;
}

@Controller('api/v1/ai/seo-drafts')
export class AiSeoController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(AiSeoService) private readonly seo: AiSeoService,
  ) {}

  @Get()
  @ApiOkResponse({ description: 'Search-description drafts, 20 per page, with counts per status.' })
  list(
    @Req() request: Request,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
    @Query('page') page?: string,
  ): Promise<AiSeoList> {
    const parsed = page === undefined ? undefined : Number(page);
    return this.seo.list(this.session(request), {
      status,
      kind,
      page: parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
    });
  }

  @Get('preview')
  @ApiOkResponse({
    description: 'What creating drafts for a scope would queue and cost, and why it cannot.',
  })
  preview(
    @Req() request: Request,
    @Query('scope') scope?: string,
    @Query('serviceIds') serviceIds?: string,
  ): Promise<AiSeoPreview> {
    return this.seo.preview(this.session(request), {
      scope,
      serviceIds: serviceIds === undefined ? undefined : serviceIds.split(',').filter(Boolean),
    });
  }

  @Post()
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Queues drafts (no call to Anthropic, nothing changes); the worker writes them.',
  })
  create(
    @Body() body: CreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AiSeoCreateResponse> {
    return this.seo.create(this.session(request), body, this.requestId(response));
  }

  @Get(':id')
  @ApiOkResponse({ description: 'One draft next to the target’s current text.' })
  detail(@Param('id') id: string, @Req() request: Request): Promise<AiSeoDetail> {
    return this.seo.detail(this.session(request), id);
  }

  @Post(':id/edit')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Saves the reviewer’s edit; warnings are checked again.' })
  edit(
    @Param('id') id: string,
    @Body() body: EditDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AiSeoDetail> {
    return this.seo.edit(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/apply')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Writes the draft (or its edit) to the service or the shop profile. Blocking notes refuse; a target that changed since is STALE and nothing is written. Audited.',
  })
  apply(
    @Param('id') id: string,
    @Body() body: ApplyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AiSeoApplyResponse> {
    return this.seo.apply(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Rejects the draft; the target is unchanged. Audited.' })
  reject(
    @Param('id') id: string,
    @Body() body: RejectDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AiSeoDetail> {
    return this.seo.reject(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/regenerate')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Queues a new draft with one line of guidance (at most 3 times).' })
  regenerate(
    @Param('id') id: string,
    @Body() body: RegenerateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AiSeoDetail> {
    return this.seo.regenerate(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/retry')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Queues a failed, refused or stale draft again.' })
  retry(
    @Param('id') id: string,
    @Body() body: VersionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AiSeoDetail> {
    return this.seo.retry(this.session(request), id, body, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
