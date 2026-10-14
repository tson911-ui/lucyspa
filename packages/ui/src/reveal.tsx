'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { cx } from './cx';
import { findScroller } from './scroller';
import { useMotion } from './motion';
import { staggerIndex, startsVisible } from './reveal-core';

/**
 * Content reveal (Part 2 contract 7, pattern M1; DESIGN.md 11.4): a block below the fold eases in once (opacity and a small
 * translate up) when it first enters the viewport, through the GSAP wrapper (`ScrollTrigger`, `once`, `top 85%`, no scrub). It is
 * visible in the server markup and without JavaScript; only after mount, and only for blocks that are not on screen yet, does it
 * start hidden, so the first paint (and the largest contentful paint) never waits for motion. When motion is off (reduced motion,
 * data saver, low memory, the `ls-fx` switch) or GSAP cannot load, the block is simply shown.
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
  const motion = useMotion();
  const position = staggerIndex(index);
  useEffect(() => {
    const element = ref.current;
    if (!element || !motion.enabled) return;
    // Below 1024 px the page scrolls inside the shell's scroller: measure against it, not against the window.
    const scroller = findScroller(element);
    const rect = element.getBoundingClientRect();
    const frame = scroller?.getBoundingClientRect();
    const top = rect.top - (frame?.top ?? 0);
    if (
      startsVisible(
        { top, bottom: top + rect.height },
        scroller ? scroller.clientHeight : window.innerHeight,
        scroller ? scroller.scrollTop : window.scrollY,
      )
    )
      return;
    element.dataset.reveal = 'hidden';
    const show = () => {
      delete element.dataset.reveal;
    };
    return motion.run(
      element,
      (kit) => {
        kit.ScrollTrigger.create({
          trigger: element,
          scroller: kit.scroller(),
          start: 'top 85%',
          once: true,
          onEnter: () => {
            show();
            // Already scrolled past, or under a text field's caret: no fade, just there.
            if (element.getBoundingClientRect().bottom <= 0 || !kit.canAnimate(element)) return;
            kit.gsap.fromTo(
              element,
              { opacity: 0, y: kit.shift() },
              {
                opacity: 1,
                y: 0,
                duration: kit.duration('reveal'),
                delay: kit.stagger(position),
                ease: 'power3.out',
                clearProps: 'opacity,transform',
              },
            );
          },
        });
      },
      { onUnavailable: show },
    );
  }, [motion.enabled, motion.run, position]);
  return (
    <div ref={ref} className={cx('ls-reveal', className)}>
      {children}
    </div>
  );
}
