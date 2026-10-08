import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getWorkforceDictionary } from '../../../i18n/workforce';
import { employee, owner, render } from '../../../test/support';
import { emptyDiscountForm } from '../../../lib/workforce/discounts';
import { DiscountFormFields } from './discount-form';
import { DiscountNewScreen } from './discount-new';
import { ProductTargetsFields, orderedCategories, type ProductCatalog } from './discount-targets';
import { DiscountsScreen } from './discounts';
import { DiscountVersionScreen } from './discount-version';

const vi = getWorkforceDictionary('vi');
const d = vi.discounts;

test('the list says so without a discount permission and offers no create action', () => {
  const markup = render(<DiscountsScreen />, employee([['VIEW_ATTENDANCE', 'A']]));
  assert.ok(markup.includes(d.noAccess));
  assert.ok(!markup.includes(`ls-btn-label">${d.create}</span>`));
});

test('the list is one page title over a kit table, not a legacy table', () => {
  const markup = render(<DiscountsScreen />, owner);
  assert.equal(markup.match(/<h1/g)?.length, 1);
  assert.ok(!markup.includes('wf-table'));
});

test('creating is a page of five sections, with no native fieldset or disclosure', () => {
  const markup = render(<DiscountNewScreen />, owner);
  for (const section of [
    d.sectionProgram,
    d.sectionBenefit,
    d.sectionWindow,
    d.sectionScope,
    d.sectionLimits,
  ]) {
    assert.ok(markup.includes(section), section);
  }
  assert.equal(markup.match(/<h1/g)?.length, 1);
  assert.ok(markup.includes(d.code));
  assert.ok(!markup.includes('<fieldset'));
  assert.ok(!markup.includes('<details'));
  // Cancel then the primary action, last.
  assert.ok(
    markup.indexOf(vi.common.cancel) < markup.lastIndexOf(`ls-btn-label">${d.create}</span>`),
  );
});

test('a new version is a page too: loading state without a drawer', () => {
  const markup = render(<DiscountVersionScreen id="x" />, owner);
  assert.ok(!markup.includes('ls-drawer'));
  assert.ok(!markup.includes('<fieldset'));
});

test('a viewer cannot create programs', () => {
  const markup = render(<DiscountNewScreen />, employee([['CREATE_VOUCHERS']]));
  assert.ok(markup.includes(vi.errors.forbidden));
  assert.ok(!markup.includes('<form'));
});

test('the scope is chosen first: services, products or both, then everything or only the items chosen', () => {
  for (const locale of ['vi', 'en'] as const) {
    const t = getWorkforceDictionary(locale).discounts;
    const markup = render(<DiscountNewScreen />, owner, locale);
    for (const label of [
      t.scope,
      t.selection,
      ...Object.values(t.scopeKinds),
      t.allOf.SERVICES,
      t.selectedOnly,
    ]) {
      assert.ok(markup.includes(label), label);
    }
    assert.ok(markup.indexOf(t.scope) < markup.indexOf(t.selection));
    // Nothing is chosen yet, so no target list is asked for.
    assert.ok(!markup.includes(t.productSearch));
  }
});

test('the "all" option names the scope: all services, all products, all of both', () => {
  const t = vi.discounts;
  for (const scope of ['SERVICES', 'PRODUCTS', 'BOTH'] as const) {
    const markup = render(
      <DiscountFormFields
        form={{ ...emptyDiscountForm(), scope }}
        setForm={() => undefined}
        mode="create"
      />,
      owner,
    );
    assert.ok(markup.includes(t.allOf[scope]), scope);
    assert.ok(!markup.includes('<fieldset'));
  }
  assert.ok(!t.minSpendHint.includes('khám'));
});

const catalog = (over: Partial<ProductCatalog> = {}): ProductCatalog => ({
  brands: [
    {
      id: 'b1',
      code: 'B1',
      nameVi: 'Thương hiệu A',
      nameEn: 'Brand A',
      isActive: true,
      rowVersion: 1,
      productCount: 2,
    },
  ],
  categories: [
    {
      id: 'c2',
      parentId: 'c1',
      code: 'C2',
      nameVi: 'Serum',
      nameEn: 'Serum',
      sortOrder: 1,
      isActive: true,
      rowVersion: 1,
      productCount: 1,
    },
    {
      id: 'c1',
      parentId: null,
      code: 'C1',
      nameVi: 'Chăm sóc da',
      nameEn: 'Skin care',
      sortOrder: 1,
      isActive: true,
      rowVersion: 1,
      productCount: 3,
    },
  ],
  products: [
    {
      id: 'p1',
      code: 'KEM-50',
      nameVi: 'Kem dưỡng ẩm',
      nameEn: 'Moisturiser',
      status: 'PUBLISHED',
      featured: false,
      brand: null,
      category: null,
      activeVariantCount: 1,
      priceFromVnd: '100000',
      priceToVnd: '100000',
      coverMediaId: null,
      rowVersion: 1,
      updatedAt: '2030-01-01T00:00:00.000Z',
    },
    {
      id: 'p2',
      code: 'SRM-30',
      nameVi: 'Serum vitamin C',
      nameEn: 'Vitamin C serum',
      status: 'PUBLISHED',
      featured: false,
      brand: null,
      category: null,
      activeVariantCount: 1,
      priceFromVnd: '100000',
      priceToVnd: '100000',
      coverMediaId: null,
      rowVersion: 1,
      updatedAt: '2030-01-01T00:00:00.000Z',
    },
  ],
  loading: false,
  locked: false,
  failed: false,
  ready: true,
  ...over,
});

