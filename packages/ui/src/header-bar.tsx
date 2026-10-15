import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * The one header bar of every area (Owner R7, DESIGN.md D2, session 10): the customer site, the counter and the admin all render it. Wordmark
 * at the leading edge, then the navigation, then the actions at the trailing edge, on the base surface with a 1 px bottom hairline
 * (`.ls-headerbar` in foundation-v2.css). It is sticky only while the viewport is tall enough (at 200 % zoom it scrolls away, B20). Each
 * area passes its own slot classes so its layout rules keep applying; the bar itself is the same element with the same base styles.
 */
export function HeaderBar({
  className,
  rowClassName,
  start,
  brand,
  brandClassName,
  nav,
  end,
  endClassName,
  scrolled,
}: {
  /** The area's class for the bar (`ls-site-header`, `ls-topbar`). */
  className?: string | undefined;
  /** The area's class for the inner row (the customer row is a centred container). */
  rowClassName?: string | undefined;
  /** Before the wordmark (the staff menu button on a narrow screen). */
  start?: ReactNode;
  brand: ReactNode;
  brandClassName?: string | undefined;
  /** The main navigation, after the wordmark. */
  nav?: ReactNode;
  /** The actions at the trailing edge. */
  end?: ReactNode;
  endClassName?: string | undefined;
  /** True once the page has scrolled under the bar (it compacts; transform only). */
  scrolled?: boolean | undefined;
}) {
  const content = (
    <>
      {start}
      <div className={cx('ls-headerbar-brand', brandClassName)}>{brand}</div>
      {nav}
      {end ? <div className={cx('ls-headerbar-end', endClassName)}>{end}</div> : null}
    </>
  );
  return (
    <header className={cx('ls-headerbar', className)} data-scrolled={scrolled ? 'true' : undefined}>
      {rowClassName ? (
        <div className={cx('ls-headerbar-row', rowClassName)}>{content}</div>
      ) : (
        content
      )}
    </header>
  );
}
