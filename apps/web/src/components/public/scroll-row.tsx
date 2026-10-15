'use client';

import { IconButton } from '@lucy-spa/ui';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A horizontal row that scrolls inside itself with scroll-snap (DESIGN.md 9.1, item 4): the page never scrolls sideways. A swipe or the
 * keyboard moves it everywhere; from 1024 px two arrow buttons (the CSS hides them below) are the pointer alternative, and each is
 * disabled at its end. The smooth movement is the CSS `scroll-behavior`, which the reduced-motion rules switch off.
 */
export function ScrollRow({
  label,
  previous,
  next,
  children,
}: {
  /** The accessible name of the row. */
  label: string;
  previous: string;
  next: string;
  /** The row's items: `li` elements. */
  children: ReactNode;
}) {
  const track = useRef<HTMLUListElement | null>(null);
  const [edge, setEdge] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const element = track.current;
    if (!element) return;
    // A fraction of a pixel of rounding must not leave an arrow enabled at the very end.
    const start = element.scrollLeft <= 1;
    const end = element.scrollLeft + element.clientWidth >= element.scrollWidth - 1;
    setEdge((was) => (was.start === start && was.end === end ? was : { start, end }));
  }, []);

  useEffect(() => {
    const element = track.current;
    if (!element) return;
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [measure]);

  const move = (direction: 1 | -1) => {
    const element = track.current;
    if (!element) return;
    element.scrollBy({ left: direction * element.clientWidth * 0.8 });
  };

  return (
    <div className="ls-snap-row">
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
