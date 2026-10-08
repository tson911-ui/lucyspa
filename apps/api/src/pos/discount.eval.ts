import {
  loyaltyTierFor,
  LOYALTY_TIER_TABLE_VERSION,
  type DiscountIneligibleReason,
  type InvoiceBirthdayGift,
  type InvoiceDiscountCandidate,
  type InvoiceDiscountResponse,
  type InvoiceMemberCandidate,
  type InvoiceSideDiscount,
  type PricingSideName,
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
import { applyExchangeCredit } from './exchange-credit.js';
import {
  evaluatePricingV3,
  type PricingV3Input,
  type PricingV3Result,
  type V3Line,
} from './pricing.v3.js';

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
    scope: true,
    usageLimitTotal: true,
    usageLimitPerCustomer: true,
    services: { select: { serviceId: true } },
    categories: { select: { categoryId: true } },
    brands: { select: { brandId: true } },
    productCategories: { select: { categoryId: true } },
    products: { select: { productId: true } },
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
  /**
   * The version 2 result: the source of truth of an invoice with NO product line (OQ-59). For an invoice with product lines it is the
   * Spa side of the version 3 result (an empty result when the invoice has no Spa side), kept so Spa-shaped readers still work.
   */
  result: EngineResult;
  entries: SuppliedEntry[];
  /** The inputs every engine is given: the version 3 engine and the shadow comparison run on exactly these, loaded once. */
  pricing: PricingV3Input;
  /** The version 3 result; present exactly when the invoice has a product line (then it IS the result, version 3). */
  v3: PricingV3Result | null;
  /** Phase 6 P6-14: set only for the invoice of an exchange (priced with its exchange credit and nothing else). */
  exchange?: ExchangeCredit | null;
}

/** The exchange credit of the invoice of an exchange (P6-14): what the customer paid for the returned units, and the OQ-82 rule. */
export interface ExchangeCredit {
  creditVnd: bigint;
  sameItem: boolean;
}

/**
 * Phase 6 P6-10 (OQ-66, changed by the Owner on 2026-10-08): a product category target also covers every subcategory below it, to
 * any depth. The pure engine keeps matching a line's snapshotted category against a set of ids; the loader widens that set with the
 * descendants of each target, read from the category tree in force at this evaluation (the tree of the moment of finalization is
 * the one that applies; a stored invoice is never matched again). `UNION` (not `UNION ALL`) cannot loop on a cycle.
 */
export async function categoryDescendants(
  tx: Prisma.TransactionClient,
  categoryIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  if (categoryIds.length === 0) return result;
  const rows = await tx.$queryRaw<{ root_id: string; id: string }[]>`
    WITH RECURSIVE tree(root_id, id) AS (
      SELECT c.id, c.id FROM product_categories c WHERE c.id = ANY(${[...categoryIds]}::uuid[])
      UNION
      SELECT tree.root_id, child.id FROM tree JOIN product_categories child ON child.parent_id = tree.id
    )
    SELECT root_id, id FROM tree`;
  for (const row of rows) {
    const set = result.get(row.root_id) ?? new Set<string>();
    set.add(row.id);
    result.set(row.root_id, set);
  }
  return result;
}

