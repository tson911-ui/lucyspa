import {
  loyaltyTierFor,
  LOYALTY_TIER_TABLE_VERSION,
  type DiscountIneligibleReason,
  type InvoiceDiscountCandidate,
  type InvoiceDiscountResponse,
  type InvoiceMemberCandidate,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import {
  evaluateDiscounts,
  type EngineCandidate,
  type EngineLine,
  type EngineMember,
  type EngineProgram,
  type EngineResult,
  type EngineVersion,
  type EngineVoucher,
  type MemberCandidate,
} from './discount.engine.js';

/**
 * Phase 4 Step 6: loads the stored inputs of one invoice and runs the pure engine. Used for the live DRAFT
 * evaluation (totals shown to staff and stored in the header) and for the final evaluation at finalization,
 * where `lockPrograms` takes every candidate program's row `FOR UPDATE` sorted by id BEFORE counting usage
 * (design 14: invoice -> discount programs sorted by id), so two finalizations can never both consume the
 * last usage. The Step 4 redemption guard re-checks the limits under the same lock.
 */

const versionSelect = {
  orderBy: { versionNo: 'desc' },
  take: 1,
  select: {
    id: true,
    versionNo: true,
    kind: true,
    percentBp: true,
    fixedAmountVnd: true,
    validFrom: true,
    validUntil: true,
    minSpendVnd: true,
    scopeMode: true,
    usageLimitTotal: true,
    usageLimitPerCustomer: true,
    services: { select: { serviceId: true } },
    categories: { select: { categoryId: true } },
  },
} satisfies Prisma.Discount$versionsArgs;

const programSelect = {
  id: true,
  code: true,
  nameVi: true,
  nameEn: true,
  requiresCode: true,
  isActive: true,
  terminatedAt: true,
  versions: versionSelect,
} satisfies Prisma.DiscountSelect;

type ProgramRow = Prisma.DiscountGetPayload<{ select: typeof programSelect }>;

export interface SuppliedEntry {
  id: string;
  suppliedAt: Date;
  voucher: EngineVoucher;
  program: EngineProgram;
}

export interface InvoiceEvaluation {
  result: EngineResult;
  entries: SuppliedEntry[];
}

function toVersion(row: ProgramRow['versions'][number]): EngineVersion {
  return {
    id: row.id,
    versionNo: row.versionNo,
    kind: row.kind,
    percentBp: row.percentBp,
    fixedAmountVnd: row.fixedAmountVnd,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    minSpendVnd: row.minSpendVnd,
    scopeMode: row.scopeMode,
    serviceIds: new Set(row.services.map((scope) => scope.serviceId)),
    categoryIds: new Set(row.categories.map((scope) => scope.categoryId)),
    usageLimitTotal: row.usageLimitTotal,
    usageLimitPerCustomer: row.usageLimitPerCustomer,
  };
}

/** Active (unreleased) redemptions per program, and those of one payer. */
export async function usageCounts(
  tx: Prisma.TransactionClient,
  programIds: readonly string[],
  payerUserId: string | null,
): Promise<Map<string, { total: number; payer: number }>> {
  const counts = new Map<string, { total: number; payer: number }>();
  if (programIds.length === 0) return counts;
  const rows = await tx.$queryRaw<{ discount_id: string; total: bigint; payer: bigint }[]>`
    SELECT r.discount_id,
           count(*) AS total,
           count(*) FILTER (WHERE r.payer_user_id = ${payerUserId}::uuid) AS payer
    FROM discount_redemptions r
    LEFT JOIN discount_redemption_releases l ON l.redemption_id = r.id
    WHERE l.id IS NULL AND r.discount_id = ANY(${[...programIds]}::uuid[])
    GROUP BY r.discount_id`;
  for (const row of rows) {
    counts.set(row.discount_id, { total: Number(row.total), payer: Number(row.payer) });
  }
  return counts;
}

/**
 * The payer's Spa tier from the balance BEFORE this invoice (P5-T3/T4), or null for a guest payer or while loyalty is not
 * live (then the result is exactly the version 1 result). At finalization (`lock`) the wallet row is read `FOR SHARE`, after
 * the invoice and the program rows (lock order, design 12.2), so a concurrent earn cannot move the balance under the read;
 * a DRAFT only previews the current balance. A customer with no wallet yet has 0 points and no tier.
 */
export async function loadMember(
  tx: Prisma.TransactionClient,
  payerUserId: string | null,
  lock: boolean,
): Promise<EngineMember | null> {
  if (payerUserId === null) return null;
  if ((await tx.loyaltyGoLive.count()) === 0) return null;
  if (lock) {
    // Lock order (design 12.2): the payer's user row comes BEFORE the wallet. The tier snapshot inserted next takes
    // this row's key-share lock through its foreign key anyway; taking it first keeps a concurrent manual adjustment
    // (which holds the customer row, then wants the wallet) from deadlocking with this finalization.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${payerUserId}::uuid FOR KEY SHARE`;
  }
  const rows = lock
    ? await tx.$queryRaw<{ balance_points: number }[]>`
        SELECT balance_points FROM loyalty_wallets
        WHERE user_id = ${payerUserId}::uuid AND wallet = 'SPA'::"LoyaltyWallet" FOR SHARE`
    : await tx.$queryRaw<{ balance_points: number }[]>`
        SELECT balance_points FROM loyalty_wallets
        WHERE user_id = ${payerUserId}::uuid AND wallet = 'SPA'::"LoyaltyWallet"`;
  const balanceBefore = rows[0]?.balance_points ?? 0;
  const standing = loyaltyTierFor(balanceBefore);
  return {
    tier: standing.tier,
    tierTableVersion: LOYALTY_TIER_TABLE_VERSION,
    balanceBefore,
    discountBp: standing.memberDiscountBp,
  };
}

export async function evaluateInvoice(
  tx: Prisma.TransactionClient,
  invoice: { id: string; payerUserId: string | null },
  now: Date,
  options: { lockPrograms: boolean },
): Promise<InvoiceEvaluation> {
  const lineRows = await tx.invoiceLine.findMany({
    where: { invoiceId: invoice.id },
    orderBy: { sequence: 'asc' },
    select: {
      grossVnd: true,
      serviceDetails: { select: { serviceId: true, serviceCategoryId: true } },
    },
  });
  const lines: EngineLine[] = lineRows.map((line) => {
    const detail = line.serviceDetails[0];
    if (!detail) throw new Error('Every invoice line has its service detail.');
    return {
      serviceId: detail.serviceId,
      // The category the service had when the transaction was established (snapshot, never the live catalog).
      categoryId: detail.serviceCategoryId,
      grossVnd: line.grossVnd,
    };
  });

  const entryRows = await tx.invoiceVoucherEntry.findMany({
    where: { invoiceId: invoice.id, removedAt: null },
    orderBy: [{ suppliedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      suppliedAt: true,
      voucher: {
        select: { id: true, code: true, isActive: true, discountId: true },
      },
    },
  });
  const promotionIds = (
    await tx.discount.findMany({
      where: { requiresCode: false, isActive: true, terminatedAt: null },
      select: { id: true },
    })
  ).map((row) => row.id);
  const programIds = [
    ...new Set([...promotionIds, ...entryRows.map((entry) => entry.voucher.discountId)]),
  ].sort();
  if (options.lockPrograms && programIds.length > 0) {
    await tx.$queryRaw`SELECT id FROM discounts WHERE id = ANY(${programIds}::uuid[]) ORDER BY id FOR UPDATE`;
  }
  const rows = await tx.discount.findMany({
    where: { id: { in: programIds } },
    select: programSelect,
  });
  const counts = await usageCounts(tx, programIds, invoice.payerUserId);
  const programs = new Map<string, EngineProgram>();
  for (const row of rows) {
    const version = row.versions[0];
    if (!version) continue;
    const used = counts.get(row.id) ?? { total: 0, payer: 0 };
    programs.set(row.id, {
      id: row.id,
      code: row.code,
      nameVi: row.nameVi,
      nameEn: row.nameEn,
      requiresCode: row.requiresCode,
      isActive: row.isActive,
      terminated: row.terminatedAt !== null,
      version: toVersion(version),
      activeRedemptions: used.total,
      payerRedemptions: used.payer,
    });
  }
  const entries: SuppliedEntry[] = [];
  for (const entry of entryRows) {
    const program = programs.get(entry.voucher.discountId);
    if (!program) continue;
    entries.push({
      id: entry.id,
      suppliedAt: entry.suppliedAt,
      voucher: {
        id: entry.voucher.id,
        code: entry.voucher.code,
        isActive: entry.voucher.isActive,
        programId: entry.voucher.discountId,
      },
      program,
    });
  }
  // Expired promotions are not candidates (they only clutter the list); scheduled ones are shown as such.
  const promotions = promotionIds
    .map((id) => programs.get(id))
    .filter((program): program is EngineProgram => program !== undefined)
    .filter((program) => now < program.version.validUntil);
  const member = await loadMember(tx, invoice.payerUserId, options.lockPrograms);
  const result = evaluateDiscounts({
    lines,
    promotions,
    supplied: entries.map((entry) => ({ voucher: entry.voucher, program: entry.program })),
    hasMemberPayer: invoice.payerUserId !== null,
    member,
    now,
  });
  return { result, entries };
}

export function candidateResponse(
  candidate: EngineCandidate,
  winner: EngineCandidate | null,
): InvoiceDiscountCandidate {
  const { program, voucher } = candidate;
  return {
    source: candidate.source,
    discountId: program.id,
    discountCode: program.code,
    nameVi: program.nameVi,
    nameEn: program.nameEn,
    versionId: program.version.id,
    versionNo: program.version.versionNo,
    voucherId: voucher?.id ?? null,
    voucherCode: voucher?.code ?? null,
    kind: program.version.kind,
    percentBp: program.version.percentBp,
    fixedAmountVnd:
      program.version.fixedAmountVnd === null ? null : program.version.fixedAmountVnd.toString(),
    eligibleSubtotalVnd: candidate.eligibleSubtotalVnd.toString(),
    eligible: candidate.eligible,
    reason: candidate.reason,
    amountVnd: candidate.amountVnd.toString(),
    winner: candidate === winner,
  };
}

/** The candidates as stored on the application (and audited): every evaluated candidate, verbatim. */
export function candidatesJson(result: EngineResult): Prisma.InputJsonArray {
  return result.candidates.map((candidate) => ({
    ...candidateResponse(candidate, result.winner),
  })) as unknown as Prisma.InputJsonArray;
}

/** The Member Discount candidate as the response and the snapshot show it. */
export function memberResponse(
  candidate: MemberCandidate,
  winner: boolean,
): InvoiceMemberCandidate {
  return {
    tier: candidate.member.tier,
    tierTableVersion: candidate.member.tierTableVersion,
    balanceBefore: candidate.member.balanceBefore,
    discountBp: candidate.member.discountBp,
    eligibleSubtotalVnd: candidate.eligibleSubtotalVnd.toString(),
    amountVnd: candidate.amountVnd.toString(),
    eligible: candidate.eligible,
    reason: candidate.reason,
    winner,
  };
}

/** The tier snapshot's candidates JSON: the Member candidate and every program candidate evaluated (design 5.3). */
export function snapshotCandidatesJson(result: EngineResult): Prisma.InputJsonObject {
  return {
    member: result.member
      ? (memberResponse(
          result.member,
          result.winnerSource === 'MEMBER_TIER',
        ) as unknown as Prisma.InputJsonObject)
      : null,
    programs: candidatesJson(result),
  };
}

/**
 * A finalized invoice's benefit as the response shows it: the frozen program application (candidates come back from its
 * stored JSON) and/or the frozen tier snapshot. The member part and the overall reason come from the snapshot, so a
 * finalized invoice is never recomputed from today's balance or programs.
 */
export function storedDiscount(
  application: {
    voucherId: string | null;
    discountId: string;
    candidates: Prisma.JsonValue;
    selectionReason: string;
    appliedAt: Date;
  } | null,
  snapshot: {
    candidates: Prisma.JsonValue;
    winnerSource: string | null;
    selectionReason: string | null;
    createdAt: Date;
  } | null,
  entries: InvoiceDiscountResponse['vouchers'],
): InvoiceDiscountResponse {
  const stored =
    snapshot && typeof snapshot.candidates === 'object' && snapshot.candidates !== null
      ? (snapshot.candidates as unknown as {
          member?: InvoiceMemberCandidate | null;
          programs?: InvoiceDiscountCandidate[];
        })
      : null;
  // No program application when the Member Discount won: the candidates evaluated are in the tier snapshot.
  const candidates = (Array.isArray(application?.candidates)
    ? application.candidates
    : Array.isArray(stored?.programs)
      ? stored.programs
      : []) as unknown as InvoiceDiscountCandidate[];
  const winnerSource = (snapshot?.winnerSource ??
    (application ? (application.voucherId ? 'VOUCHER' : 'PROMOTION') : null)) as
    InvoiceDiscountResponse['winnerSource'] | null;
  return {
    preview: false,
    candidates,
    winner: candidates.find((candidate) => candidate.winner) ?? null,
    winnerSource,
    member: stored?.member ?? null,
    selectionReason: snapshot?.selectionReason ?? application?.selectionReason ?? null,
    vouchers: entries,
    appliedAt: (application?.appliedAt ?? snapshot?.createdAt ?? null)?.toISOString() ?? null,
  };
}

export function previewDiscount(
  evaluation: InvoiceEvaluation,
  entries: InvoiceDiscountResponse['vouchers'],
): InvoiceDiscountResponse {
  const { result } = evaluation;
  return {
    preview: true,
    candidates: result.candidates.map((candidate) => candidateResponse(candidate, result.winner)),
    winner: result.winner ? candidateResponse(result.winner, result.winner) : null,
    winnerSource: result.winnerSource,
    member: result.member
      ? memberResponse(result.member, result.winnerSource === 'MEMBER_TIER')
      : null,
    selectionReason: result.selectionReason,
    vouchers: entries,
    appliedAt: null,
  };
}

export type { DiscountIneligibleReason };
