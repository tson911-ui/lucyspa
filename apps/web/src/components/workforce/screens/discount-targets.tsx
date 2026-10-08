'use client';

import type {
  ProductBrandListResponse,
  ProductCategoryListResponse,
  ProductListResponse,
} from '@lucy-spa/contracts';
import { CheckField, Combobox, Field, FilterChips, FormGrid, normalizeSearch } from '@lucy-spa/ui';
import { useId, useMemo, useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { ApiError } from '../../../lib/workforce/api';
import type { DiscountForm } from '../../../lib/workforce/discounts';
import { useWorkforce } from '../session';
import { Empty, Loading, Notice, useResource } from '../ui';

/**
 * The product targets of a discount program (Phase 6 P6-11): brands and categories (short lists, checkboxes) and products (a
 * search picker with removable chips, because the catalog can hold hundreds). The lists come from the catalog API, which needs the
 * product-management permission; without it the form says so and keeps what is already chosen (the server decides again).
 */
export function useProductCatalog(enabled: boolean) {
  const { api } = useWorkforce();
  const brands = useResource(
    () =>
      enabled ? api.get<ProductBrandListResponse>('/api/v1/product-brands') : Promise.resolve(null),
    [api, enabled],
  );
  const categories = useResource(
    () =>
      enabled
        ? api.get<ProductCategoryListResponse>('/api/v1/product-categories')
        : Promise.resolve(null),
    [api, enabled],
  );
  const products = useResource(
    () => (enabled ? api.get<ProductListResponse>('/api/v1/products') : Promise.resolve(null)),
    [api, enabled],
  );
  const failure = [brands.error, categories.error, products.error].find(Boolean) ?? null;
  return {
    brands: brands.data?.brands ?? [],
    categories: categories.data?.categories ?? [],
    products: products.data?.products ?? [],
    loading: enabled && (brands.loading || categories.loading || products.loading),
    /** The catalog lists need the product-management permission. */
    locked: failure instanceof ApiError && failure.status === 403,
    failed: failure !== null && !(failure instanceof ApiError && failure.status === 403),
    ready: enabled && !!brands.data && !!categories.data && !!products.data,
  };
}

/** A chip stays one short line: a very long product name is cut (the search list and the detail page show it whole). */
const shortName = (text: string) => (text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text);

/** How many matches the product search lists at once. */
const PRODUCT_RESULTS = 30;

export type ProductCatalog = ReturnType<typeof useProductCatalog>;

/** A labelled group of checkboxes (categories, services, brands). */
export function PickerGroup({
  title,
  hint,
  empty,
  options,
  selected,
  onToggle,
}: {
  title: string;
  hint?: string;
  empty: string;
  options: readonly { id: string; label: string }[];
  selected: readonly string[];
  onToggle: (id: string) => void;
}) {
  const labelId = useId();
  const hintId = useId();
  return (
    <div
      className="ls-field"
      role="group"
      aria-labelledby={labelId}
      {...(hint ? { 'aria-describedby': hintId } : {})}
    >
      <span className="ls-label" id={labelId}>
        {title}
      </span>
      {hint ? (
        <span className="ls-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {options.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        options.map((option) => (
          <CheckField
            key={option.id}
            checked={selected.includes(option.id)}
            onChange={() => onToggle(option.id)}
            label={option.label}
          />
        ))
      )}
    </div>
  );
}

/** Top-level categories first, each followed by its children (two levels at most). */
export function orderedCategories(
  categories: ProductCategoryListResponse['categories'],
  name: (category: ProductCategoryListResponse['categories'][number]) => string,
): { id: string; label: string }[] {
  const top = categories.filter((category) => category.parentId === null);
  const out: { id: string; label: string }[] = [];
  for (const parent of top) {
    out.push({ id: parent.id, label: name(parent) });
    for (const child of categories.filter((entry) => entry.parentId === parent.id)) {
      out.push({ id: child.id, label: `${name(parent)} › ${name(child)}` });
    }
  }
  // A child whose parent is missing from the list still shows.
  for (const orphan of categories.filter(
    (category) => category.parentId !== null && !out.some((entry) => entry.id === category.id),
  )) {
    out.push({ id: orphan.id, label: name(orphan) });
  }
  return out;
}

