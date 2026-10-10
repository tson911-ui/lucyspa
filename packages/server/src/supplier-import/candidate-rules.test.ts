import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluateCandidate,
  extractVolumes,
  foldText,
  hostOf,
  LUCY_SKU,
  nameKey,
  proposeSku,
  type EvaluationContext,
  type EvaluationInput,
} from './candidate-rules.js';

const context = (patch: Partial<EvaluationContext> = {}): EvaluationContext => ({
  brandMappings: new Map(),
  categoryMappings: new Map(),
  brands: [],
  categories: [],
  variants: new Map(),
  products: [],
  otherCandidates: [],
  ...patch,
});

const input = (
  patch: {
    candidate?: Partial<EvaluationInput['candidate']>;
    record?: Partial<EvaluationInput['record']>;
    host?: string | null;
    images?: EvaluationInput['images'];
  } = {},
): EvaluationInput => ({
  candidate: {
    id: 'c1',
    state: 'EXTRACTED',
    nameVi: 'Kem dưỡng ẩm Ohui 50ml',
    nameEn: 'Kem dưỡng ẩm Ohui 50ml',
    descriptionVi: 'Mô tả',
    descriptionEn: null,
    brandId: null,
    brandText: null,
    categoryId: null,
    proposedSku: null,
    warnings: [],
    ...patch.candidate,
  },
  record: {
    sourceKey: '101',
    sku: 'KD-101',
    brandText: null,
    categoryNames: ['OHUI', 'Kem Dưỡng'],
    descriptionText: 'Mô tả',
    attributeTexts: [],
    priceVnd: 350_000,
    imageUrls: ['https://haruohui.com/a.png'],
    ...patch.record,
  },
  host: patch.host === undefined ? 'haruohui.com' : patch.host,
  images: patch.images ?? [{ id: 'i1', sourceUrl: 'https://haruohui.com/a.png', flag: null }],
});

const codes = (result: ReturnType<typeof evaluateCandidate>) =>
  result.warnings.map((w) => w.code).sort();

test('the Lucy SKU format is the database rule, applied exactly: no upper-casing, no repair', () => {
  for (const ok of ['A', 'KD-101', 'P68.X_1', '0AB', 'A'.repeat(64)])
    assert.ok(LUCY_SKU.test(ok), ok);
  for (const bad of [
    '',
    'kd-101',
    'nuoc-hoa-hong-duong-trang',
    '-X',
    '.X',
    'A B',
    'Á',
    'A'.repeat(65),
    ' A',
    'A ',
  ]) {
    assert.equal(LUCY_SKU.test(bad), false, JSON.stringify(bad));
  }
});

test('SKU proposal: the supplier SKU exactly as shown; HARU-<id> only for haruohui.com; nothing for another source', () => {
  assert.deepEqual(proposeSku({ sku: 'kd-101', sourceKey: '9' }, 'haruohui.com'), {
    sku: 'kd-101',
    origin: 'SOURCE',
  });
  assert.deepEqual(proposeSku({ sku: null, sourceKey: '323' }, 'haruohui.com'), {
    sku: 'HARU-323',
    origin: 'GENERATED',
  });
  assert.deepEqual(proposeSku({ sku: '', sourceKey: '323' }, 'haruohui.com'), {
    sku: 'HARU-323',
    origin: 'GENERATED',
  });
  assert.deepEqual(proposeSku({ sku: null, sourceKey: '323' }, 'other-shop.vn'), {
    sku: null,
    origin: 'NONE',
  });
  assert.deepEqual(proposeSku({ sku: null, sourceKey: '323' }, null), {
    sku: null,
    origin: 'NONE',
  });
  assert.equal(hostOf('https://www.HaruOhui.com/'), 'haruohui.com');
});

