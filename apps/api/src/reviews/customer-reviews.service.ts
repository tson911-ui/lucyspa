import type {
  CustomerReviewPrompt,
  CustomerReviewRequest,
  CustomerReviewView,
} from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runCustomerCommand } from '../booking/customer-command.js';
import { reviewPrompt, submitReview } from './customer-reviews.core.js';

/**
 * Phase 8 P8-16: the signed-in customer's review of a paid invoice (see `customer-reviews.core.ts`). The session is the only identity.
 */
@Injectable()
export class CustomerReviewService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<SessionService, 'withTransaction' | 'resolveForMutation'>,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  prompt(token: string | undefined, invoiceId: string): Promise<CustomerReviewPrompt> {
    return runCustomerCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      ({ tx, customerUserId }) => reviewPrompt(tx, customerUserId, invoiceId),
    );
  }

  submit(token: string | undefined, request: CustomerReviewRequest): Promise<CustomerReviewView> {
    return runCustomerCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      ({ tx, customerUserId }) => submitReview(tx, customerUserId, request),
    );
  }
}
