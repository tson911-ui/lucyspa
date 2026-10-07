'use client';

import type {
  ProductDetailResponse,
  ProductPriceVersionResponse,
  ProductPromotionResponse,
} from '@lucy-spa/contracts';
import {
  ConfirmDialog,
  DataTable,
  FacetedFilter,
  ListSection,
  ListToolbar,
  RowActions,
  Tabs,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { productDictionary } from '../../../i18n/products';
import { fill } from '../../../i18n/workforce';
import { ApiError } from '../../../lib/workforce/api';
import { formatDateTime, formatVnd } from '../../../lib/workforce/format';
import { paginationLabels, resultsText, toolbarLabels } from '../../../lib/workforce/list-view';
import {
  canEndPromotion,
  productErrorText,
  promotionTone,
  variantName,
} from '../../../lib/workforce/products';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';
import { Badge, Empty, useSuccessToast } from '../ui';

const ZONE = 'Asia/Ho_Chi_Minh';

type PriceRow = ProductPriceVersionResponse & { variantId: string; sku: string };
type PromotionRow = ProductPromotionResponse & { variantId: string; sku: string };

/**
 * "Lịch sử giá và khuyến mãi": every list price change and every promotion of the product's variants, newest first, one table at a
 * time (two tabs). The SKU filter narrows both. Price versions are never edited or deleted; the only change to a promotion is
 * ending it early, by someone who may change prices.
 */
export function HistorySection({
  product,
  reload,
  variantId,
  onVariant,
}: {
  product: ProductDetailResponse;
  reload: () => Promise<void>;
  /** The SKU filter: a variant id, or '' for all. */
  variantId: string;
  onVariant: (variantId: string) => void;
}) {
  const { api, t, locale } = useWorkforce();
  const p = productDictionary(locale);
  const h = p.history;
  const notify = useSuccessToast();
  const [tab, setTab] = useState<'prices' | 'promotions'>('prices');
  const [pages, setPages] = useState({ prices: 1, promotions: 1, pageSize: 20 });
  const [ending, setEnding] = useState<PromotionRow | null>(null);
  const selected = product.variants.filter(
    (variant) => variantId === '' || variant.id === variantId,
  );
  const priceRows: PriceRow[] = selected
    .flatMap((variant) =>
      variant.priceHistory.map((entry) => ({ ...entry, variantId: variant.id, sku: variant.sku })),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.versionNo - a.versionNo);
  const promotionRows: PromotionRow[] = selected
    .flatMap((variant) =>
      variant.promotions.map((entry) => ({ ...entry, variantId: variant.id, sku: variant.sku })),
    )
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const canPrice = product.access.prices;

  const priceColumns: DataTableColumn<PriceRow>[] = [
    {
      key: 'sku',
      header: h.sku,
      mobileTitle: true,
      truncate: true,
      width: 'sm',
      cell: (row) => row.sku,
    },
    {
      key: 'version',
      header: h.version,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => row.versionNo,
    },
    {
      key: 'price',
      header: h.price,
      numeric: true,
      cell: (row) => formatVnd(row.listPriceVnd, locale),
    },
    {
      key: 'reason',
      header: h.reason,
      hideBelow: 'lg',
      truncate: true,
      width: 'md',
      cell: (row) => row.reason ?? '—',
    },
    {
      key: 'by',
      header: h.by,
      hideBelow: 'md',
      truncate: true,
      width: 'sm',
      cell: (row) => row.createdByName,
    },
    { key: 'at', header: h.at, cell: (row) => formatDateTime(row.createdAt, ZONE, locale) },
  ];

  const promotionColumns: DataTableColumn<PromotionRow>[] = [
    {
      key: 'sku',
      header: h.sku,
      mobileTitle: true,
      truncate: true,
      width: 'sm',
      cell: (row) => row.sku,
    },
    {
      key: 'price',
      header: h.promoPrice,
      numeric: true,
      cell: (row) => formatVnd(row.promoPriceVnd, locale),
    },
    { key: 'from', header: h.from, cell: (row) => formatDateTime(row.startsAt, ZONE, locale) },
    {
      key: 'to',
      header: h.to,
      cell: (row) => formatDateTime(row.endedEarlyAt ?? row.endsAt, ZONE, locale),
    },
    {
      key: 'state',
      header: h.state,
      cell: (row) => <Badge tone={promotionTone(row.state)}>{p.promotionState[row.state]}</Badge>,
    },
    {
      key: 'by',
      header: h.by,
      hideBelow: 'lg',
      truncate: true,
      width: 'sm',
      cell: (row) => row.createdByName,
    },
    ...(canPrice
      ? [
          {
            key: 'actions',
            header: h.actions,
            actions: true,
            cell: (row: PromotionRow) => (
              <RowActions
                menuLabel={fill(t.common.list.actionsFor, { name: row.sku })}
                items={
                  canEndPromotion(row)
                    ? [
                        {
                          id: 'end',
                          label: p.promo.end,
                          tone: 'danger' as const,
                          onSelect: () => setEnding(row),
                        },
                      ]
                    : []
                }
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <ListSection title={h.title}>
      <ListToolbar
        labels={toolbarLabels(t)}
        activeFilters={variantId ? 1 : 0}
        resultCount={resultsText(t, tab === 'prices' ? priceRows.length : promotionRows.length)}
        onReset={() => onVariant('')}
        filters={
          <FacetedFilter
            label={h.sku}
            clearLabel={t.common.list.clearChoice}
            options={product.variants.map((variant) => ({
              value: variant.id,
              label: variantName(variant, locale),
            }))}
            selected={variantId ? [variantId] : []}
            onChange={([next]) => onVariant(next ?? '')}
          />
        }
      />
      <Tabs
        label={h.tabsLabel}
        value={tab}
        onChange={(next) => setTab(next === 'promotions' ? 'promotions' : 'prices')}
        tabs={[
          {
            id: 'prices',
            label: h.tabs.prices,
            panel: (
              <DataTable
                mode="client"
                caption={fill(t.common.list.table, { list: h.tabs.prices })}
                columns={priceColumns}
                rows={priceRows}
                rowKey={(row) => `${row.variantId}:${row.versionNo}`}
                empty={<Empty>{h.emptyPrices}</Empty>}
                paging={{
                  page: pages.prices,
                  pageSize: pages.pageSize,
                  onPageChange: (page) => setPages((state) => ({ ...state, prices: page })),
                  onPageSizeChange: (pageSize) => setPages({ prices: 1, promotions: 1, pageSize }),
                  labels: paginationLabels(t, h.tabs.prices),
                }}
              />
            ),
          },
          {
            id: 'promotions',
            label: h.tabs.promotions,
            panel: (
              <DataTable
                mode="client"
                caption={fill(t.common.list.table, { list: h.tabs.promotions })}
                columns={promotionColumns}
                rows={promotionRows}
                rowKey={(row) => row.id}
                empty={<Empty>{h.emptyPromotions}</Empty>}
                paging={{
                  page: pages.promotions,
                  pageSize: pages.pageSize,
                  onPageChange: (page) => setPages((state) => ({ ...state, promotions: page })),
                  onPageSizeChange: (pageSize) => setPages({ prices: 1, promotions: 1, pageSize }),
                  labels: paginationLabels(t, h.tabs.promotions),
                }}
              />
            ),
          },
        ]}
      />
      {ending ? (
        <ConfirmDialog
          title={p.promo.endTitle}
          description={p.promo.endBody}
          facts={[
            { label: h.sku, value: ending.sku },
            { label: h.promoPrice, value: formatVnd(ending.promoPriceVnd, locale) },
          ]}
          tone="danger"
          confirmLabel={p.promo.endConfirm}
          busyLabel={p.variants.working}
          cancelLabel={p.variants.confirmCancel}
          referenceLabel={t.errors.reference}
          describeError={(error) => ({
            message: productErrorText(error, locale, (cause) => errorMessage(cause, t)),
            reference: error instanceof ApiError ? error.requestId : null,
          })}
          onCancel={() => setEnding(null)}
          onConfirm={async () => {
            try {
              await api.post(`/api/v1/products/${product.id}/promotions/${ending.id}/end`, {});
            } catch (error) {
              if (error instanceof ApiError) await reload();
              throw error;
            }
            await reload();
            setEnding(null);
            notify(p.promo.ended);
          }}
        />
      ) : null}
    </ListSection>
  );
}
