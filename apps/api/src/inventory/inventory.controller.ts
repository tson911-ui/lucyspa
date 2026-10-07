import type {
  InventoryContextResponse,
  InventoryOverviewResponse,
  InventoryVariantDetailResponse,
  InventoryVariantOptionsResponse,
  StockAdjustmentRequest,
  StockCountCreateRequest,
  StockCountLinesRequest,
  StockCountListResponse,
  StockCountResponse,
  StockReceiptCancelRequest,
  StockReceiptCreateRequest,
  StockReceiptEditRequest,
  StockReceiptLineRequest,
  StockReceiptListResponse,
  StockReceiptResponse,
  StockReceiptVersionRequest,
  SupplierCreateRequest,
  SupplierEditRequest,
  SupplierListResponse,
  SupplierResponse,
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
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { InventoryService } from './inventory.service.js';

/*
 * Only the contract's fields are accepted (the global pipe forbids unknown ones). The decorators keep the wrong types out; the
 * exact rules (dates, quantities, nested lines, cost authority) are applied again, strictly, in the cores.
 */
class SupplierCreateDto implements SupplierCreateRequest {
  @ApiProperty() @IsString() @MaxLength(400) name!: string;
  @ApiProperty({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(400)
  contactName!: string | null;
  @ApiProperty({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(100)
  phone!: string | null;
  @ApiProperty({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(400)
  email!: string | null;
  @ApiProperty({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  address!: string | null;
  @ApiProperty({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  notes!: string | null;
}

class SupplierEditDto extends SupplierCreateDto implements SupplierEditRequest {
  @ApiProperty() @IsInt() expectedRowVersion!: number;
  @ApiProperty() @IsBoolean() isActive!: boolean;
}

class ReceiptCreateDto implements StockReceiptCreateRequest {
  @ApiProperty() @IsString() @MaxLength(64) branchId!: string;
  @ApiProperty({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(64)
  supplierId!: string | null;
  @ApiProperty() @IsString() @MaxLength(16) receiptDate!: string;
  @ApiProperty({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  notes!: string | null;
  @ApiProperty({ type: [Object] }) @IsArray() @ArrayMaxSize(500) lines!: StockReceiptLineRequest[];
}

class ReceiptEditDto implements StockReceiptEditRequest {
  @ApiProperty() @IsInt() expectedRowVersion!: number;
  @ApiProperty({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(64)
  supplierId!: string | null;
  @ApiProperty() @IsString() @MaxLength(16) receiptDate!: string;
  @ApiProperty({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  notes!: string | null;
  @ApiProperty({ type: [Object] }) @IsArray() @ArrayMaxSize(500) lines!: StockReceiptLineRequest[];
}

class VersionDto implements StockReceiptVersionRequest {
  @ApiProperty() @IsInt() expectedRowVersion!: number;
}

class ReceiptCancelDto extends VersionDto implements StockReceiptCancelRequest {
  @ApiProperty() @IsString() @MaxLength(1000) reason!: string;
}

class AdjustmentDto implements StockAdjustmentRequest {
  @ApiProperty() @IsString() @MaxLength(64) requestKey!: string;
  @ApiProperty() @IsString() @MaxLength(64) branchId!: string;
  @ApiProperty() @IsString() @MaxLength(64) variantId!: string;
  @ApiProperty() @IsString() @MaxLength(64) lotId!: string;
  @ApiProperty() @IsInt() quantity!: number;
  @ApiProperty()
  @IsIn(['INTERNAL_USE', 'TESTER', 'DAMAGED', 'EXPIRED', 'LOSS'])
  reason!: StockAdjustmentRequest['reason'];
  @ApiProperty({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  note!: string | null;
}

class CountCreateDto implements StockCountCreateRequest {
  @ApiProperty() @IsString() @MaxLength(64) branchId!: string;
  @ApiProperty({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  notes!: string | null;
  @ApiProperty({ type: [String], nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsArray()
  @ArrayMaxSize(500)
  variantIds!: string[] | null;
}

class CountLinesDto implements StockCountLinesRequest {
  @ApiProperty() @IsInt() expectedRowVersion!: number;
  @ApiProperty({ type: [Object] })
  @IsArray()
  @ArrayMaxSize(500)
  lines!: StockCountLinesRequest['lines'];
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(500) removeVariantIds!: string[];
}

/**
 * Phase 6 P6-4: the inventory (suppliers, receipts, levels, lots, adjustments, counts). The global guard enforces JSON, exact
 * Origin and CSRF; authority (branch-scoped VIEW_INVENTORY, MANAGE_STOCK_RECEIPTS, ADJUST_STOCK; global MANAGE_PRODUCTS and
 * VIEW_PRODUCT_COST) is decided in the service's transaction. A unit cost is absent from every response for a caller without
 * VIEW_PRODUCT_COST.
 */
@Controller('api/v1')
export class InventoryController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}

  @Get('inventory/context')
  @ApiOkResponse({ description: 'The branches the caller may work in and what they may do there.' })
  context(@Req() request: Request): Promise<InventoryContextResponse> {
    return this.inventory.context(this.session(request));
  }

  @Get('inventory/overview')
  @ApiOkResponse({ description: 'The stock of one branch (VIEW_INVENTORY at the branch).' })
  overview(
    @Query('branchId') branchId: string,
    @Req() request: Request,
  ): Promise<InventoryOverviewResponse> {
    return this.inventory.overview(this.session(request), branchId);
  }

  @Get('inventory/branches/:branchId/variants/:variantId')
  @ApiOkResponse({ description: 'One variant: stock, lots and newest movements (VIEW_INVENTORY).' })
  variantDetail(
    @Param('branchId') branchId: string,
    @Param('variantId') variantId: string,
    @Req() request: Request,
  ): Promise<InventoryVariantDetailResponse> {
    return this.inventory.variantDetail(this.session(request), branchId, variantId);
  }

  @Get('inventory/variant-options')
  @ApiOkResponse({ description: 'The variants a receipt or count may list.' })
  variantOptions(@Req() request: Request): Promise<InventoryVariantOptionsResponse> {
    return this.inventory.variantOptions(this.session(request));
  }

  @Post('stock-adjustments')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Takes stock out of one lot with a reason (ADJUST_STOCK).' })
  adjust(
    @Body() body: AdjustmentDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InventoryVariantDetailResponse> {
    return this.inventory.adjust(this.session(request), body, this.requestId(response));
  }

  // ----------------------------------------------------------------------------------------------- suppliers

  @Get('suppliers')
  @ApiOkResponse({
    description: 'Every supplier (MANAGE_PRODUCTS, or MANAGE_STOCK_RECEIPTS somewhere).',
  })
  suppliers(@Req() request: Request): Promise<SupplierListResponse> {
    return this.inventory.suppliers(this.session(request));
  }

  @Post('suppliers')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Creates a supplier (MANAGE_PRODUCTS).' })
  createSupplier(
    @Body() body: SupplierCreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SupplierResponse> {
    return this.inventory.createSupplier(this.session(request), body, this.requestId(response));
  }

  @Post('suppliers/:id/edit')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Edits or switches off a supplier (MANAGE_PRODUCTS).' })
  editSupplier(
    @Param('id') id: string,
    @Body() body: SupplierEditDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SupplierResponse> {
    return this.inventory.editSupplier(this.session(request), id, body, this.requestId(response));
  }

  // ------------------------------------------------------------------------------------------------ receipts

  @Get('stock-receipts')
  @ApiOkResponse({ description: 'The receipts of one branch (MANAGE_STOCK_RECEIPTS).' })
  receipts(
    @Query('branchId') branchId: string,
    @Req() request: Request,
  ): Promise<StockReceiptListResponse> {
    return this.inventory.receipts(this.session(request), branchId);
  }

  @Get('stock-receipts/:id')
  @ApiOkResponse({ description: 'One receipt with its lines (MANAGE_STOCK_RECEIPTS).' })
  receipt(@Param('id') id: string, @Req() request: Request): Promise<StockReceiptResponse> {
    return this.inventory.receipt(this.session(request), id);
  }

  @Post('stock-receipts')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Creates a draft receipt (MANAGE_STOCK_RECEIPTS).' })
  createReceipt(
    @Body() body: ReceiptCreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StockReceiptResponse> {
    return this.inventory.createReceipt(this.session(request), body, this.requestId(response));
  }

  @Post('stock-receipts/:id/edit')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Replaces the header and lines of a draft receipt.' })
  editReceipt(
    @Param('id') id: string,
    @Body() body: ReceiptEditDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StockReceiptResponse> {
    return this.inventory.editReceipt(this.session(request), id, body, this.requestId(response));
  }

  @Post('stock-receipts/:id/confirm')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Confirms a draft receipt: stock enters the branch.' })
  confirmReceipt(
    @Param('id') id: string,
    @Body() body: VersionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StockReceiptResponse> {
    return this.inventory.confirmReceipt(this.session(request), id, body, this.requestId(response));
  }

  @Post('stock-receipts/:id/cancel')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Cancels a draft receipt with a reason.' })
  cancelReceipt(
    @Param('id') id: string,
    @Body() body: ReceiptCancelDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StockReceiptResponse> {
    return this.inventory.cancelReceipt(this.session(request), id, body, this.requestId(response));
  }

  // ------------------------------------------------------------------------------------------------- counts

  @Get('stock-counts')
  @ApiOkResponse({
    description: 'The physical counts of one branch (VIEW_INVENTORY or ADJUST_STOCK).',
  })
  counts(
    @Query('branchId') branchId: string,
    @Req() request: Request,
  ): Promise<StockCountListResponse> {
    return this.inventory.counts(this.session(request), branchId);
  }

  @Get('stock-counts/:id')
  @ApiOkResponse({ description: 'One physical count with its lines.' })
  count(@Param('id') id: string, @Req() request: Request): Promise<StockCountResponse> {
    return this.inventory.count(this.session(request), id);
  }

  @Post('stock-counts')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Starts a physical count (ADJUST_STOCK).' })
  createCount(
    @Body() body: CountCreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StockCountResponse> {
    return this.inventory.createCount(this.session(request), body, this.requestId(response));
  }

  @Post('stock-counts/:id/lines')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Sets counted quantities of an open count.' })
  setCountLines(
    @Param('id') id: string,
    @Body() body: CountLinesDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StockCountResponse> {
    return this.inventory.setCountLines(this.session(request), id, body, this.requestId(response));
  }

  @Post('stock-counts/:id/approve')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Approves a count: the differences become correction movements.' })
  approveCount(
    @Param('id') id: string,
    @Body() body: VersionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StockCountResponse> {
    return this.inventory.approveCount(this.session(request), id, body, this.requestId(response));
  }

  @Post('stock-counts/:id/cancel')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Cancels an open count.' })
  cancelCount(
    @Param('id') id: string,
    @Body() body: VersionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StockCountResponse> {
    return this.inventory.cancelCount(this.session(request), id, body, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const header = response.getHeader('x-request-id');
    return typeof header === 'string' ? header : undefined;
  }
}
