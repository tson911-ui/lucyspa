'use client';

import type {
  SourceTestSampleEntry,
  SupplierSourceItem,
  SupplierSourceTestConfirmResponse,
  SupplierSourceTestItem,
  SupplierSourceTestListResponse,
  SupplierSourceTestResponse,
} from '@lucy-spa/contracts';
import {
  buttonClass,
  DataTable,
  DescriptionList,
  Drawer,
  Icon,
  Stack,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useEffect, useRef, useState } from 'react';
import { supplierSourcesDictionary } from '../../../i18n/supplier-sources';
import { fill } from '../../../i18n/workforce';
import { formatDateTime, formatVnd } from '../../../lib/workforce/format';
import {
  canRunTest,
  isSourceConflict,
  sourceErrorText,
  statusTone,
} from '../../../lib/workforce/supplier-sources';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Loading,
  Notice,
  useResource,
  useSuccessToast,
} from '../ui';

const POLL_MS = 2000;

/**
 * Test Source (Phase 9 P9-3): the latest runs of one source with the 20-product sample, in a drawer opened from the row menu. The worker
 * reads the site; this screen only queues a run, shows the answer (polling while it is queued or running) and lets a person confirm
 * the sample, which is what makes the source ready. Supplier prices appear only when the server sent them (MANAGE_PRODUCT_PRICES).
 */
export function TestDrawer({
  item,
  canManage,
  onClose,
  onSource,
  onSettled,
  onConflict,
}: {
  item: SupplierSourceItem;
  canManage: boolean;
  onClose: () => void;
  /** The source after the person's own confirmation (a new version and status). */
  onSource: (item: SupplierSourceItem) => void;
  /** A run finished while the drawer was open: the worker may have changed the source, so the list is read again. */
  onSettled: () => void;
  onConflict: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = supplierSourcesDictionary(locale);
  const copy = text.test;
  const notify = useSuccessToast();
  const loaded = useResource(
    () => api.get<SupplierSourceTestListResponse>(`/api/v1/supplier-sources/${item.id}/tests`),
    [api, item.id],
  );
  const [busy, setBusy] = useState<'run' | 'confirm' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const latest = loaded.data?.items[0] ?? null;
  const active = latest?.status === 'QUEUED' || latest?.status === 'RUNNING';
  const wasActive = useRef(false);
  // The parent hands a fresh function every render; only the transition from active to finished matters.
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const { reload } = loaded;
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [active, reload]);
  useEffect(() => {
    if (wasActive.current && !active) settled.current();
    wasActive.current = active;
  }, [active]);

  async function fail(failure: unknown) {
    if (isSourceConflict(failure)) await onConflict();
    setError(sourceErrorText(failure, locale, (cause) => errorMessage(cause, t)));
  }

  async function run() {
    if (busy) return;
    setBusy('run');
    setError(null);
    try {
      await api.post<SupplierSourceTestResponse>(`/api/v1/supplier-sources/${item.id}/tests`, {
        expectedVersion: item.rowVersion,
      });
      notify(copy.queuedToast);
      await loaded.reload();
    } catch (failure) {
      await fail(failure);
    } finally {
      setBusy(null);
    }
  }

  async function confirm(test: SupplierSourceTestItem) {
    if (busy) return;
    setBusy('confirm');
    setError(null);
    try {
      const response = await api.post<SupplierSourceTestConfirmResponse>(
        `/api/v1/supplier-sources/${item.id}/tests/${test.id}/confirm`,
        { expectedVersion: item.rowVersion },
      );
      notify(copy.confirmedToast);
      onSource(response.item);
      await loaded.reload();
    } catch (failure) {
      await fail(failure);
    } finally {
      setBusy(null);
    }
  }

  const mayRun = canManage && canRunTest(item, latest);
  const mayConfirm = canManage && latest?.canConfirm === true;
  const permissionBlocked = item.gaps.some((gap) => gap.startsWith('PERMISSION_'));

  return (
    <Drawer
      open
      title={`${copy.title}: ${shortName(item.name)}`}
      closeLabel={t.common.close}
      className="ls-drawer-form"
      busy={busy !== null}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy !== null}>
            {t.common.close}
          </Button>
          {mayRun ? (
            <Button
              variant={mayConfirm ? 'secondary' : 'primary'}
              onClick={() => void run()}
              disabled={busy !== null}
            >
              {busy === 'run' ? copy.queuing : latest ? copy.runAgain : copy.run}
            </Button>
          ) : null}
          {mayConfirm && latest ? (
            <Button variant="primary" onClick={() => void confirm(latest)} disabled={busy !== null}>
              {busy === 'confirm' ? copy.confirming : copy.confirm}
            </Button>
          ) : null}
        </>
      }
    >
      <Stack gap="page">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {item.kind === 'FILE' ? <Notice tone="info">{copy.unsupported}</Notice> : null}
        {permissionBlocked ? <Notice tone="warning">{copy.needPermission}</Notice> : null}
        {loaded.error && !loaded.data ? (
          <ErrorState error={loaded.error} t={t} onRetry={() => void loaded.reload()} />
        ) : !loaded.data ? (
          <Loading t={t} />
        ) : latest ? (
          <LatestRun item={item} test={latest} pricesVisible={loaded.data.pricesVisible} />
        ) : (
          <Notice tone="info">{`${copy.none} ${copy.intro}`}</Notice>
        )}
      </Stack>
    </Drawer>
  );
}

