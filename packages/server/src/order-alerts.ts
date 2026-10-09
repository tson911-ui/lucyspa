import { appendOutboxEvent, type DatabaseClient, type Prisma } from '@lucy-spa/database';
import { parseNotificationParams } from '@lucy-spa/contracts';
import { takeSharedAuthGraphLock } from './auth-lock.js';
import { resolvePermissionHolders } from './notification-routing.js';

/**
 * Phase 6 P6-17 (OQ-34, OQ-86; the Owner's words 2026-10-07): the daily in-app alert of the pre-orders, for the holders of
 * `MANAGE_PRODUCT_ORDERS` at the branch. It counts the paid lines whose goods have not arrived after their expected date (branch-local
 * date) and the arrived lines nobody collected for more than 7 days, and says so only when there is something to report. Wave 4: only
 * pre-order lines (an online order's in-stock lines are PAID too but hold their stock), and the goods that wait to be collected are the
 * counter's (an online parcel waits to be shipped; the online scan watches it). Staff then
 * call the customers; NOTHING is cancelled or changed by the scan. One scan row per branch and branch-local day is the claim, so a
 * restart or a second worker repeats nothing; it runs from 08:00 branch-local time, like the expiry scan.
 */
export const ORDER_ALERT_EVENT = 'PRODUCT_ORDER_ALERT';
export const ORDER_ALERT_AGGREGATE = 'ProductOrderAlert';
export const ORDER_SCAN_LOCAL_TIME = '08:00';
export const ORDER_ALERT_PERMISSION = 'MANAGE_PRODUCT_ORDERS';
/** Arrived goods nobody collected for more than this many days are reported (OQ-34). */
export const ORDER_HELD_DAYS = 7;

export async function runOrderScan(
  database: DatabaseClient,
  now: Date = new Date(),
): Promise<number> {
  const due = await database.$queryRaw<{ id: string; businessDate: string }[]>`
    SELECT b.id::text AS id, to_char(${now}::timestamptz AT TIME ZONE b.timezone, 'YYYY-MM-DD') AS "businessDate"
    FROM branches b
    WHERE b.is_active
      AND (${now}::timestamptz AT TIME ZONE b.timezone)::time >= ${ORDER_SCAN_LOCAL_TIME}::time
      AND NOT EXISTS (
        SELECT 1 FROM product_order_scans s
        WHERE s.branch_id = b.id
          AND s.business_date = (${now}::timestamptz AT TIME ZONE b.timezone)::date)`;
  let scanned = 0;
  for (const branch of due) {
    const done = await database.$transaction(
      (tx) => scanBranch(tx, branch.id, branch.businessDate, now),
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
  now: Date,
): Promise<boolean> {
  await takeSharedAuthGraphLock(tx);
  // One scanner per branch and day at a time: a second one waits here, then finds the scan row and does nothing.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`order-scan:${branchId}:${businessDate}`}, 0))`;
  const date = new Date(`${businessDate}T00:00:00.000Z`);
  const existing = await tx.productOrderScan.findUnique({
    where: { branchId_businessDate: { branchId, businessDate: date } },
    select: { branchId: true },
  });
  if (existing) return false;
  const [counts] = await tx.$queryRaw<{ late: number; held: number }[]>`
    SELECT count(*) FILTER (WHERE o.status IN ('PAID', 'ORDERED') AND o.expected_to < ${businessDate}::date)::int AS late,
           count(*) FILTER (WHERE o.status = 'ARRIVED' AND p.channel = 'COUNTER'
                              AND o.arrived_at < ${now}::timestamptz - make_interval(days => ${ORDER_HELD_DAYS}))::int AS held
    FROM product_order_lines o
      JOIN product_orders p ON p.id = o.order_id
      JOIN invoice_line_products d ON d.invoice_line_id = o.invoice_line_id
    WHERE o.branch_id = ${branchId}::uuid AND o.status IN ('PAID', 'ORDERED', 'ARRIVED')
      AND d.fulfilment_mode = 'PRE_ORDER'`;
  const late = counts?.late ?? 0;
  const held = counts?.held ?? 0;
  let outcome: 'PUBLISHED' | 'NOTHING_TO_REPORT' | 'UNROUTABLE' = 'NOTHING_TO_REPORT';
  if (late + held > 0) {
    const recipients = await resolvePermissionHolders(tx, {
      branchId,
      permission: ORDER_ALERT_PERMISSION,
    });
    if (recipients.length === 0) {
      outcome = 'UNROUTABLE';
    } else {
      const event = await appendOutboxEvent(tx, {
        branchId,
        aggregateType: ORDER_ALERT_AGGREGATE,
        aggregateId: `${branchId}:${businessDate}`,
        eventType: ORDER_ALERT_EVENT,
        schemaVersion: 1,
        payload: { entityId: branchId },
      });
      // Consumed in this same transaction: no relay has anything left to do with the event.
      await tx.outboxEvent.update({
        where: { id: event.id },
        data: { publishedAt: event.occurredAt },
      });
      const params = parseNotificationParams(ORDER_ALERT_EVENT, {
        lateLines: late,
        heldLines: held,
      });
      await tx.notification.createMany({
        skipDuplicates: true,
        data: recipients.map((recipientUserId) => ({
          recipientUserId,
          sourceEventId: event.id,
          branchId,
          type: ORDER_ALERT_EVENT,
          entityType: 'Branch',
          entityId: branchId,
          contextCode: businessDate,
          actionAt: event.occurredAt,
          ...(params === null ? {} : { params: params as unknown as Prisma.InputJsonObject }),
        })),
      });
      outcome = 'PUBLISHED';
    }
  }
  // The scan row is history (insert-only), written once with its final figures.
  await tx.productOrderScan.create({
    data: { branchId, businessDate: date, lateLines: late, heldLines: held, outcome },
  });
  return true;
}
