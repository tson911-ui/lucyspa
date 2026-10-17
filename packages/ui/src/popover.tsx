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
import { PHONE_QUERY } from './use-media-query';

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
    const panel = panelRef.current;
    // Every read first (anchor box, panel size, the containing block's origin), then the writes: one layout per call
    // (rbp js-batch-dom-css).
    const measure = (): CSSProperties | null => {
      const anchor = anchorRef.current;
      if (!anchor || !panel) return null;
      // HIG C62: no popover at phone width; the panel becomes a bottom sheet (full width, at the bottom edge). The class is
      // written first so the size read below is the sheet's.
      const sheet =
        typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches;
      panel.classList.toggle('ls-popover-sheet', sheet);
      const anchorBox = anchor.getBoundingClientRect();
      const size = { width: panel.offsetWidth, height: panel.offsetHeight };
      // A transformed ancestor (the shrinking site header) becomes the containing block of a fixed panel: measure where
      // its origin is and place relative to it. With no such ancestor the origin is 0, 0.
      const origin = containingOrigin(panel);
      if (sheet) {
        return {
          top: window.innerHeight - size.height - origin.y,
          left: -origin.x,
          transformOrigin: '50% 100%',
        };
      }
      const position = placePanel(
        anchorBox,
        size,
        { width: window.innerWidth, height: window.innerHeight },
        align,
      );
      const fromBelow = position.top >= anchorBox.bottom;
      return {
        top: position.top - origin.y,
        left: position.left - origin.x,
        // The panel opens and closes from the trigger: its scale origin is the middle of the trigger's edge.
        transformOrigin: `${(anchorBox.left + anchorBox.right) / 2 - position.left}px ${
          fromBelow ? 0 : size.height
        }px`,
      };
    };
    // The first placement goes through React (before paint); while the page scrolls or resizes the panel follows its anchor
    // once per frame, written straight to the panel, so neither the panel nor its children re-render per scroll event
    // (rbp rerender-use-ref-transient-values).
    const first = measure();
    if (first) setStyle(first);
    let frame = 0;
    const follow = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const next = measure();
        if (!next || !panel) return;
        panel.style.top = `${String(next.top)}px`;
        panel.style.left = `${String(next.left)}px`;
        panel.style.transformOrigin = String(next.transformOrigin);
      });
    };
    window.addEventListener('resize', follow, { passive: true });
    window.addEventListener('scroll', follow, { capture: true, passive: true });
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
    };
  }, [open, align, anchorRef, panelRef]);

  // The latest onClose, read by the document listeners: callers pass inline closures, and the listeners stay attached once per
  // opening instead of being removed and added again on every render (rbp advanced-event-handler-refs).
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (panelRef.current?.contains(target) || anchorRef.current?.contains(target))) {
        return;
      }
      closeRef.current();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      closeRef.current();
      anchorRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open, anchorRef, panelRef]);

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
