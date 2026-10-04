import type {
  ReferralBindRequest,
  ReferralChangeRequest,
  ReferralLookupResponse,
  ReferralPageResponse,
  ReferralResultResponse,
} from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { sqlStateOf } from '../booking/customer-command.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { bindAtCounter, changeReferrer, listReferrals, lookupReferrer } from './referral.core.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Phase 5 P5-5: referral, staff side. Every request is authorized inside its transaction; the client never chooses a
 * referral id, an actor, a time or an award.
 */
@Injectable()
export class ReferralService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
  ) {}

  list(
    token: string | undefined,
    branchId: string,
    query: { page?: string; status?: string },
  ): Promise<ReferralPageResponse> {
    return this.run(token, undefined, [], (context) =>
      listReferrals(context, this.id(branchId), query),
    );
  }

  lookup(
    token: string | undefined,
    branchId: string,
    query: { phone?: string },
  ): Promise<ReferralLookupResponse> {
    return this.run(token, undefined, [], (context) =>
      lookupReferrer(context, this.id(branchId), query),
    );
  }

  bind(
    token: string | undefined,
    branchId: string,
    userId: string,
    body: ReferralBindRequest,
    requestId?: string,
  ): Promise<ReferralResultResponse> {
    const id = this.id(userId);
    return this.run(token, requestId, [id], (context) =>
      bindAtCounter(context, this.id(branchId), id, body),
    );
  }

  change(
    token: string | undefined,
    userId: string,
    body: ReferralChangeRequest,
    requestId?: string,
  ): Promise<ReferralResultResponse> {
    const id = this.id(userId);
    return this.run(token, requestId, [id], (context) =>
      changeReferrer(context, id, body, this.environment.auth.freshAuthSeconds),
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
