import type {
  CustomerComboPageResponse,
  CustomerComboUsePageResponse,
  CustomerGiftPageResponse,
  CustomerLedgerPageResponse,
  CustomerLoyaltySummaryResponse,
  CustomerReferralPageResponse,
} from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runCustomerCommand, type CustomerContext } from '../booking/customer-command.js';
import {
  customerComboUses,
  customerCombos,
  customerGifts,
  customerHistory,
  customerReferrals,
  customerSummary,
} from './customer-loyalty.core.js';

/**
 * Phase 5 P5-10: the signed-in customer's own points, combos, referrals and gifts (read only). The session is the only
 * identity; the browser sends no customer id.
 */
@Injectable()
export class CustomerLoyaltyService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<SessionService, 'withTransaction' | 'resolveForMutation'>,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  summary(token: string | undefined): Promise<CustomerLoyaltySummaryResponse> {
    return this.run(token, ({ tx, customerUserId }) => customerSummary(tx, customerUserId));
  }

  history(token: string | undefined, page?: string): Promise<CustomerLedgerPageResponse> {
    return this.run(token, ({ tx, customerUserId }) => customerHistory(tx, customerUserId, page));
  }

  combos(token: string | undefined, page?: string): Promise<CustomerComboPageResponse> {
    return this.run(token, ({ tx, customerUserId, now }) =>
      customerCombos(tx, customerUserId, page, now),
    );
  }

  comboUses(token: string | undefined, page?: string): Promise<CustomerComboUsePageResponse> {
    return this.run(token, ({ tx, customerUserId }) => customerComboUses(tx, customerUserId, page));
  }

  referrals(token: string | undefined, page?: string): Promise<CustomerReferralPageResponse> {
    return this.run(token, ({ tx, customerUserId }) => customerReferrals(tx, customerUserId, page));
  }

  gifts(token: string | undefined, page?: string): Promise<CustomerGiftPageResponse> {
    return this.run(token, ({ tx, customerUserId, now }) =>
      customerGifts(tx, customerUserId, page, now),
    );
  }

  private run<T>(
    token: string | undefined,
    work: (context: CustomerContext) => Promise<T>,
  ): Promise<T> {
    return runCustomerCommand({ sessions: this.sessions, throttle: this.throttle }, token, work);
  }
}
