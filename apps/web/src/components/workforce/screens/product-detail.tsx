'use client';

import type { ProductDetailResponse } from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  DescriptionList,
  FormDrawer,
  RowActions,
  Stack,
  type MenuItem,
} from '@lucy-spa/ui';
import { PrefetchLink as Link } from '../link';
import { useState } from 'react';
import { productDictionary } from '../../../i18n/products';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { formatDateTime } from '../../../lib/workforce/format';
import {
  allowedStatusMoves,
  crumbLabel,
  draftFromProduct,
  localizedName,
  productEditRequest,
  statusMoveKind,
  statusTone,
  validateProductDraft,
  type ProductDraft,
} from '../../../lib/workforce/products';
import { useWorkforce } from '../session';
import {
  Badge,
  Button,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
  Section,
  useResource,
  useSuccessToast,
} from '../ui';
import { ProductFields } from './product-fields';
import { HistorySection } from './product-history';
import { ImagesSection } from './product-images';
import { ProductStatusConfirm } from './product-status';
import { VariantsSection } from './product-variants';
import { useProductCommand } from './use-product-command';

const ZONE = 'Asia/Ho_Chi_Minh';

/** One product's page: information, variants, price and promotion history, images. Every product command returns this same data. */
export function ProductDetailScreen({ id }: { id: string }) {
  const { api, t } = useWorkforce();
  const product = useResource(
    () => api.get<ProductDetailResponse>(`/api/v1/products/${id}`),
    [api, id],
  );
  if (product.error && !product.data) {
    return <ErrorState error={product.error} t={t} onRetry={() => void product.reload()} />;
  }
  if (!product.data) return <Loading t={t} page />;
  return <ProductDetailView product={product.data} reload={product.reload} />;
}

type Overlay = 'edit' | { kind: 'status'; to: 'PUBLISHED' | 'INACTIVE' };

/**
 * The product page's content (also rendered on its own by the tests). The page header carries the one primary action: "Đăng bán"
 * on a draft. The status badge lives inside the information card, never next to the title. What each person sees and may do
 * follows `product.access`; cost and margin are in the variant table only when the API sent them.
 */
export function ProductDetailView({
  product,
  reload,
}: {
  product: ProductDetailResponse;
  reload: () => Promise<void>;
}) {
  const { locale, base } = useWorkforce();
  const p = productDictionary(locale);
  const d = p.detail;
  const notify = useSuccessToast();
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [historyVariant, setHistoryVariant] = useState('');
  const { access } = product;
  const name = localizedName(product, locale);
  const showHistory = (variantId: string) => {
    setHistoryVariant(variantId);
    // The history surface is further down the same page.
    document
      .getElementById('product-history')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const moves = access.manage ? allowedStatusMoves(product.status) : [];
  const menu: MenuItem[] = moves
    // "Đăng bán" of a draft is the page's primary action; the menu keeps the other moves.
    .filter((to) => !(product.status === 'DRAFT' && to === 'PUBLISHED'))
    .map((to) => ({
      id: `status-${to}`,
      label: p.actions[statusMoveKind(product.status, to)],
      ...(to === 'INACTIVE' ? { tone: 'danger' as const } : {}),
      onSelect: () => setOverlay({ kind: 'status', to }),
    }));

  return (
    <>
      <PageHeader
        title={name}
        {...(product.status === 'DRAFT' ? { intro: d.draftHint } : {})}
        breadcrumbs={
          <Breadcrumbs
            label={p.breadcrumbs}
            LinkComponent={Link}
            items={[{ label: p.title, href: `${base}/products` }, { label: crumbLabel(name) }]}
          />
        }
      >
        {access.manage && product.status === 'DRAFT' ? (
          <Button variant="primary" onClick={() => setOverlay({ kind: 'status', to: 'PUBLISHED' })}>
            {p.actions.publish}
          </Button>
        ) : null}
      </PageHeader>
      <Stack gap="page">
        <Section
          title={d.info}
          actions={
            access.manage ? (
              <>
                <Button variant="secondary" icon="edit" onClick={() => setOverlay('edit')}>
                  {d.edit}
                </Button>
                {menu.length > 0 ? <RowActions menuLabel={d.moreActions} items={menu} /> : null}
              </>
            ) : undefined
          }
        >
          <DescriptionList
            columns={2}
            items={[
              { label: d.nameVi, value: product.nameVi },
              { label: d.nameEn, value: product.nameEn },
              {
                label: d.brand,
                value: product.brand ? localizedName(product.brand, locale) : d.noBrand,
              },
              {
                label: d.category,
                value: product.category ? localizedName(product.category, locale) : d.noBrand,
              },
              { label: d.descriptionVi, value: product.descriptionVi },
              { label: d.descriptionEn, value: product.descriptionEn },
              {
                label: d.status,
                value: <Badge tone={statusTone(product.status)}>{p.status[product.status]}</Badge>,
              },
              { label: d.featured, value: product.featured ? p.yes : p.no },
              {
                label: d.publishedAt,
                value: product.publishedAt
                  ? formatDateTime(product.publishedAt, ZONE, locale)
                  : d.notPublished,
              },
            ]}
          />
        </Section>
        <VariantsSection product={product} reload={reload} onHistory={showHistory} />
        <div id="product-history">
          <HistorySection
            product={product}
            reload={reload}
            variantId={historyVariant}
            onVariant={setHistoryVariant}
          />
        </div>
        <ImagesSection product={product} reload={reload} />
      </Stack>
      {overlay === 'edit' ? (
        <ProductEditDrawer
          product={product}
          reload={reload}
          onClose={() => setOverlay(null)}
          onDone={() => {
            setOverlay(null);
            notify(p.saved);
          }}
        />
      ) : null}
      {overlay && overlay !== 'edit' ? (
        <ProductStatusConfirm
          product={product}
          to={overlay.to}
          onClose={() => setOverlay(null)}
          onChanged={reload}
          onDone={() => {
            setOverlay(null);
            notify(p.statusDialog.done);
          }}
        />
      ) : null}
    </>
  );
}

/** The general information (a medium form, so a drawer). Only the fields of the API's edit request. */
function ProductEditDrawer({
  product,
  reload,
  onClose,
  onDone,
}: {
  product: ProductDetailResponse;
  reload: () => Promise<void>;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, locale } = useWorkforce();
  const p = productDictionary(locale);
  const [initial] = useState<ProductDraft>(() => draftFromProduct(product));
  const [draft, setDraft] = useState<ProductDraft>(initial);
  const [checked, setChecked] = useState(false);
  const command = useProductCommand(reload);
  const errors = validateProductDraft(draft);

  async function submit() {
    setChecked(true);
    const body = productEditRequest(draft, product.rowVersion);
    if (!body) return;
    if (await command.run(`/api/v1/products/${product.id}/edit`, body)) onDone();
  }

  return (
    <FormDrawer
      title={p.detail.editTitle}
      labels={{ ...formOverlayLabels(t, p.save), submitting: p.saving }}
      busy={command.pending}
      dirty={JSON.stringify(draft) !== JSON.stringify(initial)}
      error={command.message ? <Notice tone="error">{command.message}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <ProductFields
        draft={draft}
        onChange={(patch) => setDraft((state) => ({ ...state, ...patch }))}
        errors={errors}
        checked={checked}
        brands={product.brandOptions}
        categories={product.categoryOptions}
      />
    </FormDrawer>
  );
}
