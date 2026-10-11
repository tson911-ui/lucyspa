import { randomUUID } from 'node:crypto';
import type { Prisma } from '@lucy-spa/database';

/**
 * Phase 7 P7-17 (Owner decision of 2026-10-12): the tips a customer added to a PayOS payment. The pledge (who gets how much) is frozen with
 * the request (`payment_tip_pledges`); the provider is asked for the invoice part plus the pledges; this function runs INSIDE the settlement
 * transaction, only when the provider confirmed exactly that total, and writes for every KTV one tip (method TRANSFER, naming the payment)
 * and the matching TIP_IN entry of the bank fund. Money that is not applied (a mismatch, an invoice that is no longer payable) writes
 * nothing: no tip exists without the confirmed total.
 *
 * Lock order: the invoice row (already held by the settlement), then the bank fund in SHARE mode (it waits for a closing that is running).
 * Idempotent: `UNIQUE(payment_id, employee_user_id)` on tips; the settlement itself runs once per payment.
 */
export interface PledgedTip {
  readonly tipId: string;
  readonly employeeUserId: string;
  readonly amountVnd: bigint;
}

/** The total the customer pledged for a payment, and the pledges in a stable order. */
export async function pledgedTips(
  tx: Prisma.TransactionClient,
  paymentId: string,
): Promise<{
  readonly totalVnd: bigint;
  readonly pledges: readonly { employeeUserId: string; amountVnd: bigint }[];
}> {
  const pledges = await tx.paymentTipPledge.findMany({
    where: { paymentId },
    orderBy: { employeeUserId: 'asc' },
    select: { employeeUserId: true, amountVnd: true },
  });
  return { totalVnd: pledges.reduce((sum, pledge) => sum + pledge.amountVnd, 0n), pledges };
}

export async function recordPledgedTips(
  tx: Prisma.TransactionClient,
  input: {
    /** The payment row that SUCCEEDED (a late confirmation is a new row). */
    paymentId: string;
    /** The request the customer chose the tips for (the same row, or the one a late confirmation points at). */
    pledgeOwnerPaymentId: string;
    invoice: { id: string; branchId: string };
    collectedByUserId: string;
    at: Date;
  },
): Promise<PledgedTip[]> {
  const { pledges } = await pledgedTips(tx, input.pledgeOwnerPaymentId);
  if (pledges.length === 0) return [];
  // The request was only created while the cash book was live and had a bank fund; neither can go away.
  const bank = await tx.cashFund.findFirst({ where: { kind: 'BANK' }, select: { id: true } });
  if (!bank) throw new Error('A tip was pledged but the bank fund does not exist.');
  await tx.$queryRaw`SELECT id FROM cash_funds WHERE id = ${bank.id}::uuid FOR SHARE`;
  const [local] = await tx.$queryRaw<{ day: string }[]>`
    SELECT to_char(lucy_branch_local_date(${input.invoice.branchId}::uuid, ${input.at}::timestamptz), 'YYYY-MM-DD') AS day`;
  if (!local) throw new Error('The branch calendar is unavailable.');
  const businessDate = new Date(`${local.day}T00:00:00.000Z`);
  const written: PledgedTip[] = [];
  for (const pledge of pledges) {
    const tipId = randomUUID();
    const entry = await tx.fundEntry.create({
      data: {
        fundId: bank.id,
        branchId: input.invoice.branchId,
        businessDate,
        direction: 'IN',
        category: 'TIP_IN',
        amountVnd: pledge.amountVnd,
        sourceType: 'TIP',
        sourceId: tipId,
        sourceLeg: 0,
        actorUserId: input.collectedByUserId,
      },
      select: { id: true },
    });
    await tx.tip.create({
      data: {
        id: tipId,
        branchId: input.invoice.branchId,
        invoiceId: input.invoice.id,
        employeeUserId: pledge.employeeUserId,
        amountVnd: pledge.amountVnd,
        method: 'TRANSFER',
        businessDate,
        recordedByUserId: input.collectedByUserId,
        clientRequestId: randomUUID(),
        fundEntryId: entry.id,
        paymentId: input.paymentId,
      },
      select: { id: true },
    });
    await tx.auditEvent.create({
      data: {
        action: 'TIP_RECORDED',
        actorKind: 'SYSTEM',
        actorUserId: null,
        subjectUserId: pledge.employeeUserId,
        entityType: 'Tip',
        entityId: tipId,
        branchId: input.invoice.branchId,
        requestId: null,
        occurredAt: input.at,
        after: {
          invoiceId: input.invoice.id,
          paymentId: input.paymentId,
          amountVnd: pledge.amountVnd.toString(),
          source: 'CUSTOMER_PAYOS',
        },
        dataClassification: 'FINANCIAL',
      },
      select: { id: true },
    });
    written.push({ tipId, employeeUserId: pledge.employeeUserId, amountVnd: pledge.amountVnd });
  }
  return written;
}
