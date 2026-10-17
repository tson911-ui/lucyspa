'use client';

import { useSyncExternalStore } from 'react';
import { countdownParts } from '../../lib/public-products-core';
import { unbroken } from './unbroken';

// One shared one-second clock for every countdown on the page (react-best-practices client-event-listeners): a grid with N timed
// sales runs one timer, not N.
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let now = 0;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    // A fresh reading when the clock (re)starts; React re-reads the snapshot right after subscribing.
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const notify of listeners) notify();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

// The snapshot must be stable between ticks (useSyncExternalStore compares it), so the clock is read once and then only by the timer.
const clientNow = (): number => {
  if (now === 0) now = Date.now();
  return now;
};
// The server (and the hydration pass) has no clock: the line renders empty until the browser ticks.
const serverNow = (): null => null;

/**
 * "Còn N ngày HH:MM:SS", only for a sale with an end date. The digits tick once a second (no blinking, no animation); the line keeps its
 * height before the first tick so nothing moves, and it is not announced to a screen reader every second.
 */
export function SaleCountdown({
  endsAt,
  daysText,
  timeText,
}: {
  endsAt: string;
  daysText: string;
  timeText: string;
}) {
  const current = useSyncExternalStore<number | null>(subscribe, clientNow, serverNow);
  const parts = current === null ? null : countdownParts(endsAt, current);
  // Before the first tick: an empty line of the same height. After the end: nothing (the price returns to the list price by itself).
  if (current !== null && parts === null) return null;
  const label = parts
    ? unbroken(
        (parts.days > 0 ? daysText : timeText).replace('{days}', String(parts.days)),
        '{time}',
        parts.time,
      )
    : ' ';
  return (
    <p className="ls-sale-count" role="timer" aria-live="off">
      {label}
    </p>
  );
}
