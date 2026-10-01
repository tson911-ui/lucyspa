import type { ElementType, ReactNode } from 'react';
import { cx } from './cx';

// The only things that create gaps between blocks (docs/UXUI_REDESIGN_DESIGN.md 21.4 FR1-FR2):
// the gap comes from the container, never from a margin on the child.

export type StackGap = 'page' | 'block' | 'field';
export type ClusterGap = 'inline' | 'tight';
export type GridMin = 'sm' | 'md' | 'lg';

/** Vertical flow. `page` = 24 px between page blocks, `block` = 16 px inside a card, `field` = 16 px between fields. */
export function Stack({
  gap = 'block',
  as: Element = 'div',
  className,
  children,
}: {
  gap?: StackGap | undefined;
  as?: ElementType | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return <Element className={cx('ls-stack', `ls-gap-${gap}`, className)}>{children}</Element>;
}

/** Horizontal flow that wraps. `inline` = 8 px between siblings, `tight` = 4 px (icon and text). */
export function Cluster({
  gap = 'inline',
  align = 'center',
  as: Element = 'div',
  className,
  children,
}: {
  gap?: ClusterGap | undefined;
  align?: 'start' | 'center' | 'end' | undefined;
  as?: ElementType | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <Element className={cx('ls-cluster', `ls-gap-${gap}`, `ls-align-${align}`, className)}>
      {children}
    </Element>
  );
}

/** Equal-width auto-fit columns with equal row heights; `min` is the narrowest a column may get. */
export function Grid({
  min = 'md',
  gap = 'block',
  as: Element = 'div',
  className,
  children,
}: {
  min?: GridMin | undefined;
  gap?: StackGap | undefined;
  as?: ElementType | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <Element className={cx('ls-grid', `ls-grid-${min}`, `ls-gap-${gap}`, className)}>
      {children}
    </Element>
  );
}
