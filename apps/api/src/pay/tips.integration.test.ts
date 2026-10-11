import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createPayosSimulator, reconcileInvoiceEarnings } from '@lucy-spa/server';
import { MyIncomeService } from '../account/my-income.service.js';
import { InvoiceService } from '../pos/invoice.service.js';
import { PayosWebhookService } from '../pos/payos.webhook.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { productSaleKit } from '../testing/product-sale-kit.js';
import { shopToday } from './pay.access.js';
import { PayService } from './pay.service.js';

/**
 * Phase 7 P7-17 against real PostgreSQL (Owner decision of 2026-10-12): a tip exists only when the CUSTOMER adds it to a PayOS payment and
 * chooses which KTVs of the visit get how much. The provider is asked for the invoice part plus the tip; only the invoice part is credited;
 * the tip is written, with its bank-fund entry, when the provider confirms exactly that total (webhook or status read, on time or late) and
 * never otherwise. Staff cannot record or reassign a tip; the only correction is the Owner-level full reversal. Fixtures roll back.
 */
test(
  'Phase 7 P7-17 customer tips: pledge, provider total, settlement, anomalies, replay, reversal, guards; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await productSaleKit(base);
      const { tx, fails } = base;
      const { A, people, exact } = k;
      const pay = new PayService(base.adapter, base.throttle, base.environment);
      const simulator = createPayosSimulator();
      const invoices = new InvoiceService(
        base.adapter,
        base.throttle,
        base.environment,
        simulator.provider,
      );
      const webhook = new PayosWebhookService(
        { client: { $transaction: (work: never) => base.adapter.withTransaction(work) } } as never,
        simulator.provider,
        null,
      );
      const payroll = await base.staff([], { globalCodes: ['MANAGE_PAYROLL'] });
      const approver = await base.staff([], { globalCodes: ['APPROVE_PAYROLL'] });
      const viewer = await base.staff(['VIEW_INVOICES'], { branchId: A.id });
      const collector = await base.staff(['COLLECT_PAYMENTS'], { branchId: A.id });
      const second = await base.staff(['SELL_PRODUCTS'], { branchId: A.id });
      const owner = await tx.user.findFirstOrThrow({ where: { kind: 'OWNER' } });
      const id = () => randomUUID();
      const settle = async () => {
        await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
        await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
      };

      /** A finalized service invoice awaiting payment (the visit's services were done by `people.ktv`). */
      const pending = async (services = [exact]) => {
        const done = await k.finalize(await k.serviceDraft(services));
        return { invoiceId: done.id, total: BigInt(done.totalVnd) };
      };
      const payos = (
        invoiceId: string,
        amount: bigint,
        tips?: { employeeUserId: string; amountVnd: string }[],
        key: string = id(),
        actor: { token: string } = collector,
      ) =>
        invoices.createPayos(actor.token, invoiceId, {
          amountVnd: amount.toString(),
          idempotencyKey: key,
          ...(tips ? { tips } : {}),
        });
      const orderOf = async (paymentId: string) =>
        Number(
          (await tx.payment.findUniqueOrThrow({ where: { id: paymentId } })).providerOrderCode,
        );
      const deliver = async (body: unknown) => {
        const outcome = await webhook.receive(body);
        await settle();
        return outcome;
      };
      const tipsOf = (invoiceId: string) =>
        tx.tip.findMany({ where: { invoiceId }, orderBy: { seq: 'asc' } });
      const bookIn = async (fundId: string, category: 'TIP_IN') =>
        (
          await tx.fundEntry.aggregate({
            where: { fundId, category },
            _sum: { amountVnd: true },
          })
        )._sum.amountVnd ?? 0n;

      await suite.test('nothing is pledged before the Owner starts the cash book', async () => {
        const sale = await pending();
        const view = await pay.invoiceTips(collector.token, sale.invoiceId);
        assert.deepEqual(view.offer, { available: false, blockedBy: 'NOT_LIVE' });
        await fails(
          () =>
            payos(sale.invoiceId, sale.total, [
              { employeeUserId: people.ktv.id, amountVnd: '20000' },
            ]),
          'FINANCE_NOT_LIVE',
        );
        assert.equal(await tx.paymentTipPledge.count(), 0);
        // Without a tip the payment request works as before.
        const plain = await payos(sale.invoiceId, sale.total);
        assert.equal(
          simulator.orders.get(await orderOf(plain.payment.id))?.amount,
          Number(sale.total),
        );
        await invoices.cancelPayos(collector.token, sale.invoiceId, plain.payment.id);
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
        'the customer adds a tip: the provider is asked for the invoice part plus the tip; the tip is written when that total is confirmed',
        async () => {
          const sale = await pending();
          const view = await pay.invoiceTips(collector.token, sale.invoiceId);
          assert.deepEqual(view.offer, { available: true, blockedBy: null });
          assert.deepEqual(
            view.served.map((item) => [item.employee.id, item.netVnd]),
            [[people.ktv.id, '0']],
          );
          const made = await payos(sale.invoiceId, sale.total, [
            { employeeUserId: people.ktv.id, amountVnd: '50000' },
          ]);
          const orderCode = await orderOf(made.payment.id);
          // PayOS is asked for the invoice part PLUS the tip; the payment row keeps only the invoice part.
          assert.equal(simulator.orders.get(orderCode)?.amount, Number(sale.total) + 50_000);
          const row = await tx.payment.findUniqueOrThrow({ where: { id: made.payment.id } });
          assert.equal(row.amountVnd, sale.total);
          assert.equal(row.tenderedVnd, sale.total);
          assert.equal(made.payment.provider?.tipVnd, '50000');
          assert.deepEqual(
            (await tx.paymentTipPledge.findMany({ where: { paymentId: row.id } })).map((p) => [
              p.employeeUserId,
              p.amountVnd,
            ]),
            [[people.ktv.id, 50_000n]],
          );
          // Nothing is a tip yet and the invoice is still waiting.
          assert.equal((await tipsOf(sale.invoiceId)).length, 0);
          assert.equal(
            (await tx.invoice.findUniqueOrThrow({ where: { id: sale.invoiceId } })).status,
            'PENDING_PAYMENT',
          );
          // The customer pays the total.
          const outcome = await deliver(simulator.pay(orderCode, { reference: 'TF-TIP-1' }));
          assert.ok(outcome);
          const paid = await tx.invoice.findUniqueOrThrow({ where: { id: sale.invoiceId } });
          assert.equal(paid.status, 'PAID');
          assert.equal(paid.totalVnd, sale.total);
          const credited = await tx.payment.findUniqueOrThrow({ where: { id: row.id } });
          assert.equal(credited.status, 'SUCCEEDED');
          assert.equal(credited.amountVnd, sale.total);
          const tips = await tipsOf(sale.invoiceId);
          assert.equal(tips.length, 1);
          assert.equal(tips[0]?.employeeUserId, people.ktv.id);
          assert.equal(tips[0]?.amountVnd, 50_000n);
          assert.equal(tips[0]?.method, 'TRANSFER');
          assert.equal(tips[0]?.paymentId, row.id);
          const entry = await tx.fundEntry.findUniqueOrThrow({
            where: { id: tips[0]!.fundEntryId },
            include: { fund: true },
          });
          assert.equal(entry.category, 'TIP_IN');
          assert.equal(entry.direction, 'IN');
          assert.equal(entry.amountVnd, 50_000n);
          assert.equal(entry.fund.kind, 'BANK');
          assert.equal(entry.sourceType, 'TIP');
          assert.equal(entry.sourceId, tips[0]?.id);
          const audit = await tx.auditEvent.findMany({
            where: { action: 'TIP_RECORDED', entityId: tips[0]!.id },
          });
          assert.equal(audit.length, 1);
          assert.equal(audit[0]?.dataClassification, 'FINANCIAL');
          const confirmed = await tx.auditEvent.findFirstOrThrow({
            where: { action: 'PAYMENT_PROVIDER_CONFIRMED', entityId: sale.invoiceId },
          });
          assert.equal((confirmed.after as { amountVnd: string }).amountVnd, sale.total.toString());
          assert.equal((confirmed.after as { tipVnd: string }).tipVnd, '50000');
          // A replay of the same notification writes no second tip.
          await deliver(
            simulator.webhook({
              orderCode,
              amount: Number(sale.total) + 50_000,
              reference: 'TF-TIP-1',
            }),
          );
          assert.equal((await tipsOf(sale.invoiceId)).length, 1);
          assert.equal(await bookIn(entry.fundId, 'TIP_IN'), 50_000n);
          // The book view of the invoice and the offer after payment.
          const after = await pay.invoiceTips(collector.token, sale.invoiceId);
          assert.equal(after.items.length, 1);
          assert.equal(after.served[0]?.netVnd, '50000');
          assert.equal(after.offer.blockedBy, 'NOT_PAYABLE');
        },
      );

      await suite.test(
        'a customer who pays only the invoice part is an anomaly and no tip exists',
        async () => {
          const sale = await pending();
          const made = await payos(sale.invoiceId, sale.total, [
            { employeeUserId: people.ktv.id, amountVnd: '30000' },
          ]);
          const orderCode = await orderOf(made.payment.id);
          await deliver(
            simulator.pay(orderCode, { amount: Number(sale.total), reference: 'TF-TIP-2' }),
          );
          assert.equal(
            (await tx.invoice.findUniqueOrThrow({ where: { id: sale.invoiceId } })).status,
            'PENDING_PAYMENT',
          );
          assert.equal((await tipsOf(sale.invoiceId)).length, 0);
          const anomaly = await tx.paymentAnomaly.findFirstOrThrow({
            where: { invoiceId: sale.invoiceId },
          });
          assert.equal(anomaly.kind, 'AMOUNT_MISMATCH');
          assert.equal(anomaly.expectedAmountVnd, sale.total + 30_000n);
          assert.equal(anomaly.receivedAmountVnd, sale.total);
          // More than the total is also a mismatch.
          const again = await pending();
          const made2 = await payos(again.invoiceId, again.total, [
            { employeeUserId: people.ktv.id, amountVnd: '30000' },
          ]);
          await deliver(
            simulator.pay(await orderOf(made2.payment.id), {
              amount: Number(again.total) + 40_000,
              reference: 'TF-TIP-3',
            }),
          );
          assert.equal((await tipsOf(again.invoiceId)).length, 0);
        },
      );

      await suite.test(
        'a late confirmation of the exact total records the tip against the late payment',
        async () => {
          const sale = await pending();
          const made = await payos(sale.invoiceId, sale.total, [
            { employeeUserId: people.ktv.id, amountVnd: '20000' },
          ]);
          const orderCode = await orderOf(made.payment.id);
          await invoices.cancelPayos(collector.token, sale.invoiceId, made.payment.id);
          assert.equal(
            (await tx.payment.findUniqueOrThrow({ where: { id: made.payment.id } })).status,
            'CANCELLED',
          );
          await deliver(
            simulator.webhook({
              orderCode,
              amount: Number(sale.total) + 20_000,
              reference: 'TF-LATE-1',
            }),
          );
          const late = await tx.payment.findFirstOrThrow({
            where: { invoiceId: sale.invoiceId, lateOfPaymentId: made.payment.id },
          });
          assert.equal(late.status, 'SUCCEEDED');
          assert.equal(late.amountVnd, sale.total);
          const tips = await tipsOf(sale.invoiceId);
          assert.equal(tips.length, 1);
          assert.equal(tips[0]?.amountVnd, 20_000n);
          assert.equal(tips[0]?.paymentId, late.id);
          assert.equal(
            (await tx.invoice.findUniqueOrThrow({ where: { id: sale.invoiceId } })).status,
            'PAID',
          );
        },
      );

      await suite.test(
        'a status read applies the confirmation a missed webhook left, with the tip',
        async () => {
          const sale = await pending();
          const made = await payos(sale.invoiceId, sale.total, [
            { employeeUserId: people.ktv.id, amountVnd: '40000' },
          ]);
          simulator.pay(await orderOf(made.payment.id), { reference: 'TF-READ-1' });
          await invoices.refreshPayos(collector.token, sale.invoiceId, made.payment.id);
          await settle();
          assert.equal((await tipsOf(sale.invoiceId)).length, 1);
          assert.equal((await tipsOf(sale.invoiceId))[0]?.amountVnd, 40_000n);
        },
      );

      await suite.test(
        'several KTVs: the customer chooses who gets how much; staff cannot reassign',
        async () => {
          const sale = await pending([exact, exact]);
          // The second service was done by another KTV (a fixture-only change of the frozen line).
          const lines = await tx.invoiceLineService.findMany({
            where: { invoiceId: sale.invoiceId },
            orderBy: { createdAt: 'asc' },
          });
          assert.equal(lines.length, 2);
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
          await tx.$executeRawUnsafe(
            `UPDATE invoice_line_services SET employee_user_id = '${second.id}'::uuid WHERE invoice_line_id = '${lines[1]!.invoiceLineId}'::uuid`,
          );
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = DEFAULT');
          const view = await pay.invoiceTips(collector.token, sale.invoiceId);
          assert.deepEqual(
            view.served.map((item) => item.employee.id).sort(),
            [people.ktv.id, second.id].sort(),
          );
          const made = await payos(sale.invoiceId, sale.total, [
            { employeeUserId: second.id, amountVnd: '30000' },
            { employeeUserId: people.ktv.id, amountVnd: '70000' },
          ]);
          assert.equal(made.payment.provider?.tipVnd, '100000');
          const orderCode = await orderOf(made.payment.id);
          assert.equal(simulator.orders.get(orderCode)?.amount, Number(sale.total) + 100_000);
          await deliver(simulator.pay(orderCode, { reference: 'TF-MANY-1' }));
          const tips = await tipsOf(sale.invoiceId);
          assert.deepEqual(
            tips
              .map((tip) => [tip.employeeUserId, tip.amountVnd])
              .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
            [
              [people.ktv.id, 70_000n],
              [second.id, 30_000n],
            ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
          );
          // No endpoint changes a recorded choice: the route that recorded tips by staff is gone.
          assert.equal((pay as unknown as Record<string, unknown>)['recordTip'], undefined);
        },
      );

      await suite.test(
        'who may offer a tip, for whom, how much, and the replay rules',
        async () => {
          const sale = await pending();
          // Reading needs a visible invoice; a viewer sees why the tip step is not offered.
          const seen = await pay.invoiceTips(viewer.token, sale.invoiceId);
          assert.deepEqual(seen.offer, { available: false, blockedBy: 'NO_PERMISSION' });
          const stranger = await base.staff([], { branchId: A.id });
          await fails(() => pay.invoiceTips(stranger.token, sale.invoiceId), 'FORBIDDEN');
          for (const actor of [viewer, payroll])
            await fails(
              () =>
                payos(
                  sale.invoiceId,
                  sale.total,
                  [{ employeeUserId: people.ktv.id, amountVnd: '20000' }],
                  id(),
                  actor,
                ),
              'FORBIDDEN',
            );
          const one = (over: Record<string, unknown>) => [
            { employeeUserId: people.ktv.id, amountVnd: '20000', ...over },
          ];
          // Only a KTV who performed a service on the invoice.
          await fails(
            () => payos(sale.invoiceId, sale.total, one({ employeeUserId: collector.id })),
            'VALIDATION_FAILED',
            'tips.employeeUserId',
          );
          for (const amountVnd of [
            '0',
            '500',
            '1500',
            '-5',
            '1.5',
            '',
            'abc',
            '10001000',
            '99999999999',
          ]) {
            await fails(
              () => payos(sale.invoiceId, sale.total, one({ amountVnd })),
              'VALIDATION_FAILED',
            );
          }
          await fails(
            () =>
              payos(sale.invoiceId, sale.total, [
                { employeeUserId: people.ktv.id, amountVnd: '20000' },
                { employeeUserId: people.ktv.id, amountVnd: '30000' },
              ]),
            'VALIDATION_FAILED',
            'tips.employeeUserId',
          );
          await fails(
            () => payos(sale.invoiceId, sale.total, one({ extra: 1 })),
            'VALIDATION_FAILED',
          );
          assert.equal(
            await tx.paymentTipPledge.count({ where: { payment: { invoiceId: sale.invoiceId } } }),
            0,
          );
          assert.equal(await tx.payment.count({ where: { invoiceId: sale.invoiceId } }), 0);
          // The same request again with the same choice is a replay; with another choice, a conflict.
          const key = id();
          const first = await payos(sale.invoiceId, sale.total, one({}), key);
          const replay = await payos(sale.invoiceId, sale.total, one({}), key);
          assert.equal(replay.payment.id, first.payment.id);
          await fails(
            () => payos(sale.invoiceId, sale.total, one({ amountVnd: '30000' }), key),
            'CONFLICT',
          );
          await fails(() => payos(sale.invoiceId, sale.total, undefined, key), 'CONFLICT');
          assert.equal(
            await tx.paymentTipPledge.count({ where: { paymentId: first.payment.id } }),
            1,
          );
        },
      );

      await suite.test(
        'the database freezes a pledge and refuses one for a stranger or a request that has its link',
        async () => {
          const sale = await pending();
          const refuses = async (work: () => Promise<unknown>, pattern: RegExp) => {
            await tx.$executeRawUnsafe('SAVEPOINT guard');
            await assert.rejects(work, pattern);
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT guard');
          };
          const made = await payos(sale.invoiceId, sale.total, [
            { employeeUserId: people.ktv.id, amountVnd: '20000' },
          ]);
          const pledge = await tx.paymentTipPledge.findFirstOrThrow({
            where: { paymentId: made.payment.id },
          });
          await refuses(
            () =>
              tx.$executeRawUnsafe(
                `UPDATE payment_tip_pledges SET amount_vnd = 1000 WHERE id = '${pledge.id}'::uuid`,
              ),
            /never changed or deleted/,
          );
          await refuses(
            () =>
              tx.$executeRawUnsafe(
                `DELETE FROM payment_tip_pledges WHERE id = '${pledge.id}'::uuid`,
              ),
            /never changed or deleted/,
          );
          // The request already has its link (the provider answered): no further pledge.
          await refuses(
            () =>
              tx.paymentTipPledge.create({
                data: { paymentId: made.payment.id, employeeUserId: second.id, amountVnd: 20_000n },
              }),
            /only with a new PayOS request/,
          );
          // A pending request without a link takes a pledge only for a KTV of the invoice, in whole thousands, up to the limit.
          const bare = await pending();
          const row = await tx.payment.create({
            data: {
              invoiceId: bare.invoiceId,
              branchId: A.id,
              method: 'PAYOS',
              status: 'PENDING',
              amountDueVnd: bare.total,
              amountVnd: bare.total,
              tenderedVnd: bare.total,
              changeVnd: 0n,
              collectedByUserId: collector.id,
              idempotencyKey: id(),
              providerOrderCode: BigInt(Date.now()) * 1000n + 7n,
              expiresAt: new Date(Date.now() + 600_000),
            },
          });
          await refuses(
            () =>
              tx.paymentTipPledge.create({
                data: { paymentId: row.id, employeeUserId: second.id, amountVnd: 20_000n },
              }),
            /KTV who performed a service/,
          );
          await refuses(
            () =>
              tx.paymentTipPledge.create({
                data: { paymentId: row.id, employeeUserId: people.ktv.id, amountVnd: 1_500n },
              }),
            /payment_tip_pledges_amount/,
          );
          await refuses(
            () =>
              tx.paymentTipPledge.create({
                data: { paymentId: row.id, employeeUserId: people.ktv.id, amountVnd: 10_001_000n },
              }),
            /add up to at most|payment_tip_pledges_amount/,
          );
          await tx.paymentTipPledge.create({
            data: { paymentId: row.id, employeeUserId: people.ktv.id, amountVnd: 20_000n },
          });
          await refuses(
            () =>
              tx.paymentTipPledge.create({
                data: { paymentId: row.id, employeeUserId: people.ktv.id, amountVnd: 20_000n },
              }),
            /payment_tip_pledges_person_key|Unique constraint/,
          );
        },
      );

      await suite.test(
        'the only correction is the Owner-level full reversal, with a reason, audited',
        async () => {
          const sale = await pending();
          const made = await payos(sale.invoiceId, sale.total, [
            { employeeUserId: people.ktv.id, amountVnd: '50000' },
          ]);
          await deliver(simulator.pay(await orderOf(made.payment.id), { reference: 'TF-REV-1' }));
          const tip = await tx.tip.findFirstOrThrow({ where: { invoiceId: sale.invoiceId } });
          const entry = await tx.fundEntry.findUniqueOrThrow({ where: { id: tip.fundEntryId } });
          const reverse = (token: string, over: Record<string, unknown> = {}) =>
            pay.reverseTip(token, tip.id, {
              reason: 'Khách chuyển nhầm',
              clientRequestId: id(),
              ...over,
            } as never);
          // The cashier who collected, a viewer, even payroll management: not the Owner-level approval.
          for (const actor of [viewer, collector, payroll])
            await fails(() => reverse(actor.token), 'FORBIDDEN');
          const view = await pay.invoiceTips(collector.token, sale.invoiceId);
          assert.equal(view.items[0]?.canReverse, false);
          assert.equal(
            (await pay.invoiceTips(approver.token, sale.invoiceId)).items[0]?.canReverse,
            true,
          );
          await fails(
            () => reverse(approver.token, { reason: '  ' }),
            'VALIDATION_FAILED',
            'reason',
          );
          await fails(
            () => pay.reverseTip(approver.token, id(), { reason: 'x', clientRequestId: id() }),
            'NOT_FOUND',
          );
          const request = id();
          const result = await reverse(approver.token, { clientRequestId: request });
          assert.equal(result.items.length, 2);
          assert.equal(result.items[1]?.amountVnd, '-50000');
          assert.equal(result.items[1]?.reversesId, tip.id);
          assert.equal(result.served[0]?.netVnd, '0');
          const correction = await tx.fundEntry.findFirstOrThrow({
            where: { reversesEntryId: entry.id },
          });
          assert.equal(correction.category, 'CORRECTION');
          assert.equal(correction.direction, 'OUT');
          assert.equal(correction.amountVnd, 50_000n);
          assert.equal(
            (await reverse(approver.token, { clientRequestId: request })).items.length,
            2,
          );
          await fails(() => reverse(approver.token), 'CONFLICT');
          const audit = await tx.auditEvent.findMany({
            where: { action: 'TIP_REVERSED', entityId: tip.id },
          });
          assert.equal(audit.length, 1);
          assert.equal(audit[0]?.reason, 'Khách chuyển nhầm');
          // The payment and the invoice are untouched by a tip correction.
          assert.equal(
            (await tx.invoice.findUniqueOrThrow({ where: { id: sale.invoiceId } })).status,
            'PAID',
          );
        },
      );

      await suite.test(
        'a tip taken by a payroll run cannot be reversed; the database refuses edits, deletes and bad reversals',
        async () => {
          const sale = await pending();
          const made = await payos(sale.invoiceId, sale.total, [
            { employeeUserId: people.ktv.id, amountVnd: '50000' },
          ]);
          await deliver(simulator.pay(await orderOf(made.payment.id), { reference: 'TF-DB-1' }));
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
          // One tip per payment and KTV.
          await refuses(
            `INSERT INTO tips (branch_id, invoice_id, employee_user_id, amount_vnd, method, business_date, recorded_by_user_id, client_request_id, fund_entry_id, payment_id)
           VALUES ('${tip.branchId}'::uuid, '${tip.invoiceId}'::uuid, '${tip.employeeUserId}'::uuid, 1000, 'TRANSFER', '2026-10-12',
                   '${tip.recordedByUserId}'::uuid, '${id()}'::uuid, '${tip.fundEntryId}'::uuid, '${tip.paymentId}'::uuid)`,
            /tips_payment_person_key/,
          );
          const insert = (amount: number) =>
            `INSERT INTO tips (branch_id, invoice_id, employee_user_id, amount_vnd, method, business_date, reverses_id, reason, recorded_by_user_id, client_request_id, fund_entry_id)
           VALUES ('${tip.branchId}'::uuid, '${tip.invoiceId}'::uuid, '${tip.employeeUserId}'::uuid, ${amount}, 'TRANSFER', '2026-10-12',
                   '${tip.id}'::uuid, 'x', '${tip.recordedByUserId}'::uuid, '${id()}'::uuid, '${tip.fundEntryId}'::uuid)`;
          await refuses(insert(-49_999), /in full/);
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
              pay.reverseTip(approver.token, tip.id, { reason: 'Muộn rồi', clientRequestId: id() }),
            'TIP_CLAIMED',
          );
          const view = await pay.invoiceTips(approver.token, sale.invoiceId);
          assert.equal(view.items[0]?.claimed, true);
          assert.equal(view.items[0]?.canReverse, false);
        },
      );

      await suite.test(
        'tips stay outside revenue and commission, and My Income shows them net of a reversal',
        async () => {
          const today = shopToday(new Date());
          const income = new MyIncomeService(base.adapter, base.throttle);
          const read = async () => {
            const response = await income.get(people.ktv.token, { period: 'DAY', date: today });
            assert.ok(response.earnings, 'live: the sources are available');
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
          const sale = await pending();
          const made = await payos(sale.invoiceId, sale.total, [
            { employeeUserId: people.ktv.id, amountVnd: '40000' },
          ]);
          await deliver(simulator.pay(await orderOf(made.payment.id), { reference: 'TF-INC-1' }));
          await reconcileInvoiceEarnings(tx, sale.invoiceId);
          const after = await read();
          assert.equal(BigInt(after.tourVnd) - BigInt(before.tourVnd), 15_000n);
          assert.equal(BigInt(after.tipsVnd) - BigInt(before.tipsVnd), 40_000n);
          assert.equal(after.tipCount - before.tipCount, 1);
          assert.equal(after.commissionVnd, before.commissionVnd);
          // Revenue and the loyalty base are the invoice's own total, not the tip.
          assert.equal(
            (await tx.invoice.findUniqueOrThrow({ where: { id: sale.invoiceId } })).totalVnd,
            sale.total,
          );
          const earned = await tx.payEarning.findMany({ where: { invoiceId: sale.invoiceId } });
          assert.equal(
            earned.every((row) => row.amountVnd !== 40_000n),
            true,
          );
          const tip = await tx.tip.findFirstOrThrow({ where: { invoiceId: sale.invoiceId } });
          await pay.reverseTip(approver.token, tip.id, { reason: 'Nhầm', clientRequestId: id() });
          const undone = await read();
          assert.equal(undone.tipsVnd, before.tipsVnd);
          const colleague = await income.get(people.cashier.token, { period: 'DAY', date: today });
          assert.equal(colleague.earnings?.tipsVnd, '0');
        },
      );
    });
  },
);
