import type { DiscountDetailResponse, DiscountVersionInput } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createRequestOf,
  emptyDiscountForm,
  formFromProgram,
  scopeHasProducts,
  scopeHasServices,
  versionInputOf,
  versionRequestOf,
  type DiscountForm,
} from './discounts';

const SERVICE = 'a0000000-0000-4000-8000-000000000001';
const CATEGORY = 'a0000000-0000-4000-8000-000000000002';
const BRAND = 'b0000000-0000-4000-8000-000000000001';
const PRODUCT_CATEGORY = 'b0000000-0000-4000-8000-000000000002';
const PRODUCT = 'b0000000-0000-4000-8000-000000000003';

const base = (over: Partial<DiscountForm> = {}): DiscountForm => ({
  ...emptyDiscountForm(),
  code: 'KEM10',
  nameVi: 'Kem 10%',
  nameEn: 'Cream 10%',
  percent: '10',
  validFrom: '2030-01-01T08:00',
  validUntil: '2030-02-01T08:00',
  ...over,
});
const versionOf = (form: DiscountForm): DiscountVersionInput => {
  const result = versionInputOf(form);
  assert.ok('version' in result, JSON.stringify(result));
  return result.version;
};

test('the scope reaches services, products or both', () => {
  assert.deepEqual(
    (['SERVICES', 'PRODUCTS', 'BOTH'] as const).map((scope) => [
      scopeHasServices(scope),
      scopeHasProducts(scope),
    ]),
    [
      [true, false],
      [false, true],
      [true, true],
    ],
  );
});

test('a new program is services-only and its payload is exactly what it was before Phase 6', () => {
  const version = versionOf(base());
  assert.equal(version.scopeMode, 'ALL_SERVICES');
  assert.ok(!('scope' in version), 'the server reads a missing scope as SERVICES');
  assert.ok(
    !('brandIds' in version) && !('productCategoryIds' in version) && !('productIds' in version),
  );
  assert.deepEqual([version.serviceIds, version.categoryIds], [[], []]);
  // Product targets ticked while the scope was another one never travel with a services program.
  const stale = versionOf(
    base({
      scopeMode: 'SELECTED',
      serviceIds: [SERVICE],
      productIds: [PRODUCT],
      brandIds: [BRAND],
    }),
  );
  assert.ok(!('productIds' in stale) && !('brandIds' in stale));
  assert.deepEqual(stale.serviceIds, [SERVICE]);
});

test('a products program with chosen targets sends the product targets and no service target', () => {
  const version = versionOf(
    base({
      scope: 'PRODUCTS',
      scopeMode: 'SELECTED',
      brandIds: [BRAND],
      productCategoryIds: [PRODUCT_CATEGORY],
      productIds: [PRODUCT],
      // Left over from a time the scope was services: they must not travel with a products program.
      serviceIds: [SERVICE],
      categoryIds: [CATEGORY],
    }),
  );
  assert.equal(version.scope, 'PRODUCTS');
  assert.deepEqual(version.brandIds, [BRAND]);
  assert.deepEqual(version.productCategoryIds, [PRODUCT_CATEGORY]);
  assert.deepEqual(version.productIds, [PRODUCT]);
  assert.deepEqual(version.serviceIds, []);
  assert.deepEqual(version.categoryIds, []);
});

test('a "both" program sends both kinds of target; a services program drops product targets', () => {
  const both = versionOf(
    base({ scope: 'BOTH', scopeMode: 'SELECTED', serviceIds: [SERVICE], productIds: [PRODUCT] }),
  );
  assert.deepEqual([both.serviceIds, both.productIds], [[SERVICE], [PRODUCT]]);
  const services = versionOf(
    base({
      scope: 'SERVICES',
      scopeMode: 'SELECTED',
      serviceIds: [SERVICE],
      productIds: [PRODUCT],
    }),
  );
  assert.deepEqual(services.serviceIds, [SERVICE]);
  assert.equal(services.productIds, undefined);
});

