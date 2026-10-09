import { appendOutboxEvent, type DatabaseClient, type Prisma } from '@lucy-spa/database';
import { parseNotificationParams } from '@lucy-spa/contracts';
import { takeSharedAuthGraphLock } from './auth-lock.js';
import { resolvePermissionHolders } from './notification-routing.js';

/**
 * Phase 6 Wave 4 (P6-20; OQ-94, OQ-96; the Owner's approval of 2026-10-09): the daily in-app alert of the online orders, for the holders of
 * `MANAGE_PRODUCT_ORDERS` at the branch. It counts (1) the paid orders whose goods are all ready but that were not shipped within the
 * promised number of WORKING days (my reading, pending the Owner: Monday to Friday) and (2) the parcels shipped more than 7 days ago with
 * no delivery date yet, and says so only when there is something to report. Staff then ask the carrier; NOTHING is cancelled or changed by
 * the scan. One scan row per branch and branch-local day is the claim, so a restart or a second worker repeats nothing; it runs from
 * 08:00 branch-local time, like the other daily scans.
 */
export const ONLINE_ALERT_EVENT = 'ONLINE_ORDER_ALERT';
export const ONLINE_ALERT_AGGREGATE = 'OnlineOrderAlert';
export const ONLINE_SCAN_LOCAL_TIME = '08:00';
export const ONLINE_ALERT_PERMISSION = 'MANAGE_PRODUCT_ORDERS';
/** A parcel shipped more than this many days ago with no delivery date is reported (OQ-96). */
export const ONLINE_UNDELIVERED_DAYS = 7;

export async function runOnlineOrderScan(
  database: DatabaseClient,
  now: Date = new Date(),
): Promise<number> {
  const due = await database.$queryRaw<{ id: string; businessDate: string }[]>`
    SELECT b.id::text AS id, to_char(${now}::timestamptz AT TIME ZONE b.timezone, 'YYYY-MM-DD') AS "businessDate"
    FROM branches b
    WHERE b.is_active
      AND (${now}::timestamptz AT TIME ZONE b.timezone)::time >= ${ONLINE_SCAN_LOCAL_TIME}::time
      AND NOT EXISTS (
        SELECT 1 FROM online_order_scans s
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
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`online-scan:${branchId}:${businessDate}`}, 0))`;
  const date = new Date(`${businessDate}T00:00:00.000Z`);
  const existing = await tx.onlineOrderScan.findUnique({
    where: { branchId_businessDate: { branchId, businessDate: date } },
    select: { branchId: true },
  });
  if (existing) return false;
  const settings = await tx.onlineSalesSettings.findUniqueOrThrow({
    where: { id: 1 },
    select: { shipWithinWorkingDays: true },
  });
  const [unshipped] = await tx.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM (
      SELECT p.id,
             max(CASE WHEN d.fulfilment_mode = 'PRE_ORDER' THEN l.arrived_at ELSE l.paid_at END) AS ready_at
      FROM product_orders p
        JOIN invoices i ON i.id = p.invoice_id AND i.status = 'PAID'
        JOIN product_order_lines l ON l.order_id = p.id AND l.status <> 'CANCELLED'
        JOIN invoice_line_products d ON d.invoice_line_id = l.invoice_line_id
      WHERE p.channel = 'ONLINE' AND p.branch_id = ${branchId}::uuid
      GROUP BY p.id
      HAVING bool_and((d.fulfilment_mode = 'PRE_ORDER' AND l.status = 'ARRIVED') OR (d.fulfilment_mode = 'IN_STOCK' AND l.status = 'PAID'))
    ) r
    WHERE (
      SELECT count(*) FROM generate_series(
        lucy_branch_local_date(${branchId}::uuid, r.ready_at) + 1, ${businessDate}::date, interval '1 day') g
      WHERE extract(isodow FROM g) < 6) > ${settings.shipWithinWorkingDays}`;
  const [undelivered] = await tx.$queryRaw<{ n: number }[]>`
    SELECT count(DISTINCT l.order_id)::int AS n
    FROM product_order_lines l JOIN product_orders p ON p.id = l.order_id AND p.channel = 'ONLINE'
    WHERE p.branch_id = ${branchId}::uuid AND l.status = 'SHIPPED'
      AND l.shipped_at < ${now}::timestamptz - make_interval(days => ${ONLINE_UNDELIVERED_DAYS})`;
  const late = unshipped?.n ?? 0;
  const old = undelivered?.n ?? 0;
  let outcome: 'PUBLISHED' | 'NOTHING_TO_REPORT' | 'UNROUTABLE' = 'NOTHING_TO_REPORT';
  if (late + old > 0) {
    const recipients = await resolvePermissionHolders(tx, {
      branchId,
      permission: ONLINE_ALERT_PERMISSION,
    });
    if (recipients.length === 0) {
      outcome = 'UNROUTABLE';
    } else {
      const event = await appendOutboxEvent(tx, {
        branchId,
        aggregateType: ONLINE_ALERT_AGGREGATE,
        aggregateId: `${branchId}:${businessDate}`,
        eventType: ONLINE_ALERT_EVENT,
        schemaVersion: 1,
        payload: { entityId: branchId },
      });
      // Consumed in this same transaction: no relay has anything left to do with the event.
      await tx.outboxEvent.update({
        where: { id: event.id },
        data: { publishedAt: event.occurredAt },
      });
      const params = parseNotificationParams(ONLINE_ALERT_EVENT, {
        unshippedOrders: late,
        undeliveredOrders: old,
      });
      await tx.notification.createMany({
        skipDuplicates: true,
        data: recipients.map((recipientUserId) => ({
          recipientUserId,
          sourceEventId: event.id,
          branchId,
          type: ONLINE_ALERT_EVENT,
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
  await tx.onlineOrderScan.create({
    data: { branchId, businessDate: date, unshippedOrders: late, undeliveredOrders: old, outcome },
  });
  return true;
}
