'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { IconButton } from './button';
import { cx } from './cx';
import { Icon, type IconName } from './icons';
import { nextEnabledIndex, orderActions, typeaheadIndex } from './menu-core';
import { Popover } from './popover';

export interface MenuItem {
  type?: 'item' | undefined;
  id: string;
  label: string;
  icon?: IconName | undefined;
  /** Runs when chosen. Either `onSelect` or `href`. */
  onSelect?: (() => void) | undefined;
  href?: string | undefined;
  /** `danger` items are grouped last, after a divider, in danger text (contract 10.4). */
  tone?: 'default' | 'danger' | undefined;
  disabled?: boolean | undefined;
  /** Why the item is unavailable; shown as text inside the item. */
  disabledReason?: string | undefined;
}
export interface MenuDivider {
  type: 'divider';
  id: string;
}
export type MenuEntry = MenuItem | MenuDivider;

/** Safe items first, then a divider, then destructive items (fixed order, contract 10.4). */
export function arrangeMenu(items: readonly MenuItem[]): MenuEntry[] {
  const { safe, danger } = orderActions(items);
  if (safe.length === 0 || danger.length === 0) return [...safe, ...danger];
  return [...safe, { type: 'divider', id: '__divider' }, ...danger];
}

export function Menu({
  label,
  items,
  align = 'end',
  icon = 'more-horizontal',
  className,
}: {
  /** Accessible name of the trigger button, e.g. "More actions". */
  label: string;
  items: readonly MenuEntry[];
  align?: 'start' | 'end' | undefined;
  icon?: IconName | undefined;
  className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const typed = useRef({ text: '', timer: 0 });
  const menuId = useId();
  const entries = items.filter((item): item is MenuItem => item.type !== 'divider');

  const close = useCallback(() => setOpen(false), []);
  const rows = () =>
    Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  const focusRow = (index: number) => rows()[index]?.focus();

  useEffect(() => {
    if (!open) return;
    // Wait for the panel to be placed, then focus the first enabled item.
    const first = nextEnabledIndex(entries, -1, 'Home');
    const handle = requestAnimationFrame(() => focusRow(first));
    return () => cancelAnimationFrame(handle);
  }, [open]);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const elements = rows();
    const current = elements.indexOf(document.activeElement as HTMLElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = nextEnabledIndex(
        entries,
        current,
        event.key as 'ArrowDown' | 'ArrowUp' | 'Home' | 'End',
      );
      if (next >= 0) focusRow(next);
      return;
    }
    if (event.key === 'Tab') {
      close();
      triggerRef.current?.focus();
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      window.clearTimeout(typed.current.timer);
      typed.current.text += event.key;
      typed.current.timer = window.setTimeout(() => (typed.current.text = ''), 500);
      const match = typeaheadIndex(
        entries.map((item) => item.label),
        entries.map((item) => Boolean(item.disabled)),
        current,
        typed.current.text,
      );
      if (match >= 0) focusRow(match);
    }
  }

  function choose(item: MenuItem) {
    if (item.disabled) return;
    close();
    triggerRef.current?.focus();
    item.onSelect?.();
  }

  return (
    <span className={cx('ls-menu', className)}>
      <IconButton
        ref={triggerRef}
        icon={icon}
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      />
      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        align={align}
        id={menuId}
        role="menu"
        className="ls-menu-panel"
        ref={panelRef}
        onKeyDown={onKeyDown}
      >
        {items.map((entry) => {
          if (entry.type === 'divider') {
            return <div key={entry.id} role="separator" className="ls-menu-divider" />;
          }
          const itemClass = cx(
            'ls-menu-item',
            entry.tone === 'danger' && 'ls-menu-item-danger',
            entry.disabled && 'ls-menu-item-disabled',
          );
          const content = (
            <>
              {entry.icon ? <Icon name={entry.icon} /> : <span className="ls-menu-icon-gap" />}
              <span className="ls-menu-item-text">
                {entry.label}
                {entry.disabled && entry.disabledReason ? (
                  <span className="ls-menu-item-reason">{entry.disabledReason}</span>
                ) : null}
              </span>
            </>
          );
          if (entry.href && !entry.disabled) {
            return (
              <a
                key={entry.id}
                role="menuitem"
                tabIndex={-1}
                href={entry.href}
                className={itemClass}
                onClick={close}
              >
                {content}
              </a>
            );
          }
          return (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={itemClass}
              aria-disabled={entry.disabled || undefined}
              onClick={() => choose(entry)}
            >
              {content}
            </button>
          );
        })}
      </Popover>
    </span>
  );
}
