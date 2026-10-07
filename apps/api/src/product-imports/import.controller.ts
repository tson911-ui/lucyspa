import type {
  ProductImportApplyRequest,
  ProductImportCancelRequest,
  ProductImportDetailResponse,
  ProductImportListResponse,
} from '@lucy-spa/contracts';
import { IMPORT_LIMITS } from '@lucy-spa/server';
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
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { MultipartUpload } from '../auth/multipart-upload.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { ProductImportService, type UploadedSheet } from './import.service.js';

/** Only the contract's fields are accepted; the exact rules (kind, branch, versions) are applied again in the service and core. */
class UploadDto {
  @ApiProperty() @IsString() @MaxLength(20) kind!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(40) branchId?: string;
}

class ApplyDto implements ProductImportApplyRequest {
  @ApiProperty() @IsInt() expectedRowVersion!: number;
  @ApiProperty() @IsBoolean() skipInvalid!: boolean;
}

class CancelDto implements ProductImportCancelRequest {
  @ApiProperty() @IsInt() expectedRowVersion!: number;
}

/** Phase 6 P6-5: Excel/CSV import (IMPORT_PRODUCT_DATA). Reads are GET, every write is POST with the CSRF token. */
@Controller('api/v1/product-imports')
export class ProductImportController {
  constructor(
    @Inject(ProductImportService) private readonly imports: ProductImportService,
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
  ) {}

  @Get()
  @ApiOkResponse({
    description: 'The import jobs, the branches an opening-stock file may name and the limits.',
  })
  list(@Req() request: Request): Promise<ProductImportListResponse> {
    return this.imports.list(this.session(request));
  }

  @Get('template')
  @ApiOkResponse({
    description: 'A template file: ?kind=CATALOG|OPENING_STOCK&format=xlsx|csv&lang=vi|en.',
  })
  async template(
    @Query('kind') kind: string,
    @Query('format') format: string,
    @Query('lang') lang: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.imports.template(this.session(request), kind, format, lang ?? 'vi');
    response.setHeader('content-type', file.contentType);
    response.setHeader('content-length', String(file.bytes.length));
    response.setHeader('content-disposition', `attachment; filename="${file.filename}"`);
    response.setHeader('cache-control', 'no-store');
    response.end(Buffer.from(file.bytes));
  }

  @Get(':id')
  @ApiOkResponse({
    description: 'One job with its rows (price and cost cells only for who may see them).',
  })
  detail(@Param('id') id: string, @Req() request: Request): Promise<ProductImportDetailResponse> {
    return this.imports.detail(this.session(request), id);
  }

  @Post()
  @HttpCode(200)
  @MultipartUpload()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: IMPORT_LIMITS.maxBytes, files: 1, fields: 2, fieldSize: 2_048, parts: 4 },
    }),
  )
  @ApiOkResponse({
    description:
      'Upload a .xlsx or .csv (multipart: file, kind, branchId?): returns the PREVIEW, saves nothing else.',
  })
  upload(
    @UploadedFile() file: UploadedSheet | undefined,
    @Body() body: UploadDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductImportDetailResponse> {
    return this.imports.upload(
      this.session(request),
      file,
      { kind: body.kind, branchId: body.branchId },
      this.requestId(response),
    );
  }

  @Post(':id/apply')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Apply a previewed job (explicit confirmation; invalid rows are skipped only with skipInvalid).',
  })
  apply(
    @Param('id') id: string,
    @Body() body: ApplyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductImportDetailResponse> {
    return this.imports.apply(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Cancel a previewed job; nothing was written.' })
  cancel(
    @Param('id') id: string,
    @Body() body: CancelDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductImportDetailResponse> {
    return this.imports.cancel(this.session(request), id, body, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
