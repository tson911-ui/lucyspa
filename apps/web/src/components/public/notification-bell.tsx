'use client';

import type { NotificationItem, NotificationPage } from '@lucy-spa/contracts';
import { buttonClass, IconButton, Popover, VisuallyHidden } from '@lucy-spa/ui';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { getNotificationDictionary } from '../../i18n/notifications';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { mergeNotifications, notificationHref, notificationMessage } from '../../lib/notifications';
import { CHANGED, timestampParts, useUnreadCount } from '../notifications/inbox';
import { useSiteSession } from './site-session';

/** A bell ring that never reports its end (no animation support) is cleared after this long. */
const RING_FALLBACK_MS = 2000;

/** How many notifications the panel lists; the rest are one click away on the full page. */
export const BELL_PANEL_ITEMS = 8;

/** The panel's list: the newest notifications first, whatever order they arrive in. */
export const panelItems = (items: readonly NotificationItem[]): NotificationItem[] =>
  mergeNotifications([], items).slice(0, BELL_PANEL_ITEMS);

/**
 * The header's notification bell (signed-in members only): the unread count as a badge, and a panel with the latest
 * notifications (read and unread, mark as read) and a link to the full page. The bell comes first among the tools, so
 * when the session becomes known it grows into free space and the other tools stay where they are.
 */
export function NotificationBell({ locale }: { locale: Locale }) {
  const { signedIn, account } = useSiteSession();
  if (!signedIn || !account) return null;
  return <SignedInBell locale={locale} />;
}

function SignedInBell({ locale }: { locale: Locale }) {
  const { api, account } = useSiteSession();
  const site = getSiteText(locale);
  const t = getNotificationDictionary(locale);
  const { count } = useUnreadCount(api);
  const unread = count ?? 0;
  const base = `/${locale}/account`;

  // The bell rings once when the count RISES from a count already known (never on the first read or a remount).
  const [ring, setRing] = useState(false);
  const known = useRef<number | null>(null);
  useEffect(() => {
    if (count === null) return undefined;
    const before = known.current;
    known.current = count;
    if (before === null || count <= before) return undefined;
    setRing(true);
    // The animation's end clears it; this is only for a browser that never runs it.
    const timer = window.setTimeout(() => setRing(false), RING_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [count]);

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  const close = useCallback(() => setOpen(false), []);

  // Read the latest notifications each time the panel opens (a stale list would show a read one as unread).
  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setError(false);
    api
      .get<NotificationPage>('/api/v1/notifications', {}, { passive: true })
      .then((page) => {
        if (active) setItems(panelItems(page.items));
      })
      .catch(() => {
        if (active) setError(true);
      });
    // Focus moves into the panel (the first thing to act on), and Escape or leaving returns it to the bell.
    const frame = requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
    };
  }, [open, api]);

  async function markRead(id: string) {
    if (pending) return;
    setPending(id);
    try {
      const updated = await api.post<NotificationItem>(`/api/v1/notifications/${id}/read`, {});
      setItems((old) => old?.map((item) => (item.id === id ? updated : item)) ?? old);
      window.dispatchEvent(new Event(CHANGED));
    } catch {
      setError(true);
    } finally {
      setPending(null);
    }
  }

  const label =
    unread > 0
      ? `${site.header.bell.label}, ${site.header.bell.unread.replace('{count}', String(unread))}`
      : site.header.bell.label;

  return (
    <span
      className="ls-site-bell"
      data-ring={ring ? 'true' : undefined}
      onAnimationEnd={() => setRing(false)}
    >
      <IconButton
        ref={triggerRef}
        icon="bell"
        label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      />
      {unread > 0 ? (
        <span className="ls-bell-count" data-testid="notification-badge" aria-hidden="true">
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        align="end"
        role="dialog"
        label={site.header.bell.label}
        id={panelId}
        className="ls-bell-panel"
        ref={panelRef}
      >
        <p className="ls-bell-title">{site.header.bell.label}</p>
        {error ? <p className="ls-bell-note">{t.error}</p> : null}
        {items === null && !error ? <p className="ls-bell-note">{t.loading}</p> : null}
        {items !== null && items.length === 0 && !error ? (
          <p className="ls-bell-note">{t.empty}</p>
        ) : null}
        {items !== null && items.length > 0 ? (
          <ul className="ls-bell-list">
            {items.map((item) => {
              const href = account ? notificationHref(item, account, base) : null;
              const unreadItem = item.readAt === null;
              const { date, time } = timestampParts(item, locale);
              const body = (
                <>
                  {unreadItem ? <VisuallyHidden>{t.unread}: </VisuallyHidden> : null}
                  <span className="ls-bell-text">{notificationMessage(item, locale)}</span>
                  <time className="ls-bell-time" dateTime={item.actionAt}>
                    {date}, {time}
                  </time>
                </>
              );
              return (
                <li key={item.id} className="ls-bell-item" data-unread={unreadItem || undefined}>
                  {href ? (
                    <Link
                      className="ls-bell-body"
                      href={href}
                      onClick={() => {
                        close();
                        if (unreadItem) void markRead(item.id);
                      }}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="ls-bell-body">{body}</div>
                  )}
                  {unreadItem ? (
                    <IconButton
                      icon="check"
                      label={t.markRead}
                      disabled={pending !== null}
                      onClick={() => void markRead(item.id)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        <div className="ls-bell-foot">
          <Link className={buttonClass('ghost')} href={`${base}/notifications`} onClick={close}>
            {site.header.bell.viewAll}
          </Link>
        </div>
      </Popover>
    </span>
  );
}
