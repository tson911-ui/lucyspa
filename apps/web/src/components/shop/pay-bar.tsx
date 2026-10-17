import type { ReactNode } from 'react';

/**
 * The phone's pay bar of the cart and the checkout (plans customer/cart, customer/checkout): below 1024 px the total and the page's one
 * filled button stay at the bottom of the scrolling page, above the tab bar. It is the kit's action bar (sticky in the flow, so it takes
 * its own room at the end of the content and never covers the last line; the contact button lifts above it). The same action in the
 * summary card is hidden on phones (`.ls-pay-inline`), so only one filled button is ever in view; from 1024 px the bar is not drawn. At
 * a large text size it wraps and stops sticking (`html[data-text-large]`), so it never takes a big share of the screen.
 */
export function PayBar({
  label,
  totalLabel,
  total,
  children,
}: {
  /** The bar's accessible name. */
  label: string;
  totalLabel: string;
  total: string;
  /** The action: the checkout link or the submit button. */
  children: ReactNode;
}) {
  return (
    <div className="ls-action-bar ls-pay-bar" role="region" aria-label={label}>
      <p className="ls-pay-bar-total">
        <span className="ls-pay-bar-label">{totalLabel}</span>
        <strong>{total}</strong>
      </p>
      <div className="ls-pay-bar-action">{children}</div>
    </div>
  );
}
