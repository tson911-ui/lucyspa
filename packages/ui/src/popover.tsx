'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { cx } from './cx';

/** Places a panel of `panel` size next to `anchor`: below if it fits, else above; clamped to the viewport. */
export function placePanel(
  anchor: { top: number; bottom: number; left: number; right: number },
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
  align: 'start' | 'end',
  gap = 4,
  margin = 8,
): { top: number; left: number } {
  const below = anchor.bottom + gap;
  const fitsBelow = below + panel.height <= viewport.height - margin;
  const above = anchor.top - gap - panel.height;
  const top = fitsBelow || above < margin ? below : above;
  const wanted = align === 'end' ? anchor.right - panel.width : anchor.left;
  const left = Math.max(margin, Math.min(wanted, viewport.width - panel.width - margin));
  return { top: Math.max(margin, top), left };
}

/** Extra time, past the animation's own length, before a panel whose `animationend` never fires is removed. */
const EXIT_SLACK_MS = 60;

/** A computed `animation-duration` ("0.18s", "180ms", or a list) as milliseconds: the longest entry. */
export function exitDuration(value: string): number {
  return value.split(',').reduce((longest, part) => {
    const text = part.trim();
    const number = Number.parseFloat(text);
    if (Number.isNaN(number)) return longest;
    return Math.max(longest, text.endsWith('ms') ? number : number * 1000);
  }, 0);
}

/**
 * Where a fixed panel's coordinates start: the screen's corner, unless an ancestor is transformed (then that ancestor's
 * box). A throwaway fixed probe next to the panel reports it.
 */
function containingOrigin(panel: HTMLElement): { x: number; y: number } {
  const parent = panel.parentElement;
  if (!parent) return { x: 0, y: 0 };
  const probe = document.createElement('span');
  probe.style.position = 'fixed';
  probe.style.top = '0';
  probe.style.left = '0';
  probe.style.width = '0';
  probe.style.height = '0';
  probe.style.visibility = 'hidden';
  parent.appendChild(probe);
  const box = probe.getBoundingClientRect();
  probe.remove();
  return { x: box.left, y: box.top };
}

/**
 * A floating panel anchored to an element. It closes on Escape and on a press outside, and follows
 * its anchor while the page scrolls or resizes. Focus handling stays with the owner (Menu, pickers).
 */
export function Popover({
  open,
  onClose,
  anchorRef,
  align = 'end',
  role,
  id,
  label,
  className,
  children,
  onKeyDown,
  ref,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  align?: 'start' | 'end' | undefined;
  role?: string | undefined;
  id?: string | undefined;
  /** Accessible name of the panel (for `role="dialog"`). */
  label?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
  onKeyDown?: ((event: ReactKeyboardEvent<HTMLDivElement>) => void) | undefined;
  ref?: RefObject<HTMLDivElement | null> | undefined;
}) {
  const ownRef = useRef<HTMLDivElement | null>(null);
  const panelRef = ref ?? ownRef;
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  // The panel stays in the page while its exit animation runs (site.css), then is removed. Without an animation (the
  // staff area, reduced motion, tests) it is removed at once.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useLayoutEffect(() => {
    if (open || !mounted) return undefined;
    const panel = panelRef.current;
    const computed = panel ? getComputedStyle(panel) : null;
    const ms =
      computed && computed.animationName !== 'none' ? exitDuration(computed.animationDuration) : 0;
    if (!panel || ms <= 0) {
      setMounted(false);
      return undefined;
    }
    const done = () => setMounted(false);
    panel.addEventListener('animationend', done);
    const timer = window.setTimeout(done, ms + EXIT_SLACK_MS);
    return () => {
      panel.removeEventListener('animationend', done);
      window.clearTimeout(timer);
    };
  }, [open, mounted, panelRef]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const update = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const anchorBox = anchor.getBoundingClientRect();
      const position = placePanel(
        anchorBox,
        { width: panel.offsetWidth, height: panel.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        align,
      );
      // A transformed ancestor (the shrinking site header) becomes the containing block of a fixed panel: measure where
      // its origin is and place relative to it. With no such ancestor the origin is 0, 0.
      const origin = containingOrigin(panel);
      const fromBelow = position.top >= anchorBox.bottom;
      setStyle({
        top: position.top - origin.y,
        left: position.left - origin.x,
        // The panel opens and closes from the trigger: its scale origin is the middle of the trigger's edge.
        transformOrigin: `${(anchorBox.left + anchorBox.right) / 2 - position.left}px ${
          fromBelow ? 0 : panel.offsetHeight
        }px`,
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, align, anchorRef, panelRef]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (panelRef.current?.contains(target) || anchorRef.current?.contains(target))) {
        return;
      }
      onClose();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
      anchorRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open, onClose, anchorRef, panelRef]);

  if (!open && !mounted) return null;
  return (
    <div
      ref={panelRef}
      id={id}
      role={role}
      aria-label={label}
      className={cx('ls-popover', className)}
      style={style}
      data-state={open ? 'open' : 'closed'}
      inert={open ? undefined : true}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}
