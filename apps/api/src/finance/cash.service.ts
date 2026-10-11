import type {
  CashCloseRequest,
  CashClosingListResponse,
  CashClosingPreviewRequest,
  CashClosingPreviewResponse,
  CashClosingResponse,
  CashEntryListResponse,
  CashEntryResponse,
  CashGoLiveRequest,
  CashManualEntryRequest,
  CashOverviewResponse,
  CashReconciliationResponse,
  CashReverseRequest,
  CashTransferRequest,
  CashTransferResponse,
} from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { sqlStateOf } from '../booking/customer-command.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import * as core from './cash.core.js';
import * as closing from './cash-closing.core.js';
import * as entries from './cash-entries.core.js';
import * as reconciliation from './cash-reconciliation.core.js';

/**
 * Phase 7 Wave A: the cash book (funds, go-live now; entries, closing and reconciliation in the next Steps). Authority is decided inside
 * every command. The wrapper turns a retryable lock, a unique or a guard conflict that the pre-checks could not see into CONFLICT.
 */
@Injectable()
export class CashService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
  ) {}

  overview(token: string | undefined): Promise<CashOverviewResponse> {
    return this.run(token, undefined, (context) => core.cashOverview(context));
  }

  goLive(
    token: string | undefined,
    body: CashGoLiveRequest,
    requestId?: string,
  ): Promise<CashOverviewResponse> {
    return this.run(token, requestId, (context) =>
      core.startCashBook(context, { ...body }, this.environment.auth.freshAuthSeconds),
    );
  }

  entries(
    token: string | undefined,
    fundId: string,
    query: entries.EntryQuery,
  ): Promise<CashEntryListResponse> {
    return this.run(token, undefined, (context) => entries.listEntries(context, fundId, query));
  }

  record(
    token: string | undefined,
    body: CashManualEntryRequest,
    requestId?: string,
  ): Promise<CashEntryResponse> {
    return this.run(token, requestId, (context) =>
      entries.recordManualEntry(context, { ...body }, this.environment.auth.freshAuthSeconds),
    );
  }

  reverse(
    token: string | undefined,
    entryId: string,
    body: CashReverseRequest,
    requestId?: string,
  ): Promise<CashEntryResponse> {
    return this.run(token, requestId, (context) =>
      entries.reverseEntry(context, entryId, { ...body }),
    );
  }

  transfer(
    token: string | undefined,
    body: CashTransferRequest,
    requestId?: string,
  ): Promise<CashTransferResponse> {
    return this.run(token, requestId, (context) =>
      entries.transferBetweenFunds(context, { ...body }, this.environment.auth.freshAuthSeconds),
    );
  }

  closings(
    token: string | undefined,
    fundId: string,
    query: { page?: unknown },
  ): Promise<CashClosingListResponse> {
    return this.run(token, undefined, (context) => closing.listClosings(context, fundId, query));
  }

  previewClosing(
    token: string | undefined,
    fundId: string,
    body: CashClosingPreviewRequest,
    requestId?: string,
  ): Promise<CashClosingPreviewResponse> {
    return this.run(token, requestId, (context) =>
      closing.previewClosing(context, fundId, { ...body }),
    );
  }

  closeDay(
    token: string | undefined,
    fundId: string,
    body: CashCloseRequest,
    requestId?: string,
  ): Promise<CashClosingResponse> {
    return this.run(token, requestId, (context) =>
      closing.closeDay(context, fundId, { ...body }, this.environment.auth.freshAuthSeconds),
    );
  }

  reconcile(
    token: string | undefined,
    query: { branchId?: unknown; from?: unknown; to?: unknown },
  ): Promise<CashReconciliationResponse> {
    return this.run(token, undefined, (context) => reconciliation.reconcile(context, query));
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
