import type {
  ComboLookupRequest,
  ComboLookupResponse,
  ComboSaleOptionsResponse,
  ComboSaleRequest,
  ComboUseClearRequest,
  ComboUseRequest,
  ComboUsedBy,
  InvoiceCancelRequest,
  InvoiceFinalizeRequest,
  InvoiceLinePriceRequest,
  InvoiceOpenedResponse,
  InvoicePayerRequest,
  InvoiceProductLineAddRequest,
  InvoiceProductLineRemoveRequest,
  InvoiceProductLineUpdateRequest,
  InvoiceResponse,
  InvoiceVoucherRemoveRequest,
  InvoiceVoucherSupplyRequest,
  InvoiceManagementNoteRequest,
  PaymentAnomalyListItem,
  PaymentAnomalyListResponse,
  PaymentAnomalyReviewRequest,
  PaymentPayosRequest,
  PaymentRecordRequest,
  PaymentResultResponse,
  PaymentReverseRequest,
  PosBoardResponse,
  PosProductOptionsResponse,
  PreOrderContactRequest,
  ProductLineModeName,
  ProductSaleRequest,
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
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
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

class AnomalyQueryDto {
  @IsOptional() @IsIn(['OPEN', 'REVIEWED']) status?: 'OPEN' | 'REVIEWED';
}

class ProductOptionsQueryDto {
  @IsOptional() @IsString() @MaxLength(80) q?: string;
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

/** Only the two choices a counter sale has: which combo and which member. Branch, price, state and totals are never supplied. */
class ComboSaleDto implements ComboSaleRequest {
  @ApiProperty() @IsString() @MaxLength(64) comboId!: string;
  @ApiProperty() @IsString() @MaxLength(64) payerUserId!: string;
}

/** A product-only sale: only the optional payer (a member found by the exact lookup); nothing else can be supplied. */
class ProductSaleDto implements ProductSaleRequest {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  payerUserId?: string | null;
}

/** A product line: which variant, how many and who sells it. There is no price field: the server resolves it. */
class ProductLineAddDto implements InvoiceProductLineAddRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
  @ApiProperty() @IsString() @MaxLength(64) variantId!: string;
  @ApiProperty() @IsInt() quantity!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(64) sellerUserId?: string;
  @ApiProperty({ required: false, enum: ['IN_STOCK', 'PRE_ORDER'] })
  @IsOptional()
  @IsIn(['IN_STOCK', 'PRE_ORDER'])
  fulfilmentMode?: ProductLineModeName;
}

class ProductLineUpdateDto implements InvoiceProductLineUpdateRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() quantity?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(64) sellerUserId?: string;
}

class ProductLineRemoveDto implements InvoiceProductLineRemoveRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
}

/** The owner's exact phone only. */
class ComboLookupDto implements ComboLookupRequest {
  @ApiProperty() @IsString() @MaxLength(128) phone!: string;
}

/** Which combo, owner or relative, and an optional relationship note. Session, recipient, technician, branch: never supplied. */
class ComboUseDto implements ComboUseRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
  @ApiProperty() @IsString() @MaxLength(64) purchaseId!: string;
  @ApiProperty({ enum: ['OWNER', 'RELATIVE'] }) @IsIn(['OWNER', 'RELATIVE']) usedBy!: ComboUsedBy;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  relationshipNote?: string;
}

class ComboUseClearDto implements ComboUseClearRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
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

/** The contact of a pre-order (OQ-34): a phone number is mandatory, the name is optional. */
class PreOrderContactDto implements PreOrderContactRequest {
  @ApiProperty() @IsString() @MaxLength(128) phone!: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string | null;
}

class VersionDto implements InvoiceFinalizeRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
  @ApiProperty({ required: false, type: PreOrderContactDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PreOrderContactDto)
  preOrderContact?: PreOrderContactDto;
}

/** The credited amount, the tendered amount and the idempotency UUID. No time, change or status field. */
class PaymentRecordDto implements PaymentRecordRequest {
  // Validated against the method rules by the service, so an unknown or inactive method has its own error.
  @ApiProperty({ enum: ['CASH'] }) @IsString() @MaxLength(32) method!: 'CASH';
  @ApiProperty() @IsString() @Matches(VND) amountVnd!: string;
  @ApiProperty() @IsString() @Matches(VND) tenderedVnd!: string;
  @ApiProperty() @IsString() @MaxLength(64) idempotencyKey!: string;
}

/** A PayOS request: only the amount and the idempotency UUID. The API decides expiry, order and status. */
class PaymentPayosDto implements PaymentPayosRequest {
  @ApiProperty() @IsString() @Matches(VND) amountVnd!: string;
  @ApiProperty() @IsString() @MaxLength(64) idempotencyKey!: string;
}

class ManagementNoteDto implements InvoiceManagementNoteRequest {
  @ApiProperty() @IsString() @MaxLength(2_048) note!: string;
}

class AnomalyReviewDto implements PaymentAnomalyReviewRequest {
  @ApiProperty() @IsString() @MaxLength(2_048) note!: string;
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

  @Get('branches/:branchId/products')
  @ApiOkResponse({
    description:
      'The sellable products matching a search with the price now and the availability at the branch, and the staff who may be the seller (SELL_PRODUCTS; never cost).',
  })
  productOptions(
    @Param('branchId') branchId: string,
    @Query() query: ProductOptionsQueryDto,
    @Req() request: Request,
  ): Promise<PosProductOptionsResponse> {
    return this.invoices.productOptions(this.session(request), branchId, query);
  }

  @Get('branches/:branchId/combos')
  @ApiOkResponse({
    description: 'The combos on sale at the counter and whether selling is open (SELL_COMBOS).',
  })
  comboOptions(
    @Param('branchId') branchId: string,
    @Req() request: Request,
  ): Promise<ComboSaleOptionsResponse> {
    return this.invoices.comboOptions(this.session(request), branchId);
  }

