import { parseNotificationParams, type NotificationType } from '@lucy-spa/contracts';
import { appendOutboxEvent, type DatabaseClient, type Prisma } from '@lucy-spa/database';
import { takeSharedAuthGraphLock } from './auth-lock.js';
import { resolvePermissionHolders } from './notification-routing.js';

/**
 * Phase 6 P6-4 (design 4.6, P6-T16, Owner P6-Q14): in-app low-stock and expiry alerts for the holders of `VIEW_INVENTORY` at the
 * branch, through the permission engine (never role names). Nothing here sends email, Zalo or SMS.
 *
 * - Low stock: the movement trigger of the database writes one `inventory_low_stock_alerts` row each time a movement that takes
 *   stock out leaves a variant at or below its threshold (and re-arms above it). `processLowStockAlert` turns ONE pending row into
 *   notifications in its own transaction: it re-reads the authoritative level (a restock that came first makes the alert stale),
 *   resolves the recipients, writes the outbox event and the inbox rows, and stamps the row. A throw rolls everything back and the
 *   row stays pending for the next pass.
 * - Expiry: `runExpiryScan` writes one `inventory_expiry_scans` row per branch per branch-local day once the local time has reached
 *   08:00 (my proposal, section 4.6), counts the lots that expired and the lots that expire within the warning window, and
 *   notifies only when there is something to report. The scan row is the claim, so a restart or a second worker repeats nothing.
 */
export const LOW_STOCK_EVENT = 'LOW_STOCK_REACHED';
export const EXPIRY_ALERT_EVENT = 'EXPIRY_ALERT';
/** Phase 6 P6-11 (OQ-75 changed): stock of an expired lot was sold as a last resort. */
export const EXPIRED_LOT_SOLD_EVENT = 'EXPIRED_LOT_SOLD';
export const INVENTORY_ALERT_AGGREGATE = 'StockAlert';
/** Branch-local time from which the daily expiry scan runs. */
export const EXPIRY_SCAN_LOCAL_TIME = '08:00';
export const INVENTORY_ALERT_PERMISSION = 'VIEW_INVENTORY';
const RECIPIENT_PERMISSION = INVENTORY_ALERT_PERMISSION;

export type LowStockOutcome = 'PUBLISHED' | 'STALE' | 'UNROUTABLE' | 'NOT_CLAIMED';

export async function deliverStockAlert(
  tx: Prisma.TransactionClient,
  input: {
    branchId: string;
    aggregateId: string;
    eventType: NotificationType;
    recipients: readonly string[];
    entityType: 'ProductVariant' | 'Branch';
    entityId: string;
    contextCode: string;
    params: unknown;
  },
) {
  const event = await appendOutboxEvent(tx, {
    branchId: input.branchId,
    aggregateType: INVENTORY_ALERT_AGGREGATE,
    aggregateId: input.aggregateId,
    eventType: input.eventType,
    schemaVersion: 1,
    payload: { entityId: input.entityId },
  });
  // The alert is consumed in this same transaction: no relay has anything left to do with the event.
  await tx.outboxEvent.update({ where: { id: event.id }, data: { publishedAt: event.occurredAt } });
  const params = parseNotificationParams(input.eventType, input.params);
  await tx.notification.createMany({
    skipDuplicates: true,
    data: input.recipients.map((recipientUserId) => ({
      recipientUserId,
      sourceEventId: event.id,
      branchId: input.branchId,
      type: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId,
      contextCode: input.contextCode,
      actionAt: event.occurredAt,
      ...(params === null ? {} : { params: params as unknown as Prisma.InputJsonObject }),
    })),
  });
}

/**
 * The holders of the inventory permission at the branch (an inactive branch has none). The caller holds the shared authorization
 * graph lock. A caller that goes on to write notifications for a stock sale resolves them BEFORE it locks the stock and takes a
 * key-share lock on these user rows with the ones it already locks, so the foreign key of the notification never waits behind a
 * command that holds a user row while it waits for the lots (design 10.2).
 */
export async function stockAlertRecipients(
  tx: Prisma.TransactionClient,
  branchId: string,
): Promise<readonly string[]> {
  const branch = await tx.branch.findUnique({
    where: { id: branchId },
    select: { isActive: true },
  });
  return branch?.isActive
    ? resolvePermissionHolders(tx, { branchId, permission: INVENTORY_ALERT_PERMISSION })
    : [];
}

