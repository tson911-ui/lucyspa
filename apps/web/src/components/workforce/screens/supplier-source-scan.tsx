'use client';

import type {
  SupplierSourceItem,
  SupplierSourceScanItem,
  SupplierSourceScanListResponse,
  SupplierSourceScanResponse,
} from '@lucy-spa/contracts';
import { DataTable, DescriptionList, Drawer, Stack, type DataTableColumn } from '@lucy-spa/ui';
import { useEffect, useRef, useState } from 'react';
import { supplierSourcesDictionary } from '../../../i18n/supplier-sources';
import { fill } from '../../../i18n/workforce';
import { formatDateTime } from '../../../lib/workforce/format';
import { isSourceConflict, sourceErrorText } from '../../../lib/workforce/supplier-sources';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';
import { Badge, Button, ErrorState, Loading, Notice, useResource, useSuccessToast } from '../ui';

const POLL_MS = 2000;

const tone = (status: SupplierSourceScanItem['status']) =>
  status === 'SUCCEEDED'
    ? 'success'
    : status === 'FAILED'
      ? 'error'
      : status === 'RUNNING'
        ? 'info'
        : 'warning';

/**
 * Sample scan (Phase 9 P9-4/P9-6): the latest scans of one source in a drawer opened from the row menu. The worker reads the site;
 * this screen only queues a scan (at most 20 products) and shows the answer, polling while it is queued or running. What the scan
 * found is reviewed on "Duyệt sản phẩm nhập".
 */
export function ScanDrawer({
  item,
  canManage,
  onClose,
  onSettled,
  onConflict,
}: {
  item: SupplierSourceItem;
  canManage: boolean;
  onClose: () => void;
  /** A scan finished while the drawer was open: the source moved (last success), so the list is read again. */
  onSettled: () => void;
  onConflict: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = supplierSourcesDictionary(locale);
  const copy = text.scan;
  const notify = useSuccessToast();
  const loaded = useResource(
    () => api.get<SupplierSourceScanListResponse>(`/api/v1/supplier-sources/${item.id}/scans`),
    [api, item.id],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = loaded.data?.items[0] ?? null;
  const active = latest?.status === 'RUNNING';
  const wasActive = useRef(false);
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

  const ready = item.isEnabled && item.status === 'READY';
  const zone = 'Asia/Ho_Chi_Minh';
  const when = (value: string) => formatDateTime(value, zone, locale);
  const known = copy.errors as Record<string, string>;

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post<SupplierSourceScanResponse>(`/api/v1/supplier-sources/${item.id}/scans`, {
        expectedVersion: item.rowVersion,
      });
      notify(copy.queuedToast);
      await loaded.reload();
    } catch (failure) {
      if (isSourceConflict(failure)) await onConflict();
      setError(sourceErrorText(failure, locale, (cause) => errorMessage(cause, t)));
    } finally {
      setBusy(false);
    }
  }

  const earlier = (loaded.data?.items ?? []).slice(1);
  const columns: DataTableColumn<SupplierSourceScanItem>[] = [
    {
      key: 'time',
      header: copy.columns.time,
      mobileTitle: true,
      cell: (scan) => when(scan.startedAt),
    },
    {
      key: 'status',
      header: copy.columns.status,
      cell: (scan) => <Badge tone={tone(scan.status)}>{copy.statuses[scan.status]}</Badge>,
    },
    {
      key: 'products',
      header: copy.columns.products,
      numeric: true,
      cell: (scan) => String(scan.counts.discovered),
    },
    {
      key: 'images',
      header: copy.columns.images,
      numeric: true,
      cell: (scan) => String(scan.counts.images),
    },
  ];

  const notice = (scan: SupplierSourceScanItem) =>
    scan.queued ? (
      <Notice tone="info">{copy.queued}</Notice>
    ) : scan.status === 'RUNNING' ? (
      <Notice tone="info">{copy.running}</Notice>
    ) : scan.status === 'FAILED' ? (
      <Notice tone="error">{copy.failed}</Notice>
    ) : scan.status === 'PARTIAL' ? (
      <Notice tone="warning">{copy.partial}</Notice>
    ) : (
      <Notice tone="success">{copy.succeeded}</Notice>
    );

  return (
    <Drawer
      open
      title={copy.title}
      closeLabel={t.common.close}
      className="ls-drawer-form"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t.common.close}
          </Button>
          {canManage && ready ? (
            <Button variant="primary" onClick={() => void run()} disabled={busy || active}>
              {busy ? copy.queuing : copy.run}
            </Button>
          ) : null}
        </>
      }
    >
      <Stack gap="page">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {!ready ? <Notice tone="warning">{copy.notReady}</Notice> : null}
        {loaded.error && !loaded.data ? (
          <ErrorState error={loaded.error} t={t} onRetry={() => void loaded.reload()} />
        ) : !loaded.data ? (
          <Loading t={t} />
        ) : latest ? (
          <Stack gap="page">
            {notice(latest)}
            <p className="ls-hint">
              {fill(copy.lastRun, {
                time: when(latest.startedAt),
                name: latest.requestedBy?.name ?? '—',
              })}
            </p>
            <DescriptionList
              columns={2}
              items={[
                { label: copy.summary.discovered, value: String(latest.counts.discovered) },
                { label: copy.summary.created, value: String(latest.counts.created) },
                { label: copy.summary.unchanged, value: String(latest.counts.unchanged) },
                { label: copy.summary.images, value: String(latest.counts.images) },
                { label: copy.summary.flags, value: String(latest.counts.imageFlags) },
                { label: copy.summary.requests, value: String(latest.requestCount) },
              ]}
            />
            {latest.errors.length > 0 ? (
              <DescriptionList
                items={latest.errors.map((entry, index) => ({
                  label: `${index + 1}`,
                  value: [known[entry.code] ?? entry.code, entry.key ? `#${entry.key}` : '']
                    .filter((part) => part !== '')
                    .join(' '),
                }))}
              />
            ) : null}
            {earlier.length > 0 ? (
              <DataTable
                caption={copy.history}
                columns={columns}
                rows={earlier}
                rowKey={(scan) => scan.id}
                loadingLabel={t.common.loading}
                paging={{ off: 'The drawer lists the latest ten scans of one source.' }}
              />
            ) : null}
          </Stack>
        ) : (
          <Notice tone="info">{`${copy.none} ${copy.intro}`}</Notice>
        )}
      </Stack>
    </Drawer>
  );
}
