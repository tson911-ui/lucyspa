import type {
  ProductReturnAcceptRequest,
  ProductReturnCaseResponse,
  ProductReturnCloseRequest,
  ProductReturnContextResponse,
  ProductReturnListResponse,
  ProductReturnLookupResponse,
  ProductReturnNoteRequest,
  ProductReturnOpenRequest,
  ProductReturnPhotoRemoveRequest,
  ProductReturnPhotoVariantName,
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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { Request, Response } from 'express';
import { AuthError } from '../auth/auth.error.js';
import { sessionCookie } from '../auth/cookies.js';
import { MultipartUpload } from '../auth/multipart-upload.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { MEDIA_LIMITS, type VariantKind } from '../website/media.processing.js';
import { ProductReturnService, type UploadedEvidence } from './return.service.js';

const MAX_VERSION = 2_147_483_647;
const VARIANTS: Record<ProductReturnPhotoVariantName, VariantKind> = {
  thumb: 'THUMB',
  md: 'MD',
  lg: 'LG',
};
const REASONS = ['PERSONAL_PREFERENCE', 'WRONG_OR_DAMAGED', 'SKIN_IRRITATION'];
const OUTCOMES = ['EXCHANGE', 'REFUND'];

/*
 * Only the contract's fields are accepted (the global pipe forbids unknown ones). The decorators keep the wrong types out; the exact
 * rules (lengths, windows, quantities, authority) are applied again, strictly, in the core.
 */
class OpenDto implements ProductReturnOpenRequest {
  @ApiProperty() @IsString() @MaxLength(64) branchId!: string;
  @ApiProperty() @IsString() @MaxLength(64) invoiceLineId!: string;
  @ApiProperty({ enum: REASONS }) @IsIn(REASONS) reason!: ProductReturnOpenRequest['reason'];
  @ApiProperty({ enum: OUTCOMES })
  @IsIn(OUTCOMES)
  requestedOutcome!: ProductReturnOpenRequest['requestedOutcome'];
  @ApiProperty() @IsInt() @Min(1) @Max(1_000_000) quantity!: number;
  @ApiProperty({ nullable: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsBoolean()
  sealIntact!: boolean | null;
  @ApiProperty({ nullable: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(4000)
  notes!: string | null;
  @ApiProperty() @IsString() @MaxLength(64) clientRequestId!: string;
  @ApiProperty({ nullable: true, required: false })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  windowExceptionReason?: string | null;
}

class NoteDto implements ProductReturnNoteRequest {
  @ApiProperty() @IsString() @MaxLength(4000) note!: string;
}

class AcceptDto implements ProductReturnAcceptRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedRowVersion!: number;
  @ApiProperty({ enum: OUTCOMES }) @IsIn(OUTCOMES) outcome!: ProductReturnAcceptRequest['outcome'];
  @ApiProperty({ nullable: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(4000)
  note!: string | null;
}

class CloseDto implements ProductReturnCloseRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedRowVersion!: number;
  @ApiProperty() @IsString() @MaxLength(4000) note!: string;
}

class RemoveDto implements ProductReturnPhotoRemoveRequest {
  @ApiProperty() @IsString() @MaxLength(4000) note!: string;
}

/**
 * Phase 6 P6-12: product return cases (design 8.1). The global guard enforces JSON, exact Origin and CSRF; authority
 * (MANAGE_PRODUCT_RETURNS and REFUND_PRODUCTS at the invoice's branch, the Owner for a photo removal) is decided in the service's
 * transaction. Evidence photos are private: only the endpoint below streams them, after the same authority check, with no caching.
 */
@Controller('api/v1/product-returns')
export class ProductReturnController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(ProductReturnService) private readonly returns: ProductReturnService,
  ) {}

  @Get('context')
  @ApiOkResponse({ description: 'The branches where the caller works on return cases.' })
  context(@Req() request: Request): Promise<ProductReturnContextResponse> {
    return this.returns.context(this.session(request));
  }

  @Get('lookup')
  @ApiOkResponse({
    description: 'The product lines of one paid invoice (MANAGE_PRODUCT_RETURNS at the branch).',
  })
  lookup(
    @Query('branchId') branchId: string,
    @Query('invoiceCode') invoiceCode: string | undefined,
    @Req() request: Request,
  ): Promise<ProductReturnLookupResponse> {
    if (invoiceCode !== undefined && typeof invoiceCode !== 'string') {
      throw new AuthError('VALIDATION_FAILED', 'invoiceCode');
    }
    return this.returns.lookup(this.session(request), branchId, invoiceCode);
  }

  @Get('cases')
  @ApiOkResponse({ description: 'The cases of one branch, newest first, 20 per page.' })
  list(
    @Query('branchId') branchId: string,
    @Query('status') status: string | undefined,
    @Query('reason') reason: string | undefined,
    @Query('q') q: string | undefined,
    @Query('page') page: string | undefined,
    @Req() request: Request,
  ): Promise<ProductReturnListResponse> {
    for (const [field, value] of [
      ['status', status],
      ['reason', reason],
      ['q', q],
    ] as const) {
      if (value !== undefined && typeof value !== 'string') {
        throw new AuthError('VALIDATION_FAILED', field);
      }
    }
    if (page !== undefined && !/^[0-9]{1,6}$/.test(String(page))) {
      throw new AuthError('VALIDATION_FAILED', 'page');
    }
    return this.returns.list(this.session(request), {
      branchId,
      status,
      reason,
      q,
      page: page === undefined ? undefined : Number(page),
    });
  }

  @Get('cases/:id')
  @ApiOkResponse({ description: 'One case with its photos and history.' })
  get(@Param('id') id: string, @Req() request: Request): Promise<ProductReturnCaseResponse> {
    return this.returns.get(this.session(request), id);
  }

  @Post('cases')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Open a return case for one product line (MANAGE_PRODUCT_RETURNS).',
  })
  open(
    @Body() body: OpenDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductReturnCaseResponse> {
    // An omitted optional field reaches the service as an absent key, not as `undefined`.
    const { windowExceptionReason, ...rest } = body;
    return this.returns.open(
      this.session(request),
      windowExceptionReason === undefined ? rest : { ...rest, windowExceptionReason },
      this.requestId(response),
    );
  }

  @Post('cases/:id/notes')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Add a note to an open or accepted case.' })
  note(
    @Param('id') id: string,
    @Body() body: NoteDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductReturnCaseResponse> {
    return this.returns.addNote(this.session(request), id, body, this.requestId(response));
  }

  @Post('cases/:id/accept')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Accept an open case for an exchange or a refund (no money or stock moves yet).',
  })
  accept(
    @Param('id') id: string,
    @Body() body: AcceptDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductReturnCaseResponse> {
    return this.returns.accept(this.session(request), id, body, this.requestId(response));
  }

  @Post('cases/:id/decline')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Decline an open case, with the reason.' })
  decline(
    @Param('id') id: string,
    @Body() body: CloseDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductReturnCaseResponse> {
    return this.returns.decline(this.session(request), id, body, this.requestId(response));
  }

  @Post('cases/:id/cancel')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Cancel an open case (opened by mistake or withdrawn), with the reason.',
  })
  cancel(
    @Param('id') id: string,
    @Body() body: CloseDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductReturnCaseResponse> {
    return this.returns.cancel(this.session(request), id, body, this.requestId(response));
  }

  @Post('cases/:id/photos')
  @HttpCode(200)
  @MultipartUpload()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MEDIA_LIMITS.maxBytes, files: 1, fields: 0, parts: 2 },
    }),
  )
  @ApiOkResponse({
    description: 'Add one JPEG/PNG/WebP evidence photo (multipart: file) to an open case.',
  })
  upload(
    @Param('id') id: string,
    @UploadedFile() file: UploadedEvidence | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductReturnCaseResponse> {
    return this.returns.uploadPhoto(this.session(request), id, file, this.requestId(response));
  }

  @Get('cases/:id/photos/:photoId/:variant')
  @ApiOkResponse({
    description: 'One WebP rendition of a private evidence photo (thumb, md or lg).',
  })
  async photo(
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @Param('variant') variant: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const kind = Object.hasOwn(VARIANTS, variant)
      ? VARIANTS[variant as ProductReturnPhotoVariantName]
      : null;
    if (!kind) throw new AuthError('NOT_FOUND');
    const { stream, bytes } = await this.returns.photo(this.session(request), id, photoId, kind);
    // Private evidence: never cached by the browser or a proxy, never sniffed, always shown inline as the WebP it is.
    response.setHeader('cache-control', 'private, no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('content-type', 'image/webp');
    response.setHeader('content-length', String(bytes));
    response.setHeader('content-disposition', 'inline');
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  }

  @Post('cases/:id/photos/:photoId/remove')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Remove a photo on the customer’s request (Owner only); the record stays.',
  })
  removePhoto(
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @Body() body: RemoveDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductReturnCaseResponse> {
    return this.returns.removePhoto(
      this.session(request),
      id,
      photoId,
      body,
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
