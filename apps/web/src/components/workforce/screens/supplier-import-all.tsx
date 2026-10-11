'use client';

import type {
  SupplierImportAllPreview,
  SupplierImportAllResponse,
  SupplierImportAllRow,
} from '@lucy-spa/contracts';
import { IMPORT_ALL_IGNORE_MAX, IMPORT_ALL_IMPORT_MAX } from '@lucy-spa/contracts';
import {
  ButtonLink,
  CheckField,
  Cluster,
  DataTable,
  FacetedFilter,
  ListToolbar,
  MediaThumb,
  SearchInput,
  Stack,
  VisuallyHidden,
  normalizeSearch,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useMemo, useState } from 'react';
import { supplierImportsDictionary } from '../../../i18n/supplier-imports';
import { fill } from '../../../i18n/workforce';
import { formatVnd } from '../../../lib/workforce/format';
import { paginationLabels, resultsText, toolbarLabels } from '../../../lib/workforce/list-view';
import { canGlobal } from '../../../lib/workforce/permissions';
import { importErrorText, pictureUrl, warningText } from '../../../lib/workforce/supplier-imports';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useAccount, useWorkforce } from '../session';
import { Badge, Button, Empty, ErrorState, Loading, Notice, PageHeader, useResource } from '../ui';

const BASE = '/api/v1/supplier-imports';

/**
 * "Nhập và đăng sản phẩm" (Phase 9 P9-9b, Owner section 17), reached by the button "Nhập và đăng tất cả": one list of every open
 * product with the brand, category and selling price the system chose, a tick for each (all ticked), "Chọn tất cả / Bỏ chọn tất cả",
 * search and filters by category and brand. Only the ticked products are imported AND published; the unticked ones are ignored.
 * Products with a real blocker cannot be ticked and are listed. The server repeats every check and the three permissions it needs; this
 * screen only sends the ticked ones in calls of 20.
 */
export function SupplierImportAllScreen() {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const text = supplierImportsDictionary(locale);
  const allowed =
    canGlobal(account, 'REVIEW_SUPPLIER_IMPORTS') &&
    canGlobal(account, 'MANAGE_PRODUCTS') &&
    canGlobal(account, 'MANAGE_PRODUCT_PRICES');
  const loaded = useResource(
    () =>
      allowed
        ? api.get<SupplierImportAllPreview>(`${BASE}/import-all/preview`)
        : Promise.resolve(null),
    [api, allowed],
  );
  if (!allowed) {
    return (
      <>
        <PageHeader title={text.all.title} intro={text.all.intro} />
        <Empty>{text.noAccess}</Empty>
      </>
    );
  }
  if (loaded.error && !loaded.data) {
    return <ErrorState error={loaded.error} t={t} onRetry={() => void loaded.reload()} />;
  }
  if (!loaded.data) return <Loading t={t} page />;
  return <Chooser data={loaded.data} />;
}