test('a SKU that does not fit is a review item and is kept as written (lowercase slug SKUs of the real sample)', () => {
  const slug = 'nuoc-hoa-hong-duong-trang-da-ohui-extreme-white-skin-softener';
  const result = evaluateCandidate(input({ record: { sku: slug } }), context());
  assert.equal(result.proposedSku, slug, 'never upper-cased or shortened');
  const warning = result.warnings.find((w) => w.code === 'SKU_FORMAT');
  assert.ok(warning);
  assert.equal(warning['sku'], slug);
  assert.equal(result.state, 'NEEDS_REVIEW');
  // The upper-case form is only SHOWN when it would fit (and a long slug in upper case does not fit 64 characters either way).
  const short = evaluateCandidate(input({ record: { sku: 'kd-101' } }), context());
  assert.equal(short.warnings.find((w) => w.code === 'SKU_FORMAT')?.['upperCaseWouldBe'], 'KD-101');
  // Longer than a Lucy SKU can be: no proposal is stored, the review item says so.
  const long = evaluateCandidate(input({ record: { sku: `A${'B'.repeat(70)}` } }), context());
  assert.equal(long.proposedSku, null);
  assert.equal(long.warnings.find((w) => w.code === 'SKU_FORMAT')?.['tooLong'], true);
});

test('a lowercase supplier SKU that would collide once upper-cased says so, and is still not changed', () => {
  const variants = new Map([
    ['KD-101', { variantId: 'v1', productId: 'p1', productName: 'Hàng có sẵn' }],
  ]);
  const result = evaluateCandidate(input({ record: { sku: 'kd-101' } }), context({ variants }));
  assert.equal(result.proposedSku, 'kd-101');
  const format = result.warnings.find((w) => w.code === 'SKU_FORMAT');
  assert.deepEqual(format?.['upperCaseCollidesWith'], { productId: 'p1', variantId: 'v1' });
  assert.ok(!result.warnings.some((w) => w.code === 'SKU_COLLISION'), 'the exact SKU is not taken');
});

test('a SKU that already belongs to a Lucy product is a collision review item, never a link', () => {
  const variants = new Map([
    ['KD-101', { variantId: 'v1', productId: 'p1', productName: 'Hàng có sẵn' }],
  ]);
  const result = evaluateCandidate(input(), context({ variants }));
  const collision = result.warnings.find((w) => w.code === 'SKU_COLLISION');
  assert.deepEqual(
    { productId: collision?.['productId'], variantId: collision?.['variantId'] },
    { productId: 'p1', variantId: 'v1' },
  );
  assert.equal(result.state, 'NEEDS_REVIEW');
  // The generated SKU is checked the same way.
  const generated = new Map([
    ['HARU-101', { variantId: 'v2', productId: 'p2', productName: 'Khác' }],
  ]);
  const gen = evaluateCandidate(input({ record: { sku: null } }), context({ variants: generated }));
  assert.equal(gen.proposedSku, 'HARU-101');
  assert.ok(gen.warnings.some((w) => w.code === 'SKU_COLLISION'));
});

test('two candidates with the same SKU warn each other; a rejected one still counts as a name, not as a SKU twin of a live one', () => {
  const others = [
    { id: 'c2', nameVi: 'Khác', proposedSku: 'KD-101', brandId: null, state: 'EXTRACTED' },
  ];
  const result = evaluateCandidate(input(), context({ otherCandidates: others }));
  assert.equal(
    result.warnings.find((w) => w.code === 'SKU_DUPLICATE_CANDIDATE')?.['candidateId'],
    'c2',
  );
  // The candidate itself in the list is not its own twin.
  const self = [
    { id: 'c1', nameVi: 'x', proposedSku: 'KD-101', brandId: null, state: 'EXTRACTED' },
  ];
  assert.ok(
    !evaluateCandidate(input(), context({ otherCandidates: self })).warnings.some(
      (w) => w.code === 'SKU_DUPLICATE_CANDIDATE',
    ),
  );
});

test('no SKU: a review item for an unknown source, HARU-<id> for haruohui', () => {
  const none = evaluateCandidate(
    input({ record: { sku: null }, host: 'other-shop.vn' }),
    context(),
  );
  assert.ok(none.warnings.some((w) => w.code === 'SKU_MISSING'));
  assert.equal(none.proposedSku, null);
  const haru = evaluateCandidate(input({ record: { sku: null, sourceKey: '777' } }), context());
  assert.equal(haru.proposedSku, 'HARU-777');
  assert.ok(!haru.warnings.some((w) => w.code === 'SKU_MISSING'));
});

