import type { CustomerInvoiceDetail, CustomerInvoiceListResponse } from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runCustomerCommand } from '../booking/customer-command.js';
import { customerInvoiceDetail, customerInvoiceList } from './customer-invoice.core.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Phase 4 Step 9: the signed-in customer's invoice history (read only). The session is the only identity; the
 * browser sends no customer id, and only invoices whose payer is that customer can be listed or opened.
 */
@Injectable()
export class CustomerInvoiceService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<SessionService, 'withTransaction' | 'resolveForMutation'>,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  list(
    token: string | undefined,
    cursor: string | undefined,
  ): Promise<CustomerInvoiceListResponse> {
    return runCustomerCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      ({ tx, customerUserId }) => customerInvoiceList(tx, customerUserId, cursor),
    );
  }

  detail(token: string | undefined, invoiceId: string): Promise<CustomerInvoiceDetail> {
    if (!UUID.test(invoiceId)) return Promise.reject(new AuthError('NOT_FOUND'));
    return runCustomerCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      ({ tx, customerUserId }) =>
        customerInvoiceDetail(tx, customerUserId, invoiceId.toLowerCase()),
    );
  }
}
