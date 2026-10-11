import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { CashService } from './cash.service.js';

/**
 * Phase 7 P7-2 against real PostgreSQL (design PHASE7_PAYROLL_FUNDS.md sections 7.1, 9, 14): the funds, who may see them, and the
 * Owner's one-time go-live with counted opening balances, a fresh password and no default date. Fixtures roll back.
 */
test(
  'Phase 7 P7-2 cash book: authority, go-live, opening balances, one use of a password confirmation, audit; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const { tx, fails } = base;
      const cash = new CashService(base.adapter, base.throttle, base.environment);
      const here = await base.branch('P7 A');
      const there = await base.branch('P7 B');
      const viewer = await base.staff(['VIEW_CASH'], { branchId: here.id });
      const manager = await base.staff(['MANAGE_CASH'], { branchId: here.id });
      const nobody = await base.staff(['VIEW_INVOICES'], { branchId: here.id });
      const active = await tx.branch.findMany({ where: { isActive: true }, select: { id: true } });
      const counts = (amount: string) => ({
        branches: active.map((branch) => ({ branchId: branch.id, countedVnd: amount })),
        bankVnd: '5000000',
      });

      await suite.test(
        'nothing is live and nobody sees funds before the Owner starts the book',
        async () => {
          await fails(() => cash.overview(nobody.token), 'FORBIDDEN');
          const owner = await cash.overview(base.ownerToken);
          assert.equal(owner.goLive, null);
          assert.equal(owner.canGoLive, true);
          assert.deepEqual(owner.funds, []);
          assert.equal(owner.defaultNextFloatVnd, '1000000');
          // A person with the permission at one branch sees that branch and cannot start the book.
          const seen = await cash.overview(viewer.token);
          assert.equal(seen.canGoLive, false);
          assert.deepEqual(
            seen.branches.filter((entry) => entry.view).map((entry) => entry.branch.id),
            [here.id],
          );
          assert.equal(
            (await cash.overview(manager.token)).branches.find((b) => b.manage)?.branch.id,
            here.id,
          );
          assert.equal(await tx.cashFund.count(), 0);
          assert.equal(await tx.financeGoLive.count(), 0);
        },
      );

      await suite.test(
        'go-live: authority, exact branch set, strict amounts, fresh password',
        async () => {
          await fails(() => cash.goLive(manager.token, counts('0')), 'FORBIDDEN');
          await fails(() => cash.goLive(viewer.token, counts('0')), 'FORBIDDEN');
          await fails(
            () =>
              cash.goLive(base.ownerToken, {
                branches: counts('0').branches.slice(1),
                bankVnd: '0',
              }),
            'CASH_OPENING_INVALID',
          );
          await fails(
            () =>
              cash.goLive(base.ownerToken, {
                branches: [...counts('0').branches, { branchId: there.id, countedVnd: '0' }],
                bankVnd: '0',
              }),
            'CASH_OPENING_INVALID',
          );
          for (const bad of ['-1', '1.5', '01', '1,000', '', ' 5', '1e3', '99999999999']) {
            await fails(() => cash.goLive(base.ownerToken, counts(bad)), 'VALIDATION_FAILED');
          }
          await fails(
            () => cash.goLive(base.ownerToken, { ...counts('0'), bankVnd: '-3' }),
            'VALIDATION_FAILED',
          );
          await fails(
            () => cash.goLive(base.ownerToken, { ...counts('0'), extra: 1 } as never),
            'VALIDATION_FAILED',
          );
          // A stale confirmation is refused (the same service with a zero-second window).
          const stale = new CashService(base.adapter, base.throttle, {
            ...base.environment,
            auth: { ...base.environment.auth, freshAuthSeconds: 0 },
          });
          await fails(
            () => stale.goLive(base.ownerToken, counts('0')),
            'REAUTHENTICATION_REQUIRED',
          );
          assert.equal(await tx.financeGoLive.count(), 0);
          assert.equal(await tx.cashFund.count(), 0);
        },
      );

      await suite.test(
        'go-live creates the funds with the counted balances, once, with audit',
        async () => {
          const result = await cash.goLive(base.ownerToken, counts('250000'));
          assert.ok(result.goLive);
          assert.equal(result.canGoLive, false);
          const cashFunds = result.funds.filter((fund) => fund.kind === 'CASH');
          const bank = result.funds.filter((fund) => fund.kind === 'BANK');
          assert.equal(cashFunds.length, active.length);
          assert.equal(bank.length, 1);
          for (const fund of cashFunds) {
            assert.equal(fund.openingBalanceVnd, '250000');
            assert.equal(fund.balanceVnd, '250000');
            assert.equal(fund.lastClosedDate, null);
          }
          assert.equal(bank[0]?.openingBalanceVnd, '5000000');
          assert.equal(bank[0]?.branch, null);
          const row = await tx.financeGoLive.findUniqueOrThrow({ where: { id: 1 } });
          assert.equal(row.at.toISOString(), result.goLive.at);
          const spent = await tx.reauthUse.findMany({ where: { purpose: 'FINANCE_GO_LIVE' } });
          assert.equal(spent.length, 1);
          assert.equal(spent[0]?.reauthenticatedAt.getTime(), row.reauthenticatedAt.getTime());
          const audit = await tx.auditEvent.findMany({ where: { action: 'FINANCE_GO_LIVE' } });
          assert.equal(audit.length, 1);
          assert.equal(audit[0]?.dataClassification, 'FINANCIAL');
          // Never again, and the same confirmation cannot start anything else.
          await fails(() => cash.goLive(base.ownerToken, counts('1')), 'FINANCE_ALREADY_LIVE');
          assert.equal(await tx.cashFund.count(), active.length + 1);
        },
      );

      await suite.test(
        'who sees which fund: the bank fund needs the permission at every branch',
        async () => {
          const seen = await cash.overview(viewer.token);
          assert.ok(seen.goLive);
          assert.deepEqual(
            seen.funds.map((fund) => [fund.kind, fund.branch?.id]),
            [['CASH', here.id]],
          );
          const owner = await cash.overview(base.ownerToken);
          assert.equal(owner.funds.filter((fund) => fund.kind === 'BANK').length, 1);
          // The balance is the opening balance plus the whole book.
          const fund = await tx.cashFund.findFirstOrThrow({ where: { branchId: here.id } });
          await tx.fundEntry.create({
            data: {
              fundId: fund.id,
              branchId: here.id,
              businessDate: new Date('2026-10-12'),
              direction: 'IN',
              category: 'TIP_IN',
              amountVnd: 40_000n,
            },
          });
          await tx.fundEntry.create({
            data: {
              fundId: fund.id,
              branchId: here.id,
              businessDate: new Date('2026-10-12'),
              direction: 'OUT',
              category: 'PRODUCT_REFUND',
              amountVnd: 15_000n,
            },
          });
          const after = await cash.overview(viewer.token);
          assert.equal(after.funds[0]?.balanceVnd, '275000');
        },
      );
    });
  },
);
