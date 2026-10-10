'use client';

import type { InvoiceOpenedResponse, PosBoardResponse } from '@lucy-spa/contracts';
import {
  DataTable,
  DateTextInput,
  ListSection,
  ListToolbar,
  RowActions,
  SearchInput,
  Select,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { PrefetchLink as Link } from '../link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { comboDictionary } from '../../../i18n/combo';
import { productSaleDictionary } from '../../../i18n/product-sale';
import { fill } from '../../../i18n/workforce';
import { BOARD_REFRESH_MS } from '../../../lib/workforce/booking-board';
import { formatVnd, todayIn } from '../../../lib/workforce/format';
import { paginationLabels, toolbarLabels } from '../../../lib/workforce/list-view';
import {
  boardStamp,
  invoiceContent,
  invoiceMatchesSearch,
  invoiceTone,
  posBranches,
  posErrorMessage,
} from '../../../lib/workforce/pos';
import { useBranches } from '../data';
import { useAccount, useWorkforce } from '../session';
import { Badge, Button, Empty, Loading, Notice, PageHeader } from '../ui';
import { ComboSaleDialog } from './pos-combo-sale';
import { ProductSaleDialog } from './pos-products';

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
  const ps = productSaleDictionary(locale);
  const { account } = useAccount();
  const router = useRouter();
  const branches = useBranches(api);
  const allowed = useMemo(() => posBranches(account, branches.data), [account, branches.data]);
  const [branchId, setBranchId] = useState('');
  const [date, setDate] = useState('');
  const [status, setStatus] = useState<BoardInvoice['status'] | ''>('');
  const [query, setQuery] = useState('');
  const [board, setBoard] = useState<PosBoardResponse | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [selling, setSelling] = useState(false);
  const [sellingProducts, setSellingProducts] = useState(false);
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
  // The board holds a week of invoices: a time alone says "today", an older one carries its day (dd/mm) too.
  const shownDate = board?.date ?? today;
  const stamp = (iso: string, businessDate: string) =>
    boardStamp(iso, businessDate, shownDate, zone, locale);
  // One branch: its name leads the intro and the picker is not needed (it also cut long names short).
  const onlyBranch = allowed.length === 1 ? allowed[0] : null;
  const intro = onlyBranch ? fill(t.pos.introBranch, { branch: onlyBranch.name }) : t.pos.intro;
  const invoices = (board?.invoices ?? []).filter(
    (invoice) => (!status || invoice.status === status) && invoiceMatchesSearch(invoice, query),
  );

  const awaitingColumns: DataTableColumn<Awaiting>[] = [
    { key: 'visit', header: t.pos.visit, mobileTitle: true, cell: (visit) => visit.visitCode },
    {
      key: 'guests',
      header: t.pos.guests,
      phoneEmphasis: true,
      truncate: true,
      width: 'lg',
      cell: (visit) => visit.participants.join(', '),
    },
    {
      key: 'performed',
      header: t.pos.performed,
      hideBelow: 'md',
      cell: (visit) => fill(t.pos.serviceCount, { count: visit.performedServices }),
    },
    {
      key: 'completedAt',
      header: t.pos.completedAt,
      cell: (visit) => (visit.completedAt ? stamp(visit.completedAt, visit.serviceDate) : '—'),
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

  const hasProducts = board?.invoices.some((invoice) => invoice.products) ?? false;
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
      key: 'createdAt',
      header: t.pos.createdAt,
      hidePhone: true,
      cell: (invoice) => stamp(invoice.createdAt, invoice.businessDate),
    },
    {
      // The customer comes right after the code on every width: it is what the cashier looks for first.
      key: 'payer',
      header: t.pos.customer,
      phoneEmphasis: true,
      truncate: true,
      width: 'md',
      cell: (invoice) => invoice.payerName ?? t.pos.guestShort,
    },
    {
      key: 'content',
      header: t.pos.content,
      hideBelow: 'lg',
      truncate: true,
      cell: (invoice) => invoiceContent(invoice, t, locale, c.invoice.typeCombo),
    },
    ...(hasProducts
      ? [
          {
            key: 'sellers',
            header: ps.board.sellers,
            hideBelow: 'xl' as const,
            hidePhone: true,
            truncate: true,
            width: 'xs' as const,
            cell: (invoice: BoardInvoice) => invoice.products?.sellers.join(', ') || '—',
          },
        ]
      : []),
    {
      key: 'status',
      header: t.pos.status,
      cell: (invoice) => (
        <Badge tone={invoiceTone(invoice.status)}>{t.pos.statuses[invoice.status]}</Badge>
      ),
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
      // The code is the link to the invoice, so the one-item menu is left out of the phone row, which gives the code its room.
      hidePhone: true,
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
      <PageHeader title={t.pos.title} intro={intro}>
        {/* One primary action: selling products when the cashier may, otherwise the combo sale as before. */}
        {board?.canSellCombos ? (
          <Button
            variant={board.canSellProducts ? 'secondary' : 'primary'}
            icon="plus"
            onClick={() => setSelling(true)}
          >
            {c.sale.action}
          </Button>
        ) : null}
        {board?.canSellProducts ? (
          <Button variant="primary" icon="plus" onClick={() => setSellingProducts(true)}>
            {ps.board.action}
          </Button>
        ) : null}
      </PageHeader>
      <ListToolbar
        labels={toolbarLabels(t)}
        activeFilters={(date ? 1 : 0) + (status ? 1 : 0) + (query ? 1 : 0)}
        resultCount={t.pos.windowNote}
        onReset={() => (setDate(''), setStatus(''), setQuery(''))}
        reload={{ label: t.pos.refresh, onClick: () => void load(false) }}
        search={
          <SearchInput
            id="pos-search"
            value={query}
            label={t.pos.boardSearch}
            placeholder={t.pos.boardSearch}
            clearLabel={t.common.list.clearSearch}
            onSearch={(value) => {
              setQuery(value);
              setInvoicesPaging((current) => ({ ...current, page: 1 }));
            }}
          />
        }
        filters={
          <>
            {onlyBranch ? null : (
              <Select
                id="pos-branch"
                aria-label={t.pos.branch}
                value={branchId}
                options={allowed.map((branch) => ({ value: branch.id, label: branch.name }))}
                onChange={(event) => (
                  setBranchId(event.target.value),
                  setDate(''),
                  setStatus(''),
                  setQuery('')
                )}
              />
            )}
            <DateTextInput
              id="pos-date"
              aria-label={t.pos.date}
              title={t.pos.date}
              value={date || (board?.date ?? today)}
              max={today}
              onChange={(event) => setDate(event.target.value)}
            />
            <Select
              id="pos-status"
              aria-label={t.pos.status}
              value={status}
              options={[
                { value: '', label: t.pos.allStatuses },
                ...(['PENDING_PAYMENT', 'PAID', 'DRAFT', 'CANCELLED'] as const).map((value) => ({
                  value,
                  label: t.pos.statuses[value],
                })),
              ]}
              onChange={(event) => {
                setStatus(event.target.value as BoardInvoice['status'] | '');
                setInvoicesPaging((current) => ({ ...current, page: 1 }));
              }}
            />
          </>
        }
      />
      {message ? <Notice tone="error">{message}</Notice> : null}
      {loadError ? <Notice tone="error">{posErrorMessage(loadError, t)}</Notice> : null}
      <ListSection title={t.pos.awaitingTitle}>
        {board && board.awaiting.length === 0 ? (
          // Nothing to do here is one quiet line, not a boxed empty state.
          <p className="ls-hint">{t.pos.awaitingEmpty}</p>
        ) : (
          <DataTable
            mode="client"
            caption={fill(t.common.list.table, { list: t.pos.awaitingTitle })}
            columns={awaitingColumns}
            rows={board?.awaiting ?? []}
            phoneRows="compact"
            rowKey={(visit) => visit.visitId}
            loading={loading}
            loadingLabel={t.common.loading}
            paging={{
              ...awaitingPaging,
              onPageChange: (page) => setAwaitingPaging((current) => ({ ...current, page })),
              onPageSizeChange: (pageSize) => setAwaitingPaging({ page: 1, pageSize }),
              labels: paginationLabels(t, t.pos.awaitingTitle),
            }}
          />
        )}
      </ListSection>
      <ListSection title={t.pos.invoicesTitle}>
        <DataTable
          mode="client"
          caption={fill(t.common.list.table, { list: t.pos.invoicesTitle })}
          columns={invoiceColumns}
          rows={invoices}
          phoneRows="compact"
          rowKey={(invoice) => invoice.id}
          loading={loading}
          loadingLabel={t.common.loading}
          empty={
            board ? (
              <Empty>{status || query ? t.pos.statusEmpty : t.pos.invoicesEmpty}</Empty>
            ) : undefined
          }
          paging={{
            ...invoicesPaging,
            onPageChange: (page) => setInvoicesPaging((current) => ({ ...current, page })),
            onPageSizeChange: (pageSize) => setInvoicesPaging({ page: 1, pageSize }),
            labels: paginationLabels(t, t.pos.invoicesTitle),
          }}
        />
      </ListSection>
      {sellingProducts ? (
        <ProductSaleDialog
          branchId={branchId}
          onStarted={(invoiceId) => router.push(`${base}/pos/${invoiceId}`)}
          onClose={() => setSellingProducts(false)}
        />
      ) : null}
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
