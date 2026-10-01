'use client';

import { useState, type ReactNode } from 'react';
import { Button, IconButton } from './button';
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
 * One row above a table (docs/UXUI_REDESIGN_DESIGN.md 9.4, 10.1; frontend rule 6): search, filter
 * controls, "Reset" while a filter applies, and at the trailing end the result count, the reload
 * icon button and secondary list actions. Every control is one height and none has a label above
 * (a filter names itself: placeholder, `FacetedFilter` button or `aria-label`). Wraps on tablets;
 * on a phone the `filters` move into a "Filters" sheet so the search stays one line and the count
 * drops under the row. The result count is a live region so a screen reader hears a filter's effect.
 */
export function ListToolbar({
  search,
  filters,
  activeFilters = 0,
  resultCount,
  onReset,
  reload,
  actions,
  chips,
  labels,
  className,
}: {
  /** Usually a `SearchInput`. */
  search?: ReactNode | undefined;
  /** Bare controls: `FacetedFilter`s or `Select`s with a placeholder. No `Field` labels. */
  filters?: ReactNode | undefined;
  /** How many filters are applied; drives the reset button and the phone button's count. */
  activeFilters?: number | undefined;
  /** e.g. "12 results". */
  resultCount?: string | undefined;
  onReset?: (() => void) | undefined;
  /** Reload as an icon button at the trailing end (never a stray page button). */
  reload?: { label: string; onClick: () => void; busy?: boolean | undefined } | undefined;
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
          <Button
            variant="secondary"
            icon="filter"
            className="ls-filter-button"
            aria-label={activeFilters > 0 ? `${labels.filters} (${activeFilters})` : labels.filters}
            onClick={() => setSheetOpen(true)}
          >
            {/* On the narrowest phones the word is hidden (CSS) so the search keeps its room; the count stays. */}
            <span className="ls-filter-text">{labels.filters}</span>
            {activeFilters > 0 ? <span className="ls-filter-count">{activeFilters}</span> : null}
          </Button>
        ) : null}
        {!phone ? reset : null}
        {reload || actions || (resultCount !== undefined && !phone) ? (
          <div className="ls-toolbar-end">
            {resultCount !== undefined && !phone ? (
              <p className="ls-toolbar-count" role="status">
                {resultCount}
              </p>
            ) : null}
            {reload ? (
              <IconButton
                icon="refresh"
                label={reload.label}
                disabled={reload.busy}
                aria-busy={reload.busy || undefined}
                onClick={reload.onClick}
              />
            ) : null}
            {actions}
          </div>
        ) : null}
      </div>
      {resultCount !== undefined && phone ? (
        <p className="ls-toolbar-count" role="status">
          {resultCount}
        </p>
      ) : null}
      {chips}
      {hasFilters && phone ? (
        <Drawer
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          side="bottom"
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
