import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { confirmAgain } from '../testing/confirm-again.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { CashService } from './cash.service.js';

/**
 * Phase 7 P7-4 against real PostgreSQL (design PHASE7_PAYROLL_FUNDS.md 7.1, 7.2, 9): what a person writes into the book by hand and how
 * the book is read. Amount and reason are always required; a deposit is open to a collector, a withdrawal needs a fresh password; a cash
 * fund never goes below zero through a manual payment; a mistake is reversed once by a linked correction; a transfer is two linked
 * entries; replays are idempotent; every write is audited. Fixtures roll back.
 */
test(
  'Phase 7 P7-4 cash entries: authority, strict input, passwords, balance, reversal, transfer, idempotency, reading; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const { tx, fails } = base;
      const cash = new CashService(base.adapter, base.throttle, base.environment);
      const here = await base.branch('P7 E-A');
      const there = await base.branch('P7 E-B');
      const manager = await base.staff(['MANAGE_CASH'], { branchId: here.id });
      const viewer = await base.staff(['VIEW_CASH'], { branchId: here.id });
      const collector = await base.staff(['COLLECT_PAYMENTS'], { branchId: here.id });
      const elsewhere = await base.staff(['MANAGE_CASH'], { branchId: there.id });
      const nobody = await base.staff(['VIEW_INVOICES'], { branchId: here.id });
      const id = () => randomUUID();

      await suite.test('nothing can be written before the Owner starts the book', async () => {
        await fails(
          () =>
            cash.record(manager.token, {
              fundId: id(),
              kind: 'MANUAL_EXPENSE',
              amountVnd: '1000',
              reason: 'x',
              clientRequestId: id(),
            }),
          'FINANCE_NOT_LIVE',
        );
      });

      const active = await tx.branch.findMany({ where: { isActive: true }, select: { id: true } });
      await cash.goLive(base.ownerToken, {
        branches: active.map((branch) => ({ branchId: branch.id, countedVnd: '1000000' })),
        bankVnd: '3000000',
      });
      const fundA = await tx.cashFund.findFirstOrThrow({
        where: { branchId: here.id, kind: 'CASH' },
      });
      const fundB = await tx.cashFund.findFirstOrThrow({
        where: { branchId: there.id, kind: 'CASH' },
      });
      const bank = await tx.cashFund.findFirstOrThrow({ where: { kind: 'BANK' } });
      const record = (
        token: string,
        patch: Record<string, unknown> = {},
        fund = fundA,
      ): ReturnType<CashService['record']> =>
        cash.record(token, {
          fundId: fund.id,
          kind: 'MANUAL_EXPENSE',
          amountVnd: '50000',
          reason: 'Mua nước và khăn',
          clientRequestId: id(),
          ...patch,
        } as never);
      const balance = async (fundId: string) =>
        (await cash.entries(base.ownerToken, fundId, {})).fund.balanceVnd;

      await suite.test('money out and in: strict input, authority, audit', async () => {
        const spent = await record(manager.token);
        assert.equal(spent.item.direction, 'OUT');
        assert.equal(spent.item.category, 'MANUAL_EXPENSE');
        assert.equal(spent.item.amountVnd, '50000');
        assert.equal(spent.item.reason, 'Mua nước và khăn');
        assert.equal(spent.item.actor?.id, manager.id);
        assert.equal(await balance(fundA.id), '950000');
        const taken = await record(manager.token, {
          kind: 'MANUAL_INCOME',
          amountVnd: '20000',
          reason: 'Khách gửi tiền lẻ',
        });
        assert.equal(taken.item.direction, 'IN');
        assert.equal(await balance(fundA.id), '970000');
        const audit = await tx.auditEvent.findMany({
          where: { action: 'CASH_ENTRY_RECORDED', entityId: spent.item.id },
        });
        assert.equal(audit.length, 1);
        assert.equal(audit[0]?.dataClassification, 'FINANCIAL');
        assert.equal(audit[0]?.branchId, here.id);
        // Amount and reason are always required, exactly.
        for (const bad of ['0', '-5', '1.5', '01', '1,000', '', ' 5', '99999999999']) {
          await fails(
            () => record(manager.token, { amountVnd: bad }),
            'VALIDATION_FAILED',
            'amountVnd',
          );
        }
        for (const bad of ['', '   ', undefined]) {
          await fails(() => record(manager.token, { reason: bad }), 'VALIDATION_FAILED', 'reason');
        }
        await fails(
          () => record(manager.token, { reason: 'x'.repeat(501) }),
          'VALIDATION_FAILED',
          'reason',
        );
        await fails(
          () => record(manager.token, { kind: 'SALE_CASH' }),
          'VALIDATION_FAILED',
          'kind',
        );
        await fails(() => record(manager.token, { extra: 1 }), 'VALIDATION_FAILED');
        // Authority: a viewer, someone at another branch and an unrelated person write nothing.
        for (const actor of [viewer, elsewhere, nobody]) {
          await fails(() => record(actor.token), 'FORBIDDEN');
        }
        assert.equal(await balance(fundA.id), '970000');
      });

      await suite.test(
        'a deposit is open to a collector; a collector cannot withdraw or spend',
        async () => {
          const deposit = await record(collector.token, {
            kind: 'DEPOSIT',
            amountVnd: '30000',
            reason: 'Nộp tiền thu cuối ca',
          });
          assert.equal(deposit.item.direction, 'IN');
          assert.equal(deposit.item.category, 'DEPOSIT');
          await fails(() => record(collector.token, { kind: 'MANUAL_EXPENSE' }), 'FORBIDDEN');
          await fails(() => record(collector.token, { kind: 'OWNER_WITHDRAWAL' }), 'FORBIDDEN');
          await fails(() => record(collector.token, { kind: 'MANUAL_INCOME' }), 'FORBIDDEN');
          await fails(() => record(elsewhere.token, { kind: 'DEPOSIT' }), 'FORBIDDEN');
          // A deposit goes to a cash fund, never to the bank.
          await fails(
            () => record(base.ownerToken, { kind: 'DEPOSIT', branchId: here.id }, bank),
            'VALIDATION_FAILED',
          );
          assert.equal(await balance(fundA.id), '1000000');
        },
      );

      await suite.test('an Owner withdrawal needs a fresh password, spent once', async () => {
        const stale = new CashService(base.adapter, base.throttle, {
          ...base.environment,
          auth: { ...base.environment.auth, freshAuthSeconds: 0 },
        });
        await fails(
          () =>
            stale.record(manager.token, {
              fundId: fundA.id,
              kind: 'OWNER_WITHDRAWAL',
              amountVnd: '100000',
              reason: 'Chủ rút',
              clientRequestId: id(),
            }),
          'REAUTHENTICATION_REQUIRED',
        );
        assert.equal(await balance(fundA.id), '1000000');
        await confirmAgain(base, manager.token);
        const taken = await record(manager.token, {
          kind: 'OWNER_WITHDRAWAL',
          amountVnd: '100000',
          reason: 'Chủ rút cuối ngày',
        });
        assert.equal(taken.item.direction, 'OUT');
        assert.equal(await balance(fundA.id), '900000');
        const spent = await tx.reauthUse.findMany({ where: { purpose: 'CASH_WITHDRAWAL' } });
        assert.equal(spent.length, 1);
        // The same confirmation does not cover a second withdrawal.
        await fails(
          () =>
            record(manager.token, {
              kind: 'OWNER_WITHDRAWAL',
              amountVnd: '1000',
              reason: 'Lần hai',
            }),
          'REAUTHENTICATION_REQUIRED',
        );
        assert.equal(await balance(fundA.id), '900000');
      });

      await suite.test('a cash fund never goes below zero through a manual payment', async () => {
        await fails(() => record(manager.token, { amountVnd: '900001' }), 'CASH_INSUFFICIENT');
        await record(manager.token, { amountVnd: '900000', reason: 'Chi hết quỹ' });
        assert.equal(await balance(fundA.id), '0');
        await fails(() => record(manager.token, { amountVnd: '1' }), 'CASH_INSUFFICIENT');
        await record(manager.token, {
          kind: 'MANUAL_INCOME',
          amountVnd: '1000000',
          reason: 'Bù quỹ',
        });
        assert.equal(await balance(fundA.id), '1000000');
      });

      await suite.test(
        'a repeated request is the same entry; a changed one is a conflict',
        async () => {
          const clientRequestId = id();
          const first = await record(manager.token, {
            clientRequestId,
            amountVnd: '12000',
            reason: 'Gửi xe',
          });
          const again = await record(manager.token, {
            clientRequestId,
            amountVnd: '12000',
            reason: 'Gửi xe',
          });
          assert.equal(again.item.id, first.item.id);
          assert.equal(await tx.fundEntry.count({ where: { clientRequestId } }), 1);
          await fails(
            () => record(manager.token, { clientRequestId, amountVnd: '13000', reason: 'Gửi xe' }),
            'CONFLICT',
          );
          await fails(
            () => record(manager.token, { clientRequestId, amountVnd: '12000', reason: 'Khác' }),
            'CONFLICT',
          );
          assert.equal(await balance(fundA.id), '988000');
        },
      );

      await suite.test(
        'the shared bank fund needs the permission at every branch and a branch for the entry',
        async () => {
          await fails(() => record(manager.token, { branchId: here.id }, bank), 'FORBIDDEN');
          await fails(() => record(base.ownerToken, {}, bank), 'VALIDATION_FAILED', 'branchId');
          await fails(
            () => record(base.ownerToken, { branchId: id() }, bank),
            'VALIDATION_FAILED',
            'branchId',
          );
          await fails(
            () => record(base.ownerToken, { branchId: there.id }, fundA),
            'VALIDATION_FAILED',
            'branchId',
          );
          const income = await record(
            base.ownerToken,
            {
              kind: 'MANUAL_INCOME',
              amountVnd: '500000',
              reason: 'Lãi ngân hàng',
              branchId: here.id,
            },
            bank,
          );
          assert.equal(income.item.direction, 'IN');
          assert.equal(await balance(bank.id), '3500000');
          const row = await tx.fundEntry.findUniqueOrThrow({ where: { id: income.item.id } });
          assert.equal(row.branchId, here.id);
          await fails(() => cash.entries(manager.token, bank.id, {}), 'FORBIDDEN');
        },
      );

      await suite.test(
        'a mistake is reversed once by a linked correction; posted entries are not reversible',
        async () => {
          const wrong = await record(manager.token, { amountVnd: '40000', reason: 'Nhập nhầm' });
          const fixed = await cash.reverse(manager.token, wrong.item.id, {
            reason: 'Nhập nhầm số',
            clientRequestId: id(),
          });
          assert.equal(fixed.item.category, 'CORRECTION');
          assert.equal(fixed.item.direction, 'IN');
          assert.equal(fixed.item.amountVnd, '40000');
          assert.equal(fixed.item.reversesEntryId, wrong.item.id);
          assert.equal(await balance(fundA.id), '988000');
          await fails(
            () =>
              cash.reverse(manager.token, wrong.item.id, {
                reason: 'Lần hai',
                clientRequestId: id(),
              }),
            'CASH_ENTRY_NOT_REVERSIBLE',
          );
          await fails(
            () =>
              cash.reverse(manager.token, fixed.item.id, {
                reason: 'Hoàn tác',
                clientRequestId: id(),
              }),
            'CASH_ENTRY_NOT_REVERSIBLE',
          );
          await fails(
            () =>
              cash.reverse(elsewhere.token, wrong.item.id, { reason: 'x', clientRequestId: id() }),
            'FORBIDDEN',
          );
          await fails(
            () => cash.reverse(viewer.token, wrong.item.id, { reason: 'x', clientRequestId: id() }),
            'FORBIDDEN',
          );
          await fails(
            () =>
              cash.reverse(manager.token, wrong.item.id, { reason: ' ', clientRequestId: id() }),
            'VALIDATION_FAILED',
            'reason',
          );
          // A posted entry (here a sale) follows its source and cannot be reversed by hand.
          const sale = await tx.fundEntry.create({
            data: {
              fundId: fundA.id,
              branchId: here.id,
              businessDate: new Date(),
              direction: 'IN',
              category: 'SALE_CASH',
              amountVnd: 10_000n,
              sourceType: 'PAYMENT',
              sourceId: id(),
            },
          });
          await fails(
            () => cash.reverse(manager.token, sale.id, { reason: 'x', clientRequestId: id() }),
            'CASH_ENTRY_NOT_REVERSIBLE',
          );
          // Reversing money in cannot take the drawer below zero.
          await record(manager.token, { amountVnd: '980000', reason: 'Chi lớn' });
          const small = await record(manager.token, {
            kind: 'MANUAL_INCOME',
            amountVnd: '15000',
            reason: 'Thu lẻ',
          });
          await record(manager.token, { amountVnd: '25000', reason: 'Chi khác' });
          await fails(
            () =>
              cash.reverse(manager.token, small.item.id, { reason: 'Nhầm', clientRequestId: id() }),
            'CASH_INSUFFICIENT',
          );
          const audit = await tx.auditEvent.findMany({ where: { action: 'CASH_ENTRY_REVERSED' } });
          assert.equal(audit.length, 1);
        },
      );

      await suite.test(
        'a transfer is two linked entries, with a fresh password, on funds the person manages',
        async () => {
          await record(manager.token, {
            kind: 'MANUAL_INCOME',
            amountVnd: '200000',
            reason: 'Bù quỹ để chuyển',
          });
          const balances = async () => [await balance(fundA.id), await balance(bank.id)];
          const [cashBefore, bankBefore] = await balances();
          await fails(
            () =>
              cash.transfer(manager.token, {
                fromFundId: fundA.id,
                toFundId: bank.id,
                amountVnd: '1000',
                reason: 'Nộp ngân hàng',
                clientRequestId: id(),
              }),
            'FORBIDDEN',
          );
          await fails(
            () =>
              cash.transfer(base.ownerToken, {
                fromFundId: fundA.id,
                toFundId: fundA.id,
                amountVnd: '1000',
                reason: 'x',
                clientRequestId: id(),
              }),
            'VALIDATION_FAILED',
          );
          const stale = new CashService(base.adapter, base.throttle, {
            ...base.environment,
            auth: { ...base.environment.auth, freshAuthSeconds: 0 },
          });
          await fails(
            () =>
              stale.transfer(base.ownerToken, {
                fromFundId: fundA.id,
                toFundId: bank.id,
                amountVnd: '1000',
                reason: 'x',
                clientRequestId: id(),
              }),
            'REAUTHENTICATION_REQUIRED',
          );
          await confirmAgain(base, base.ownerToken);
          const requestId = id();
          const body = {
            fromFundId: fundA.id,
            toFundId: bank.id,
            amountVnd: '5000',
            reason: 'Nộp tiền mặt vào ngân hàng',
            clientRequestId: requestId,
          };
          const done = await cash.transfer(base.ownerToken, body);
          assert.equal(done.items.length, 2);
          assert.deepEqual(
            done.items.map((item) => [item.direction, item.category]),
            [
              ['OUT', 'FUND_TRANSFER'],
              ['IN', 'FUND_TRANSFER'],
            ],
          );
          const rows = await tx.fundEntry.findMany({
            where: { id: { in: done.items.map((item) => item.id) } },
            orderBy: { sourceLeg: 'asc' },
          });
          assert.equal(rows[0]?.sourceId, rows[1]?.sourceId);
          assert.deepEqual(await balances(), [
            (BigInt(cashBefore!) - 5000n).toString(),
            (BigInt(bankBefore!) + 5000n).toString(),
          ]);
          // A replay returns the same two entries; nothing moves twice.
          const replay = await cash.transfer(base.ownerToken, body);
          assert.deepEqual(
            replay.items.map((item) => item.id),
            done.items.map((item) => item.id),
          );
          await fails(
            () => cash.transfer(base.ownerToken, { ...body, amountVnd: '6000' }),
            'CONFLICT',
          );
          // The cash side cannot give more than it holds.
          await confirmAgain(base, base.ownerToken);
          await fails(
            () =>
              cash.transfer(base.ownerToken, {
                fromFundId: fundA.id,
                toFundId: bank.id,
                amountVnd: '99999999',
                reason: 'Quá số dư',
                clientRequestId: id(),
              }),
            'CASH_INSUFFICIENT',
          );
          assert.deepEqual((await balances()).map(String), [
            (BigInt(cashBefore!) - 5000n).toString(),
            (BigInt(bankBefore!) + 5000n).toString(),
          ]);
          const audit = await tx.auditEvent.findMany({ where: { action: 'CASH_TRANSFER' } });
          assert.equal(audit.length, 1);
          void fundB;
        },
      );

      await suite.test(
        'reading the book: 20 a page, newest day first, filters and totals, access',
        async () => {
          for (let index = 0; index < 25; index += 1) {
            await tx.fundEntry.create({
              data: {
                fundId: fundB.id,
                branchId: there.id,
                businessDate: new Date(`2026-11-${String((index % 20) + 1).padStart(2, '0')}`),
                direction: index % 2 === 0 ? 'IN' : 'OUT',
                category: index % 2 === 0 ? 'TIP_IN' : 'SALARY_PAYOUT',
                amountVnd: BigInt(1000 * (index + 1)),
              },
            });
          }
          const first = await cash.entries(elsewhere.token, fundB.id, {});
          assert.equal(first.page, 1);
          assert.equal(first.pageSize, 20);
          assert.equal(first.total, 25);
          assert.equal(first.items.length, 20);
          const second = await cash.entries(elsewhere.token, fundB.id, { page: '2' });
          assert.equal(second.items.length, 5);
          const dates = [...first.items, ...second.items].map((item) => item.businessDate);
          assert.deepEqual([...dates].sort().reverse(), dates);
          const incoming = await cash.entries(elsewhere.token, fundB.id, { direction: 'IN' });
          assert.equal(incoming.total, 13);
          assert.equal(incoming.outVnd, '0');
          const tips = await cash.entries(elsewhere.token, fundB.id, {
            category: 'TIP_IN',
            from: '2026-11-05',
            to: '2026-11-10',
          });
          assert.ok(
            tips.items.every(
              (item) =>
                item.category === 'TIP_IN' &&
                item.businessDate >= '2026-11-05' &&
                item.businessDate <= '2026-11-10',
            ),
          );
          assert.equal(first.can.record, true);
          const viewed = await cash.entries(viewer.token, fundA.id, {});
          assert.deepEqual(viewed.can, { record: false, deposit: false, transfer: false });
          assert.ok(viewed.items.every((item) => item.canReverse === false));
          for (const bad of [
            { page: '0' },
            { page: 'x' },
            { from: '2026-13-01' },
            { category: 'NOPE' },
            { direction: 'SIDEWAYS' },
            { from: '2026-02-01', to: '2026-01-01' },
          ]) {
            await fails(() => cash.entries(manager.token, fundA.id, bad), 'VALIDATION_FAILED');
          }
          await fails(() => cash.entries(nobody.token, fundA.id, {}), 'FORBIDDEN');
          await fails(() => cash.entries(elsewhere.token, fundA.id, {}), 'FORBIDDEN');
          await fails(() => cash.entries(manager.token, id(), {}), 'NOT_FOUND');
          await fails(() => cash.entries(manager.token, 'not-a-uuid', {}), 'VALIDATION_FAILED');
          const own = await cash.entries(manager.token, fundA.id, {});
          assert.ok(own.items.some((item) => item.canReverse));
        },
      );
    });
  },
);
