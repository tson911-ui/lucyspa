import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthError } from '../auth/auth.error.js';
import { guardError } from './product-catalog.service.js';

/**
 * The backstop of the catalog service: when a database guard of the P6-2 migrations fires despite the pre-checks (a race), the
 * person gets the precise code of the rule, not a generic failure. The messages are those the migration raises.
 */
test('database guard messages map to the precise product error', () => {
  const cases: [string, string][] = [
    [
      'The list price must stay above the price of a promotion that has not ended',
      'PRODUCT_PRICE_BELOW_PROMOTION',
    ],
    ['A promotional price is below the current list price', 'PRODUCT_PROMOTION_PRICE_INVALID'],
    ['A promotion cannot already be over', 'PRODUCT_PROMOTION_EXPIRED'],
    ['The promotion is already over', 'PRODUCT_PROMOTION_EXPIRED'],
    ['A product is published only with an active, priced variant', 'PRODUCT_PUBLISH_INCOMPLETE'],
    [
      'A published product keeps at least one active, priced variant',
      'PRODUCT_LAST_PRICED_VARIANT',
    ],
    ['A category parent must exist and must not be a child itself', 'PRODUCT_CATEGORY_DEPTH'],
    ['A category that has children cannot become a child', 'PRODUCT_CATEGORY_DEPTH'],
    ['A published product never returns to draft', 'PRODUCT_STATUS_INVALID'],
  ];
  for (const [message, code] of cases) {
    const mapped = guardError(
      Object.assign(new Error(message), { code: 'P2010', meta: { message } }),
    );
    assert.ok(mapped instanceof AuthError, message);
    assert.equal(mapped.code, code, message);
  }
  // The exclusion constraint of overlapping promotions (SQLSTATE 23P01).
  const overlap = guardError(
    Object.assign(
      new Error(
        'conflicting key value violates exclusion constraint "product_promotions_no_overlap"',
      ),
      {
        code: 'P2010',
        meta: { code: '23P01' },
      },
    ),
  );
  assert.equal(overlap?.code, 'PRODUCT_PROMOTION_OVERLAP');
  // Anything else stays unmapped (the wrapper then answers a generic conflict or failure and reveals nothing).
  assert.equal(guardError(new Error('connection reset')), null);
  assert.equal(guardError(null), null);
});
