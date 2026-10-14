'use client';

import { useEffect } from 'react';
import { MOTION_KILLED } from './motion';
import { resolveMotionState } from './motion-core';
import { readMotionEnvironment } from './reveal-core';
import { useSeasonFx } from './season-particles';

/**
 * The one gate for motion (Part 2 contract 7, DESIGN.md 11.5): `data-ls-motion` on the document is `full` unless something says
 * otherwise, and `reduced` means no tween at all, in the customer and the staff screens alike. It says `reduced` for: reduced motion,
 * data saver, a low-memory device, the visitor's `ls-fx=off` switch (the same switch that stops the seasonal particles), the
 * staff-wide motion setting, and the build-time kill flag. The stylesheet reads it for the hero parallax, and the GSAP wrapper
 * (`motion.ts`) watches it, so flipping a switch while a page is open takes effect at once.
 *
 * `staffSetting` is the staff-wide motion setting, stubbed: the staff shells will pass the real value when groups 2 and 3 add the
 * setting; until then it is always `on`.
 */
export function MotionGate({ staffSetting = 'on' }: { staffSetting?: 'on' | 'off' | undefined }) {
  const { enabled: effectsEnabled } = useSeasonFx();
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      root.dataset['lsMotion'] = resolveMotionState({
        environment: readMotionEnvironment(),
        effectsEnabled,
        staffSetting,
        killed: MOTION_KILLED,
      });
    };
    apply();
    // A visitor can turn reduced motion on while the page is open.
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    query.addEventListener?.('change', apply);
    return () => {
      query.removeEventListener?.('change', apply);
      delete root.dataset['lsMotion'];
    };
  }, [effectsEnabled, staffSetting]);
  return null;
}
