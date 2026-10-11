'use client';

import type {
  PayRunDetailResponse,
  PayRunItemView,
  PayRunLineView,
  PayslipListResponse,
  PayslipSummary,
} from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  Card,
  CardHeader,
  DataTable,
  DescriptionList,
  Drawer,
  ListSection,
  ListToolbar,
  RowActions,
  SearchInput,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { payrollDictionary } from '../../../i18n/payroll';
import { fill } from '../../../i18n/workforce';
import { signedVnd, vndNumber } from '../../../lib/workforce/cash';
import { formatDate, formatDateTime } from '../../../lib/workforce/format';
import { toolbarLabels } from '../../../lib/workforce/list-view';
import { monthLabel } from '../../../lib/workforce/payroll';
import { useClientPaging } from '../../../lib/workforce/use-client-paging';
import { PrefetchLink as Link } from '../link';
import { useWorkforce } from '../session';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Loading,
  PageHeader,
  useResource,
  useSuccessToast,
} from '../ui';
import {
  CloseDialog,
  ItemDialog,
  PayDrawer,
  PaymentDayDialog,
  ReverseDialog,
  VoidDialog,
} from './payroll-dialogs';

const STATUS_TONE = { DRAFT: 'info', CLOSED: 'warning', PAID: 'success' } as const;
const SLIP_TONE = { PENDING: 'warning', PAID: 'success', REVERSED: 'neutral' } as const;
const ZONE = 'Asia/Ho_Chi_Minh';

type Overlay =
  | { kind: 'day' }
  | { kind: 'item'; employeeId: string | null }
  | { kind: 'void'; item: PayRunItemView; name: string }
  | { kind: 'close' }
  | { kind: 'pay' }
  | { kind: 'reverse'; slip: PayslipSummary }
  | { kind: 'items'; lineId: string };

/**
 * One payroll run (Phase 7 P7-15): the summary, what to look at before closing, and each person. A draft is refreshed, given a payment day
 * and manual items; the Owner closes it (password); a closed run is paid (password) and a mistaken payment reversed. The page's one primary
 * action is the next step of the run; every other action sits in a card header, the list toolbar or a row menu.
 */
export function PayrollRunScreen({ id }: { id: string }) {
  const { api, t, locale } = useWorkforce();
  const p = payrollDictionary(locale);
  const [bump, setBump] = useState(0);
  const view = useResource(
    () => api.get<PayRunDetailResponse>(`/api/v1/pay/runs/${id}`),
    [api, id, bump],
  );
  const closed = view.data ? view.data.run.status !== 'DRAFT' : false;
  const slips = useResource(
    async () => (closed ? api.get<PayslipListResponse>(`/api/v1/pay/runs/${id}/payslips`) : null),
    [api, id, bump, closed],
  );
  if (view.error && !view.data) {
    return (
      <>
        <PageHeader title={p.title} />
        <ErrorState error={view.error} t={t} onRetry={() => void view.reload()} />
      </>
    );
  }
  if (!view.data) return <Loading t={t} page />;
  return (
    <RunView
      view={view.data}
      slips={slips.data ?? null}
      reload={() => setBump((value) => value + 1)}
    />
  );
}

