'use client';

import { useEffect, useRef } from 'react';

/** The bar may stay sticky while it takes at most this share of the window height (with the phone tab bar, under 30 %, C16). */
export const HEADER_FIT_SHARE = 0.18;
/** Root font size from which the page counts as "large text" (200 % text is 32 px): secondary sticky bands stop sticking. */
export const LARGE_TEXT_PX = 24;

/**
 * Keeps the sticky header from covering the page (C16, B20): when the bar grows past a share of the window (200 % text wraps its
 * navigation, a short window), it gets `data-fit="static"` and scrolls away with the page; `html[data-text-large]` lets other sticky
 * bands do the same. Renders a hidden marker inside the bar and watches the bar's own size, so it costs one observer per page.
 */
export function HeaderFit() {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const bar = marker.current?.closest('header');
    if (!bar) return;
    const root = document.documentElement;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const tall = bar.getBoundingClientRect().height > window.innerHeight * HEADER_FIT_SHARE;
        if (tall) bar.setAttribute('data-fit', 'static');
        else bar.removeAttribute('data-fit');
        const large = parseFloat(getComputedStyle(root).fontSize) >= LARGE_TEXT_PX;
        root.toggleAttribute('data-text-large', large);
      });
    };
    measure();
    // Older engines (and jsdom) have no ResizeObserver: the window resize listener still covers zoom and a resized window.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(bar);
    window.addEventListener('resize', measure, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  return <span ref={marker} hidden />;
}
