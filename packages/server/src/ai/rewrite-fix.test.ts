import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkProductRewrite,
  factNumbers,
  type CheckOptions,
  type ProductRewriteDraft,
} from './product-rewrite.js';
import {
  fixDraft,
  plainText,
  repairTargets,
  shortenDescription,
  shortenTitle,
  sourceIngredients,
} from './rewrite-fix.js';

const SUPPLIER = [
  'Kem dưỡng ẩm Laneige Water Bank 50ml giúp cấp nước cho da khô.',
  'Thành phần: Aqua, Glycerin, Sodium Hyaluronate, Niacinamide 2%, Centella Asiatica Extract',
  'Hướng dẫn sử dụng: thoa một lượng vừa đủ lên mặt sau bước toner.',
  'Dung tích: 50ml',
].join('\n');
const ATTRIBUTES = [{ name: 'Dung tích', values: ['50ml'] }];

const CLEAN: ProductRewriteDraft = {
  descriptionVi:
    'Kem dưỡng mềm mịn giúp bạn bổ sung nước cho làn da khô sau bước toner. Kết cấu nhẹ, thấm nhanh, dung tích 50ml cho thói quen mỗi ngày tại Lucy Spa.',
  sectionsVi: {
    benefits: 'Bổ sung nước cho làn da khô.',
    ingredients: 'Aqua, Glycerin, Sodium Hyaluronate, Niacinamide, Centella Asiatica Extract.',
    usage: 'Sau toner, lấy lượng kem vừa phải rồi thoa đều lên mặt.',
    suitableFor: 'Phù hợp với hầu hết các loại da, đặc biệt da khô.',
  },
  descriptionEn:
    'A soft cream that tops up the water in dry skin after toner. The light texture sinks in quickly and the 50ml size suits a daily routine.',
  sectionsEn: {
    benefits: 'Hydrates dry skin.',
    ingredients: 'Aqua, Glycerin, Sodium Hyaluronate, Niacinamide, Centella Asiatica Extract.',
    usage: 'Apply a small amount to the face after toner.',
    suitableFor: 'Suitable for most skin types, especially dry skin.',
  },
  nameEn: 'Laneige Water Bank Cream 50ml',
  nameViSuggestion: null,
  seoTitleVi: 'Kem dưỡng ẩm Laneige Water Bank 50ml | Lucy Spa',
  seoTitleEn: 'Laneige Water Bank Cream 50ml | Lucy Spa',
  seoDescriptionVi: 'Kem dưỡng ẩm Laneige Water Bank 50ml cho da khô, có tại Lucy Spa, Đà Nẵng.',
  seoDescriptionEn:
    'Laneige Water Bank hydrating cream, 50ml, for dry skin, at Lucy Spa in Da Nang.',
  suitableForInferred: true,
  factsKept: [],
  uncertain: [],
};

const options = (patch: Partial<CheckOptions> = {}): CheckOptions => ({
  supplierText: SUPPLIER,
  attributes: ATTRIBUTES,
  brand: 'Laneige',
  nameVi: 'Kem dưỡng ẩm Laneige Water Bank 50ml',
  authenticityClaimsAllowed: false,
  bannedPhrases: [],
  ...patch,
});
const codes = (draft: ProductRewriteDraft, patch: Partial<CheckOptions> = {}) =>
  checkProductRewrite(draft, options(patch)).map(
    (warning) => `${warning.code}${warning.field ? `@${warning.field}` : ''}`,
  );
const withDraft = (patch: Partial<ProductRewriteDraft>): ProductRewriteDraft => ({
  ...CLEAN,
  ...patch,
});

test('the fixtures are clean', () => {
  assert.deepEqual(codes(CLEAN), []);
});

// ---- false positives (Owner, 2026-10-13)

test('signs in ingredient lists, steps and ratios are never a customer comment; real emoji, stars and ratings still are', () => {
  for (const clean of [
    'Aqua, Glycerin ➔ Niacinamide ™, Brand® complex ©.',
    'Dùng bước 3 trên 5 của quy trình, tỉ lệ 1/5 lượng kem.',
    'Hàm lượng 3/5 phần dầu.',
  ]) {
    const found = codes(withDraft({ descriptionVi: `${clean} ${CLEAN.descriptionVi}` }));
    assert.ok(!found.some((entry) => entry.startsWith('TESTIMONIAL')), `${clean} -> ${found}`);
  }
  for (const praise of [
    'Rất thích 🌸 mùi thơm.',
    'Đánh giá 5/5 sao.',
    'Điểm đánh giá 4.5 trên 5.',
    'Chấm ★★★★★ cho kem.',
    'Minh Thư (35 tuổi) nói rất hợp.',
  ]) {
    const found = codes(withDraft({ descriptionVi: `${praise} ${CLEAN.descriptionVi}` }));
    assert.ok(
      found.includes('TESTIMONIAL@descriptionVi'),
      `${praise} should be a comment -> ${found}`,
    );
  }
});