test('product targets: brands and categories as checkboxes (children under their parent), products as a search with removable chips', () => {
  const t = vi.discounts;
  const markup = render(
    <ProductTargetsFields
      form={{
        ...emptyDiscountForm(),
        scope: 'PRODUCTS',
        scopeMode: 'SELECTED',
        productIds: ['p1'],
        brandIds: ['b1'],
      }}
      catalog={catalog()}
      columns={2}
      toggle={() => undefined}
      setProducts={() => undefined}
    />,
    owner,
  );
  for (const text of [
    t.brands,
    'Thương hiệu A',
    t.productCategories,
    t.productCategoriesHint,
    t.products,
    t.productsHint,
    t.productSearch,
  ]) {
    assert.ok(markup.includes(text), text);
  }
  assert.ok(markup.indexOf('Chăm sóc da') < markup.indexOf('Chăm sóc da › Serum'));
  // The chosen product is a chip with a remove button named after it; the other one is still offered by the search.
  assert.ok(markup.includes('Kem dưỡng ẩm'));
  assert.ok(markup.includes('Bỏ Kem dưỡng ẩm'));
  assert.ok(
    !markup.includes('KEM-50'),
    'a chip is the name only; the code is for telling search results apart',
  );
  assert.ok(!markup.includes('<fieldset'));
  assert.ok(!markup.includes('<details'));
  // The English page reads in English.
  const en = render(
    <ProductTargetsFields
      form={{ ...emptyDiscountForm(), productIds: ['p2'] }}
      catalog={catalog()}
      columns={1}
      toggle={() => undefined}
      setProducts={() => undefined}
    />,
    owner,
    'en',
  );
  assert.ok(en.includes('Vitamin C serum') && en.includes('Skin care › Serum'));
});

test('product targets: without the catalog permission the form says so and offers no picker', () => {
  const t = vi.discounts;
  const markup = render(
    <ProductTargetsFields
      form={{
        ...emptyDiscountForm(),
        scope: 'PRODUCTS',
        scopeMode: 'SELECTED',
        productIds: ['p1'],
      }}
      catalog={catalog({ locked: true, ready: false, brands: [], categories: [], products: [] })}
      columns={1}
      toggle={() => undefined}
      setProducts={() => undefined}
    />,
    owner,
  );
  assert.ok(markup.includes(t.catalogLocked));
  assert.ok(!markup.includes(t.productSearch));
  assert.ok(!markup.includes('p1'), 'no raw id is shown');
  const failed = render(
    <ProductTargetsFields
      form={emptyDiscountForm()}
      catalog={catalog({ failed: true, ready: false })}
      columns={1}
      toggle={() => undefined}
      setProducts={() => undefined}
    />,
    owner,
  );
  assert.ok(failed.includes(t.catalogFailed));
});

test('categories are listed parent first, each child right after its parent', () => {
  const list = orderedCategories(catalog().categories, (c) => c.nameVi);
  assert.deepEqual(
    list.map((c) => c.id),
    ['c1', 'c2'],
  );
  assert.equal(list[1]!.label, 'Chăm sóc da › Serum');
});

test('both languages carry every new text and none says "khám"', () => {
  const keys = [
    'scopeKinds',
    'selection',
    'allOf',
    'selectedOnly',
    'brands',
    'productCategories',
    'productCategoriesHint',
    'products',
    'productsHint',
    'productSearch',
    'productSearchEmpty',
    'productsChosen',
    'removeTarget',
    'catalogLocked',
    'catalogFailed',
    'colScope',
    'targetsCount',
  ] as const;
  const en = getWorkforceDictionary('en').discounts;
  for (const key of keys) {
    assert.ok(JSON.stringify(vi.discounts[key]).length > 2, key);
    assert.ok(JSON.stringify(en[key]).length > 2, key);
    assert.doesNotMatch(JSON.stringify(vi.discounts[key]), /khám/i);
  }
});
