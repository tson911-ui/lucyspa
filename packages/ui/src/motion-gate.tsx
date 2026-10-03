'use client';

import { useEffect } from 'react';
import { motionAllowed, readMotionEnvironment } from './reveal-core';

/**
 * Tells the stylesheet whether this visitor's device may run scroll effects (Part 2 contract 7): `data-ls-motion` on the
 * document is `full` unless reduced motion, data saver or a low-memory device says otherwise. The stylesheet reads it
 * for the hero parallax; reduced motion is also checked there by a media query, so the effect is off before this runs.
 */
export function MotionGate() {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset['lsMotion'] = motionAllowed(readMotionEnvironment()) ? 'full' : 'reduced';
    return () => {
      delete root.dataset['lsMotion'];
    };
  }, []);
  return null;
}
