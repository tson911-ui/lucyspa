'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';
import { nextTabIndex, type TabKey } from './paging-core';

export interface TabItem {
  id: string;
  label: string;
  /** Content of the panel; only the selected tab's panel is rendered. */
  panel: ReactNode;
  disabled?: boolean | undefined;
}

const KEYS: readonly string[] = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];

/**
 * Tabs with roving focus (WAI-ARIA tabs pattern, automatic activation): Left/Right move and select,
 * Home/End jump, disabled tabs are skipped, and Tab leaves the list into the panel. Controlled with
 * `value` + `onChange` (for example from the URL) or uncontrolled with `defaultValue`.
 */
export function Tabs({
  tabs,
  value,
  defaultValue,
  onChange,
  label,
  className,
}: {
  tabs: readonly TabItem[];
  value?: string | undefined;
  defaultValue?: string | undefined;
  onChange?: ((id: string) => void) | undefined;
  /** Accessible name of the tab list. */
  label: string;
  className?: string | undefined;
}) {
  const base = useId();
  const [own, setOwn] = useState(defaultValue ?? tabs.find((tab) => !tab.disabled)?.id);
  const requested = value ?? own;
  // An unknown or disabled selection falls back to the first enabled tab.
  const selectedTab =
    tabs.find((tab) => tab.id === requested && !tab.disabled) ?? tabs.find((tab) => !tab.disabled);
  const selected = selectedTab?.id;
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  function select(id: string) {
    if (value === undefined) setOwn(id);
    onChange?.(id);
  }

  function onKeyDown(event: KeyboardEvent, index: number) {
    if (!KEYS.includes(event.key)) return;
    const target = nextTabIndex(tabs, index, event.key as TabKey);
    if (target < 0) return;
    event.preventDefault();
    buttons.current[target]?.focus();
    const tab = tabs[target];
    if (tab) select(tab.id);
  }

  return (
    <div className={cx('ls-tabs', className)}>
      <div className="ls-tablist" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => {
          const active = tab.id === selected;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.id}`}
              className={cx('ls-tab', active && 'ls-tab-active')}
              aria-selected={active}
              aria-controls={active ? `${base}-panel` : undefined}
              disabled={tab.disabled}
              tabIndex={active ? 0 : -1}
              onClick={() => select(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {selectedTab ? (
        <div
          role="tabpanel"
          id={`${base}-panel`}
          className="ls-tabpanel"
          aria-labelledby={`${base}-tab-${selectedTab.id}`}
          tabIndex={0}
        >
          {selectedTab.panel}
        </div>
      ) : null}
    </div>
  );
}
