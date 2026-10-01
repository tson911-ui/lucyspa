'use client';

import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { IconButton } from './button';
import { cx } from './cx';
import { trapTarget } from './menu-core';
import { PromoCard, type PromoContent, type PromoLink } from './promo';

// Modal surfaces (docs/UXUI_REDESIGN_DESIGN.md 9.5): focus is trapped, Escape and a press on the
// backdrop close unless the surface is busy, and focus returns to what opened it.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let scrollLocks = 0;

function lockScroll(): () => void {
  scrollLocks += 1;
  const previous = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  return () => {
    scrollLocks -= 1;
    if (scrollLocks === 0) document.body.style.overflow = previous;
  };
}

function focusables(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.getAttribute('aria-hidden') !== 'true' && element.offsetParent !== null,
  );
}

/** Shared modal behaviour: initial focus, focus restore, scroll lock, Tab trap and Escape. */
function useModal({
  open,
  busy,
  onClose,
  initialFocus,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  initialFocus?: RefObject<HTMLElement | null> | undefined;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unlock = lockScroll();
    const panel = panelRef.current;
    const target = initialFocus?.current ?? (panel ? focusables(panel)[0] : null) ?? panel;
    target?.focus();
    return () => {
      unlock();
      if (opener && opener.isConnected) opener.focus();
    };
    // Focus is placed once per opening; later prop changes must not steal it.
  }, [open]);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!busy) onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const elements = focusables(panel);
    if (elements.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const index = elements.indexOf(document.activeElement as HTMLElement);
    const next = trapTarget(index, elements.length, event.shiftKey);
    if (next !== null) {
      event.preventDefault();
      elements[next]?.focus();
    }
  }

  function onBackdropMouseDown(event: { target: EventTarget; currentTarget: EventTarget }) {
    if (event.target === event.currentTarget && !busy) onClose();
  }

  return { panelRef, onKeyDown, onBackdropMouseDown };
}

export type DialogSize = 'sm' | 'md' | 'lg';

/**
 * Modal dialog. Bottom sheet on a phone for `sm` and `md`. Mount it only while it is needed or
 * drive it with `open`; nothing renders when closed.
 */
export function Dialog({
  open = true,
  onClose,
  title,
  description,
  size = 'md',
  role = 'dialog',
  busy = false,
  closeLabel,
  initialFocus,
  footer,
  children,
  className,
}: {
  open?: boolean | undefined;
  onClose: () => void;
  title: string;
  description?: string | undefined;
  size?: DialogSize | undefined;
  /** `alertdialog` for confirmations that interrupt the user. */
  role?: 'dialog' | 'alertdialog' | undefined;
  /** While busy, Escape, the backdrop and the close button do nothing. */
  busy?: boolean | undefined;
  /** Accessible name of the close button. Omit to draw no close button (confirmations). */
  closeLabel?: string | undefined;
  /** Element to focus first; defaults to the first focusable element. */
  initialFocus?: RefObject<HTMLElement | null> | undefined;
  footer?: ReactNode | undefined;
  children?: ReactNode | undefined;
  className?: string | undefined;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const { panelRef, onKeyDown, onBackdropMouseDown } = useModal({
    open,
    busy,
    onClose,
    initialFocus,
  });
  if (!open) return null;
  return (
    <div className="ls-backdrop" onMouseDown={onBackdropMouseDown}>
      <div
        ref={panelRef}
        className={cx('ls-dialog', `ls-dialog-${size}`, className)}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={busy || undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="ls-dialog-header">
          <h2 className="ls-dialog-title" id={titleId}>
            {title}
          </h2>
          {closeLabel ? (
            <IconButton icon="close" label={closeLabel} onClick={onClose} disabled={busy} />
          ) : null}
        </header>
        {description ? (
          <p className="ls-dialog-description" id={descriptionId}>
            {description}
          </p>
        ) : null}
        {children ? <div className="ls-dialog-body">{children}</div> : null}
        {footer ? <footer className="ls-dialog-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}

/**
 * The public promotional popup as a modal (design 16.5): `role=dialog`, focus trapped, Escape and a press
 * on the backdrop close it, the close button is a full-size target, and focus returns to the page. It shows
 * what it is given; whether and when it appears is the caller's rule.
 */
export function PromoDialog({
  content,
  label,
  closeLabel,
  onClose,
  LinkComponent,
}: {
  content: PromoContent;
  /** The dialog's name when the popup has no title. */
  label: string;
  closeLabel: string;
  onClose: () => void;
  LinkComponent?: PromoLink | undefined;
}) {
  const titleId = useId();
  const { panelRef, onKeyDown, onBackdropMouseDown } = useModal({
    open: true,
    busy: false,
    onClose,
  });
  return (
    <div className="ls-backdrop" onMouseDown={onBackdropMouseDown}>
      <div
        ref={panelRef}
        className="ls-promo-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={content.title ? titleId : undefined}
        aria-label={content.title ? undefined : label}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <PromoCard
          content={content}
          titleId={titleId}
          closeLabel={closeLabel}
          onClose={onClose}
          onNavigate={onClose}
          LinkComponent={LinkComponent}
        />
      </div>
    </div>
  );
}

/** Side sheet for mobile navigation, the filter sheet and quick edits. */
export function Drawer({
  open,
  onClose,
  title,
  side = 'end',
  closeLabel,
  busy = false,
  initialFocus,
  footer,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** `bottom` is a sheet that rises from the bottom edge (phone filters); `start`/`end` are full-height. */
  side?: 'start' | 'end' | 'bottom' | undefined;
  closeLabel: string;
  /** While busy, Escape, the backdrop and the close button do nothing. */
  busy?: boolean | undefined;
  /** Element to focus first; defaults to the first focusable element. */
  initialFocus?: RefObject<HTMLElement | null> | undefined;
  footer?: ReactNode | undefined;
  children?: ReactNode | undefined;
  className?: string | undefined;
}) {
  const titleId = useId();
  const { panelRef, onKeyDown, onBackdropMouseDown } = useModal({
    open,
    busy,
    onClose,
    initialFocus,
  });
  if (!open) return null;
  return (
    <div className="ls-backdrop ls-backdrop-drawer" onMouseDown={onBackdropMouseDown}>
      <div
        ref={panelRef}
        className={cx('ls-drawer', `ls-drawer-${side}`, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="ls-dialog-header">
          <h2 className="ls-dialog-title" id={titleId}>
            {title}
          </h2>
          <IconButton icon="close" label={closeLabel} onClick={onClose} disabled={busy} />
        </header>
        <div className="ls-drawer-body">{children}</div>
        {footer ? <footer className="ls-dialog-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
