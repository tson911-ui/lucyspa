import type {
  InvoiceCancelRequest,
  InvoiceFinalizeRequest,
  InvoiceLinePriceRequest,
  InvoiceOpenedResponse,
  InvoicePayerRequest,
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
  WalkInMemberLookupResponse,
} from '@lucy-spa/contracts';
import {
  ProviderRejectedError,
  ProviderUnavailableError,
  readProvider,
  type PaymentProvider,
  type ProviderRead,
} from '@lucy-spa/server';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { sqlStateOf } from '../booking/customer-command.js';
import { normalizeReason } from '../operations/service-execution.service.js';
import { API_ENVIRONMENT, PAYMENT_PROVIDER, type ApiEnvironment } from '../platform/tokens.js';
import { lookupMember } from '../walkin/walkin.core.js';
import { parseVnd } from './invoice.calc.js';
import {
  cancelInvoice,
  finalizeInvoice,
  getInvoice,
  openInvoice,
  posBoard,
  removeVoucher,
  setLinePrice,
  setPayer,
  supplyVoucher,
} from './invoice.core.js';
import { recordPayment, reversePayment } from './payment.core.js';
import {
  addManagementNote,
  completePayosRequest,
  finishProviderAction,
  listAnomalies,
  prepareProviderAction,
  reservePayosRequest,
  reviewAnomaly,
  type CreateOutcome,
} from './payos.core.js';
import { resolvePaymentMethod } from './payment.methods.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_VERSION = 2_147_483_647;

/**
 * Phase 4 Step 5: the Invoice / POS commands. Every request is authorized inside its transaction for the
 * record's own branch (`MANAGE_INVOICES`, `VIEW_INVOICES`, `CANCEL_INVOICES`); the client never chooses the
 * branch of a record, a state, a total, a price range or a quantity limit.
 */