export function RunView({
  view,
  slips,
  reload,
}: {
  view: PayRunDetailResponse;
  slips: PayslipListResponse | null;
  reload: () => void;
}) {
  const { t, locale, base, navigate } = useWorkforce();
  const p = payrollDictionary(locale);
  const x = p.run;
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [query, setQuery] = useState('');
  const paging = useClientPaging(t, x.lines);
  const notify = useSuccessToast();
  const run = view.run;
  const draft = run.status === 'DRAFT';
  const canApprove = view.canApprove;
  const slipOf = (employeeId: string) =>
    slips?.items.find((slip) => slip.employee.id === employeeId) ?? null;
  const done = (message: string) => {
    setOverlay(null);
    notify(message);
    reload();
  };
  const month = monthLabel(run.month);
  const needle = query.trim().toLocaleLowerCase(locale);
  const rows = needle
    ? view.lines.filter((line) =>
        `${line.employee.name} ${line.employee.code}`.toLocaleLowerCase(locale).includes(needle),
      )
    : view.lines;
  const w = view.warnings;
  const notes: string[] = draft
    ? [
        ...(w.unconfirmedBase > 0 ? [fill(x.w.unconfirmedBase, { n: w.unconfirmedBase })] : []),
        ...(w.noBase > 0 ? [fill(x.w.noBase, { n: w.noBase })] : []),
        ...(w.ctvUnagreed > 0 ? [fill(x.w.ctvUnagreed, { n: w.ctvUnagreed })] : []),
        ...(w.negativeNet > 0 ? [fill(x.w.negativeNet, { n: w.negativeNet })] : []),
        ...(w.noPaymentDay ? [x.w.noPaymentDay] : []),
        ...(w.cashDifferences > 0 ? [fill(x.w.cashDifferences, { n: w.cashDifferences })] : []),
      ]
    : [];

  const columns: DataTableColumn<PayRunLineView>[] = [
    {
      key: 'employee',
      header: x.columns.employee,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (line) => (
        <>
          {line.employee.name}
          <span className="ls-hint"> · {line.employee.code}</span>
        </>
      ),
    },
    {
      key: 'net',
      header: x.columns.net,
      numeric: true,
      cell: (line) => signedVnd(vndNumber(line.netVnd), locale),
    },
    {
      key: 'tips',
      header: x.columns.tips,
      numeric: true,
      hideBelow: 'md',
      hidePhone: true,
      cell: (line) => (line.tipsVnd !== '0' ? signedVnd(vndNumber(line.tipsVnd), locale) : '—'),
    },
    ...(!draft
      ? [
          {
            key: 'status',
            header: x.columns.status,
            cell: (line: PayRunLineView) => {
              const slip = slipOf(line.employee.id);
              return slip ? (
                <Badge tone={SLIP_TONE[slip.status]}>{p.slipStatuses[slip.status]}</Badge>
              ) : (
                '—'
              );
            },
          } satisfies DataTableColumn<PayRunLineView>,
        ]
      : [
          {
            key: 'notes',
            header: x.columns.notes,
            truncate: true,
            hideBelow: 'lg',
            hidePhone: true,
            width: 'lg',
            cell: (line: PayRunLineView) =>
              line.warnings.length > 0
                ? line.warnings.map((key) => p.warnings[key]).join('; ')
                : '—',
          } satisfies DataTableColumn<PayRunLineView>,
        ]),
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (line) => {
        const slip = slipOf(line.employee.id);
        return (
          <RowActions
            menuLabel={fill(t.common.list.actionsFor, { name: line.employee.name })}
            items={[
              {
                id: 'items',
                label: x.viewItems,
                icon: 'eye',
                onSelect: () => setOverlay({ kind: 'items', lineId: line.id }),
              },
              ...(draft && view.canManage
                ? [
                    {
                      id: 'add',
                      label: x.addItem,
                      icon: 'plus' as const,
                      onSelect: () => setOverlay({ kind: 'item', employeeId: line.employee.id }),
                    },
                  ]
                : []),
              ...(slip
                ? [
                    {
                      id: 'slip',
                      label: x.viewSlip,
                      icon: 'receipt' as const,
                      onSelect: () => navigate?.(`${base}/payroll/slip/${slip.id}`),
                    },
                  ]
                : []),
              ...(slip && slip.status === 'PAID' && canApprove
                ? [
                    {
                      id: 'reverse',
                      label: x.reverse,
                      icon: 'refresh' as const,
                      tone: 'danger' as const,
                      onSelect: () => setOverlay({ kind: 'reverse', slip }),
                    },
                  ]
                : []),
            ]}
          />
        );
      },
    },
  ];

  const openLine =
    overlay?.kind === 'items'
      ? (view.lines.find((line) => line.id === overlay.lineId) ?? null)
      : null;
  const pending = slips?.items.some((slip) => slip.status === 'PENDING') ?? false;
  return (
    <>
      <PageHeader
        title={fill(x.title, { month })}
        intro={fill(x.period, {
          from: formatDate(run.periodFrom, locale),
          to: formatDate(run.periodTo, locale),
        })}
        breadcrumbs={
          <Breadcrumbs
            label={p.common.breadcrumbs}
            LinkComponent={Link}
            items={[{ label: p.title, href: `${base}/payroll` }, { label: month }]}
          />
        }
      >
        {draft && view.canApprove ? (
          <Button variant="primary" onClick={() => setOverlay({ kind: 'close' })}>
            {x.closeButton}
          </Button>
        ) : null}
        {!draft && run.status === 'CLOSED' && canApprove && pending ? (
          <Button variant="primary" onClick={() => setOverlay({ kind: 'pay' })}>
            {x.payButton}
          </Button>
        ) : null}
      </PageHeader>

      <Card as="section" aria-label={x.summary}>
        <CardHeader
          title={x.summary}
          actions={
            draft && view.canManage ? (
              <>
                <Button variant="secondary" onClick={() => setOverlay({ kind: 'day' })}>
                  {run.paymentDay ? x.changeDay : x.setDay}
                </Button>
                <RefreshButton run={run} onDone={() => done(x.refreshed)} />
              </>
            ) : undefined
          }
        />
        <DescriptionList
          columns={2}
          items={[
            {
              label: p.common.net,
              value: signedVnd(vndNumber(view.totals.payVnd), locale),
              strong: true,
            },
            { label: p.common.tips, value: signedVnd(vndNumber(view.totals.tipsVnd), locale) },
            { label: p.common.people, value: view.totals.people },
            {
              label: p.common.paymentDay,
              value: run.paymentDay ? formatDate(run.paymentDay, locale) : p.common.notSet,
            },
            {
              label: p.list.columns.status,
              value: <Badge tone={STATUS_TONE[run.status]}>{p.runStatuses[run.status]}</Badge>,
            },
            ...(draft && run.refreshedAt
              ? [
                  {
                    label: x.refreshedLabel,
                    value: fill(x.refreshedAt, {
                      time: formatDateTime(run.refreshedAt, ZONE, locale),
                    }),
                  },
                ]
              : []),
            ...(!draft && run.closedAt
              ? [{ label: x.closedAtLabel, value: formatDateTime(run.closedAt, ZONE, locale) }]
              : []),
          ]}
        />
        {draft && view.stale ? <p className="ls-hint">{x.stale}</p> : null}
      </Card>

      {draft ? (
        <Card as="section" aria-label={x.warningsTitle}>
          <CardHeader title={x.warningsTitle} />
          {notes.length === 0 ? (
            <p className="ls-hint">{x.nothingToWarn}</p>
          ) : (
            <ul className="ls-list-plain">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <ListSection title={x.lines}>
        <ListToolbar
          labels={toolbarLabels(t)}
          reload={{ label: t.common.reload, onClick: reload }}
          resultCount={fill(t.common.list.results, { count: rows.length })}
          search={
            <SearchInput
              id="payroll-q"
              value={query}
              label={x.search}
              placeholder={x.search}
              clearLabel={t.common.list.clearSearch}
              onSearch={setQuery}
            />
          }
          actions={
            draft && view.canManage ? (
              <Button
                variant="secondary"
                icon="plus"
                onClick={() => setOverlay({ kind: 'item', employeeId: null })}
              >
                {x.addItem}
              </Button>
            ) : undefined
          }
        />
        <DataTable
          mode="client"
          caption={fill(t.common.list.table, { list: x.lines })}
          columns={columns}
          rows={rows}
          rowKey={(line) => line.id}
          empty={<Empty>{needle ? x.noneFiltered : x.none}</Empty>}
          paging={paging}
        />
      </ListSection>

      {overlay?.kind === 'day' ? (
        <PaymentDayDialog
          run={run}
          onDone={() => done(x.dayDone)}
          onClose={() => setOverlay(null)}
        />
      ) : null}
      {overlay?.kind === 'item' ? (
        <ItemDialog
          run={run}
          lines={view.lines}
          employeeId={overlay.employeeId}
          onDone={() => done(x.itemDone)}
          onClose={() => setOverlay(null)}
        />
      ) : null}
      {overlay?.kind === 'void' ? (
        <VoidDialog
          run={run}
          item={overlay.item}
          name={overlay.name}
          onDone={() => done(x.voidDone)}
          onClose={() => setOverlay(null)}
        />
      ) : null}
      {overlay?.kind === 'close' ? (
        <CloseDialog view={view} onDone={() => done(x.closed)} onClose={() => setOverlay(null)} />
      ) : null}
      {overlay?.kind === 'pay' && slips ? (
        <PayDrawer
          view={view}
          slips={slips}
          onDone={() => done(x.paid)}
          onClose={() => setOverlay(null)}
        />
      ) : null}
      {overlay?.kind === 'reverse' ? (
        <ReverseDialog
          slipId={overlay.slip.id}
          name={overlay.slip.employee.name}
          version={overlay.slip.version}
          onDone={() => done(x.reversed)}
          onClose={() => setOverlay(null)}
        />
      ) : null}
      {openLine ? (
        <ItemsDrawer
          line={openLine}
          canVoid={draft && view.canManage}
          onVoid={(item) => setOverlay({ kind: 'void', item, name: openLine.employee.name })}
          onClose={() => setOverlay(null)}
        />
      ) : null}
    </>
  );
}

function RefreshButton({ run, onDone }: { run: PayRunDetailResponse['run']; onDone: () => void }) {
  const { api, locale } = useWorkforce();
  const p = payrollDictionary(locale);
  const [busy, setBusy] = useState(false);
  async function refresh() {
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/api/v1/pay/runs/${run.id}/refresh`, { expectedVersion: run.version });
      onDone();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="secondary" loading={busy} onClick={() => void refresh()}>
      {busy ? p.run.refreshing : p.run.refresh}
    </Button>
  );
}

function ItemsDrawer({
  line,
  canVoid,
  onVoid,
  onClose,
}: {
  line: PayRunLineView;
  canVoid: boolean;
  onVoid: (item: PayRunItemView) => void;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const p = payrollDictionary(locale);
  const x = p.run;
  const paging = useClientPaging(t, x.lines);
  // The drawer is narrow: what explains an item sits under its name instead of in a column of its own.
  const noteOf = (item: PayRunItemView): string | null => {
    const parts = [
      item.reason,
      item.lateVnd !== '0'
        ? fill(x.lateNote, { amount: signedVnd(vndNumber(item.lateVnd), locale) })
        : null,
      item.flag === 'UNAGREED' && item.note ? fill(x.unagreedNote, { n: item.note }) : null,
      item.flag && item.flag !== 'UNAGREED' ? p.warnings[item.flag] : null,
      item.voidReason,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : null;
  };
  const columns: DataTableColumn<PayRunItemView>[] = [
    {
      key: 'kind',
      header: x.itemColumns.kind,
      mobileTitle: true,
      cell: (item) => (
        <>
          {p.kinds[item.kind]}
          {item.quantity ? (
            <span className="ls-hint"> · {fill(x.qty, { count: item.quantity })}</span>
          ) : null}
          {item.voided ? (
            <>
              {' '}
              <Badge tone="neutral">{x.voided}</Badge>
            </>
          ) : null}
          {noteOf(item) ? <span className="ls-hint"> · {noteOf(item)}</span> : null}
        </>
      ),
    },
    {
      key: 'amount',
      header: x.itemColumns.amount,
      numeric: true,
      cell: (item) => signedVnd(vndNumber(item.amountVnd), locale),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (item) =>
        canVoid && !item.generated && !item.voided ? (
          <RowActions
            menuLabel={fill(t.common.list.actionsFor, { name: p.kinds[item.kind] })}
            items={[
              {
                id: 'void',
                label: x.voidItem,
                icon: 'trash',
                tone: 'danger',
                onSelect: () => onVoid(item),
              },
            ]}
          />
        ) : null,
    },
  ];
  return (
    <Drawer
      open
      title={fill(x.itemsTitle, { name: line.employee.name })}
      closeLabel={t.common.close}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t.common.close}
        </Button>
      }
    >
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, {
          list: fill(x.itemsTitle, { name: line.employee.name }),
        })}
        columns={columns}
        rows={line.items}
        rowKey={(item) => item.id}
        paging={paging}
      />
      <DescriptionList
        layout="totals"
        items={[
          { label: p.common.net, value: signedVnd(vndNumber(line.netVnd), locale), strong: true },
          ...(line.tipsVnd !== '0'
            ? [{ label: p.common.tips, value: signedVnd(vndNumber(line.tipsVnd), locale) }]
            : []),
        ]}
      />
      <p className="ls-hint">
        {fill(x.attendance, { days: line.context.attendanceDays, leave: line.context.leaveDays })}
      </p>
    </Drawer>
  );
}
