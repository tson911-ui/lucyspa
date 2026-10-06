'use client';

import { motionAllowed, readMotionEnvironment } from '@lucy-spa/ui';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, ViewTransition, type ReactNode } from 'react';

/**
 * The page between the header and the footer changes with a short cross-fade (the browser's View Transitions API,
 * through React's `<ViewTransition>`): the old page stays on screen until the new one is ready, then fades into it, and
 * the header, tab bar and footer never move (site.css names them). Only a navigation link starts it (type `ls-nav`);
 * a filter or page change inside a page, a refresh and a reload do not. A browser without the API gets a plain
 * opacity fade from 60 % (never from nothing); reduced motion, data saver and low memory devices get none (the
 * stylesheet's duration tokens are 0 under reduced motion, so the API's cross-fade is instant too).
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const element = useRef<HTMLDivElement | null>(null);
  const previous = useRef(pathname);

  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    const page = element.current;
    if (!page || typeof document.startViewTransition === 'function') return;
    if (!motionAllowed(readMotionEnvironment())) return;
    const duration = Number.parseFloat(getComputedStyle(page).getPropertyValue('--ls-dur-base'));
    if (!(duration > 0)) return;
    page.animate([{ opacity: 0.6 }, { opacity: 1 }], { duration, easing: 'ease-out' });
  }, [pathname]);

  return (
    <ViewTransition name="ls-page" update={{ 'ls-nav': 'ls-fade', default: 'none' }} default="none">
      <div ref={element} className="ls-route-fade">
        {children}
      </div>
    </ViewTransition>
  );
}
