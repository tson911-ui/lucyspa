'use client';

import type { ReactNode } from 'react';
import { Button, ButtonLink } from './button';
import { cx } from './cx';
import { arrangeMenu, Menu, type MenuItem } from './menu';
import { orderActions } from './menu-core';

// Where record actions live (docs/UXUI_REDESIGN_DESIGN.md 10.3 and 10.4). The order is fixed by the
// component, so a screen cannot place Delete before Edit.

function ActionButton({ item }: { item: MenuItem }) {
  const variant = item.tone === 'danger' ? 'danger-outline' : 'secondary';
  if (item.href && !item.disabled) {
    return (
      <ButtonLink href={item.href} variant={variant} icon={item.icon}>
        {item.label}
      </ButtonLink>
    );
  }
  return (
    <Button
      variant={variant}
      icon={item.icon}
      onClick={item.onSelect}
      disabled={item.disabled}
      disabledReason={item.disabledReason}
    >
      {item.label}
    </Button>
  );
}

/**
 * Page/record actions, right aligned in the page header: safe actions, then destructive ones in
 * danger-outline, then the single primary action last. On a phone the same actions collapse into
 * the primary button plus a `...` menu (both trees are rendered; CSS shows one).
 */
export function ActionBar({
  label,
  moreLabel,
  actions,
  primary,
  className,
}: {
  /** Accessible name of the group, e.g. "Employee actions". */
  label: string;
  /** Accessible name of the phone `...` menu. */
  moreLabel: string;
  actions: readonly MenuItem[];
  primary?: ReactNode | undefined;
  className?: string | undefined;
}) {
  const { safe, danger } = orderActions(actions);
  return (
    <div className={cx('ls-actionbar', className)} role="group" aria-label={label}>
      <div className="ls-actionbar-inline">
        {[...safe, ...danger].map((item) => (
          <ActionButton key={item.id} item={item} />
        ))}
      </div>
      {actions.length > 0 ? (
        <div className="ls-actionbar-compact">
          <Menu label={moreLabel} items={arrangeMenu(actions)} />
        </div>
      ) : null}
      {primary}
    </div>
  );
}

/**
 * Last cell of a table row (plan 7.5c, contract 10.4): one `⋮` button that opens the row's menu.
 * Edit (or View for read-only authority) comes first, then the safe actions, then, after a divider,
 * the destructive one in danger text; the order is fixed by `arrangeMenu`. The name cell is the link
 * to the detail page, so there is no second visible button. No items renders nothing.
 */
export function RowActions({
  menuLabel,
  items,
}: {
  /** Accessible name of the `⋮` button, e.g. "Actions for Nail Gel". */
  menuLabel: string;
  items: readonly MenuItem[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="ls-row-actions">
      <Menu label={menuLabel} items={arrangeMenu(items)} icon="more-vertical" />
    </div>
  );
}
