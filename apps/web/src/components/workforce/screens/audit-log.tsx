'use client';

import type { AuditEventPageResponse, AuditEventResponse } from '@lucy-spa/contracts';
import {
  CursorPagination,
  DataTable,
  DescriptionList,
  DateRangePicker,
  Drawer,
  ListToolbar,
  RowActions,
  SearchInput,
  Stack,
  addDays,
  useUrlState,
  type DataTableColumn,
  type DateRange,
} from '@lucy-spa/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { auditArea, auditDictionary, type AuditDictionary } from '../../../i18n/audit';
import { reportsDictionary } from '../../../i18n/reports';
import { fill } from '../../../i18n/workforce';
import { formatDateTime, todayIn, zonedInstant } from '../../../lib/workforce/format';
import { cursorLabels, paginationLabels, toolbarLabels } from '../../../lib/workforce/list-view';
import {
  auditQuery,
  AUDIT_DEFAULTS,
  normalizeAudit,
  type AuditState,
} from '../../../lib/workforce/audit';
import { REPORT_ZONE } from '../../../lib/workforce/reports';
import { useWorkforce } from '../session';
import { Badge, Button, Empty, ErrorState, Notice, PageHeader } from '../ui';

/**
 * "Nhật ký hoạt động" (Phase 8 P8-14, docs/PHASE8_REPORTS.md 4.8): a read-only screen over the existing audit endpoint. The API alone decides
 * which rows a person may see (by branch and by kind of data); this screen adds a period, an action-code filter, "show more" paging and a
 * detail drawer with what an event changed. Nothing here writes anything.
 */
export function AuditLogScreen() {
  const { api, t, locale } = useWorkforce();
  const a = auditDictionary(locale);
  const w = reportsDictionary(locale);
  const [state, update] = useUrlState(AUDIT_DEFAULTS, { normalize: normalizeAudit });
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(todayIn(REPORT_ZONE)), []);
  const range: DateRange | null = today
    ? state.from !== '' && state.to !== ''
      ? { from: state.from, to: state.to }
      : { from: addDays(today, -29), to: today }
    : null;

  const [items, setItems] = useState<AuditEventResponse[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const [detail, setDetail] = useState<AuditEventResponse | null>(null);
  const [paging, setPaging] = useState({ page: 1, pageSize: 20 });
  const generation = useRef(0);

  const key = range ? `${range.from}|${range.to}|${state.action}|${nonce}` : null;
  const load = useCallback(
    async (cursor: string | null) => {
      if (!range) return;
      const mine = ++generation.current;
      setLoading(true);
      try {
        const page = await api.get<AuditEventPageResponse>(
          '/api/v1/audit-events',
          auditQuery(range, state.action, cursor, REPORT_ZONE, zonedInstant),
        );
        if (mine !== generation.current) return;
        setItems((current) => (cursor ? [...current, ...page.items] : page.items));
        setNext(page.nextCursor);
        setError(null);
      } catch (failure) {
        if (mine !== generation.current) return;
        setError(failure);
      } finally {
        if (mine === generation.current) setLoading(false);
      }
    },
    // The filter values are the dependencies (`key`); `range` and the action are derived from them.
    [api, key],
  );
  useEffect(() => {
    setPaging((current) => ({ ...current, page: 1 }));
    void load(null);
  }, [load]);

  const columns = useMemo(
    () => auditColumns(a, locale, (event) => setDetail(event), t),
    [a, locale, t],
  );
  const activeFilters = (state.from !== '' ? 1 : 0) + (state.action !== '' ? 1 : 0);
  return (
    <>
      <PageHeader title={a.title} intro={a.intro} />
      <Stack gap="page">
        <Notice tone="info">{a.readOnlyNote}</Notice>
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={activeFilters}
          onReset={() => update({ from: '', to: '', action: '' })}
          reload={{ label: w.common.reload, onClick: () => setNonce((n) => n + 1), busy: loading }}
          search={
            <SearchInput
              id="audit-action"
              value={state.action}
              label={a.actionFilter}
              placeholder={a.actionPlaceholder}
              clearLabel={t.common.list.clearSearch}
              onSearch={(text) => update({ action: text.toUpperCase().replace(/[^A-Z0-9_]/g, '') })}
            />
          }
          filters={
            today && range ? (
              <DateRangePicker
                value={range}
                today={today}
                locale={locale}
                labels={w.picker}
                maxDays={366}
                onChange={(picked) => update({ from: picked.from, to: picked.to })}
              />
            ) : null
          }
        />
        {error && items.length === 0 ? (
          <ErrorState error={error} t={t} onRetry={() => void load(null)} />
        ) : (
          <>
            <DataTable
              mode="client"
              caption={fill(t.common.list.table, { list: a.title })}
              columns={columns}
              rows={items}
              rowKey={(row) => row.id}
              loading={loading && items.length === 0}
              loadingLabel={t.common.loading}
              empty={!loading ? <Empty>{a.empty}</Empty> : undefined}
              paging={{
                ...paging,
                onPageChange: (page) => setPaging((current) => ({ ...current, page })),
                onPageSizeChange: (pageSize) => setPaging({ page: 1, pageSize }),
                labels: paginationLabels(t, a.title),
              }}
            />
            {next ? (
              <CursorPagination
                hasNext
                loading={loading}
                onNext={() => void load(next)}
                labels={{ ...cursorLabels(t, a.title), loadMore: a.more }}
              />
            ) : null}
          </>
        )}
      </Stack>
      {detail ? <AuditDetail event={detail} onClose={() => setDetail(null)} /> : null}
    </>
  );
}

