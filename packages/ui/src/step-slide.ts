'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { useMotion } from './motion';

/**
 * The step of a sequence (the booking flow) slides in along the direction of the sequence (DESIGN.md 11.4, C17): moving on brings the
 * new step in from the trailing side, going back from the leading side, a short move (`--ls-reveal-shift`) with a fade, over the base
 * duration. It never runs on the first paint, only on a change of `position`, and never under reduced motion or the off switch (the new
 * step is simply there). A quick second click reverts the first slide and starts the next, so it never blocks. The element keeps the
 * focus it has: nothing here touches it, and nothing is tweened under a text field's caret.
 */
export function useStepSlide(ref: RefObject<HTMLElement | null>, position: number): void {
  const motion = useMotion();
  const last = useRef(position);
  // Warm the GSAP chunk once the page is quiet, so the first change already finds it loaded.
  useEffect(() => {
    const element = ref.current;
    if (!element || !motion.enabled) return;
    return motion.run(element, () => undefined);
  }, [ref, motion.enabled, motion.run]);
  useEffect(() => {
    const element = ref.current;
    const before = last.current;
    last.current = position;
    if (!element || !motion.enabled || before === position) return;
    const sign = position > before ? 1 : -1;
    return motion.run(element, (kit) => {
      if (!kit.canAnimate(element)) return;
      const flip = getComputedStyle(element).direction === 'rtl' ? -1 : 1;
      kit.gsap.fromTo(
        element,
        { x: sign * flip * kit.shift(), opacity: 0 },
        {
          x: 0,
          opacity: 1,
          duration: kit.duration('base'),
          ease: 'power3.out',
          clearProps: 'opacity,transform',
        },
      );
    });
  }, [ref, position, motion.enabled, motion.run]);
}
