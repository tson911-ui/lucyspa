'use client';

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { BrandIcon } from './brand-icons';
import { Icon } from './icons';

/** The ways to reach the spa the floating button offers; the page decides which exist (an empty link is left out). */
export interface ContactFabItem {
  key: 'zalo' | 'messenger' | 'call';
  href: string;
  /** The accessible name and the visible label ("Nhắn Zalo"). */
  label: string;
}

const PULSED_KEY = 'lucy-contact-pulsed';

/**
 * The floating contact button of the public site (Owner request 2026-10-06): one round button that opens Zalo,
 * Messenger and phone. It sits in the page flow just before the footer as a sticky row with its own slot (the button's
 * height plus a safe space above and below), so it stays at the bottom-right while the page scrolls and, at the end of
 * the page, rests between the content and the footer instead of covering either. Its bottom edge is lifted above
 * the phone tab bar (css) and above a sticky action bar (the booking flow), measured here because that bar's height
 * depends on its content. It opens on a click, closes on Escape or a press outside, and gives one short attention pulse
 * on the first page of a visit (never looping; no movement under reduced motion, css). A link that opens another site
 * opens in a new tab; `tel:` does not.
 */
export function ContactFab({
  items,
  openLabel,
  closeLabel,
  groupLabel,
}: {
  items: readonly ContactFabItem[];
  openLabel: string;
  closeLabel: string;
  groupLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const toggle = useRef<HTMLButtonElement | null>(null);
  const listId = useId();

  // Close on Escape (focus returns to the button) and on a press outside.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      toggle.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  // One attention pulse on the first page of a visit.
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(PULSED_KEY) === '1') return;
      window.sessionStorage.setItem(PULSED_KEY, '1');
    } catch {
      // Storage may be blocked: the pulse then plays on every full page load, which is still once per load.
    }
    setPulse(true);
  }, []);

  // Stay above a sticky action bar (the booking flow's summary and buttons): its height is not known to the stylesheet.
  useEffect(() => {
    const element = root.current;
    if (!element) return undefined;
    const scope = element.closest('.ls-site') ?? document.body;
    let frame = 0;
    let watched: Element | null = null;
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => sync());
    function sync() {
      const bar = scope.querySelector('.ls-action-bar');
      if (bar !== watched) {
        if (watched) resize?.unobserve(watched);
        if (bar) resize?.observe(bar);
        watched = bar;
      }
      const shown = bar !== null && getComputedStyle(bar).display !== 'none';
      element?.style.setProperty(
        '--ls-fab-lift',
        shown && bar ? `${Math.ceil(bar.getBoundingClientRect().height)}px` : '0px',
      );
    }
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };
    const mutations =
      typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule);
    mutations?.observe(scope, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      mutations?.disconnect();
      resize?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, []);

  if (items.length === 0) return null;
  return (
    <div ref={root} className="ls-contact" data-open={open ? 'true' : 'false'}>
      <div className="ls-contact-stack">
        <div id={listId} className="ls-contact-items" role="group" aria-label={groupLabel}>
          {items.map((item, position) => (
            <a
              key={item.key}
              className="ls-contact-link"
              data-kind={item.key}
              href={item.href}
              style={{ '--ls-fab-index': items.length - 1 - position } as CSSProperties}
              {...(item.key === 'call' ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
            >
              <span className="ls-contact-label">{item.label}</span>
              <span className="ls-contact-icon" aria-hidden="true">
                {item.key === 'call' ? (
                  <Icon name="phone" size={24} />
                ) : (
                  <BrandIcon name={item.key} size={item.key === 'zalo' ? 32 : 24} />
                )}
              </span>
            </a>
          ))}
        </div>
        <button
          ref={toggle}
          type="button"
          className="ls-contact-toggle"
          data-pulse={pulse ? 'true' : undefined}
          aria-expanded={open}
          aria-controls={listId}
          aria-label={open ? closeLabel : openLabel}
          onClick={() => setOpen((value) => !value)}
          onAnimationEnd={() => setPulse(false)}
        >
          <Icon name={open ? 'close' : 'message-circle'} size={24} />
        </button>
      </div>
    </div>
  );
}
