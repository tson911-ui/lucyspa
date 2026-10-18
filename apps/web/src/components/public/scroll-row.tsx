'use client';

import { IconButton } from '@lucy-spa/ui';
import type { ReactNode } from 'react';
import { useScrollEdges } from './scroll-edges';

/**
 * A horizontal row that scrolls inside itself with scroll-snap (DESIGN.md 9.1, item 4): the page never scrolls sideways. A swipe or the
 * keyboard moves it everywhere; from 1024 px two arrow buttons (the CSS hides them below) are the pointer alternative, and each is
 * disabled at its end. The smooth movement is the CSS `scroll-behavior`, which the reduced-motion rules switch off.
 */
export function ScrollRow({
  label,
  previous,
  next,
  variant,
  children,
}: {
  /** The accessible name of the row. */
  label: string;
  previous: string;
  next: string;
  /** `tiles`: the category rows of the home page (tiles of one size in a row; the two arrows sit under the row). */
  variant?: 'tiles' | undefined;
  /** The row's items: `li` elements. */
  children: ReactNode;
}) {
  const { track, edge, measure, move } = useScrollEdges<HTMLUListElement>();

  return (
    <div className="ls-snap-row" data-variant={variant}>
      <ul
        ref={track}
        className="ls-snap-track"
        aria-label={label}
        // A row that scrolls is reachable by keyboard (arrow keys scroll it) even when no item inside takes focus (WCAG 2.1.1).
        tabIndex={0}
        onScroll={measure}
      >
        {children}
      </ul>
      <div
        className="ls-snap-arrows ls-toolbar-actions"
        role="group"
        aria-label={`${previous} / ${next}`}
      >
        <IconButton
          icon="chevron-left"
          label={previous}
          variant="neutral"
          disabled={edge.start}
          onClick={() => move(-1)}
        />
        <IconButton
          icon="chevron-right"
          label={next}
          variant="neutral"
          disabled={edge.end}
          onClick={() => move(1)}
        />
      </div>
    </div>
  );
}
