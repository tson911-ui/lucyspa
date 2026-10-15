import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * A plain block wrapper. It used to ease its content in on scroll (with a stagger between siblings); the Owner's motion rule of
 * 2026-10-16 (G2) removes every scroll reveal: each customer page has at most one orchestrated moment, and everything else moves only in
 * answer to a user action. The component keeps its API so the pages can drop it one by one; `index` is ignored.
 */
export function Reveal({
  className,
  children,
}: {
  /** Kept for callers; no stagger any more. */
  index?: number | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return <div className={cx('ls-reveal', className)}>{children}</div>;
}
