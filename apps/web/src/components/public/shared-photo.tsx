'use client';

import { ViewTransition, type ReactNode } from 'react';

/**
 * The photo that travels from a list card to its page (DESIGN.md 11.4, C17): the same `name` on the card's picture and on the page's
 * picture makes the browser move one into the other while the page cross-fades (`PageTransition`). Both directions pair, whether or not
 * the link carried a transition type (`router.back()` carries none), and nothing else about the element animates (`default="none"`).
 * The child must be the element that holds the picture (a frame), and the name must be unique on a page.
 */
export function SharedPhoto({ name, children }: { name: string; children: ReactNode }) {
  return (
    <ViewTransition
      name={name}
      share={{ 'ls-nav': 'ls-morph', default: 'ls-morph' }}
      default="none"
    >
      {children}
    </ViewTransition>
  );
}
