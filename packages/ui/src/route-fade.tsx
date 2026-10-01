import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * Route content fade (decision D13): wrap the page in a Next `template.tsx`, which remounts on every navigation,
 * so the content eases in (opacity only, 200 ms token, off under reduced motion). Server-safe.
 * `stack` makes the wrapper the page's block container (24 px between its blocks), for routes inside a `Page`.
 */
export function RouteFade({
  stack = false,
  children,
}: {
  stack?: boolean | undefined;
  children: ReactNode;
}) {
  return <div className={cx('ls-route-fade', stack && 'ls-stack ls-gap-page')}>{children}</div>;
}