@Injectable()
export class InvoiceService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    /** PayOS, or null when it is not configured (the PayOS method is then disabled, never mocked). */
    @Optional() @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider | null = null,
  ) {}

  async board(
    token: string | undefined,
    branchId: string,
    date: string | undefined,
  ): Promise<PosBoardResponse> {
    if (date !== undefined && !this.isCalendarDate(date)) {
      throw new AuthError('VALIDATION_FAILED', 'date');
    }
    return this.run(token, branchId, undefined, (context, id) =>
      posBoard(context, id, date ?? null),
    );
  }

  members(
    token: string | undefined,
    branchId: string,
    query: { phone?: string; email?: string },
  ): Promise<WalkInMemberLookupResponse> {
    return this.run(token, branchId, undefined, (context, id) => {
      if (!decide(context.actor.graph, 'MANAGE_INVOICES', { kind: 'BRANCH', branchId: id })) {
        throw new AuthError('FORBIDDEN');
      }
      return lookupMember(context.tx, query);
    });
  }

  get(token: string | undefined, invoiceId: string): Promise<InvoiceResponse> {
    return this.run(token, invoiceId, undefined, getInvoice);
  }

  open(
    token: string | undefined,
    visitId: string,
    requestId?: string,
  ): Promise<InvoiceOpenedResponse> {
    return this.run(token, visitId, requestId, openInvoice);
  }

  async setPrice(
    token: string | undefined,
    invoiceId: string,
    lineId: string,
    body: InvoiceLinePriceRequest,
    requestId?: string,
  ): Promise<InvoiceResponse> {
    const expectedVersion = this.version(body.expectedVersion);
    if (!UUID.test(lineId)) throw new AuthError('NOT_FOUND');
    return this.run(token, invoiceId, requestId, (context, id) =>
      setLinePrice(context, id, lineId.toLowerCase(), {
        expectedVersion,
        unitPriceVnd: body.unitPriceVnd,
        quantity: body.quantity,
      }),
    );
  }

  async payer(
    token: string | undefined,
    invoiceId: string,
    body: InvoicePayerRequest,
    requestId?: string,
  ): Promise<InvoiceResponse> {
    const expectedVersion = this.version(body.expectedVersion);
    let payerUserId: string | null = null;
    if (body.payerUserId !== null) {
      if (typeof body.payerUserId !== 'string' || !UUID.test(body.payerUserId)) {
        throw new AuthError('VALIDATION_FAILED', 'payerUserId');
      }
      payerUserId = body.payerUserId.toLowerCase();
    }
    return this.run(token, invoiceId, requestId, (context, id) =>
      setPayer(context, id, { expectedVersion, payerUserId }),
    );
  }

  async supplyVoucher(
    token: string | undefined,
    invoiceId: string,
    body: InvoiceVoucherSupplyRequest,
    requestId?: string,
  ): Promise<InvoiceResponse> {
    const expectedVersion = this.version(body.expectedVersion);
    return this.run(token, invoiceId, requestId, (context, id) =>
      supplyVoucher(context, id, { expectedVersion, code: body.code }),
    );
  }

  async removeVoucher(
    token: string | undefined,
    invoiceId: string,
    entryId: string,
    body: InvoiceVoucherRemoveRequest,
    requestId?: string,
  ): Promise<InvoiceResponse> {
    const expectedVersion = this.version(body.expectedVersion);
    if (!UUID.test(entryId)) throw new AuthError('NOT_FOUND');
    return this.run(token, invoiceId, requestId, (context, id) =>
      removeVoucher(context, id, entryId.toLowerCase(), { expectedVersion }),
    );
  }

  async finalize(
    token: string | undefined,
    invoiceId: string,
    body: InvoiceFinalizeRequest,
    requestId?: string,
  ): Promise<InvoiceResponse> {
    const expectedVersion = this.version(body.expectedVersion);
    return this.run(token, invoiceId, requestId, (context, id) =>
      finalizeInvoice(context, id, { expectedVersion }),
    );
  }

  async cancel(
    token: string | undefined,
    invoiceId: string,
    body: InvoiceCancelRequest,
    requestId?: string,
  ): Promise<InvoiceResponse> {
    const expectedVersion = this.version(body.expectedVersion);
    const reason = normalizeReason(body.reason);
    return this.run(token, invoiceId, requestId, (context, id) =>
      cancelInvoice(
        context,
        id,
        { expectedVersion, reason },
        this.environment.auth.freshAuthSeconds,
      ),
    );
  }

  /**
   * Record cash (COLLECT_PAYMENTS). The body carries only the method, the credited amount, the tendered
   * amount and the client's idempotency UUID: no time, change, status, branch or total can be supplied.
   */
  async recordPayment(
    token: string | undefined,
    invoiceId: string,
    body: PaymentRecordRequest,
    requestId?: string,
  ): Promise<PaymentResultResponse> {
    const method = resolvePaymentMethod(body.method);
    const amountVnd = parseVnd(body.amountVnd, 'amountVnd');
    if (amountVnd <= 0n) throw new AuthError('VALIDATION_FAILED', 'amountVnd');
    const tenderedVnd = parseVnd(body.tenderedVnd, 'tenderedVnd');
    if (typeof body.idempotencyKey !== 'string' || !UUID.test(body.idempotencyKey)) {
      throw new AuthError('VALIDATION_FAILED', 'idempotencyKey');
    }
    const idempotencyKey = body.idempotencyKey.toLowerCase();
    return this.run(token, invoiceId, requestId, (context, id) =>
      recordPayment(context, id, { method, amountVnd, tenderedVnd, idempotencyKey }),
    );
  }

  /** Reverse an erroneous cash payment (CORRECT_PAYMENTS, reason, fresh re-authentication). */
  async reversePayment(
    token: string | undefined,
    invoiceId: string,
    paymentId: string,
    body: PaymentReverseRequest,
    requestId?: string,
  ): Promise<PaymentResultResponse> {
    const reason = normalizeReason(body.reason);
    if (!UUID.test(paymentId)) throw new AuthError('NOT_FOUND');
    return this.run(token, invoiceId, requestId, (context, id) =>
      reversePayment(
        context,
        id,
        paymentId.toLowerCase(),
        { reason },
        this.environment.auth.freshAuthSeconds,
      ),
    );
  }

  /**
   * Ask PayOS for a QR request covering part or all of the remaining balance (COLLECT_PAYMENTS, Q7). The
   * provider call happens between two short transactions. The payment stays PENDING until PayOS confirms it;
   * nothing here can mark a transfer as received.
   */
  async createPayos(
    token: string | undefined,
    invoiceId: string,
    body: PaymentPayosRequest,
    requestId?: string,
  ): Promise<PaymentResultResponse> {
    const provider = this.requireProvider();
    const amountVnd = parseVnd(body.amountVnd, 'amountVnd');
    if (amountVnd <= 0n) throw new AuthError('VALIDATION_FAILED', 'amountVnd');
    if (typeof body.idempotencyKey !== 'string' || !UUID.test(body.idempotencyKey)) {
      throw new AuthError('VALIDATION_FAILED', 'idempotencyKey');
    }
    const idempotencyKey = body.idempotencyKey.toLowerCase();
    const reserved = await this.run(token, invoiceId, requestId, (context, id) =>
      reservePayosRequest(context, id, { amountVnd, idempotencyKey }),
    );
    if (reserved.kind === 'DONE') return reserved.result;
    let outcome: CreateOutcome;
    try {
      outcome = {
        kind: 'CREATED',
        request: await provider.createPaymentRequest({
          orderCode: reserved.orderCode,
          amountVnd: reserved.amountVnd,
          // PayOS limits the memo (9 characters for some accounts); orders are matched by order code.
          description: 'LUCYSPA',
          expiresAt: reserved.expiresAt,
          returnUrl: this.environment.webOrigin,
          cancelUrl: this.environment.webOrigin,
        }),
      };
    } catch (error) {
      if (error instanceof ProviderRejectedError) {
        outcome = { kind: 'REJECTED', providerCode: error.providerCode };
      } else if (error instanceof ProviderUnavailableError) {
        outcome = { kind: 'UNREACHABLE' };
      } else {
        throw error;
      }
    }
    const done = await this.run(token, invoiceId, requestId, (context, id) =>
      completePayosRequest(context, id, reserved.paymentId, outcome),
    );
    if (done.failure === 'REJECTED') throw new AuthError('PAYMENT_PROVIDER_REJECTED');
    if (done.failure === 'UNREACHABLE') throw new AuthError('PAYMENT_PROVIDER_UNAVAILABLE');
    return done.result;
  }

  /** Cancel a pending PayOS request (COLLECT_PAYMENTS); staff may then create a new one (Q7 item 3). */
  async cancelPayos(
    token: string | undefined,
    invoiceId: string,
    paymentId: string,
    requestId?: string,
  ): Promise<PaymentResultResponse> {
    const provider = this.requireProvider();
    if (!UUID.test(paymentId)) throw new AuthError('NOT_FOUND');
    const id = paymentId.toLowerCase();
    const prepared = await this.run(token, invoiceId, requestId, (context, invoice) =>
      prepareProviderAction(context, invoice, id),
    );
    if (prepared.kind === 'DONE') return prepared.result;
    let read: ProviderRead;
    let cancelCalled = false;
    try {
      read = {
        kind: 'SNAPSHOT',
        snapshot: await provider.cancelPaymentRequest(
          Number(prepared.orderCode),
          'Cancelled by staff',
        ),
      };
      cancelCalled = true;
    } catch (error) {
      // A refused cancel means the request is no longer pending at the provider (paid, expired, unknown):
      // the authoritative read decides what happens locally, so a confirmed payment is never lost.
      if (error instanceof ProviderRejectedError) {
        read = await readProvider(provider, prepared.orderCode);
      } else if (error instanceof ProviderUnavailableError) {
        read = { kind: 'UNAVAILABLE' };
      } else {
        throw error;
      }
    }
    return this.finishAction(token, invoiceId, id, read, cancelCalled, requestId);
  }

  /** Re-read a pending request from PayOS now (COLLECT_PAYMENTS): recovers a missed notification on demand. */
  async refreshPayos(
    token: string | undefined,
    invoiceId: string,
    paymentId: string,
    requestId?: string,
  ): Promise<PaymentResultResponse> {
    const provider = this.requireProvider();
    if (!UUID.test(paymentId)) throw new AuthError('NOT_FOUND');
    const id = paymentId.toLowerCase();
    const prepared = await this.run(token, invoiceId, requestId, (context, invoice) =>
      prepareProviderAction(context, invoice, id),
    );
    if (prepared.kind === 'DONE') return prepared.result;
    const read = await readProvider(provider, prepared.orderCode);
    return this.finishAction(token, invoiceId, id, read, false, requestId);
  }

  private async finishAction(
    token: string | undefined,
    invoiceId: string,
    paymentId: string,
    read: ProviderRead,
    cancelCalled: boolean,
    requestId: string | undefined,
  ): Promise<PaymentResultResponse> {
    const done = await this.run(token, invoiceId, requestId, (context, invoice) =>
      finishProviderAction(context, invoice, paymentId, read, { cancelCalled }),
    );
    if (done.outcome === 'UNAVAILABLE') throw new AuthError('PAYMENT_PROVIDER_UNAVAILABLE');
    return done.result;
  }

  /** PayOS anomalies of a branch for management (CORRECT_PAYMENTS). */
  async anomalies(
    token: string | undefined,
    branchId: string,
    status: string | undefined,
  ): Promise<PaymentAnomalyListResponse> {
    if (status !== undefined && status !== 'OPEN' && status !== 'REVIEWED') {
      throw new AuthError('VALIDATION_FAILED', 'status');
    }
    return this.run(token, branchId, undefined, (context, id) =>
      listAnomalies(context, id, status),
    );
  }

  /** Record that management reviewed an anomaly (CORRECT_PAYMENTS, note). Moves no money. */
  async reviewAnomaly(
    token: string | undefined,
    anomalyId: string,
    body: PaymentAnomalyReviewRequest,
    requestId?: string,
  ): Promise<PaymentAnomalyListItem> {
    const note = normalizeReason(body.note);
    return this.run(token, anomalyId, requestId, (context, id) =>
      reviewAnomaly(context, id, { note }),
    );
  }

  /** Audited management note on a PayOS-settled invoice (CORRECT_PAYMENTS; Q7 item 8). */
  async addNote(
    token: string | undefined,
    invoiceId: string,
    body: InvoiceManagementNoteRequest,
    requestId?: string,
  ): Promise<InvoiceResponse> {
    const note = normalizeReason(body.note);
    return this.run(token, invoiceId, requestId, (context, id) =>
      addManagementNote(context, id, { note }),
    );
  }

  private requireProvider(): PaymentProvider {
    if (!this.provider) throw new AuthError('PAYMENT_METHOD_UNAVAILABLE');
    return this.provider;
  }

  private version(value: unknown): number {
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > MAX_VERSION
    ) {
      throw new AuthError('VALIDATION_FAILED', 'expectedVersion');
    }
    return value;
  }

  private isCalendarDate(value: string): boolean {
    if (!DATE.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  private async run<T>(
    token: string | undefined,
    id: string,
    requestId: string | undefined,
    work: (context: AdminContext, id: string) => Promise<T>,
  ): Promise<T> {
    if (!UUID.test(id)) throw new AuthError('NOT_FOUND');
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      { exclusive: false, requestId },
      async (context) => {
        try {
          return await work(context, id.toLowerCase());
        } catch (error) {
          if (error instanceof AuthError) throw error;
          const meta = Reflect.get(Object(error), 'meta');
          const state = sqlStateOf(error) ?? (meta ? Reflect.get(Object(meta), 'code') : undefined);
          // Lock timeout, deadlock, serialization or a unique key won by a concurrent request: retryable.
          if (
            ['55P03', '40P01', '40001', '23505', '23P01'].includes(state ?? '') ||
            ['P2002', 'P2034'].includes(Reflect.get(Object(error), 'code'))
          ) {
            throw new AuthError('CONFLICT');
          }
          throw error;
        }
      },
    );
  }
}