export function LatestRun({
  item,
  test,
  pricesVisible,
}: {
  item: SupplierSourceItem;
  test: SupplierSourceTestItem;
  pricesVisible: boolean;
}) {
  const { t, locale } = useWorkforce();
  const text = supplierSourcesDictionary(locale);
  const copy = text.test;
  const zone = 'Asia/Ho_Chi_Minh';
  const when = (value: string) => formatDateTime(value, zone, locale);
  const known = copy.failures as Record<string, string>;
  const knownProblems = copy.problems as Record<string, string>;

  const notice = (() => {
    if (test.status === 'QUEUED') return <Notice tone="info">{copy.queued}</Notice>;
    if (test.status === 'RUNNING') return <Notice tone="info">{copy.running}</Notice>;
    if (test.status === 'FAILED') {
      const reason = test.failure ? (known[test.failure.code] ?? null) : null;
      return (
        <Notice tone="error">
          {`${copy.failedTitle} ${reason ?? test.failure?.code ?? ''}`.trim()}
        </Notice>
      );
    }
    if (test.confirmedAt) {
      return (
        <Notice tone="success">
          {fill(test.confirmedBy ? copy.confirmedBy : copy.confirmedNoName, {
            name: test.confirmedBy?.name ?? '',
            time: when(test.confirmedAt),
          })}
        </Notice>
      );
    }
    return (
      <Notice tone={test.canConfirm ? 'success' : 'warning'}>
        {test.canConfirm ? copy.passed : copy.outdated}
      </Notice>
    );
  })();

  const summary = test.summary;
  const items = summary
    ? [
        { label: copy.summary.total, value: summary.total === null ? '—' : String(summary.total) },
        { label: copy.summary.sampled, value: String(summary.sampled) },
        { label: copy.summary.usable, value: String(summary.usable) },
        { label: copy.summary.withSku, value: `${summary.withSku}/${summary.usable}` },
        { label: copy.summary.withImages, value: `${summary.withImages}/${summary.usable}` },
        ...(pricesVisible
          ? [{ label: copy.summary.withPrice, value: `${summary.withPrice}/${summary.usable}` }]
          : []),
        { label: copy.summary.withCategory, value: `${summary.withCategory}/${summary.usable}` },
        {
          label: copy.summary.robots,
          value:
            summary.robots === 'ALLOWED' ? copy.summary.robotsAllowed : copy.summary.robotsNoFile,
        },
      ]
    : [];

  const columns: DataTableColumn<SourceTestSampleEntry>[] = [
    {
      key: 'name',
      header: copy.columns.name,
      mobileTitle: true,
      width: 'md',
      cell: (entry) => (
        <span className="ls-cell-stack">
          <span className="ls-cell-truncate" title={entry.name}>
            {entry.name}
          </span>
          <span className="ls-cell-sub ls-cell-truncate">
            {copy.columns.sku}: {entry.sku ?? copy.noSku}
          </span>
        </span>
      ),
    },
    {
      key: 'open',
      header: copy.columns.open,
      actions: true,
      cell: (entry) => (
        <a
          className={buttonClass('ghost', 'md', 'ls-btn-icon')}
          href={entry.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={fill(copy.openSource, { name: entry.name })}
          title={fill(copy.openSource, { name: entry.name })}
        >
          <Icon name="globe" />
        </a>
      ),
    },
    {
      key: 'images',
      header: copy.columns.images,
      numeric: true,
      cell: (entry) => String(entry.imageCount),
    },
    ...(pricesVisible
      ? [
          {
            key: 'price',
            header: copy.columns.price,
            numeric: true,
            cell: (entry: SourceTestSampleEntry) =>
              entry.priceVnd === null || entry.priceVnd === undefined
                ? '—'
                : formatVnd(String(entry.priceVnd), locale),
          },
        ]
      : []),
  ];

  return (
    <Stack gap="page">
      <div>
        <Badge tone={statusTone(item.status)}>{text.statuses[item.status]}</Badge>
      </div>
      {notice}
      <p className="ls-hint">
        {fill(copy.lastRun, { time: when(test.requestedAt), name: test.requestedBy.name })}
      </p>
      {items.length > 0 ? <DescriptionList items={items} columns={2} /> : null}
      {test.problems.length > 0 ? (
        <DescriptionList
          items={test.problems.map((group) => ({
            label: knownProblems[group.code] ?? group.code,
            value: fill(copy.problemCount, { count: String(group.count) }),
          }))}
        />
      ) : null}
      {test.sample.length > 0 ? (
        <Stack gap="field">
          <DataTable
            caption={fill(copy.sampleTitle, { count: String(test.sample.length) })}
            columns={columns}
            rows={test.sample}
            rowKey={(entry) => entry.key}
            loadingLabel={t.common.loading}
            empty={<Empty>{copy.none}</Empty>}
            paging={{ off: 'A test reads at most twenty products, shown as one short sample.' }}
          />
          <p className="ls-hint">{pricesVisible ? copy.pricesNote : copy.pricesHidden}</p>
        </Stack>
      ) : null}
    </Stack>
  );
}

/** A long source name in a title: the first 40 characters and an ellipsis. */
function shortName(name: string): string {
  const letters = [...name];
  return letters.length > 40 ? `${letters.slice(0, 40).join('')}…` : name;
}
