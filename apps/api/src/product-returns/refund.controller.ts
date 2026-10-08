import type {
  ProductRefundCorrectionRequest,
  ProductRefundRequest,
  ProductRefundSummaryResponse,
} from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { ProductRefundService } from './refund.service.js';

const METHODS = ['CASH', 'BANK_TRANSFER_MANUAL'];
const RESTOCKS = ['SELLABLE', 'NOT_SELLABLE'];

/*
 * Only the contract's fields are accepted (the global pipe forbids unknown ones). The decorators keep the wrong types out; the exact
 * rules (the reference format, the quantities, authority, the password confirmation) are applied again, strictly, in the core.
 */
class RefundDto implements ProductRefundRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(1_000_000) quantity!: number;
  @ApiProperty({ enum: METHODS }) @IsIn(METHODS) method!: ProductRefundRequest['method'];
  @ApiProperty({ nullable: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(200)
  bankReference!: string | null;
  @ApiProperty({ enum: RESTOCKS }) @IsIn(RESTOCKS) restock!: ProductRefundRequest['restock'];
  @ApiProperty() @IsString() @MaxLength(4000) reason!: string;
  @ApiProperty() @IsString() @MaxLength(64) clientRequestId!: string;
}

class CorrectionDto implements ProductRefundCorrectionRequest {
  @ApiProperty() @IsString() @MaxLength(200) bankReference!: string;
  @ApiProperty() @IsString() @MaxLength(4000) reason!: string;
}

/**
 * Phase 6 P6-13: the refunds of one return case. The global guard enforces JSON, exact Origin and CSRF; authority (REFUND_PRODUCTS at the
 * invoice's branch) and the fresh password confirmation are decided in the service's transaction. Cash or a manual bank transfer only.
 */
@Controller('api/v1/product-returns/cases/:id/refunds')
export class ProductRefundController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(ProductRefundService) private readonly refunds: ProductRefundService,
  ) {}

  @Get()
  @ApiOkResponse({
    description: 'The refunds of one case and what is left to refund (REFUND_PRODUCTS).',
  })
  summary(@Param('id') id: string, @Req() request: Request): Promise<ProductRefundSummaryResponse> {
    return this.refunds.summary(this.session(request), id);
  }

  @Post()
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Refund some units of the case’s line by cash or manual transfer (REFUND_PRODUCTS, fresh password).',
  })
  refund(
    @Param('id') id: string,
    @Body() body: RefundDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductRefundSummaryResponse> {
    return this.refunds.refund(this.session(request), id, body, this.requestId(response));
  }

  @Post(':refundId/corrections')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Correct the typed reference of a transfer refund by a new linked record.',
  })
  correct(
    @Param('id') id: string,
    @Param('refundId') refundId: string,
    @Body() body: CorrectionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductRefundSummaryResponse> {
    return this.refunds.correctReference(
      this.session(request),
      id,
      refundId,
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
