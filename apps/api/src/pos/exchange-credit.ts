import type { PricingV3Result } from './pricing.v3.js';
import { splitProRata } from './split.js';

/**
 * Phase 6 P6-14 (design 8.5; OQ-82, PRD 28.5): the pricing of the invoice of an exchange. PURE (integer VND in `bigint`, no I/O).
 *
 * The invoice of an exchange carries the replacement line(s) at the price of the day and ONE benefit: the exchange credit, what the
 * customer already paid for the returned units. No promotion, voucher, member discount or gift is looked at (the customer's own
 * discount is already inside the credit, and the replacement is not a second sale to discount again). So the version 3 engine is run
 * with nothing to choose from, and this function then takes the credit off the Beauty side:
 *
 *   - `PRICE_DIFFERENCE`: the credit applied is the customer's payment, but never more than the replacement is worth, so the invoice
 *     total is the difference the customer pays (zero when the replacement is not dearer);
 *   - `SAME_ITEM`: the replacement is given against the returned units at no charge (OQ-82: an exchange of the same kind has no
 *     difference), so the whole price is the credit.
 *
 * The credit is spread over the lines by the shared proportional primitive, so every line has its net amount and they add up to the
 * invoice exactly, as for any version 3 invoice. The database re-verifies all of it at commit (`lucy_check_invoice_pricing_v3`).
 */
export function applyExchangeCredit(
  base: PricingV3Result,
  exchange: { creditVnd: bigint; sameItem: boolean },
): PricingV3Result {
  const beauty = base.sides.BEAUTY;
  if (!beauty || base.sides.SPA || base.redemptions.length > 0) {
    throw new Error('The invoice of an exchange has product lines only and no other benefit.');
  }
  if (beauty.winner || beauty.member) {
    throw new Error('The invoice of an exchange is priced without any program or member discount.');
  }
  if (exchange.creditVnd < 0n) throw new RangeError('The exchange credit cannot be negative');
  const subtotal = beauty.subtotalVnd;
  const applied = exchange.sameItem
    ? subtotal
    : exchange.creditVnd < subtotal
      ? exchange.creditVnd
      : subtotal;
  const lines = base.allocations.filter((allocation) => allocation.side === 'BEAUTY');
  const shares = splitProRata(
    applied,
    lines.map((line) => line.grossVnd),
  );
  return {
    ...base,
    sides: { BEAUTY: { ...beauty, discountTotalVnd: applied, totalVnd: subtotal - applied } },
    discountTotalVnd: applied,
    totalVnd: subtotal - applied,
    allocations: lines.map((line, index) => ({
      ...line,
      discountShareVnd: shares[index] ?? 0n,
      netVnd: line.grossVnd - (shares[index] ?? 0n),
    })),
  };
}
