import { appendOutboxEvent, type Prisma } from '@lucy-spa/database';
import { createLogger } from '@lucy-spa/server';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import type { ShadowOutcome } from './pricing.shadow.js';

/**
 * Phase 6 P6-9, OQ-59: what happens when the version 3 calculator, running beside the version 2 source of truth of an invoice with no
 * product line, differs from it or fails. The charged amount is NEVER touched (the caller already used the version 2 result). The
 * difference is made impossible to miss, in three durable places:
 *  - an ERROR log line with the stable code `PRICING_V3_MISMATCH` (the operational alert; log tooling can page on it);
 *  - an append-only audit entry `PRICING_V3_MISMATCH` on the invoice (FINANCIAL), with every differing field;
 *  - an outbox event `PRICING_V3_MISMATCH` in the same transaction, so a notification consumer can be attached later without
 *    touching the POS (no in-app notification channel is built here; the Owner chooses where to be alerted).
 * Agreement writes nothing and logs nothing.
 */

const logger = createLogger('pricing-shadow', 'info');

/** Where the error line goes; a test replaces it to observe the alert without parsing log output. */
export const shadowAlert: { error: (entry: Record<string, unknown>, message: string) => void } = {
  error: (entry, message) => {
    logger.error(entry, message);
  },
};

export async function reportShadow(
  context: AdminContext,
  invoice: { id: string; branchId: string },
  outcome: ShadowOutcome,
): Promise<void> {
  if (outcome.mismatches.length === 0) return;
  const mismatches = outcome.mismatches.slice(0, 25).map((entry) => ({
    field: entry.field,
    v2: entry.v2,
    v3: entry.v3,
  }));
  shadowAlert.error(
    {
      code: 'PRICING_V3_MISMATCH',
      invoiceId: invoice.id,
      branchId: invoice.branchId,
      ran: outcome.ran,
      mismatches,
    },
    'Pricing v3 differs from the v2 source of truth; the v2 amount was charged',
  );
  const detail = { ran: outcome.ran, mismatches } as unknown as Prisma.InputJsonObject;
  await appendAdminAudit(context, {
    action: 'PRICING_V3_MISMATCH',
    entityType: 'Invoice',
    entityId: invoice.id,
    branchId: invoice.branchId,
    classification: 'FINANCIAL',
    after: detail,
  });
  await appendOutboxEvent(context.tx, {
    branchId: invoice.branchId,
    aggregateType: 'Invoice',
    aggregateId: invoice.id,
    eventType: 'PRICING_V3_MISMATCH',
    schemaVersion: 1,
    occurredAt: context.now,
    payload: { invoiceId: invoice.id, branchId: invoice.branchId, ...detail },
  });
}
