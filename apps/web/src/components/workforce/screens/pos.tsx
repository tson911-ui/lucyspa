'use client';

import type { InvoiceOpenedResponse, PosBoardResponse } from '@lucy-spa/contracts';
import {
  ButtonLink,
  DataTable,
  DateTextInput,
  EmptyState,
  ListSection,
  ListToolbar,
  RowActions,
  SearchInput,
  Select,
  useUrlState,
  type DataTableColumn,
} from '@lucy-spa/ui';
import dynamic from 'next/dynamic';
import { PrefetchLink as Link } from '../link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { canAt } from '../../../lib/workforce/permissions';
import { comboDictionary } from '../../../i18n/combo';
import { productSaleDictionary } from '../../../i18n/product-sale';
import { fill } from '../../../i18n/workforce';
import { BOARD_REFRESH_MS } from '../../../lib/workforce/booking-board';
import { formatVnd, todayIn } from '../../../lib/workforce/format';
import { paginationLabels, toolbarLabels } from '../../../lib/workforce/list-view';
import {
  invoiceContent,
  invoiceMatchesSearch,
  invoiceTone,
  posBranches,
  posErrorMessage,
} from '../../../lib/workforce/pos';
import { useBranches } from '../data';
import { useAccount, useWorkforce } from '../session';
import { Badge, Button, Empty, Loading, Notice, PageHeader } from '../ui';
import { clockTime, dayMonth, listFormat } from './pos-format';
import { RouterButtonLink, RouterMenuLink } from './pos-links';
import { backParam } from './pos-url';

// The two sale dialogs open only after a click: they load then, not with the board (bundle-dynamic-imports).
const ComboSaleDialog = dynamic(() => import('./pos-combo-sale').then((m) => m.ComboSaleDialog), {
  ssr: false,
});
const ProductSaleDialog = dynamic(() => import('./pos-products').then((m) => m.ProductSaleDialog), {
  ssr: false,
});

type Awaiting = PosBoardResponse['awaiting'][number];
type BoardInvoice = PosBoardResponse['invoices'][number];

const SEARCH_ID = 'pos-search';
const PAGE_SIZE = 20;
const STATUS_FILTER = ['PENDING_PAYMENT', 'PAID', 'DRAFT', 'CANCELLED'] as const;
// The board's view in the address: branch, day, status, search and the page of each list (module constants, as useUrlState asks).
const BOARD_DEFAULTS: {
  branch: string;
  date: string;
  status: string;
  q: string;
  apage: number;
  ipage: number;
} = {
  branch: '',
  date: '',
  status: '',
  q: '',
  apage: 1,
  ipage: 1,
};
const BOARD_URL_OPTIONS = { resetOnChange: ['apage', 'ipage'] } as const;

/**
 * Keyboard first at the counter (DESIGN.md 10): "/" focuses the board search from anywhere on the page, except while the cashier
 * types in a field or a dialog is open (Escape already closes the dialogs).
 */