export function Chooser({ data }: { data: SupplierImportAllPreview }) {
  const { api, t, locale, base } = useWorkforce();
  const text = supplierImportsDictionary(locale);
  const copy = text.all;
  const importable = useMemo(
    () => data.rows.filter((row) => row.blockers.length === 0),
    [data.rows],
  );
  const blocked = useMemo(() => data.rows.filter((row) => row.blockers.length > 0), [data.rows]);
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(importable.map((row) => row.id)),
  );
  const [q, setQ] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [page, setPage] = useState({ page: 1, pageSize: 20 });
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{
    imported: number;
    ignored: number;
    skipped: number;
  } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const brandNames = useMemo(
    () =>
      [
        ...new Set(
          importable.map((row) => row.brand?.name).filter((name): name is string => !!name),
        ),
      ].sort((a, b) => a.localeCompare(b, 'vi')),
    [importable],
  );
  const shown = useMemo(() => {
    const needle = normalizeSearch(q);
    return importable.filter(
      (row) =>
        (categories.length === 0 || categories.includes(row.category.key)) &&
        (brands.length === 0 || (row.brand !== null && brands.includes(row.brand.name))) &&
        (needle === '' ||
          [row.nameVi, row.sku ?? ''].some((field) => normalizeSearch(field).includes(needle))),
    );
  }, [importable, q, categories, brands]);
  const active = (q ? 1 : 0) + (categories.length > 0 ? 1 : 0) + (brands.length > 0 ? 1 : 0);

  const ticked = importable.filter((row) => checked.has(row.id));
  const perCategory = data.categories
    .map((category) => ({
      ...category,
      count: ticked.filter((row) => row.category.key === category.key).length,
    }))
    .filter((category) => category.count > 0);
  const newBrandCounts = new Map<string, number>();
  for (const row of ticked) {
    if (row.brand?.isNew) {
      newBrandCounts.set(row.brand.name, (newBrandCounts.get(row.brand.name) ?? 0) + 1);
    }
  }
  const running = progress !== null;
  const finished = result !== null;

  const setMany = (rows: readonly SupplierImportAllRow[], on: boolean) =>
    setChecked((current) => {
      const next = new Set(current);
      for (const row of rows) {
        if (on) next.add(row.id);
        else next.delete(row.id);
      }
      return next;
    });

  async function run() {
    if (running || importable.length === 0) return;
    setFailure(null);
    const unticked = importable.filter((row) => !checked.has(row.id));
    const total = ticked.length + unticked.length;
    let done = 0;
    const sum = { imported: 0, ignored: 0, skipped: 0 };
    setProgress({ done, total });
    const entry = (row: SupplierImportAllRow) => ({ id: row.id, expectedVersion: row.rowVersion });
    try {
      for (let from = 0; from < ticked.length; from += IMPORT_ALL_IMPORT_MAX) {
        const chunk = ticked.slice(from, from + IMPORT_ALL_IMPORT_MAX);
        const response = await api.post<SupplierImportAllResponse>(`${BASE}/import-all`, {
          import: chunk.map(entry),
          ignore: [],
        });
        sum.imported += response.imported;
        sum.skipped += response.skipped.length;
        done += chunk.length;
        setProgress({ done, total });
      }
      for (let from = 0; from < unticked.length; from += IMPORT_ALL_IGNORE_MAX) {
        const chunk = unticked.slice(from, from + IMPORT_ALL_IGNORE_MAX);
        const response = await api.post<SupplierImportAllResponse>(`${BASE}/import-all`, {
          import: [],
          ignore: chunk.map(entry),
        });
        sum.ignored += response.ignored;
        sum.skipped += response.skipped.length;
        done += chunk.length;
        setProgress({ done, total });
      }
      setResult(sum);
    } catch (error) {
      setFailure(importErrorText(error, locale, (cause) => errorMessage(cause, t)));
      if (sum.imported + sum.ignored > 0) setResult(sum);
    } finally {
      setProgress(null);
    }
  }

  const columns: DataTableColumn<SupplierImportAllRow>[] = [
    {
      key: 'pick',
      header: copy.columns.pick,
      select: true,
      cell: (row) => (
        <CheckField
          label={<VisuallyHidden>{fill(copy.pickRow, { name: row.nameVi })}</VisuallyHidden>}
          checked={checked.has(row.id)}
          disabled={running || finished}
          onChange={(event) => setMany([row], event.target.checked)}
        />
      ),
    },
    {
      key: 'image',
      header: copy.columns.image,
      leading: true,
      cell: (row) => (
        <MediaThumb src={row.thumbImageId ? pictureUrl(row.id, row.thumbImageId, 'thumb') : null} />
      ),
    },
    {
      key: 'name',
      header: copy.columns.name,
      mobileTitle: true,
      width: 'lg',
      cell: (row) => (
        <span className="ls-cell-stack">
          <span className="ls-cell-truncate" title={row.nameVi}>
            {row.nameVi}
          </span>
          <span
            className="ls-cell-sub ls-cell-truncate"
            title={`${text.columns.sku}: ${row.sku ?? text.none}`}
          >
            {text.columns.sku}: {row.sku ?? text.none}
          </span>
        </span>
      ),
    },
    {
      key: 'brand',
      header: copy.columns.brand,
      hideBelow: 'xl',
      truncate: true,
      width: 'md',
      cell: (row) =>
        row.brand
          ? `${row.brand.name}${row.brand.isNew ? ` ${copy.newBrandTag}` : ''}`
          : copy.noBrand,
    },
    {
      key: 'category',
      header: copy.columns.category,
      hideBelow: 'lg',
      truncate: true,
      width: 'md',
      cell: (row) => row.category.name,
    },
    {
      key: 'price',
      header: copy.columns.price,
      numeric: true,
      cell: (row) => (row.priceVnd === null ? text.none : formatVnd(row.priceVnd, locale)),
    },
  ];

  const reasonText = (code: string): string => {
    const own = (copy.blockers as Record<string, string>)[code];
    if (own) return own;
    const blocker = (text.blockers as Record<string, string>)[code];
    return blocker ?? warningText(code, locale);
  };
  const blockedReasons = [
    ...new Set(
      blocked.flatMap((row) => row.blockers.map((code) => reasonText(code).replace(/\.$/, ''))),
    ),
  ];

  const primary = finished ? (
    <ButtonLink variant="primary" href={`${base}/supplier-imports`}>
      {copy.close}
    </ButtonLink>
  ) : (
    <Button
      variant="primary"
      icon="check"
      onClick={() => void run()}
      disabled={running || importable.length === 0}
    >
      {running
        ? fill(copy.running, { done: String(progress.done), total: String(progress.total) })
        : ticked.length === 0
          ? copy.submitNone
          : fill(copy.submit, { count: String(ticked.length) })}
    </Button>
  );

  if (data.total === 0) {
    return (
      <>
        <PageHeader title={copy.title} intro={copy.intro} />
        <Empty>{copy.empty}</Empty>
      </>
    );
  }

  return (
    <>
      <PageHeader title={copy.title} intro={copy.intro}>
        {primary}
      </PageHeader>
      {failure ? <Notice tone="error">{failure}</Notice> : null}
      {finished ? (
        <Notice tone="success">
          {fill(copy.done, { imported: String(result.imported), ignored: String(result.ignored) })}
          {result.skipped > 0 ? ` ${fill(copy.skipped, { count: String(result.skipped) })}` : ''}
        </Notice>
      ) : (
        <Notice tone="info">
          <Stack gap="block">
            <span>{fill(copy.summary, { count: String(ticked.length) })}</span>
            {newBrandCounts.size > 0 ? (
              <span>
                {fill(copy.newBrands, {
                  brands: [...newBrandCounts]
                    .map(([name, count]) => `${name} (${count})`)
                    .join(', '),
                })}
              </span>
            ) : null}
            {data.categoriesToCreate.length > 0 ? (
              <span>
                {fill(copy.categoriesToCreate, { names: data.categoriesToCreate.join(', ') })}
              </span>
            ) : null}
            <span>{copy.priceNote}</span>
          </Stack>
        </Notice>
      )}
      {perCategory.length > 0 && !finished ? (
        <Cluster>
          {perCategory.map((category) => (
            <Badge key={category.key} tone="neutral">{`${category.name} ${category.count}`}</Badge>
          ))}
        </Cluster>
      ) : null}
      {blocked.length > 0 ? (
        <Notice tone="warning">
          <strong>{fill(copy.blockedTitle, { count: String(blocked.length) })}</strong>{' '}
          {fill(copy.blockedBody, { reasons: blockedReasons.join('; ') })}
        </Notice>
      ) : null}
      <ListToolbar
        className="ls-toolbar-end-below"
        labels={toolbarLabels(t)}
        activeFilters={active}
        resultCount={resultsText(t, shown.length)}
        onReset={() => {
          setQ('');
          setCategories([]);
          setBrands([]);
          setPage((state) => ({ ...state, page: 1 }));
        }}
        search={
          <SearchInput
            id="import-all-q"
            value={q}
            label={copy.search}
            placeholder={copy.search}
            clearLabel={t.common.list.clearSearch}
            onSearch={(value) => {
              setQ(value);
              setPage((state) => ({ ...state, page: 1 }));
            }}
          />
        }
        filters={
          <>
            <FacetedFilter
              label={copy.filters.category}
              clearLabel={t.common.list.clearChoice}
              multiple
              options={data.categories
                .filter((category) => importable.some((row) => row.category.key === category.key))
                .map((category) => ({ value: category.key, label: category.name }))}
              selected={categories}
              onChange={(value) => {
                setCategories(value);
                setPage((state) => ({ ...state, page: 1 }));
              }}
            />
            <FacetedFilter
              label={copy.filters.brand}
              clearLabel={t.common.list.clearChoice}
              multiple
              options={brandNames.map((name) => ({ value: name, label: name }))}
              selected={brands}
              onChange={(value) => {
                setBrands(value);
                setPage((state) => ({ ...state, page: 1 }));
              }}
            />
          </>
        }
        actions={
          <Cluster>
            <Button
              variant="secondary"
              disabled={running || finished}
              onClick={() => setMany(shown, true)}
            >
              {copy.selectAll}
            </Button>
            <Button
              variant="secondary"
              disabled={running || finished}
              onClick={() => setMany(shown, false)}
            >
              {copy.clearAll}
            </Button>
          </Cluster>
        }
      />
      <DataTable
        mode="client"
        className="ls-cards-one-line"
        caption={copy.table}
        columns={columns}
        rows={shown}
        rowKey={(row) => row.id}
        empty={<Empty>{active > 0 ? copy.emptyFiltered : copy.empty}</Empty>}
        paging={{
          ...page,
          onPageChange: (next) => setPage((state) => ({ ...state, page: next })),
          onPageSizeChange: (pageSize) => setPage({ page: 1, pageSize }),
          labels: paginationLabels(t, copy.table),
        }}
      />
      {blocked.length > 0 ? (
        <DataTable
          mode="client"
          caption={fill(copy.blockedTitle, { count: String(blocked.length) })}
          columns={[
            {
              key: 'name',
              header: copy.columns.name,
              mobileTitle: true,
              width: 'lg',
              cell: (row: SupplierImportAllRow) => (
                <span className="ls-cell-stack">
                  <span className="ls-cell-truncate" title={row.nameVi}>
                    {row.nameVi}
                  </span>
                  <span
                    className="ls-cell-sub ls-cell-truncate"
                    title={`${text.columns.sku}: ${row.sku ?? text.none}`}
                  >
                    {text.columns.sku}: {row.sku ?? text.none}
                  </span>
                </span>
              ),
            },
            {
              key: 'note',
              header: copy.columns.note,
              wrap: true,
              width: 'lg',
              cell: (row: SupplierImportAllRow) => row.blockers.map(reasonText).join(' '),
            },
          ]}
          rows={blocked}
          rowKey={(row) => row.id}
          paging={{ off: copy.blockedTitle }}
        />
      ) : null}
    </>
  );
}
