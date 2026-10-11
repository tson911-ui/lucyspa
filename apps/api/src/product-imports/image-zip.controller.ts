import type { ProductImageZipResponse } from '@lucy-spa/contracts';
import { IMAGE_ZIP_LIMITS } from '@lucy-spa/server';
import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { MultipartUpload } from '../auth/multipart-upload.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { ProductImageZipService, type UploadedZip } from './image-zip.service.js';

class ApplyDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(80) sha256?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(8) allowPublished?: string;
}

const UPLOAD = {
  limits: { fileSize: IMAGE_ZIP_LIMITS.maxBytes, files: 1, fields: 3, fieldSize: 256, parts: 5 },
};

/** Phase 9 P9-8: pictures from a ZIP named after the SKU (IMPORT_PRODUCT_DATA and MANAGE_PRODUCTS). Both steps are POSTs with the CSRF token. */
@Controller('api/v1/product-image-imports')
export class ProductImageZipController {
  constructor(
    @Inject(ProductImageZipService) private readonly zips: ProductImageZipService,
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
  ) {}

  @Post('preview')
  @HttpCode(200)
  @MultipartUpload()
  @UseInterceptors(FileInterceptor('file', UPLOAD))
  @ApiOkResponse({
    description:
      'Reads a ZIP of pictures named after the SKU and says what would be added. Saves nothing.',
  })
  preview(
    @UploadedFile() file: UploadedZip | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductImageZipResponse> {
    return this.zips.preview(this.session(request), file, this.requestId(response));
  }

  @Post('apply')
  @HttpCode(200)
  @MultipartUpload()
  @UseInterceptors(FileInterceptor('file', UPLOAD))
  @ApiOkResponse({
    description:
      'Adds the pictures of the previewed ZIP (multipart: file, sha256 of the previewed file, allowPublished true|false). Only adds.',
  })
  apply(
    @UploadedFile() file: UploadedZip | undefined,
    @Body() body: ApplyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductImageZipResponse> {
    return this.zips.apply(
      this.session(request),
      file,
      { sha256: body.sha256, allowPublished: body.allowPublished },
      this.requestId(response),
    );
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
