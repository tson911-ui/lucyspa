import type { ProductOrderCancelCauseName } from '@lucy-spa/contracts';
import { cancelCausesFor } from '../product-orders/order.queue.js';

/**
 * Phase 6 Wave 4 (P6-21; OQ-32, OQ-97): the causes a person may cancel a PAID, not yet shipped line of an ONLINE order with. A pre-order
 * line follows the counter rules (supplier cannot deliver, before the supplier order, change of mind after it, more than 7 days late); an
 * in-stock line has no supplier and no waiting, so its only cause is that the customer cancels before the parcel is packed. A shipped line
 * is never cancelled this way: a refused parcel goes through the failed delivery, a received one through a return (OQ-97).
 */
export function cancelCausesOnline(
  line: { status: string; mode: 'IN_STOCK' | 'PRE_ORDER'; expectedTo: string | null },
  today: string,
): ProductOrderCancelCauseName[] {
  if (line.mode === 'IN_STOCK') {
    return line.status === 'PAID' ? ['CUSTOMER_CANCELLED_BEFORE_ORDERING'] : [];
  }
  return cancelCausesFor({ status: line.status, expectedTo: line.expectedTo }, today);
}
