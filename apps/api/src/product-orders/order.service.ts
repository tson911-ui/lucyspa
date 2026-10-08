import type {
  ProductOrderResponse,
  ProductOrderTicketLinkResponse,
  ProductOrderTicketPublicResponse,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { sqlStateOf } from '../booking/customer-command.js';
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
  ) {}

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
