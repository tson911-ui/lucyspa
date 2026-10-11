import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { productSaleKit } from '../testing/product-sale-kit.js';
import { shopToday } from './pay.access.js';
import { PayService } from './pay.service.js';

const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Phase 7 P7-8 against real PostgreSQL (design 4.2, 9; P7-T1, P7-T2, P7-T5, P7-T6): tour rules, product commission rules and salary
 * versions. They ship empty, are Owner-entered and effective-dated, are never edited or deleted (a change is a new row), a zero value
 * is a real "pays nothing", and the permissions are exactly the agreed ones. Fixtures roll back.
 */
test(
  'Phase 7 P7-8 pay configuration: authority, strict input, versions, states, salary history, audit; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await productSaleKit(base);
      const { tx, fails } = base;
      const { A, B, exact, ranged } = k;
      const pay = new PayService(base.adapter, base.throttle);
      const today = shopToday(new Date());
      const manager = await base.staff([], { globalCodes: ['MANAGE_PAY_RULES'] });
      const payroll = await base.staff([], { globalCodes: ['MANAGE_PAYROLL'] });
      const nobody = await base.staff(['VIEW_INVOICES'], { branchId: A.id });
      const id = () => randomUUID();
      const owner = await tx.user.findFirstOrThrow({ where: { kind: 'OWNER' } });
      const ended = async (token: { id: string }) =>
        tx.employmentClassificationChange.create({
          data: {
            employeeUserId: token.id,
            classification: 'ENDED',
            effectiveDate: new Date('2021-01-01'),
            recordedByUserId: owner.id,
          },
        });

      await suite.test(
        'they ship empty; reading needs a pay permission, changing needs MANAGE_PAY_RULES',
        async () => {
          assert.equal(await tx.tourRule.count(), 0);
          assert.equal(await tx.commissionRule.count(), 0);
          assert.equal(await tx.employeeSalaryVersion.count(), 0);
          await fails(() => pay.tourRules(nobody.token), 'FORBIDDEN');
          await fails(() => pay.commissionRules(nobody.token), 'FORBIDDEN');
          await fails(() => pay.salaries(nobody.token), 'FORBIDDEN');
          const read = await pay.tourRules(payroll.token);
          assert.equal(read.canManage, false);
          assert.equal(read.today, today);
          assert.ok(read.items.length >= 2);
          assert.ok(
            read.items.every(
              (item) => item.current === null && item.upcoming === null && item.versions === 0,
            ),
          );
          assert.equal((await pay.tourRules(manager.token)).canManage, true);
          assert.equal((await pay.tourRules(base.ownerToken)).canManage, true);
          const body = {
            serviceId: exact.id,
            amountVnd: '15000',
            effectiveFrom: today,
            reason: null,
          };
          await fails(() => pay.addTourRule(payroll.token, body), 'FORBIDDEN');
          await fails(() => pay.addTourRule(nobody.token, body), 'FORBIDDEN');
          assert.equal(await tx.tourRule.count(), 0);
        },
      );

      await suite.test(
        'tour amounts: strict input, versions with dates, a zero rule, history, audit',
        async () => {
          const add = (patch: Record<string, unknown> = {}, token = manager.token) =>
            pay.addTourRule(token, {
              serviceId: exact.id,
              amountVnd: '15000',
              effectiveFrom: today,
              reason: 'Mức tour tháng này',
              ...patch,
            } as never);
          for (const bad of ['-1', '1.5', '01', '1,000', '', ' 5', '99999999999']) {
            await fails(() => add({ amountVnd: bad }), 'VALIDATION_FAILED', 'amountVnd');
          }
          for (const bad of ['2026-02-30', 'x', addDays(today, -63), addDays(today, 367), '']) {
            await fails(() => add({ effectiveFrom: bad }), 'VALIDATION_FAILED', 'effectiveFrom');
          }
          await fails(() => add({ serviceId: 'nope' }), 'VALIDATION_FAILED', 'serviceId');
          await fails(() => add({ serviceId: id() }), 'NOT_FOUND');
          await fails(() => add({ extra: 1 }), 'VALIDATION_FAILED');
          await fails(() => add({ reason: 'x'.repeat(501) }), 'VALIDATION_FAILED', 'reason');
          const first = await add();
          assert.equal(first.item.current?.amountVnd, '15000');
          assert.equal(first.item.current?.effectiveFrom, today);
          assert.equal(first.item.upcoming, null);
          await fails(() => add({ amountVnd: '16000' }), 'PAY_VERSION_EXISTS');
          const later = await add({ amountVnd: '20000', effectiveFrom: addDays(today, 10) });
          assert.equal(later.item.current?.amountVnd, '15000');
          assert.equal(later.item.upcoming?.amountVnd, '20000');
          assert.equal(later.item.versions, 2);
          // A zero is a real rule (it pays nothing from that day on), and an earlier day inside the window may be filled in.
          await add({ amountVnd: '0', effectiveFrom: addDays(today, 30) });
          const earlier = await add({ amountVnd: '12000', effectiveFrom: addDays(today, -20) });
          assert.equal(earlier.item.current?.amountVnd, '15000');
          const history = await pay.tourHistory(payroll.token, exact.id);
          assert.deepEqual(
            history.items.map((row) => [row.effectiveFrom, row.amountVnd]),
            [
              [addDays(today, 30), '0'],
              [addDays(today, 10), '20000'],
              [today, '15000'],
              [addDays(today, -20), '12000'],
            ],
          );
          assert.equal(history.items[0]?.createdBy.id, manager.id);
          await fails(() => pay.tourHistory(nobody.token, exact.id), 'FORBIDDEN');
          await fails(() => pay.tourHistory(payroll.token, id()), 'NOT_FOUND');
          const other = (await pay.tourRules(manager.token)).items.find(
            (item) => item.service.id === ranged.id,
          )!;
          assert.equal(other.current, null, 'another service is untouched');
          const audit = await tx.auditEvent.findMany({ where: { action: 'TOUR_RULE_ADDED' } });
          assert.equal(audit.length, 4);
          assert.ok(
            audit.every(
              (event) =>
                event.dataClassification === 'EMPLOYEE_PAY' && event.actorUserId === manager.id,
            ),
          );
          // A rule is history: the database refuses an edit and a delete.
          const row = await tx.tourRule.findFirstOrThrow();
          for (const statement of [
            `UPDATE tour_rules SET amount_vnd = 1 WHERE id = '${row.id}'::uuid`,
            `DELETE FROM tour_rules WHERE id = '${row.id}'::uuid`,
          ]) {
            await tx.$executeRawUnsafe('SAVEPOINT guard');
            await assert.rejects(tx.$executeRawUnsafe(statement), /append-only/);
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT guard');
          }
        },
      );

      const brand = await tx.brand.create({
        data: {
          code: `p78b-${base.run.toLowerCase()}`,
          nameVi: 'Thương hiệu thử',
          nameEn: 'Test brand',
        },
      });
      const category = await tx.productCategory.create({
        data: {
          code: `p78c-${base.run.toLowerCase()}`,
          nameVi: 'Nhóm thử',
          nameEn: 'Test category',
        },
      });
      const product = await k.product('commission', [100_000]);
      const seller = await base.staff([], { branchId: A.id });
      const trainee = await base.staff([], { branchId: A.id });
      await ended(trainee);

      await suite.test(
        'commission rules: scopes, targets, employees, strict input, duplicates',
        async () => {
          const add = (patch: Record<string, unknown> = {}, token = manager.token) =>
            pay.addCommissionRule(token, {
              scope: 'SHOP',
              targetId: null,
              employeeUserId: null,
              kind: 'PERCENT',
              value: '500',
              effectiveFrom: today,
              reason: null,
              ...patch,
            } as never);
          await fails(() => add({}, payroll.token), 'FORBIDDEN');
          await fails(() => add({}, nobody.token), 'FORBIDDEN');
          await fails(() => add({ scope: 'REGION' }), 'VALIDATION_FAILED', 'scope');
          await fails(() => add({ kind: 'FLAT' }), 'VALIDATION_FAILED', 'kind');
          await fails(() => add({ value: '10001' }), 'VALIDATION_FAILED', 'value');
          await fails(() => add({ value: '-1' }), 'VALIDATION_FAILED', 'value');
          await fails(() => add({ value: '5.5' }), 'VALIDATION_FAILED', 'value');
          await fails(
            () => add({ scope: 'SHOP', targetId: brand.id }),
            'VALIDATION_FAILED',
            'targetId',
          );
          await fails(
            () => add({ scope: 'BRAND', targetId: null }),
            'VALIDATION_FAILED',
            'targetId',
          );
          await fails(
            () => add({ scope: 'BRAND', targetId: id() }),
            'VALIDATION_FAILED',
            'targetId',
          );
          await fails(
            () => add({ scope: 'CATEGORY', targetId: brand.id }),
            'VALIDATION_FAILED',
            'targetId',
          );
          await fails(
            () => add({ employeeUserId: trainee.id }),
            'VALIDATION_FAILED',
            'employeeUserId',
          );
          await fails(() => add({ employeeUserId: id() }), 'VALIDATION_FAILED', 'employeeUserId');
          await fails(
            () => add({ effectiveFrom: addDays(today, -80) }),
            'VALIDATION_FAILED',
            'effectiveFrom',
          );
          await fails(() => add({ extra: 1 }), 'VALIDATION_FAILED');
          assert.equal(await tx.commissionRule.count(), 0);
          // A percentage may be 100% and a fixed amount may be large; 10000 basis points is the ceiling.
          const shop = await add({ value: '1000' });
          assert.equal(shop.item.state, 'CURRENT');
          assert.equal(shop.item.scope, 'SHOP');
          assert.equal(shop.item.target, null);
          const brandRule = await add({
            scope: 'BRAND',
            targetId: brand.id,
            value: '300',
            reason: 'Hãng này ít lãi',
          });
          assert.equal(brandRule.item.target?.id, brand.id);
          assert.equal(brandRule.item.reason, 'Hãng này ít lãi');
          const categoryRule = await add({
            scope: 'CATEGORY',
            targetId: category.id,
            kind: 'FIXED_PER_UNIT',
            value: '7000',
          });
          assert.equal(categoryRule.item.kind, 'FIXED_PER_UNIT');
          const productRule = await add({ scope: 'PRODUCT', targetId: product.id, value: '0' });
          assert.equal(productRule.item.value, '0');
          const mine = await add({
            scope: 'PRODUCT',
            targetId: product.id,
            employeeUserId: seller.id,
            value: '800',
          });
          assert.equal(mine.item.employee?.id, seller.id);
          await fails(() => add({ value: '2000' }), 'PAY_VERSION_EXISTS');
          await fails(
            () => add({ scope: 'BRAND', targetId: brand.id, value: '1' }),
            'PAY_VERSION_EXISTS',
          );
          // The same scope for a different employee, or on another day, is a different rule.
          await add({ employeeUserId: seller.id, value: '1200' });
          await add({ value: '1500', effectiveFrom: addDays(today, 7) });
          await add({ value: '700', effectiveFrom: addDays(today, -10) });
          const listed = await pay.commissionRules(payroll.token);
          assert.equal(listed.canManage, false);
          const shopStates = listed.items
            .filter((item) => item.scope === 'SHOP' && item.employee === null)
            .map((item) => [item.effectiveFrom, item.state]);
          assert.deepEqual(shopStates, [
            [addDays(today, 7), 'UPCOMING'],
            [today, 'CURRENT'],
            [addDays(today, -10), 'REPLACED'],
          ]);
          assert.ok(listed.brands.some((entry) => entry.id === brand.id));
          assert.ok(listed.categories.some((entry) => entry.id === category.id));
          assert.deepEqual(
            listed.employees
              .map((person) => person.id)
              .filter((value) => value === seller.id || value === trainee.id),
            [seller.id],
          );
          const audit = await tx.auditEvent.findMany({
            where: { action: 'COMMISSION_RULE_ADDED' },
          });
          assert.ok(audit.length >= 8);
          assert.ok(audit.every((event) => event.dataClassification === 'EMPLOYEE_PAY'));
          const row = await tx.commissionRule.findFirstOrThrow();
          await tx.$executeRawUnsafe('SAVEPOINT guard');
          await assert.rejects(
            tx.$executeRawUnsafe(
              `UPDATE commission_rules SET value = 1 WHERE id = '${row.id}'::uuid`,
            ),
            /append-only/,
          );
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT guard');
          // Database shape checks stand behind the API.
          for (const statement of [
            `INSERT INTO commission_rules (scope, brand_id, kind, value, effective_from, created_by_user_id) VALUES ('SHOP', '${brand.id}'::uuid, 'PERCENT', 1, '2030-01-01', '${owner.id}'::uuid)`,
            `INSERT INTO commission_rules (scope, kind, value, effective_from, created_by_user_id) VALUES ('SHOP', 'PERCENT', 20000, '2030-01-01', '${owner.id}'::uuid)`,
          ]) {
            await tx.$executeRawUnsafe('SAVEPOINT guard');
            await assert.rejects(
              tx.$executeRawUnsafe(statement),
              /commission_rules_(scope_shape|value)/,
            );
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT guard');
          }
        },
      );

      await suite.test(
        'product search for a rule: two characters, twenty results, a pay permission',
        async () => {
          await fails(() => pay.commissionProducts(nobody.token, 'abc'), 'FORBIDDEN');
          assert.deepEqual((await pay.commissionProducts(manager.token, 'a')).items, []);
          assert.deepEqual((await pay.commissionProducts(manager.token, undefined)).items, []);
          const row = await tx.product.findUniqueOrThrow({
            where: { id: product.id },
            select: { code: true },
          });
          const found = await pay.commissionProducts(payroll.token, row.code.slice(0, 6));
          assert.ok(found.items.some((item) => item.id === product.id));
          assert.ok(found.items.length <= 20);
        },
      );

      const hr = await base.staff(['MANAGE_EMPLOYEE_PAY'], { branchId: A.id });
      const viewer = await base.staff(['VIEW_EMPLOYEE_PAY'], { branchId: A.id });
      const elsewhere = await base.staff(['MANAGE_EMPLOYEE_PAY'], { branchId: B.id });
      const staffer = await base.staff([], { branchId: A.id });

      await suite.test(
        'salary versions: who sees and changes them, official only, history, the profile follows',
        async () => {
          const add = (patch: Record<string, unknown> = {}, token = hr.token) =>
            pay.addSalaryVersion(token, {
              employeeUserId: staffer.id,
              amountVnd: '7000000',
              effectiveFrom: addDays(today, -30),
              reason: 'Lương khởi điểm',
              ...patch,
            } as never);
          // Before any version: the profile number (none) is "not confirmed".
          const before = (await pay.salaries(payroll.token)).items.find(
            (item) => item.employee.id === staffer.id,
          )!;
          assert.equal(before.confirmed, false);
          assert.equal(before.current, null);
          assert.equal(before.versions, 0);
          assert.equal(before.profileSalaryVnd, null);
          // Authority: a viewer reads but never changes; another branch sees nothing; the payroll permission reads only.
          assert.ok(
            (await pay.salaries(viewer.token)).items.some(
              (item) => item.employee.id === staffer.id,
            ),
          );
          assert.equal((await pay.salaries(viewer.token)).canManage, false);
          await fails(() => add({}, viewer.token), 'FORBIDDEN');
          await fails(() => add({}, payroll.token), 'FORBIDDEN');
          await fails(() => add({}, elsewhere.token), 'FORBIDDEN');
          await fails(() => add({}, manager.token), 'FORBIDDEN');
          assert.equal(
            (await pay.salaries(elsewhere.token)).items.some(
              (item) => item.employee.id === staffer.id,
            ),
            false,
          );
          await fails(() => pay.salaryHistory(elsewhere.token, staffer.id), 'FORBIDDEN');
          assert.equal(await tx.employeeSalaryVersion.count(), 0);
          for (const bad of ['-1', '1.5', '01', '1,000', '', ' 5']) {
            await fails(() => add({ amountVnd: bad }), 'VALIDATION_FAILED', 'amountVnd');
          }
          for (const bad of [addDays(today, 1), addDays(today, -63), '2026-02-30', 'x']) {
            await fails(() => add({ effectiveFrom: bad }), 'VALIDATION_FAILED', 'effectiveFrom');
          }
          await fails(() => add({ employeeUserId: id() }), 'NOT_FOUND');
          await fails(() => add({ employeeUserId: trainee.id }), 'CONFLICT', 'classification');
          // The signed-in person never sets their own pay.
          await fails(() => add({ employeeUserId: hr.id }), 'FORBIDDEN');
          const first = await add();
          assert.equal(first.item.confirmed, true);
          assert.equal(first.item.current?.amountVnd, '7000000');
          assert.equal(first.item.profileSalaryVnd, '7000000');
          await fails(() => add({ amountVnd: '7100000' }), 'PAY_VERSION_EXISTS');
          const raise = await add({
            amountVnd: '8000000',
            effectiveFrom: today,
            reason: 'Tăng lương',
          });
          assert.equal(raise.item.current?.amountVnd, '8000000');
          assert.equal(raise.item.profileSalaryVnd, '8000000');
          assert.equal(raise.item.versions, 2);
          // An earlier day inside the window fills a gap without changing what is in force today.
          const gap = await add({ amountVnd: '6500000', effectiveFrom: addDays(today, -50) });
          assert.equal(gap.item.current?.amountVnd, '8000000');
          assert.equal(gap.item.profileSalaryVnd, '8000000');
          const history = await pay.salaryHistory(viewer.token, staffer.id);
          assert.deepEqual(
            history.items.map((row) => [row.effectiveFrom, row.amountVnd]),
            [
              [today, '8000000'],
              [addDays(today, -30), '7000000'],
              [addDays(today, -50), '6500000'],
            ],
          );
          assert.equal(history.items[0]?.recordedBy.id, hr.id);
          // "No salary from that date" is allowed; the profile follows it.
          const cleared = await add({
            amountVnd: null,
            effectiveFrom: addDays(today, -5),
            reason: 'Nghỉ không lương',
          });
          assert.equal(cleared.item.current?.amountVnd, '8000000');
          const audit = await tx.auditEvent.findMany({
            where: { action: 'SALARY_VERSION_ADDED', subjectUserId: staffer.id },
          });
          assert.equal(audit.length, 4);
          assert.ok(audit.every((event) => event.dataClassification === 'EMPLOYEE_PAY'));
          const standard = await tx.auditEvent.findMany({
            where: { subjectUserId: staffer.id, dataClassification: 'STANDARD' },
          });
          assert.equal(JSON.stringify(standard).includes('8000000'), false);
          const row = await tx.employeeSalaryVersion.findFirstOrThrow({
            where: { employeeUserId: staffer.id },
          });
          await tx.$executeRawUnsafe('SAVEPOINT guard');
          await assert.rejects(
            tx.$executeRawUnsafe(
              `DELETE FROM employee_salary_versions WHERE id = '${row.id}'::uuid`,
            ),
            /append-only/,
          );
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT guard');
        },
      );

      await suite.test(
        'an amount needs OFFICIAL employment on the date; an ended employee has no salary',
        async () => {
          const gone = await base.staff([], { branchId: A.id });
          await ended(gone);
          await fails(
            () =>
              pay.addSalaryVersion(hr.token, {
                employeeUserId: gone.id,
                amountVnd: '5000000',
                effectiveFrom: today,
                reason: null,
              }),
            'CONFLICT',
            'classification',
          );
          // Clearing is always allowed.
          const cleared = await pay.addSalaryVersion(hr.token, {
            employeeUserId: gone.id,
            amountVnd: null,
            effectiveFrom: today,
            reason: 'Đã nghỉ việc',
          });
          assert.equal(cleared.item.current?.amountVnd, null);
          assert.equal(
            (await pay.salaries(payroll.token)).items.some((item) => item.employee.id === gone.id),
            false,
          );
        },
      );
    });
  },
);
