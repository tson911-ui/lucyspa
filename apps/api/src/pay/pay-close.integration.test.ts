import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ensureCashFund, reconcileInvoiceEarnings } from '@lucy-spa/server';
import { confirmAgain } from '../testing/confirm-again.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { productSaleKit } from '../testing/product-sale-kit.js';
import { addDays, shopToday } from './pay.access.js';
import { PayService } from './pay.service.js';

/**
 * Phase 7 P7-14 against real PostgreSQL (design 4.3; P7-T3, P7-T10, P7-T12): closing a payroll run, its payslips, marking them paid and
 * reversing a mistaken paid mark. Closing needs the Owner's approval and a fresh password and is refused while the draft is behind, has no
 * payment day, an unconfirmed base salary or a negative net; it freezes everything it took and pays nobody. Paying needs the payment day,
 * a fresh password and a fund that holds the money; net pay and tips are separate entries. Fixtures roll back.
 */
test(
  'Phase 7 P7-14 payroll close, payslips, paying, reversal: guards and money; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await productSaleKit(base);
      const { tx, fails } = base;
      const { A, people, exact } = k;
      const pay = new PayService(base.adapter, base.throttle, base.environment);
      const today = shopToday(new Date());
      const month = today.slice(0, 7);
      const rules = await base.staff([], { globalCodes: ['MANAGE_PAY_RULES'] });
      const payroll = await base.staff([], { globalCodes: ['MANAGE_PAYROLL'] });
      const approver = await base.staff([], { globalCodes: ['APPROVE_PAYROLL'] });
      const collector = await base.staff(['COLLECT_PAYMENTS'], { branchId: A.id });
      const nobody = await base.staff(['VIEW_INVOICES'], { branchId: A.id });
      const owner = await tx.user.findFirstOrThrow({ where: { kind: 'OWNER' } });
      const seller = people.cashier;
      const ktv = people.ktv;
      const solo = await base.staff([], { branchId: A.id });
      const ctv = await base.staff([], { branchId: A.id });
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.$executeRawUnsafe(
        `UPDATE employment_classification_changes SET classification = 'COLLABORATOR' WHERE employee_user_id = '${ctv.id}'::uuid`,
      );
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = DEFAULT');
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
      const net = (view: Awaited<ReturnType<typeof pay.payRun>>, employeeId: string) =>
        view.lines.find((entry) => entry.employee.id === employeeId)?.netVnd;
      const close = (token: string, runId: string, expectedVersion: number) =>
        pay.closePayRun(token, runId, { expectedVersion });

      await tx.financeGoLive.create({
        data: { id: 1, at: new Date(), setByUserId: owner.id, reauthenticatedAt: new Date() },
      });
      const cash = (await ensureCashFund(tx, A.id))!;
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
      await salary(seller.id, 9_000_000n);
      await salary(ktv.id, 6_000_000n);
      // Every other official employee of the fixture has a salary too, except `solo` (the one whose missing base blocks the close below).
      for (const profile of await tx.employeeProfile.findMany({ select: { userId: true } })) {
        if (![seller.id, ktv.id, solo.id, ctv.id].includes(profile.userId))
          await salary(profile.userId, 1_000_000n);
      }
      // Sources: a product sale and a service (tour, commission), a tip, agreed and unagreed collaborator work, a paid advance.
      const product = await k.product('closep', [100_000]);
      const variant = product.variants[0]!;
      await k.receive(variant.id, 9);
      const saleInvoice = await k.finalize(
        await k.addLine(await k.openSale(people.cashier, null), variant.id, 2, seller.id),
      );
      await k.pay(saleInvoice.id, Number(saleInvoice.totalVnd));
      await k.runInventory(saleInvoice.id);
      const serviceInvoice = await k.finalize(await k.serviceDraft([exact]));
      await k.pay(serviceInvoice.id, Number(serviceInvoice.totalVnd));
      await reconcileInvoiceEarnings(tx, saleInvoice.id);
      await reconcileInvoiceEarnings(tx, serviceInvoice.id);
      await pay.recordTip(collector.token, {
        invoiceId: serviceInvoice.id,
        employeeUserId: ktv.id,
        amountVnd: '40000',
        method: 'CASH',
        clientRequestId: id(),
      });
      await tx.collaboratorWorkOccurrence.createMany({
        data: [
          {
            employeeUserId: ctv.id,
            branchId: A.id,
            workDate: asDate(today),
            mode: 'SHIFT',
            startMinute: 540,
            endMinute: 720,
            agreedPayVnd: 200_000n,
            createdByUserId: owner.id,
            updatedByUserId: owner.id,
          },
          {
            employeeUserId: ctv.id,
            branchId: A.id,
            workDate: asDate(today),
            mode: 'SHIFT',
            startMinute: 780,
            endMinute: 900,
            agreedPayVnd: null,
            createdByUserId: owner.id,
            updatedByUserId: owner.id,
          },
        ],
      });
      await tx.fundEntry.create({
        data: {
          fundId: cash,
          branchId: A.id,
          businessDate: asDate(today),
          direction: 'IN',
          category: 'MANUAL_INCOME',
          amountVnd: 60_000_000n,
          reason: 'Vốn',
          actorUserId: owner.id,
        },
      });
      await pay.requestAdvance(payroll.token, {
        employeeUserId: seller.id,
        amountVnd: '1000000',
        reason: 'Việc gấp',
        clientRequestId: id(),
      });
      const advance = await tx.salaryAdvance.findFirstOrThrow({ orderBy: { seq: 'desc' } });
      await pay.approveAdvance(approver.token, advance.id, { expectedVersion: advance.rowVersion });
      await confirmAgain(base, approver.token);
      await pay.payAdvance(approver.token, advance.id, {
        expectedVersion: advance.rowVersion + 1,
        fundId: cash,
        clientRequestId: id(),
      });

      let runId = '';
      let version = 0;
      await suite.test(
        'closing is refused while the draft is not ready: stale, payment day, base salary, negative net',
        async () => {
          const created = await pay.createPayRun(payroll.token, { month });
          runId = created.run.id;
          version = created.run.version;
          assert.equal(
            net(created, seller.id),
            '8010000',
            'base 9,000,000 + commission 10,000 - the advance 1,000,000 recovered',
          );
          await confirmAgain(base, approver.token);
          // Only the person who approves may close; the payroll manager may not.
          await fails(() => close(payroll.token, runId, version), 'FORBIDDEN');
          await fails(() => close(approver.token, runId, version - 1), 'CONFLICT');
          await fails(
            () => close(approver.token, runId, 0),
            'VALIDATION_FAILED',
            'expectedVersion',
          );
          await fails(() => close(approver.token, runId, version), 'PAY_RUN_BLOCKED', 'paymentDay');
          const withDay = await pay.setPayRunPaymentDay(payroll.token, runId, {
            expectedVersion: version,
            paymentDay: addDays(today, 3),
          });
          version = withDay.run.version;
          // `solo` is an official employee with no salary entered: the base is missing, never guessed.
          assert.equal(withDay.warnings.noBase >= 1, true);
          await fails(() => close(approver.token, runId, version), 'PAY_RUN_BLOCKED', 'base');
          await salary(solo.id, 5_000_000n);
          await fails(() => close(approver.token, runId, version), 'PAY_RUN_STALE');
          const refreshed = await pay.refreshPayRun(payroll.token, runId, {
            expectedVersion: version,
          });
          version = refreshed.run.version;
          assert.equal(refreshed.warnings.noBase, 0);
          // A deduction larger than the pay makes a negative net: blocked until it is voided.
          const bad = await pay.addPayRunItem(payroll.token, runId, {
            employeeUserId: solo.id,
            kind: 'DEDUCTION',
            amountVnd: '6000000',
            reason: 'Nhập thử',
            clientRequestId: id(),
          });
          version = bad.run.version;
          const refreshed2 = await pay.refreshPayRun(payroll.token, runId, {
            expectedVersion: version,
          });
          version = refreshed2.run.version;
          await fails(() => close(approver.token, runId, version), 'PAY_RUN_BLOCKED', 'negative');
          const target = refreshed2.lines
            .find((entry) => entry.employee.id === solo.id)!
            .items.find((entry) => entry.kind === 'DEDUCTION')!;
          const voided = await pay.voidPayRunItem(payroll.token, runId, target.id, {
            expectedVersion: version,
            reason: 'Nhập thử',
          });
          version = voided.run.version;
          assert.equal(await tx.payslip.count(), 0, 'a refused close leaves nothing behind');
          assert.equal(await tx.payEarning.count({ where: { runId: { not: null } } }), 0);
        },
      );

      await suite.test(
        'closing needs a fresh password, takes the sources, makes the payslips, pays nobody',
        async () => {
          await confirmAgain(base, approver.token);
          const closed = await close(approver.token, runId, version);
          assert.equal(closed.run.status, 'CLOSED');
          assert.equal(closed.run.closedAt !== null, true);
          // What it showed is what it took.
          assert.equal(await tx.payEarning.count({ where: { runId: null } }), 0);
          assert.equal((await tx.payEarning.count({ where: { runId } })) >= 2, true);
          assert.equal((await tx.tip.findFirstOrThrow({})).runId, runId);
          const occurrences = await tx.collaboratorWorkOccurrence.findMany({
            where: { employeeUserId: ctv.id },
            orderBy: { startMinute: 'asc' },
          });
          assert.deepEqual(
            occurrences.map((row) => row.payRunId),
            [runId, null],
            'agreed work is taken, unagreed work stays open so it can still be agreed',
          );
          // Payslips with their own printed totals; tips apart; nothing paid.
          const slips = await tx.payslip.findMany({ where: { runId } });
          const mine = slips.find((slip) => slip.employeeUserId === seller.id)!;
          assert.deepEqual([mine.netVnd, mine.tipsVnd, mine.status], [8_010_000n, 0n, 'PENDING']);
          const theirs = slips.find((slip) => slip.employeeUserId === ktv.id)!;
          assert.deepEqual([theirs.netVnd, theirs.tipsVnd], [6_015_000n, 40_000n]);
          assert.equal(slips.find((slip) => slip.employeeUserId === ctv.id)?.netVnd, 200_000n);
          assert.equal(
            await tx.fundEntry.count({ where: { category: { in: ['SALARY_PAYOUT', 'TIP_OUT'] } } }),
            0,
          );
          // The advance was taken back in full by the closed run.
          assert.equal(
            (await tx.salaryAdvance.findUniqueOrThrow({ where: { id: advance.id } })).status,
            'RECOVERED',
          );
          // Closed means closed.
          await confirmAgain(base, approver.token);
          await fails(() => close(approver.token, runId, closed.run.version), 'PAY_RUN_NOT_DRAFT');
          await fails(
            () => pay.refreshPayRun(payroll.token, runId, { expectedVersion: closed.run.version }),
            'PAY_RUN_NOT_DRAFT',
          );
          assert.equal(
            (
              await tx.auditEvent.findMany({ where: { action: 'PAY_RUN_CLOSED', entityId: runId } })
            )[0]?.dataClassification,
            'EMPLOYEE_PAY',
          );
          // The database refuses to change what a closed run took.
          const refuses = async (statement: string, pattern: RegExp) => {
            await tx.$executeRawUnsafe('SAVEPOINT guard');
            await assert.rejects(tx.$executeRawUnsafe(statement), pattern);
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT guard');
          };
          await refuses(
            `UPDATE collaborator_work_occurrences SET agreed_pay_vnd = 1, row_version = row_version + 1 WHERE id = '${occurrences[0]!.id}'::uuid`,
            /cannot change; correct it in the next run/,
          );
          await refuses(
            `UPDATE collaborator_work_occurrences SET status = 'CANCELLED', cancelled_at = now(), cancelled_by_user_id = '${owner.id}'::uuid, cancel_reason = 'x', row_version = row_version + 1 WHERE id = '${occurrences[0]!.id}'::uuid`,
            /cannot change; correct it in the next run/,
          );
          const earning = await tx.payEarning.findFirstOrThrow({ where: { runId } });
          await refuses(
            `UPDATE pay_earnings SET run_id = NULL WHERE id = '${earning.id}'::uuid`,
            /never changes/,
          );
          await refuses(`DELETE FROM payslips WHERE id = '${mine.id}'::uuid`, /never deleted/);
          await refuses(
            `UPDATE payslips SET net_vnd = 1, row_version = row_version + 1 WHERE id = '${mine.id}'::uuid`,
            /keeps its printed totals/,
          );
        },
      );

      await suite.test(
        'payslips are read by the people who run payroll and, each, by their owner only',
        async () => {
          const list = await pay.payslips(approver.token, runId);
          assert.equal(list.items.length >= 4, true);
          assert.equal(list.canPay, true);
          assert.equal(list.payable, false, 'the payment day is still ahead');
          assert.equal(
            list.funds.some((fund) => fund.id === cash),
            true,
          );
          assert.equal((await pay.payslips(payroll.token, runId)).canPay, false);
          await fails(() => pay.payslips(nobody.token, runId), 'FORBIDDEN');
          await fails(() => pay.payslip(nobody.token, list.items[0]!.id), 'FORBIDDEN');
          const slip = list.items.find((entry) => entry.employee.id === ktv.id)!;
          const full = await pay.payslip(payroll.token, slip.id);
          assert.deepEqual(
            full.items.map((entry) => entry.kind),
            ['BASE_SALARY', 'TOUR', 'TIP'],
          );
          assert.equal(full.items.at(-1)?.amountVnd, '40000');
          assert.equal(full.netVnd, '6015000');
          // The employee sees their own payslip with no permission, and nobody else's.
          const own = await pay.myPayslips(ktv.token);
          assert.deepEqual(
            own.items.map((entry) => entry.id),
            [slip.id],
          );
          assert.equal((await pay.myPayslip(ktv.token, slip.id)).items.length, 3);
          await fails(
            () =>
              pay.myPayslip(
                ktv.token,
                list.items.find((entry) => entry.employee.id === seller.id)!.id,
              ),
            'NOT_FOUND',
          );
          await fails(() => pay.myPayslip(ktv.token, id()), 'NOT_FOUND');
          const latecomer = await base.staff([], { branchId: A.id });
          assert.deepEqual((await pay.myPayslips(latecomer.token)).items, []);
        },
      );

      await suite.test(
        'paying: not before the payment day, a fresh password, a fund that holds the money, two entries, once',
        async () => {
          const run = await tx.payRun.findUniqueOrThrow({ where: { id: runId } });
          const slips = await tx.payslip.findMany({ where: { runId }, orderBy: { id: 'asc' } });
          const payBody = (over: Record<string, unknown> = {}) =>
            ({
              expectedVersion: run.rowVersion,
              fundId: cash,
              payslipIds: null,
              clientRequestId: id(),
              ...over,
            }) as never;
          await confirmAgain(base, approver.token);
          await fails(() => pay.payPayslips(approver.token, runId, payBody()), 'PAY_RUN_NOT_YET');
          // The payment day arrives (the fixture lets it, with the guards lifted for this one statement).
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
          await tx.$executeRawUnsafe(
            `UPDATE pay_runs SET payment_day = '${today}' WHERE id = '${runId}'::uuid`,
          );
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = DEFAULT');
          assert.equal((await pay.payslips(approver.token, runId)).payable, true);
          await fails(() => pay.payPayslips(payroll.token, runId, payBody()), 'FORBIDDEN');
          await fails(
            () => pay.payPayslips(approver.token, runId, payBody({ expectedVersion: 99 })),
            'CONFLICT',
          );
          await fails(
            () => pay.payPayslips(approver.token, runId, payBody({ fundId: id() })),
            'VALIDATION_FAILED',
            'fundId',
          );
          await fails(
            () => pay.payPayslips(approver.token, runId, payBody({ payslipIds: [id()] })),
            'CONFLICT',
          );
          await fails(
            () => pay.payPayslips(approver.token, runId, payBody({ payslipIds: [] })),
            'VALIDATION_FAILED',
            'payslipIds',
          );
          await fails(
            () => pay.payPayslips(approver.token, runId, payBody({ extra: 1 })),
            'VALIDATION_FAILED',
          );
          // The drawer holds 20,000,000 + 40,000 (tip) - 1,000,000 (advance) = 19,040,000 and the run needs more than the drawer after a drain.
          await tx.fundEntry.create({
            data: {
              fundId: cash,
              branchId: A.id,
              businessDate: asDate(today),
              direction: 'OUT',
              category: 'MANUAL_EXPENSE',
              amountVnd: 58_000_000n,
              reason: 'Chi lớn',
              actorUserId: owner.id,
            },
          });
          await fails(() => pay.payPayslips(approver.token, runId, payBody()), 'CASH_INSUFFICIENT');
          await tx.fundEntry.create({
            data: {
              fundId: cash,
              branchId: A.id,
              businessDate: asDate(today),
              direction: 'IN',
              category: 'MANUAL_INCOME',
              amountVnd: 58_000_000n,
              reason: 'Hoàn lại',
              actorUserId: owner.id,
            },
          });
          // One payslip first, then the rest.
          const first = slips.find((slip) => slip.employeeUserId === ktv.id)!;
          const clientRequestId = id();
          const one = await pay.payPayslips(
            approver.token,
            runId,
            payBody({ payslipIds: [first.id], clientRequestId }),
          );
          assert.equal(one.items.find((entry) => entry.id === first.id)?.status, 'PAID');
          assert.equal(
            one.items.filter((entry) => entry.status === 'PENDING').length,
            slips.length - 1,
          );
          const entries = await tx.fundEntry.findMany({
            where: { sourceType: 'PAYSLIP', sourceId: first.id },
            orderBy: { sourceLeg: 'asc' },
          });
          assert.deepEqual(
            entries.map((entry) => [
              entry.category,
              entry.direction,
              entry.amountVnd,
              entry.sourceLeg,
            ]),
            [
              ['SALARY_PAYOUT', 'OUT', 6_015_000n, 0],
              ['TIP_OUT', 'OUT', 40_000n, 1],
            ],
          );
          // The same request is a replay; the spent confirmation is not reusable.
          assert.equal(
            (
              await pay.payPayslips(
                approver.token,
                runId,
                payBody({ payslipIds: [first.id], clientRequestId }),
              )
            ).items.length,
            one.items.length,
          );
          assert.equal(await tx.fundEntry.count({ where: { category: 'SALARY_PAYOUT' } }), 1);
          await fails(
            () =>
              pay.payPayslips(
                approver.token,
                runId,
                payBody({ expectedVersion: run.rowVersion + 1 }),
              ),
            'REAUTHENTICATION_REQUIRED',
          );
          await confirmAgain(base, approver.token);
          const rest = await pay.payPayslips(
            approver.token,
            runId,
            payBody({ expectedVersion: run.rowVersion + 1 }),
          );
          assert.equal(
            rest.items.every((entry) => entry.status === 'PAID'),
            true,
          );
          assert.equal(
            (await tx.payRun.findUniqueOrThrow({ where: { id: runId } })).status,
            'PAID',
          );
          assert.equal(
            await tx.fundEntry.count({ where: { category: 'SALARY_PAYOUT' } }),
            slips.filter((slip) => slip.netVnd > 0n).length,
          );
          assert.equal(await tx.fundEntry.count({ where: { category: 'TIP_OUT' } }), 1);
          await confirmAgain(base, approver.token);
          await fails(
            () =>
              pay.payPayslips(
                approver.token,
                runId,
                payBody({ expectedVersion: run.rowVersion + 2 }),
              ),
            'PAY_RUN_NOT_CLOSED',
          );
          assert.equal(
            (await tx.auditEvent.findMany({ where: { action: 'PAYSLIPS_PAID', entityId: runId } }))
              .length,
            2,
          );
        },
      );

      await suite.test(
        'a mistaken paid mark is reversed with correcting entries; the run is never reopened',
        async () => {
          const slip = await tx.payslip.findFirstOrThrow({
            where: { runId, employeeUserId: ktv.id },
          });
          const balance = async () => {
            const rows = await tx.$queryRaw<
              { net: bigint }[]
            >`SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_vnd ELSE -amount_vnd END), 0)::bigint AS net FROM fund_entries WHERE fund_id = ${cash}::uuid`;
            return rows[0]!.net;
          };
          const before = await balance();
          await confirmAgain(base, approver.token);
          const reverse = (token: string, over: Record<string, unknown> = {}) =>
            pay.reversePayslip(token, slip.id, {
              expectedVersion: slip.rowVersion,
              reason: 'Chuyển nhầm người',
              ...over,
            } as never);
          await fails(() => reverse(payroll.token), 'FORBIDDEN');
          await fails(
            () => reverse(approver.token, { reason: ' ' }),
            'VALIDATION_FAILED',
            'reason',
          );
          await fails(() => reverse(approver.token, { expectedVersion: 99 }), 'CONFLICT');
          const done = await reverse(approver.token);
          assert.equal(done.status, 'REVERSED');
          assert.equal(done.reversalReason, 'Chuyển nhầm người');
          assert.equal(done.reversedBy?.id, approver.id);
          assert.equal(
            (await balance()) - before,
            6_055_000n,
            'the money comes back into the book',
          );
          const fixes = await tx.fundEntry.findMany({
            where: {
              category: 'CORRECTION',
              reversesEntryId: { in: [slip.netEntryId!, slip.tipsEntryId!] },
            },
          });
          assert.equal(fixes.length, 2);
          assert.equal(
            (await tx.payRun.findUniqueOrThrow({ where: { id: runId } })).status,
            'PAID',
          );
          await confirmAgain(base, approver.token);
          await fails(
            () => reverse(approver.token, { expectedVersion: slip.rowVersion + 1 }),
            'CONFLICT',
          );
          assert.equal(
            (
              await tx.auditEvent.findMany({
                where: { action: 'PAYSLIP_PAYMENT_REVERSED', entityId: slip.id },
              })
            )[0]?.dataClassification,
            'FINANCIAL',
          );
        },
      );
    });
  },
);
