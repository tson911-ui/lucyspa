'use client';

import type {
  ProductBrandListResponse,
  ProductCategoryListResponse,
  ProductListItem,
  ProductListResponse,
} from '@lucy-spa/contracts';
import {
  DataTable,
  FacetedFilter,
  ListToolbar,
  RowActions,
  SearchInput,
  Tabs,
  useUrlState,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { PrefetchLink as Link } from '../link';
import { useState } from 'react';
import { productDictionary } from '../../../i18n/products';
import { fill } from '../../../i18n/workforce';
import {
  paginationLabels,
  resultsText,
  sortLabels,
  toolbarLabels,
} from '../../../lib/workforce/list-view';
import {
  allowedStatusMoves,
  canOpenCatalog,
  filterProducts,
  localizedName,
  normalizeProductList,
  PRODUCT_LIST_DEFAULTS,
  PRODUCT_PAGE_KEYS,
  PRODUCT_STATUSES,
  priceRangeText,
  productSortValue,
  statusMoveKind,
  statusTone,
} from '../../../lib/workforce/products';
import { useWorkforce } from '../session';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Notice,
  PageHeader,
  useResource,
  useSuccessToast,
} from '../ui';
import { ProductStatusConfirm } from './product-status';
import { BrandsTab, CategoriesTab } from './products-taxonomy';

type Overlay = { kind: 'status'; product: ProductListItem; to: 'PUBLISHED' | 'INACTIVE' };

/**
 * Product catalog (Phase 6 P6-3): products, brands and categories in three tabs. The API returns everything, so search, filters,
 * sorting and paging run in the browser (`DataTable` client mode) and live in the address bar. A new product is a page of its own
 * (`/products/new`, a long form); brands and categories are short forms (dialogs). What each person may do comes from the API's
 * `access`; the cost never appears in any list.
 */
