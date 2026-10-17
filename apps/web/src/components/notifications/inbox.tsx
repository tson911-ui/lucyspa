'use client';

import type {
  CurrentAccountResponse,
  NotificationCountResponse,
  NotificationItem,
  NotificationPage,
  NotificationReadAllResponse,
} from '@lucy-spa/contracts';
import {
  Button,
  DataTable,
  EmptyState,
  Icon,
  ListToolbar,
  RowActions,
  Select,
  buttonClass,
  useUrlState,
  type DataTableColumn,
  type DataTablePaging,
  type ListToolbarLabels,
  type PaginationLabels,
  VisuallyHidden,
  type MenuItem,
} from '@lucy-spa/ui';
import { PrefetchLink as Link } from '../workforce/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fill } from '../../lib/fill';
import { getNotificationDictionary, type NotificationDictionary } from '../../i18n/notifications';
import type { Locale } from '../../i18n/locales';
import type { ApiClient } from '../../lib/api/client';
import { NAV_TRANSITION } from '../../lib/nav-transition';
import { normalizePage } from '../../lib/workforce/list-view';
import {
  applyItemUpdate,
  inboxCategories,
  mergeNotifications,
  notificationHref,
  notificationMessage,
  notificationQuery,
  type InboxFilters,
} from '../../lib/notifications';
import { Notice, PageHeader } from '../workforce/ui';
import { CHANGED, timestampParts, useUnreadCount } from './unread';

// The list words come from the notification dictionary (the same words as the staff lists), so the member inbox does not load
// the staff dictionary.
function toolbarLabels(t: NotificationDictionary): ListToolbarLabels {
  return {
    toolbar: t.listToolbar,
    filters: t.listFilters,
    reset: t.listReset,
    close: t.listClose,
    apply: t.listApply,
  };
}

function pagingLabels(t: NotificationDictionary): PaginationLabels {
  return {
    locale: t === getNotificationDictionary('vi') ? 'vi' : 'en',
    nav: fill(t.pagesOf, { list: t.title }),
    first: t.firstPage,
    previous: t.previousPage,
    next: t.nextPage,
    last: t.lastPage,
    pageNumber: t.pageNumber,
    summary: t.pageSummary,
    pageSize: t.pageSize,
    pageSizeOption: t.pageSizeOption,
  };
}

/** A pager in local state (a table on its own: 20 per page, back to page 1 when the size changes). */
function useLocalPaging(t: NotificationDictionary): DataTablePaging {
  const [state, setState] = useState({ page: 1, pageSize: 20 });
  return {
    ...state,
    onPageChange: (page) => setState((current) => ({ ...current, page })),
    onPageSizeChange: (pageSize) => setState({ page: 1, pageSize }),
    labels: pagingLabels(t),
  };
}

export { CHANGED, timestampParts, useUnreadCount };

type NotificationTexts = ReturnType<typeof getNotificationDictionary>;

/** Rows per page of the inbox table (the server sends 30 per batch; the table pages them 20 at a time). */
const INBOX_PAGE_SIZE = 20;
const INBOX_VIEWS = ['inbox', 'unread', 'archived'];
/** Address-bar state of the inbox: group (`ncat`), view (`nview`) and page (`npage`), prefixed so they never meet another list's keys. */
const INBOX_URL_DEFAULTS = { ncat: 'ALL', nview: 'inbox', npage: 1 };
const INBOX_URL_OPTIONS = {
  normalize: (state: typeof INBOX_URL_DEFAULTS) => ({
    ncat: /^[A-Z_]{1,40}$/.test(state.ncat) ? state.ncat : 'ALL',
    nview: INBOX_VIEWS.includes(state.nview) ? state.nview : 'inbox',
    npage: normalizePage(state.npage),
  }),
  resetOnChange: ['npage'],
};

