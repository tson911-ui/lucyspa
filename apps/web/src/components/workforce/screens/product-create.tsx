'use client';

import type {
  ProductBrandListResponse,
  ProductCategoryListResponse,
  ProductDetailResponse,
} from '@lucy-spa/contracts';
import { Breadcrumbs, Card, FormActions, Page, Stack } from '@lucy-spa/ui';
import { PrefetchLink as Link } from '../link';
import { useState, type FormEvent } from 'react';
import { productDictionary } from '../../../i18n/products';
import { fill } from '../../../i18n/workforce';
import {
  emptyProductDraft,
  productErrorText,
  productRequest,
  validateProductDraft,
  type ProductDraft,
} from '../../../lib/workforce/products';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';
import {
  Button,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
  useResource,
  useSuccessToast,
} from '../ui';
import { ProductFields } from './product-fields';

/**
 * "Add product" on its own page (a long form, FR9): `/products/new`. Only the general information is entered here; the product is
 * created as a draft and its page opens, where variants, prices and images are added.
 */
export function ProductCreateScreen() {
  const { api, t, locale, base, navigate } = useWorkforce();
  const p = productDictionary(locale);
  const notify = useSuccessToast();
  const brands = useResource(
    () => api.get<ProductBrandListResponse>('/api/v1/product-brands'),
    [api],
  );
  const categories = useResource(
    () => api.get<ProductCategoryListResponse>('/api/v1/product-categories'),
    [api],
  );
  const back = `${base}/products`;
  const failed = brands.error ?? categories.error;
  const brandList = brands.data;
  const categoryList = categories.data;
  return (
    <Page width="form">
      <PageHeader
        title={p.create.title}
        breadcrumbs={
          <Breadcrumbs
            label={p.breadcrumbs}
            LinkComponent={Link}
            items={[{ label: p.title, href: back }, { label: p.create.title }]}
          />
        }
      />
      {failed && !(brandList && categoryList) ? (
        <ErrorState
          error={failed}
          t={t}
          onRetry={() => void Promise.all([brands.reload(), categories.reload()])}
        />
      ) : brandList && categoryList ? (
        brandList.access.manage ? (
          <ProductCreateForm
            brands={brandList.brands.filter((brand) => brand.isActive)}
            categories={categoryList.categories.filter((category) => category.isActive)}
            onCreated={(product) => {
              notify(p.create.created);
              navigate?.(`${base}/products/${product.id}`);
            }}
            onCancel={() => navigate?.(back)}
          />
        ) : (
          <Notice tone="info">{t.errors.forbidden}</Notice>
        )
      ) : (
        <Loading t={t} />
      )}
    </Page>
  );
}

export function ProductCreateForm({
  brands,
  categories,
  onCreated,
  onCancel,
}: {
  brands: readonly { id: string; nameVi: string; nameEn: string }[];
  categories: readonly { id: string; nameVi: string; nameEn: string }[];
  onCreated: (product: ProductDetailResponse) => void;
  onCancel: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const p = productDictionary(locale);
  const [draft, setDraft] = useState<ProductDraft>(emptyProductDraft);
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = validateProductDraft(draft);
  const missing = [
    ...(errors.nameVi ? [p.create.nameVi] : []),
    ...(errors.nameEn ? [p.create.nameEn] : []),
    ...(errors.descriptionVi ? [p.create.descriptionVi] : []),
    ...(errors.descriptionEn ? [p.create.descriptionEn] : []),
  ];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setChecked(true);
    setError(null);
    const body = productRequest(draft);
    if (!body) return;
    setPending(true);
    try {
      onCreated(await api.post<ProductDetailResponse>('/api/v1/products', body));
    } catch (failure) {
      setError(productErrorText(failure, locale, (cause) => errorMessage(cause, t)));
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={(event) => void submit(event)} aria-label={p.create.title}>
      <Stack gap="block">
        <Card as="section" aria-label={p.create.title}>
          <Stack gap="page">
            <p className="ls-hint">{p.create.intro}</p>
            <ProductFields
              draft={draft}
              onChange={(patch) => setDraft((state) => ({ ...state, ...patch }))}
              errors={errors}
              checked={checked}
              brands={brands}
              categories={categories}
            />
            {checked && missing.length > 0 ? (
              <Notice tone="error">{fill(p.create.missing, { fields: missing.join(', ') })}</Notice>
            ) : null}
            {error ? <Notice tone="error">{error}</Notice> : null}
          </Stack>
        </Card>
        <FormActions
          cancel={
            <Button variant="secondary" onClick={onCancel} disabled={pending}>
              {t.common.cancel}
            </Button>
          }
          primary={
            <Button type="submit" variant="primary" loading={pending}>
              {pending ? p.create.submitting : p.create.submit}
            </Button>
          }
        />
      </Stack>
    </form>
  );
}
