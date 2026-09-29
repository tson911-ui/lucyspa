'use client';

import type {
  CurrentAccountResponse,
  NotificationCountResponse,
  NotificationItem,
  NotificationPage,
  NotificationReadAllResponse,
} from '@lucy-spa/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getNotificationDictionary } from '../../i18n/notifications';
import type { Locale } from '../../i18n/locales';
import type { ApiClient } from '../../lib/api/client';
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
import { Badge, Empty, Notice, PageHeader, Section } from '../workforce/ui';

const CHANGED = 'lucy-notifications-changed';
const REFRESH_MS = 30_000;

/** Bell with the unread badge (archived items are never counted by the API). */
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
  const [count, setCount] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
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
  const label =
    failed || count === null
      ? failed
        ? t.countUnavailable
        : t.bell
      : `${t.bell}: ${count} ${t.bellUnread}`;
  return (
    <Link
      href={`${base}/notifications`}
      className="wf-button wf-button-quiet"
      title={label}
      aria-label={label}
    >
      <svg
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
      {count !== null && count > 0 ? (
        <span className="wf-badge wf-badge-warning" data-testid="notification-badge">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
      {failed ? <span aria-hidden="true"> ?</span> : null}
    </Link>
  );
}

export function NotificationCard({
  item,
  locale,
  href,
  busy,
  onRead,
  onArchive,
}: {
  item: NotificationItem;
  locale: Locale;
  href: string | null;
  busy: boolean;
  onRead: () => void;
  /** Omitted where archiving is not offered. Archived items never show the action. */
  onArchive?: () => void;
}) {
  const t = getNotificationDictionary(locale);
  const timestamp = new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    // A person-level notification (leave) has no branch; use the viewer's own time zone.
    ...(item.branch ? { timeZone: item.branch.timezone } : {}),
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(item.actionAt));
  return (
    <Section title={item.branch ? `${item.source.code} · ${item.branch.name}` : item.source.code}>
      <Badge tone={item.readAt ? 'neutral' : 'info'}>{item.readAt ? t.read : t.unread}</Badge>
      {item.archivedAt ? <Badge tone="neutral">{t.archivedBadge}</Badge> : null}
      <p>{notificationMessage(item, locale)}</p>
      <p className="wf-small">
        <time dateTime={item.actionAt}>{timestamp}</time>
      </p>
      <div className="wf-actions">
        {href ? (
          <Link className="wf-button" href={href}>
            {item.source.type === 'LeaveRequest' ? t.openLeave : t.open}
          </Link>
        ) : null}
        {!item.readAt ? (
          <button className="wf-button" type="button" disabled={busy} onClick={onRead}>
            {busy ? t.working : t.markRead}
          </button>
        ) : null}
        {onArchive && !item.archivedAt ? (
          <button
            className="wf-button wf-button-quiet"
            type="button"
            disabled={busy}
            onClick={onArchive}
          >
            {busy ? t.working : t.archive}
          </button>
        ) : null}
      </div>
    </Section>
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
  return (
    <>
      <PageHeader title={t.title} intro={t.intro}>
        <button
          type="button"
          className="wf-button"
          disabled={loading || busy}
          onClick={() => void load()}
        >
          {t.refresh}
        </button>
      </PageHeader>
      <div className="wf-filters" role="group" aria-label={t.filters}>
        {categories.length > 0 ? (
          <>
            <button
              type="button"
              className="wf-button wf-button-quiet"
              aria-pressed={filters.category === 'ALL'}
              disabled={busy}
              onClick={() => setFilters({ ...filters, category: 'ALL' })}
            >
              {t.allCategories}
              {page && !filters.archived ? ` (${unread})` : ''}
            </button>
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                className="wf-button wf-button-quiet"
                aria-pressed={filters.category === category}
                disabled={busy}
                onClick={() => setFilters({ ...filters, category })}
              >
                {t.categories[category]}
                {page && !filters.archived ? ` (${page.unreadByCategory[category]})` : ''}
              </button>
            ))}
          </>
        ) : null}
        <label>
          <input
            type="checkbox"
            checked={filters.unreadOnly}
            disabled={busy}
            onChange={(event) => setFilters({ ...filters, unreadOnly: event.target.checked })}
          />{' '}
          {t.unreadOnly}
        </label>
        <button
          type="button"
          className="wf-button wf-button-quiet"
          aria-pressed={filters.archived}
          disabled={busy}
          onClick={() => setFilters({ ...filters, archived: !filters.archived })}
        >
          {filters.archived ? t.showInbox : t.showArchived}
        </button>
        {!filters.archived ? (
          <button
            type="button"
            className="wf-button"
            disabled={busy || loading || unread === 0}
            onClick={() => void readAll()}
          >
            {pending === 'all' ? t.working : t.markAllRead}
          </button>
        ) : null}
      </div>
      {error ? <Notice tone="error">{t.error}</Notice> : null}
      {loading ? <p role="status">{t.loading}</p> : null}
      {page?.items.length === 0 && !loading ? <Empty>{emptyText}</Empty> : null}
      {page?.items.map((item) => (
        <NotificationCard
          key={item.id}
          item={item}
          locale={locale}
          href={notificationHref(item, account, base)}
          busy={busy}
          onRead={() => void read(item.id)}
          onArchive={() => void archive(item.id)}
        />
      ))}
      {page?.nextCursor ? (
        <button
          type="button"
          className="wf-button"
          disabled={loading || busy}
          onClick={() => void load(page.nextCursor ?? undefined)}
        >
          {t.more}
        </button>
      ) : null}
    </>
  );
}