  @Post('branches/:branchId/combo-sales')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Start a combo sale: a DRAFT invoice for an identified member, not tied to a visit (SELL_COMBOS and MANAGE_INVOICES).',
  })
  openComboSale(
    @Param('branchId') branchId: string,
    @Body() body: ComboSaleDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InvoiceOpenedResponse> {
    return this.invoices.openComboSale(
      this.session(request),
      branchId,
      body,
      this.requestId(response),
    );
  }

  @Post('branches/:branchId/product-sales')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Start a product-only sale: a DRAFT invoice for a member or a guest, not tied to a visit (SELL_PRODUCTS).',
  })
  openProductSale(
    @Param('branchId') branchId: string,
    @Body() body: ProductSaleDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InvoiceOpenedResponse> {
    return this.invoices.openProductSale(
      this.session(request),
      branchId,
      body,
      this.requestId(response),
    );
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

  @Post('invoices/:id/product-lines')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Add a product to a DRAFT at the server-resolved price, with its seller (SELL_PRODUCTS). Nothing is reserved until the invoice is finalized.',
  })
  addProductLine(
    @Param('id') id: string,
    @Body() body: ProductLineAddDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InvoiceResponse> {
    return this.invoices.addProductLine(this.session(request), id, body, this.requestId(response));
  }

  @Post('invoices/:id/product-lines/:lineId/update')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Change the quantity and/or the seller of one product line of a DRAFT (SELL_PRODUCTS).',
  })
  updateProductLine(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() body: ProductLineUpdateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InvoiceResponse> {
    return this.invoices.updateProductLine(
      this.session(request),
      id,
      lineId,
      body,
      this.requestId(response),
    );
  }

  @Post('invoices/:id/product-lines/:lineId/remove')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Remove one product line of a DRAFT (SELL_PRODUCTS).' })
  removeProductLine(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() body: ProductLineRemoveDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InvoiceResponse> {
    return this.invoices.removeProductLine(
      this.session(request),
      id,
      lineId,
      body,
      this.requestId(response),
    );
  }

  @Post('invoices/:id/combo-lookup')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Usable combos of an owner found by exact phone, for the services of a DRAFT; the owner name is masked (CONSUME_COMBO_SESSIONS).',
  })
  comboLookup(
    @Param('id') id: string,
    @Body() body: ComboLookupDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ComboLookupResponse> {
    return this.invoices.comboLookup(this.session(request), id, body, this.requestId(response));
  }

  @Post('invoices/:id/lines/:lineId/combo-use')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Pay one line of a DRAFT with a session of a combo, by the owner or a relative; the line becomes 0 VND (CONSUME_COMBO_SESSIONS).',
  })
  comboUse(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() body: ComboUseDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InvoiceResponse> {
    return this.invoices.comboUse(
      this.session(request),
      id,
      lineId,
      body,
      this.requestId(response),
    );
  }

  @Post('invoices/:id/lines/:lineId/combo-use/clear')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Pay the line normally again while the invoice is a DRAFT (CONSUME_COMBO_SESSIONS).',
  })
  comboUseClear(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() body: ComboUseClearDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InvoiceResponse> {
    return this.invoices.comboUseClear(
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

  @Post('invoices/:id/payments/payos')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Create a PayOS QR request for part or all of the balance (COLLECT_PAYMENTS). Pending until PayOS confirms; expires after 15 minutes; one pending request per invoice. Idempotent by the client UUID.',
  })
  createPayos(
    @Param('id') id: string,
    @Body() body: PaymentPayosDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PaymentResultResponse> {
    return this.invoices.createPayos(this.session(request), id, body, this.requestId(response));
  }

  @Post('invoices/:id/payments/:paymentId/cancel')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Cancel a pending PayOS request (COLLECT_PAYMENTS); a new one may then be created.',
  })
  cancelPayos(
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PaymentResultResponse> {
    requireEmptyObject(body);
    return this.invoices.cancelPayos(
      this.session(request),
      id,
      paymentId,
      this.requestId(response),
    );
  }

  @Post('invoices/:id/payments/:paymentId/refresh')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Re-read a pending PayOS request from PayOS now (COLLECT_PAYMENTS); applies a confirmation the webhook missed.',
  })
  refreshPayos(
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PaymentResultResponse> {
    requireEmptyObject(body);
    return this.invoices.refreshPayos(
      this.session(request),
      id,
      paymentId,
      this.requestId(response),
    );
  }

  @Post('invoices/:id/management-notes')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Add an audited management note to an invoice settled through PayOS (CORRECT_PAYMENTS). The only in-system handling of a wrong benefit there.',
  })
  addNote(
    @Param('id') id: string,
    @Body() body: ManagementNoteDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InvoiceResponse> {
    return this.invoices.addNote(this.session(request), id, body, this.requestId(response));
  }

  @Get('branches/:branchId/payment-anomalies')
  @ApiOkResponse({
    description: 'PayOS money that was not applied, awaiting management review (CORRECT_PAYMENTS).',
  })
  anomalies(
    @Param('branchId') branchId: string,
    @Query() query: AnomalyQueryDto,
    @Req() request: Request,
  ): Promise<PaymentAnomalyListResponse> {
    return this.invoices.anomalies(this.session(request), branchId, query.status);
  }

  @Post('payment-anomalies/:id/review')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Record that management reviewed a payment anomaly (CORRECT_PAYMENTS, note).',
  })
  reviewAnomaly(
    @Param('id') id: string,
    @Body() body: AnomalyReviewDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PaymentAnomalyListItem> {
    return this.invoices.reviewAnomaly(this.session(request), id, body, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
