import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ensureCashFund } from '@lucy-spa/server';
import { confirmAgain } from '../testing/confirm-again.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { productSaleKit } from '../testing/product-sale-kit.js';
import { settleRecoveries } from './pay-advances.core.js';
import { shopToday } from './pay.access.js';
import { PayService } from './pay.service.js';

/**
 * Phase 7 P7-13 against real PostgreSQL (design 4.4; OQ-110; P7-T12): salary advances. Only an official employee with a confirmed salary,
 * at most half of it, one open advance each; approved by APPROVE_PAYROLL; paid with a fresh password out of a fund that holds the money
 * (the outflow is written in the same transaction); recovered by the payroll draft without ever making the net negative; written off with
 * a reason and a fresh password; nothing is deleted or moved backwards. Fixtures roll back.
 */
test(
  'Phase 7 P7-13 salary advances: request, approve, pay, recover, write off, guards; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await productSaleKit(base);
      const { tx, fails } = base;
      const { A, people } = k;
      const pay = new PayService(base.adapter, base.throttle, base.environment);
      const today = shopToday(new Date());
      const month = today.slice(0, 7);
      const payroll = await base.staff([], { globalCodes: ['MANAGE_PAYROLL'] });
      const approver = await base.staff([], { globalCodes: ['APPROVE_PAYROLL'] });
      const nobody = await base.staff(['VIEW_INVOICES'], { branchId: A.id });
      const owner = await tx.user.findFirstOrThrow({ where: { kind: 'OWNER' } });
      const worker = people.cashier;
      const other = people.ktv;
      const id = () => randomUUID();
      const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
      const salary = (employeeUserId: string, amountVnd: bigint) =>
        tx.employeeSalaryVersion.create({
          data: {
            employeeUserId,
            amountVnd,
            effectiveFrom: asDate(today),
            recordedByUserId: owner.id,
          },
        });
      const request = (
        amountVnd: string,
        over: Record<string, unknown> = {},
        token = payroll.token,
      ) =>
        pay.requestAdvance(token, {
          employeeUserId: worker.id,
          amountVnd,
          reason: 'Gia đình có việc gấp',
          clientRequestId: id(),
          ...over,
        } as never);
      const itemOf = (view: Awaited<ReturnType<typeof pay.advances>>, advanceId: string) =>
        view.items.find((entry) => entry.id === advanceId)!;
      const latest = async () => tx.salaryAdvance.findFirstOrThrow({ orderBy: { seq: 'desc' } });

      await suite.test('nothing before go-live; who may read and request', async () => {
        await fails(() => request('1000000'), 'FINANCE_NOT_LIVE');
        await tx.financeGoLive.create({
          data: { id: 1, at: new Date(), setByUserId: owner.id, reauthenticatedAt: new Date() },
        });
        await fails(() => pay.advances(nobody.token), 'FORBIDDEN');
        const empty = await pay.advances(payroll.token);
        assert.deepEqual(
          [empty.items, empty.canRequest, empty.canApprove, empty.funds],
          [[], true, false, []],
        );
        assert.equal((await pay.advances(approver.token)).canApprove, true);
        await fails(() => request('1000000', {}, approver.token), 'FORBIDDEN');
        await fails(() => request('1000000', {}, nobody.token), 'FORBIDDEN');
      });

      await suite.test(
        'only an official employee with a confirmed salary, at most half of it, one open advance',
        async () => {
          // No confirmed salary yet: not eligible, never guessed from the profile.
          await fails(() => request('1000000'), 'ADVANCE_NOT_ELIGIBLE');
          await salary(worker.id, 9_000_000n);
          const listed = await pay.advances(payroll.token);
          assert.deepEqual(
            listed.eligible.map((entry) => [entry.employee.id, entry.limitVnd]),
            [[worker.id, '4500000']],
          );
          await fails(() => request('4500001'), 'ADVANCE_LIMIT');
          await fails(() => request('0'), 'VALIDATION_FAILED', 'amountVnd');
          await fails(() => request('-5'), 'VALIDATION_FAILED', 'amountVnd');
          await fails(() => request('1000000', { reason: '  ' }), 'VALIDATION_FAILED', 'reason');
          await fails(
            () => request('1000000', { employeeUserId: 'x' }),
            'VALIDATION_FAILED',
            'employeeUserId',
          );
          await fails(() => request('1000000', { extra: 1 }), 'VALIDATION_FAILED');
          await fails(
            () => request('1000000', { employeeUserId: other.id }),
            'ADVANCE_NOT_ELIGIBLE',
          );
          const clientRequestId = id();
          const first = await request('3000000', { clientRequestId });
          assert.equal(first.items[0]?.status, 'REQUESTED');
          assert.equal(first.items[0]?.amountVnd, '3000000');
          assert.equal(first.items[0]?.outstandingVnd, '0', 'nothing is owed before it is paid');
          assert.equal(first.eligible.length, 0, 'one open advance each');
          assert.equal(
            (await request('3000000', { clientRequestId })).items.length,
            1,
            'a retry is not a second request',
          );
          await fails(() => request('2000000', { clientRequestId }), 'CONFLICT');
          await fails(() => request('1000000'), 'ADVANCE_OPEN_EXISTS');
          const audit = await tx.auditEvent.findMany({ where: { action: 'ADVANCE_REQUESTED' } });
          assert.equal(audit.length, 1);
          assert.equal(audit[0]?.dataClassification, 'EMPLOYEE_PAY');
        },
      );

      await suite.test(
        'approve and cancel: the right permission and the version the person saw',
        async () => {
          const advance = await latest();
          await fails(
            () =>
              pay.approveAdvance(payroll.token, advance.id, {
                expectedVersion: advance.rowVersion,
              }),
            'FORBIDDEN',
          );
          await fails(
            () =>
              pay.approveAdvance(approver.token, advance.id, {
                expectedVersion: advance.rowVersion + 1,
              }),
            'CONFLICT',
          );
          await fails(
            () => pay.approveAdvance(approver.token, id(), { expectedVersion: 1 }),
            'NOT_FOUND',
          );
          await fails(
            () =>
              pay.cancelAdvance(nobody.token, advance.id, {
                expectedVersion: advance.rowVersion,
                reason: 'x',
              }),
            'FORBIDDEN',
          );
          await fails(
            () =>
              pay.cancelAdvance(payroll.token, advance.id, {
                expectedVersion: advance.rowVersion,
                reason: ' ',
              }),
            'VALIDATION_FAILED',
            'reason',
          );
          // A request nobody wants is cancelled, with a reason, and the person can be asked for again.
          const cancelled = await pay.cancelAdvance(payroll.token, advance.id, {
            expectedVersion: advance.rowVersion,
            reason: 'Người đó xin hủy',
          });
          assert.equal(itemOf(cancelled, advance.id).status, 'CANCELLED');
          assert.equal(itemOf(cancelled, advance.id).cancelReason, 'Người đó xin hủy');
          await fails(
            () =>
              pay.approveAdvance(approver.token, advance.id, {
                expectedVersion: advance.rowVersion + 1,
              }),
            'CONFLICT',
          );
          await request('4000000');
          const second = await latest();
          const approved = await pay.approveAdvance(approver.token, second.id, {
            expectedVersion: second.rowVersion,
          });
          assert.equal(itemOf(approved, second.id).status, 'APPROVED');
          assert.equal(itemOf(approved, second.id).approvedBy?.id, approver.id);
          await fails(
            () =>
              pay.approveAdvance(approver.token, second.id, {
                expectedVersion: second.rowVersion + 1,
              }),
            'CONFLICT',
          );
          assert.equal(
            await tx.fundEntry.count({ where: { category: 'ADVANCE' } }),
            0,
            'approving pays nothing',
          );
        },
      );

      let advanceId = '';
      await suite.test(
        'paying needs a fresh password, a fund that holds the money, and writes the outflow once',
        async () => {
          const approved = await latest();
          advanceId = approved.id;
          const cash = await ensureCashFund(tx, A.id);
          assert.ok(cash);
          const pays = (token: string, over: Record<string, unknown> = {}) =>
            pay.payAdvance(token, approved.id, {
              expectedVersion: approved.rowVersion + 0,
              fundId: cash!,
              clientRequestId: id(),
              ...over,
            } as never);
          await fails(() => pays(payroll.token), 'FORBIDDEN');
          await fails(() => pays(approver.token, { fundId: id() }), 'VALIDATION_FAILED', 'fundId');
          await confirmAgain(base, approver.token);
          await fails(() => pays(approver.token, { expectedVersion: 99 }), 'CONFLICT');
          await confirmAgain(base, approver.token);
          // The drawer is empty: it cannot give what it does not hold.
          await fails(() => pays(approver.token), 'CASH_INSUFFICIENT');
          await tx.fundEntry.create({
            data: {
              fundId: cash!,
              branchId: A.id,
              businessDate: asDate(today),
              direction: 'IN',
              category: 'MANUAL_INCOME',
              amountVnd: 10_000_000n,
              reason: 'Vốn đầu kỳ',
              actorUserId: owner.id,
            },
          });
          await confirmAgain(base, approver.token);
          const clientRequestId = id();
          const paid = await pays(approver.token, { clientRequestId });
          assert.equal(itemOf(paid, approved.id).status, 'PAID');
          assert.equal(itemOf(paid, approved.id).outstandingVnd, '4000000');
          assert.equal(itemOf(paid, approved.id).paidBy?.id, approver.id);
          assert.equal(itemOf(paid, approved.id).paidFund?.id, cash);
          const entry = await tx.fundEntry.findFirstOrThrow({ where: { category: 'ADVANCE' } });
          assert.equal(entry.direction, 'OUT');
          assert.equal(entry.amountVnd, 4_000_000n);
          assert.equal(entry.sourceType, 'SALARY_ADVANCE');
          assert.equal(entry.sourceId, approved.id);
          assert.equal(
            (await tx.salaryAdvance.findUniqueOrThrow({ where: { id: approved.id } })).paidEntryId,
            entry.id,
          );
          // The same request again is a replay (no second outflow); a second payment needs a new confirmation and the right state.
          assert.equal(
            itemOf(await pays(approver.token, { clientRequestId }), approved.id).status,
            'PAID',
          );
          await fails(() => pays(approver.token), 'REAUTHENTICATION_REQUIRED');
          await confirmAgain(base, approver.token);
          await fails(
            () => pays(approver.token, { expectedVersion: approved.rowVersion + 1 }),
            'CONFLICT',
          );
          assert.equal(await tx.fundEntry.count({ where: { category: 'ADVANCE' } }), 1);
          const listed = await pay.advances(approver.token);
          assert.equal(listed.funds.find((fund) => fund.id === cash)?.balanceVnd, '6000000');
          const audit = await tx.auditEvent.findMany({
            where: { action: 'ADVANCE_PAID', entityId: approved.id },
          });
          assert.equal(audit[0]?.dataClassification, 'FINANCIAL');
        },
      );

      await suite.test(
        'the payroll draft takes it back, never more than the net pay, and a closed run settles it',
        async () => {
          const run = await pay.createPayRun(payroll.token, { month });
          const mine = run.lines.find((entry) => entry.employee.id === worker.id)!;
          const recovery = mine.items.find((entry) => entry.kind === 'ADVANCE_RECOVERY')!;
          // Base 9,000,000 is the whole net; 4,000,000 is owed: the recovery is the whole debt.
          assert.equal(recovery.amountVnd, '-4000000');
          assert.equal(recovery.advanceId, advanceId);
          assert.equal(mine.netVnd, '5000000');
          // A big deduction leaves less than the debt available: the recovery shrinks and the rest stays owed.
          const big = await pay.addPayRunItem(payroll.token, run.run.id, {
            employeeUserId: worker.id,
            kind: 'DEDUCTION',
            amountVnd: '7000000',
            reason: 'Bồi thường',
            clientRequestId: id(),
          });
          assert.equal(big.stale, true, 'the suggestion follows the manual items once refreshed');
          const refreshed = await pay.refreshPayRun(payroll.token, run.run.id, {
            expectedVersion: big.run.version,
          });
          const shrunk = refreshed.lines.find((entry) => entry.employee.id === worker.id)!;
          assert.equal(
            shrunk.items.find((entry) => entry.kind === 'ADVANCE_RECOVERY')?.amountVnd,
            '-2000000',
          );
          assert.equal(shrunk.netVnd, '0');
          assert.equal(
            shrunk.warnings.includes('NEGATIVE_NET'),
            false,
            'a recovery never makes the net negative',
          );
          // While the run is a draft nothing has been taken back yet.
          assert.equal(itemOf(await pay.advances(approver.token), advanceId).recoveredVnd, '0');
          // Void the deduction, refresh: the whole debt is suggested again; close the run (P7-14 does it with the Owner's password).
          const deduction = shrunk.items.find((entry) => entry.kind === 'DEDUCTION')!;
          const voided = await pay.voidPayRunItem(payroll.token, run.run.id, deduction.id, {
            expectedVersion: refreshed.run.version,
            reason: 'Hủy khoản phạt',
          });
          const again = await pay.refreshPayRun(payroll.token, run.run.id, {
            expectedVersion: voided.run.version,
          });
          assert.equal(
            again.lines
              .find((entry) => entry.employee.id === worker.id)
              ?.items.find((entry) => entry.kind === 'ADVANCE_RECOVERY')?.amountVnd,
            '-4000000',
          );
          await tx.$executeRawUnsafe(
            `UPDATE pay_runs SET payment_day = '${today}', row_version = row_version + 1 WHERE id = '${run.run.id}'::uuid`,
          );
          await tx.$executeRawUnsafe(
            `UPDATE pay_runs SET status = 'CLOSED', closed_at = now(), closed_by_user_id = '${owner.id}'::uuid, row_version = row_version + 1 WHERE id = '${run.run.id}'::uuid`,
          );
          const closed = await pay.advances(approver.token);
          assert.equal(itemOf(closed, advanceId).recoveredVnd, '4000000');
          assert.equal(itemOf(closed, advanceId).outstandingVnd, '0');
          assert.equal(await settleRecoveries(tx, new Date()), 1);
          assert.equal(itemOf(await pay.advances(approver.token), advanceId).status, 'RECOVERED');
          assert.equal(await settleRecoveries(tx, new Date()), 0);
          // The person can have a new advance now.
          assert.equal(
            (await pay.advances(payroll.token)).eligible.some(
              (entry) => entry.employee.id === worker.id,
            ),
            true,
          );
        },
      );

      await suite.test(
        'writing off what is still owed: a reason, a fresh password, only a paid advance with a balance',
        async () => {
          await request('1000000');
          const open = await latest();
          await confirmAgain(base, approver.token);
          const writeOff = (token: string, over: Record<string, unknown> = {}) =>
            pay.writeOffAdvance(token, open.id, {
              expectedVersion: open.rowVersion,
              reason: 'Nhân viên nghỉ việc, không thu được',
              ...over,
            } as never);
          await fails(() => writeOff(payroll.token), 'FORBIDDEN');
          await fails(
            () => writeOff(approver.token, { reason: ' ' }),
            'VALIDATION_FAILED',
            'reason',
          );
          await confirmAgain(base, approver.token);
          await fails(() => writeOff(approver.token), 'CONFLICT'); // not paid yet
          await pay.approveAdvance(approver.token, open.id, { expectedVersion: open.rowVersion });
          const approved = await latest();
          const cash = (
            await tx.cashFund.findFirstOrThrow({ where: { kind: 'CASH', branchId: A.id } })
          ).id;
          await confirmAgain(base, approver.token);
          await pay.payAdvance(approver.token, open.id, {
            expectedVersion: approved.rowVersion,
            fundId: cash,
            clientRequestId: id(),
          });
          const paid = await latest();
          await fails(
            () =>
              pay.writeOffAdvance(approver.token, open.id, {
                expectedVersion: paid.rowVersion,
                reason: 'Không có mật khẩu mới',
              }),
            'REAUTHENTICATION_REQUIRED',
          );
          await confirmAgain(base, approver.token);
          await fails(
            () =>
              pay.writeOffAdvance(approver.token, open.id, {
                expectedVersion: paid.rowVersion + 1,
                reason: 'Nhầm phiên bản',
              }),
            'CONFLICT',
          );
          await confirmAgain(base, approver.token);
          const done = await pay.writeOffAdvance(approver.token, open.id, {
            expectedVersion: paid.rowVersion,
            reason: 'Nhân viên nghỉ việc, không thu được',
          });
          assert.equal(itemOf(done, open.id).status, 'WRITTEN_OFF');
          assert.equal(itemOf(done, open.id).writtenOffVnd, '1000000');
          assert.equal(itemOf(done, open.id).outstandingVnd, '0');
          assert.equal(itemOf(done, open.id).writeOffReason, 'Nhân viên nghỉ việc, không thu được');
          const audit = await tx.auditEvent.findMany({
            where: { action: 'ADVANCE_WRITTEN_OFF', entityId: open.id },
          });
          assert.equal(audit[0]?.reason, 'Nhân viên nghỉ việc, không thu được');
        },
      );

      await suite.test(
        'the database never deletes, edits or moves an advance backwards',
        async () => {
          const refuses = async (statement: string, pattern: RegExp) => {
            await tx.$executeRawUnsafe('SAVEPOINT guard');
            await assert.rejects(tx.$executeRawUnsafe(statement), pattern);
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT guard');
          };
          const done = await tx.salaryAdvance.findFirstOrThrow({
            where: { status: 'WRITTEN_OFF' },
          });
          const recovered = await tx.salaryAdvance.findFirstOrThrow({
            where: { status: 'RECOVERED' },
          });
          await refuses(
            `DELETE FROM salary_advances WHERE id = '${done.id}'::uuid`,
            /never deleted/,
          );
          await refuses(
            `UPDATE salary_advances SET amount_vnd = 1, row_version = row_version + 1 WHERE id = '${done.id}'::uuid`,
            /keeps its person, amount and reason/,
          );
          await refuses(
            `UPDATE salary_advances SET status = 'PAID', row_version = row_version + 1 WHERE id = '${recovered.id}'::uuid`,
            /only moves forward/,
          );
          await refuses(
            `UPDATE salary_advances SET write_off_reason = 'x', row_version = row_version + 1 WHERE id = '${done.id}'::uuid`,
            /finished stage/,
          );
          await refuses(
            `UPDATE salary_advances SET reason = 'x' WHERE id = '${recovered.id}'::uuid`,
            /keeps its person, amount and reason/,
          );
          // One open advance per person, enforced by the database too.
          await request('500000');
          const open = await latest();
          await refuses(
            `INSERT INTO salary_advances (employee_user_id, amount_vnd, reason, requested_by_user_id, client_request_id) VALUES ('${worker.id}'::uuid, 1000, 'x', '${owner.id}'::uuid, '${id()}'::uuid)`,
            /salary_advances_one_open_key|duplicate key/,
          );
          assert.equal(open.status, 'REQUESTED');
          assert.equal(
            await tx.fundEntry.count({ where: { category: 'ADVANCE' } }),
            2,
            'only the two paid advances moved money',
          );
        },
      );
    });
  },
);