test('brand and category come from remembered mappings only; nothing is invented', () => {
  const unmapped = evaluateCandidate(
    input(),
    context({ brands: [{ id: 'b1', names: ['OHUI', 'OHUI'] }] }),
  );
  const brand = unmapped.warnings.find((w) => w.code === 'BRAND_UNMAPPED');
  assert.ok(brand);
  assert.deepEqual(
    brand['suggestions'],
    [{ id: 'b1', name: 'OHUI' }],
    'an existing brand of the same name is only suggested',
  );
  assert.equal(unmapped.brandId, null, 'a suggestion is not applied');
  assert.ok(unmapped.warnings.some((w) => w.code === 'CATEGORY_UNMAPPED'));

  const mapped = evaluateCandidate(
    input(),
    context({
      brandMappings: new Map([[foldText('Ohui'), 'b1']]),
      categoryMappings: new Map([[foldText('KEM DƯỠNG'), 'k1']]),
    }),
  );
  assert.equal(mapped.brandId, 'b1');
  assert.equal(mapped.brandText, 'OHUI');
  assert.equal(mapped.categoryId, 'k1');
  assert.ok(!mapped.warnings.some((w) => /BRAND|CATEGORY/.test(w.code)));
  // The brand text is not offered as a category any more.
  const onlyBrand = evaluateCandidate(
    input({ record: { categoryNames: ['OHUI'] } }),
    context({ brandMappings: new Map([[foldText('OHUI'), 'b1']]) }),
  );
  assert.deepEqual(onlyBrand.warnings.find((w) => w.code === 'CATEGORY_UNMAPPED')?.['texts'], []);
});

test('two different brands (or categories) behind one product are ambiguous, not guessed', () => {
  const result = evaluateCandidate(
    input({ record: { categoryNames: ['OHUI', 'THE WHOO'] } }),
    context({
      brandMappings: new Map([
        [foldText('OHUI'), 'b1'],
        [foldText('THE WHOO'), 'b2'],
      ]),
    }),
  );
  assert.equal(result.brandId, null);
  assert.ok(result.warnings.some((w) => w.code === 'BRAND_AMBIGUOUS'));
});

test('a brand, a category or a SKU already on the candidate is a decision and is never replaced', () => {
  const result = evaluateCandidate(
    input({
      candidate: { brandId: 'bX', brandText: 'Tự chọn', categoryId: 'kX', proposedSku: 'MY-SKU' },
    }),
    context({
      brandMappings: new Map([[foldText('OHUI'), 'b1']]),
      categoryMappings: new Map([[foldText('Kem Dưỡng'), 'k1']]),
    }),
  );
  assert.equal(result.brandId, 'bX');
  assert.equal(result.categoryId, 'kX');
  assert.equal(result.proposedSku, 'MY-SKU');
  assert.ok(!result.warnings.some((w) => /BRAND|CATEGORY|SKU/.test(w.code)));
});

test('possible duplicates: same folded name and sizes as a Lucy product or another candidate; a different size or brand is not one', () => {
  const products = [
    { id: 'p1', nameVi: 'KEM DƯỠNG ẨM OHUI 50 ML', nameEn: '', brandId: null },
    { id: 'p2', nameVi: 'Kem dưỡng ẩm Ohui 100ml', nameEn: '', brandId: null },
    { id: 'p3', nameVi: 'Kem dưỡng ẩm Ohui 50ml', nameEn: '', brandId: 'other-brand' },
  ];
  const others = [
    {
      id: 'c2',
      nameVi: 'kem duong am ohui 50ml',
      proposedSku: null,
      brandId: null,
      state: 'EXTRACTED',
    },
  ];
  const result = evaluateCandidate(
    input({ candidate: { brandId: 'b1' } }),
    context({ products, otherCandidates: others }),
  );
  const matches = result.warnings.find((w) => w.code === 'POSSIBLE_DUPLICATE')?.['matches'] as {
    kind: string;
    productId?: string;
    candidateId?: string;
  }[];
  assert.deepEqual(matches.map((m) => m.productId ?? m.candidateId).sort(), ['c2', 'p1']);
  const rejected = evaluateCandidate(
    input(),
    context({ otherCandidates: [{ ...others[0]!, state: 'REJECTED' }] }),
  );
  assert.ok(!rejected.warnings.some((w) => w.code === 'POSSIBLE_DUPLICATE'));
  assert.deepEqual(extractVolumes('Serum 30 ML + Kem 1,5 L (50g) 20 gr'), [
    '1.5l',
    '20g',
    '30ml',
    '50g',
  ]);
  assert.equal(nameKey('Kem 50ml'), nameKey('KEM  50 ml'));
});