test('the word explore is not the clinic word; the clinic word still is', () => {
  const found = codes(withDraft({ descriptionVi: `Khám phá làn da mềm. ${CLEAN.descriptionVi}` }));
  assert.ok(!found.some((entry) => entry.startsWith('CLINIC_WORD')));
  assert.ok(
    codes(withDraft({ descriptionVi: `Phù hợp để khám da. ${CLEAN.descriptionVi}` })).includes(
      'CLINIC_WORD@descriptionVi',
    ),
  );
});

test('a percentage in a dropped marketing claim is not a missing fact; sizes, counts and SPF still are', () => {
  assert.deepEqual(factNumbers('Giảm 90% nếp nhăn, cam kết 100% tự nhiên, dung tích 50ml'), [
    '50ml',
  ]);
  const marketing = { supplierText: `${SUPPLIER}\nGiảm 90% nếp nhăn sau 7 ngày.` };
  assert.deepEqual(codes(CLEAN, marketing), []);
  assert.ok(
    codes(CLEAN, { supplierText: `${SUPPLIER}\nTúi 180ml tiết kiệm.` }).some((entry) =>
      entry.startsWith('FACT_MISSING'),
    ),
  );
});

test('ingredients named in brackets or by their INCI alias are in the source; an addition is not', () => {
  const source =
    'Thành phần: Aqua (Nước), Natri Hyaluronat, Chiết xuất rau má (Centella Asiatica Extract)';
  const draft = withDraft({
    sectionsVi: {
      ...CLEAN.sectionsVi,
      ingredients: 'Nước, Sodium Hyaluronate, Chiết xuất rau má.',
    },
    sectionsEn: {
      ...CLEAN.sectionsEn,
      ingredients: 'Water, Sodium Hyaluronate, Centella extract.',
    },
  });
  assert.ok(
    !codes(draft, { supplierText: source }).some((entry) => entry.startsWith('INGREDIENT')),
  );
  const added = withDraft({
    sectionsVi: { ...CLEAN.sectionsVi, ingredients: 'Nước, Retinol, Collagen.' },
  });
  assert.ok(
    codes(added, { supplierText: source }).includes('INGREDIENT_ADDED@sectionsVi.ingredients'),
  );
});

test('"who it suits" is always written: an empty one is flagged', () => {
  const draft = withDraft({ sectionsVi: { ...CLEAN.sectionsVi, suitableFor: null } });
  assert.ok(codes(draft).includes('EMPTY_FIELD@sectionsVi.suitableFor'));
});

// ---- the free fixes

test('plain text: markup, list markers, emoji, links and phone numbers go; lines become sentences', () => {
  assert.equal(
    plainText(
      '**Dùng** hằng ngày 🌸\n1. Rửa mặt\n2. Thoa kem tại www.example.com hoặc 0901 234 567',
    ),
    'Dùng hằng ngày. Rửa mặt. Thoa kem tại hoặc',
  );
});

test('a comment, a claim and the clinic word are removed without losing the rest; the draft is clean afterwards', () => {
  const dirty = withDraft({
    descriptionVi:
      'Kem dưỡng giúp da khô mềm mịn hơn. Minh Thư (35 tuổi) 🌸 nói rất thích. Sản phẩm dung tích 50ml, cam kết hiệu quả vĩnh viễn, dùng được mỗi ngày tại Lucy Spa. Không cần khám da trước khi dùng.',
  });
  assert.ok(codes(dirty).length > 0);
  const result = fixDraft(dirty, options());
  assert.deepEqual(codes(result.draft), []);
  assert.match(result.draft.descriptionVi, /Kem dưỡng giúp da khô mềm mịn hơn\./);
  assert.match(result.draft.descriptionVi, /dung tích 50ml/);
  assert.doesNotMatch(result.draft.descriptionVi, /Minh Thư|vĩnh viễn|khám/);
  assert.ok(result.fixes.every((fix) => fix.how === 'CODE'));
  assert.ok(result.fixes.some((fix) => fix.code === 'TESTIMONIAL'));
  assert.deepEqual(result.targets, []);
});

