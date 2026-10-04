import type {
  LoyaltyAdjustmentRequest,
  LoyaltyAdjustmentResponse,
  LoyaltyExceptionPageResponse,
  LoyaltyGoLiveResponse,
  LoyaltyLedgerPageResponse,
  LoyaltyProfileResponse,
  WalkInMemberLookupResponse,
} from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { sqlStateOf } from '../booking/customer-command.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import {
  activateGoLive,
  adjustPoints,
  getGoLive,
  getProfile,
  listExceptions,
  listLedger,
  lookupCustomer,
} from './loyalty.core.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Phase 5 P5-3: loyalty points, admin side. Every request is authorized inside its transaction; the client
 * never chooses a wallet balance, a tier, a time or an actor.
 */
@Injectable()
export class LoyaltyService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
  ) {}

  members(
    token: string | undefined,
    branchId: string,
    query: { phone?: string; email?: string },
  ): Promise<WalkInMemberLookupResponse> {
    return this.run(token, undefined, [], (context) =>
      lookupCustomer(context, this.id(branchId), query),
    );
  }

  profile(
    token: string | undefined,
    branchId: string,
    userId: string,
  ): Promise<LoyaltyProfileResponse> {
    return this.run(token, undefined, [], (context) =>
      getProfile(context, this.id(branchId), this.id(userId)),
    );
  }

  ledger(
    token: string | undefined,
    branchId: string,
    userId: string,
    query: { wallet?: string; page?: string },
  ): Promise<LoyaltyLedgerPageResponse> {
    return this.run(token, undefined, [], (context) =>
      listLedger(context, this.id(branchId), this.id(userId), query),
    );
  }

  adjust(
    token: string | undefined,
    userId: string,
    body: LoyaltyAdjustmentRequest,
    requestId?: string,
  ): Promise<LoyaltyAdjustmentResponse> {
    const id = this.id(userId);
    return this.run(token, requestId, [id], (context) =>
      adjustPoints(context, id, body, this.environment.auth.freshAuthSeconds),
    );
  }

  exceptions(
    token: string | undefined,
    query: { page?: string },
  ): Promise<LoyaltyExceptionPageResponse> {
    return this.run(token, undefined, [], (context) => listExceptions(context, query));
  }

  goLive(token: string | undefined): Promise<LoyaltyGoLiveResponse> {
    return this.run(token, undefined, [], getGoLive);
  }

  activate(token: string | undefined, requestId?: string): Promise<LoyaltyGoLiveResponse> {
    return this.run(token, requestId, [], (context) =>
      activateGoLive(context, this.environment.auth.freshAuthSeconds),
    );
  }

  private id(value: string): string {
    if (!UUID.test(value)) throw new AuthError('NOT_FOUND');
    return value.toLowerCase();
  }

  private async run<T>(
    token: string | undefined,
    requestId: string | undefined,
    lockUsers: readonly string[],
    work: (context: AdminContext) => Promise<T>,
  ): Promise<T> {
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      { exclusive: false, requestId, lockUsers: async () => lockUsers },
      async (context) => {
        try {
          return await work(context);
        } catch (error) {
          if (error instanceof AuthError) throw error;
          const meta = Reflect.get(Object(error), 'meta');
          const state = sqlStateOf(error) ?? (meta ? Reflect.get(Object(meta), 'code') : undefined);
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
