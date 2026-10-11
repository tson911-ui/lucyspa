import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconcileInvoiceEarnings } from '@lucy-spa/server';
import { onlineOrderKit } from '../testing/online-order-kit.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { shopToday } from './pay.access.js';
import { PayService } from './pay.service.js';

/**
 * Phase 7 P7-10b against real PostgreSQL (design section 14, P7-T16; Owner answer 3): staff referral codes. Only the Owner's click makes a
 * code, only for an OFFICIAL employee; a reset keeps the old code as history; the online checkout takes the code, refuses a wrong or
 * switched-off one with one answer, stores it on the order for good, and the person it names earns commission on the online line (the same
 * engine, the same base). Fixtures roll back.
 */
test(
  'Phase 7 P7-10b staff referral codes: create, reset, checkout, frozen on the order, commission; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await onlineOrderKit(base);
      const { tx, fails } = base;
      const pay = new PayService(base.adapter, base.throttle);
      const today = shopToday(new Date());
      const rules = await base.staff([], { globalCodes: ['MANAGE_PAY_RULES'] });
      const reader = await base.staff([], { globalCodes: ['APPROVE_PAYROLL'] });
      const nobody = await base.staff([], { branchId: k.A.id });
      const owner = await tx.user.findFirstOrThrow({ where: { kind: 'OWNER' } });
      const seller = k.people.cashier;
      const other = k.people.ktv;
      const ended = await base.staff([], { branchId: k.A.id });
      await tx.employmentClassificationChange.create({
        data: {
          employeeUserId: ended.id,
          classification: 'ENDED',
          effectiveDate: new Date('2021-01-01'),
          recordedByUserId: owner.id,
        },
      });
      const create = (employeeUserId: string, token = rules.token) =>
        pay.createStaffCode(token, { employeeUserId });
      const codeOf = async (employeeUserId: string) =>
        (
          await tx.employeeReferralCode.findFirstOrThrow({
            where: { employeeUserId, isActive: true },
          })
        ).code;
      const cream = await k.stocked('cream', 200_000, 60);

      await suite.test(
        'nothing exists until the Owner presses the button; only official staff get a code',
        async () => {
          const empty = await pay.staffCodes(rules.token);
          assert.equal(empty.canManage, true);
          assert.equal(empty.today, today);
          assert.ok(empty.items.length >= 2);
          assert.ok(empty.items.every((item) => item.code === null && item.history.length === 0));
          assert.equal(await tx.employeeReferralCode.count(), 0);
          assert.equal((await pay.staffCodes(reader.token)).canManage, false);
          await fails(() => pay.staffCodes(nobody.token), 'FORBIDDEN');
          for (const actor of [nobody, reader])
            await fails(() => create(seller.id, actor.token), 'FORBIDDEN');
          await fails(() => create(ended.id), 'VALIDATION_FAILED', 'employeeUserId');
          await fails(() => create('not-a-uuid'), 'VALIDATION_FAILED', 'employeeUserId');
          await fails(
            () =>
              pay.createStaffCode(rules.token, { employeeUserId: seller.id, extra: 1 } as never),
            'VALIDATION_FAILED',
          );
          const made = await create(seller.id);
          const mine = made.items.find((item) => item.employee.id === seller.id)!;
          assert.match(mine.code ?? '', /^[A-HJ-NP-Z2-9]{6}$/);
          assert.equal(mine.orders, 0);
          await fails(() => create(seller.id), 'CONFLICT');
          const audit = await tx.auditEvent.findMany({
            where: { action: 'STAFF_CODE_CREATED', subjectUserId: seller.id },
          });
          assert.equal(audit.length, 1);
          assert.equal(audit[0]?.dataClassification, 'EMPLOYEE_PAY');
        },
      );

      await suite.test(
        'a reset switches the old code off, keeps it as history and never reuses it',
        async () => {
          const before = await codeOf(seller.id);
          await fails(
            () => pay.resetStaffCode(rules.token, seller.id, { reason: '  ' }),
            'VALIDATION_FAILED',
            'reason',
          );
          await fails(
            () => pay.resetStaffCode(nobody.token, seller.id, { reason: 'Lộ mã' }),
            'FORBIDDEN',
          );
          await fails(
            () => pay.resetStaffCode(rules.token, other.id, { reason: 'Lộ mã' }),
            'NOT_FOUND',
          );
          await fails(
            () => pay.resetStaffCode(rules.token, ended.id, { reason: 'Lộ mã' }),
            'VALIDATION_FAILED',
            'id',
          );
          const reset = await pay.resetStaffCode(rules.token, seller.id, { reason: 'Lộ mã' });
          const mine = reset.items.find((item) => item.employee.id === seller.id)!;
          assert.notEqual(mine.code, before);
          assert.deepEqual(
            mine.history.map((item) => [item.code, item.active, item.deactivationReason]),
            [[before, false, 'Lộ mã']],
          );
          const rows = await tx.employeeReferralCode.findMany({
            where: { employeeUserId: seller.id },
          });
          assert.equal(rows.length, 2);
          assert.equal(rows.filter((row) => row.isActive).length, 1);
          assert.equal(
            await tx.auditEvent.count({
              where: { action: 'STAFF_CODE_RESET', subjectUserId: seller.id },
            }),
            1,
          );
        },
      );

      await suite.test('the database keeps codes unique, immutable and never deleted', async () => {
        const row = await tx.employeeReferralCode.findFirstOrThrow({
          where: { employeeUserId: seller.id, isActive: true },
        });
        const refuses = async (statement: string, pattern: RegExp) => {
          await tx.$executeRawUnsafe('SAVEPOINT guard');
          await assert.rejects(tx.$executeRawUnsafe(statement), pattern);
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT guard');
        };
        await refuses(
          `UPDATE employee_referral_codes SET code = 'ZZZZZZ' WHERE id = '${row.id}'::uuid`,
          /never changes/,
        );
        await refuses(
          `DELETE FROM employee_referral_codes WHERE id = '${row.id}'::uuid`,
          /never deleted/,
        );
        await refuses(
          `INSERT INTO employee_referral_codes (employee_user_id, code, created_by_user_id) VALUES ('${other.id}'::uuid, '${row.code}', '${owner.id}'::uuid)`,
          /employee_referral_codes_code_key|duplicate key/,
        );
        await refuses(
          `INSERT INTO employee_referral_codes (employee_user_id, code, created_by_user_id) VALUES ('${other.id}'::uuid, 'AB0CDE', '${owner.id}'::uuid)`,
          /employee_referral_codes_code_shape/,
        );
        await refuses(
          `INSERT INTO employee_referral_codes (employee_user_id, code, created_by_user_id) VALUES ('${seller.id}'::uuid, 'QWERTY', '${owner.id}'::uuid)`,
          /employee_referral_codes_one_active_key|duplicate key/,
        );
      });

      await k.open();
      await tx.financeGoLive.create({
        data: { id: 1, at: new Date(), setByUserId: owner.id, reauthenticatedAt: new Date() },
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
        'the checkout refuses a wrong code with one answer and keeps the cart',
        async () => {
          const hoa = await k.member('hoa');
          await k.addToCart(hoa, cream.variantId, 2);
          const retired = (
            await tx.employeeReferralCode.findFirstOrThrow({
              where: { employeeUserId: seller.id, isActive: false },
            })
          ).code;
          for (const referralCode of ['ZZZZZZ', retired, 'ab', 'xxxxxx xxxxxx xxxxxx', '000000']) {
            await fails(() => k.online.quote(hoa.token, { referralCode }), 'REFERRAL_CODE_INVALID');
            await fails(
              async () => k.online.place(hoa.token, await k.checkoutRequest({ referralCode })),
              'REFERRAL_CODE_INVALID',
            );
          }
          await fails(
            () => k.online.quote(hoa.token, { referralCode: 5 as never }),
            'VALIDATION_FAILED',
            'referralCode',
          );
          assert.equal(await tx.orderReferral.count(), 0);
          assert.equal((await k.cart(hoa)).lines.length, 1);
          // A code of someone who is no longer official stops working at once.
          const departing = await create(other.id);
          const theirs = departing.items.find((item) => item.employee.id === other.id)!.code!;
          await tx.employmentClassificationChange.create({
            data: {
              employeeUserId: other.id,
              classification: 'ENDED',
              effectiveDate: new Date(today),
              recordedByUserId: owner.id,
            },
          });
          await fails(
            () => k.online.quote(hoa.token, { referralCode: theirs }),
            'REFERRAL_CODE_INVALID',
          );
          const list = await pay.staffCodes(rules.token);
          assert.deepEqual(
            list.retired.map((item) => [item.employee.id, item.code]),
            [[other.id, theirs]],
          );
          assert.equal(
            list.items.some((item) => item.employee.id === other.id),
            false,
          );
        },
      );

      await suite.test(
        'a valid code (any case) is stored on the order, frozen, and the person it names earns commission',
        async () => {
          const mai = await k.member('mai');
          const code = await codeOf(seller.id);
          await k.addToCart(mai, cream.variantId, 2);
          const quote = await k.online.quote(mai.token, {
            referralCode: ` ${code.toLowerCase()} `,
          });
          assert.equal(quote.referralCode, code);
          assert.equal(await tx.orderReferral.count(), 0, 'a quote saves nothing');
          const placed = await k.place(mai, { referralCode: code.toLowerCase() });
          const invoice = await tx.invoice.findFirstOrThrow({ where: { payerUserId: mai.id } });
          const stored = await tx.orderReferral.findUniqueOrThrow({
            where: { invoiceId: invoice.id },
          });
          assert.equal(stored.employeeUserId, seller.id);
          assert.equal(stored.code, code);
          // The line has no seller (the existing rule stands); the order names who earns.
          const line = await tx.invoiceLineProduct.findFirstOrThrow({
            where: { invoiceId: invoice.id },
          });
          assert.equal(line.sellerUserId, null);
          assert.equal(
            (await pay.staffCodes(rules.token)).items.find((item) => item.employee.id === seller.id)
              ?.orders,
            1,
          );
          // Nothing is earned before payment.
          assert.deepEqual(await reconcileInvoiceEarnings(tx, invoice.id), { written: 0 });
          await k.payViaWebhook(mai, placed);
          assert.deepEqual(await reconcileInvoiceEarnings(tx, invoice.id), { written: 1 });
          const [earning] = await tx.payEarning.findMany({ where: { invoiceId: invoice.id } });
          assert.equal(earning?.kind, 'PRODUCT_COMMISSION');
          assert.equal(earning?.employeeUserId, seller.id);
          assert.equal(earning?.baseVnd, 400_000n);
          assert.equal(earning?.amountVnd, 20_000n);
          assert.deepEqual(await reconcileInvoiceEarnings(tx, invoice.id), { written: 0 });
          // The earnings view names the person the code points to.
          const earned = await pay.invoiceEarnings(reader.token, invoice.id);
          assert.equal(earned.lines[0]?.person?.id, seller.id);
          assert.equal(earned.items[0]?.employee.id, seller.id);
          // A reset later does not touch the order: it keeps the code it was placed with, and nothing can change it.
          await pay.resetStaffCode(rules.token, seller.id, { reason: 'Đổi mã định kỳ' });
          assert.equal(
            (await tx.orderReferral.findUniqueOrThrow({ where: { invoiceId: invoice.id } })).code,
            code,
          );
          for (const statement of [
            `UPDATE order_referrals SET employee_user_id = '${other.id}'::uuid WHERE invoice_id = '${invoice.id}'::uuid`,
            `DELETE FROM order_referrals WHERE invoice_id = '${invoice.id}'::uuid`,
          ]) {
            await tx.$executeRawUnsafe('SAVEPOINT guard');
            await assert.rejects(tx.$executeRawUnsafe(statement));
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT guard');
          }
          await k.reconcileAll();
        },
      );

      await suite.test(
        'an online order without a code earns nothing; nobody is invented',
        async () => {
          const binh = await k.member('binh');
          const placed = await k.order(binh, [{ variantId: cream.variantId, quantity: 1 }]);
          const invoice = await tx.invoice.findFirstOrThrow({ where: { payerUserId: binh.id } });
          await k.payViaWebhook(binh, placed);
          assert.deepEqual(await reconcileInvoiceEarnings(tx, invoice.id), { written: 0 });
          assert.equal(await tx.payEarning.count({ where: { invoiceId: invoice.id } }), 0);
          assert.equal(await tx.orderReferral.count({ where: { invoiceId: invoice.id } }), 0);
          await k.reconcileAll();
        },
      );
    });
  },
);
