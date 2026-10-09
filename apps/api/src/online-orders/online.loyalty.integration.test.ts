import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LOYALTY_EVENT_TYPES, processLoyaltyEvent } from '@lucy-spa/server';
import { onlineOrderKit } from '../testing/online-order-kit.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';

/**
 * Phase 6 Wave 4 against real PostgreSQL: the shipping fee never earns Beauty points (OQ-41). This is the real online path of the check
 * that the P6-11 suite made with a hand-built ONLINE invoice (Wave 4 forbids an online invoice without its order, so that shortcut is gone):
 * the Owner's fee setting is on, the member pays products + fee through PayOS, and the points follow the product amount only.
 */
test(
  'Phase 6 P6-22 the shipping fee of an online order never earns points; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async () => {
    await phase6Fixture(async (base) => {
      const k = await onlineOrderKit(base);
      const { tx } = base;
      await k.open();
      await k.configure({ shippingFeeEnabled: true, shippingFeeVnd: 30_000n });
      const cream = await k.stocked('cream', 100_000, 20);
      const member = await k.member('earn');
      const placed = await k.order(member, [{ variantId: cream.variantId, quantity: 2 }]);
      assert.equal(placed.shippingFeeVnd, '30000');
      assert.equal(placed.totalVnd, '230000');
      await k.payViaWebhook(member, placed);
      const events = await tx.outboxEvent.findMany({
        where: { aggregateId: placed.invoiceId, eventType: { in: LOYALTY_EVENT_TYPES } },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      });
      for (const event of events) await processLoyaltyEvent(tx, event.id);
      const earn = await tx.loyaltyLedgerEntry.findMany({
        where: { invoiceId: placed.invoiceId, wallet: 'BEAUTY' },
      });
      assert.equal(earn.length, 1);
      assert.equal(earn[0]!.points, 200, '200,000 of products, not the 230,000 receivable');
      await k.reconcileAll();
    });
  },
);