function who(event: AuditEventResponse, a: AuditDictionary): string {
  if (event.actorName) return event.actorName;
  return event.actorKind === 'BOOTSTRAP'
    ? a.bootstrap
    : event.actorKind === 'SYSTEM'
      ? a.system
      : '—';
}

export function auditColumns(
  a: AuditDictionary,
  locale: 'vi' | 'en',
  onDetail: (event: AuditEventResponse) => void,
  t: ReturnType<typeof useWorkforce>['t'],
): DataTableColumn<AuditEventResponse>[] {
  return [
    {
      key: 'time',
      header: a.columns.time,
      cell: (row) => formatDateTime(row.occurredAt, REPORT_ZONE, locale),
    },
    {
      key: 'who',
      header: a.columns.who,
      truncate: true,
      width: 'sm',
      cell: (row) => who(row, a),
    },
    {
      key: 'what',
      header: a.columns.what,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (row) => (
        <>
          {a.areas[auditArea(row.action)]}
          {' · '}
          <span className="ls-hint">{row.action}</span>
        </>
      ),
    },
    {
      key: 'class',
      header: a.columns.kind,
      hideBelow: 'xl',
      hidePhone: true,
      cell: (row) =>
        row.dataClassification === 'STANDARD' ? (
          '—'
        ) : (
          <Badge tone="info">{a.classification[row.dataClassification]}</Badge>
        ),
    },
    {
      key: 'about',
      header: a.columns.about,
      hideBelow: 'lg',
      truncate: true,
      width: 'sm',
      cell: (row) => row.subjectName ?? '—',
    },
    {
      key: 'reason',
      header: a.columns.reason,
      hideBelow: 'xl',
      hidePhone: true,
      truncate: true,
      width: 'lg',
      cell: (row) => row.reason ?? '—',
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (row) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: row.action })}
          items={[{ id: 'details', label: a.details, icon: 'eye', onSelect: () => onDetail(row) }]}
        />
      ),
    },
  ];
}

function show(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function Snapshot({
  title,
  value,
  none,
}: {
  title: string;
  value: Record<string, unknown> | null;
  none: string;
}) {
  const entries = value ? Object.entries(value) : [];
  return (
    <section aria-label={title}>
      <h3>{title}</h3>
      {entries.length === 0 ? (
        <p className="ls-hint">{none}</p>
      ) : (
        <DescriptionList
          items={entries.map(([name, entry]) => ({ label: name, value: show(entry) }))}
        />
      )}
    </section>
  );
}

export function AuditDetail({
  event,
  onClose,
}: {
  event: AuditEventResponse;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const a = auditDictionary(locale);
  const f = a.fields;
  const rows: [string, string][] = [
    [f.time, formatDateTime(event.occurredAt, REPORT_ZONE, locale)],
    [f.who, who(event, a)],
    [f.action, `${a.areas[auditArea(event.action)]} · ${event.action}`],
    [f.about, event.subjectName ?? '—'],
    [f.entity, `${event.entityType} ${event.entityId}`],
    [f.reason, event.reason ?? '—'],
    [f.classification, a.classification[event.dataClassification]],
    [f.request, event.requestId ?? '—'],
  ];
  return (
    <Drawer
      open
      title={a.detailsTitle}
      closeLabel={t.common.close}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t.common.close}
        </Button>
      }
    >
      <Stack gap="page">
        <DescriptionList items={rows.map(([label, value]) => ({ label, value }))} />
        <Snapshot title={f.before} value={event.before} none={f.none} />
        <Snapshot title={f.after} value={event.after} none={f.none} />
      </Stack>
    </Drawer>
  );
}

export type { AuditState };
