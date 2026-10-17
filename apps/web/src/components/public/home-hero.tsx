'use client';

import { useMotion } from '@lucy-spa/ui';
import { useEffect, useRef, type ReactNode } from 'react';

/** Set for the rest of the browser session once the opening has played: the hero moves once per visit (Owner G1, 2026-10-16). */
export const HERO_SEEN_KEY = 'ls-hero-seen';

function seenThisVisit(): boolean {
  try {
    return window.sessionStorage.getItem(HERO_SEEN_KEY) === '1';
  } catch {
    // Storage blocked (private window, previews): the opening may play again; the page is the same either way.
    return false;
  }
}

function markSeen(): void {
  try {
    window.sessionStorage.setItem(HERO_SEEN_KEY, '1');
  } catch {
    // See above.
  }
}

/**
 * The home hero and its opening, the page's one orchestrated moment (DESIGN.md 17.3): the photo (or its placeholder frame) settles from
 * 1.04 to its size over the hero duration (800 ms). Transform only, and the words never move: they are in the first paint at full
 * opacity, so the largest paint never waits for it and nothing jumps when the motion code arrives after the paint. It runs through the kit's `useMotion` (GSAP is
 * never imported here), once per visit, and never under reduced motion, data saver or the `ls-fx` off switch (the hero is simply there).
 * Server content comes in as children; this wrapper only adds the section element and the effect.
 */
export function HomeHero({
  media,
  children,
}: {
  /** `photo` with the shop's hero picture, `flat` while there is none. */
  media: 'photo' | 'flat';
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const { enabled, run } = useMotion();

  useEffect(() => {
    const scope = ref.current;
    if (!scope || !enabled || seenThisVisit()) return;
    return run(scope, (kit) => {
      markSeen();
      const total = kit.duration('hero');
      const picture = scope.querySelector('.ls-home-hero-img, .ls-home-hero-slot');
      if (picture) {
        kit.gsap.fromTo(
          picture,
          { scale: 1.04 },
          { scale: 1, duration: total, ease: 'power2.out', clearProps: 'transform' },
        );
      }
      // The words do not move: GSAP arrives after the first paint, so a rise would first drop the painted headline by the shift and
      // read as a jump, not a settle. The photo's slow settle is the moment.
    });
  }, [enabled, run]);

  return (
    <section
      ref={ref}
      className="ls-home-hero ls-band--alt"
      data-media={media}
      aria-labelledby="home-title"
    >
      {children}
    </section>
  );
}
