import type {
  ProductTextCleanupApplyRequest,
  ProductTextCleanupApplyResponse,
  ProductTextCleanupDetailResponse,
  ProductTextCleanupPreviewResponse,
} from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { ProductTextCleanupService } from './product-text-cleanup.service.js';

/*
 * Only the contract's fields are accepted (the global pipe forbids unknown ones). The core validates them again with exact rules; the
 * decorators only keep the wrong types out.
 */
class CleanupEntryDto {
  @ApiProperty() @IsString() @MaxLength(64) id!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) rowVersion!: number;
  @ApiProperty() @IsString() @MaxLength(64) textHash!: string;
}

class CleanupApplyDto implements ProductTextCleanupApplyRequest {
  @ApiProperty({ type: [CleanupEntryDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CleanupEntryDto)
  items!: CleanupEntryDto[];
}

@Controller('api/v1/product-text-cleanup')
export class ProductTextCleanupController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(ProductTextCleanupService) private readonly cleanup: ProductTextCleanupService,
  ) {}

  @Get('preview')
  @ApiOkResponse({
    description:
      'The products whose description still carries the supplier’s customer comments (MANAGE_PRODUCTS). Read only.',
  })
  preview(@Req() request: Request): Promise<ProductTextCleanupPreviewResponse> {
    return this.cleanup.preview(this.session(request));
  }

  @Get('preview/:id')
  @ApiOkResponse({ description: 'The current and the cleaned description of one product.' })
  detail(
    @Param('id') id: string,
    @Req() request: Request,
  ): Promise<ProductTextCleanupDetailResponse> {
    return this.cleanup.detail(this.session(request), id);
  }

  @Post('apply')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Removes the comments from the listed products (up to 100) that have not changed since the preview; audited with the full before and after text.',
  })
  apply(
    @Body() body: CleanupApplyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductTextCleanupApplyResponse> {
    return this.cleanup.apply(this.session(request), body, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
