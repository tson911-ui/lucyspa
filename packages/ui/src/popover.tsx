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

  useLayoutEffect(() => {
    if (!open) return undefined;
    const update = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const position = placePanel(
        anchor.getBoundingClientRect(),
        { width: panel.offsetWidth, height: panel.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        align,
      );
      setStyle({ top: position.top, left: position.left });
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

  if (!open) return null;
  return (
    <div
      ref={panelRef}
      id={id}
      role={role}
      aria-label={label}
      className={cx('ls-popover', className)}
      style={style}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}
