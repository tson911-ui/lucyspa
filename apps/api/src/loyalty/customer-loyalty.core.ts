import {
  CUSTOMER_LOYALTY_PAGE_SIZE,
  type CustomerComboPageResponse,
  type CustomerComboStatus,
  type CustomerComboUsePageResponse,
  type CustomerGiftPageResponse,
  type CustomerLedgerKind,
  type CustomerLedgerPageResponse,
  type CustomerLoyaltySummaryResponse,
  type CustomerPageResponse,
  type CustomerReferralPageResponse,
  type LoyaltyLedgerKindName,
  type LoyaltyWalletName,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { maskName } from '../pos/combo-use.core.js';
import { statusOf, unitsInUse } from '../reward/reward.core.js';
import { pageOf, walletResponse } from './loyalty.core.js';

/**
 * Phase 5 P5-10: the signed-in customer's own membership page (design 15, P5-Q9). Read only: every query is filtered by the
 * session's customer, so there is no id to guess. Another person only ever appears as a masked name; a staff reason, a staff
 * name, a shortfall and the invoice code of someone else's invoice are never selected. While the loyalty go-live switch is OFF
 * (Owner's answer of 2026-10-05, pending confirmation) nothing is returned at all.
 */

const WALLETS: readonly LoyaltyWalletName[] = ['SPA', 'BEAUTY'];

/** Simple wording for the customer (OQ-11, pending Owner confirmation): a manual change is always "adjusted by Lucy Spa". */
export function customerKindOf(kind: LoyaltyLedgerKindName): CustomerLedgerKind {
  switch (kind) {
    case 'EARN':
      return 'EARNED';
    case 'EARN_REVERSAL':
    case 'REFUND_REVERSAL':
      return 'TAKEN_BACK';
    case 'REFERRAL_AWARD':
      return 'REFERRAL';
    case 'MANUAL_ADJUSTMENT':
    case 'MANUAL_CORRECTION':
      return 'ADJUSTED';
  }
}

/**
 * The state of a combo for its owner. `paused` is the database's own usability rule being false (sale reversed after sessions
 * were used); a combo that is used up reads "used up" first, then an expired one.
 */
export function customerComboStatus(facts: {
  usable: boolean;
  freeSessions: number;
  expiresAt: Date | null;
  now: Date;
}): CustomerComboStatus {
  if (!facts.usable) return 'PAUSED';
  if (facts.freeSessions === 0) return 'USED_UP';
  if (facts.expiresAt !== null && facts.expiresAt.getTime() <= facts.now.getTime()) {
    return 'EXPIRED';
  }
  return 'ACTIVE';
}

async function isLive(tx: Prisma.TransactionClient): Promise<boolean> {
  return (await tx.loyaltyGoLive.findFirst({ select: { id: true } })) !== null;
}

function empty<T>(page: number): CustomerPageResponse<T> {
  return { live: false, items: [], page, pageSize: CUSTOMER_LOYALTY_PAGE_SIZE, total: 0 };
}

function window(page: number) {
  return { skip: (page - 1) * CUSTOMER_LOYALTY_PAGE_SIZE, take: CUSTOMER_LOYALTY_PAGE_SIZE };
}

export async function customerSummary(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<CustomerLoyaltySummaryResponse> {
  if (!(await isLive(tx))) return { live: false, wallets: [] };
  const accounts = await tx.loyaltyWalletAccount.findMany({
    where: { userId },
    select: { wallet: true, balancePoints: true },
  });
  return {
    live: true,
    wallets: WALLETS.map((wallet) =>
      walletResponse(wallet, accounts.find((a) => a.wallet === wallet)?.balancePoints ?? 0),
    ),
  };
}

export async function customerHistory(
  tx: Prisma.TransactionClient,
  userId: string,
  rawPage: string | undefined,
): Promise<CustomerLedgerPageResponse> {
  const page = pageOf(rawPage);
  if (!(await isLive(tx))) return empty(page);
  const [total, rows] = await Promise.all([
    tx.loyaltyLedgerEntry.count({ where: { userId } }),
    tx.loyaltyLedgerEntry.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...window(page),
      select: {
        id: true,
        wallet: true,
        kind: true,
        points: true,
        createdAt: true,
      },
    }),
  ]);
  return {
    live: true,
    page,
    pageSize: CUSTOMER_LOYALTY_PAGE_SIZE,
    total,
    items: rows.map((row) => ({
      id: row.id,
      wallet: row.wallet,
      kind: customerKindOf(row.kind),
      points: row.points,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

export async function customerCombos(
  tx: Prisma.TransactionClient,
  userId: string,
  rawPage: string | undefined,
  now: Date,
): Promise<CustomerComboPageResponse> {
  const page = pageOf(rawPage);
  if (!(await isLive(tx))) return empty(page);
  // A combo revoked before any use (voided_at) is not shown: its money went back with the reversal.
  const where = { ownerUserId: userId, voidedAt: null } satisfies Prisma.ComboPurchaseWhereInput;
  const [total, rows] = await Promise.all([
    tx.comboPurchase.count({ where }),
    tx.comboPurchase.findMany({
      where,
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
      ...window(page),
      select: {
        id: true,
        nameVi: true,
        nameEn: true,
        paidSessions: true,
        bonusSessions: true,
        issuedAt: true,
        expiresAt: true,
        service: { select: { nameVi: true, nameEn: true } },
        sessions: {
          select: {
            kind: true,
            consumptions: {
              select: { release: { select: { id: true } }, restoration: { select: { id: true } } },
            },
          },
        },
      },
    }),
  ]);
  // The database's own rule (sale invoice PAID in a usable episode), not a copy of it.
  const usable = new Map<string, boolean>();
  if (rows.length > 0) {
    const flags = await tx.$queryRaw<{ id: string; usable: boolean }[]>`
      SELECT p.id, lucy_combo_purchase_usable(p.id) AS usable
      FROM combo_purchases p WHERE p.id = ANY(${rows.map((row) => row.id)}::uuid[])`;
    for (const flag of flags) usable.set(flag.id, flag.usable === true);
  }
  return {
    live: true,
    page,
    pageSize: CUSTOMER_LOYALTY_PAGE_SIZE,
    total,
    items: rows.map((row) => {
      const free = row.sessions.filter(
        (session) =>
          !session.consumptions.some((use) => use.release === null && use.restoration === null),
      );
      return {
        id: row.id,
        nameVi: row.nameVi,
        nameEn: row.nameEn,
        serviceNameVi: row.service.nameVi,
        serviceNameEn: row.service.nameEn,
        status: customerComboStatus({
          usable: usable.get(row.id) === true,
          freeSessions: free.length,
          expiresAt: row.expiresAt,
          now,
        }),
        paidSessions: row.paidSessions,
        bonusSessions: row.bonusSessions,
        paidLeft: free.filter((session) => session.kind === 'PAID').length,
        bonusLeft: free.filter((session) => session.kind === 'BONUS').length,
        issuedAt: row.issuedAt.toISOString(),
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      };
    }),
  };
}

export async function customerComboUses(
  tx: Prisma.TransactionClient,
  userId: string,
  rawPage: string | undefined,
): Promise<CustomerComboUsePageResponse> {
  const page = pageOf(rawPage);
  if (!(await isLive(tx))) return empty(page);
  // Real uses only: a use released (use invoice cancelled) or restored (mistaken) gave the session back.
  const where = {
    session: { purchase: { ownerUserId: userId } },
    release: null,
    restoration: null,
  } satisfies Prisma.ComboSessionConsumptionWhereInput;
  const [total, rows] = await Promise.all([
    tx.comboSessionConsumption.count({ where }),
    tx.comboSessionConsumption.findMany({
      where,
      orderBy: [{ consumedAt: 'desc' }, { id: 'desc' }],
      ...window(page),
      select: {
        id: true,
        consumedAt: true,
        usedBy: true,
        branch: { select: { name: true } },
        // Only the recipient's name, to be masked below; no phone, note, technician, invoice or staff name is selected.
        recipientParticipant: {
          select: { displayName: true, customer: { select: { fullName: true } } },
        },
        session: {
          select: {
            kind: true,
            purchase: {
              select: {
                nameVi: true,
                nameEn: true,
                service: { select: { nameVi: true, nameEn: true } },
              },
            },
          },
        },
      },
    }),
  ]);
  return {
    live: true,
    page,
    pageSize: CUSTOMER_LOYALTY_PAGE_SIZE,
    total,
    items: rows.map((row) => {
      const name =
        row.recipientParticipant?.customer?.fullName ?? row.recipientParticipant?.displayName;
      return {
        id: row.id,
        usedAt: row.consumedAt.toISOString(),
        comboNameVi: row.session.purchase.nameVi,
        comboNameEn: row.session.purchase.nameEn,
        serviceNameVi: row.session.purchase.service.nameVi,
        serviceNameEn: row.session.purchase.service.nameEn,
        sessionKind: row.session.kind,
        usedBy: row.usedBy,
        recipientMasked: row.usedBy === 'RELATIVE' && name ? maskName(name) : null,
        branchName: row.branch.name,
      };
    }),
  };
}

export async function customerReferrals(
  tx: Prisma.TransactionClient,
  userId: string,
  rawPage: string | undefined,
): Promise<CustomerReferralPageResponse> {
  const page = pageOf(rawPage);
  if (!(await isLive(tx))) return empty(page);
  const where = { referrerUserId: userId } satisfies Prisma.ReferralWhereInput;
  const [total, rows] = await Promise.all([
    tx.referral.count({ where }),
    tx.referral.findMany({
      where,
      orderBy: [{ boundAt: 'desc' }, { id: 'desc' }],
      ...window(page),
      select: {
        id: true,
        boundAt: true,
        awardedAt: true,
        // The name only to mask it; the phone, email and the invoice are never selected.
        referred: { select: { fullName: true } },
      },
    }),
  ]);
  return {
    live: true,
    page,
    pageSize: CUSTOMER_LOYALTY_PAGE_SIZE,
    total,
    items: rows.map((row) => ({
      id: row.id,
      referredMasked: maskName(row.referred.fullName),
      boundAt: row.boundAt.toISOString(),
      status: row.awardedAt ? ('REWARDED' as const) : ('WAITING' as const),
      rewardedAt: row.awardedAt ? row.awardedAt.toISOString() : null,
    })),
  };
}

export async function customerGifts(
  tx: Prisma.TransactionClient,
  userId: string,
  rawPage: string | undefined,
  now: Date,
): Promise<CustomerGiftPageResponse> {
  const page = pageOf(rawPage);
  if (!(await isLive(tx))) return empty(page);
  const where = { ownerUserId: userId } satisfies Prisma.RewardEntitlementWhereInput;
  const [total, rows] = await Promise.all([
    tx.rewardEntitlement.count({ where }),
    tx.rewardEntitlement.findMany({
      where,
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
      ...window(page),
      select: {
        id: true,
        quantityIssued: true,
        issuedAt: true,
        expiresAt: true,
        voidedAt: true,
        // The grant reason, the staff names and the revoke reason are internal and are not selected.
        catalogItem: {
          select: {
            kind: true,
            nameVi: true,
            nameEn: true,
            service: { select: { nameVi: true, nameEn: true } },
          },
        },
        manualUses: { select: { restoration: { select: { id: true } } } },
        redemptions: { select: { release: { select: { id: true } } } },
      },
    }),
  ]);
  return {
    live: true,
    page,
    pageSize: CUSTOMER_LOYALTY_PAGE_SIZE,
    total,
    items: rows.map((row) => ({
      id: row.id,
      kind: row.catalogItem.kind,
      nameVi: row.catalogItem.nameVi,
      nameEn: row.catalogItem.nameEn,
      serviceNameVi: row.catalogItem.service?.nameVi ?? null,
      serviceNameEn: row.catalogItem.service?.nameEn ?? null,
      status: statusOf(row, now),
      quantityIssued: row.quantityIssued,
      quantityLeft: row.quantityIssued - unitsInUse(row),
      issuedAt: row.issuedAt.toISOString(),
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    })),
  };
}
