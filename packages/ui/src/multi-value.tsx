'use client';

import { useRef, useState } from 'react';
import { cx } from './cx';
import { fillTemplate } from './paging-core';
import { Popover } from './popover';

/**
 * A cell with several values (branches, skills): the first one on a single line plus a "+N" badge
 * that opens the full list. One value renders as plain text, none as an em dash. Text arrives by
 * props; `moreLabel` takes a `{count}` placeholder, e.g. "Show {count} more".
 */
export function MultiValue({
  values,
  moreLabel,
  listLabel,
  className,
}: {
  values: readonly string[];
  /** Accessible name of the "+N" button, with `{count}` (the number of values). */
  moreLabel: string;
  /** Accessible name of the list that opens, e.g. "Branches". */
  listLabel: string;
  className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const badgeRef = useRef<HTMLButtonElement | null>(null);
  const [first, ...rest] = values;
  if (first === undefined) return <span>—</span>;
  return (
    <span className={cx('ls-multi', className)}>
      <span className="ls-multi-first" title={first}>
        {first}
      </span>
      {rest.length > 0 ? (
        <>
          <button
            ref={badgeRef}
            type="button"
            className="ls-multi-more"
            aria-expanded={open}
            aria-label={fillTemplate(moreLabel, { count: values.length })}
            onClick={() => setOpen((value) => !value)}
          >
            <span className="ls-multi-pill">+{rest.length}</span>
          </button>
          <Popover
            open={open}
            onClose={() => setOpen(false)}
            anchorRef={badgeRef}
            align="start"
            className="ls-multi-panel"
          >
            <ul className="ls-multi-list" aria-label={listLabel}>
              {values.map((value, index) => (
                <li key={`${index}-${value}`}>{value}</li>
              ))}
            </ul>
          </Popover>
        </>
      ) : null}
    </span>
  );
}
