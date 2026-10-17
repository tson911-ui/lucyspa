'use client';

import type {
  ProductBrandListResponse,
  ProductCategoryListResponse,
  ProductDetailResponse,
} from '@lucy-spa/contracts';
import { Breadcrumbs, Card, FormActions, Page, Stack } from '@lucy-spa/ui';
import { ListCrumbLink } from '../link';
import { useRef, useState, type FormEvent } from 'react';
import { productDictionary } from '../../../i18n/products';
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
import { focusInvalidSoon, useLeaveGuard } from './products-links';

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
            LinkComponent={ListCrumbLink}
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
  const formRef = useRef<HTMLFormElement | null>(null);
  const [initial] = useState<ProductDraft>(emptyProductDraft);
  const [draft, setDraft] = useState<ProductDraft>(initial);
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = validateProductDraft(draft);
  // Typed text is never dropped silently: the tab asks before closing, Cancel asks before leaving (wig product-create.tsx:105).
  const dirty = !pending && JSON.stringify(draft) !== JSON.stringify(initial);
  const guard = useLeaveGuard(dirty, onCancel, t);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setChecked(true);
    setError(null);
    const body = productRequest(draft);
    if (!body) {
      // The errors sit at their fields; focus moves to the first one (wig product-create.tsx:120).
      focusInvalidSoon(formRef.current);
      return;
    }
    setPending(true);
    try {
      onCreated(await api.post<ProductDetailResponse>('/api/v1/products', body));
    } catch (failure) {
      setError(productErrorText(failure, locale, (cause) => errorMessage(cause, t)));
      setPending(false);
    }
  }

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-label={p.create.title}
    >
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
            {error ? <Notice tone="error">{error}</Notice> : null}
          </Stack>
        </Card>
        <FormActions
          cancel={
            <Button variant="secondary" onClick={guard.leave} disabled={pending}>
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
      {guard.dialog}
    </form>
  );
}
