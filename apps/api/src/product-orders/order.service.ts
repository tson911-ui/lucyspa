import type {
  ProductOrderAllocateResponse,
  ProductOrderContextResponse,
  ProductOrderDetailResponse,
  ProductOrderMarkOrderedResponse,
  ProductOrderQueueResponse,
  ProductOrderResponse,
  ProductOrderTicketLinkResponse,
  ProductOrderTicketPublicResponse,
  ProductOrderToOrderResponse,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { sqlStateOf } from '../booking/customer-command.js';
import { loadAuthorityGraph } from '../authorization/authorization.store.js';
import { capabilityDigest } from '../auth/crypto.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { ownerRecipients } from '../product-returns/refund.notice.js';
import * as commands from './order.commands.js';
import { holdsAt } from './order.access.js';
import * as queue from './order.queue.js';
import * as tickets from './ticket.core.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Phase 6 P6-16/P6-17: the commands on a counter pre-order. Authority is a permission at the order's branch, decided inside each
 * transaction (the core). The wrapper turns the retryable lock and unique conflicts, and a database guard that fired anyway, into the
 * precise conflict, exactly as the return cases and the refunds do.
 */
@Injectable()
export class ProductOrderService {
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

  // ------------------------------------------------------------------------------------------- reads

  context(token: string | undefined): Promise<ProductOrderContextResponse> {
    return this.run(token, undefined, (context) => queue.orderContext(context));
  }

  get(token: string | undefined, id: string): Promise<ProductOrderDetailResponse> {
    const orderId = this.id(id);
    return this.run(token, undefined, (context) => queue.orderDetail(context, orderId));
  }

  list(
    token: string | undefined,
    query: {
      branchId: string;
      tab?: string | undefined;
      q?: string | undefined;
      page?: number | undefined;
    },
  ): Promise<ProductOrderQueueResponse> {
    const branchId = this.id(query.branchId);
    return this.run(token, undefined, (context) =>
      queue.listQueue(context, { ...query, branchId }),
    );
  }

  toOrder(token: string | undefined, branchId: string): Promise<ProductOrderToOrderResponse> {
    const branch = this.id(branchId);
    return this.run(token, undefined, (context) => queue.toOrder(context, branch));
  }

  // ---------------------------------------------------------------------------------------- commands

  markOrdered(
    token: string | undefined,
    body: Record<string, unknown>,
    requestId?: string,
  ): Promise<ProductOrderMarkOrderedResponse> {
    return this.run(token, requestId, (context) => commands.markOrdered(context, { ...body }));
  }

  handOver(
    token: string | undefined,
    lineId: string,
    body: Record<string, unknown>,
    requestId?: string,
  ): Promise<ProductOrderDetailResponse> {
    const id = this.id(lineId);
    return this.run(token, requestId, (context) => commands.handOver(context, id, { ...body }));
  }

  cancelLine(
    token: string | undefined,
    lineId: string,
    body: Record<string, unknown>,
    requestId?: string,
  ): Promise<ProductOrderDetailResponse> {
    const id = this.id(lineId);
    // The Owner is told in the same transaction: the Owner's account is resolved and locked (with the actor, sorted) BEFORE the invoice,
    // so the notice never waits for a user row another command holds while it waits for our invoice. Only a holder of REFUND_PRODUCTS at
    // the line's branch causes any lock; anyone else fails on authority.
    let owners: readonly string[] = [];
    return this.run(
      token,
      requestId,
      (context) =>
        commands.cancelLine(
          context,
          id,
          { ...body },
          this.environment.auth.freshAuthSeconds,
          owners,
        ),
      async (tx) => {
        if (!(await this.mayRefund(tx, token, id))) return [];
        owners = await ownerRecipients(tx);
        return owners;
      },
    );
  }

  declineCancel(
    token: string | undefined,
    lineId: string,
    body: Record<string, unknown>,
    requestId?: string,
  ): Promise<ProductOrderDetailResponse> {
    const id = this.id(lineId);
    return this.run(token, requestId, (context) =>
      commands.declineCancel(context, id, { ...body }),
    );
  }

  correctReference(
    token: string | undefined,
    lineId: string,
    body: Record<string, unknown>,
    requestId?: string,
  ): Promise<ProductOrderDetailResponse> {
    const id = this.id(lineId);
    return this.run(token, requestId, (context) =>
      commands.correctReference(context, id, { ...body }),
    );
  }

  allocate(
    token: string | undefined,
    body: Record<string, unknown>,
    requestId?: string,
  ): Promise<ProductOrderAllocateResponse> {
    return this.run(token, requestId, (context) => commands.allocateNow(context, { ...body }));
  }

  private async mayRefund(
    tx: Prisma.TransactionClient,
    token: string | undefined,
    lineId: string,
  ): Promise<boolean> {
    const digest = token === undefined ? null : capabilityDigest(token);
    if (digest === null) return false;
    const session = await tx.session.findUnique({
      where: { tokenHash: new Uint8Array(digest) },
      select: { userId: true },
    });
    if (!session?.userId) return false;
    const line = await tx.productOrderLine.findUnique({
      where: { id: lineId },
      select: { branchId: true },
    });
    if (!line) return false;
    const graph = await loadAuthorityGraph(tx, session.userId);
    return graph !== null && holdsAt(graph, 'REFUND_PRODUCTS', line.branchId);
  }

  createTicketLink(
    token: string | undefined,
    id: string,
    requestId?: string,
  ): Promise<ProductOrderTicketLinkResponse> {
    const orderId = this.id(id);
    return this.run(token, requestId, (context) => tickets.createTicketLink(context, orderId));
  }

  revokeTicketLink(
    token: string | undefined,
    id: string,
    requestId?: string,
  ): Promise<ProductOrderResponse> {
    const orderId = this.id(id);
    return this.run(token, requestId, (context) => tickets.revokeTicketLink(context, orderId));
  }

  id(value: string | undefined): string {
    if (typeof value !== 'string' || !UUID.test(value)) throw new AuthError('NOT_FOUND');
    return value.toLowerCase();
  }

  run<T>(
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

/** The anonymous read of a ticket link: no session, no cookie, nothing but the ticket (the rate limit is the controller's guard). */
@Injectable()
export class PublicProductOrderService {
  constructor(
    @Inject(SessionService) private readonly sessions: Pick<SessionService, 'withTransaction'>,
  ) {}

  ticket(token: string): Promise<ProductOrderTicketPublicResponse> {
    return this.sessions.withTransaction((tx) => tickets.readPublicTicket(tx, token));
  }
}