function toVersion(
  row: ProgramRow['versions'][number],
  descendants: ReadonlyMap<string, ReadonlySet<string>>,
): EngineVersion {
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
    scope: row.scope,
    brandIds: new Set(row.brands.map((target) => target.brandId)),
    productCategoryIds: new Set(
      row.productCategories.flatMap((target) => [
        target.categoryId,
        ...(descendants.get(target.categoryId) ?? []),
      ]),
    ),
    productIds: new Set(row.products.map((target) => target.productId)),
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
  wallet: PricingSideName = 'SPA',
): Promise<EngineMember | null> {
  if (payerUserId === null) return null;
  if ((await tx.loyaltyGoLive.count()) === 0) return null;
  if (lock) {
    // Lock order (design 12.2): the payer's user row comes BEFORE the wallet. The tier snapshot inserted next takes
    // this row's key-share lock through its foreign key anyway; taking it first keeps a concurrent manual adjustment
    // (which holds the customer row, then wants the wallet) from deadlocking with this finalization.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${payerUserId}::uuid FOR KEY SHARE`;
  }
  // Phase 6 P6-9 (T4): the Beauty wallet is read the same way, AFTER the Spa wallet (wallets sorted by (user, wallet)).
  const rows = lock
    ? await tx.$queryRaw<{ balance_points: number }[]>`
        SELECT balance_points FROM loyalty_wallets
        WHERE user_id = ${payerUserId}::uuid AND wallet = ${wallet}::"LoyaltyWallet" FOR SHARE`
    : await tx.$queryRaw<{ balance_points: number }[]>`
        SELECT balance_points FROM loyalty_wallets
        WHERE user_id = ${payerUserId}::uuid AND wallet = ${wallet}::"LoyaltyWallet"`;
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
  options: { lockPrograms: boolean; exchange?: ExchangeCredit },
): Promise<InvoiceEvaluation> {
  const header = await tx.invoice.findUniqueOrThrow({
    where: { id: invoice.id },
    select: { kind: true },
  });
  // Phase 6 P6-9: an invoice with a PRODUCT line is priced by the version 3 engine, per side (SPA = service and combo lines, BEAUTY =
  // product lines). An invoice without one is priced by the version 2 engine below (OQ-59), and version 3 only runs beside it.
  const lineRows = await tx.invoiceLine.findMany({
    where: { invoiceId: invoice.id },
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      sequence: true,
      kind: true,
      grossVnd: true,
      serviceDetails: { select: { serviceId: true, serviceCategoryId: true } },
      // A combo sale line (Phase 5 P5-7) is priced like a line of the combo's own service: the same service and the
      // service category snapshot taken when the line was created.
      comboDetails: { select: { serviceId: true, serviceCategoryId: true } },
      // A product line's historical brand and category snapshots (never the live catalog).
      productDetails: { select: { productId: true, brandId: true, categoryId: true } },
    },
  });
  const spaRows = lineRows.filter((line) => line.kind !== 'PRODUCT');
  const hasProducts = lineRows.length > spaRows.length;
  const lines: EngineLine[] = spaRows.map((line) => {
    const detail = line.serviceDetails[0] ?? line.comboDetails[0];
    if (!detail) throw new Error('Every invoice line has its service or combo detail.');
    return {
      serviceId: detail.serviceId,
      // The category the service had when the transaction was established (snapshot, never the live catalog).
      categoryId: detail.serviceCategoryId,
      grossVnd: line.grossVnd,
    };
  });
  const v3Lines: V3Line[] = lineRows.map((line) => {
    if (line.kind === 'PRODUCT') {
      const product = line.productDetails[0];
      if (!product) throw new Error('Every product line has its product detail.');
      return {
        lineId: line.id,
        sequence: line.sequence,
        side: 'BEAUTY',
        grossVnd: line.grossVnd,
        serviceId: null,
        serviceCategoryId: null,
        productId: product.productId,
        brandId: product.brandId,
        productCategoryId: product.categoryId,
      };
    }
    const detail = line.serviceDetails[0] ?? line.comboDetails[0];
    if (!detail) throw new Error('Every invoice line has its service or combo detail.');
    return {
      lineId: line.id,
      sequence: line.sequence,
      side: 'SPA',
      grossVnd: line.grossVnd,
      serviceId: detail.serviceId,
      serviceCategoryId: detail.serviceCategoryId,
      productId: null,
      brandId: null,
      productCategoryId: null,
    };
  });

  // Phase 6 P6-14: the invoice of an exchange has product lines only and ONE benefit, the exchange credit. No program, voucher, member
  // discount or gift is read or locked for it (the customer's own discount is already inside the credit).
  if (options.exchange) {
    if (spaRows.length > 0 || !hasProducts) {
      throw new Error('The invoice of an exchange has product lines only.');
    }
    const exchangePricing: PricingV3Input = {
      lines: v3Lines,
      promotions: [],
      supplied: [],
      hasMemberPayer: false,
      members: {},
      birthday: null,
      now,
    };
    return {
      result: emptyResult(),
      entries: [],
      pricing: exchangePricing,
      v3: applyExchangeCredit(evaluatePricingV3(exchangePricing), options.exchange),
      exchange: options.exchange,
    };
  }

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
  const descendants = await categoryDescendants(
    tx,
    rows.flatMap((row) =>
      row.versions.flatMap((version) =>
        version.productCategories.map((target) => target.categoryId),
      ),
    ),
  );
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
      version: toVersion(version, descendants),
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
  // A product-only invoice has no Spa side, so no Spa wallet, no birthday gift and no lock for either is taken (P6-9, Q7).
  const hasSpaSide = spaRows.length > 0 || !hasProducts;
  const birthdayContext =
    header.kind !== 'VISIT' || !hasSpaSide
      ? null
      : await loadBirthday(tx, invoice.id, invoice.payerUserId, options.lockPrograms);
  const member = hasSpaSide
    ? await loadMember(tx, invoice.payerUserId, options.lockPrograms, 'SPA')
    : null;
  // The Beauty wallet is read only when a Beauty side exists, AFTER the Spa wallet (lock order, design 10.2); nothing is read or
  // locked for it on a service-only invoice, so the shadow run adds no query and no lock there.
  const beautyMember = hasProducts
    ? await loadMember(tx, invoice.payerUserId, options.lockPrograms, 'BEAUTY')
    : null;
  const pricing: PricingV3Input = {
    lines: v3Lines,
    promotions,
    supplied: entries.map((entry) => ({ voucher: entry.voucher, program: entry.program })),
    hasMemberPayer: invoice.payerUserId !== null,
    members: { SPA: member, BEAUTY: beautyMember },
    birthday: birthdayContext,
    now,
  };
  if (hasProducts) {
    const v3 = evaluatePricingV3(pricing);
    return { result: v3.sides.SPA ?? emptyResult(), entries, pricing, v3 };
  }
  const ordinary = evaluateDiscounts({
    lines,
    promotions,
    supplied: pricing.supplied,
    hasMemberPayer: pricing.hasMemberPayer,
    member,
    now,
  });
  // The birthday gift is a separate layer AFTER the single ordinary winner (design 6.3), only for a member payer.
  const result = withBirthday(
    ordinary,
    member && birthdayContext ? evaluateBirthday(ordinary, birthdayContext) : null,
  );
  return { result, entries, pricing, v3: null };
}