test('pictures: missing while none is active; the picture import warnings stay only while they are still true', () => {
  const none = evaluateCandidate(input({ images: [] }), context());
  assert.ok(none.warnings.some((w) => w.code === 'IMAGE_MISSING'));
  const kept = evaluateCandidate(
    input({
      candidate: {
        warnings: [
          { code: 'IMAGE_FAILED', url: 'https://haruohui.com/b.png', reason: 'IMAGE_HTTP_STATUS' },
          { code: 'IMAGE_FAILED', url: 'https://haruohui.com/a.png', reason: 'IMAGE_HTTP_STATUS' },
          { code: 'IMAGE_SHARED', imageId: 'i1', kind: 'SAME_FILE' },
          { code: 'IMAGE_SHARED', imageId: 'gone', kind: 'SAME_FILE' },
          { code: 'SOMETHING_ELSE', note: 'unknown owner' },
        ],
      },
      record: { imageUrls: ['https://haruohui.com/a.png', 'https://haruohui.com/b.png'] },
      images: [{ id: 'i1', sourceUrl: 'https://haruohui.com/a.png', flag: 'SAME_FILE' }],
    }),
    context(),
  );
  const failed = kept.warnings.filter((w) => w.code === 'IMAGE_FAILED');
  assert.equal(failed.length, 1, 'the failed address that now has a picture is dropped');
  assert.equal(failed[0]?.['url'], 'https://haruohui.com/b.png');
  assert.deepEqual(
    kept.warnings.filter((w) => w.code === 'IMAGE_SHARED').map((w) => w['imageId']),
    ['i1'],
  );
  assert.ok(
    kept.warnings.some((w) => w.code === 'SOMETHING_ELSE'),
    'a warning of an unknown owner is never thrown away',
  );
});

test('the state: ready only without any warning; a flagged picture always keeps it in review; decided candidates never move', () => {
  const ready = evaluateCandidate(
    input(),
    context({
      brandMappings: new Map([[foldText('OHUI'), 'b1']]),
      categoryMappings: new Map([[foldText('Kem Dưỡng'), 'k1']]),
    }),
  );
  assert.deepEqual(ready.warnings, []);
  assert.equal(ready.state, 'READY_FOR_REVIEW');
  const flagged = evaluateCandidate(
    input({
      candidate: { warnings: [{ code: 'IMAGE_SHARED', imageId: 'i1', kind: 'SIMILAR' }] },
      images: [{ id: 'i1', sourceUrl: 'https://haruohui.com/a.png', flag: 'SIMILAR' }],
    }),
    context({
      brandMappings: new Map([[foldText('OHUI'), 'b1']]),
      categoryMappings: new Map([[foldText('Kem Dưỡng'), 'k1']]),
    }),
  );
  assert.equal(flagged.state, 'NEEDS_REVIEW');
  for (const state of ['APPROVED', 'REJECTED', 'IGNORED', 'IMPORTED']) {
    assert.equal(evaluateCandidate(input({ candidate: { state } }), context()).state, state);
  }
  // Missing translation never holds a candidate back; missing price, description or picture does.
  assert.deepEqual(
    codes(
      evaluateCandidate(
        input({
          record: { priceVnd: null, descriptionText: null },
          candidate: { descriptionVi: null },
          images: [],
        }),
        context(),
      ),
    ).filter((c) => /PRICE|DESCRIPTION|IMAGE/.test(c)),
    ['DESCRIPTION_EMPTY', 'IMAGE_MISSING', 'PRICE_MISSING'],
  );
});
