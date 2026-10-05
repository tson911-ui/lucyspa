import type { ComboSoldCustomerPageResponse, CustomerGiftPageResponse } from '@lucy-spa/contracts';
import { listSold, soldPageOf } from '../combo/combo-sold.core.js';
import type { AdminContext } from '../authorization/admin-command.js';
import { customerGifts } from './customer-loyalty.core.js';
import { customerOrNotFound, requireView } from './loyalty.core.js';

/**
 * Phase 5 P5-10b: a customer's combos and gifts on the staff profile (Owner instruction of 2026-10-05). Read only, with the
 * profile's own rule: `VIEW_LOYALTY` at the branch the staff member works at. Combos show every state (revoked and frozen
 * included); gifts show status, units left and expiry, never the grant reason or the staff names.
 */
export async function profileCombos(
  context: AdminContext,
  branchId: string,
  userId: string,
  query: { page?: string },
): Promise<ComboSoldCustomerPageResponse> {
  requireView(context, branchId);
  await customerOrNotFound(context.tx, userId);
  return listSold(context.tx, context.now, {
    ownerUserId: userId,
    status: null,
    page: soldPageOf(query.page),
    withValue: false,
  });
}

export async function profileGifts(
  context: AdminContext,
  branchId: string,
  userId: string,
  query: { page?: string },
): Promise<CustomerGiftPageResponse> {
  requireView(context, branchId);
  await customerOrNotFound(context.tx, userId);
  return customerGifts(context.tx, userId, query.page, context.now);
}
