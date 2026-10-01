import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * The list toolbar's "rows are selected" state (docs/UXUI_REDESIGN_DESIGN.md 10.2): it takes the place of
 * `ListToolbar` while at least one row is selected. The count reads first (live region), then the
 * actions that apply to the selection: ghost "clear / select all" buttons, secondary actions and the
 * one primary action last. It wraps under the count on a narrow screen.
 */
export function SelectionBar({
  label,
  summary,
  className,
  children,
}: {
  /** Accessible name of the toolbar, e.g. "Actions for the selection". */
  label: string;
  /** e.g. "3 selected". */
  summary: string;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className={cx('ls-selection-bar', className)} role="toolbar" aria-label={label}>
      <p className="ls-selection-summary" role="status">
        {summary}
      </p>
      <div className="ls-selection-actions">{children}</div>
    </div>
  );
}
