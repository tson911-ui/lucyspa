import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { appendLedgerEntry, LOYALTY_EVENT_TYPES, processLoyaltyEvent } from '@lucy-spa/server';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { productSaleKit } from '../testing/product-sale-kit.js';
import { customerHistory, customerSummary } from './customer-loyalty.core.js';

/**
 * Phase 6 P6-11 against real PostgreSQL (design 7, T2, T4, OQ-33, OQ-41): the Beauty wallet. The `loyalty` consumer earns Beauty points
 * once per paid episode of an invoice that has a Beauty side (key `BEAUTY_EARN:{invoice}:{paid_seq}`), for the payer only, on the
 * product amount AFTER its discounts and never on the shipping fee; a walk-in guest and a payment before go-live earn nothing; the
 * reversal of the payment or the cancellation of the invoice takes the points back by the existing rules (floor at 0 with a recorded
 * shortfall); the Beauty tier of a later invoice is read from the points earned by an earlier one and frozen in the snapshot; the
 * customer sees the Beauty points in their history and the real tier percent on the Beauty wallet. After every step the deferred
 * database checks run and the ledgers reconcile (each wallet's balance = the sum of its entries). Fixtures roll back.
 */
test(
  'Phase 6 P6-11 Beauty points: earn once per paid episode on the Beauty side net, reversal, shortfall, tier snapshot, customer history; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await productSaleKit(base);
      const { tx } = base;
      const { invoices, people } = k;
      const cream = await k.product('cream', [100_000]);
      const v100 = cream.variants[0]!;
      const serum = await k.product('serum', [250_000]);
      const v250 = serum.variants[0]!;
      for (const variant of [v100, v250]) await k.receive(variant.id, 400);

      let customers = 0;
      /** A customer with the given points in each wallet (a manual ledger entry): Silver = 500, Gold = 1000, Ruby = 10000. */
      const member = async (spa: number, beauty: number) => {
        const created = await k.customer(`b${++customers}`);
        for (const [wallet, points] of [
          ['SPA', spa],
          ['BEAUTY', beauty],
        ] as const) {
          if (points === 0) continue;
          await appendLedgerEntry(tx, {
            userId: created.id,
            wallet,
            kind: 'MANUAL_ADJUSTMENT',
            points,
            idempotencyKey: randomUUID(),
            reason: 'P6-11 fixture',
            actorUserId: people.owner.id,
          });
        }
        return created;
      };
      const events = (invoiceId: string) =>
        tx.outboxEvent.findMany({
          where: { aggregateId: invoiceId, eventType: { in: LOYALTY_EVENT_TYPES } },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        });
      /** The `loyalty` consumer catching up on every pending event of the invoice; the outcomes in order. */
      const consume = async (invoiceId: string) => {
        const outcomes: string[] = [];
        for (const event of await events(invoiceId)) {
          const outcome = await processLoyaltyEvent(tx, event.id);
          if (outcome !== 'NOT_CLAIMED') outcomes.push(`${event.eventType}:${outcome}`);
          await k.settle();
        }
        return outcomes;
      };
      const entries = (invoiceId: string, wallet: 'SPA' | 'BEAUTY') =>
        tx.loyaltyLedgerEntry.findMany({
          where: { invoiceId, wallet },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
      const balance = async (userId: string, wallet: 'SPA' | 'BEAUTY') =>
        (await tx.loyaltyWalletAccount.findUnique({ where: { userId_wallet: { userId, wallet } } }))
          ?.balancePoints ?? 0;
      /** The Owner's reconciliation rule for the ledger: each wallet's balance equals the sum of its entries. */
      const reconcileLedger = async () => {
        await k.reconcile();
        const wallets = await tx.loyaltyWalletAccount.findMany({
          select: { userId: true, wallet: true, balancePoints: true },
        });
        for (const wallet of wallets) {
          const sum = await tx.loyaltyLedgerEntry.aggregate({
            where: { userId: wallet.userId, wallet: wallet.wallet },
            _sum: { points: true },
          });
          assert.equal(wallet.balancePoints, sum._sum.points ?? 0, `balance of ${wallet.wallet}`);
        }
      };
      /** A product-only sale of the given lines, finalized and paid in full. */
      const sold = async (
        payerUserId: string | null,
        lines: [{ id: string }, number][] = [[v100, 1]],
      ) => {
        let draft = await k.openSale(people.cashier, payerUserId);
        for (const [variant, quantity] of lines)
          draft = await k.addLine(draft, variant.id, quantity);
        const done = await k.finalize(draft);
        const paid = await k.pay(done.id, done.totalVnd);
        return { done, paid };
      };

      await suite.test(
        'before go-live nothing is earned in either wallet (P5-Q1), and the invoice stays without points when go-live comes later',
        async () => {
          const payer = await member(0, 0);
          const { done } = await sold(payer.id);
          assert.deepEqual(await consume(done.id), ['INVOICE_PAID:SKIPPED_PRE_GO_LIVE']);
          assert.equal((await entries(done.id, 'BEAUTY')).length, 0);
          await tx.loyaltyGoLive.create({ data: { activatedByUserId: people.owner.id } });
          await reconcileLedger();
        },
      );

      await suite.test(
        'the payer earns Beauty points once on the product amount after the member discount; the Spa wallet is not touched; a replay writes nothing',
        async () => {
          // Silver in the Beauty wallet (500 points): 3% off 100,000 = 97,000, so 97 points.
          const payer = await member(0, 500);
          const { done } = await sold(payer.id);
          assert.equal(done.totalVnd, '97000');
          assert.deepEqual(await consume(done.id), ['INVOICE_PAID:APPLIED']);
          const earn = await entries(done.id, 'BEAUTY');
          assert.equal(earn.length, 1);
          assert.equal(earn[0]!.kind, 'EARN');
          assert.equal(earn[0]!.points, 97);
          assert.equal(earn[0]!.idempotencyKey, `BEAUTY_EARN:${done.id}:1`);
          assert.equal(earn[0]!.paidSeq, 1);
          assert.equal(earn[0]!.userId, payer.id);
          assert.equal(await balance(payer.id, 'BEAUTY'), 597);
          assert.equal(
            (await entries(done.id, 'SPA')).length,
            0,
            'a product-only sale earns no Spa point',
          );
          assert.equal(await balance(payer.id, 'SPA'), 0);
          // The event is handled once: nothing more to claim, and the ledger is unchanged.
          assert.deepEqual(await consume(done.id), []);
          assert.equal((await entries(done.id, 'BEAUTY')).length, 1);
          await reconcileLedger();
        },
      );

      await suite.test(
        'a mixed visit invoice earns in both wallets, each on its own side net (Spa never counts the products)',
        async () => {
          const payer = await member(1000, 500);
          const draft = await k.addLine(
            await k.serviceDraft([k.exact, k.ranged], payer.id),
            v100.id,
            2,
          );
          const done = await k.finalize(draft);
          await k.pay(done.id, done.totalVnd);
          // Spa: 300,000 less Gold 4% = 288,000 -> 288. Beauty: 200,000 less Silver 3% = 194,000 -> 194.
          assert.equal(done.totalVnd, '482000');
          await consume(done.id);
          assert.deepEqual(
            (await entries(done.id, 'SPA')).map((entry) => [entry.points, entry.idempotencyKey]),
            [[288, `SPA_EARN:${done.id}:1`]],
          );
          assert.deepEqual(
            (await entries(done.id, 'BEAUTY')).map((entry) => [entry.points, entry.idempotencyKey]),
            [[194, `BEAUTY_EARN:${done.id}:1`]],
          );
          await reconcileLedger();
        },
      );

      await suite.test(
        'a walk-in guest earns nothing, and a product-only sale with no product amount left earns nothing',
        async () => {
          const guest = await sold(null);
          assert.deepEqual(await consume(guest.done.id), ['INVOICE_PAID:SKIPPED_GUEST']);
          assert.equal(
            await tx.loyaltyLedgerEntry.count({ where: { invoiceId: guest.done.id } }),
            0,
          );
          // Under 1,000đ of product earns 0 points: the event is handled, no entry is written.
          const cheap = await k.product('cheap', [900]);
          await k.receive(cheap.variants[0]!.id, 5);
          const payer = await member(0, 0);
          const small = await sold(payer.id, [[cheap.variants[0]!, 1]]);
          assert.deepEqual(await consume(small.done.id), ['INVOICE_PAID:NOOP']);
          assert.equal(
            await tx.loyaltyLedgerEntry.count({ where: { invoiceId: small.done.id } }),
            0,
          );
          await reconcileLedger();
        },
      );

      await suite.test(
        'the shipping fee never earns points (OQ-41): only the product amount counts',
        // Wave 4 forbids an ONLINE invoice without its order and delivery details, so this hand-built shortcut is gone; the same check runs on
        // the real online path in online-orders/online.loyalty.integration.test.ts.
        { skip: 'superseded by online.loyalty.integration.test.ts (Wave 4)' },
        async () => {
          const payer = await member(0, 0);
          const draft = await k.addLine(await k.openSale(people.cashier, payer.id), v100.id, 2);
          // The online channel (and its fee) arrives in Wave 4: the draft row is set directly, as that wave will, to prove that the
          // earn base is the product amount and not the receivable. (The identity guard of the draft is lifted for this one statement.)
          await tx.$executeRawUnsafe('ALTER TABLE invoices DISABLE TRIGGER USER');
          await tx.$executeRawUnsafe(
            `UPDATE invoices SET channel = 'ONLINE', shipping_fee_vnd = 30000, total_vnd = total_vnd + 30000 WHERE id = '${draft.id}'::uuid`,
          );
          await tx.$executeRawUnsafe('ALTER TABLE invoices ENABLE TRIGGER USER');
          const done = await k.finalize(await invoices.get(people.cashier.token, draft.id));
          assert.equal(done.shippingFeeVnd, '30000');
          assert.equal(done.totalVnd, '230000');
          await k.pay(done.id, done.totalVnd);
          await consume(done.id);
          const earn = await entries(done.id, 'BEAUTY');
          assert.equal(earn.length, 1);
          assert.equal(earn[0]!.points, 200, '200,000 of products, not the 230,000 receivable');
          await reconcileLedger();
        },
      );

      await suite.test(
        'reversing the payment takes the Beauty points back; paying again earns a new entry for the new paid episode; cancelling a paid invoice takes them back too',
        async () => {
          const payer = await member(0, 0);
          const { done, paid } = await sold(payer.id, [[v250, 2]]);
          await consume(done.id);
          assert.equal(await balance(payer.id, 'BEAUTY'), 500);
          const reversed = await k.ok(() =>
            invoices.reversePayment(people.boss.token, done.id, paid.payment.id, {
              reason: 'Nhập nhầm',
            }),
          );
          assert.equal(reversed.invoice.status, 'PENDING_PAYMENT');
          assert.deepEqual(await consume(done.id), ['INVOICE_REOPENED:APPLIED']);
          const afterReverse = await entries(done.id, 'BEAUTY');
          assert.deepEqual(
            afterReverse.map((entry) => [entry.kind, entry.points]),
            [
              ['EARN', 500],
              ['EARN_REVERSAL', -500],
            ],
          );
          assert.equal(afterReverse[1]!.reversesEntryId, afterReverse[0]!.id);
          assert.equal(await balance(payer.id, 'BEAUTY'), 0);
          // Paid again: episode 2 earns under its own key.
          const again = await k.pay(done.id, done.totalVnd);
          await consume(done.id);
          assert.deepEqual(
            (await entries(done.id, 'BEAUTY'))
              .filter((e) => e.kind === 'EARN')
              .map((e) => e.idempotencyKey),
            [`BEAUTY_EARN:${done.id}:1`, `BEAUTY_EARN:${done.id}:2`],
          );
          assert.equal(await balance(payer.id, 'BEAUTY'), 500);
          // A paid invoice is cancelled only after its payment is reversed: the reversal takes the second episode's points back,
          // and the cancellation of the unpaid invoice that follows finds nothing more to take.
          const reopened = await k.ok(() =>
            invoices.reversePayment(people.boss.token, done.id, again.payment.id, {
              reason: 'Khách đổi ý',
            }),
          );
          assert.deepEqual(await consume(done.id), ['INVOICE_REOPENED:APPLIED']);
          await k.ok(() =>
            invoices.cancel(people.boss.token, done.id, {
              expectedVersion: reopened.invoice.version,
              reason: 'Khách đổi ý',
            }),
          );
          assert.deepEqual(await consume(done.id), ['INVOICE_CANCELLED:NOOP']);
          assert.equal(await balance(payer.id, 'BEAUTY'), 0);
          assert.equal(
            (await entries(done.id, 'BEAUTY')).filter((e) => e.kind === 'EARN_REVERSAL').length,
            2,
            'one reversal for each earned episode, none twice',
          );
          await reconcileLedger();
        },
      );

      await suite.test(
        'a reversal floors the Beauty wallet at 0 and records the shortfall when the points were spent; the Spa wallet is untouched',
        async () => {
          const payer = await member(300, 0);
          const { done, paid } = await sold(payer.id, [[v250, 1]]);
          await consume(done.id);
          assert.equal(await balance(payer.id, 'BEAUTY'), 250);
          // 240 of the 250 points are taken away by a manual deduction, then the payment is reversed.
          await appendLedgerEntry(tx, {
            userId: payer.id,
            wallet: 'BEAUTY',
            kind: 'MANUAL_ADJUSTMENT',
            points: -240,
            idempotencyKey: randomUUID(),
            reason: 'P6-11 fixture',
            actorUserId: people.owner.id,
          });
          await k.ok(() =>
            invoices.reversePayment(people.boss.token, done.id, paid.payment.id, {
              reason: 'Nhập nhầm',
            }),
          );
          await consume(done.id);
          const reversal = (await entries(done.id, 'BEAUTY')).find(
            (e) => e.kind === 'EARN_REVERSAL',
          )!;
          assert.equal(reversal.points, -10);
          assert.equal(reversal.shortfallPoints, 240);
          assert.equal(await balance(payer.id, 'BEAUTY'), 0);
          assert.equal(await balance(payer.id, 'SPA'), 300);
          await reconcileLedger();
        },
      );

      await suite.test(
        'the Beauty tier of a later invoice follows the points earned by an earlier one and is frozen in the snapshot; crossing a threshold never changes the invoice being paid',
        async () => {
          const payer = await member(0, 0);
          // First invoice: no Beauty points yet, so no discount; it earns 1,000 points and crosses Gold.
          let draft = await k.addLine(await k.openSale(people.cashier, payer.id), v250.id, 4);
          const first = await k.finalize(draft);
          assert.equal(first.totalVnd, '1000000');
          const firstSnapshot = await tx.invoiceBeautySnapshot.findUniqueOrThrow({
            where: { invoiceId: first.id },
          });
          assert.equal(firstSnapshot.tier, 'NONE');
          assert.equal(firstSnapshot.balanceBefore, 0);
          assert.equal(firstSnapshot.memberDiscountBp, 0);
          await k.pay(first.id, first.totalVnd);
          await consume(first.id);
          assert.equal(await balance(payer.id, 'BEAUTY'), 1000);
          // Second invoice: Gold, read before the invoice at finalization and frozen.
          draft = await k.addLine(await k.openSale(people.cashier, payer.id), v100.id, 1);
          const second = await k.finalize(draft);
          const secondSnapshot = await tx.invoiceBeautySnapshot.findUniqueOrThrow({
            where: { invoiceId: second.id },
          });
          assert.equal(secondSnapshot.tier, 'GOLD');
          assert.equal(secondSnapshot.balanceBefore, 1000);
          assert.equal(secondSnapshot.memberDiscountBp, 400);
          assert.equal(secondSnapshot.eligibleBeautyVnd, 100_000n);
          assert.equal(second.totalVnd, '96000');
          // The first invoice's snapshot did not move when its own points crossed the threshold.
          const again = await tx.invoiceBeautySnapshot.findUniqueOrThrow({
            where: { invoiceId: first.id },
          });
          assert.equal(again.tier, 'NONE');
          // Points of the second invoice are earned on what it was actually paid (96,000 -> 96); the Spa tier stays independent.
          await k.pay(second.id, second.totalVnd);
          await consume(second.id);
          assert.equal((await entries(second.id, 'BEAUTY'))[0]!.points, 96);
          assert.equal(await balance(payer.id, 'SPA'), 0);
          // A product-only invoice has no Spa side, hence no Spa snapshot: the two wallets' tiers are independent.
          assert.equal(
            await tx.invoiceLoyaltySnapshot.count({ where: { invoiceId: second.id } }),
            0,
          );
          await reconcileLedger();
        },
      );

      await suite.test(
        'the customer sees the Beauty points in the history and the real tier percent on the Beauty wallet',
        async () => {
          const payer = await member(0, 1000);
          const { done } = await sold(payer.id, [[v100, 1]]);
          await consume(done.id);
          const wallets = await customerSummary(tx, payer.id);
          assert.equal(wallets.live, true);
          const beauty = wallets.wallets.find((wallet) => wallet.wallet === 'BEAUTY')!;
          const spa = wallets.wallets.find((wallet) => wallet.wallet === 'SPA')!;
          assert.equal(beauty.tier, 'GOLD');
          assert.equal(beauty.memberDiscountBp, 400);
          assert.equal(beauty.balancePoints, 1000 + 96);
          assert.equal(spa.tier, 'NONE');
          assert.equal(spa.memberDiscountBp, 0);
          const history = await customerHistory(tx, payer.id, undefined);
          assert.deepEqual(
            history.items
              .filter((item) => item.wallet === 'BEAUTY')
              .map((item) => [item.kind, item.points]),
            [
              ['EARNED', 96],
              ['ADJUSTED', 1000],
            ],
          );
          assert.equal(history.items.filter((item) => item.wallet === 'SPA').length, 0);
          await reconcileLedger();
        },
      );
    });
  },
);