function useSearchShortcut() {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing)
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      )
        return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const input = document.getElementById(SEARCH_ID);
      if (!(input instanceof HTMLInputElement)) return;
      event.preventDefault();
      input.focus();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}

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
  // Filters and both pagers live in the address (wig :53): a shared link or Back/Forward restores the same board view.
  const [view, setView] = useUrlState(BOARD_DEFAULTS, BOARD_URL_OPTIONS);
  // The first allowed branch is derived, not copied into state by an effect (rerender-derived-state-no-effect).
  const branchId = allowed.some((branch) => branch.id === view.branch)
    ? view.branch
    : (allowed[0]?.id ?? '');
  const { date, q: query } = view;
  const status = (STATUS_FILTER as readonly string[]).includes(view.status)
    ? (view.status as BoardInvoice['status'])
    : '';
  // The board of the branch and day on screen; an answer for another branch or day is never shown (derived, rbp :88-92).
  const boardKey = `${branchId}|${date}`;
  const [loaded, setLoaded] = useState<{ key: string; board: PosBoardResponse } | null>(null);
  const [failure, setFailure] = useState<{ key: string; error: unknown } | null>(null);
  const board = loaded?.key === boardKey ? loaded.board : null;
  const loadError = failure?.key === boardKey ? failure.error : null;
  const [opening, setOpening] = useState<string | null>(null);
  const [selling, setSelling] = useState(false);
  const [sellingProducts, setSellingProducts] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useSearchShortcut();

  const load = useCallback(
    async (passive: boolean) => {
      if (!branchId) return;
      const key = `${branchId}|${date}`;
      try {
        const next = await api.get<PosBoardResponse>(
          `/api/v1/pos/branches/${branchId}/board`,
          date ? { date } : {},
          { passive },
        );
        setLoaded({ key, board: next });
        setFailure(null);
      } catch (error) {
        setFailure({ key, error });
      }
    },
    [api, branchId, date],
  );
  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(true), BOARD_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const open = useCallback(
    async (visitId: string) => {
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
    },
    [opening, api, router, base, t, load],
  );

  // Rebuilt only when the board, the filters or the busy row change, not on every render (rbp :133-264).
  const invoices = useMemo(
    () =>
      (board?.invoices ?? []).filter(
        (invoice) => (!status || invoice.status === status) && invoiceMatchesSearch(invoice, query),
      ),
    [board, status, query],
  );
  const awaitingColumns = useMemo(
    () => awaitingColumnsOf({ t, locale, board, opening, onOpen: (id) => void open(id) }),
    [t, locale, board, opening, open],
  );
  // The board's view travels with the invoice link, so the invoice's breadcrumb returns to the same day, filters and page (C70).
  const back = backParam(view, BOARD_DEFAULTS);
  const invoiceColumns = useMemo(
    () =>
      invoiceColumnsOf({
        t,
        locale,
        base,
        back,
        board,
        comboLabel: c.invoice.typeCombo,
        sellersLabel: ps.board.sellers,
      }),
    [t, locale, base, back, board, c.invoice.typeCombo, ps.board.sellers],
  );

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
  // Reached only after the branches arrive from the API in the browser, so the server never renders a clock value (wig :124).
  const today = todayIn(zone);
  const loading = !board && !loadError;
  // One branch: its name leads the intro and the picker is not needed (it also cut long names short).
  const onlyBranch = allowed.length === 1 ? allowed[0] : null;
  const intro = onlyBranch ? fill(t.pos.introBranch, { branch: onlyBranch.name }) : t.pos.intro;

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
        onReset={() => setView({ date: '', status: '', q: '' })}
        reload={{ label: t.pos.refresh, onClick: () => void load(false) }}
        search={
          <SearchInput
            id={SEARCH_ID}
            keyShortcut="/"
            value={query}
            label={t.pos.boardSearch}
            clearLabel={t.common.list.clearSearch}
            onSearch={(value) => setView({ q: value }, { replace: true })}
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
                onChange={(event) =>
                  setView({ branch: event.target.value, date: '', status: '', q: '' })
                }
              />
            )}
            <DateTextInput
              id="pos-date"
              aria-label={t.pos.date}
              title={t.pos.date}
              value={date || (board?.date ?? today)}
              max={today}
              onChange={(event) => setView({ date: event.target.value })}
            />
            <Select
              id="pos-status"
              aria-label={t.pos.status}
              value={status}
              options={[
                { value: '', label: t.pos.allStatuses },
                ...STATUS_FILTER.map((value) => ({ value, label: t.pos.statuses[value] })),
              ]}
              onChange={(event) => setView({ status: event.target.value })}
            />
          </>
        }
      />
      {message ? <Notice tone="error">{message}</Notice> : null}
      {loadError ? <Notice tone="error">{posErrorMessage(loadError, t)}</Notice> : null}
      <ListSection title={t.pos.awaitingTitle}>
        {board && board.awaiting.length === 0 ? (
          // Empty lane: what it means and the one next step (DESIGN.md 8.4), a secondary link so the header keeps the one primary.
          <EmptyState
            icon="check-circle"
            action={
              account && canAt(account, 'MANAGE_BOOKINGS', branchId) ? (
                <ButtonLink
                  variant="secondary"
                  href={`${base}/walk-in`}
                  LinkComponent={RouterButtonLink}
                >
                  {t.pos.awaitingAction}
                </ButtonLink>
              ) : undefined
            }
          >
            {t.pos.awaitingEmpty}
          </EmptyState>
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
              page: view.apage,
              pageSize: PAGE_SIZE,
              onPageChange: (page) => setView({ apage: page }),
              labels: paginationLabels(t, t.pos.awaitingTitle),
            }}
          />
        )}
      </ListSection>
      <ListSection title={t.pos.invoicesTitle}>
        <DataTable
          drillDown
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
            page: view.ipage,
            pageSize: PAGE_SIZE,
            onPageChange: (page) => setView({ ipage: page }),
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

