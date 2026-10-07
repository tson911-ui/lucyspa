import {
  loyaltyTierFor,
  LOYALTY_TIER_TABLE_VERSION,
  type DiscountIneligibleReason,
  type InvoiceBirthdayGift,
  type InvoiceDiscountCandidate,
  type InvoiceDiscountResponse,
  type InvoiceMemberCandidate,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import {
  birthdayOccurrence,
  evaluateBirthday,
  withBirthday,
  type BirthdayContext,
  type BirthdayEvaluation,
  type BirthdayVersion,
} from './birthday.engine.js';
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

const day = (value: Date) => value.toISOString().slice(0, 10);

function toBirthdayVersion(
  row: Prisma.BirthdayRewardVersionGetPayload<Record<string, never>>,
): BirthdayVersion {
  return {
    id: row.id,
    configId: row.configId,
    versionNo: row.versionNo,
    isActive: row.isActive,
    kind: row.kind,
    percentBp: row.percentBp,
    fixedAmountVnd: row.fixedAmountVnd,
    minSpendVnd: row.minSpendVnd,
    windowDaysBefore: row.windowDaysBefore,
    windowDaysAfter: row.windowDaysAfter,
    combineMember: row.combineMember,
    combinePromotion: row.combinePromotion,
    combineVoucher: row.combineVoucher,
    usageLimitUnlimited: row.usageLimitUnlimited,
    usageLimitPerYear: row.usageLimitPerYear,
  };
}

/**
 * The birthday gift's context for this invoice (P5-6), or null: no payer (a guest gets no gift), loyalty not live (the gift
 * only works once go-live is ON), no configuration or an inactive current version (the module ships empty), the payer has no
 * birthday on file, or the invoice business date (branch timezone) is outside the payer's window. The window is the Owner's
 * (design 8): `birthday - before .. birthday + after`, 29 February = 28 February in a non-leap year (OQ-8).
 *
 * At finalization (`lock`) the single configuration row is taken `FOR UPDATE` right after the program rows and BEFORE the
 * payer's user row and wallet (design 12.2), the current version is re-read under it and the active uses of this payer in the
 * birthday's year are counted, so two finalizations of one payer can never both take the last use. A gift that cannot apply
 * (no window) takes no lock at all.
 */
export async function loadBirthday(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  payerUserId: string | null,
  lock: boolean,
): Promise<BirthdayContext | null> {
  if (payerUserId === null) return null;
  if ((await tx.loyaltyGoLive.count()) === 0) return null;
  const config = await tx.birthdayRewardConfig.findFirst({ select: { id: true } });
  if (!config) return null;
  const profile = await tx.customerProfile.findUnique({
    where: { userId: payerUserId },
    select: { dateOfBirth: true },
  });
  if (!profile) return null;
  const { businessDate } = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { businessDate: true },
  });
  const dateOfBirth = day(profile.dateOfBirth);
  const readVersion = async () => {
    const row = await tx.birthdayRewardVersion.findFirst({
      where: { configId: config.id },
      orderBy: { versionNo: 'desc' },
    });
    return row && row.isActive ? toBirthdayVersion(row) : null;
  };
  const occurrenceOf = (version: BirthdayVersion) =>
    birthdayOccurrence(
      dateOfBirth,
      day(businessDate),
      version.windowDaysBefore,
      version.windowDaysAfter,
    );
  let version = await readVersion();
  if (!version || occurrenceOf(version) === null) return null;
  if (lock) {
    await tx.$queryRaw`SELECT id FROM birthday_reward_configs WHERE id = ${config.id}::uuid FOR UPDATE`;
    version = await readVersion();
    if (!version) return null;
  }
  const birthdayOn = occurrenceOf(version);
  if (birthdayOn === null) return null;
  const rows = await tx.$queryRaw<{ uses: bigint }[]>`
    SELECT count(*) AS uses
    FROM birthday_redemptions r
    WHERE r.config_id = ${config.id}::uuid
      AND r.payer_user_id = ${payerUserId}::uuid
      AND extract(year FROM r.birthday_on) = ${Number(birthdayOn.slice(0, 4))}
      AND NOT EXISTS (SELECT 1 FROM birthday_redemption_releases l WHERE l.redemption_id = r.id)`;
  return { version, birthdayOn, usesInYear: Number(rows[0]?.uses ?? 0n) };
}

