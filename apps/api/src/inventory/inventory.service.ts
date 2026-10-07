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
  StockReceiptListResponse,
  StockReceiptResponse,
  StockReceiptVersionRequest,
  SupplierCreateRequest,
  SupplierEditRequest,
  SupplierListResponse,
  SupplierResponse,
} from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { sqlStateOf } from '../booking/customer-command.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import * as receipts from './receipts.core.js';
import * as stock from './stock.core.js';
import * as suppliers from './suppliers.core.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Phase 6 P6-4: the inventory (design 4). Every request is authorized inside its transaction (the cores). The wrapper turns the
 * retryable lock and unique conflicts, and a database guard that fired anyway (a race the pre-checks could not see), into the
 * precise conflict; an unknown failure stays a generic one and reveals nothing.
 */
@Injectable()
export class InventoryService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
  ) {}

  // ----------------------------------------------------------------------------------------------- reads

  context(token: string | undefined): Promise<InventoryContextResponse> {
    return this.run(token, undefined, (context) => stock.inventoryContext(context));
  }

  overview(token: string | undefined, branchId: string): Promise<InventoryOverviewResponse> {
    const branch = this.id(branchId, 'branchId');
    return this.run(token, undefined, (context) => stock.overview(context, branch));
  }

  variantDetail(
    token: string | undefined,
    branchId: string,
    variantId: string,
  ): Promise<InventoryVariantDetailResponse> {
    const branch = this.id(branchId, 'branchId');
    const variant = this.id(variantId, 'variantId');
    return this.run(token, undefined, (context) => stock.variantDetail(context, branch, variant));
  }

  variantOptions(token: string | undefined): Promise<InventoryVariantOptionsResponse> {
    return this.run(token, undefined, (context) => stock.variantOptions(context));
  }

  adjust(
    token: string | undefined,
    body: StockAdjustmentRequest,
    requestId?: string,
  ): Promise<InventoryVariantDetailResponse> {
    return this.run(token, requestId, (context) => stock.adjustStock(context, body));
  }

  // -------------------------------------------------------------------------------------------- suppliers

  suppliers(token: string | undefined): Promise<SupplierListResponse> {
    return this.run(token, undefined, (context) => suppliers.listSuppliers(context));
  }

  createSupplier(
    token: string | undefined,
    body: SupplierCreateRequest,
    requestId?: string,
  ): Promise<SupplierResponse> {
    return this.run(token, requestId, (context) => suppliers.createSupplier(context, body));
  }

  editSupplier(
    token: string | undefined,
    id: string,
    body: SupplierEditRequest,
    requestId?: string,
  ): Promise<SupplierResponse> {
    const supplier = this.id(id);
    return this.run(token, requestId, (context) => suppliers.editSupplier(context, supplier, body));
  }

  // ---------------------------------------------------------------------------------------------- receipts

  receipts(token: string | undefined, branchId: string): Promise<StockReceiptListResponse> {
    const branch = this.id(branchId, 'branchId');
    return this.run(token, undefined, (context) => receipts.listReceipts(context, branch));
  }

  receipt(token: string | undefined, id: string): Promise<StockReceiptResponse> {
    const receipt = this.id(id);
    return this.run(token, undefined, (context) => receipts.getReceipt(context, receipt));
  }

  createReceipt(
    token: string | undefined,
    body: StockReceiptCreateRequest,
    requestId?: string,
  ): Promise<StockReceiptResponse> {
    return this.run(token, requestId, (context) => receipts.createReceipt(context, body));
  }

  editReceipt(
    token: string | undefined,
    id: string,
    body: StockReceiptEditRequest,
    requestId?: string,
  ): Promise<StockReceiptResponse> {
    const receipt = this.id(id);
    return this.run(token, requestId, (context) => receipts.editReceipt(context, receipt, body));
  }

  confirmReceipt(
    token: string | undefined,
    id: string,
    body: StockReceiptVersionRequest,
    requestId?: string,
  ): Promise<StockReceiptResponse> {
    const receipt = this.id(id);
    return this.run(token, requestId, (context) => receipts.confirmReceipt(context, receipt, body));
  }

  cancelReceipt(
    token: string | undefined,
    id: string,
    body: StockReceiptCancelRequest,
    requestId?: string,
  ): Promise<StockReceiptResponse> {
    const receipt = this.id(id);
    return this.run(token, requestId, (context) => receipts.cancelReceipt(context, receipt, body));
  }

  // ----------------------------------------------------------------------------------------------- counts

  counts(token: string | undefined, branchId: string): Promise<StockCountListResponse> {
    const branch = this.id(branchId, 'branchId');
    return this.run(token, undefined, (context) => stock.listCounts(context, branch));
  }

  count(token: string | undefined, id: string): Promise<StockCountResponse> {
    const count = this.id(id);
    return this.run(token, undefined, (context) => stock.getCount(context, count));
  }

  createCount(
    token: string | undefined,
    body: StockCountCreateRequest,
    requestId?: string,
  ): Promise<StockCountResponse> {
    return this.run(token, requestId, (context) => stock.createCount(context, body));
  }

  setCountLines(
    token: string | undefined,
    id: string,
    body: StockCountLinesRequest,
    requestId?: string,
  ): Promise<StockCountResponse> {
    const count = this.id(id);
    return this.run(token, requestId, (context) => stock.setCountLines(context, count, body));
  }

  approveCount(
    token: string | undefined,
    id: string,
    body: StockReceiptVersionRequest,
    requestId?: string,
  ): Promise<StockCountResponse> {
    const count = this.id(id);
    return this.run(token, requestId, (context) => stock.approveCount(context, count, body));
  }

  cancelCount(
    token: string | undefined,
    id: string,
    body: StockReceiptVersionRequest,
    requestId?: string,
  ): Promise<StockCountResponse> {
    const count = this.id(id);
    return this.run(token, requestId, (context) => stock.cancelCount(context, count, body));
  }

  // --------------------------------------------------------------------------------------------- plumbing

  private id(value: string | undefined, field?: string): string {
    if (typeof value !== 'string' || !UUID.test(value)) {
      throw field ? new AuthError('VALIDATION_FAILED', field) : new AuthError('NOT_FOUND');
    }
    return value.toLowerCase();
  }

  private run<T>(
    token: string | undefined,
    requestId: string | undefined,
    work: (context: AdminContext) => Promise<T>,
  ): Promise<T> {
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      { exclusive: false, requestId },
      async (context) => {
        try {
          return await work(context);
        } catch (error) {
          if (error instanceof AuthError) throw error;
          const meta = Reflect.get(Object(error), 'meta');
          const state = sqlStateOf(error) ?? (meta ? Reflect.get(Object(meta), 'code') : undefined);
          if (
            ['55P03', '40P01', '40001', '23505', '23P01', '23514', '23503'].includes(state ?? '') ||
            ['P2002', 'P2034', 'P2003'].includes(Reflect.get(Object(error), 'code'))
          ) {
            throw new AuthError('CONFLICT');
          }
          throw error;
        }
      },
    );
  }
}