type Dictionary = ReturnType<typeof useWorkforce>['t'];
type Locale = ReturnType<typeof useWorkforce>['locale'];

/** The board's time for a row: a time alone for the shown day, "dd/mm hh:mm" for an older one, in branch time. */
function stampOf(board: PosBoardResponse | null, locale: Locale) {
  const zone = board?.branch.timezone ?? 'UTC';
  const shownDate = board?.date ?? '';
  // Cached Intl formatters (rbp pos.ts:50): the board formats every row on every 30 s refresh.
  return (iso: string, businessDate: string) => {
    const time = clockTime(locale, zone, iso);
    return businessDate === shownDate ? time : `${dayMonth(locale, businessDate)} ${time}`;
  };
}

function awaitingColumnsOf({
  t,
  locale,
  board,
  opening,
  onOpen,
}: {
  t: Dictionary;
  locale: Locale;
  board: PosBoardResponse | null;
  opening: string | null;
  onOpen: (visitId: string) => void;
}): DataTableColumn<Awaiting>[] {
  const stamp = stampOf(board, locale);
  return [
    {
      key: 'visit',
      header: t.pos.visit,
      mobileTitle: true,
      cell: (visit) => <span translate="no">{visit.visitCode}</span>,
    },
    {
      key: 'guests',
      header: t.pos.guests,
      phoneEmphasis: true,
      // Names wrap by word, never cut (Owner answer 7).
      wrap: true,
      width: 'lg',
      cell: (visit) => listFormat(locale).format(visit.participants),
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
                    onSelect: () => onOpen(visit.visitId),
                  },
                ]}
              />
            ),
          },
        ]
      : []),
  ];
}

function invoiceColumnsOf({
  t,
  locale,
  base,
  back,
  board,
  comboLabel,
  sellersLabel,
}: {
  t: Dictionary;
  locale: Locale;
  base: string;
  /** `?back=…` with the board's view (pos-url `backParam`), or ''. */
  back: string;
  board: PosBoardResponse | null;
  comboLabel: string;
  sellersLabel: string;
}): DataTableColumn<BoardInvoice>[] {
  const stamp = stampOf(board, locale);
  const hasProducts = board?.invoices.some((invoice) => invoice.products) ?? false;
  return [
    {
      key: 'code',
      header: t.pos.code,
      mobileTitle: true,
      cell: (invoice) => (
        <Link className="ls-link" href={`${base}/pos/${invoice.id}${back}`} translate="no">
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
      wrap: true,
      width: 'md',
      cell: (invoice) => invoice.payerName ?? t.pos.guestShort,
    },
    {
      key: 'content',
      header: t.pos.content,
      hideBelow: 'lg',
      wrap: true,
      cell: (invoice) => invoiceContent(invoice, t, locale, comboLabel),
    },
    ...(hasProducts
      ? [
          {
            key: 'sellers',
            header: sellersLabel,
            hideBelow: 'xl' as const,
            hidePhone: true,
            wrap: true,
            width: 'xs' as const,
            cell: (invoice: BoardInvoice) =>
              invoice.products?.sellers.length
                ? listFormat(locale).format(invoice.products.sellers)
                : '—',
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
        // A real router link in the menu too (wig :258): Ctrl/Cmd+click opens the invoice in a new tab.
        <RowActions
          LinkComponent={RouterMenuLink}
          menuLabel={fill(t.common.list.actionsFor, { name: invoice.code })}
          items={[
            {
              id: 'view',
              label: t.pos.view,
              icon: 'eye',
              href: `${base}/pos/${invoice.id}${back}`,
            },
          ]}
        />
      ),
    },
  ];
}