test('"all" sends no target at all, whatever was ticked before', () => {
  const version = versionOf(
    base({ scope: 'BOTH', scopeMode: 'ALL_SERVICES', serviceIds: [SERVICE], brandIds: [BRAND] }),
  );
  assert.equal(version.scope, 'BOTH');
  assert.deepEqual([version.serviceIds, version.brandIds], [[], []]);
});

test('"selected" needs a target of a kind the scope reaches, as the server requires', () => {
  const problem = (form: DiscountForm) => {
    const result = versionInputOf(form);
    return 'problem' in result ? result.problem : 'ok';
  };
  assert.equal(problem(base({ scopeMode: 'SELECTED' })), 'scope');
  assert.equal(problem(base({ scope: 'PRODUCTS', scopeMode: 'SELECTED' })), 'scope');
  // A service chosen earlier does not count for a products program.
  assert.equal(
    problem(base({ scope: 'PRODUCTS', scopeMode: 'SELECTED', serviceIds: [SERVICE] })),
    'scope',
  );
  assert.equal(
    problem(base({ scope: 'PRODUCTS', scopeMode: 'SELECTED', productIds: [PRODUCT] })),
    'ok',
  );
  assert.equal(
    problem(base({ scope: 'PRODUCTS', scopeMode: 'SELECTED', brandIds: [BRAND] })),
    'ok',
  );
  assert.equal(
    problem(base({ scope: 'SERVICES', scopeMode: 'SELECTED', productIds: [PRODUCT] })),
    'scope',
  );
  assert.equal(
    problem(base({ scope: 'BOTH', scopeMode: 'SELECTED', categoryIds: [CATEGORY] })),
    'ok',
  );
});

test('create and new-version requests carry the scope; a version prefilled from a products program keeps it', () => {
  const form = base({ scope: 'PRODUCTS', scopeMode: 'SELECTED', productIds: [PRODUCT] });
  const created = createRequestOf(form);
  assert.ok('body' in created);
  assert.equal(created.body.version.scope, 'PRODUCTS');
  const program = {
    id: 'p',
    code: 'KEM10',
    nameVi: 'Kem 10%',
    nameEn: 'Cream 10%',
    requiresCode: false,
    current: {
      versionNo: 2,
      kind: 'PERCENT',
      percentBp: 1000,
      fixedAmountVnd: null,
      validFrom: '2030-01-01T01:00:00.000Z',
      validUntil: '2030-02-01T01:00:00.000Z',
      minSpendVnd: '0',
      scopeMode: 'SELECTED',
      serviceIds: [],
      categoryIds: [],
      scope: 'PRODUCTS',
      brandIds: [BRAND],
      productCategoryIds: [PRODUCT_CATEGORY],
      productIds: [PRODUCT],
      usageLimitTotal: null,
      usageLimitPerCustomer: null,
    },
  } as unknown as DiscountDetailResponse;
  const prefilled = formFromProgram(program);
  assert.equal(prefilled.scope, 'PRODUCTS');
  assert.deepEqual(
    [prefilled.brandIds, prefilled.productCategoryIds, prefilled.productIds],
    [[BRAND], [PRODUCT_CATEGORY], [PRODUCT]],
  );
  const request = versionRequestOf(prefilled, 3);
  assert.ok('body' in request);
  assert.equal(request.body.version.scope, 'PRODUCTS');
  assert.deepEqual(request.body.version.productIds, [PRODUCT]);
  // A program from before Phase 6 (no scope fields in the answer) starts as services-only.
  const old = formFromProgram({
    ...program,
    current: { ...program.current, scope: undefined, brandIds: undefined, productIds: undefined },
  } as unknown as DiscountDetailResponse);
  assert.equal(old.scope, 'SERVICES');
  assert.deepEqual([old.brandIds, old.productIds], [[], []]);
});
