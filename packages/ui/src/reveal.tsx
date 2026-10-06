'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { cx } from './cx';
import { motionAllowed, readMotionEnvironment, staggerIndex, startsVisible } from './reveal-core';

/**
 * Content reveal (Part 2 contract 7, pattern M1): a block below the fold eases in once (opacity and a small
 * translate) when it first enters the viewport. It is visible in the server markup and without JavaScript; only
 * after mount, and only for blocks that are not on screen yet, does it start hidden, so the first paint (and the
 * largest contentful paint) never waits for motion. Reduced motion, data saver and low memory devices see the
 * content at once. One observer per block, no scroll listener.
 */
export function Reveal({
  index = 0,
  className,
  children,
}: {
  /** Position among siblings, for the stagger (at most six steps). */
  index?: number | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || !motionAllowed(readMotionEnvironment())) return;
    if (startsVisible(element.getBoundingClientRect(), window.innerHeight, window.scrollY)) return;
    element.dataset.reveal = 'hidden';
    let first = true;
    const observer = new IntersectionObserver(
      (entries) => {
        const initial = first;
        first = false;
        if (!entries.some((entry) => entry.isIntersecting)) return;
        // Already on screen when the observer first looked (the page was scrolled or resized in between): show it
        // without the fade, so nothing visible is ever hidden and then faded in.
        if (initial) delete element.dataset.reveal;
        else element.dataset.reveal = 'shown';
        observer.disconnect();
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const style = { '--ls-reveal-index': staggerIndex(index) } as CSSProperties;
  return (
    <div ref={ref} className={cx('ls-reveal', className)} style={style}>
      {children}
    </div>
  );
}
