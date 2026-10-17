'use client';

import type {
  ProductTextCleanupApplyResponse,
  ProductTextCleanupDetailResponse,
  ProductTextCleanupItem,
  ProductTextCleanupPreviewResponse,
} from '@lucy-spa/contracts';
import {
  ConfirmDialog,
  DataTable,
  Drawer,
  EmptyState,
  RowActions,
  Stack,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { productTextCleanupDictionary } from '../../../i18n/product-text-cleanup';
import { fill } from '../../../i18n/workforce';
import { confirmError } from '../../../lib/workforce/form-labels';
import { canGlobal } from '../../../lib/workforce/permissions';
import { applyEntries, batches, sumResults } from '../../../lib/workforce/product-text-cleanup';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Button,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
  useResource,
  useSuccessToast,
} from '../ui';
import { RouterButtonLink, formatCount, urlPaging } from './products-links';

// Pagers kept in the address bar (Back/Forward and shared links restore them).
const useCleanupPaging = urlPaging('page', 'pageSize');

const BASE = '/api/v1/product-text-cleanup';

/**
 * "Dọn lời đánh giá của nhà cung cấp" (Claude integration CI-0b): the products whose description still carries the supplier's own
 * "Đánh giá" block. Preview first (a row opens the current text beside the cleaned text), one confirmed click cleans every product that
 * is not skipped. The server repeats every check, refuses a product edited since the preview and audits the old text.
 */
export function ProductTextCleanupScreen() {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const text = productTextCleanupDictionary(locale);
  const allowed = canGlobal(account, 'MANAGE_PRODUCTS');
  const loaded = useResource(
    () =>
      allowed
        ? api.get<ProductTextCleanupPreviewResponse>(`${BASE}/preview`)
        : Promise.resolve(null),
    [api, allowed],
  );
  if (!allowed) {
    return (
      <>
        <PageHeader title={text.title} intro={text.intro} />
        <Notice tone="info">{text.noAccess}</Notice>
      </>
    );
  }
  if (loaded.error && !loaded.data) {
    return <ErrorState error={loaded.error} t={t} onRetry={() => void loaded.reload()} />;
  }
  if (!loaded.data) return <Loading t={t} page />;
  return <Cleanup data={loaded.data} reload={() => loaded.reload()} />;
}

