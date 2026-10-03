'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { motionAllowed, readMotionEnvironment } from './reveal-core';

/** True once this browser tab has drawn a page: every later mount of a route wrapper is a navigation. */
let pageDrawn = false;

/**
 * The route wrapper of the customer side (Part 2 contract 7, pattern M5): the page content eases in with a small rise
 * on every route change. The first load never animates (nothing waits for motion, so the largest contentful paint is
 * the plain page); neither does a visitor with reduced motion, data saver or a low memory device. Used in a Next
 * `template.tsx`, which remounts on every navigation. The server and the first client render agree (no animation),
 * so there is no hydration difference.
 */
export function RouteEnter({ children }: { children: ReactNode }) {
  const [enter] = useState(() => pageDrawn && motionAllowed(readMotionEnvironment()));
  useEffect(() => {
    pageDrawn = true;
  }, []);
  return (
    <div className="ls-route-fade" data-enter={enter ? 'route' : undefined}>
      {children}
    </div>
  );
}
