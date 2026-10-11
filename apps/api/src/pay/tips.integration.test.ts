import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { reconcileInvoiceEarnings } from '@lucy-spa/server';
import { MyIncomeService } from '../account/my-income.service.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { productSaleKit } from '../testing/product-sale-kit.js';
import { shopToday } from './pay.access.js';
import { PayService } from './pay.service.js';

/**
 * Phase 7 P7-10 against real PostgreSQL (design 6; P7-T7; Owner answer 5): a tip is a separate, immutable record for a KTV who served on
 * a PAID invoice, recorded by someone who may collect payments there; it enters the cash book (cash or bank) in the same transaction, never
 * touches the invoice or its payment, is reversed in full by a negative record, and nothing is written before go-live. Fixtures roll back.
 */
test(
  'Phase 7 P7-10 tips: record, book entry, replay, window, reversal, guards; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await productSaleKit(base);
      const { tx, fails } = base;
      const { A, people, exact } = k;
      const pay = new PayService(base.adapter, base.throttle, base.environment);
      const payroll = await base.staff([], { globalCodes: ['MANAGE_PAYROLL'] });
      const viewer = await base.staff(['VIEW_INVOICES'], { branchId: A.id });
      const collector = await base.staff(['COLLECT_PAYMENTS'], { branchId: A.id });
      const owner = await tx.user.findFirstOrThrow({ where: { kind: 'OWNER' } });
      const id = () => randomUUID();

      const serviceSale = async () => {
        const done = await k.finalize(await k.serviceDraft([exact]));
        const paid = await k.pay(done.id, Number(done.totalVnd));
        return { invoiceId: done.id, total: BigInt(done.totalVnd), paymentId: paid.payment.id };
      };
      const record = (token: string, invoiceId: string, over: Record<string, unknown> = {}) =>
        pay.recordTip(token, {
          invoiceId,
          employeeUserId: people.ktv.id,
          amountVnd: '50000',
          method: 'CASH',
          clientRequestId: id(),
          ...over,
        } as never);
      const bookNet = async (fundId: string) => {
        const sum = async (direction: 'IN' | 'OUT') =>
          (
            await tx.fundEntry.aggregate({
              where: { fundId, direction },
              _sum: { amountVnd: true },
            })
          )._sum.amountVnd ?? 0n;
        return (await sum('IN')) - (await sum('OUT'));
      };

      const early = await serviceSale();
      await suite.test('nothing is written before the Owner starts the cash book', async () => {
        await fails(() => record(collector.token, early.invoiceId), 'FINANCE_NOT_LIVE');
        assert.equal(await tx.tip.count(), 0);
        await tx.financeGoLive.create({
          data: { id: 1, at: new Date(), setByUserId: owner.id, reauthenticatedAt: new Date() },
        });
        await tx.cashFund.create({
          data: {
            kind: 'BANK',
            name: 'Ngân hàng',
            openingBalanceVnd: 0n,
            openingAt: new Date(),
            openingByUserId: owner.id,
          },
        });
      });

      await suite.test(
        'a tip is recorded for a KTV who served, enters the cash book, and leaves the invoice alone',
        async () => {
          const sale = await serviceSale();
          const before = await tx.invoice.findUniqueOrThrow({ where: { id: sale.invoiceId } });
          const view = await pay.invoiceTips(collector.token, sale.invoiceId);
          assert.equal(view.canRecord, true);
          assert.equal(view.blockedBy, null);
          assert.deepEqual(
            view.served.map((item) => [item.employee.id, item.netVnd]),
            [[people.ktv.id, '0']],
          );
          const request = id();
          const result = await record(collector.token, sale.invoiceId, {
            clientRequestId: request,
          });
          assert.equal(result.items.length, 1);
          assert.equal(result.items[0]?.amountVnd, '50000');
          assert.equal(result.items[0]?.method, 'CASH');
          assert.equal(result.items[0]?.canReverse, true);
          assert.equal(result.served[0]?.netVnd, '50000');
          const tip = await tx.tip.findFirstOrThrow({ where: { invoiceId: sale.invoiceId } });
          const entry = await tx.fundEntry.findUniqueOrThrow({ where: { id: tip.fundEntryId } });
          assert.equal(entry.category, 'TIP_IN');
          assert.equal(entry.direction, 'IN');
          assert.equal(entry.amountVnd, 50_000n);
          assert.equal(entry.sourceType, 'TIP');
          assert.equal(entry.sourceId, tip.id);
          const fund = await tx.cashFund.findUniqueOrThrow({ where: { id: entry.fundId } });
          assert.equal(fund.kind, 'CASH');
          assert.equal(fund.branchId, A.id);
          // The invoice and its payments are untouched: the tip is not revenue.
          const after = await tx.invoice.findUniqueOrThrow({ where: { id: sale.invoiceId } });
          assert.equal(after.totalVnd, before.totalVnd);
          assert.equal(after.status, 'PAID');
          // A repeat with the same request id is a replay; a different body with it is a conflict.
          const again = await record(collector.token, sale.invoiceId, { clientRequestId: request });
          assert.equal(again.items.length, 1);
          await fails(
            () =>
              record(collector.token, sale.invoiceId, {
                clientRequestId: request,
                amountVnd: '60000',
              }),
            'CONFLICT',
          );
          assert.equal(await tx.tip.count({ where: { invoiceId: sale.invoiceId } }), 1);
          // One tip per person per invoice at a time.
          await fails(() => record(collector.token, sale.invoiceId), 'TIP_EXISTS');
          const audit = await tx.auditEvent.findMany({
            where: { action: 'TIP_RECORDED', entityId: tip.id },
          });
          assert.equal(audit.length, 1);
          assert.equal(audit[0]?.dataClassification, 'FINANCIAL');
        },
      );

      await suite.test('a transfer tip enters the bank fund', async () => {
        const sale = await serviceSale();
        await record(collector.token, sale.invoiceId, { method: 'TRANSFER', amountVnd: '30000' });
        const tip = await tx.tip.findFirstOrThrow({ where: { invoiceId: sale.invoiceId } });
        const entry = await tx.fundEntry.findUniqueOrThrow({
          where: { id: tip.fundEntryId },
          include: { fund: true },
        });
        assert.equal(entry.fund.kind, 'BANK');
        assert.equal(entry.category, 'TIP_IN');
      });

      await suite.test('who may record, for whom, how much, and when', async () => {
        const sale = await serviceSale();
        for (const actor of [viewer, payroll])
          await fails(() => record(actor.token, sale.invoiceId), 'FORBIDDEN');
        // Reading needs a visible invoice; a viewer sees why they cannot record.
        const seen = await pay.invoiceTips(viewer.token, sale.invoiceId);
        assert.equal(seen.canRecord, false);
        assert.equal(seen.blockedBy, 'NO_PERMISSION');
        const stranger = await base.staff([], { branchId: A.id });
        await fails(() => pay.invoiceTips(stranger.token, sale.invoiceId), 'FORBIDDEN');
        await fails(() => record(collector.token, id()), 'NOT_FOUND');
        // Only a KTV who performed a service on the invoice.
        await fails(
          () => record(collector.token, sale.invoiceId, { employeeUserId: collector.id }),
          'VALIDATION_FAILED',
          'employeeUserId',
        );
        for (const amountVnd of ['0', '-5', '1.5', '', 'abc', '99999999999']) {
          await fails(
            () => record(collector.token, sale.invoiceId, { amountVnd }),
            'VALIDATION_FAILED',
          );
        }
        await fails(
          () => record(collector.token, sale.invoiceId, { method: 'CARD' }),
          'VALIDATION_FAILED',
          'method',
        );
        await fails(
          () => record(collector.token, sale.invoiceId, { extra: 1 }),
          'VALIDATION_FAILED',
        );
        assert.equal(await tx.tip.count({ where: { invoiceId: sale.invoiceId } }), 0);
        // Only after the invoice is PAID.
        const draft = await k.serviceDraft([exact]);
        await fails(() => record(collector.token, draft.id), 'CONFLICT');
        // A short window after payment.
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        await tx.$executeRawUnsafe(
          `UPDATE invoices SET created_at = created_at - interval '8 days', finalized_at = finalized_at - interval '8 days',
             paid_at = paid_at - interval '8 days' WHERE id = '${sale.invoiceId}'::uuid`,
        );
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = DEFAULT');
        await fails(() => record(collector.token, sale.invoiceId), 'TIP_WINDOW_CLOSED');
        const late = await pay.invoiceTips(collector.token, sale.invoiceId);
        assert.equal(late.blockedBy, 'WINDOW_CLOSED');
      });

      await suite.test(
        'a tip is reversed in full by a negative record and a reversing book entry',
        async () => {
          const sale = await serviceSale();
          await record(collector.token, sale.invoiceId);
          const tip = await tx.tip.findFirstOrThrow({ where: { invoiceId: sale.invoiceId } });
          const entry = await tx.fundEntry.findUniqueOrThrow({ where: { id: tip.fundEntryId } });
          const reverse = (token: string, over: Record<string, unknown> = {}) =>
            pay.reverseTip(token, tip.id, {
              reason: 'Ghi nhầm số tiền',
              clientRequestId: id(),
              ...over,
            } as never);
          for (const actor of [viewer, payroll])
            await fails(() => reverse(actor.token), 'FORBIDDEN');
          await fails(
            () => reverse(collector.token, { reason: '  ' }),
            'VALIDATION_FAILED',
            'reason',
          );
          await fails(
            () => pay.reverseTip(collector.token, id(), { reason: 'x', clientRequestId: id() }),
            'NOT_FOUND',
          );
          const before = await bookNet(entry.fundId);
          const request = id();
          const result = await reverse(collector.token, { clientRequestId: request });
          assert.equal(result.items.length, 2);
          assert.equal(result.items[1]?.amountVnd, '-50000');
          assert.equal(result.items[1]?.reversesId, tip.id);
          assert.equal(
            result.items.every((item) => !item.canReverse),
            true,
          );
          assert.equal(result.served[0]?.netVnd, '0');
          assert.equal((await bookNet(entry.fundId)) - before, -50_000n);
          const correction = await tx.fundEntry.findFirstOrThrow({
            where: { reversesEntryId: entry.id },
          });
          assert.equal(correction.category, 'CORRECTION');
          assert.equal(correction.direction, 'OUT');
          // Replay is safe; reversing twice is not.
          assert.equal(
            (await reverse(collector.token, { clientRequestId: request })).items.length,
            2,
          );
          await fails(() => reverse(collector.token), 'CONFLICT');
          // After a reversal the same person can be tipped again.
          const second = await record(collector.token, sale.invoiceId, { amountVnd: '70000' });
          assert.equal(second.served[0]?.netVnd, '70000');
          const audit = await tx.auditEvent.findMany({
            where: { action: 'TIP_REVERSED', entityId: tip.id },
          });
          assert.equal(audit.length, 1);
          assert.equal(audit[0]?.reason, 'Ghi nhầm số tiền');
        },
      );

      await suite.test(
        'a tip taken by a payroll run cannot be reversed; the database refuses edits, deletes and bad reversals',
        async () => {
          const sale = await serviceSale();
          await record(collector.token, sale.invoiceId);
          const tip = await tx.tip.findFirstOrThrow({ where: { invoiceId: sale.invoiceId } });
          const refuses = async (statement: string, pattern: RegExp) => {
            await tx.$executeRawUnsafe('SAVEPOINT guard');
            await assert.rejects(tx.$executeRawUnsafe(statement), pattern);
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT guard');
          };
          await refuses(
            `UPDATE tips SET amount_vnd = 1 WHERE id = '${tip.id}'::uuid`,
            /never changes/,
          );
          await refuses(`DELETE FROM tips WHERE id = '${tip.id}'::uuid`, /never deleted/);
          const insert = (amount: number, over: Record<string, string> = {}) =>
            `INSERT INTO tips (branch_id, invoice_id, employee_user_id, amount_vnd, method, business_date, reverses_id, reason, recorded_by_user_id, client_request_id, fund_entry_id)
           VALUES ('${tip.branchId}'::uuid, '${over['invoice'] ?? tip.invoiceId}'::uuid, '${tip.employeeUserId}'::uuid, ${amount}, '${over['method'] ?? tip.method}', '2026-10-12',
                   '${tip.id}'::uuid, 'x', '${tip.recordedByUserId}'::uuid, '${id()}'::uuid, '${tip.fundEntryId}'::uuid)`;
          await refuses(insert(-49_999), /in full/);
          await refuses(insert(-50_000, { method: 'TRANSFER' }), /in full/);
          await refuses(
            insert(-50_000, {
              invoice:
                sale.invoiceId === tip.invoiceId ? (await serviceSale()).invoiceId : tip.invoiceId,
            }),
            /in full/,
          );
          // A payroll run takes the tip (the run is a real row now: the column has a foreign key).
          const taking = await tx.payRun.create({
            data: { periodMonth: new Date('2019-03-01T00:00:00.000Z'), createdByUserId: owner.id },
            select: { id: true },
          });
          await tx.$executeRawUnsafe(
            `UPDATE tips SET run_id = '${taking.id}'::uuid WHERE id = '${tip.id}'::uuid`,
          );
          await refuses(
            `UPDATE tips SET run_id = '${taking.id}'::uuid WHERE id = '${tip.id}'::uuid`,
            /never changes/,
          );
          await fails(
            () =>
              pay.reverseTip(collector.token, tip.id, {
                reason: 'Muộn rồi',
                clientRequestId: id(),
              }),
            'TIP_CLAIMED',
          );
          const view = await pay.invoiceTips(collector.token, sale.invoiceId);
          assert.equal(view.items[0]?.claimed, true);
          assert.equal(view.items[0]?.canReverse, false);
        },
      );

      await suite.test(
        'My Income shows what was earned: tour and tips, net of a reversal',
        async () => {
          const today = shopToday(new Date());
          const income = new MyIncomeService(base.adapter, base.throttle);
          const read = async () => {
            const response = await income.get(people.ktv.token, { period: 'DAY', date: today });
            assert.ok(response.earnings, 'live: the sources are available');
            assert.deepEqual(response.unavailableSources, ['ADJUSTMENTS']);
            return response.earnings;
          };
          const before = await read();
          const rules = await base.staff([], { globalCodes: ['MANAGE_PAY_RULES'] });
          await pay.addTourRule(rules.token, {
            serviceId: exact.id,
            amountVnd: '15000',
            effectiveFrom: today,
            reason: null,
          });
          const sale = await serviceSale();
          await reconcileInvoiceEarnings(tx, sale.invoiceId);
          await record(collector.token, sale.invoiceId, { amountVnd: '40000' });
          const after = await read();
          assert.equal(BigInt(after.tourVnd) - BigInt(before.tourVnd), 15_000n);
          assert.equal(after.tourCount - before.tourCount, 1);
          assert.equal(BigInt(after.tipsVnd) - BigInt(before.tipsVnd), 40_000n);
          assert.equal(after.tipCount - before.tipCount, 1);
          assert.equal(after.commissionVnd, before.commissionVnd);
          // A reversed tip is taken off; a colleague sees none of it.
          const tip = await tx.tip.findFirstOrThrow({ where: { invoiceId: sale.invoiceId } });
          await pay.reverseTip(collector.token, tip.id, { reason: 'Nhầm', clientRequestId: id() });
          const undone = await read();
          assert.equal(undone.tipsVnd, before.tipsVnd);
          assert.equal(undone.tipCount, before.tipCount);
          const colleague = await income.get(people.cashier.token, { period: 'DAY', date: today });
          assert.equal(colleague.earnings?.tourVnd, '0');
        },
      );
    });
  },
);
