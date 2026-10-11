'use client';

import { useEffect, useState } from 'react';
import { countdownParts } from '../../lib/public-products-core';
import { unbroken } from './unbroken';

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
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const parts = now === null ? null : countdownParts(endsAt, now);
  // Before the first tick: an empty line of the same height. After the end: nothing (the price returns to the list price by itself).
  if (now !== null && parts === null) return null;
  const label = parts
    ? unbroken(
        (parts.days > 0 ? daysText : timeText).replace('{days}', String(parts.days)),
        '{time}',
        parts.time,
      )
    : '\u00a0';
  return (
    <p className="ls-sale-count" role="timer" aria-live="off">
      {label}
    </p>
  );
}
