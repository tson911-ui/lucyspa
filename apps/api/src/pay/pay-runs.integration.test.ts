import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { reconcileInvoiceEarnings } from '@lucy-spa/server';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { productSaleKit } from '../testing/product-sale-kit.js';
import { addDays, shopToday } from './pay.access.js';
import { PayService } from './pay.service.js';

/**
 * Phase 7 P7-12 against real PostgreSQL (design 4.3; P7-T3, P7-T11, P7-T14): the payroll run as a draft. Nothing before go-live; one run per
 * month; the draft is built from the sources (salary in force on the last day, tour and commission, collaborator work, tips) and flags what
 * a person must look at; a refresh rebuilds the generated items and keeps the manual ones; manual items are typed with a reason and only
 * voided; a closed run cannot change; nothing is paid. Fixtures roll back.
 */
test(
  'Phase 7 P7-12 payroll run draft: build, refresh, items, warnings, guards; fixtures roll back',
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
      const reader = await base.staff([], { globalCodes: ['APPROVE_PAYROLL'] });
      const nobody = await base.staff(['VIEW_INVOICES'], { branchId: A.id });
      const collector = await base.staff(['COLLECT_PAYMENTS'], { branchId: A.id });
      const owner = await tx.user.findFirstOrThrow({ where: { kind: 'OWNER' } });
      const seller = people.cashier;
      const ktv = people.ktv;
      const ctv = await base.staff([], { branchId: A.id });
      // The fixture makes every staff member official since 2020; a collaborator is made by changing that one row (triggers lifted for it).
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.$executeRawUnsafe(
        `UPDATE employment_classification_changes SET classification = 'COLLABORATOR' WHERE employee_user_id = '${ctv.id}'::uuid`,
      );
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = DEFAULT');
      const id = () => randomUUID();
      const detail = (runId: string, token = payroll.token) => pay.payRun(token, runId);
      const line = (view: Awaited<ReturnType<typeof detail>>, employeeId: string) =>
        view.lines.find((entry) => entry.employee.id === employeeId);
      const item = (view: Awaited<ReturnType<typeof detail>>, employeeId: string, kind: string) =>
        line(view, employeeId)?.items.find((entry) => entry.kind === kind && !entry.voided);

      let n = 0;
      const productSale = async (price = 100_000, quantity = 2) => {
        n += 1;
        const product = await k.product(`prn${n}`, [price]);
        const variant = product.variants[0]!;
        await k.receive(variant.id, quantity + 5);
        const invoice = await k.finalize(
          await k.addLine(await k.openSale(people.cashier, null), variant.id, quantity, seller.id),
        );
        await k.pay(invoice.id, Number(invoice.totalVnd));
        await k.runInventory(invoice.id);
        return invoice.id;
      };
      const serviceSale = async () => {
        const done = await k.finalize(await k.serviceDraft([exact]));
        await k.pay(done.id, Number(done.totalVnd));
        return done.id;
      };

      await suite.test(
        'nothing before the Owner starts the cash book and payroll; who may read and who may change',
        async () => {
          const empty = await pay.payRuns(payroll.token);
          assert.deepEqual(
            [empty.items, empty.firstMonth, empty.suggestedMonth, empty.canManage],
            [[], null, null, true],
          );
          await fails(() => pay.createPayRun(payroll.token, { month }), 'FINANCE_NOT_LIVE');
          for (const actor of [nobody, rules, collector])
            await fails(() => pay.payRuns(actor.token), 'FORBIDDEN');
          assert.equal((await pay.payRuns(reader.token)).canManage, false);
          await fails(() => pay.createPayRun(reader.token, { month }), 'FORBIDDEN');
          await tx.financeGoLive.create({
            data: { id: 1, at: new Date(), setByUserId: owner.id, reauthenticatedAt: new Date() },
          });
          const live = await pay.payRuns(payroll.token);
          assert.equal(live.firstMonth, month);
          assert.equal(live.suggestedMonth, month);
        },
      );

      // The things the draft is made of.
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
      const sale = await productSale(100_000, 2);
      const service = await serviceSale();
      await reconcileInvoiceEarnings(tx, sale);
      await reconcileInvoiceEarnings(tx, service);
      await pay.recordTip(collector.token, {
        invoiceId: service,
        employeeUserId: ktv.id,
        amountVnd: '40000',
        method: 'CASH',
        clientRequestId: id(),
      });
      await pay
        .addSalaryVersion(payroll.token, {
          employeeUserId: seller.id,
          amountVnd: '9000000',
          effectiveFrom: today,
          reason: null,
        })
        .catch(async () => {
          // Entering a salary needs the employee-pay permission at the person's branches; the Owner's session is not used in fixtures.
          await tx.employeeSalaryVersion.create({
            data: {
              employeeUserId: seller.id,
              amountVnd: 9_000_000n,
              effectiveFrom: new Date(`${today}T00:00:00.000Z`),
              recordedByUserId: owner.id,
            },
          });
        });
      await tx.collaboratorWorkOccurrence.createMany({
        data: [
          {
            employeeUserId: ctv.id,
            branchId: A.id,
            workDate: new Date(`${today}T00:00:00.000Z`),
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
            workDate: new Date(`${today}T00:00:00.000Z`),
            mode: 'SHIFT',
            startMinute: 780,
            endMinute: 900,
            agreedPayVnd: null,
            createdByUserId: owner.id,
            updatedByUserId: owner.id,
          },
        ],
      });
      await tx.attendanceRecord.create({
        data: {
          employeeUserId: seller.id,
          branchId: A.id,
          businessDate: new Date(`${today}T00:00:00.000Z`),
          checkInAt: new Date(),
        },
      });

      let runId = '';
      await suite.test(
        'a draft is started for a month, once, and built from the sources',
        async () => {
          for (const bad of ['', '2026-13', '26-10', 'abc', addDays(today, 40).slice(0, 7)]) {
            await fails(
              () => pay.createPayRun(payroll.token, { month: bad }),
              'VALIDATION_FAILED',
              'month',
            );
          }
          await fails(
            () => pay.createPayRun(payroll.token, { month: addDays(today, -70).slice(0, 7) }),
            'VALIDATION_FAILED',
            'month',
          );
          await fails(
            () => pay.createPayRun(payroll.token, { month, extra: 1 } as never),
            'VALIDATION_FAILED',
          );
          const created = await pay.createPayRun(payroll.token, { month });
          runId = created.run.id;
          assert.equal(created.run.status, 'DRAFT');
          assert.equal(created.run.month, month);
          assert.equal(created.run.paymentDay, null);
          assert.equal(created.stale, false);
          await fails(() => pay.createPayRun(payroll.token, { month }), 'PAY_RUN_EXISTS');
          // Base salary: the version in force on the last day; a person without one is flagged, never guessed.
          assert.equal(item(created, seller.id, 'BASE_SALARY')?.amountVnd, '9000000');
          assert.equal(item(created, seller.id, 'BASE_SALARY')?.flag, null);
          assert.equal(item(created, ktv.id, 'BASE_SALARY')?.flag, 'NO_BASE');
          assert.equal(item(created, ktv.id, 'BASE_SALARY')?.amountVnd, '0');
          // Tour and commission earned, tips apart, collaborator work counted with its unagreed part.
          assert.equal(item(created, ktv.id, 'TOUR')?.amountVnd, '15000');
          assert.equal(item(created, seller.id, 'COMMISSION')?.amountVnd, '10000');
          assert.equal(item(created, ktv.id, 'TIP')?.amountVnd, '40000');
          const work = item(created, ctv.id, 'CTV_WORK');
          assert.deepEqual(
            [work?.amountVnd, work?.quantity, work?.flag, work?.note],
            ['200000', 1, 'UNAGREED', '1'],
          );
          assert.equal(line(created, ctv.id)?.classification, 'COLLABORATOR');
          assert.equal(
            item(created, ctv.id, 'BASE_SALARY'),
            undefined,
            'a collaborator has no base salary',
          );
          // Net leaves the tips out.
          assert.equal(line(created, ktv.id)?.netVnd, '15000');
          assert.equal(line(created, ktv.id)?.tipsVnd, '40000');
          assert.equal(line(created, seller.id)?.netVnd, '9010000');
          assert.deepEqual(line(created, seller.id)?.context, { attendanceDays: 1, leaveDays: 0 });
          assert.deepEqual(line(created, ktv.id)?.warnings, ['NO_BASE']);
          assert.deepEqual(line(created, ctv.id)?.warnings, ['CTV_UNAGREED']);
          assert.equal(created.warnings.noBase >= 1, true);
          assert.equal(created.warnings.ctvUnagreed, 1);
          assert.equal(created.warnings.noPaymentDay, true);
          assert.equal(created.totals.tipsVnd, '40000');
          assert.equal(created.totals.byKind['TIP'], '40000');
          // Nobody is paid and no fund entry is written.
          assert.equal(
            await tx.fundEntry.count({
              where: { category: { in: ['SALARY_PAYOUT', 'TIP_OUT', 'ADVANCE'] } },
            }),
            0,
          );
          const listed = await pay.payRuns(reader.token);
          assert.equal(listed.items[0]?.id, runId);
          assert.equal(listed.suggestedMonth, null);
          await fails(() => detail(runId, nobody.token), 'FORBIDDEN');
          await fails(() => pay.payRun(payroll.token, id()), 'NOT_FOUND');
          assert.equal((await detail(runId, reader.token)).canManage, false);
          const audit = await tx.auditEvent.findMany({
            where: { action: 'PAY_RUN_CREATED', entityId: runId },
          });
          assert.equal(audit[0]?.dataClassification, 'EMPLOYEE_PAY');
        },
      );

      await suite.test(
        'manual items: signs, reasons, replay, void; a negative net is flagged',
        async () => {
          const post = (kind: string, amountVnd: string, over: Record<string, unknown> = {}) =>
            pay.addPayRunItem(payroll.token, runId, {
              employeeUserId: ktv.id,
              kind,
              amountVnd,
              reason: 'Thưởng chuyên cần',
              clientRequestId: id(),
              ...over,
            } as never);
          for (const actor of [reader, nobody])
            await fails(
              () =>
                pay.addPayRunItem(actor.token, runId, {
                  employeeUserId: ktv.id,
                  kind: 'BONUS',
                  amountVnd: '1000',
                  reason: 'x',
                  clientRequestId: id(),
                }),
              'FORBIDDEN',
            );
          await fails(() => post('BONUS', '-5'), 'VALIDATION_FAILED', 'amountVnd');
          await fails(() => post('BONUS', '0'), 'VALIDATION_FAILED', 'amountVnd');
          await fails(() => post('ADJUSTMENT', '0'), 'VALIDATION_FAILED', 'amountVnd');
          await fails(() => post('DEDUCTION', '-5'), 'VALIDATION_FAILED', 'amountVnd');
          await fails(() => post('TIP', '5'), 'VALIDATION_FAILED', 'kind');
          await fails(() => post('BONUS', '5', { reason: '  ' }), 'VALIDATION_FAILED', 'reason');
          await fails(() => post('BONUS', '5', { extra: 1 }), 'VALIDATION_FAILED');
          await fails(
            () => post('BONUS', '5', { employeeUserId: id() }),
            'VALIDATION_FAILED',
            'employeeUserId',
          );
          const request = id();
          const bonus = await post('BONUS', '200000', { clientRequestId: request });
          assert.equal(item(bonus, ktv.id, 'BONUS')?.amountVnd, '200000');
          assert.equal(item(bonus, ktv.id, 'BONUS')?.createdBy?.id, payroll.id);
          assert.equal(line(bonus, ktv.id)?.netVnd, '215000');
          assert.equal(
            (await post('BONUS', '200000', { clientRequestId: request })).lines.length,
            bonus.lines.length,
          );
          await fails(() => post('BONUS', '300000', { clientRequestId: request }), 'CONFLICT');
          assert.equal(await tx.payRunItem.count({ where: { runId, kind: 'BONUS' } }), 1);
          const deduction = await post('DEDUCTION', '50000', { reason: 'Làm vỡ dụng cụ' });
          assert.equal(
            deduction.lines
              .find((entry) => entry.employee.id === ktv.id)
              ?.items.find((entry) => entry.kind === 'DEDUCTION')?.amountVnd,
            '-50000',
          );
          assert.equal(line(deduction, ktv.id)?.netVnd, '165000');
          const negative = await post('ADJUSTMENT', '-500000', {
            reason: 'Hoàn lại tiền ứng ngoài hệ thống',
          });
          assert.equal(line(negative, ktv.id)?.netVnd, '-335000');
          assert.deepEqual(line(negative, ktv.id)?.warnings, ['NO_BASE', 'NEGATIVE_NET']);
          assert.equal(negative.warnings.negativeNet, 1);
          // A manual item for someone who has nothing else puts them in the run.
          const solo = await base.staff([], { branchId: A.id });
          const added = await pay.addPayRunItem(payroll.token, runId, {
            employeeUserId: solo.id,
            kind: 'BONUS',
            amountVnd: '100000',
            reason: 'Thưởng',
            clientRequestId: id(),
          });
          assert.equal(line(added, solo.id)?.items.length, 1);
          // Voiding: a reason, the current version, manual items only, once.
          const target = line(negative, ktv.id)!.items.find(
            (entry) => entry.kind === 'ADJUSTMENT',
          )!;
          const current = (await detail(runId)).run.version;
          await fails(
            () =>
              pay.voidPayRunItem(payroll.token, runId, target.id, {
                expectedVersion: current - 1,
                reason: 'Nhập nhầm',
              }),
            'CONFLICT',
          );
          await fails(
            () =>
              pay.voidPayRunItem(payroll.token, runId, target.id, {
                expectedVersion: current,
                reason: ' ',
              }),
            'VALIDATION_FAILED',
            'reason',
          );
          await fails(
            () =>
              pay.voidPayRunItem(reader.token, runId, target.id, {
                expectedVersion: current,
                reason: 'x',
              }),
            'FORBIDDEN',
          );
          const generatedId = line(negative, ktv.id)!.items.find((entry) => entry.generated)!.id;
          await fails(
            () =>
              pay.voidPayRunItem(payroll.token, runId, generatedId, {
                expectedVersion: current,
                reason: 'x',
              }),
            'CONFLICT',
          );
          const voided = await pay.voidPayRunItem(payroll.token, runId, target.id, {
            expectedVersion: current,
            reason: 'Nhập nhầm',
          });
          assert.equal(line(voided, ktv.id)?.netVnd, '165000');
          assert.equal(
            line(voided, ktv.id)?.items.find((entry) => entry.id === target.id)?.voided,
            true,
          );
          assert.equal(voided.warnings.negativeNet, 0);
          await fails(
            () =>
              pay.voidPayRunItem(payroll.token, runId, target.id, {
                expectedVersion: voided.run.version,
                reason: 'Lần hai',
              }),
            'CONFLICT',
          );
          const audit = await tx.auditEvent.findMany({
            where: { action: 'PAY_RUN_ITEM_VOIDED', entityId: target.id },
          });
          assert.equal(audit.length, 1);
          assert.equal(audit[0]?.reason, 'Nhập nhầm');
        },
      );

      await suite.test(
        'refresh rebuilds the generated items from the sources and keeps the manual ones; a stale view is refused',
        async () => {
          const before = await detail(runId);
          // The person added for a bonus above is a new official employee: the draft is already behind the sources.
          assert.equal(before.stale, true);
          const manualBefore = before.lines
            .flatMap((entry) => entry.items)
            .filter((entry) => !entry.generated && !entry.voided).length;
          // A new sale after the draft was built: the draft is stale until it is refreshed.
          const another = await productSale(200_000, 1);
          await reconcileInvoiceEarnings(tx, another);
          const stale = await detail(runId);
          assert.equal(stale.stale, true);
          assert.equal(
            item(stale, seller.id, 'COMMISSION')?.amountVnd,
            '10000',
            'the stored draft does not move by itself',
          );
          await fails(
            () =>
              pay.refreshPayRun(payroll.token, runId, { expectedVersion: before.run.version - 1 }),
            'CONFLICT',
          );
          await fails(
            () => pay.refreshPayRun(reader.token, runId, { expectedVersion: before.run.version }),
            'FORBIDDEN',
          );
          await fails(
            () => pay.refreshPayRun(payroll.token, runId, { expectedVersion: 0 }),
            'VALIDATION_FAILED',
            'expectedVersion',
          );
          const fresh = await pay.refreshPayRun(payroll.token, runId, {
            expectedVersion: before.run.version,
          });
          assert.equal(fresh.stale, false);
          assert.equal(item(fresh, seller.id, 'COMMISSION')?.amountVnd, '20000');
          assert.equal(fresh.run.version, before.run.version + 1);
          assert.equal(
            fresh.lines
              .flatMap((entry) => entry.items)
              .filter((entry) => !entry.generated && !entry.voided).length,
            manualBefore,
          );
          assert.equal(
            await tx.payRunItem.count({ where: { runId, generated: true, kind: 'COMMISSION' } }),
            1,
            'rebuilt, not duplicated',
          );
          assert.ok(fresh.run.refreshedAt);
          // A refund that already reduced the earning is in the sources; a second refresh with nothing new changes nothing.
          const again = await pay.refreshPayRun(payroll.token, runId, {
            expectedVersion: fresh.run.version,
          });
          assert.deepEqual(again.totals, fresh.totals);
        },
      );

      await suite.test(
        'the payment day is chosen while the run is a draft, inside a sensible window',
        async () => {
          const current = (await detail(runId)).run.version;
          const first = `${month}-01`;
          const set = (paymentDay: string, expectedVersion = current) =>
            pay.setPayRunPaymentDay(payroll.token, runId, { expectedVersion, paymentDay });
          await fails(() => set(addDays(first, -1)), 'VALIDATION_FAILED', 'paymentDay');
          await fails(() => set(addDays(first, 200)), 'VALIDATION_FAILED', 'paymentDay');
          await fails(() => set('2026-02-30'), 'VALIDATION_FAILED', 'paymentDay');
          await fails(() => set(addDays(today, 3), current - 1), 'CONFLICT');
          await fails(
            () =>
              pay.setPayRunPaymentDay(reader.token, runId, {
                expectedVersion: current,
                paymentDay: addDays(today, 3),
              }),
            'FORBIDDEN',
          );
          const done = await set(addDays(today, 3));
          assert.equal(done.run.paymentDay, addDays(today, 3));
          assert.equal(done.warnings.noPaymentDay, false);
          assert.equal(done.run.version, current + 1);
        },
      );

      await suite.test(
        'a closed run cannot change; the database refuses what the API would refuse',
        async () => {
          const refuses = async (statement: string, pattern: RegExp) => {
            await tx.$executeRawUnsafe('SAVEPOINT guard');
            await assert.rejects(tx.$executeRawUnsafe(statement), pattern);
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT guard');
          };
          const view = await detail(runId);
          const manual = view.lines
            .flatMap((entry) => entry.items)
            .find((entry) => !entry.generated && !entry.voided)!;
          const generated = view.lines
            .flatMap((entry) => entry.items)
            .find((entry) => entry.generated)!;
          // While draft: a manual item is never deleted or edited, a run is never deleted, the month never moves.
          await refuses(
            `DELETE FROM pay_run_items WHERE id = '${manual.id}'::uuid`,
            /voided with a reason, never deleted/,
          );
          await refuses(
            `UPDATE pay_run_items SET amount_vnd = 1 WHERE id = '${manual.id}'::uuid`,
            /never edited/,
          );
          await refuses(
            `UPDATE pay_run_items SET note = 'x' WHERE id = '${generated.id}'::uuid`,
            /never edited/,
          );
          await refuses(`DELETE FROM pay_runs WHERE id = '${runId}'::uuid`, /never deleted/);
          await refuses(
            `UPDATE pay_runs SET period_month = '2020-01-01', row_version = row_version + 1 WHERE id = '${runId}'::uuid`,
            /keeps its month/,
          );
          await refuses(
            `UPDATE pay_runs SET status = 'PAID', row_version = row_version + 1 WHERE id = '${runId}'::uuid`,
            /only moves forward/,
          );
          await refuses(
            `UPDATE pay_runs SET payment_day = '2026-01-01' WHERE id = '${runId}'::uuid`,
            /bumps the version by one/,
          );
          // Closing (P7-14 does it with the Owner's password; here the row is closed by the database's own rules).
          await tx.$executeRawUnsafe(
            `UPDATE pay_runs SET status = 'CLOSED', closed_at = now(), closed_by_user_id = '${owner.id}'::uuid, row_version = row_version + 1 WHERE id = '${runId}'::uuid`,
          );
          await fails(
            () =>
              pay.refreshPayRun(payroll.token, runId, { expectedVersion: view.run.version + 1 }),
            'PAY_RUN_NOT_DRAFT',
          );
          await fails(
            () =>
              pay.addPayRunItem(payroll.token, runId, {
                employeeUserId: ktv.id,
                kind: 'BONUS',
                amountVnd: '1',
                reason: 'x',
                clientRequestId: id(),
              }),
            'PAY_RUN_NOT_DRAFT',
          );
          await fails(
            () =>
              pay.setPayRunPaymentDay(payroll.token, runId, {
                expectedVersion: view.run.version + 1,
                paymentDay: addDays(today, 5),
              }),
            'PAY_RUN_NOT_DRAFT',
          );
          await fails(
            () =>
              pay.voidPayRunItem(payroll.token, runId, manual.id, {
                expectedVersion: view.run.version + 1,
                reason: 'x',
              }),
            'PAY_RUN_NOT_DRAFT',
          );
          await refuses(
            `DELETE FROM pay_run_items WHERE id = '${generated.id}'::uuid`,
            /Nothing under a closed payroll run can change/,
          );
          await refuses(
            `UPDATE pay_run_items SET voided_at = now(), voided_by_user_id = '${owner.id}'::uuid, void_reason = 'x' WHERE id = '${manual.id}'::uuid`,
            /Nothing under a closed payroll run can change/,
          );
          await refuses(
            `UPDATE pay_runs SET status = 'DRAFT', row_version = row_version + 1 WHERE id = '${runId}'::uuid`,
            /only moves forward/,
          );
          await refuses(
            `UPDATE pay_runs SET payment_day = payment_day + 1, row_version = row_version + 1 WHERE id = '${runId}'::uuid`,
            /payment day of a closed run never changes/,
          );
          // It is still readable, and no longer stale-checked.
          const closed = await detail(runId);
          assert.equal(closed.run.status, 'CLOSED');
          assert.equal(closed.stale, false);
          // The month is taken for good; a second run for it is refused.
          await fails(() => pay.createPayRun(payroll.token, { month }), 'PAY_RUN_EXISTS');
        },
      );
    });
  },
);
