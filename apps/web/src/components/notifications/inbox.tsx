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
  CursorPagination,
  DataTable,
  Icon,
  ListToolbar,
  RowActions,
  Select,
  buttonClass,
  type DataTableColumn,
  type MenuItem,
} from '@lucy-spa/ui';
import { PrefetchLink as Link } from '../workforce/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { fill, getWorkforceDictionary } from '../../i18n/workforce';
import { getNotificationDictionary } from '../../i18n/notifications';
import type { Locale } from '../../i18n/locales';
import type { ApiClient } from '../../lib/api/client';
import { cursorLabels, toolbarLabels } from '../../lib/workforce/list-view';
import { useClientPaging } from '../../lib/workforce/use-client-paging';
import {
  applyItemUpdate,
  DEFAULT_INBOX_FILTERS,
  inboxCategories,
  mergeNotifications,
  notificationHref,
  notificationMessage,
  notificationQuery,
  type InboxFilters,
} from '../../lib/notifications';
import { Badge, Empty, Notice, PageHeader } from '../workforce/ui';

/** Announced on the window whenever a notification changes, so every unread count reads again. */
export const CHANGED = 'lucy-notifications-changed';
const REFRESH_MS = 30_000;

type NotificationTexts = ReturnType<typeof getNotificationDictionary>;

/**
 * The unread count (archived items are never counted by the API), read now, every 30 seconds and whenever the inbox
 * changes it. `null` as the client reads nothing (nobody is signed in).
 */
export function useUnreadCount(api: ApiClient | null): { count: number | null; failed: boolean } {
  const [count, setCount] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!api) {
      setCount(null);
      setFailed(false);
      return;
    }
    let active = true;
    let generation = 0;
    const load = async () => {
      const current = ++generation;
      try {
        const response = await api.get<NotificationCountResponse>(
          '/api/v1/notifications/unread-count',
          {},
          { passive: true },
        );
        if (active && current === generation) {
          setCount(response.unreadCount);
          setFailed(false);
        }
      } catch {
        if (active && current === generation) setFailed(true);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    const changed = () => void load();
    window.addEventListener(CHANGED, changed);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener(CHANGED, changed);
    };
  }, [api]);
  return { count, failed };
}

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

export function timestampParts(item: NotificationItem, locale: Locale) {
  // A person-level notification (leave) has no branch; use the viewer's own time zone.
  const zone = item.branch ? { timeZone: item.branch.timezone } : {};
  const tag = locale === 'vi' ? 'vi-VN' : 'en-GB';
  const at = new Date(item.actionAt);
  return {
    date: new Intl.DateTimeFormat(tag, { ...zone, dateStyle: 'medium' }).format(at),
    time: new Intl.DateTimeFormat(tag, { ...zone, timeStyle: 'short' }).format(at),
  };
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
}: {
  items: readonly NotificationItem[];
  locale: Locale;
  hrefFor: (item: NotificationItem) => string | null;
  pendingId: string | null;
  loading?: boolean | undefined;
  empty?: ReactNode;
  onRead: (id: string) => void;
  onArchive?: ((id: string) => void) | undefined;
}) {
  const t = getNotificationDictionary(locale);
  const w = getWorkforceDictionary(locale);
  const paging = useClientPaging(w, t.title);
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
        const open =
          item.source.type === 'LeaveRequest'
            ? t.openLeave
            : item.source.type === 'Invoice'
              ? t.finance.openInvoice
              : item.source.type === 'ProductReturnCase'
                ? t.returns.openCase
                : item.source.type === 'ProductVariant' || item.type === 'EXPIRY_ALERT'
                  ? t.inventory.openStock
                  : t.open;
        return href ? (
          <Link className="ls-link" href={href} title={`${open}: ${message}`}>
            {message}
          </Link>
        ) : (
          message
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
          <span className="ls-cell-main">{item.source.code}</span>
          <span className="ls-cell-sub ls-cell-title" title={item.branch?.name}>
            {item.branch?.name ?? '—'}
          </span>
        </span>
      ),
    },
    {
      key: 'status',
      header: t.columnStatus,
      cell: (item) => (
        <>
          <Badge tone={item.readAt ? 'neutral' : 'info'}>{item.readAt ? t.read : t.unread}</Badge>
          {item.archivedAt ? <Badge tone="neutral">{t.archivedBadge}</Badge> : null}
        </>
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
      caption={fill(w.common.list.table, { list: t.title })}
      columns={columns}
      rows={items}
      rowKey={(item) => item.id}
      loading={loading}
      loadingLabel={t.loading}
      empty={empty}
      paging={paging}
    />
  );
}

export function NotificationInbox({
  api,
  account,
  base,
  locale,
}: {
  api: ApiClient;
  account: CurrentAccountResponse;
  base: string;
  locale: Locale;
}) {
  const t = getNotificationDictionary(locale);
  const w = getWorkforceDictionary(locale);
  const categories = inboxCategories(account);
  const [filters, setFilters] = useState<InboxFilters>(DEFAULT_INBOX_FILTERS);
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
  const busy = pending !== null;
  const unread = page?.unreadCount ?? 0;
  const emptyText = filters.archived
    ? t.emptyArchived
    : filters.category !== 'ALL' || filters.unreadOnly
      ? t.emptyFiltered
      : t.empty;
  const counted = page && !filters.archived;
  const activeFilters =
    (filters.category !== 'ALL' ? 1 : 0) +
    (filters.unreadOnly ? 1 : 0) +
    (filters.archived ? 1 : 0);
  const items = page?.items ?? [];

  return (
    <>
      <PageHeader title={t.title} intro={t.intro}>
        {!filters.archived ? (
          <Button
            variant="secondary"
            icon="check-circle"
            loading={pending === 'all'}
            disabled={busy || loading || unread === 0}
            onClick={() => void readAll()}
          >
            {pending === 'all' ? t.working : t.markAllRead}
          </Button>
        ) : null}
      </PageHeader>
      <ListToolbar
        labels={toolbarLabels(w)}
        activeFilters={activeFilters}
        onReset={() => setFilters(DEFAULT_INBOX_FILTERS)}
        reload={{ label: t.refresh, onClick: () => void load(), busy: loading || busy }}
        search={
          categories.length > 0 ? (
            <Select
              id="notification-category"
              aria-label={t.category}
              value={filters.category}
              disabled={busy}
              options={[
                { value: 'ALL', label: `${t.allCategories}${counted ? ` (${unread})` : ''}` },
                ...categories.map((category) => ({
                  value: category,
                  label: `${t.categories[category]}${counted ? ` (${page.unreadByCategory[category]})` : ''}`,
                })),
              ]}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  category: event.target.value as InboxFilters['category'],
                })
              }
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
              onChange={(event) =>
                setFilters({
                  ...filters,
                  archived: event.target.value === 'archived',
                  unreadOnly: event.target.value === 'unread',
                })
              }
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
        empty={page ? <Empty>{emptyText}</Empty> : undefined}
        onRead={(id) => void read(id)}
        onArchive={(id) => void archive(id)}
      />
      {page?.nextCursor ? (
        <CursorPagination
          hasNext
          loading={loading || busy}
          onNext={() => void load(page.nextCursor ?? undefined)}
          labels={{ ...cursorLabels(w, t.title), loadMore: t.more }}
        />
      ) : null}
    </>
  );
}
