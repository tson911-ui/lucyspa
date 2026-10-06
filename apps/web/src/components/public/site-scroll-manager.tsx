'use client';

import { findScroller, onPageScroll, scrollPosition } from '@lucy-spa/ui';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Scroll position of the customer pages below 1024 px, where the page scrolls inside the shell's scroller and not in the
 * document (site.css, packages/ui scroller.ts). The router only resets the document, so this does what a browser does for
 * a document: a new page (a link, a tab) starts at the top; going back or forward returns to where that page was left.
 * Above 1024 px there is no scroller and nothing here runs. Renders nothing.
 */
export function SiteScrollManager() {
  const pathname = usePathname();
  const current = useRef(pathname);
  const positions = useRef(new Map<string, number>());
  const traversal = useRef(false);

  // Remember where each page was left, and notice back/forward navigation.
  useEffect(() => {
    const stopScroll = onPageScroll(() => {
      if (findScroller()) positions.current.set(current.current, scrollPosition());
    });
    const onPop = () => {
      traversal.current = true;
    };
    window.addEventListener('popstate', onPop);
    return () => {
      stopScroll();
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  useEffect(() => {
    if (current.current === pathname) return undefined;
    current.current = pathname;
    const scroller = findScroller();
    const back = traversal.current;
    traversal.current = false;
    if (!scroller) return undefined;
    const target = back ? (positions.current.get(pathname) ?? 0) : 0;
    // A page whose content arrives after the first paint (the member area) may be too short at first: try again briefly.
    const attempt = () => {
      scroller.scrollTop = target;
    };
    attempt();
    if (target === 0) return undefined;
    const timers = [120, 360, 900].map((delay) => window.setTimeout(attempt, delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [pathname]);

  return null;
}