export async function evaluateInvoice(
  tx: Prisma.TransactionClient,
  invoice: { id: string; payerUserId: string | null },
  now: Date,
  options: { lockPrograms: boolean },
): Promise<InvoiceEvaluation> {
  const header = await tx.invoice.findUniqueOrThrow({
    where: { id: invoice.id },
    select: { kind: true },
  });
  // Phase 6 P6-8: the engine prices the Spa side (service and combo lines). A PRODUCT line is outside it until the Beauty side exists
  // (P6-9, P6-11): it earns no discount and counts toward no eligible subtotal, whatever the program.
  const lineRows = await tx.invoiceLine.findMany({
    where: { invoiceId: invoice.id, kind: { not: 'PRODUCT' } },
    orderBy: { sequence: 'asc' },
    select: {
      grossVnd: true,
      serviceDetails: { select: { serviceId: true, serviceCategoryId: true } },
      // A combo sale line (Phase 5 P5-7) is priced like a line of the combo's own service: the same service and the
      // service category snapshot taken when the line was created.
      comboDetails: { select: { serviceId: true, serviceCategoryId: true } },
    },
  });
  const lines: EngineLine[] = lineRows.map((line) => {
    const detail = line.serviceDetails[0] ?? line.comboDetails[0];
    if (!detail) throw new Error('Every invoice line has its service or combo detail.');
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
  // Lock order (design 12.2): invoice -> program rows -> the birthday configuration row -> the payer's user row -> wallets.
  // The birthday gift never applies to a combo sale (Owner answer of 2026-10-05) nor to a product-only sale (it is Spa-side only,
  // Q7): nothing is read and no lock is taken for it.
  const birthdayContext =
    header.kind !== 'VISIT'
      ? null
      : await loadBirthday(tx, invoice.id, invoice.payerUserId, options.lockPrograms);
  const member = await loadMember(tx, invoice.payerUserId, options.lockPrograms);
  const ordinary = evaluateDiscounts({
    lines,
    promotions,
    supplied: entries.map((entry) => ({ voucher: entry.voucher, program: entry.program })),
    hasMemberPayer: invoice.payerUserId !== null,
    member,
    now,
  });
  // The birthday gift is a separate layer AFTER the single ordinary winner (design 6.3), only for a member payer.
  const result = withBirthday(
    ordinary,
    member && birthdayContext ? evaluateBirthday(ordinary, birthdayContext) : null,
  );
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

/** The birthday gift as the response and the snapshot show it (the snapshot stores exactly this JSON). */
export function birthdayResponse(evaluation: BirthdayEvaluation): InvoiceBirthdayGift {
  const { version } = evaluation.context;
  return {
    versionNo: version.versionNo,
    kind: version.kind,
    percentBp: version.percentBp,
    fixedAmountVnd: version.fixedAmountVnd === null ? null : version.fixedAmountVnd.toString(),
    minSpendVnd: version.minSpendVnd.toString(),
    birthdayOn: evaluation.context.birthdayOn,
    baseVnd: evaluation.baseVnd.toString(),
    amountVnd: evaluation.amountVnd.toString(),
    applied: evaluation.applied,
    mode: evaluation.mode,
    reason: evaluation.reason,
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
    birthdayResult: Prisma.JsonValue | null;
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
    // The gift layer is stored verbatim at finalization (never recomputed from today's configuration).
    birthday:
      snapshot?.birthdayResult && typeof snapshot.birthdayResult === 'object'
        ? (snapshot.birthdayResult as unknown as InvoiceBirthdayGift)
        : null,
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
    birthday: result.birthday ? birthdayResponse(result.birthday) : null,
    selectionReason: result.selectionReason,
    vouchers: entries,
    appliedAt: null,
  };
}

export type { DiscountIneligibleReason };
