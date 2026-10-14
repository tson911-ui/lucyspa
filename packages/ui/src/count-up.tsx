'use client';

import { useEffect, useRef } from 'react';
import { useMotion } from './motion';

/**
 * A number that counts up once, the first time it is on screen (DESIGN.md 11.4, C17: the loyalty points). The final number is in the
 * markup from the start and stays there for assistive technology and for the layout: the counting is a second, hidden-from-readers layer
 * drawn over the final text while it runs (the final text turns transparent for that time, so the width never changes). Under reduced
 * motion, the `ls-fx` off switch, a failed load or no JavaScript nothing counts and the number is simply there. `format` writes a number
 * the way the page does, and is used for the final text and for every step.
 */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const motion = useMotion();
  const box = useRef<HTMLSpanElement | null>(null);
  const live = useRef<HTMLSpanElement | null>(null);
  const final = format(value);
  // The page's formatter may be a new function on every render; the counting reads the latest one without restarting.
  const write = useRef(format);
  useEffect(() => {
    write.current = format;
  });
  useEffect(() => {
    const element = box.current;
    const layer = live.current;
    if (!element || !layer || !motion.enabled || !Number.isFinite(value) || value <= 0) return;
    const stop = () => {
      delete element.dataset.counting;
      layer.textContent = '';
    };
    const cleanup = motion.run(
      element,
      (kit) => {
        kit.ScrollTrigger.create({
          trigger: element,
          scroller: kit.scroller(),
          start: 'top 90%',
          once: true,
          onEnter: () => {
            if (!kit.canAnimate(element)) return;
            const counter = { n: 0 };
            element.dataset.counting = 'true';
            layer.textContent = write.current(0);
            kit.gsap.to(counter, {
              n: value,
              duration: kit.duration('reveal'),
              ease: 'power2.out',
              onUpdate: () => {
                layer.textContent = write.current(Math.round(counter.n));
              },
              onComplete: stop,
            });
          },
        });
      },
      { onUnavailable: stop },
    );
    return () => {
      cleanup();
      stop();
    };
  }, [motion.enabled, motion.run, value]);
  return (
    <span ref={box} className="ls-count">
      <span className="ls-count-final">{final}</span>
      <span ref={live} className="ls-count-live" aria-hidden="true" />
    </span>
  );
}
