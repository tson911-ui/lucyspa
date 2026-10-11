import { parseNotificationParams } from '@lucy-spa/contracts';
import { appendOutboxEvent, type Prisma } from '@lucy-spa/database';
import { resolveGlobalPermissionHolders } from '../notification-routing.js';
import { hasChanges, type ScanChangeCounts } from './resync.js';

/**
 * Phase 9 P9-7: the in-app summary of a scan, for the holders of REVIEW_SUPPLIER_IMPORTS (design section 10). It is written only when a
 * healthy scan found something (new products, changed prices, text or pictures, products no longer on the source): no message when
 * nothing changed, and none for a scan that failed or was suspect (the sources screen shows those). The message carries counts and
 * nothing else: never a name, a price or a link. The person who asked for a manual scan already sees its result and is left out.
 * Everything happens in the caller's transaction (the scan row is the claim, so a retry cannot send it twice). The caller holds the
 * shared authorization-graph lock.
 */
export const SUPPLIER_IMPORT_EVENT = 'SUPPLIER_IMPORT_CHANGES';
export const SUPPLIER_IMPORT_AGGREGATE = 'SupplierImportScan';
export const SUPPLIER_IMPORT_PERMISSION = 'REVIEW_SUPPLIER_IMPORTS';

export type ImportNoticeOutcome = 'PUBLISHED' | 'NOTHING_TO_REPORT' | 'NO_RECIPIENT';

export async function notifySupplierImportChanges(
  tx: Prisma.TransactionClient,
  input: {
    sourceId: string;
    sourceName: string;
    scanId: string;
    actorUserId: string | null;
    counts: ScanChangeCounts;
  },
): Promise<ImportNoticeOutcome> {
  if (!hasChanges(input.counts)) return 'NOTHING_TO_REPORT';
  const recipients = await resolveGlobalPermissionHolders(tx, {
    permission: SUPPLIER_IMPORT_PERMISSION,
    exclude: input.actorUserId === null ? [] : [input.actorUserId],
  });
  if (recipients.length === 0) return 'NO_RECIPIENT';
  const params = parseNotificationParams(SUPPLIER_IMPORT_EVENT, { ...input.counts });
  const event = await appendOutboxEvent(tx, {
    aggregateType: SUPPLIER_IMPORT_AGGREGATE,
    aggregateId: input.scanId,
    eventType: SUPPLIER_IMPORT_EVENT,
    schemaVersion: 1,
    payload: { entityId: input.sourceId },
  });
  // Consumed in this same transaction: no relay has anything left to do with the event.
  await tx.outboxEvent.update({ where: { id: event.id }, data: { publishedAt: event.occurredAt } });
  await tx.notification.createMany({
    skipDuplicates: true,
    data: recipients.map((recipientUserId) => ({
      recipientUserId,
      sourceEventId: event.id,
      branchId: null,
      type: SUPPLIER_IMPORT_EVENT,
      entityType: 'SupplierSource',
      entityId: input.sourceId,
      // The inbox shows this next to the type; the source name is the one short, human label the notice needs.
      contextCode: input.sourceName.slice(0, 80),
      actionAt: event.occurredAt,
      ...(params === null ? {} : { params: params as unknown as Prisma.InputJsonObject }),
    })),
  });
  return 'PUBLISHED';
}
