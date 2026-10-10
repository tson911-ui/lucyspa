import type {
  SupplierApproveReadyRequest,
  SupplierApproveReadyResponse,
  SupplierCandidateApproveRequest,
  SupplierCandidateApproveResponse,
  SupplierCandidateDecideRequest,
  SupplierCandidateDecideResponse,
  SupplierCandidateDetailResponse,
  SupplierCandidateEditRequest,
  SupplierCandidateImageDecisionRequest,
  SupplierCandidateKeepSeparateRequest,
  SupplierCandidateListResponse,
  SupplierMappingRequest,
  SupplierMappingResponse,
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
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { Request, Response } from 'express';
import { AuthError } from '../auth/auth.error.js';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { VARIANT_WIDTHS, type VariantKind } from '../website/media.processing.js';
import { SupplierImportService } from './supplier-import.service.js';

/*
 * Only the contract's fields are accepted (the global pipe forbids unknown ones). Values are validated again, with exact rules, in the
 * core: the decorators only keep the wrong types out.
 */
const VERSION = { min: 1, max: 2_147_483_647 } as const;

class VersionDto {
  @ApiProperty() @IsInt() @Min(VERSION.min) @Max(VERSION.max) expectedVersion!: number;
}

class EditDto extends VersionDto implements SupplierCandidateEditRequest {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2_000) nameVi?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2_000) nameEn?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() needsTranslation?: boolean;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80_000)
  descriptionVi?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80_000)
  descriptionEn?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  brandId?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryId?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  proposedSku?: string | null;
}

class ImageDecisionDto extends VersionDto implements SupplierCandidateImageDecisionRequest {
  @ApiProperty() @IsString() @MaxLength(64) imageId!: string;
  @ApiProperty({ enum: ['KEEP', 'DROP'] }) @IsIn(['KEEP', 'DROP']) decision!: 'KEEP' | 'DROP';
}

class KeepSeparateDto extends VersionDto implements SupplierCandidateKeepSeparateRequest {
  @ApiProperty() @IsString() @MaxLength(80) ref!: string;
}

class ApproveDto extends VersionDto implements SupplierCandidateApproveRequest {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(32) listPriceVnd?: string;
}

class DecideDto extends VersionDto implements SupplierCandidateDecideRequest {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  note?: string | null;
}

class MappingDto implements SupplierMappingRequest {
  @ApiProperty() @IsString() @MaxLength(64) candidateId!: string;
  @ApiProperty({ enum: ['BRAND', 'CATEGORY'] }) @IsIn(['BRAND', 'CATEGORY']) kind!:
    'BRAND' | 'CATEGORY';
  @ApiProperty() @IsString() @MaxLength(1_000) sourceText!: string;
  @ApiProperty() @IsString() @MaxLength(64) targetId!: string;
}

class ReadyEntryDto {
  @ApiProperty() @IsString() @MaxLength(64) id!: string;
  @ApiProperty() @IsInt() @Min(VERSION.min) @Max(VERSION.max) expectedVersion!: number;
}

class ApproveReadyDto implements SupplierApproveReadyRequest {
  @ApiProperty({ type: [ReadyEntryDto] })
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ReadyEntryDto)
  candidates!: ReadyEntryDto[];
}

const VARIANTS = { thumb: 'THUMB', md: 'MD', lg: 'LG' } as const satisfies Record<
  string,
  VariantKind
>;

