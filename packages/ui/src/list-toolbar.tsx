'use client';

import { useState, type ReactNode } from 'react';
import { Button } from './button';
import { cx } from './cx';
import { Icon } from './icons';
import { Drawer } from './overlay';
import { fillTemplate } from './paging-core';
import { PHONE_QUERY, useMediaQuery } from './use-media-query';

export interface ListToolbarLabels {
  /** Accessible name of the toolbar (role="search"). */
  toolbar: string;
  /** Title of the phone sheet and text of its button, e.g. "Filters". */
  filters: string;
  /** "Reset filters" */
  reset: string;
  /** Closes the phone sheet. */
  close: string;
  /** Button that closes the phone sheet after choosing, e.g. "Show results". */
  apply: string;
}

/**
 * One row above a table (docs/UXUI_REDESIGN_DESIGN.md 9.4, 10.1): search, filter controls, the
 * result count, "Reset filters" and the page's list action. Wraps on tablets; on a phone the
 * `filters` move into a "Filters" sheet so the search stays one line. The result count is a
 * live region so a screen reader hears the effect of a filter.
 */
export function ListToolbar({
  search,
  filters,
  activeFilters = 0,
  resultCount,
  onReset,
  actions,
  chips,
  labels,
  className,
}: {
  /** Usually a `SearchInput`. */
  search?: ReactNode | undefined;
  /** `Field`-wrapped selects or other controls. */
  filters?: ReactNode | undefined;
  /** How many filters are applied; drives the reset button and the phone button's count. */
  activeFilters?: number | undefined;
  /** e.g. "12 results". */
  resultCount?: string | undefined;
  onReset?: (() => void) | undefined;
  /** Secondary list actions, right aligned. The page's primary action stays in the page header. */
  actions?: ReactNode | undefined;
  /** Applied filters as removable chips (`FilterChips`), drawn under the row. */
  chips?: ReactNode | undefined;
  labels: ListToolbarLabels;
  className?: string | undefined;
}) {
  const phone = useMediaQuery(PHONE_QUERY);
  const [sheetOpen, setSheetOpen] = useState(false);
  const hasFilters = filters !== undefined && filters !== null;
  const reset =
    onReset && activeFilters > 0 ? (
      <Button variant="ghost" onClick={onReset}>
        {labels.reset}
      </Button>
    ) : null;
  return (
    <div className={cx('ls-toolbar', className)} role="search" aria-label={labels.toolbar}>
      <div className="ls-toolbar-row">
        {search ? <div className="ls-toolbar-search">{search}</div> : null}
        {hasFilters && !phone ? <div className="ls-toolbar-filters">{filters}</div> : null}
        {hasFilters && phone ? (
          <Button variant="secondary" icon="filter" onClick={() => setSheetOpen(true)}>
            {activeFilters > 0 ? `${labels.filters} (${activeFilters})` : labels.filters}
          </Button>
        ) : null}
        {!phone ? reset : null}
        {actions ? <div className="ls-toolbar-actions">{actions}</div> : null}
      </div>
      {resultCount !== undefined ? (
        <p className="ls-toolbar-count" role="status">
          {resultCount}
        </p>
      ) : null}
      {chips}
      {hasFilters && phone ? (
        <Drawer
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={labels.filters}
          closeLabel={labels.close}
          footer={
            <>
              {reset}
              <Button variant="primary" onClick={() => setSheetOpen(false)}>
                {labels.apply}
              </Button>
            </>
          }
        >
          <div className="ls-toolbar-sheet">{filters}</div>
        </Drawer>
      ) : null}
    </div>
  );
}

export interface FilterChip {
  key: string;
  /** e.g. "Branch: Lucy A" */
  label: string;
}

/** Applied filters as removable chips. `removeLabel` has a `{filter}` placeholder. */
export function FilterChips({
  chips,
  onRemove,
  removeLabel,
  className,
}: {
  chips: readonly FilterChip[];
  onRemove: (key: string) => void;
  removeLabel: string;
  className?: string | undefined;
}) {
  if (chips.length === 0) return null;
  return (
    <ul className={cx('ls-chips', className)}>
      {chips.map((chip) => (
        <li key={chip.key} className="ls-chip">
          <span className="ls-chip-text">{chip.label}</span>
          <button
            type="button"
            className="ls-chip-remove"
            aria-label={fillTemplate(removeLabel, { filter: chip.label })}
            onClick={() => onRemove(chip.key)}
          >
            <Icon name="close" size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}