export function Cleanup({
  data,
  reload,
}: {
  data: ProductTextCleanupPreviewResponse;
  reload: () => Promise<void>;
}) {
  const { api, t, locale, base } = useWorkforce();
  const text = productTextCleanupDictionary(locale);
  const notify = useSuccessToast();
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => new Set());
  const paging = useCleanupPaging(t, text.table);
  const [viewing, setViewing] = useState<ProductTextCleanupItem | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const included = applyEntries(data.items, skipped);
  const entryTotal = data.items
    .filter((item) => !skipped.has(item.id))
    .reduce((total, item) => total + item.removedEntries, 0);

  const toggle = (id: string) =>
    setSkipped((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function run() {
    const responses: ProductTextCleanupApplyResponse[] = [];
    try {
      for (const items of batches(included)) {
        responses.push(await api.post<ProductTextCleanupApplyResponse>(`${BASE}/apply`, { items }));
      }
    } finally {
      // Whatever was cleaned before a failure is real: show the fresh list either way.
      if (responses.length > 0) {
        const sum = sumResults(responses);
        const message =
          fill(text.done, { cleaned: formatCount(locale, sum.cleaned) }) +
          (sum.skipped > 0
            ? fill(text.doneSkipped, { skipped: formatCount(locale, sum.skipped) })
            : '');
        setResult(message);
        notify(message);
        setSkipped(new Set());
        await reload();
      }
    }
    setConfirming(false);
  }

  const columns: DataTableColumn<ProductTextCleanupItem>[] = [
    {
      key: 'product',
      header: text.columns.product,
      mobileTitle: true,
      width: 'lg',
      cell: (row) => (
        <span className="ls-cell-stack">
          <span className="ls-adm-c-name">{row.nameVi}</span>
          <span className="ls-cell-sub ls-adm-c-name" translate="no">
            {row.code}
          </span>
        </span>
      ),
    },
    {
      key: 'entries',
      header: text.columns.entries,
      numeric: true,
      cell: (row) => row.removedEntries,
    },
    {
      key: 'chars',
      header: text.columns.chars,
      numeric: true,
      hideBelow: 'lg',
      cell: (row) => formatCount(locale, row.removedChars),
    },
    {
      key: 'state',
      header: text.columns.state,
      cell: (row) =>
        skipped.has(row.id) ? (
          <Badge tone="neutral">{text.states.skip}</Badge>
        ) : (
          <Badge tone="info">{text.states.clean}</Badge>
        ),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (row) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: row.nameVi })}
          items={[
            { id: 'view', label: text.menu.view, icon: 'eye', onSelect: () => setViewing(row) },
            {
              id: 'toggle',
              label: skipped.has(row.id) ? text.menu.include : text.menu.skip,
              icon: skipped.has(row.id) ? 'check' : 'close',
              onSelect: () => toggle(row.id),
            },
          ]}
        />
      ),
    },
  ];

  if (data.items.length === 0) {
    return (
      <>
        <PageHeader title={text.title} intro={text.intro} />
        {result ? <Notice tone="success">{result}</Notice> : null}
        <EmptyState
          icon="check-circle"
          title={text.emptyTitle}
          action={<RouterButtonLink href={`${base}/products`}>{text.toProducts}</RouterButtonLink>}
        >
          {text.empty}
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title={text.title} intro={text.intro}>
        <Button
          variant="primary"
          icon="check"
          onClick={() => setConfirming(true)}
          disabled={included.length === 0}
        >
          {included.length === 0
            ? text.submitNone
            : fill(text.submit, { count: formatCount(locale, included.length) })}
        </Button>
      </PageHeader>
      {data.truncated ? <Notice tone="warning">{text.truncated}</Notice> : null}
      <DataTable
        mode="client"
        className="ls-cards-one-line"
        caption={text.table}
        columns={columns}
        rows={data.items}
        rowKey={(row) => row.id}
        empty={
          <EmptyState icon="check-circle" title={text.emptyTitle}>
            {text.empty}
          </EmptyState>
        }
        paging={paging}
      />
      {viewing ? (
        <CleanupDetail
          item={viewing}
          skipped={skipped.has(viewing.id)}
          onToggle={() => toggle(viewing.id)}
          onClose={() => setViewing(null)}
        />
      ) : null}
      {confirming ? (
        <ConfirmDialog
          title={fill(text.confirm.title, { count: formatCount(locale, included.length) })}
          description={text.confirm.body}
          facts={[
            { label: text.confirm.facts.products, value: formatCount(locale, included.length) },
            { label: text.confirm.facts.entries, value: formatCount(locale, entryTotal) },
          ]}
          tone="warning"
          confirmLabel={fill(text.confirm.confirm, { count: formatCount(locale, included.length) })}
          busyLabel={text.confirm.cleaning}
          cancelLabel={t.common.cancel}
          referenceLabel={t.errors.reference}
          describeError={confirmError(t)}
          onConfirm={run}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}

function CleanupDetail({
  item,
  skipped,
  onToggle,
  onClose,
}: {
  item: ProductTextCleanupItem;
  skipped: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const text = productTextCleanupDictionary(locale);
  const loaded = useResource(
    () => api.get<ProductTextCleanupDetailResponse>(`${BASE}/preview/${item.id}`),
    [api, item.id],
  );
  const detail: ProductTextCleanupDetailResponse | null = loaded.data;
  return (
    <Drawer
      open
      title={item.nameVi}
      closeLabel={t.common.close}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t.common.close}
          </Button>
          <Button variant="secondary" onClick={onToggle}>
            {skipped ? text.menu.include : text.menu.skip}
          </Button>
        </>
      }
    >
      {loaded.error && !detail ? (
        <Notice tone="error">
          <Stack gap="field">
            <span>{text.detail.loadFailed}</span>
            <span>
              <Button variant="secondary" icon="refresh" onClick={() => void loaded.reload()}>
                {t.common.reload}
              </Button>
            </span>
          </Stack>
        </Notice>
      ) : !detail ? (
        <Loading t={t} />
      ) : detail.removedLines.length === 0 ? (
        <EmptyState icon="check-circle" title={text.detail.nothingTitle}>
          {text.detail.nothing}
        </EmptyState>
      ) : (
        <Stack gap="page">
          <section aria-label={text.detail.removed}>
            <h3>{text.detail.removed}</h3>
            <Stack gap="field">
              {detail.removedLines
                .filter((line) => line !== '-')
                .map((line, index) => (
                  <del key={index}>{line}</del>
                ))}
            </Stack>
          </section>
          <section aria-label={text.detail.after}>
            <h3>{text.detail.after}</h3>
            <Stack gap="field">
              {detail.after.split('\n').map((line, index) => (
                <p key={index}>{line}</p>
              ))}
            </Stack>
          </section>
        </Stack>
      )}
    </Drawer>
  );
}
