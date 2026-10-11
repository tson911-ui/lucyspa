import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { confirmAgain } from '../testing/confirm-again.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { productSaleKit } from '../testing/product-sale-kit.js';
import { CashService } from './cash.service.js';

const shopDay = (offset = 0): string => {
  const now = Date.now() + offset * 86_400_000;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
};

/**
 * Phase 7 P7-5 against real PostgreSQL (design PHASE7_PAYROLL_FUNDS.md 7.4, P7-T9): the daily count and closing. Expected cash comes from
 * the book, a difference needs a reason and becomes its own entry (never a deduction), the Owner's withdrawal leaves the next day's
 * float, a closed day is locked and late money goes to the next open day, a closing posts what is still missing first, it needs a
 * fresh password and is idempotent. Fixtures roll back.
 */
test(
  'Phase 7 P7-5 cash closing: expected, count, difference, withdrawal, lock, late items, passwords; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await productSaleKit(base);
      const { tx, fails } = base;
      const { A, B, invoices, people } = k;
      const cash = new CashService(base.adapter, base.throttle, base.environment);
      const manager = await base.staff(['MANAGE_CASH'], { branchId: A.id });
      const viewer = await base.staff(['VIEW_CASH'], { branchId: A.id });
      const elsewhere = await base.staff(['MANAGE_CASH'], { branchId: B.id });
      const id = () => randomUUID();

      let n = 0;
      const cashSale = async (price = 150_000, quantity = 2) => {
        n += 1;
        const product = await k.product(`cl${n}`, [price]);
        const variant = product.variants[0]!;
        await k.receive(variant.id, quantity + 5);
        const invoice = await k.finalize(
          await k.addLine(await k.openSale(people.cashier, null), variant.id, quantity),
        );
        await k.pay(invoice.id, Number(invoice.totalVnd));
        await invoices.get(people.cashier.token, invoice.id);
        return BigInt(invoice.totalVnd);
      };

      await suite.test('nothing to close before the Owner starts the book', async () => {
        await fails(
          () => cash.previewClosing(manager.token, id(), { date: shopDay() }),
          'NOT_FOUND',
        );
      });

      const active = await tx.branch.findMany({ where: { isActive: true }, select: { id: true } });
      await cash.goLive(base.ownerToken, {
        branches: active.map((branch) => ({ branchId: branch.id, countedVnd: '1000000' })),
        bankVnd: '0',
      });
      const fundA = await tx.cashFund.findFirstOrThrow({ where: { branchId: A.id, kind: 'CASH' } });
      const bank = await tx.cashFund.findFirstOrThrow({ where: { kind: 'BANK' } });
      const today = shopDay();
      const close = async (
        date: string,
        counted: number,
        withdrawal: number,
        why: string | null,
        token = manager.token,
        patch: Record<string, unknown> = {},
      ) => {
        await confirmAgain(base, token);
        return k.ok(() =>
          cash.closeDay(token, fundA.id, {
            date,
            countedVnd: String(counted),
            withdrawalVnd: String(withdrawal),
            reason: why,
            clientRequestId: id(),
            ...patch,
          } as never),
        );
      };

      await suite.test(
        'the preview posts what is missing and shows the figures; who may close',
        async () => {
          const sale = await cashSale();
          assert.equal(
            await tx.fundEntry.count({ where: { fundId: fundA.id } }),
            0,
            'not posted yet',
          );
          const preview = await k.ok(() =>
            cash.previewClosing(manager.token, fundA.id, { date: today }),
          );
          assert.equal(await tx.fundEntry.count({ where: { fundId: fundA.id } }), 1);
          assert.equal(preview.openingFloatVnd, '1000000');
          assert.equal(preview.cashInVnd, sale.toString());
          assert.equal(preview.cashOutVnd, '0');
          assert.equal(preview.expectedVnd, (1_000_000n + sale).toString());
          assert.equal(preview.unposted, 0);
          assert.equal(preview.closable, true);
          assert.equal(preview.blockedBy, null);
          assert.equal(preview.lastClosedDate, null);
          assert.equal(preview.alertThresholdVnd, '50000');
          assert.equal(preview.defaultNextFloatVnd, '1000000');
          // The day after today is not a day to close yet; nobody without MANAGE_CASH at the branch closes or previews.
          const future = await cash.previewClosing(manager.token, fundA.id, { date: shopDay(1) });
          assert.equal(future.blockedBy, 'FUTURE_DAY');
          assert.equal(future.closable, false);
          for (const actor of [viewer, elsewhere]) {
            await fails(
              () => cash.previewClosing(actor.token, fundA.id, { date: today }),
              'FORBIDDEN',
            );
            await fails(
              () =>
                cash.closeDay(actor.token, fundA.id, {
                  date: today,
                  countedVnd: '0',
                  withdrawalVnd: '0',
                  reason: null,
                  clientRequestId: id(),
                }),
              'FORBIDDEN',
            );
          }
          await fails(
            () => cash.previewClosing(manager.token, bank.id, { date: today }),
            'NOT_FOUND',
          );
          await fails(
            () => cash.previewClosing(manager.token, fundA.id, { date: '2026-02-30' }),
            'VALIDATION_FAILED',
            'date',
          );
          await fails(
            () => cash.previewClosing(manager.token, fundA.id, { date: today, extra: 1 } as never),
            'VALIDATION_FAILED',
          );
        },
      );

      await suite.test(
        'days close in order: a short count needs a reason and becomes its own entry',
        async () => {
          const d3 = shopDay(-3);
          // Strict input and the fresh password first; nothing is written by a refused closing.
          await fails(() => close(d3, 995_000, 0, null), 'VALIDATION_FAILED', 'reason');
          await fails(() => close(d3, 995_000, 0, '   '), 'VALIDATION_FAILED', 'reason');
          await fails(
            () => close(d3, 1_000_000, 1_000_001, null),
            'VALIDATION_FAILED',
            'withdrawalVnd',
          );
          await fails(() => close(d3, -5, 0, null), 'VALIDATION_FAILED', 'countedVnd');
          await fails(() => close(shopDay(1), 1_000_000, 0, null), 'VALIDATION_FAILED', 'date');
          const stale = new CashService(base.adapter, base.throttle, {
            ...base.environment,
            auth: { ...base.environment.auth, freshAuthSeconds: 0 },
          });
          await fails(
            () =>
              stale.closeDay(manager.token, fundA.id, {
                date: d3,
                countedVnd: '1000000',
                withdrawalVnd: '0',
                reason: null,
                clientRequestId: id(),
              }),
            'REAUTHENTICATION_REQUIRED',
          );
          assert.equal(await tx.cashDayClosing.count({ where: { fundId: fundA.id } }), 0);
          const done = await close(d3, 995_000, 0, 'Thiếu tiền lẻ khi trả khách');
          assert.equal(done.item.differenceVnd, '-5000');
          assert.equal(done.item.expectedVnd, '1000000');
          assert.equal(done.item.countedVnd, '995000');
          assert.equal(done.item.nextFloatVnd, '995000');
          assert.equal(done.item.alert, false);
          assert.equal(
            done.fund.balanceVnd,
            (
              995_000n +
              (
                await tx.fundEntry.aggregate({
                  where: { fundId: fundA.id, businessDate: { gt: new Date(d3) } },
                  _sum: { amountVnd: true },
                })
              )._sum.amountVnd!
            ).toString(),
          );
          const diff = await tx.fundEntry.findFirstOrThrow({
            where: { fundId: fundA.id, category: 'COUNT_DIFFERENCE' },
          });
          assert.equal(diff.direction, 'OUT');
          assert.equal(diff.amountVnd, 5000n);
          assert.equal(diff.sourceId, done.item.id);
          assert.equal(diff.businessDate.toISOString().slice(0, 10), d3);
          assert.equal(
            await tx.reauthUse.count({
              where: { purpose: 'CASH_CLOSING', subjectId: done.item.id },
            }),
            1,
          );
          // The same day, or an earlier one, cannot be closed again.
          await fails(() => close(d3, 995_000, 0, null), 'CASH_DAY_CLOSED');
          await fails(() => close(shopDay(-4), 995_000, 0, null), 'CASH_DAY_CLOSED');
        },
      );

      await suite.test(
        'an over count is a difference too; a big one raises the alert; the Owner takes money out',
        async () => {
          const d2 = await close(shopDay(-2), 1_055_000, 0, 'Khách để quên tiền thừa');
          assert.equal(d2.item.openingFloatVnd, '995000');
          assert.equal(d2.item.differenceVnd, '60000');
          assert.equal(d2.item.alert, true);
          const gain = await tx.fundEntry.findFirstOrThrow({ where: { sourceId: d2.item.id } });
          assert.equal(gain.direction, 'IN');
          assert.equal(gain.category, 'COUNT_DIFFERENCE');
          const d1 = await close(shopDay(-1), 1_055_000, 55_000, null);
          assert.equal(d1.item.differenceVnd, '0');
          assert.equal(d1.item.withdrawalVnd, '55000');
          assert.equal(d1.item.nextFloatVnd, '1000000');
          const withdrawal = await tx.fundEntry.findFirstOrThrow({
            where: { sourceId: d1.item.id },
          });
          assert.equal(withdrawal.category, 'OWNER_WITHDRAWAL');
          assert.equal(withdrawal.direction, 'OUT');
          assert.equal(withdrawal.amountVnd, 55_000n);
          assert.equal(
            await tx.fundEntry.count({
              where: { sourceId: d1.item.id, category: 'COUNT_DIFFERENCE' },
            }),
            0,
          );
          const overview = await cash.overview(base.ownerToken);
          assert.equal(overview.differenceAlerts, 1);
          assert.equal(overview.alertThresholdVnd, '50000');
        },
      );

      await suite.test(
        'today starts from the float; a closed day is locked and late money goes to the next day',
        async () => {
          const preview = await k.ok(() =>
            cash.previewClosing(manager.token, fundA.id, { date: today }),
          );
          assert.equal(preview.openingFloatVnd, '1000000');
          assert.equal(preview.lastClosedDate, shopDay(-1));
          const closed = await close(today, Number(preview.expectedVnd), 300_000, null);
          assert.equal(
            closed.item.nextFloatVnd,
            (BigInt(preview.expectedVnd) - 300_000n).toString(),
          );
          assert.equal(closed.item.differenceVnd, '0');
          assert.equal(closed.fund.balanceVnd, closed.item.nextFloatVnd);
          // The database refuses an entry on a closed day, whoever writes it.
          await tx.$executeRawUnsafe('SAVEPOINT locked');
          await assert.rejects(
            tx.fundEntry.create({
              data: {
                fundId: fundA.id,
                branchId: A.id,
                businessDate: new Date(today),
                direction: 'IN',
                category: 'TIP_IN',
                amountVnd: 1000n,
              },
            }),
            /The day is closed/,
          );
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT locked');
          // A sale found after the closing is dated the next open day, with its own time kept.
          const late = await cashSale(100_000, 1);
          await k
            .ok(() => cash.previewClosing(manager.token, fundA.id, { date: shopDay(1) }))
            .catch(() => undefined);
          const posted = await tx.fundEntry.findFirstOrThrow({
            where: { fundId: fundA.id, category: 'SALE_CASH', amountVnd: late },
            orderBy: { seq: 'desc' },
          });
          assert.equal(posted.businessDate.toISOString().slice(0, 10), shopDay(1));
          const payment = await tx.payment.findUniqueOrThrow({ where: { id: posted.sourceId! } });
          assert.equal(payment.businessDate.toISOString().slice(0, 10), today);
          assert.equal(posted.sourceOccurredAt?.getTime(), payment.collectedAt.getTime());
          // A manual entry does the same.
          const manual = await cash.record(manager.token, {
            fundId: fundA.id,
            kind: 'MANUAL_EXPENSE',
            amountVnd: '1000',
            reason: 'Sau chốt',
            clientRequestId: id(),
          });
          assert.equal(manual.item.businessDate, shopDay(1));
          // Today cannot be closed twice.
          await fails(() => close(today, 0, 0, 'x'), 'CASH_DAY_CLOSED');
        },
      );

      await suite.test(
        'a repeated closing is the same closing; a changed one is a conflict',
        async () => {
          const stale = await tx.cashDayClosing.findFirstOrThrow({
            where: { fundId: fundA.id, businessDate: new Date(today) },
          });
          const request = {
            date: today,
            countedVnd: stale.countedVnd.toString(),
            withdrawalVnd: stale.withdrawalVnd.toString(),
            reason: stale.reason,
            clientRequestId: stale.clientRequestId,
          };
          const again = await cash.closeDay(manager.token, fundA.id, request);
          assert.equal(again.item.id, stale.id);
          await fails(
            () =>
              cash.closeDay(manager.token, fundA.id, {
                ...request,
                countedVnd: (stale.countedVnd + 1n).toString(),
              }),
            'CONFLICT',
          );
          assert.equal(await tx.cashDayClosing.count({ where: { fundId: fundA.id } }), 4);
        },
      );

      await suite.test(
        'the history of closings: 20 a page, newest first, for those who may read',
        async () => {
          const list = await cash.closings(viewer.token, fundA.id, {});
          assert.equal(list.total, 4);
          assert.equal(list.pageSize, 20);
          assert.deepEqual(
            list.items.map((item) => item.businessDate),
            [today, shopDay(-1), shopDay(-2), shopDay(-3)],
          );
          assert.equal(list.fund.lastClosedDate, today);
          assert.equal(list.items.find((item) => item.businessDate === shopDay(-2))?.alert, true);
          assert.ok(list.items.every((item) => item.closedBy.id === manager.id));
          await fails(() => cash.closings(elsewhere.token, fundA.id, {}), 'FORBIDDEN');
          await fails(() => cash.closings(viewer.token, bank.id, {}), 'NOT_FOUND');
          await fails(
            () => cash.closings(viewer.token, fundA.id, { page: '0' }),
            'VALIDATION_FAILED',
          );
          const audit = await tx.auditEvent.findMany({ where: { action: 'CASH_DAY_CLOSED' } });
          assert.equal(audit.length, 4);
          assert.equal(audit[0]?.dataClassification, 'FINANCIAL');
        },
      );
    });
  },
);