/** Bell with the unread badge. */
export function NotificationIndicator({
  api,
  base,
  locale,
}: {
  api: ApiClient;
  base: string;
  locale: Locale;
}) {
  const t = getNotificationDictionary(locale);
  const { count, failed } = useUnreadCount(api);
  const label =
    failed || count === null
      ? failed
        ? t.countUnavailable
        : t.bell
      : `${t.bell}: ${count} ${t.bellUnread}`;
  return (
    <Link
      href={`${base}/notifications`}
      className={buttonClass('ghost', 'md', 'ls-btn-icon ls-bell')}
      title={label}
      aria-label={label}
    >
      <Icon name="bell" />
      {count !== null && count > 0 ? (
        <span className="ls-bell-count" data-testid="notification-badge" aria-hidden="true">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
      {failed ? <span aria-hidden="true">?</span> : null}
    </Link>
  );
}

/**
 * Row menu of one notification: mark read while unread, archive until archived (only where the caller
 * offers archiving). Empty when nothing is left to do, so the row shows no menu.
 */
export function notificationMenu(
  item: NotificationItem,
  t: NotificationTexts,
  options: {
    pendingId: string | null;
    onRead: () => void;
    /** Omitted where archiving is not offered. */
    onArchive?: (() => void) | undefined;
  },
): MenuItem[] {
  const working = options.pendingId === item.id;
  const disabled = options.pendingId !== null;
  return [
    ...(!item.readAt
      ? [
          {
            id: 'read',
            label: working ? t.working : t.markRead,
            icon: 'check' as const,
            disabled,
            onSelect: options.onRead,
          },
        ]
      : []),
    ...(options.onArchive && !item.archivedAt
      ? [
          {
            id: 'archive',
            label: working ? t.working : t.archive,
            icon: 'download' as const,
            disabled,
            onSelect: options.onArchive,
          },
        ]
      : []),
  ];
}

/**
 * The inbox as one table: message (the link to its page when there is one), time, source, status and a
 * row menu. Every row has the two-line time cell, so rows keep one height whatever the message length.
 */
export function NotificationTable({
  items,
  locale,
  hrefFor,
  pendingId,
  loading = false,
  empty,
  onRead,
  onArchive,
  paging,
  audience = 'staff',
}: {
  items: readonly NotificationItem[];
  locale: Locale;
  hrefFor: (item: NotificationItem) => string | null;
  pendingId: string | null;
  loading?: boolean | undefined;
  empty?: ReactNode;
  onRead: (id: string) => void;
  onArchive?: ((id: string) => void) | undefined;
  /** The inbox page passes its address-bar pager; a table on its own pages in local state. */
  paging?: DataTablePaging | undefined;
  /** A member's table: links name the record, not the staff's work, and carry the site's route fade. */
  audience?: 'staff' | 'customer' | undefined;
}) {
  const t = getNotificationDictionary(locale);
  const customer = audience === 'customer';
  const localPaging = useLocalPaging(t);
  const columns: DataTableColumn<NotificationItem>[] = [
    {
      key: 'message',
      header: t.columnMessage,
      mobileTitle: true,
      wrap: true,
      width: 'lg',
      cell: (item) => {
        const message = notificationMessage(item, locale);
        const href = hrefFor(item);
        const open = customer
          ? t.openDetail
          : item.source.type === 'LeaveRequest'
            ? t.openLeave
            : item.source.type === 'Invoice'
              ? t.finance.openInvoice
              : item.source.type === 'ProductReturnCase'
                ? t.returns.openCase
                : item.source.type === 'ProductOrder' || item.type === 'PRODUCT_ORDER_ALERT'
                  ? t.orders.openOrders
                  : item.source.type === 'ProductVariant' || item.type === 'EXPIRY_ALERT'
                    ? t.inventory.openStock
                    : item.source.type === 'SupplierSource'
                      ? t.supplier.open
                      : t.open;
        // Unread = a dot and the 600 weight; the words "unread" / "archived" are for screen readers only (no status pill on
        // every row, C5/A3). The message wraps in full (Owner answer 7), the link carries no duplicate tooltip.
        const state = [item.readAt ? null : t.unread, item.archivedAt ? t.archivedBadge : null]
          .filter(Boolean)
          .map((word) => `, ${word}`)
          .join('');
        return (
          <span className="ls-inbox-message" data-unread={item.readAt ? undefined : true}>
            {item.readAt ? null : <span className="ls-inbox-dot" aria-hidden />}
            {href ? (
              <Link
                className="ls-link"
                href={href}
                aria-label={`${open}: ${message}${state}`}
                {...(customer ? { transitionTypes: NAV_TRANSITION } : {})}
              >
                {message}
              </Link>
            ) : (
              <span>
                {message}
                {state ? <VisuallyHidden>{state}</VisuallyHidden> : null}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'time',
      header: t.columnTime,
      cell: (item) => {
        const { date, time } = timestampParts(item, locale);
        return (
          <time dateTime={item.actionAt} className="ls-cell-stack">
            <span className="ls-cell-main">{date}</span>
            <span className="ls-cell-sub">{time}</span>
          </time>
        );
      },
    },
    {
      key: 'source',
      header: t.columnSource,
      hideBelow: 'lg',
      cell: (item) => (
        <span className="ls-cell-stack">
          <span className="ls-cell-main" translate="no">
            {item.source.code}
          </span>
          <span className="ls-cell-sub">{item.branch?.name ?? '—'}</span>
        </span>
      ),
    },
    {
      key: 'actions',
      header: t.columnActions,
      actions: true,
      cell: (item) => {
        const menu = notificationMenu(item, t, {
          pendingId,
          onRead: () => onRead(item.id),
          ...(onArchive ? { onArchive: () => onArchive(item.id) } : {}),
        });
        return menu.length > 0 ? (
          <RowActions menuLabel={fill(t.actionsFor, { code: item.source.code })} items={menu} />
        ) : null;
      },
    },
  ];
  return (
    <DataTable
      mode="client"
      caption={fill(t.listTable, { list: t.title })}
      columns={columns}
      rows={items}
      rowKey={(item) => item.id}
      loading={loading}
      loadingLabel={t.loading}
      empty={empty}
      paging={paging ?? localPaging}
    />
  );
}

export function NotificationInbox({
  api,
  account,
  base,
  locale,
  audience = 'staff',
  frame,
}: {
  api: ApiClient;
  account: CurrentAccountResponse;
  base: string;
  locale: Locale;
  /** A member reads the inbox in words about their own bookings and orders, not the staff's work. */
  audience?: 'staff' | 'customer';
  /** The page frame around the inbox when the screen draws its own title (the member's title band takes the one action). */
  frame?: ((parts: { actions: ReactNode; children: ReactNode }) => ReactNode) | undefined;
}) {
  const t = getNotificationDictionary(locale);
  const categories = inboxCategories(account);
  const categoryKey = categories.join(',');
  // The group, the view and the page live in the address bar: Back/Forward and a shared link restore the same view.
  const [url, updateUrl] = useUrlState(INBOX_URL_DEFAULTS, INBOX_URL_OPTIONS);
  const filters = useMemo<InboxFilters>(
    () => ({
      category: categoryKey.split(',').includes(url.ncat)
        ? (url.ncat as InboxFilters['category'])
        : 'ALL',
      unreadOnly: url.nview === 'unread',
      archived: url.nview === 'archived',
    }),
    [categoryKey, url.ncat, url.nview],
  );
  const resetFilters = () => updateUrl({ ncat: 'ALL', nview: 'inbox' });
  const [page, setPage] = useState<NotificationPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const generation = useRef(0);
  const mutating = useRef(false);
  const load = useCallback(
    async (cursor?: string, passive = false) => {
      if (mutating.current) return;
      const current = ++generation.current;
      setLoading(true);
      try {
        const result = await api.get<NotificationPage>(
          '/api/v1/notifications',
          notificationQuery(filters, cursor),
          { passive },
        );
        if (current === generation.current) {
          setPage((old) =>
            cursor && old
              ? { ...result, items: mergeNotifications(old.items, result.items) }
              : result,
          );
          setError(false);
        }
      } catch {
        if (current === generation.current) setError(true);
      } finally {
        if (current === generation.current) setLoading(false);
      }
    },
    [api, filters],
  );
  // A changed filter starts a fresh first page; stale responses are ignored by `generation`.
  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  async function mutate(key: string, work: () => Promise<void>) {
    if (mutating.current) return;
    mutating.current = true;
    generation.current += 1;
    setPending(key);
    setLoading(false);
    try {
      await work();
      setError(false);
      window.dispatchEvent(new Event(CHANGED));
    } catch {
      setError(true);
    } finally {
      mutating.current = false;
      setPending(null);
    }
  }
  const refreshCounts = async (): Promise<NotificationCountResponse> =>
    api.get<NotificationCountResponse>('/api/v1/notifications/unread-count', {}, { passive: true });
  const update = (updated: NotificationItem, counts: NotificationCountResponse) =>
    setPage((old) => (old ? { ...applyItemUpdate(old, updated, filters), ...counts } : old));
  const read = (id: string) =>
    mutate(id, async () => {
      const updated = await api.post<NotificationItem>(`/api/v1/notifications/${id}/read`, {});
      update(updated, await refreshCounts());
    });
  const archive = (id: string) =>
    mutate(id, async () => {
      const updated = await api.post<NotificationItem>(`/api/v1/notifications/${id}/archive`, {});
      update(updated, await refreshCounts());
    });
  const readAll = () =>
    mutate('all', async () => {
      const result = await api.post<NotificationReadAllResponse>(
        '/api/v1/notifications/read-all',
        filters.category === 'ALL' ? {} : { category: filters.category },
      );
      // Authoritative counts now; the list is reloaded from the server right after.
      setPage((old) =>
        old
          ? {
              ...old,
              unreadCount: result.unreadCount,
              unreadByCategory: result.unreadByCategory,
            }
          : old,
      );
    }).then(() => load());
  // One paging model (the table's 20-row pager): the next server batch is fetched in the background while fewer rows than
  // the page after the current one are loaded, so "next" is always there when more exists and a shared ?npage= link restores.
  const nextCursor = page?.nextCursor ?? null;
  const loadedRows = page?.items.length ?? 0;
  useEffect(() => {
    if (nextCursor && !loading && !error && loadedRows <= url.npage * INBOX_PAGE_SIZE) {
      void load(nextCursor);
    }
  }, [nextCursor, loading, error, loadedRows, url.npage, load]);
  const busy = pending !== null;
  const unread = page?.unreadCount ?? 0;
  const emptyText = filters.archived
    ? t.emptyArchived
    : filters.category !== 'ALL' || filters.unreadOnly
      ? t.emptyFiltered
      : t.empty;
  const filtered = filters.archived || filters.category !== 'ALL' || filters.unreadOnly;
  // Heading, one sentence and one way on: a filtered view offers to show everything again; an empty inbox has nothing to do.
  const emptyState = (
    <EmptyState
      icon="bell"
      title={filtered ? t.emptyFilteredTitle : t.emptyTitle}
      action={
        filtered ? (
          <Button variant="secondary" onClick={resetFilters}>
            {t.showAll}
          </Button>
        ) : undefined
      }
    >
      {emptyText}
    </EmptyState>
  );
  const activeFilters =
    (filters.category !== 'ALL' ? 1 : 0) +
    (filters.unreadOnly ? 1 : 0) +
    (filters.archived ? 1 : 0);
  const items = page?.items ?? [];

  const markAll = filters.archived ? null : (
    <Button
      variant={frame ? 'neutral' : 'secondary'}
      icon="check-circle"
      loading={pending === 'all'}
      disabled={busy || loading || unread === 0}
      onClick={() => void readAll()}
    >
      {pending === 'all' ? t.working : t.markAllRead}
    </Button>
  );

  // With a frame (the member's title band) the frame holds the heading and takes the one action; without one the inbox draws its own.
  const content = (
    <>
      {frame ? null : (
        <PageHeader title={t.title} intro={audience === 'customer' ? t.introCustomer : t.intro}>
          {markAll}
        </PageHeader>
      )}
      <ListToolbar
        labels={toolbarLabels(t)}
        activeFilters={activeFilters}
        onReset={resetFilters}
        reload={{ label: t.refresh, onClick: () => void load(), busy: loading || busy }}
        search={
          categories.length > 0 ? (
            <Select
              id="notification-category"
              aria-label={t.category}
              value={filters.category}
              disabled={busy}
              // No count inside a filter label (Owner count rule); the unread total lives in the bell and the dashboard.
              options={[
                { value: 'ALL', label: t.allCategories },
                ...categories.map((category) => ({
                  value: category,
                  label: t.categories[category],
                })),
              ]}
              onChange={(event) => updateUrl({ ncat: event.target.value })}
            />
          ) : undefined
        }
        filters={
          <>
            <Select
              id="notification-view"
              aria-label={t.view}
              value={filters.archived ? 'archived' : filters.unreadOnly ? 'unread' : 'inbox'}
              disabled={busy}
              options={[
                { value: 'inbox', label: t.showInbox },
                { value: 'unread', label: t.unreadOnly },
                { value: 'archived', label: t.showArchived },
              ]}
              onChange={(event) => updateUrl({ nview: event.target.value })}
            />
          </>
        }
      />
      {error ? <Notice tone="error">{t.error}</Notice> : null}
      <NotificationTable
        items={items}
        locale={locale}
        hrefFor={(item) => notificationHref(item, account, base)}
        pendingId={pending}
        loading={loading && items.length === 0}
        empty={page ? emptyState : undefined}
        onRead={(id) => void read(id)}
        onArchive={(id) => void archive(id)}
        audience={audience}
        paging={{
          page: url.npage,
          pageSize: INBOX_PAGE_SIZE,
          onPageChange: (next) => updateUrl({ npage: next }),
          labels: pagingLabels(t),
        }}
      />
    </>
  );
  return frame ? <>{frame({ actions: markAll, children: content })}</> : content;
}
