import { randomUUID } from 'node:crypto';
import type { Prisma } from '@lucy-spa/database';

/**
 * Test fixture (P7-17): a tip exactly as the settlement writes it (a TIP_IN entry of the bank fund and the tip naming the invoice and the KTV),
 * for payroll and income tests that only need a tip to exist. The real path (the customer's pledge, the provider total, the settlement) is
 * covered by `tips.integration.test.ts` and `payos.tips.integration.test.ts`. Staff can no longer record a tip, so there is no service call.
 */
export async function seedTip(
  tx: Prisma.TransactionClient,
  input: {
    invoiceId: string;
    employeeUserId: string;
    amountVnd: bigint;
    recordedByUserId: string;
  },
): Promise<string> {
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: input.invoiceId },
    select: { branchId: true },
  });
  const bank =
    (await tx.cashFund.findFirst({ where: { kind: 'BANK' }, select: { id: true } })) ??
    (await tx.cashFund.create({
      data: {
        kind: 'BANK',
        name: 'Ngân hàng',
        openingBalanceVnd: 0n,
        openingAt: new Date(),
        openingByUserId: input.recordedByUserId,
      },
      select: { id: true },
    }));
  const [local] = await tx.$queryRaw<{ day: string }[]>`
    SELECT to_char(lucy_branch_local_date(${invoice.branchId}::uuid, clock_timestamp()), 'YYYY-MM-DD') AS day`;
  const businessDate = new Date(`${local!.day}T00:00:00.000Z`);
  const tipId = randomUUID();
  const entry = await tx.fundEntry.create({
    data: {
      fundId: bank.id,
      branchId: invoice.branchId,
      businessDate,
      direction: 'IN',
      category: 'TIP_IN',
      amountVnd: input.amountVnd,
      sourceType: 'TIP',
      sourceId: tipId,
      sourceLeg: 0,
      actorUserId: input.recordedByUserId,
    },
    select: { id: true },
  });
  await tx.tip.create({
    data: {
      id: tipId,
      branchId: invoice.branchId,
      invoiceId: input.invoiceId,
      employeeUserId: input.employeeUserId,
      amountVnd: input.amountVnd,
      method: 'TRANSFER',
      businessDate,
      recordedByUserId: input.recordedByUserId,
      clientRequestId: randomUUID(),
      fundEntryId: entry.id,
    },
    select: { id: true },
  });
  return tipId;
}
