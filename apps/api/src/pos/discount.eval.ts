import type {
  DiscountIneligibleReason,
  InvoiceDiscountCandidate,
  InvoiceDiscountResponse,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import {
  evaluateDiscounts,
  type EngineCandidate,
  type EngineLine,
  type EngineProgram,
  type EngineResult,
  type EngineVersion,
  type EngineVoucher,
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
  const result = evaluateDiscounts({
    lines,
    promotions,
    supplied: entries.map((entry) => ({ voucher: entry.voucher, program: entry.program })),
    hasMemberPayer: invoice.payerUserId !== null,
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

/** A frozen application as the response shows it (candidates come back from the stored JSON). */
export function storedDiscount(
  application: {
    voucherId: string | null;
    discountId: string;
    candidates: Prisma.JsonValue;
    selectionReason: string;
    appliedAt: Date;
  },
  entries: InvoiceDiscountResponse['vouchers'],
): InvoiceDiscountResponse {
  const candidates = (Array.isArray(application.candidates)
    ? application.candidates
    : []) as unknown as InvoiceDiscountCandidate[];
  return {
    preview: false,
    candidates,
    winner: candidates.find((candidate) => candidate.winner) ?? null,
    selectionReason: application.selectionReason,
    vouchers: entries,
    appliedAt: application.appliedAt.toISOString(),
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
    selectionReason: result.selectionReason,
    vouchers: entries,
    appliedAt: null,
  };
}

export type { DiscountIneligibleReason };