@Controller('api/v1/supplier-imports')
export class SupplierImportController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(SupplierImportService) private readonly imports: SupplierImportService,
  ) {}

  @Get('candidates')
  @ApiOkResponse({
    description:
      'The candidates a scan found, 20 per page (REVIEW_SUPPLIER_IMPORTS). Supplier prices only with MANAGE_PRODUCT_PRICES.',
  })
  list(
    @Req() request: Request,
    @Query('state') state?: string,
    @Query('warning') warning?: string,
    @Query('page') page?: string,
  ): Promise<SupplierCandidateListResponse> {
    for (const value of [state, warning]) {
      if (value !== undefined && typeof value !== 'string')
        throw new AuthError('VALIDATION_FAILED', 'query');
    }
    if (page !== undefined && !/^[0-9]{1,6}$/.test(String(page))) {
      throw new AuthError('VALIDATION_FAILED', 'page');
    }
    return this.imports.list(this.session(request), {
      state,
      warning,
      page: page === undefined ? undefined : Number(page),
    });
  }

  @Get('candidates/:id')
  @ApiOkResponse({ description: 'One candidate for review (REVIEW_SUPPLIER_IMPORTS).' })
  get(@Param('id') id: string, @Req() request: Request): Promise<SupplierCandidateDetailResponse> {
    return this.imports.get(this.session(request), id);
  }

  @Get('candidates/:id/images/:imageId/:variant')
  @ApiOkResponse({ description: 'One WebP rendition of a candidate picture (thumb, md or lg).' })
  async picture(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @Param('variant') variant: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const kind = Object.hasOwn(VARIANTS, variant)
      ? VARIANTS[variant as keyof typeof VARIANTS]
      : null;
    if (!kind || !(kind in VARIANT_WIDTHS)) throw new AuthError('NOT_FOUND');
    const { stream, bytes, etag } = await this.imports.picture(
      this.session(request),
      id,
      imageId,
      kind,
    );
    response.setHeader('etag', etag);
    response.setHeader('cache-control', 'private, max-age=300');
    if (request.headers['if-none-match'] === etag) {
      stream.destroy();
      response.status(304).end();
      return;
    }
    response.setHeader('content-type', 'image/webp');
    response.setHeader('content-length', String(bytes));
    response.setHeader('content-disposition', 'inline');
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  }

  @Post('candidates/:id/edit')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Edits the Lucy-owned fields of a candidate (brand, category, SKU, names, descriptions).',
  })
  edit(
    @Param('id') id: string,
    @Body() body: EditDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SupplierCandidateDetailResponse> {
    return this.imports.edit(this.session(request), id, body, this.requestId(response));
  }

  @Post('candidates/:id/image-decision')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Keeps a flagged picture for this product, or drops it.' })
  imageDecision(
    @Param('id') id: string,
    @Body() body: ImageDecisionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SupplierCandidateDetailResponse> {
    return this.imports.imageDecision(this.session(request), id, body, this.requestId(response));
  }

  @Post('candidates/:id/keep-separate')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Says a look-alike product is not the same one.' })
  keepSeparate(
    @Param('id') id: string,
    @Body() body: KeepSeparateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SupplierCandidateDetailResponse> {
    return this.imports.keepSeparate(this.session(request), id, body, this.requestId(response));
  }

  @Post('candidates/:id/approve')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Approves a candidate: creates the DRAFT product with its variant (SKU as reviewed), the kept pictures and the provenance. A selling price is optional and needs MANAGE_PRODUCT_PRICES.',
  })
  approve(
    @Param('id') id: string,
    @Body() body: ApproveDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SupplierCandidateApproveResponse> {
    return this.imports.approve(this.session(request), id, body, this.requestId(response));
  }

  @Post('candidates/:id/reject')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Rejects a candidate; it does not come back unless the source changes.',
  })
  reject(
    @Param('id') id: string,
    @Body() body: DecideDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SupplierCandidateDecideResponse> {
    return this.imports.reject(this.session(request), id, body, this.requestId(response));
  }

  @Post('candidates/:id/ignore')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Ignores a candidate (not wanted now).' })
  ignore(
    @Param('id') id: string,
    @Body() body: DecideDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SupplierCandidateDecideResponse> {
    return this.imports.ignore(this.session(request), id, body, this.requestId(response));
  }

  @Post('mappings')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Remembers "this source text means this brand or category" and reads every candidate of the supplier again.',
  })
  mapping(
    @Body() body: MappingDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SupplierMappingResponse> {
    return this.imports.mapping(this.session(request), body, this.requestId(response));
  }

  @Post('approve-ready')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Approves the listed candidates that are still ready (no warning), without a price; the others are reported.',
  })
  approveReady(
    @Body() body: ApproveReadyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SupplierApproveReadyResponse> {
    return this.imports.approveReady(this.session(request), body, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
