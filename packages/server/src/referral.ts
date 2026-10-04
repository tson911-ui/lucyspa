import { appendOutboxEvent, type Prisma } from '@lucy-spa/database';

/**
 * Phase 5 P5-5: referral facts shared by the API (signup, counter binding) and the `loyalty` consumer (the award).
 * Owner decisions of 2026-10-04 (design 2.5): a "brand-new customer" is a phone with no completed visit ever (guest visits
 * and visits before go-live included); a referrer is an existing member (any status); only self-referral is refused.
 */
export const REFERRAL_AGGREGATE = 'Referral';

export interface CompletedVisit {
  id: string;
  completedAt: Date | null;
}

/**
 * The customer's COMPLETED visits, earliest first (`completed_at`, then id). A visit counts only when the customer RECEIVED a
 * service in it: they are a participant (by account, or by canonical phone for a member or guest participant) with a DONE service
 * line (P5-Q4, design 7.4; Owner decision 2026-10-04: a booker who received nothing does not count as "already visited").
 */
export async function completedVisitsOf(
  tx: Prisma.TransactionClient,
  userId: string,
  limit: number,
): Promise<CompletedVisit[]> {
  const rows = await tx.$queryRaw<{ id: string; completed_at: Date | null }[]>`
    SELECT v.id, v.completed_at
    FROM visits v
    WHERE v.status = 'COMPLETED'
      AND EXISTS (
        SELECT 1 FROM visit_participants p
        WHERE p.visit_id = v.id
          AND (
            p.customer_user_id = ${userId}::uuid
            OR (p.phone_canonical IS NOT NULL
                AND p.phone_canonical = (SELECT u.phone_canonical FROM users u WHERE u.id = ${userId}::uuid))
          )
          AND EXISTS (
            SELECT 1 FROM visit_service_lines l
            WHERE l.visit_id = v.id AND l.participant_id = p.id AND l.status = 'DONE'
          )
      )
    ORDER BY v.completed_at, v.id
    LIMIT ${limit}`;
  return rows.map((row) => ({ id: row.id, completedAt: row.completed_at }));
}

/**
 * May a referrer still be recorded for this customer? Yes while the customer has no completed visit, or while the only
 * completed visit is the first one and its invoice was never paid (a visit completes before its invoice exists, so the counter
 * must be able to bind in that window; it closes at the first paid episode, P5-T10).
 */
export async function canBindReferrer(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  const visits = await completedVisitsOf(tx, userId, 2);
  if (visits.length === 0) return true;
  if (visits.length > 1) return false;
  const paid = await tx.invoice.count({ where: { visitId: visits[0]!.id, paidSeq: { gt: 0 } } });
  return paid === 0;
}

/** An existing member by exact canonical phone. Locked or disabled accounts still count (Owner decision, OQ-6). */
export function findMemberByPhone(tx: Prisma.TransactionClient, phoneCanonical: string) {
  return tx.user.findFirst({
    where: { kind: 'CUSTOMER', phoneCanonical },
    select: { id: true, fullName: true, phoneCanonical: true },
  });
}

export interface BindReferralInput {
  referredUserId: string;
  referrerUserId: string;
  via: 'SIGNUP' | 'COUNTER';
  /** The staff member for a counter binding. */
  actorUserId?: string;
  branchId?: string | null;
}

/**
 * Records the permanent link (one referrer per customer, DB-enforced) and its outbox event. Callers check the rules first
 * (self-referral, brand-new, existing binding) and write their own audit row. Allowed while go-live is OFF: the award, never
 * the binding, needs go-live.
 */
export async function bindReferral(
  tx: Prisma.TransactionClient,
  input: BindReferralInput,
): Promise<{ id: string }> {
  const referral = await tx.referral.create({
    data: {
      referredUserId: input.referredUserId,
      referrerUserId: input.referrerUserId,
      boundVia: input.via,
      boundByUserId: input.via === 'COUNTER' ? (input.actorUserId ?? null) : null,
    },
    select: { id: true },
  });
  await appendOutboxEvent(tx, {
    ...(input.branchId ? { branchId: input.branchId } : {}),
    aggregateType: REFERRAL_AGGREGATE,
    aggregateId: referral.id,
    eventType: 'REFERRAL_BOUND',
    schemaVersion: 1,
    payload: {
      referralId: referral.id,
      referredUserId: input.referredUserId,
      referrerUserId: input.referrerUserId,
      via: input.via,
    },
  });
  return referral;
}

export interface ReferralAwardCandidate {
  referralId: string;
  referredUserId: string;
  referrerUserId: string;
}

/**
 * The unawarded referrals this paid invoice may reward, with their rows LOCKED (sorted by id, before any wallet: a concurrent
 * Owner correction waits here and then sees the award, or is refused). A referral qualifies when its referred customer
 * RECEIVED the service (a participant of the visit, by account or by phone, anyone may pay), the referral was bound before
 * this episode was paid (the binding window closes at the first payment), and this visit is that customer's FIRST completed visit.
 */
export async function referralAwardCandidates(
  tx: Prisma.TransactionClient,
  invoice: { visitId: string; paidAt: Date },
): Promise<ReferralAwardCandidate[]> {
  const rows = await tx.$queryRaw<
    { id: string; referred_user_id: string; referrer_user_id: string }[]
  >`
    SELECT r.id, r.referred_user_id, r.referrer_user_id
    FROM referrals r
    JOIN users u ON u.id = r.referred_user_id
    WHERE r.awarded_at IS NULL
      AND r.bound_at <= ${invoice.paidAt}::timestamptz
      AND EXISTS (
        SELECT 1 FROM visit_participants p
        WHERE p.visit_id = ${invoice.visitId}::uuid
          AND (
            p.customer_user_id = r.referred_user_id
            OR (p.phone_canonical IS NOT NULL AND p.phone_canonical = u.phone_canonical)
          )
          AND EXISTS (
            SELECT 1 FROM visit_service_lines l
            WHERE l.visit_id = p.visit_id AND l.participant_id = p.id AND l.status = 'DONE'
          )
      )
    ORDER BY r.id
    FOR UPDATE OF r`;
  const candidates: ReferralAwardCandidate[] = [];
  for (const row of rows) {
    const [first] = await completedVisitsOf(tx, row.referred_user_id, 1);
    if (first?.id === invoice.visitId) {
      candidates.push({
        referralId: row.id,
        referredUserId: row.referred_user_id,
        referrerUserId: row.referrer_user_id,
      });
    }
  }
  return candidates;
}
