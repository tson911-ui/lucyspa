'use client';

import type {
  CurrentAccountResponse,
  NotificationItem,
  NotificationPage,
} from '@lucy-spa/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getNotificationDictionary } from '../../i18n/notifications';
import type { Locale } from '../../i18n/locales';
import type { ApiClient } from '../../lib/api/client';
import { mergeNotifications, notificationHref } from '../../lib/notifications';
import { Badge, Empty, Notice, PageHeader, Section } from '../workforce/ui';

const CHANGED = 'lucy-notifications-changed';
const REFRESH_MS = 30_000;
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
        const response = await api.get<{ unreadCount: number }>(
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
  return (
    <Link
      href={`${base}/notifications`}
      className="wf-button wf-button-quiet"
      title={failed ? t.countUnavailable : t.title}
    >
      {t.title}
      {count !== null ? ` (${count > 99 ? '99+' : count})` : ''}
      {failed ? ' · ?' : ''}
    </Link>
  );
}

export function NotificationCard({
  item,
  locale,
  href,
  busy,
  onRead,
}: {
  item: NotificationItem;
  locale: Locale;
  href: string | null;
  busy: boolean;
  onRead: () => void;
}) {
  const t = getNotificationDictionary(locale);
  const timestamp = new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone: item.branch.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(item.actionAt));
  return (
    <Section title={`${item.source.code} · ${item.branch.name}`}>
      <Badge tone={item.readAt ? 'neutral' : 'info'}>{item.readAt ? t.read : t.unread}</Badge>
      <p>{t.types[item.type]}</p>
      <p className="wf-small">
        <time dateTime={item.actionAt}>{timestamp}</time>
      </p>
      <div className="wf-actions">
        {href ? (
          <Link className="wf-button" href={href}>
            {t.open}
          </Link>
        ) : null}
        {!item.readAt ? (
          <button className="wf-button" type="button" disabled={busy} onClick={onRead}>
            {busy ? t.working : t.markRead}
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
          cursor ? { cursor } : {},
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
    [api],
  );
  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);
  async function read(id: string) {
    if (mutating.current) return;
    mutating.current = true;
    generation.current += 1;
    setPending(id);
    setLoading(false);
    try {
      const updated = await api.post<NotificationItem>(`/api/v1/notifications/${id}/read`, {});
      setPage((old) =>
        old ? { ...old, items: old.items.map((item) => (item.id === id ? updated : item)) } : old,
      );
      setError(false);
      window.dispatchEvent(new Event(CHANGED));
    } catch {
      setError(true);
    } finally {
      mutating.current = false;
      setPending(null);
    }
  }
  return (
    <>
      <PageHeader title={t.title} intro={t.intro}>
        <button
          type="button"
          className="wf-button"
          disabled={loading || pending !== null}
          onClick={() => void load()}
        >
          {t.refresh}
        </button>
      </PageHeader>
      {error ? <Notice tone="error">{t.error}</Notice> : null}
      {loading ? <p role="status">{t.loading}</p> : null}
      {page?.items.length === 0 ? <Empty>{t.empty}</Empty> : null}
      {page?.items.map((item) => (
        <NotificationCard
          key={item.id}
          item={item}
          locale={locale}
          href={notificationHref(item, account, base)}
          busy={pending !== null}
          onRead={() => void read(item.id)}
        />
      ))}
      {page?.nextCursor ? (
        <button
          type="button"
          className="wf-button"
          disabled={loading || pending !== null}
          onClick={() => void load(page.nextCursor ?? undefined)}
        >
          {t.more}
        </button>
      ) : null}
    </>
  );
}
