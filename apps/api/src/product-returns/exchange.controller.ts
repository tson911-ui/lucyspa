import type {
  ProductExchangeCompleteRequest,
  ProductExchangeCorrectionRequest,
  ProductExchangeOptionsResponse,
  ProductExchangePreviewResponse,
  ProductExchangeRequest,
  ProductExchangeSummaryResponse,
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
import { IsIn, IsString, MaxLength, ValidateIf } from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { ProductExchangeService } from './exchange.service.js';

const METHODS = ['CASH', 'BANK_TRANSFER_MANUAL'];
const RESTOCKS = ['SELLABLE', 'NOT_SELLABLE'];

/*
 * Only the contract's fields are accepted (the global pipe forbids unknown ones). The decorators keep the wrong types out; the exact
 * rules (the figures, the reference format, authority, the password confirmation) are applied again, strictly, in the core.
 */
class ExchangeDto implements ProductExchangeRequest {
  @ApiProperty() @IsString() @MaxLength(64) variantId!: string;
  @ApiProperty() @IsString() @MaxLength(20) expectedPayableVnd!: string;
  @ApiProperty() @IsString() @MaxLength(20) expectedRefundVnd!: string;
  @ApiProperty({ enum: RESTOCKS, nullable: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsIn(RESTOCKS)
  restock!: ProductExchangeRequest['restock'];
  @ApiProperty({ enum: METHODS, nullable: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsIn(METHODS)
  refundMethod!: ProductExchangeRequest['refundMethod'];
  @ApiProperty({ nullable: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(200)
  bankReference!: string | null;
  @ApiProperty({ nullable: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(64)
  sellerUserId!: string | null;
  @ApiProperty() @IsString() @MaxLength(4000) reason!: string;
  @ApiProperty() @IsString() @MaxLength(64) clientRequestId!: string;
}

class CompleteDto implements ProductExchangeCompleteRequest {
  @ApiProperty({ enum: RESTOCKS })
  @IsIn(RESTOCKS)
  restock!: ProductExchangeCompleteRequest['restock'];
}

class CorrectionDto implements ProductExchangeCorrectionRequest {
  @ApiProperty() @IsString() @MaxLength(200) bankReference!: string;
  @ApiProperty() @IsString() @MaxLength(4000) reason!: string;
}

/**
 * Phase 6 P6-14: the exchanges of one return case. The global guard enforces JSON, exact Origin and CSRF; authority (REFUND_PRODUCTS at
 * the invoice's branch) and the password confirmation (used once) are decided in the service's transaction.
 */
@Controller('api/v1/product-returns/cases/:id/exchanges')
export class ProductExchangeController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(ProductExchangeService) private readonly exchanges: ProductExchangeService,
  ) {}

  @Get()
  @ApiOkResponse({
    description: 'The exchanges of one case and what may be done now (REFUND_PRODUCTS).',
  })
  summary(
    @Param('id') id: string,
    @Req() request: Request,
  ): Promise<ProductExchangeSummaryResponse> {
    return this.exchanges.summary(this.session(request), id);
  }

  @Get('options')
  @ApiOkResponse({
    description: 'Items that can be the replacement, with today’s price and availability.',
  })
  options(
    @Param('id') id: string,
    @Query('q') q: string | undefined,
    @Req() request: Request,
  ): Promise<ProductExchangeOptionsResponse> {
    return this.exchanges.options(this.session(request), id, q === undefined ? {} : { q });
  }

  @Get('preview')
  @ApiOkResponse({
    description:
      'What an exchange for the given replacement would be worth today. Nothing is written.',
  })
  preview(
    @Param('id') id: string,
    @Query('variantId') variantId: string | undefined,
    @Req() request: Request,
  ): Promise<ProductExchangePreviewResponse> {
    return this.exchanges.preview(this.session(request), id, variantId);
  }

  @Post()
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Exchange the units of the case for a replacement in stock (REFUND_PRODUCTS, a password confirmation used once).',
  })
  exchange(
    @Param('id') id: string,
    @Body() body: ExchangeDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductExchangeSummaryResponse> {
    return this.exchanges.exchange(this.session(request), id, body, this.requestId(response));
  }

  @Post(':exchangeId/completion')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Take the returned goods in once the exchange invoice is paid.' })
  complete(
    @Param('id') id: string,
    @Param('exchangeId') exchangeId: string,
    @Body() body: CompleteDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductExchangeSummaryResponse> {
    return this.exchanges.complete(
      this.session(request),
      id,
      exchangeId,
      body,
      this.requestId(response),
    );
  }

  @Post(':exchangeId/corrections')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Correct the typed reference of the money an exchange handed back by a new linked record.',
  })
  correct(
    @Param('id') id: string,
    @Param('exchangeId') exchangeId: string,
    @Body() body: CorrectionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductExchangeSummaryResponse> {
    return this.exchanges.correctReference(
      this.session(request),
      id,
      exchangeId,
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
