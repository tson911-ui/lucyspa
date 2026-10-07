import type { PricingSideName } from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { birthdayResponse, candidatesJson, snapshotCandidatesJson } from './discount.eval.js';
import type { EngineResult } from './discount.engine.js';
import type { PricingV3Result } from './pricing.v3.js';

/** The `calculation_version` stamped on an invoice priced by the version 3 engine (an invoice with a product line, P6-9). */
export const PRICING_V3_VERSION = 3;

/**
 * Phase 6 P6-9 (T19): writes the frozen version 3 pricing of the invoice being finalized, in the order the database guards need:
 * each side's program application (the Spa side in the Phase 4 table, the Beauty side in its own), then the usage ledger (one row per
 * program, however many sides it won), then each wallet's tier snapshot (the Spa one carries the birthday gift), then the gift's
 * redemption, then the net amount of every line. The database re-verifies all of it at commit (`lucy_check_invoice_pricing_v3`).
 */
export async function persistPricingV3(
  tx: Prisma.TransactionClient,
  input: {
    invoiceId: string;
    payerUserId: string | null;
    actorUserId: string;
    now: Date;
    v3: PricingV3Result;
  },
): Promise<void> {
  const { invoiceId, payerUserId, actorUserId, now, v3 } = input;
  const applicationData = (result: EngineResult) => {
    const winner = result.winner;
    if (!winner) return null;
    const version = winner.program.version;
    return {
      invoiceId,
      discountId: winner.program.id,
      versionId: version.id,
      voucherId: winner.voucher?.id ?? null,
      kind: version.kind,
      percentBp: version.percentBp,
      fixedAmountVnd: version.fixedAmountVnd,
      eligibleSubtotalVnd: winner.eligibleSubtotalVnd,
      computedAmountVnd: winner.amountVnd,
      // A shared (BOTH) program records the program-level figures that were split (T18); every other program is a plain application.
      ...(winner.shared
        ? {
            sharedEligibleSubtotalVnd: winner.shared.eligibleSubtotalVnd,
            sharedAmountVnd: winner.shared.amountVnd,
          }
        : {}),
      candidates: candidatesJson(result),
      selectionReason: result.selectionReason ?? 'ONLY_ELIGIBLE',
      finalizedByUserId: actorUserId,
      appliedAt: now,
    };
  };
  const spa = v3.sides.SPA;
  const beauty = v3.sides.BEAUTY;
  const spaApplication = spa ? applicationData(spa) : null;
  if (spaApplication) {
    await tx.invoiceDiscountApplication.create({ data: spaApplication, select: { id: true } });
  }
  const beautyApplication = beauty ? applicationData(beauty) : null;
  if (beautyApplication) {
    await tx.invoiceBeautyApplication.create({ data: beautyApplication, select: { id: true } });
  }
  // One redemption per program (OQ-P6-20): a program that won both sides is redeemed once, and one that won only one side too.
  for (const redemption of v3.redemptions) {
    await tx.discountRedemption.create({
      data: {
        invoiceId,
        discountId: redemption.program.id,
        versionId: redemption.program.version.id,
        voucherId: redemption.voucher?.id ?? null,
        payerUserId,
        redeemedAt: now,
      },
      select: { id: true },
    });
  }
  // The Spa wallet's tier snapshot (P5-T3), frozen with the candidates, the winner and the birthday gift layer (P5-6).
  const spaMember = spa?.member;
  const birthday = spa?.birthday;
  if (spa && spaMember && payerUserId !== null) {
    await tx.invoiceLoyaltySnapshot.create({
      data: {
        invoiceId,
        payerUserId,
        wallet: 'SPA',
        balanceBefore: spaMember.member.balanceBefore,
        tier: spaMember.member.tier,
        tierTableVersion: spaMember.member.tierTableVersion,
        memberDiscountBp: spaMember.member.discountBp,
        calculationVersion: PRICING_V3_VERSION,
        eligibleSpaVnd: spaMember.eligibleSubtotalVnd,
        memberAmountVnd: spa.winnerSource === 'MEMBER_TIER' ? spaMember.amountVnd : 0n,
        candidates: snapshotCandidatesJson(spa),
        winnerSource: spa.winnerSource,
        selectionReason: spa.selectionReason,
        ...(birthday
          ? {
              birthdayConfigVersion: birthday.context.version.versionNo,
              birthdayResult: birthdayResponse(birthday) as unknown as Prisma.InputJsonObject,
              birthdayAmountVnd: birthday.applied ? birthday.amountVnd : 0n,
              birthdayBaseVnd: birthday.applied ? birthday.baseVnd : 0n,
            }
          : {}),
        createdAt: now,
      },
      select: { id: true },
    });
    if (birthday?.applied) {
      await tx.birthdayRedemption.create({
        data: {
          invoiceId,
          configId: birthday.context.version.configId,
          versionId: birthday.context.version.id,
          payerUserId,
          birthdayOn: new Date(`${birthday.context.birthdayOn}T00:00:00.000Z`),
          amountVnd: birthday.amountVnd,
        },
        select: { id: true },
      });
    }
  }
  // The Beauty wallet's tier snapshot (T4): the payer's Beauty tier from the balance BEFORE the invoice.
  const beautyMember = beauty?.member;
  if (beauty && beautyMember && payerUserId !== null) {
    await tx.invoiceBeautySnapshot.create({
      data: {
        invoiceId,
        payerUserId,
        balanceBefore: beautyMember.member.balanceBefore,
        tier: beautyMember.member.tier,
        tierTableVersion: beautyMember.member.tierTableVersion,
        memberDiscountBp: beautyMember.member.discountBp,
        calculationVersion: PRICING_V3_VERSION,
        eligibleBeautyVnd: beautyMember.eligibleSubtotalVnd,
        memberAmountVnd: beauty.winnerSource === 'MEMBER_TIER' ? beautyMember.amountVnd : 0n,
        candidates: snapshotCandidatesJson(beauty),
        winnerSource: beauty.winnerSource,
        selectionReason: beauty.selectionReason,
        createdAt: now,
      },
      select: { id: true },
    });
  }
  for (const line of v3.allocations) {
    await tx.invoiceLineAllocation.create({
      data: {
        invoiceId,
        invoiceLineId: line.lineId,
        side: line.side,
        grossVnd: line.grossVnd,
        discountShareVnd: line.discountShareVnd,
        netVnd: line.netVnd,
        createdAt: now,
      },
      select: { id: true },
    });
  }
}

/** What the audit entry of a finalization records about version 3 pricing (ids and amounts only). */
export function pricingAudit(v3: PricingV3Result): Prisma.InputJsonObject {
  const sideAudit = (side: PricingSideName) => {
    const result = v3.sides[side];
    if (!result) return null;
    return {
      side,
      subtotalVnd: result.subtotalVnd.toString(),
      discountVnd: result.discountTotalVnd.toString(),
      netVnd: result.totalVnd.toString(),
      winnerSource: result.winnerSource,
      selectionReason: result.selectionReason,
      winnerDiscountId: result.winner?.program.id ?? null,
      winnerDiscountCode: result.winner?.program.code ?? null,
      voucherCode: result.winner?.voucher?.code ?? null,
      memberAmountVnd: result.member ? result.member.amountVnd.toString() : null,
    };
  };
  return {
    version: PRICING_V3_VERSION,
    sides: [sideAudit('SPA'), sideAudit('BEAUTY')].filter(
      (entry): entry is NonNullable<typeof entry> => entry !== null,
    ),
    redemptions: v3.redemptions.map((redemption) => ({
      discountId: redemption.program.id,
      sides: redemption.sides,
    })),
  } as Prisma.InputJsonObject;
}
