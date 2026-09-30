import type {
  InvoiceCancelRequest,
  InvoiceFinalizeRequest,
  InvoiceLinePriceRequest,
  InvoiceOpenedResponse,
  InvoicePayerRequest,
  InvoiceResponse,
  InvoiceVoucherRemoveRequest,
  InvoiceVoucherSupplyRequest,
  PaymentMethodName,
  PaymentRecordRequest,
  PaymentResultResponse,
  PaymentReverseRequest,
  PosBoardResponse,
  WalkInMemberLookupResponse,
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
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { requireEmptyObject } from '../auth/session-auth.controller.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { InvoiceService } from './invoice.service.js';

const MAX_VERSION = 2_147_483_647;
const VND = /^(?:0|[1-9][0-9]{0,17})$/;

class BoardQueryDto {
  @IsOptional() @IsString() @MaxLength(10) date?: string;
}

class MemberQueryDto {
  @IsOptional() @IsString() @MaxLength(128) phone?: string;
  @IsOptional() @IsString() @MaxLength(320) email?: string;
}

/** Only the choices the contract permits: no total, range, limit, state or branch can be supplied. */
class LinePriceDto implements InvoiceLinePriceRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Matches(VND) unitPriceVnd?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() quantity?: number;
}

class PayerDto implements InvoicePayerRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
  @ApiProperty({ nullable: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(64)
  payerUserId!: string | null;
}

class VoucherSupplyDto implements InvoiceVoucherSupplyRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
  @ApiProperty() @IsString() @MaxLength(128) code!: string;
}

class VoucherRemoveDto implements InvoiceVoucherRemoveRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
}

class VersionDto implements InvoiceFinalizeRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
}

/** The credited amount, the tendered amount and the idempotency UUID. No time, change or status field. */
class PaymentRecordDto implements PaymentRecordRequest {
  // Validated against the method rules by the service, so an unknown or inactive method has its own error.
  @ApiProperty({ enum: ['CASH'] }) @IsString() @MaxLength(32) method!: PaymentMethodName;
  @ApiProperty() @IsString() @Matches(VND) amountVnd!: string;
  @ApiProperty() @IsString() @Matches(VND) tenderedVnd!: string;
  @ApiProperty() @IsString() @MaxLength(64) idempotencyKey!: string;
}

class PaymentReverseDto implements PaymentReverseRequest {
  @ApiProperty() @IsString() @MaxLength(2_048) reason!: string;
}

class CancelDto implements InvoiceCancelRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
  @ApiProperty() @IsString() @MaxLength(2_048) reason!: string;
}

/**
 * Phase 4 Step 5: Invoice / POS ("Hóa đơn"). Permission and branch scope are decided by the service for
 * each record's own branch; the global guard enforces JSON, exact Origin and CSRF.
 */
@Controller('api/v1/pos')
export class InvoiceController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(InvoiceService) private readonly invoices: InvoiceService,
  ) {}

  @Get('branches/:branchId/board')
  @ApiOkResponse({
    description: 'Completed visits without an active invoice and recent invoices (VIEW_INVOICES).',
  })
  board(
    @Param('branchId') branchId: string,
    @Query() query: BoardQueryDto,
    @Req() request: Request,
  ): Promise<PosBoardResponse> {
    return this.invoices.board(this.session(request), branchId, query.date);
  }

  @Get('branches/:branchId/members')
  @ApiOkResponse({
    description: 'Exact phone or email match of an active member (MANAGE_INVOICES; masked).',
  })
  members(
    @Param('branchId') branchId: string,
    @Query() query: MemberQueryDto,
    @Req() request: Request,
  ): Promise<WalkInMemberLookupResponse> {
    return this.invoices.members(this.session(request), branchId, query);
  }

  @Post('visits/:visitId/invoice')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Open the active invoice of a COMPLETED visit, creating a DRAFT if none (idempotent; MANAGE_INVOICES).',
  })
  open(
    @Param('visitId') visitId: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InvoiceOpenedResponse> {
    requireEmptyObject(body);
    return this.invoices.open(this.session(request), visitId, this.requestId(response));
  }

  @Get('invoices/:id')
  @ApiOkResponse({
    description: 'One invoice with its lines and permitted actions (VIEW_INVOICES).',
  })
  get(@Param('id') id: string, @Req() request: Request): Promise<InvoiceResponse> {
    return this.invoices.get(this.session(request), id);
  }

  @Post('invoices/:id/lines/:lineId/price')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Choose the price and/or quantity of one DRAFT line inside its historical range and limit (MANAGE_INVOICES).',
  })
  setPrice(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() body: LinePriceDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InvoiceResponse> {
    return this.invoices.setPrice(
      this.session(request),
      id,
      lineId,
      body,
      this.requestId(response),
    );
  }

  @Post('invoices/:id/payer')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Set or clear the payer of a DRAFT invoice (MANAGE_INVOICES).' })
  payer(
    @Param('id') id: string,
    @Body() body: PayerDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InvoiceResponse> {
    return this.invoices.payer(this.session(request), id, body, this.requestId(response));
  }

  @Post('invoices/:id/vouchers')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Supply a voucher code to a DRAFT (APPLY_DISCOUNTS). Only the code: a percentage or amount can never be typed.',
  })
  supplyVoucher(
    @Param('id') id: string,
    @Body() body: VoucherSupplyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InvoiceResponse> {
    return this.invoices.supplyVoucher(this.session(request), id, body, this.requestId(response));
  }

  @Post('invoices/:id/vouchers/:entryId/remove')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Withdraw a supplied voucher code from a DRAFT (APPLY_DISCOUNTS).',
  })
  removeVoucher(
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Body() body: VoucherRemoveDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InvoiceResponse> {
    return this.invoices.removeVoucher(
      this.session(request),
      id,
      entryId,
      body,
      this.requestId(response),
    );
  }

  @Post('invoices/:id/finalize')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Finalize a DRAFT: PENDING_PAYMENT, or PAID directly for a receivable of exactly 0 (MANAGE_INVOICES).',
  })
  finalize(
    @Param('id') id: string,
    @Body() body: VersionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InvoiceResponse> {
    return this.invoices.finalize(this.session(request), id, body, this.requestId(response));
  }

  @Post('invoices/:id/cancel')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Cancel an invoice (CANCEL_INVOICES, reason required; a finalized invoice needs fresh re-authentication).',
  })
  cancel(
    @Param('id') id: string,
    @Body() body: CancelDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InvoiceResponse> {
    return this.invoices.cancel(this.session(request), id, body, this.requestId(response));
  }

  @Post('invoices/:id/payments')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Record a cash payment, credited in full or in part (split) against a PENDING_PAYMENT invoice (COLLECT_PAYMENTS). Idempotent by the client UUID.',
  })
  recordPayment(
    @Param('id') id: string,
    @Body() body: PaymentRecordDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PaymentResultResponse> {
    return this.invoices.recordPayment(this.session(request), id, body, this.requestId(response));
  }

  @Post('invoices/:id/payments/:paymentId/reverse')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Reverse an erroneous cash payment by an append-only correction (CORRECT_PAYMENTS, reason, fresh re-authentication). Not a refund.',
  })
  reversePayment(
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Body() body: PaymentReverseDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PaymentResultResponse> {
    return this.invoices.reversePayment(
      this.session(request),
      id,
      paymentId,
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