/** The Spa-shaped result of an invoice that has no Spa side (a product-only sale). */
function emptyResult(): EngineResult {
  return {
    subtotalVnd: 0n,
    candidates: [],
    winner: null,
    member: null,
    winnerSource: null,
    birthday: null,
    discountTotalVnd: 0n,
    totalVnd: 0n,
    selectionReason: null,
  };
}

/**
 * Re-prices the version 3 inputs with the product prices frozen at finalization (the line rows still hold the draft prices when the
 * inputs were loaded: finalization re-resolves them AFTER the programs and wallets are locked, design 10.2) and evaluates again.
 */
export function evaluateFrozen(
  evaluation: InvoiceEvaluation,
  frozen: ReadonlyMap<string, { quantity: number; unitPriceVnd: bigint }>,
): PricingV3Result {
  const priced = evaluatePricingV3({
    ...evaluation.pricing,
    lines: evaluation.pricing.lines.map((line) => {
      const price = frozen.get(line.lineId);
      return price ? { ...line, grossVnd: BigInt(price.quantity) * price.unitPriceVnd } : line;
    }),
  });
  return evaluation.exchange ? applyExchangeCredit(priced, evaluation.exchange) : priced;
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
    // Only a shared (BOTH) program of a version 3 invoice carries it; every other candidate is exactly the Phase 4/5 shape.
    ...(candidate.shared
      ? {
          shared: {
            eligibleSubtotalVnd: candidate.shared.eligibleSubtotalVnd.toString(),
            amountVnd: candidate.shared.amountVnd.toString(),
          },
        }
      : {}),
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

/** One side of a version 3 result as the response shows it (a draft preview and the frozen snapshot use the same shape). */
export function sideResponse(side: PricingSideName, result: EngineResult): InvoiceSideDiscount {
  return {
    side,
    subtotalVnd: result.subtotalVnd.toString(),
    discountVnd: result.discountTotalVnd.toString(),
    netVnd: result.totalVnd.toString(),
    candidates: result.candidates.map((candidate) => candidateResponse(candidate, result.winner)),
    winner: result.winner ? candidateResponse(result.winner, result.winner) : null,
    winnerSource: result.winnerSource,
    member: result.member
      ? memberResponse(result.member, result.winnerSource === 'MEMBER_TIER')
      : null,
    birthday: result.birthday ? birthdayResponse(result.birthday) : null,
    selectionReason: result.selectionReason,
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
    ...(evaluation.v3
      ? {
          sides: (['SPA', 'BEAUTY'] as const).flatMap((side) => {
            const sideResult = evaluation.v3?.sides[side];
            return sideResult ? [sideResponse(side, sideResult)] : [];
          }),
        }
      : {}),
  };
}

/**
 * A FINALIZED version 3 invoice's sides as the stored rows show them: the Spa side from the Phase 4/5 application and tier snapshot,
 * the Beauty side from the Beauty rows, the amounts from the immutable line allocations. Never recomputed from today's data.
 */
export function storedSides(input: {
  spa: ReturnType<typeof storedDiscount>;
  beauty: {
    application: {
      voucherId: string | null;
      candidates: Prisma.JsonValue;
      selectionReason: string;
    } | null;
    snapshot: {
      candidates: Prisma.JsonValue;
      winnerSource: string | null;
      selectionReason: string | null;
    } | null;
  };
  allocations: readonly {
    side: PricingSideName;
    grossVnd: bigint;
    discountShareVnd: bigint;
    netVnd: bigint;
  }[];
}): InvoiceSideDiscount[] {
  const totals = (side: PricingSideName) => {
    const rows = input.allocations.filter((row) => row.side === side);
    return {
      present: rows.length > 0,
      gross: rows.reduce((sum, row) => sum + row.grossVnd, 0n),
      discount: rows.reduce((sum, row) => sum + row.discountShareVnd, 0n),
      net: rows.reduce((sum, row) => sum + row.netVnd, 0n),
    };
  };
  const out: InvoiceSideDiscount[] = [];
  const spa = totals('SPA');
  if (spa.present) {
    out.push({
      side: 'SPA',
      subtotalVnd: spa.gross.toString(),
      discountVnd: spa.discount.toString(),
      netVnd: spa.net.toString(),
      candidates: input.spa.candidates,
      winner: input.spa.winner,
      winnerSource: input.spa.winnerSource,
      member: input.spa.member,
      birthday: input.spa.birthday,
      selectionReason: input.spa.selectionReason,
    });
  }
  const beauty = totals('BEAUTY');
  if (beauty.present) {
    const stored =
      input.beauty.snapshot &&
      typeof input.beauty.snapshot.candidates === 'object' &&
      input.beauty.snapshot.candidates !== null
        ? (input.beauty.snapshot.candidates as unknown as {
            member?: InvoiceMemberCandidate | null;
            programs?: InvoiceDiscountCandidate[];
          })
        : null;
    const candidates = (Array.isArray(input.beauty.application?.candidates)
      ? input.beauty.application.candidates
      : Array.isArray(stored?.programs)
        ? stored.programs
        : []) as unknown as InvoiceDiscountCandidate[];
    out.push({
      side: 'BEAUTY',
      subtotalVnd: beauty.gross.toString(),
      discountVnd: beauty.discount.toString(),
      netVnd: beauty.net.toString(),
      candidates,
      winner: candidates.find((candidate) => candidate.winner) ?? null,
      winnerSource: (input.beauty.snapshot?.winnerSource ??
        (input.beauty.application
          ? input.beauty.application.voucherId
            ? 'VOUCHER'
            : 'PROMOTION'
          : null)) as InvoiceSideDiscount['winnerSource'],
      member: stored?.member ?? null,
      birthday: null,
      selectionReason:
        input.beauty.snapshot?.selectionReason ?? input.beauty.application?.selectionReason ?? null,
    });
  }
  return out;
}

export type { DiscountIneligibleReason };
