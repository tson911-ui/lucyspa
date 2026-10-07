import type { ProductAccess, ProductDetailResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { productDictionary } from '../../../i18n/products';
import { owner, render } from '../../../test/support';
import { ProductCreateForm } from './product-create';
import { ProductDetailView } from './product-detail';

const p = productDictionary('vi');
const noop = () => Promise.resolve();

const product = (
  access: ProductAccess,
  withCost: boolean,
  patch: Partial<ProductDetailResponse> = {},
) =>
  ({
    id: 'p1',
    code: 'serum',
    nameVi: 'Tinh chất dưỡng ẩm',
    nameEn: 'Hydrating serum',
    descriptionVi: null,
    descriptionEn: null,
    status: 'DRAFT',
    featured: false,
    publishedAt: null,
    brand: null,
    category: null,
    rowVersion: 1,
    createdAt: '2026-10-07T00:00:00.000Z',
    updatedAt: '2026-10-07T00:00:00.000Z',
    variants: [
      {
        id: 'v1',
        sku: 'SRM-50',
        labelVi: '50 ml',
        labelEn: null,
        barcode: null,
        lowStockThreshold: 3,
        sortOrder: 0,
        isActive: true,
        rowVersion: 1,
        listPriceVnd: '250000',
        priceVersionNo: 1,
        effectivePriceVnd: '250000',
        activePromotion: null,
        promotions: [],
        priceHistory: [
          {
            versionNo: 1,
            listPriceVnd: '250000',
            reason: null,
            createdAt: '2026-10-07T01:00:00.000Z',
            createdByName: 'Owner',
          },
        ],
        // Only a response built for a cost holder carries these keys.
        ...(withCost ? { costPriceVnd: '123456', marginVnd: '126544' } : {}),
      },
    ],
    images: [],
    brandOptions: [],
    categoryOptions: [],
    access,
    ...patch,
  }) satisfies ProductDetailResponse;

const view = (data: ProductDetailResponse) =>
  render(<ProductDetailView product={data} reload={noop} />, owner);

test('without the cost permission no cost, margin or column of them is drawn', () => {
  const markup = view(product({ manage: true, prices: true, cost: false }, false));
  assert.ok(markup.includes('SRM-50'));
  assert.ok(markup.includes('250.000'));
  assert.ok(!markup.includes(p.variants.cost));
  assert.ok(!markup.includes(p.variants.margin));
  assert.ok(!markup.includes('123.456'));
  assert.ok(!markup.includes('126.544'));
});

test('even if cost data arrived, the columns follow the access flag, not the data', () => {
  const markup = view(product({ manage: true, prices: true, cost: false }, true));
  assert.ok(!markup.includes(p.variants.cost));
  assert.ok(!markup.includes('123.456'));
});

test('with the cost permission the cost and margin columns and values appear', () => {
  const markup = view(product({ manage: true, prices: true, cost: true }, true));
  assert.ok(markup.includes(p.variants.cost));
  assert.ok(markup.includes(p.variants.margin));
  assert.ok(markup.includes('123.456'));
  assert.ok(markup.includes('126.544'));
});

test('a draft has one primary action in the header, one h1, no status next to the title', () => {
  const markup = view(product({ manage: true, prices: false, cost: false }, false));
  assert.equal(markup.match(/<h1/g)?.length, 1);
  assert.ok(markup.includes(`ls-btn-label">${p.actions.publish}</span>`));
  const heading = markup.slice(markup.indexOf('<h1'), markup.indexOf('</h1>'));
  assert.ok(!heading.includes(p.status.DRAFT), 'the status badge is not inside the heading');
  assert.ok(markup.includes(p.status.DRAFT), 'the status is shown in the information card');
  assert.ok(markup.includes(p.detail.draftHint), 'the draft guidance is the header description');
  assert.ok(!markup.includes('ls-notice'), 'no page-level notice box');
  assert.ok(!markup.includes('<details'));
  assert.ok(!markup.includes('wf-table'));
});

test('a published product offers no publish action and is not offered a way back to draft', () => {
  const markup = view(
    product({ manage: true, prices: false, cost: false }, false, { status: 'PUBLISHED' }),
  );
  assert.ok(!markup.includes(`ls-btn-label">${p.actions.publish}</span>`));
  assert.ok(!markup.includes(p.detail.draftHint));
});

test('a person who may only change prices sees the catalog read-only plus price actions', () => {
  const markup = view(product({ manage: false, prices: true, cost: false }, false));
  assert.ok(!markup.includes(`ls-btn-label">${p.variants.add}</span>`));
  assert.ok(!markup.includes(`ls-btn-label">${p.detail.edit}</span>`));
  assert.ok(!markup.includes(`ls-btn-label">${p.images.add}</span>`));
  assert.ok(!markup.includes(`ls-btn-label">${p.actions.publish}</span>`));
});

test('a catalog manager sees the add-variant and add-image actions', () => {
  const markup = view(product({ manage: true, prices: false, cost: false }, false));
  assert.ok(markup.includes(`ls-btn-label">${p.variants.add}</span>`));
  assert.ok(markup.includes(`ls-btn-label">${p.images.add}</span>`));
});

test('the add-product page asks for both names and never copies one into the other', () => {
  const markup = render(
    <ProductCreateForm
      brands={[]}
      categories={[]}
      onCreated={() => undefined}
      onCancel={() => undefined}
    />,
    owner,
  );
  assert.ok(markup.includes(p.create.nameVi));
  assert.ok(markup.includes(p.create.nameEn));
  assert.ok(markup.includes(p.create.intro));
  assert.equal(markup.match(/<form/g)?.length, 1);
  // Cancel first, the primary action last.
  assert.ok(markup.indexOf('Hủy') < markup.indexOf(p.create.submit));
});