export function ProductsScreen() {
  const { api, t, locale, base, navigate } = useWorkforce();
  const p = productDictionary(locale);
  const products = useResource(() => api.get<ProductListResponse>('/api/v1/products'), [api]);
  const brands = useResource(
    () => api.get<ProductBrandListResponse>('/api/v1/product-brands'),
    [api],
  );
  const categories = useResource(
    () => api.get<ProductCategoryListResponse>('/api/v1/product-categories'),
    [api],
  );
  const [list, updateList] = useUrlState(PRODUCT_LIST_DEFAULTS, {
    normalize: normalizeProductList,
    resetOnChange: PRODUCT_PAGE_KEYS,
  });
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [createOpen, setCreateOpen] = useState<'brand' | 'category' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const notify = useSuccessToast();

  /** A success is a toast (shown by the dialog itself); only a conflict leaves a message on the page. */
  const savedHandler = (message: string, tone?: 'success' | 'error') => {
    if (tone === 'error') setNotice(message);
    void products.reload();
  };

  const access = products.data?.access ?? brands.data?.access ?? categories.data?.access ?? null;
  if (access && !canOpenCatalog(access)) return <Notice tone="info">{p.noAccess}</Notice>;
  const manage = access?.manage ?? false;
  const all = products.data?.products ?? [];
  const rows = filterProducts(all, list);
  const active =
    (list.q ? 1 : 0) + (list.brand ? 1 : 0) + (list.category ? 1 : 0) + (list.status ? 1 : 0);
  const shownBrands = brands.data?.brands ?? [];
  const shownCategories = categories.data?.categories ?? [];

  const columns: DataTableColumn<ProductListItem>[] = [
    {
      key: 'name',
      header: p.list.name,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      sortable: true,
      sortValue: (product) => productSortValue(product, 'name', locale),
      cell: (product) => (
        <Link
          className="ls-link"
          href={`${base}/products/${product.id}`}
          title={localizedName(product, locale)}
        >
          {localizedName(product, locale)}
        </Link>
      ),
    },
    {
      key: 'brand',
      header: p.list.brand,
      hideBelow: 'lg',
      truncate: true,
      width: 'md',
      sortable: true,
      sortValue: (product) => productSortValue(product, 'brand', locale),
      cell: (product) => (product.brand ? localizedName(product.brand, locale) : '—'),
    },
    {
      key: 'category',
      header: p.list.category,
      hideBelow: 'lg',
      truncate: true,
      width: 'md',
      sortable: true,
      sortValue: (product) => productSortValue(product, 'category', locale),
      cell: (product) => (product.category ? localizedName(product.category, locale) : '—'),
    },
    {
      key: 'price',
      header: p.list.price,
      numeric: true,
      sortable: true,
      sortValue: (product) => productSortValue(product, 'price', locale),
      cell: (product) =>
        priceRangeText(product.priceFromVnd, product.priceToVnd, locale, p.list.priceNone),
    },
    {
      key: 'variants',
      header: p.list.variants,
      numeric: true,
      hideBelow: 'xl',
      cell: (product) => product.activeVariantCount,
    },
    {
      key: 'status',
      header: p.list.status,
      sortable: true,
      sortValue: (product) => productSortValue(product, 'status', locale),
      cell: (product) => (
        <Badge tone={statusTone(product.status)}>{p.status[product.status]}</Badge>
      ),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (product) => {
        const name = localizedName(product, locale);
        return (
          <RowActions
            menuLabel={fill(t.common.list.actionsFor, { name })}
            items={[
              {
                id: 'details',
                label: p.actions.details,
                icon: 'eye',
                onSelect: () => navigate?.(`${base}/products/${product.id}`),
              },
              ...(manage
                ? allowedStatusMoves(product.status).map((to) => ({
                    id: `status-${to}`,
                    label: p.actions[statusMoveKind(product.status, to)],
                    ...(to === 'INACTIVE' ? { tone: 'danger' as const } : {}),
                    onSelect: () => {
                      setNotice(null);
                      setOverlay({ kind: 'status', product, to });
                    },
                  }))
                : []),
            ]}
          />
        );
      },
    },
  ];

  const productsPanel = (
    <>
      {products.data && all.length > 0 ? (
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={active}
          resultCount={resultsText(t, rows.length)}
          onReset={() => updateList({ q: '', brand: '', category: '', status: '' })}
          reload={{ label: t.common.reload, onClick: () => void products.reload() }}
          search={
            <SearchInput
              id="product-q"
              value={list.q}
              label={p.list.search}
              placeholder={p.list.search}
              clearLabel={t.common.list.clearSearch}
              onSearch={(q) => updateList({ q }, { replace: true })}
            />
          }
          filters={
            <>
              <FacetedFilter
                label={p.list.brand}
                clearLabel={t.common.list.clearChoice}
                options={shownBrands.map((brand) => ({
                  value: brand.id,
                  label: localizedName(brand, locale),
                }))}
                selected={list.brand ? [list.brand] : []}
                onChange={([brand]) => updateList({ brand: brand ?? '' })}
              />
              <FacetedFilter
                label={p.list.category}
                clearLabel={t.common.list.clearChoice}
                options={shownCategories.map((category) => ({
                  value: category.id,
                  label: localizedName(category, locale),
                }))}
                selected={list.category ? [list.category] : []}
                onChange={([category]) => updateList({ category: category ?? '' })}
              />
              <FacetedFilter
                label={p.list.status}
                clearLabel={t.common.list.clearChoice}
                options={PRODUCT_STATUSES.map((status) => ({
                  value: status,
                  label: p.status[status],
                }))}
                selected={list.status ? [list.status] : []}
                onChange={([status]) => updateList({ status: status ?? '' })}
              />
            </>
          }
        />
      ) : null}
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: p.title })}
        columns={columns}
        rows={rows}
        rowKey={(product) => `${product.id}:${product.rowVersion}`}
        sort={{ key: list.sort, direction: list.dir === 'desc' ? 'desc' : 'asc' }}
        onSortChange={(sort) => updateList({ sort: sort.key, dir: sort.direction })}
        sortLabels={sortLabels(t)}
        loading={products.loading}
        loadingLabel={t.common.loading}
        error={
          products.error ? (
            <ErrorState error={products.error} t={t} onRetry={() => void products.reload()} />
          ) : undefined
        }
        empty={
          products.data ? (
            <Empty>{all.length === 0 ? p.list.empty : p.list.noMatch}</Empty>
          ) : undefined
        }
        paging={{
          page: list.page,
          pageSize: list.pageSize,
          onPageChange: (page) => updateList({ page }),
          onPageSizeChange: (pageSize) => updateList({ pageSize }),
          labels: paginationLabels(t, p.title),
        }}
      />
    </>
  );

  return (
    <>
      <PageHeader title={p.title}>
        {manage && list.tab === 'products' ? (
          <Button variant="primary" icon="plus" onClick={() => navigate?.(`${base}/products/new`)}>
            {p.list.add}
          </Button>
        ) : null}
        {manage && list.tab === 'brands' ? (
          <Button variant="primary" icon="plus" onClick={() => setCreateOpen('brand')}>
            {p.brands.add}
          </Button>
        ) : null}
        {manage && list.tab === 'categories' ? (
          <Button variant="primary" icon="plus" onClick={() => setCreateOpen('category')}>
            {p.categories.add}
          </Button>
        ) : null}
      </PageHeader>
      {notice ? <Notice tone="error">{notice}</Notice> : null}
      <Tabs
        label={p.title}
        value={list.tab}
        onChange={(tab) => updateList({ tab })}
        tabs={[
          { id: 'products', label: p.tabs.products, panel: productsPanel },
          {
            id: 'brands',
            label: p.tabs.brands,
            panel: (
              <BrandsTab
                resource={brands}
                manage={manage}
                page={list.bpage}
                pageSize={list.bpageSize}
                onPage={(bpage) => updateList({ bpage })}
                onPageSize={(bpageSize) => updateList({ bpageSize })}
                createOpen={createOpen === 'brand'}
                onCreateClose={() => setCreateOpen(null)}
                onSaved={savedHandler}
              />
            ),
          },
          {
            id: 'categories',
            label: p.tabs.categories,
            panel: (
              <CategoriesTab
                resource={categories}
                manage={manage}
                page={list.cpage}
                pageSize={list.cpageSize}
                onPage={(cpage) => updateList({ cpage })}
                onPageSize={(cpageSize) => updateList({ cpageSize })}
                createOpen={createOpen === 'category'}
                onCreateClose={() => setCreateOpen(null)}
                onSaved={savedHandler}
              />
            ),
          },
        ]}
      />
      {overlay?.kind === 'status' ? (
        <ProductStatusConfirm
          key={overlay.product.id}
          product={overlay.product}
          to={overlay.to}
          onClose={() => setOverlay(null)}
          onChanged={async () => {
            await products.reload();
          }}
          onDone={() => {
            setOverlay(null);
            notify(p.statusDialog.done);
          }}
        />
      ) : null}
    </>
  );
}
