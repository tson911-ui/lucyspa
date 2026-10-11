import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  candidateInvoices,
  LocalDiskMediaStorage,
  loadPayRules,
  payRulesStamp,
  reconcileInvoiceEarnings,
} from '@lucy-spa/server';
import { pino } from 'pino';
import { ProductRefundService } from '../product-returns/refund.service.js';
import { ProductReturnService } from '../product-returns/return.service.js';
import { confirmAgain } from '../testing/confirm-again.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { productSaleKit } from '../testing/product-sale-kit.js';
import { shopToday } from './pay.access.js';
import { PayService } from './pay.service.js';

const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Phase 7 P7-9 against real PostgreSQL (design 5; P7-T3, P7-T4, P7-T6, OQ-104..107): the earnings engine. Nothing before go-live;
 * a PAID service earns the tour of its service for an OFFICIAL KTV; a PAID product earns the commission of the most specific rule on its
 * net for its seller; no rule, no earning; a payment reversal, a refund and a seller correction add negative rows (never an edit); a
 * second pass writes nothing; the database refuses to edit or exceed an earning. Fixtures roll back.
 */
test(
  'Phase 7 P7-9 earnings: tour, commission, reversals, refunds, seller correction, idempotency, guards; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    const folder = await mkdtemp(path.join(tmpdir(), 'lucy-earnings-'));
    try {
      await phase6Fixture(async (base) => {
        const k = await productSaleKit(base);
        const { tx, fails } = base;
        const { A, invoices, people, exact } = k;
        const pay = new PayService(base.adapter, base.throttle, base.environment);
        const returns = new ProductReturnService(
          base.adapter,
          base.throttle,
          new LocalDiskMediaStorage(folder),
          pino({ level: 'silent' }),
        );
        const refunds = new ProductRefundService(base.adapter, base.throttle, base.environment);
        const today = shopToday(new Date());
        const rules = await base.staff([], { globalCodes: ['MANAGE_PAY_RULES'] });
        const payroll = await base.staff([], { globalCodes: ['MANAGE_PAYROLL'] });
        const reader = await base.staff([], { globalCodes: ['APPROVE_PAYROLL'] });
        const nobody = await base.staff(['VIEW_INVOICES'], { branchId: A.id });
        const clerk = await base.staff(['MANAGE_PRODUCT_RETURNS'], { branchId: A.id });
        const refunder = await base.staff(['REFUND_PRODUCTS'], { branchId: A.id });
        const owner = await tx.user.findFirstOrThrow({ where: { kind: 'OWNER' } });
        const seller = people.cashier;
        const other = await base.staff([], { branchId: A.id });
        const ended = await base.staff([], { branchId: A.id });
        await tx.employmentClassificationChange.create({
          data: {
            employeeUserId: ended.id,
            classification: 'ENDED',
            effectiveDate: new Date('2021-01-01'),
            recordedByUserId: owner.id,
          },
        });
        const id = () => randomUUID();

        let n = 0;
        const productSale = async (price = 100_000, quantity = 2, sellerId?: string) => {
          n += 1;
          const product = await k.product(`ern${n}`, [price]);
          const variant = product.variants[0]!;
          await k.receive(variant.id, quantity + 5);
          const invoice = await k.finalize(
            await k.addLine(await k.openSale(people.cashier, null), variant.id, quantity, sellerId),
          );
          const paid = await k.pay(invoice.id, Number(invoice.totalVnd));
          await k.runInventory(invoice.id);
          const line = await tx.invoiceLine.findFirstOrThrow({
            where: { invoiceId: invoice.id, kind: 'PRODUCT' },
          });
          return {
            invoiceId: invoice.id,
            lineId: line.id,
            paymentId: paid.payment.id,
            productId: product.id,
            quantity,
            total: BigInt(invoice.totalVnd),
          };
        };
        const serviceSale = async () => {
          const done = await k.finalize(await k.serviceDraft([exact]));
          await k.pay(done.id, Number(done.totalVnd));
          const line = await tx.invoiceLine.findFirstOrThrow({
            where: { invoiceId: done.id, kind: 'SERVICE' },
          });
          return { invoiceId: done.id, lineId: line.id };
        };
        const run = (invoiceId: string) => k.ok(() => reconcileInvoiceEarnings(tx, invoiceId));
        const rows = (invoiceId: string) =>
          tx.payEarning.findMany({ where: { invoiceId }, orderBy: { seq: 'asc' } });
        const net = async (invoiceId: string, employeeId?: string) =>
          (
            await tx.payEarning.aggregate({
              where: { invoiceId, ...(employeeId ? { employeeUserId: employeeId } : {}) },
              _sum: { amountVnd: true },
            })
          )._sum.amountVnd ?? 0n;

        // ------------------------------------------------------------------------------- before go-live
        const early = await productSale();
        const earlyService = await serviceSale();
        await suite.test(
          'nothing is earned while go-live is empty, nor for invoices paid before it',
          async () => {
            assert.deepEqual(await run(early.invoiceId), { written: 0 });
            await tx.financeGoLive.create({
              data: { id: 1, at: new Date(), setByUserId: owner.id, reauthenticatedAt: new Date() },
            });
            assert.deepEqual(await run(early.invoiceId), { written: 0 });
            assert.deepEqual(await run(earlyService.invoiceId), { written: 0 });
            assert.equal(await tx.payEarning.count(), 0);
            assert.deepEqual(await candidateInvoices(tx, { since: null, limit: 50 }), []);
          },
        );

        await suite.test('with no rule in force nothing is earned', async () => {
          const sale = await productSale(100_000, 2, seller.id);
          const service = await serviceSale();
          assert.deepEqual(await run(sale.invoiceId), { written: 0 });
          assert.deepEqual(await run(service.invoiceId), { written: 0 });
          assert.equal(await tx.payEarning.count(), 0);
        });

        // ----------------------------------------------------------------------------------- rules
        await pay.addTourRule(rules.token, {
          serviceId: exact.id,
          amountVnd: '15000',
          effectiveFrom: today,
          reason: null,
        });
        await pay.addCommissionRule(rules.token, {
          scope: 'SHOP',
          targetId: null,
          employeeUserId: null,
          kind: 'PERCENT',
          value: '500',
          effectiveFrom: today,
          reason: null,
        });

        await suite.test(
          'a paid service earns the tour for the official KTV; a paid product earns the commission for its seller',
          async () => {
            const service = await serviceSale();
            const sale = await productSale(100_000, 2, seller.id);
            assert.deepEqual(await run(service.invoiceId), { written: 1 });
            assert.deepEqual(await run(sale.invoiceId), { written: 1 });
            const [tour] = await rows(service.invoiceId);
            assert.equal(tour?.kind, 'TOUR');
            assert.equal(tour?.employeeUserId, people.ktv.id);
            assert.equal(tour?.amountVnd, 15_000n);
            assert.equal(tour?.paidSeq, 1);
            assert.equal(tour?.businessDate.toISOString().slice(0, 10), today);
            assert.equal(tour?.ruleKind, 'TOUR');
            assert.equal(tour?.reversesId, null);
            const [commission] = await rows(sale.invoiceId);
            assert.equal(commission?.kind, 'PRODUCT_COMMISSION');
            assert.equal(commission?.employeeUserId, seller.id);
            assert.equal(commission?.amountVnd, 10_000n); // 5% of the 200,000 net
            assert.equal(commission?.baseVnd, 200_000n);
            assert.equal(commission?.quantity, 2);
            assert.equal(commission?.ruleKind, 'PERCENT');
            assert.equal(commission?.ruleValue, 500n);
            // A second pass writes nothing: the keys are the proof.
            assert.deepEqual(await run(service.invoiceId), { written: 0 });
            assert.deepEqual(await run(sale.invoiceId), { written: 0 });
            assert.equal(await tx.payEarning.count({ where: { invoiceId: sale.invoiceId } }), 1);
            // The invoice is found by the sweep until it is reconciled and unchanged.
            const found = await candidateInvoices(tx, { since: null, limit: 50 });
            assert.ok(found.some((item) => item.id === sale.invoiceId));
          },
        );

        await suite.test(
          'a rule that starts later, a person who is not official, and a rule of 0 earn nothing',
          async () => {
            // A later rule never reaches back; the stored value of an earning is its own.
            await pay.addTourRule(rules.token, {
              serviceId: exact.id,
              amountVnd: '30000',
              effectiveFrom: addDays(today, 10),
              reason: null,
            });
            const later = await serviceSale();
            await run(later.invoiceId);
            assert.equal((await rows(later.invoiceId))[0]?.amountVnd, 15_000n);
            // Someone who is not an OFFICIAL employee earns no commission, whoever sold.
            const noOne = await productSale(100_000, 1, ended.id);
            assert.deepEqual(await run(noOne.invoiceId), { written: 0 });
            // A product with an explicit 0% rule pays nothing, even though the shop default would.
            const zero = await productSale(100_000, 1, seller.id);
            await pay.addCommissionRule(rules.token, {
              scope: 'PRODUCT',
              targetId: zero.productId,
              employeeUserId: null,
              kind: 'PERCENT',
              value: '0',
              effectiveFrom: today,
              reason: 'Hàng này không hoa hồng',
            });
            assert.deepEqual(await run(zero.invoiceId), { written: 0 });
            // A rule for one employee beats the shop default; a fixed amount is per unit.
            const mine = await productSale(100_000, 3, seller.id);
            await pay.addCommissionRule(rules.token, {
              scope: 'PRODUCT',
              targetId: mine.productId,
              employeeUserId: seller.id,
              kind: 'FIXED_PER_UNIT',
              value: '7000',
              effectiveFrom: today,
              reason: null,
            });
            assert.deepEqual(await run(mine.invoiceId), { written: 1 });
            assert.equal((await rows(mine.invoiceId))[0]?.amountVnd, 21_000n);
          },
        );

        await suite.test(
          'a reversed payment reverses the earnings; paying again earns again for the new episode',
          async () => {
            const sale = await productSale(100_000, 2, seller.id);
            const service = await serviceSale();
            await run(sale.invoiceId);
            await run(service.invoiceId);
            assert.equal(await net(sale.invoiceId), 10_000n);
            // The cash payment is reversed (a person confirms their password), the invoice goes back to pending.
            await confirmAgain(base, people.boss.token);
            await k.ok(() =>
              invoices.reversePayment(people.boss.token, sale.invoiceId, sale.paymentId, {
                reason: 'Nhập nhầm',
              }),
            );
            assert.deepEqual(await run(sale.invoiceId), { written: 1 });
            assert.equal(await net(sale.invoiceId), 0n);
            const [earn, reversal] = await rows(sale.invoiceId);
            assert.equal(reversal?.reversesId, earn?.id);
            assert.equal(reversal?.amountVnd, -10_000n);
            assert.equal(reversal?.reason, 'EPISODE_ENDED');
            assert.deepEqual(await run(sale.invoiceId), { written: 0 });
            // Paid again: a new episode earns once more, the old one stays reversed.
            await k.pay(sale.invoiceId, Number(sale.total));
            assert.deepEqual(await run(sale.invoiceId), { written: 1 });
            const all = await rows(sale.invoiceId);
            assert.deepEqual(
              all.map((row) => [row.paidSeq, row.amountVnd]),
              [
                [1, 10_000n],
                [1, -10_000n],
                [2, 10_000n],
              ],
            );
            assert.equal(await net(sale.invoiceId), 10_000n);
          },
        );

        const accepted = async (sale: Awaited<ReturnType<typeof productSale>>) => {
          const opened = await k.ok(() =>
            returns.open(clerk.token, {
              branchId: A.id,
              invoiceLineId: sale.lineId,
              reason: 'PERSONAL_PREFERENCE',
              requestedOutcome: 'REFUND',
              quantity: sale.quantity,
              sealIntact: true,
              notes: null,
              clientRequestId: id(),
            }),
          );
          return k.ok(() =>
            returns.accept(refunder.token, opened.id, {
              expectedRowVersion: opened.rowVersion,
              outcome: 'REFUND',
              note: null,
            }),
          );
        };
        const refund = async (caseId: string, quantity: number) => {
          await confirmAgain(base, refunder.token);
          await k.ok(() =>
            refunds.refund(refunder.token, caseId, {
              quantity,
              method: 'CASH',
              bankReference: null,
              restock: 'SELLABLE',
              reason: 'Khách trả hàng',
              clientRequestId: id(),
            }),
          );
        };

        await suite.test(
          'a refund takes back its share of the commission, cumulatively, never above the earning',
          async () => {
            const sale = await productSale(100_000, 3, seller.id); // net 300,000 -> 15,000
            await run(sale.invoiceId);
            assert.equal(await net(sale.invoiceId), 15_000n);
            const kase = await accepted(sale);
            await refund(kase.id, 1);
            assert.deepEqual(await run(sale.invoiceId), { written: 1 });
            assert.equal(await net(sale.invoiceId), 10_000n);
            assert.equal((await rows(sale.invoiceId)).at(-1)?.reason, 'REFUND');
            assert.deepEqual(await run(sale.invoiceId), { written: 0 });
            await refund(kase.id, 2);
            assert.deepEqual(await run(sale.invoiceId), { written: 1 });
            assert.equal(await net(sale.invoiceId), 0n);
            const reversed = await tx.payEarning.aggregate({
              where: { invoiceId: sale.invoiceId, reversesId: { not: null } },
              _sum: { amountVnd: true },
            });
            assert.equal(reversed._sum.amountVnd, -15_000n);
            assert.deepEqual(await run(sale.invoiceId), { written: 0 });
          },
        );

        await suite.test(
          'the seller of a line can be corrected: audited, the old earning reversed, the new seller earns',
          async () => {
            const sale = await productSale(100_000, 2, seller.id);
            await run(sale.invoiceId);
            const correct = (token: string, patch: Record<string, unknown> = {}) =>
              pay.correctSeller(token, sale.lineId, {
                employeeUserId: other.id,
                reason: 'Nhập nhầm người bán',
                ...patch,
              } as never);
            for (const actor of [nobody, rules, reader])
              await fails(() => correct(actor.token), 'FORBIDDEN');
            await fails(
              () => correct(payroll.token, { reason: ' ' }),
              'VALIDATION_FAILED',
              'reason',
            );
            await fails(
              () => correct(payroll.token, { employeeUserId: ended.id }),
              'VALIDATION_FAILED',
              'employeeUserId',
            );
            await fails(() => correct(payroll.token, { employeeUserId: seller.id }), 'CONFLICT');
            await fails(() => correct(payroll.token, { extra: 1 }), 'VALIDATION_FAILED');
            await fails(
              () =>
                pay.correctSeller(payroll.token, id(), { employeeUserId: other.id, reason: 'x' }),
              'NOT_FOUND',
            );
            const service = await serviceSale();
            await fails(
              () =>
                pay.correctSeller(payroll.token, service.lineId, {
                  employeeUserId: other.id,
                  reason: 'x',
                }),
              'NOT_FOUND',
            );
            const result = await correct(payroll.token);
            assert.equal(result.canCorrectSeller, true);
            assert.equal(
              result.lines.find((line) => line.lineId === sale.lineId)?.person?.id,
              other.id,
            );
            assert.equal(
              result.lines.find((line) => line.lineId === sale.lineId)?.originalSeller?.id,
              seller.id,
            );
            assert.equal(await net(sale.invoiceId, seller.id), 0n);
            assert.equal(await net(sale.invoiceId, other.id), 10_000n);
            const reversal = (await rows(sale.invoiceId)).find((row) => row.reversesId !== null);
            assert.equal(reversal?.reason, 'SELLER_CHANGED');
            // The invoice line itself is never rewritten; the correction is its own audited record.
            const product = await tx.invoiceLineProduct.findUniqueOrThrow({
              where: { invoiceLineId: sale.lineId },
            });
            assert.equal(product.sellerUserId, seller.id);
            const audit = await tx.auditEvent.findMany({
              where: { action: 'PRODUCT_SELLER_CORRECTED', entityId: sale.lineId },
            });
            assert.equal(audit.length, 1);
            assert.equal(audit[0]?.dataClassification, 'EMPLOYEE_PAY');
            assert.equal(audit[0]?.reason, 'Nhập nhầm người bán');
            // And back again: the second seller's earning is reversed, the first earns again under a new key.
            await correct(payroll.token, { employeeUserId: seller.id, reason: 'Sửa lại' });
            assert.equal(await net(sale.invoiceId, other.id), 0n);
            assert.equal(await net(sale.invoiceId, seller.id), 10_000n);
            assert.deepEqual(await run(sale.invoiceId), { written: 0 });
            await tx.$executeRawUnsafe('SAVEPOINT guard');
            await assert.rejects(
              tx.$executeRawUnsafe('UPDATE pay_seller_overrides SET reason = $$x$$'),
              /append-only/,
            );
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT guard');
          },
        );

        await suite.test(
          "an invoice's earnings can be read with a payroll permission; claimed rows stay put",
          async () => {
            const sale = await productSale(100_000, 2, seller.id);
            await run(sale.invoiceId);
            await fails(() => pay.invoiceEarnings(nobody.token, sale.invoiceId), 'FORBIDDEN');
            await fails(() => pay.invoiceEarnings(rules.token, sale.invoiceId), 'FORBIDDEN');
            await fails(() => pay.invoiceEarnings(payroll.token, id()), 'NOT_FOUND');
            const view = await pay.invoiceEarnings(reader.token, sale.invoiceId);
            assert.equal(view.canCorrectSeller, false);
            assert.equal(view.status, 'PAID');
            assert.equal(view.items.length, 1);
            assert.equal(view.items[0]?.claimed, false);
            assert.equal(view.items[0]?.amountVnd, '10000');
            // A payroll run claims a row once (P7-12); afterwards a correction only adds new rows.
            const earn = (await rows(sale.invoiceId))[0]!;
            const claim = (
              await tx.payRun.create({
                data: {
                  periodMonth: new Date('2019-03-01T00:00:00.000Z'),
                  createdByUserId: owner.id,
                },
                select: { id: true },
              })
            ).id;
            await tx.$executeRawUnsafe(
              `UPDATE pay_earnings SET run_id = '${claim}'::uuid WHERE id = '${earn.id}'::uuid`,
            );
            for (const statement of [
              `UPDATE pay_earnings SET run_id = '${id()}'::uuid WHERE id = '${earn.id}'::uuid`,
              `UPDATE pay_earnings SET amount_vnd = 1 WHERE id = '${earn.id}'::uuid`,
              `DELETE FROM pay_earnings WHERE id = '${earn.id}'::uuid`,
            ]) {
              await tx.$executeRawUnsafe('SAVEPOINT guard');
              await assert.rejects(tx.$executeRawUnsafe(statement), /never changes|never deleted/);
              await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT guard');
            }
            await pay.correctSeller(payroll.token, sale.lineId, {
              employeeUserId: other.id,
              reason: 'Đổi người bán sau khi đã tính lương',
            });
            const after = await rows(sale.invoiceId);
            assert.equal(after.length, 3);
            assert.equal(after[0]?.runId, claim);
            assert.ok(after.slice(1).every((row) => row.runId === null));
            assert.equal(
              (await pay.invoiceEarnings(payroll.token, sale.invoiceId)).items.filter(
                (item) => item.claimed,
              ).length,
              1,
            );
          },
        );

        await suite.test(
          'the database refuses a reversal that does not match or exceeds its earning',
          async () => {
            const sale = await productSale(100_000, 2, seller.id);
            await run(sale.invoiceId);
            const earn = (await rows(sale.invoiceId))[0]!;
            const insert = (over: Record<string, unknown>) => {
              const v = {
                amount: -3000,
                employee: earn.employeeUserId,
                kind: 'PRODUCT_COMMISSION',
                key: id(),
                reverses: earn.id,
                reason: 'REFUND',
                ...over,
              };
              return `INSERT INTO pay_earnings (kind, employee_user_id, branch_id, invoice_id, invoice_line_id, paid_seq, business_date, amount_vnd, reverses_id, reason, source_key)
                    VALUES ('${v.kind}', '${v.employee}'::uuid, '${earn.branchId}'::uuid, '${earn.invoiceId}'::uuid, '${earn.invoiceLineId}'::uuid, ${earn.paidSeq}, '${today}', ${v.amount}, '${v.reverses}'::uuid, '${v.reason}', '${v.key}')`;
            };
            const refuses = async (statement: string, pattern: RegExp) => {
              await tx.$executeRawUnsafe('SAVEPOINT guard');
              await assert.rejects(tx.$executeRawUnsafe(statement), pattern);
              await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT guard');
            };
            await refuses(insert({ amount: -10_001 }), /Reversals never exceed/);
            await refuses(
              insert({ kind: 'TOUR' }),
              /reverses one earning of the same person, kind, line and episode/,
            );
            await refuses(
              insert({ employee: other.id }),
              /reverses one earning of the same person/,
            );
            await refuses(insert({ amount: 3000 }), /pay_earnings_amount_sign/);
            await refuses(
              insert({ reason: 'X', key: earn.sourceKey }),
              /pay_earnings_source_key|duplicate key/,
            );
            await tx.$executeRawUnsafe(insert({ amount: -10_000 }));
            await refuses(insert({ amount: -1 }), /Reversals never exceed/);
          },
        );

        await suite.test('the rules in force are read once for a pass', async () => {
          const loaded = await loadPayRules(tx);
          assert.ok(loaded.tour.length >= 2);
          assert.ok(loaded.commission.length >= 3);
        });

        await suite.test(
          'the worker walks the candidates page by page and notices a changed rule',
          async () => {
            const all = await candidateInvoices(tx, { since: null, limit: 500 });
            assert.ok(all.length >= 4);
            const walked: string[] = [];
            let after: { touchedAt: Date; id: string } | null = null;
            for (;;) {
              const page = await candidateInvoices(tx, { since: null, limit: 2, after });
              walked.push(...page.map((item) => item.id));
              if (page.length < 2) break;
              const last = page[page.length - 1]!;
              after = { touchedAt: last.touchedAt, id: last.id };
            }
            assert.deepEqual(
              walked,
              all.map((item) => item.id),
              'pages join up with no gap and no repeat',
            );
            const before = await payRulesStamp(tx);
            assert.equal(await payRulesStamp(tx), before);
            await pay.addTourRule(rules.token, {
              serviceId: exact.id,
              amountVnd: '1000',
              effectiveFrom: addDays(today, 30),
              reason: null,
            });
            assert.notEqual(await payRulesStamp(tx), before);
          },
        );
      });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
);
