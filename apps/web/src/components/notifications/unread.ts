'use client';

import type { NotificationCountResponse, NotificationItem } from '@lucy-spa/contracts';
import { useCallback, useSyncExternalStore } from 'react';
import type { Locale } from '../../i18n/locales';
import type { ApiClient } from '../../lib/api/client';

// The pieces of the notification inbox that the customer header bell also needs, in a module of their own: the bell no longer
// loads the staff inbox and its dictionary on every customer page (react-best-practices bundle-dynamic-imports, session 10).

/** Announced on the window whenever a notification changes, so every unread count reads again. */
export const CHANGED = 'lucy-notifications-changed';
const REFRESH_MS = 30_000;

type UnreadSnapshot = { count: number | null; failed: boolean };
const NOTHING: UnreadSnapshot = { count: null, failed: false };

/*
 * One feed per API client, shared by every caller (react-best-practices client-swr-dedup): the header bell and the account overview
 * on /account used to poll the same endpoint twice. The feed runs while at least one caller is mounted, reads nothing while the tab
 * is hidden, and reads again as soon as it is shown.
 */
interface UnreadFeed {
  snapshot: UnreadSnapshot;
  listeners: Set<() => void>;
  stop: (() => void) | null;
  generation: number;
}
const feeds = new WeakMap<ApiClient, UnreadFeed>();

function feedOf(api: ApiClient): UnreadFeed {
  let feed = feeds.get(api);
  if (!feed) {
    feed = { snapshot: NOTHING, listeners: new Set(), stop: null, generation: 0 };
    feeds.set(api, feed);
  }
  return feed;
}

function publish(feed: UnreadFeed, next: UnreadSnapshot): void {
  feed.snapshot = next;
  for (const listener of feed.listeners) listener();
}

function startFeed(api: ApiClient, feed: UnreadFeed): void {
  const load = async () => {
    if (document.hidden) return;
    const current = ++feed.generation;
    try {
      const response = await api.get<NotificationCountResponse>(
        '/api/v1/notifications/unread-count',
        {},
        { passive: true },
      );
      if (feed.stop && current === feed.generation) {
        publish(feed, { count: response.unreadCount, failed: false });
      }
    } catch {
      if (feed.stop && current === feed.generation)
        publish(feed, { ...feed.snapshot, failed: true });
    }
  };
  const timer = window.setInterval(() => void load(), REFRESH_MS);
  const changed = () => void load();
  const shown = () => {
    if (!document.hidden) void load();
  };
  window.addEventListener(CHANGED, changed);
  document.addEventListener('visibilitychange', shown);
  feed.stop = () => {
    window.clearInterval(timer);
    window.removeEventListener(CHANGED, changed);
    document.removeEventListener('visibilitychange', shown);
    feed.stop = null;
    // The next caller (perhaps another member after a sign-in) starts from nothing, never from this count.
    feed.snapshot = NOTHING;
  };
  void load();
}

/**
 * The unread count (archived items are never counted by the API), read now, every 30 seconds and whenever the inbox
 * changes it. `null` as the client reads nothing (nobody is signed in).
 */
export function useUnreadCount(api: ApiClient | null): UnreadSnapshot {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!api) return () => undefined;
      const feed = feedOf(api);
      feed.listeners.add(listener);
      if (!feed.stop) startFeed(api, feed);
      return () => {
        feed.listeners.delete(listener);
        if (feed.listeners.size === 0) feed.stop?.();
      };
    },
    [api],
  );
  // No client: nothing to count (derived, not reset in an effect).
  const read = useCallback(() => (api ? feedOf(api).snapshot : NOTHING), [api]);
  return useSyncExternalStore(subscribe, read, () => NOTHING);
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
