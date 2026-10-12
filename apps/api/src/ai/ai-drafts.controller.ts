import type {
  AiDraftApplyRequest,
  AiDraftApplyResponse,
  AiDraftContent,
  AiDraftDetail,
  AiDraftEditRequest,
  AiDraftList,
  AiDraftRegenerateRequest,
  AiDraftRejectRequest,
  AiDraftRetryRequest,
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
import { AiService } from './ai.service.js';

/*
 * Claude integration Wave A (CI-R2): the review of AI drafts of product text (`USE_AI_CONTENT`, GLOBAL; apply also `MANAGE_PRODUCTS`).
 * The decorators keep wrong types out; the core validates every value again (lengths, control characters, state, row version).
 */
class VersionDto {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedRowVersion!: number;
}

class EditDto extends VersionDto implements AiDraftEditRequest {
  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  content!: AiDraftContent;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() useNameSuggestion?: boolean;
}

class ApplyDto extends VersionDto implements AiDraftApplyRequest {
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() acknowledgeWarnings?: boolean;
}

class RejectDto extends VersionDto implements AiDraftRejectRequest {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(600) reason?: string;
}

class RegenerateDto extends VersionDto implements AiDraftRegenerateRequest {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(600) instruction?: string;
}

class RetryDto extends VersionDto implements AiDraftRetryRequest {}

@Controller('api/v1/ai/product-drafts')
export class AiDraftsController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(AiService) private readonly ai: AiService,
  ) {}

  @Get()
  @ApiOkResponse({ description: 'Drafts of product text, 20 per page, with counts per status.' })
  list(
    @Req() request: Request,
    @Query('status') status?: string,
    @Query('page') page?: string,
  ): Promise<AiDraftList> {
    const parsed = page === undefined ? undefined : Number(page);
    return this.ai.listDrafts(this.session(request), {
      status,
      page: parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
    });
  }

  @Get(':id')
  @ApiOkResponse({ description: 'One draft next to the product’s current text.' })
  detail(@Param('id') id: string, @Req() request: Request): Promise<AiDraftDetail> {
    return this.ai.getDraft(this.session(request), id);
  }

  @Post(':id/view')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Records that the reviewer opened the draft (first time only).' })
  view(
    @Param('id') id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AiDraftDetail> {
    return this.ai.viewDraft(this.session(request), id, this.requestId(response));
  }

  @Post(':id/edit')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Saves the reviewer’s edit of the draft; warnings are checked again.',
  })
  edit(
    @Param('id') id: string,
    @Body() body: EditDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AiDraftDetail> {
    return this.ai.editDraft(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/apply')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Writes the draft (or its edit) to the product. Blocking warnings refuse; a product that changed since is STALE and nothing is written. Audited.',
  })
  apply(
    @Param('id') id: string,
    @Body() body: ApplyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AiDraftApplyResponse> {
    return this.ai.applyDraft(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Rejects the draft; the product is unchanged. Audited.' })
  reject(
    @Param('id') id: string,
    @Body() body: RejectDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AiDraftDetail> {
    return this.ai.rejectDraft(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/regenerate')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Queues a new draft with one line of guidance (at most 3 times).' })
  regenerate(
    @Param('id') id: string,
    @Body() body: RegenerateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AiDraftDetail> {
    return this.ai.regenerateDraft(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/retry')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Queues a failed, refused or stale item again.' })
  retry(
    @Param('id') id: string,
    @Body() body: RetryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AiDraftDetail> {
    return this.ai.retryDraft(this.session(request), id, body, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
