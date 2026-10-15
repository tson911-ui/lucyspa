import { cx } from './cx';

/**
 * The pause control of a moving strip (WCAG 2.2.2): a labelled checkbox drawn as a round button by the stylesheet (checked = paused). It has no
 * script: the strip's own CSS reads `:has(.ls-brand-pause:checked)` to stop its animation. Server-safe.
 */
export function MotionPause({
  label,
  className,
}: {
  label: string;
  className?: string | undefined;
}) {
  return <input type="checkbox" className={cx('ls-brand-pause', className)} aria-label={label} />;
}