export function ProductTargetsFields({
  form,
  catalog,
  columns,
  toggle,
  setProducts,
}: {
  form: DiscountForm;
  catalog: ProductCatalog;
  columns: 1 | 2;
  toggle: (key: 'brandIds' | 'productCategoryIds', id: string) => void;
  setProducts: (ids: string[]) => void;
}) {
  const { t, locale } = useWorkforce();
  const d = t.discounts;
  const name = (entry: { nameVi: string; nameEn: string }) =>
    locale === 'vi' ? entry.nameVi : entry.nameEn;
  const categoryOptions = useMemo(
    () => orderedCategories(catalog.categories, name),
    [catalog.categories, locale],
  );
  const byId = useMemo(
    () => new Map(catalog.products.map((product) => [product.id, product])),
    [catalog.products],
  );
  const productLabel = (product: { nameVi: string; nameEn: string; code: string }) =>
    `${name(product)} · ${product.code}`;
  // The catalog can hold thousands of products: the search shows the first matches only (typing narrows them down).
  const [query, setQuery] = useState('');
  const options = useMemo(() => {
    const words = normalizeSearch(query);
    const out: { value: string; label: string }[] = [];
    for (const product of catalog.products) {
      if (out.length >= PRODUCT_RESULTS) break;
      if (form.productIds.includes(product.id)) continue;
      const label = productLabel(product);
      if (words !== '' && !normalizeSearch(`${label} ${product.nameEn}`).includes(words)) continue;
      out.push({ value: product.id, label });
    }
    return out;
  }, [catalog.products, form.productIds, query, locale]);
  const chips = form.productIds.map((id) => {
    const product = byId.get(id);
    return { key: id, label: product ? shortName(name(product)) : id.slice(0, 8) };
  });

  if (catalog.loading) return <Loading t={t} />;
  return (
    <>
      {catalog.locked ? <Notice tone="info">{d.catalogLocked}</Notice> : null}
      {catalog.failed ? <Notice tone="error">{d.catalogFailed}</Notice> : null}
      {catalog.ready ? (
        <FormGrid cols={columns}>
          <PickerGroup
            title={d.brands}
            empty={d.pickerNone}
            options={catalog.brands.map((brand) => ({ id: brand.id, label: name(brand) }))}
            selected={form.brandIds}
            onToggle={(id) => toggle('brandIds', id)}
          />
          <PickerGroup
            title={d.productCategories}
            hint={d.productCategoriesHint}
            empty={d.pickerNone}
            options={categoryOptions}
            selected={form.productCategoryIds}
            onToggle={(id) => toggle('productCategoryIds', id)}
          />
          <Field label={d.products} hint={d.productsHint} full>
            {(control) => (
              <Combobox
                {...control}
                options={options}
                value={null}
                onValueChange={(value) => {
                  if (value && !form.productIds.includes(value)) {
                    setProducts([...form.productIds, value]);
                  }
                }}
                onQueryChange={setQuery}
                emptyLabel={d.productSearchEmpty}
                placeholder={d.productSearch}
                resultsLabel={(count) => fill(d.targetsCount, { n: count })}
              />
            )}
          </Field>
        </FormGrid>
      ) : null}
      {catalog.ready && chips.length > 0 ? (
        <div className="ls-field" role="group" aria-label={d.productsChosen}>
          <FilterChips
            chips={chips}
            removeLabel={d.removeTarget}
            onRemove={(key) => setProducts(form.productIds.filter((id) => id !== key))}
          />
        </div>
      ) : null}
    </>
  );
}
