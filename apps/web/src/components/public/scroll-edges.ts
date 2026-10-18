'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Where a horizontally scrolling element is: at its start, at its end, both (nothing to scroll), or in between. The shared part of the
 * product and category rows (`ScrollRow`) and the filter chip rows (`ChipRail`): the arrows are enabled, or shown, from this.
 * `move(1)` / `move(-1)` scroll by 80 % of the visible width; the smooth movement is the CSS `scroll-behavior`, which the reduced-motion
 * rules switch off.
 */
export function useScrollEdges<T extends HTMLElement>() {
  const track = useRef<T | null>(null);
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
    // The children change size with the font and the window: watch them too, so an arrow appears when the row starts to overflow.
    for (const child of Array.from(element.children)) observer?.observe(child);
    return () => observer?.disconnect();
  }, [measure]);

  // The chips change with the address (a sub-category row appears, a label gets longer): measure again after every render of the owner.
  // The state setter bails out when the edges did not change, so this costs one layout read and no re-render in the common case.
  useEffect(() => {
    measure();
  });

  const move = useCallback((direction: 1 | -1) => {
    const element = track.current;
    if (!element) return;
    element.scrollBy({ left: direction * element.clientWidth * 0.8 });
  }, []);

  return { track, edge, measure, move };
}
