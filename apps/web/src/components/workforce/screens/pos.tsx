'use client';

import type { InvoiceOpenedResponse, PosBoardResponse } from '@lucy-spa/contracts';
import {
  DataTable,
  DateInput,
  ListSection,
  ListToolbar,
  RowActions,
  Select,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { PrefetchLink as Link } from '../link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { comboDictionary } from '../../../i18n/combo';
import { fill } from '../../../i18n/workforce';
import { BOARD_REFRESH_MS, branchTime } from '../../../lib/workforce/booking-board';
import { formatDate, formatVnd, todayIn } from '../../../lib/workforce/format';
import { paginationLabels, toolbarLabels } from '../../../lib/workforce/list-view';
import { invoiceTone, posBranches, posErrorMessage } from '../../../lib/workforce/pos';
import { useBranches } from '../data';
import { useAccount, useWorkforce } from '../session';
import { Badge, Button, Empty, Loading, Notice, PageHeader } from '../ui';
import { ComboSaleDialog } from './pos-combo-sale';

type Awaiting = PosBoardResponse['awaiting'][number];
type BoardInvoice = PosBoardResponse['invoices'][number];

/**
 * "Hóa đơn" (Phase 4 Step 5): completed visits still without an invoice, and the branch's recent invoices.
 * Opening an invoice creates (or reopens) the visit's single active DRAFT; every state and number comes from
 * the server. The page refreshes itself passively so it never keeps a session alive.
 */
export function PosScreen() {
  const { api, t, locale, base } = useWorkforce();
  const c = comboDictionary(locale);
  const { account } = useAccount();
  const router = useRouter();
  const branches = useBranches(api);
  const allowed = useMemo(() => posBranches(account, branches.data), [account, branches.data]);
  const [branchId, setBranchId] = useState('');
  const [date, setDate] = useState('');
  const [board, setBoard] = useState<PosBoardResponse | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [selling, setSelling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [awaitingPaging, setAwaitingPaging] = useState({ page: 1, pageSize: 20 });
  const [invoicesPaging, setInvoicesPaging] = useState({ page: 1, pageSize: 20 });

  useEffect(() => {
    if (!branchId && allowed[0]) setBranchId(allowed[0].id);
  }, [allowed, branchId]);

  const load = useCallback(
    async (passive: boolean) => {
      if (!branchId) return;
      try {
        setBoard(
          await api.get<PosBoardResponse>(
            `/api/v1/pos/branches/${branchId}/board`,
            date ? { date } : {},
            { passive },
          ),
        );
        setLoadError(null);
      } catch (error) {
        setLoadError(error);
      }
    },
    [api, branchId, date],
  );
  useEffect(() => {
    setBoard(null);
    setAwaitingPaging((current) => ({ ...current, page: 1 }));
    setInvoicesPaging((current) => ({ ...current, page: 1 }));
    void load(false);
    const timer = window.setInterval(() => void load(true), BOARD_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  async function open(visitId: string) {
    if (opening) return;
    setOpening(visitId);
    setMessage(null);
    try {
      const opened = await api.post<InvoiceOpenedResponse>(
        `/api/v1/pos/visits/${visitId}/invoice`,
        {},
      );
      router.push(`${base}/pos/${opened.invoice.id}`);
    } catch (error) {
      setMessage(posErrorMessage(error, t));
      setOpening(null);
      await load(false);
    }
  }

  if (branches.loading && !branches.data) return <Loading t={t} page />;
  if (allowed.length === 0) {
    return (
      <>
        <PageHeader title={t.pos.title} intro={t.pos.intro} />
        <Empty>{t.pos.noBranch}</Empty>
      </>
    );
  }
  const zone = board?.branch.timezone ?? 'UTC';
  const today = todayIn(zone);
  const loading = !board && !loadError;

  const awaitingColumns: DataTableColumn<Awaiting>[] = [
    { key: 'visit', header: t.pos.visit, mobileTitle: true, cell: (visit) => visit.visitCode },
    {
      key: 'date',
      header: t.pos.businessDate,
      cell: (visit) => formatDate(visit.serviceDate, locale),
    },
    {
      key: 'guests',
      header: t.pos.guests,
      truncate: true,
      cell: (visit) => visit.participants.join(', '),
    },
    {
      key: 'performed',
      header: t.pos.performed,
      hideBelow: 'lg',
      wrap: true,
      width: 'lg',
      cell: (visit) => visit.performedServices,
    },
    {
      key: 'completedAt',
      header: t.pos.completedAt,
      hideBelow: 'md',
      cell: (visit) => (visit.completedAt ? branchTime(visit.completedAt, zone, locale) : '—'),
    },
    ...(board?.canManage
      ? [
          {
            key: 'actions',
            header: t.common.actions,
            actions: true,
            cell: (visit: Awaiting) => (
              <RowActions
                menuLabel={fill(t.common.list.actionsFor, { name: visit.visitCode })}
                items={[
                  {
                    id: 'open',
                    label: opening === visit.visitId ? t.pos.opening : t.pos.openInvoice,
                    icon: 'plus' as const,
                    disabled: opening !== null,
                    onSelect: () => void open(visit.visitId),
                  },
                ]}
              />
            ),
          },
        ]
      : []),
  ];

  const invoiceColumns: DataTableColumn<BoardInvoice>[] = [
    {
      key: 'code',
      header: t.pos.code,
      mobileTitle: true,
      cell: (invoice) => (
        <Link className="ls-link" href={`${base}/pos/${invoice.id}`}>
          {invoice.code}
        </Link>
      ),
    },
    {
      key: 'date',
      header: t.pos.businessDate,
      cell: (invoice) => formatDate(invoice.businessDate, locale),
    },
    {
      key: 'type',
      header: c.invoice.typeColumn,
      hideBelow: 'xl',
      truncate: true,
      cell: (invoice) =>
        invoice.kind === 'COMBO_SALE'
          ? `${c.invoice.typeCombo}: ${invoice.comboName ? (locale === 'vi' ? invoice.comboName.vi : invoice.comboName.en) : '—'}`
          : `${c.invoice.typeVisit} ${invoice.visitCode ?? ''}`.trim(),
    },
    {
      key: 'status',
      header: t.pos.status,
      cell: (invoice) => (
        <Badge tone={invoiceTone(invoice.status)}>{t.pos.statuses[invoice.status]}</Badge>
      ),
    },
    {
      key: 'payer',
      header: t.pos.payer,
      hideBelow: 'lg',
      truncate: true,
      cell: (invoice) => invoice.payerName ?? t.pos.guestPayer,
    },
    {
      key: 'total',
      header: t.pos.total,
      numeric: true,
      // A draft total follows the live benefit evaluation shown on the invoice itself.
      cell: (invoice) => (invoice.status === 'DRAFT' ? '—' : formatVnd(invoice.totalVnd, locale)),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (invoice) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: invoice.code })}
          items={[
            {
              id: 'view',
              label: t.pos.view,
              icon: 'eye',
              onSelect: () => router.push(`${base}/pos/${invoice.id}`),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t.pos.title} intro={t.pos.intro}>
        {board?.canSellCombos ? (
          <Button variant="primary" icon="plus" onClick={() => setSelling(true)}>
            {c.sale.action}
          </Button>
        ) : null}
      </PageHeader>
      <ListToolbar
        labels={toolbarLabels(t)}
        activeFilters={date ? 1 : 0}
        resultCount={t.pos.windowNote}
        onReset={() => setDate('')}
        reload={{ label: t.pos.refresh, onClick: () => void load(false) }}
        search={
          <Select
            id="pos-branch"
            aria-label={t.pos.branch}
            value={branchId}
            options={allowed.map((branch) => ({ value: branch.id, label: branch.name }))}
            onChange={(event) => (setBranchId(event.target.value), setDate(''))}
          />
        }
        filters={
          <DateInput
            id="pos-date"
            aria-label={t.pos.date}
            title={t.pos.date}
            value={date || (board?.date ?? today)}
            max={today}
            onChange={(event) => setDate(event.target.value)}
          />
        }
      />
      {message ? <Notice tone="error">{message}</Notice> : null}
      {loadError ? <Notice tone="error">{posErrorMessage(loadError, t)}</Notice> : null}
      <ListSection title={t.pos.awaitingTitle}>
        <DataTable
          mode="client"
          caption={fill(t.common.list.table, { list: t.pos.awaitingTitle })}
          columns={awaitingColumns}
          rows={board?.awaiting ?? []}
          rowKey={(visit) => visit.visitId}
          loading={loading}
          loadingLabel={t.common.loading}
          empty={board ? <Empty>{t.pos.awaitingEmpty}</Empty> : undefined}
          paging={{
            ...awaitingPaging,
            onPageChange: (page) => setAwaitingPaging((current) => ({ ...current, page })),
            onPageSizeChange: (pageSize) => setAwaitingPaging({ page: 1, pageSize }),
            labels: paginationLabels(t, t.pos.awaitingTitle),
          }}
        />
      </ListSection>
      <ListSection title={t.pos.invoicesTitle}>
        <DataTable
          mode="client"
          caption={fill(t.common.list.table, { list: t.pos.invoicesTitle })}
          columns={invoiceColumns}
          rows={board?.invoices ?? []}
          rowKey={(invoice) => invoice.id}
          loading={loading}
          loadingLabel={t.common.loading}
          empty={board ? <Empty>{t.pos.invoicesEmpty}</Empty> : undefined}
          paging={{
            ...invoicesPaging,
            onPageChange: (page) => setInvoicesPaging((current) => ({ ...current, page })),
            onPageSizeChange: (pageSize) => setInvoicesPaging({ page: 1, pageSize }),
            labels: paginationLabels(t, t.pos.invoicesTitle),
          }}
        />
      </ListSection>
      {selling ? (
        <ComboSaleDialog
          branchId={branchId}
          onStarted={(invoiceId) => router.push(`${base}/pos/${invoiceId}`)}
          onClose={() => setSelling(false)}
        />
      ) : null}
    </>
  );
}
