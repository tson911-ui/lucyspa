'use client';

import { IconButton } from '@lucy-spa/ui';
import type { ReactNode } from 'react';
import { useScrollEdges } from './scroll-edges';

/**
 * A row of filter chips that scrolls inside itself (Owner, 2026-10-18): a row that is wider than its space never clips a chip. Two round
 * buttons (‹ ›) scroll it, and each one is hidden when there is nothing more in its direction, so a row that fits shows none. The
 * edges fade under the buttons (the CSS masks them), so a chip is never cut hard. A swipe or the keyboard still moves the row.
 */
export function ChipRail({
  label,
  previous,
  next,
  children,
}: {
  /** The accessible name of the chip navigation. */
  label: string;
  previous: string;
  next: string;
  /** The chips: links. */
  children: ReactNode;
}) {
  const { track, edge, measure, move } = useScrollEdges<HTMLElement>();
  return (
    <div
      className="ls-rail"
      data-start={edge.start ? 'true' : undefined}
      data-end={edge.end ? 'true' : undefined}
    >
      <div className="ls-rail-arrow" data-dir="previous" hidden={edge.start}>
        <IconButton
          icon="chevron-left"
          label={previous}
          variant="neutral"
          onClick={() => move(-1)}
        />
      </div>
      <nav ref={track} className="ls-pills" aria-label={label} onScroll={measure}>
        {children}
      </nav>
      <div className="ls-rail-arrow" data-dir="next" hidden={edge.end}>
        <IconButton icon="chevron-right" label={next} variant="neutral" onClick={() => move(1)} />
      </div>
    </div>
  );
}
