import type { ReactNode } from 'react';

/**
 * Route content fade (decision D13): wrap the page in a Next `template.tsx`, which remounts on every navigation,
 * so the content eases in (opacity only, 200 ms token, off under reduced motion). Server-safe.
 */
export function RouteFade({ children }: { children: ReactNode }) {
  return <div className="ls-route-fade">{children}</div>;
}