test('the title is shortened at a word and keeps the brand and Lucy Spa; the description ends at a sentence', () => {
  const title = 'Kem dưỡng ẩm cấp nước chuyên sâu Laneige Water Bank 50ml cho da khô | Lucy Spa';
  const short = shortenTitle(title, 'Laneige');
  assert.ok(short !== null && [...short].length <= 60);
  assert.match(short ?? '', /Laneige/);
  assert.match(short ?? '', /\| Lucy Spa$/);
  assert.equal(shortenTitle('Rất dài '.repeat(20), 'Laneige'), null);
  const long =
    'Kem dưỡng ẩm Laneige Water Bank 50ml cho da khô, cấp nước nhẹ nhàng. Thấm nhanh và không nhờn dính, hợp với thói quen mỗi ngày tại Lucy Spa Đà Nẵng và nhiều nơi khác.';
  const cut = shortenDescription(long);
  assert.ok([...cut].length <= 155);
  assert.match(cut, /[.!?]$/);
  const result = fixDraft(withDraft({ seoDescriptionVi: long, seoTitleVi: title }), options());
  assert.deepEqual(codes(result.draft), []);
  assert.ok(result.fixes.some((fix) => fix.code === 'SEO_TITLE_LONG' && fix.how === 'CODE'));
  assert.ok(result.fixes.some((fix) => fix.code === 'SEO_DESCRIPTION_LONG'));
});

test('markup in a section is flattened; a section the supplier has nothing for stays empty instead of being filled', () => {
  const result = fixDraft(
    withDraft({
      sectionsVi: {
        ...CLEAN.sectionsVi,
        usage: '1. Rửa mặt sạch\n2. Thoa kem lên mặt',
        benefits: 'Cam kết hiệu quả vĩnh viễn.',
      },
    }),
    options(),
  );
  assert.equal(result.draft.sectionsVi.usage, 'Rửa mặt sạch. Thoa kem lên mặt');
  assert.equal(result.draft.sectionsVi.benefits, null);
  assert.deepEqual(codes(result.draft), []);
});

test('an ingredient the supplier does not list is dropped; the English list is never longer; the supplier list is the fallback', () => {
  const added = fixDraft(
    withDraft({
      sectionsVi: { ...CLEAN.sectionsVi, ingredients: 'Aqua, Glycerin, Retinol.' },
      sectionsEn: { ...CLEAN.sectionsEn, ingredients: 'Aqua, Glycerin, Retinol, Collagen.' },
    }),
    { ...options(), ingredientList: sourceIngredients(SUPPLIER, ATTRIBUTES) },
  );
  assert.equal(added.draft.sectionsVi.ingredients, 'Aqua, Glycerin.');
  assert.equal(added.draft.sectionsEn.ingredients, 'Aqua, Glycerin.');
  assert.deepEqual(codes(added.draft), []);
  const none = fixDraft(
    withDraft({ sectionsVi: { ...CLEAN.sectionsVi, ingredients: 'Retinol, Collagen.' } }),
    { ...options(), ingredientList: sourceIngredients(SUPPLIER, ATTRIBUTES) },
  );
  assert.match(none.draft.sectionsVi.ingredients ?? '', /Sodium Hyaluronate/);
  assert.equal(
    sourceIngredients('Không có gì.', [{ name: 'Thành phần', values: ['Aqua', 'Glycerin'] }]),
    'Aqua, Glycerin',
  );
  assert.equal(sourceIngredients('Không có gì.', []), null);
});

test('a field the code cannot repair is a target for one model call; a fix that would add a warning elsewhere is undone', () => {
  const emptied = fixDraft(
    withDraft({ descriptionVi: 'Minh Thư (35 tuổi) 🌸 nói rất thích. Cam kết vĩnh viễn.' }),
    options(),
  );
  assert.ok(emptied.targets.some((target) => target.field === 'descriptionVi'));
  assert.ok(emptied.warnings.some((warning) => warning.code === 'EMPTY_FIELD'));
  const english = fixDraft(
    withDraft({ descriptionEn: 'Kem dưỡng ẩm rất tốt cho làn da khô, thấm nhanh và dịu nhẹ.' }),
    options(),
  );
  assert.ok(english.targets.some((target) => target.codes.includes('WRONG_LANGUAGE')));
  // The only sentence with the size is a comment too: dropping it would lose the fact, so the text stays for the model to rewrite.
  const keepsFact = fixDraft(
    withDraft({
      descriptionVi: 'Dung tích 50ml, rất thích 🌸 dùng mỗi ngày. Giúp da khô mềm hơn nhiều lắm.',
    }),
    options(),
  );
  assert.ok(!keepsFact.warnings.some((warning) => warning.code === 'FACT_MISSING'));
  assert.deepEqual(
    repairTargets([{ code: 'TOO_SIMILAR', field: 'descriptionVi' }, { code: 'SEO_DUPLICATE' }]),
    [],
  );
});

test('the official name and the numbers are never changed by a fix', () => {
  const result = fixDraft(
    withDraft({
      nameViSuggestion: 'Kem dưỡng ẩm Water Bank 50ml',
      nameEn: 'Water Bank Cream 50ml',
      seoTitleEn: 'Water Bank Cream 50ml | Lucy Spa',
    }),
    options(),
  );
  assert.equal(result.draft.nameViSuggestion, null);
  assert.match(result.draft.nameEn, /^Laneige /);
  assert.match(result.draft.nameEn, /50ml/);
});
