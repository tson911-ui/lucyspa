import { randomUUID } from 'node:crypto';
import type {
  AccountDeletionCheckResponse,
  AccountDeletionCombo,
  AccountDeletionOrder,
  CustomerBookingSummary,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import {
  ACCOUNT_DELETION_EMAIL_EVENT_TYPE,
  ACCOUNT_DELETION_EMAIL_EVENT_VERSION,
  ACCOUNT_DELETION_EMAIL_LIFETIME_MS,
  accountDeletionEmailBinding,
  sealDeliveryPayload,
  type AccountDeletionEmailEnvelope,
  type AuthEnvironment,
} from '@lucy-spa/server';
import { invalidateChallenges } from '../auth/otp-flow.js';
import { cancelCustomerBooking, customerBookingList } from '../booking/booking.core.js';

/**
 * Session 10 A2: what a customer's own account deletion checks and does. Every function runs inside the caller's transaction, after
 * the session's user row was locked (`runCustomerCommand`), so the check and the deletion read the same state.
 */

/** The neutral name of a deleted account (the database refuses any other name on a deleted customer row). */
export const DELETED_ACCOUNT_NAME = 'Tài khoản đã xóa';

/** Written on the bookings the deletion cancels, so the spa sees why (no personal data). */
export const DELETION_CANCEL_REASON = 'Khách đã xóa tài khoản';

/** Pure: the order kind that stops the deletion, or null when the order is finished (reading, pending Owner confirmation). */
export function unfinishedOrderKind(order: {
  channel: string;
  invoiceStatus: string;
  queueState: string | null;
  lineStatuses: readonly string[];
}): AccountDeletionOrder['kind'] | null {
  if (order.channel === 'ONLINE') {
    if (order.queueState === 'UNPAID') {
      // An unpaid order whose invoice was cancelled (or timed out) is over; one still pending payment is not.
      return order.invoiceStatus === 'PENDING_PAYMENT' ? 'ONLINE_UNPAID' : null;
    }
    return order.queueState === 'DONE' || order.queueState === 'CANCELLED'
      ? null
      : 'ONLINE_IN_PROGRESS';
  }
  // At the counter: a pre-order line still waiting for payment, for the goods or for the customer to collect them.
  return order.lineStatuses.some((status) =>
    ['AWAITING_PAYMENT', 'PAID', 'ORDERED', 'ARRIVED'].includes(status),
  )
    ? 'COUNTER_PREORDER'
    : null;
}

/** Pure: a combo still has prepaid sessions the customer can use (the member page's "active" rule). */
export function comboSessionsLeft(facts: {
  usable: boolean;
  freeSessions: number;
  expiresAt: Date | null;
  now: Date;
}): number {
  if (!facts.usable || facts.freeSessions === 0) return 0;
  if (facts.expiresAt !== null && facts.expiresAt.getTime() <= facts.now.getTime()) return 0;
  return facts.freeSessions;
}

async function unusedCombos(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
): Promise<AccountDeletionCombo[]> {
  // A combo revoked before any use (voided_at) is not counted: its money went back with the reversal.
  const rows = await tx.comboPurchase.findMany({
    where: { ownerUserId: userId, voidedAt: null },
    orderBy: [{ issuedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      nameVi: true,
      nameEn: true,
      expiresAt: true,
      service: { select: { nameVi: true, nameEn: true } },
      sessions: {
        select: {
          consumptions: {
            select: { release: { select: { id: true } }, restoration: { select: { id: true } } },
          },
        },
      },
    },
  });
  if (rows.length === 0) return [];
  // The database's own usability rule (sale invoice PAID in a usable episode), not a copy of it.
  const flags = await tx.$queryRaw<{ id: string; usable: boolean }[]>`
    SELECT p.id, lucy_combo_purchase_usable(p.id) AS usable
    FROM combo_purchases p WHERE p.id = ANY(${rows.map((row) => row.id)}::uuid[])`;
  const usable = new Map(flags.map((flag) => [flag.id, flag.usable === true]));
  return rows.flatMap((row) => {
    const free = row.sessions.filter(
      (session) =>
        !session.consumptions.some((use) => use.release === null && use.restoration === null),
    ).length;
    const left = comboSessionsLeft({
      usable: usable.get(row.id) === true,
      freeSessions: free,
      expiresAt: row.expiresAt,
      now,
    });
    return left === 0
      ? []
      : [
          {
            id: row.id,
            nameVi: row.nameVi,
            nameEn: row.nameEn,
            serviceNameVi: row.service.nameVi,
            serviceNameEn: row.service.nameEn,
            sessionsLeft: left,
            expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
          },
        ];
  });
}

async function unfinishedOrders(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<AccountDeletionOrder[]> {
  const rows = await tx.productOrder.findMany({
    where: { customerUserId: userId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      code: true,
      channel: true,
      createdAt: true,
      invoice: { select: { status: true } },
      lines: { select: { status: true } },
    },
  });
  const online = rows.filter((row) => row.channel === 'ONLINE').map((row) => row.id);
  const readings = online.length
    ? await tx.$queryRaw<{ order_id: string; queue_state: string }[]>`
        SELECT order_id, queue_state FROM online_order_states WHERE order_id = ANY(${online}::uuid[])`
    : [];
  const stateOf = new Map(readings.map((entry) => [entry.order_id, entry.queue_state]));
  return rows.flatMap((row) => {
    const kind = unfinishedOrderKind({
      channel: row.channel,
      invoiceStatus: row.invoice.status,
      queueState: stateOf.get(row.id) ?? null,
      lineStatuses: row.lines.map((line) => line.status),
    });
    return kind === null
      ? []
      : [{ id: row.id, code: row.code, kind, placedAt: row.createdAt.toISOString() }];
  });
}

async function pointBalances(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<{ spa: number; beauty: number } | null> {
  if ((await tx.loyaltyGoLive.findFirst({ select: { id: true } })) === null) return null;
  const accounts = await tx.loyaltyWalletAccount.findMany({
    where: { userId },
    select: { wallet: true, balancePoints: true },
  });
  const balance = (wallet: string) =>
    Number(accounts.find((account) => account.wallet === wallet)?.balancePoints ?? 0);
  return { spa: balance('SPA'), beauty: balance('BEAUTY') };
}

export interface DeletionFacts {
  readonly response: AccountDeletionCheckResponse;
  /** CONFIRMED bookings the deletion cancels. */
  readonly bookingsToCancel: readonly CustomerBookingSummary[];
}

/** The check shown on the explanation page; the deletion runs it again under the same lock. */
export async function deletionFacts(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
): Promise<DeletionFacts> {
  // One query at a time: they share the caller's transaction connection.
  const combos = await unusedCombos(tx, userId, now);
  const orders = await unfinishedOrders(tx, userId);
  const bookings = await customerBookingList(tx, userId, now);
  const openVisits = await tx.visit.count({
    where: { ownerUserId: userId, status: { in: ['OPEN', 'IN_SERVICE'] } },
  });
  const openReturns = await tx.productReturnCase.count({
    where: { status: 'OPEN', invoice: { payerUserId: userId } },
  });
  const points = await pointBalances(tx, userId);
  const bookingsToCancel = bookings.upcoming.filter((booking) => booking.status === 'CONFIRMED');
  const atSpa =
    openVisits > 0 ||
    bookings.upcoming.some(
      (booking) => booking.status === 'ARRIVED' || booking.status === 'IN_SERVICE',
    );
  return {
    bookingsToCancel,
    response: {
      canDelete: combos.length === 0 && orders.length === 0 && !atSpa && openReturns === 0,
      blockers: { combos, orders, atSpa, openReturns },
      losses: { points, upcomingBookings: bookingsToCancel },
    },
  };
}

export interface ErasedUser {
  readonly id: string;
  readonly emailDelivery: string | null;
  readonly preferredLocale: 'vi' | 'en';
}

export interface ErasureSummary {
  readonly bookingsCancelled: number;
  readonly ordersErased: number;
  readonly addressesDeleted: number;
  readonly sessionsRevoked: number;
  readonly notificationsArchived: number;
  readonly emailQueued: boolean;
}

function deliveryKeyRing(auth: AuthEnvironment): { version: number; key: Buffer } | null {
  const version = auth.deliveryActiveVersion;
  const key = version === undefined ? undefined : auth.deliveryKeys?.get(version);
  return version === undefined || !key ? null : { version, key };
}

/**
 * The deletion itself (one transaction, the user row locked by the caller, the blockers already checked):
 * 1. the upcoming bookings are cancelled through the normal customer cancellation (outbox events included);
 * 2. the account row is erased in place: placeholder name, no email, phone or password, INACTIVE, `deleted_at`, credential version
 *    up (every token bound to it is dead) and every session revoked; live sign-in, reset and email flows are invalidated;
 * 3. the profile's birthday and address, the saved addresses and the cart are removed; inbox items are archived;
 * 4. never-paid, cancelled online orders lose the recipient's and contact's name and phone (Owner answer 3); paid ones keep them;
 * 5. the confirmation email is sealed for the address read before the erasure (the outbox event carries the row id only).
 * Invoices, payments, bookings, points ledger, reviews and the audit trail keep pointing at the same (now nameless) id.
 */
export async function eraseCustomerAccount(
  tx: Prisma.TransactionClient,
  input: {
    user: ErasedUser;
    bookingsToCancel: readonly CustomerBookingSummary[];
    now: Date;
    auth: AuthEnvironment;
  },
): Promise<ErasureSummary> {
  const { user, now } = input;
  for (const booking of input.bookingsToCancel) {
    await cancelCustomerBooking(tx, user.id, booking.id, DELETION_CANCEL_REASON, now);
  }
  const neverPaid = await tx.productOrder.findMany({
    where: {
      customerUserId: user.id,
      channel: 'ONLINE',
      contactPhone: { not: null },
      invoice: { paidSeq: 0, status: 'CANCELLED' },
    },
    select: { id: true },
  });

  await tx.user.update({
    where: { id: user.id },
    data: {
      fullName: DELETED_ACCOUNT_NAME,
      emailCanonical: null,
      emailDelivery: null,
      emailVerifiedAt: null,
      phoneCanonical: null,
      passwordHash: null,
      status: 'INACTIVE',
      deletedAt: now,
      credentialVersion: { increment: 1 },
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  await tx.customerProfile.updateMany({
    where: { userId: user.id },
    data: { dateOfBirth: null, address: null },
  });

  const ids = neverPaid.map((order) => order.id);
  if (ids.length > 0) {
    await tx.onlineOrderDetail.updateMany({
      where: { orderId: { in: ids } },
      data: { recipientName: null, recipientPhone: null },
    });
    await tx.productOrder.updateMany({
      where: { id: { in: ids } },
      data: { contactName: null, contactPhone: null },
    });
  }

  const sessions = await tx.session.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: now },
  });
  const flows = await tx.authChallenge.findMany({
    where: { userId: user.id, consumedAt: null, invalidatedAt: null },
    select: { id: true },
  });
  await invalidateChallenges(
    tx,
    flows.map((flow) => flow.id),
    now,
  );
  const addresses = await tx.customerAddress.deleteMany({ where: { userId: user.id } });
  // The cart's lines go with it (ON DELETE CASCADE).
  await tx.onlineCart.deleteMany({ where: { userId: user.id } });
  const inbox = await tx.notification.updateMany({
    where: { recipientUserId: user.id, archivedAt: null },
    data: { archivedAt: now },
  });

  const emailQueued = await queueConfirmationEmail(tx, input.auth, user, now);
  return {
    bookingsCancelled: input.bookingsToCancel.length,
    ordersErased: ids.length,
    addressesDeleted: addresses.count,
    sessionsRevoked: sessions.count,
    notificationsArchived: inbox.count,
    emailQueued,
  };
}

/** Seals the confirmation for the address read before the erasure; false when the account had no address on file. */
async function queueConfirmationEmail(
  tx: Prisma.TransactionClient,
  auth: AuthEnvironment,
  user: ErasedUser,
  now: Date,
): Promise<boolean> {
  if (user.emailDelivery === null) return false;
  const ring = deliveryKeyRing(auth);
  // The service refuses to start a deletion without the key ring, so this is a programming error, never a silent skip.
  if (ring === null) throw new Error('Delivery encryption unavailable.');
  const id = randomUUID();
  const envelope: AccountDeletionEmailEnvelope = {
    v: 1,
    kind: 'ACCOUNT_DELETED',
    to: user.emailDelivery,
    locale: user.preferredLocale,
    deletedAt: now.toISOString(),
  };
  const sealed = sealDeliveryPayload(
    JSON.stringify(envelope),
    accountDeletionEmailBinding(id),
    ring.key,
  );
  await tx.accountDeletionEmail.create({
    data: {
      id,
      userId: user.id,
      state: 'PENDING',
      encryptedPayload: new Uint8Array(sealed.ciphertext),
      nonce: new Uint8Array(sealed.nonce),
      tag: new Uint8Array(sealed.tag),
      keyVersion: ring.version,
      createdAt: now,
      expiresAt: new Date(now.getTime() + ACCOUNT_DELETION_EMAIL_LIFETIME_MS),
      nextAttemptAt: now,
    },
    select: { id: true },
  });
  await tx.outboxEvent.create({
    data: {
      aggregateType: 'AccountDeletionEmail',
      aggregateId: id,
      eventType: ACCOUNT_DELETION_EMAIL_EVENT_TYPE,
      schemaVersion: ACCOUNT_DELETION_EMAIL_EVENT_VERSION,
      payload: { emailId: id, eventVersion: ACCOUNT_DELETION_EMAIL_EVENT_VERSION },
      occurredAt: now,
    },
    select: { id: true },
  });
  return true;
}
