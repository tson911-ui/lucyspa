import type {
  ProductExchangeCompleteRequest,
  ProductExchangeCorrectionRequest,
  ProductExchangeOptionsResponse,
  ProductExchangePreviewResponse,
  ProductExchangeRequest,
  ProductExchangeSummaryResponse,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { capabilityDigest } from '../auth/crypto.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { loadAuthorityGraph } from '../authorization/authorization.store.js';
import { sqlStateOf } from '../booking/customer-command.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import * as core from './exchange.core.js';
import { ownerRecipients } from './refund.notice.js';
import { holdsGraphAt } from './return.access.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY = /^(?:0|[1-9][0-9]{0,17})$/;

/**
 * Phase 6 P6-14: exchanges of a returned product line. Authority (REFUND_PRODUCTS at the invoice's branch) and the password
 * confirmation (used once) are decided inside each transaction (the core). The wrapper turns the retryable lock and unique conflicts,
 * and a database guard that fired anyway, into the precise conflict, exactly as the refunds do.
 */
@Injectable()
export class ProductExchangeService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation' | 'resolve'
    >,
    @Inject(AuthThrottleService)
    private readonly throttle: Pick<AuthThrottleService, 'now' | 'debitWindow'>,
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
  ) {}

  summary(token: string | undefined, id: string): Promise<ProductExchangeSummaryResponse> {
    const caseId = this.id(id);
    return this.run(token, undefined, (context) => core.exchangeSummary(context, caseId));
  }

  options(
    token: string | undefined,
    id: string,
    query: { q?: string },
  ): Promise<ProductExchangeOptionsResponse> {
    const caseId = this.id(id);
    return this.run(token, undefined, (context) => core.exchangeOptions(context, caseId, query));
  }

  preview(
    token: string | undefined,
    id: string,
    variantId: string | undefined,
  ): Promise<ProductExchangePreviewResponse> {
    const caseId = this.id(id);
    return this.run(token, undefined, (context) =>
      core.exchangePreview(context, caseId, variantId),
    );
  }

  exchange(
    token: string | undefined,
    id: string,
    body: ProductExchangeRequest,
    requestId?: string,
  ): Promise<ProductExchangeSummaryResponse> {
    const caseId = this.id(id);
    // The Owner is told in the same transaction when money is handed back. The Owner's account is resolved and locked (with the actor,
    // sorted by id) BEFORE the invoice row, only when the figures the person was shown include money handed back, and only for a holder
    // of REFUND_PRODUCTS at the case's branch.
    let owners: readonly string[] = [];
    const handsBack =
      typeof body?.expectedRefundVnd === 'string' &&
      MONEY.test(body.expectedRefundVnd) &&
      body.expectedRefundVnd !== '0';
    return this.run(
      token,
      requestId,
      (context) =>
        core.makeExchange(
          context,
          caseId,
          { ...body },
          this.environment.auth.freshAuthSeconds,
          owners,
        ),
      handsBack
        ? async (tx) => {
            if (!(await this.mayRefund(tx, token, caseId))) return [];
            owners = await ownerRecipients(tx);
            return owners;
          }
        : undefined,
    );
  }

  complete(
    token: string | undefined,
    id: string,
    exchangeId: string,
    body: ProductExchangeCompleteRequest,
    requestId?: string,
  ): Promise<ProductExchangeSummaryResponse> {
    const caseId = this.id(id);
    const exchange = this.id(exchangeId);
    return this.run(token, requestId, (context) =>
      core.completeExchange(context, caseId, exchange, { ...body }),
    );
  }

  correctReference(
    token: string | undefined,
    id: string,
    exchangeId: string,
    body: ProductExchangeCorrectionRequest,
    requestId?: string,
  ): Promise<ProductExchangeSummaryResponse> {
    const caseId = this.id(id);
    const exchange = this.id(exchangeId);
    return this.run(token, requestId, (context) =>
      core.correctExchangeReference(context, caseId, exchange, { ...body }),
    );
  }

  private async mayRefund(
    tx: Prisma.TransactionClient,
    token: string | undefined,
    caseId: string,
  ): Promise<boolean> {
    const digest = token === undefined ? null : capabilityDigest(token);
    if (digest === null) return false;
    const session = await tx.session.findUnique({
      where: { tokenHash: new Uint8Array(digest) },
      select: { userId: true },
    });
    if (!session?.userId) return false;
    const kase = await tx.productReturnCase.findUnique({
      where: { id: caseId },
      select: { branchId: true },
    });
    if (!kase) return false;
    const graph = await loadAuthorityGraph(tx, session.userId);
    return graph !== null && holdsGraphAt(graph, 'REFUND_PRODUCTS', kase.branchId);
  }

  private id(value: string | undefined): string {
    if (typeof value !== 'string' || !UUID.test(value)) throw new AuthError('NOT_FOUND');
    return value.toLowerCase();
  }

  private run<T>(
    token: string | undefined,
    requestId: string | undefined,
    work: (context: AdminContext) => Promise<T>,
    lockUsers?: (tx: Prisma.TransactionClient) => Promise<readonly string[]>,
  ): Promise<T> {
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      { exclusive: false, requestId, ...(lockUsers ? { lockUsers } : {}) },
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