/** The pending alert rows, oldest first (a small page; the caller loops). */
export async function pendingLowStockAlerts(database: DatabaseClient, take = 50) {
  return database.inventoryLowStockAlert.findMany({
    where: { handledAt: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take,
    select: { id: true },
  });
}

/** Handles ONE pending alert inside the caller's transaction. See the module comment. */
export async function processLowStockAlert(
  tx: Prisma.TransactionClient,
  alertId: string,
): Promise<LowStockOutcome> {
  await takeSharedAuthGraphLock(tx);
  const claimed = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM inventory_low_stock_alerts
    WHERE id = ${alertId}::uuid AND handled_at IS NULL
    FOR UPDATE SKIP LOCKED`;
  if (claimed.length === 0) return 'NOT_CLAIMED';
  const alert = await tx.inventoryLowStockAlert.findUniqueOrThrow({ where: { id: alertId } });
  const settle = async (outcome: Exclude<LowStockOutcome, 'NOT_CLAIMED'>) => {
    await tx.inventoryLowStockAlert.update({ where: { id: alertId }, data: { outcome } });
    return outcome;
  };
  const variant = await tx.productVariant.findUnique({
    where: { id: alert.variantId },
    select: { sku: true, isActive: true, lowStockThreshold: true },
  });
  const level = await tx.stockLevel.findUnique({
    where: { branchId_variantId: { branchId: alert.branchId, variantId: alert.variantId } },
    select: { onHand: true },
  });
  // Re-read the truth: restocked since, the threshold removed or raised away, or the variant retired: nothing to say any more.
  if (
    !variant ||
    !variant.isActive ||
    !level ||
    variant.lowStockThreshold === null ||
    level.onHand > variant.lowStockThreshold
  ) {
    return settle('STALE');
  }
  const branch = await tx.branch.findUnique({
    where: { id: alert.branchId },
    select: { isActive: true },
  });
  const recipients = branch?.isActive
    ? await resolvePermissionHolders(tx, {
        branchId: alert.branchId,
        permission: RECIPIENT_PERMISSION,
      })
    : [];
  if (recipients.length === 0) return settle('UNROUTABLE');
  await deliverStockAlert(tx, {
    branchId: alert.branchId,
    aggregateId: alert.id,
    eventType: LOW_STOCK_EVENT,
    recipients,
    entityType: 'ProductVariant',
    entityId: alert.variantId,
    contextCode: variant.sku,
    params: { onHand: level.onHand, threshold: variant.lowStockThreshold },
  });
  return settle('PUBLISHED');
}

/**
 * Today's expiry scan of every active branch whose local time has reached 08:00 and that has none yet for its local date.
 * Idempotent (the primary key of the scan row is the claim). Returns the number of branches scanned.
 */
export async function runExpiryScan(
  database: DatabaseClient,
  now: Date = new Date(),
): Promise<number> {
  const due = await database.$queryRaw<{ id: string; businessDate: string }[]>`
    SELECT b.id::text AS id, to_char(${now}::timestamptz AT TIME ZONE b.timezone, 'YYYY-MM-DD') AS "businessDate"
    FROM branches b
    WHERE b.is_active
      AND (${now}::timestamptz AT TIME ZONE b.timezone)::time >= ${EXPIRY_SCAN_LOCAL_TIME}::time
      AND NOT EXISTS (
        SELECT 1 FROM inventory_expiry_scans s
        WHERE s.branch_id = b.id
          AND s.business_date = (${now}::timestamptz AT TIME ZONE b.timezone)::date)`;
  let scanned = 0;
  for (const branch of due) {
    const done = await database.$transaction(
      (tx) => scanBranch(tx, branch.id, branch.businessDate),
      { timeout: 30_000 },
    );
    if (done) scanned += 1;
  }
  return scanned;
}

async function scanBranch(
  tx: Prisma.TransactionClient,
  branchId: string,
  businessDate: string,
): Promise<boolean> {
  await takeSharedAuthGraphLock(tx);
  // One scanner per branch and day at a time: a second one waits here, then finds the scan row and does nothing.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`inventory-expiry:${branchId}:${businessDate}`}, 0))`;
  const existing = await tx.inventoryExpiryScan.findUnique({
    where: {
      branchId_businessDate: { branchId, businessDate: new Date(`${businessDate}T00:00:00.000Z`) },
    },
    select: { branchId: true },
  });
  if (existing) return false;
  const [counts] = await tx.$queryRaw<
    { warning_days: number; expired: number; expiring: number }[]
  >`
    SELECT s.expiry_warning_days AS warning_days,
           count(l.id) FILTER (WHERE l.expiry_date < ${businessDate}::date)::int AS expired,
           count(l.id) FILTER (WHERE l.expiry_date >= ${businessDate}::date
                                 AND l.expiry_date <= ${businessDate}::date + s.expiry_warning_days)::int AS expiring
    FROM product_settings s
    LEFT JOIN inventory_lots l
      ON l.branch_id = ${branchId}::uuid AND l.quantity_on_hand > 0 AND l.expiry_date IS NOT NULL
    WHERE s.id = 1
    GROUP BY s.expiry_warning_days`;
  if (!counts) throw new Error('The product settings row is missing.');
  const expired = counts.expired;
  const expiring = counts.expiring;
  let outcome: 'PUBLISHED' | 'NOTHING_TO_REPORT' | 'UNROUTABLE' = 'NOTHING_TO_REPORT';
  if (expired + expiring > 0) {
    const recipients = await resolvePermissionHolders(tx, {
      branchId,
      permission: RECIPIENT_PERMISSION,
    });
    if (recipients.length === 0) {
      outcome = 'UNROUTABLE';
    } else {
      await deliverStockAlert(tx, {
        branchId,
        aggregateId: `${branchId}:${businessDate}`,
        eventType: EXPIRY_ALERT_EVENT,
        recipients,
        entityType: 'Branch',
        entityId: branchId,
        contextCode: businessDate,
        params: { withinDays: counts.warning_days, expiredLots: expired, expiringLots: expiring },
      });
      outcome = 'PUBLISHED';
    }
  }
  // The scan row is history (insert-only), written once with its final figures.
  await tx.inventoryExpiryScan.create({
    data: {
      branchId,
      businessDate: new Date(`${businessDate}T00:00:00.000Z`),
      warningDays: counts.warning_days,
      expiringLots: expiring,
      expiredLots: expired,
      outcome,
    },
  });
  return true;
}
