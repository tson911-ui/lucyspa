'use client';

import type { NotificationCountResponse, NotificationItem } from '@lucy-spa/contracts';
import { useEffect, useState } from 'react';
import type { Locale } from '../../i18n/locales';
import type { ApiClient } from '../../lib/api/client';

// The pieces of the notification inbox that the customer header bell also needs, in a module of their own: the bell no longer
// loads the staff inbox and its dictionary on every customer page (react-best-practices bundle-dynamic-imports, session 10).

/** Announced on the window whenever a notification changes, so every unread count reads again. */
export const CHANGED = 'lucy-notifications-changed';
const REFRESH_MS = 30_000;

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

const stamp = new Map<string, Intl.DateTimeFormat>();
function formatter(
  tag: string,
  zone: string | undefined,
  style: 'date' | 'time',
): Intl.DateTimeFormat {
  const key = `${tag}|${zone ?? ''}|${style}`;
  let made = stamp.get(key);
  if (!made) {
    made = new Intl.DateTimeFormat(tag, {
      ...(zone ? { timeZone: zone } : {}),
      ...(style === 'date' ? { dateStyle: 'medium' as const } : { timeStyle: 'short' as const }),
    });
    stamp.set(key, made);
  }
  return made;
}

export function timestampParts(item: NotificationItem, locale: Locale) {
  // A person-level notification (leave) has no branch; use the viewer's own time zone.
  const zone = item.branch?.timezone;
  const tag = locale === 'vi' ? 'vi-VN' : 'en-GB';
  const at = new Date(item.actionAt);
  return {
    date: formatter(tag, zone, 'date').format(at),
    time: formatter(tag, zone, 'time').format(at),
  };
}
