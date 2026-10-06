'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { motionAllowed, readMotionEnvironment } from './reveal-core';

// The sliding highlight shared by the public menus and the staff sidebar (pattern M8). The current entry's highlight is
// one element that slides to the next entry when the route changes, instead of blinking off one link and on another.

/** The browser has no layout effect on the server; the pill is only placed in the browser. */
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

type PillMode = 'none' | 'still' | 'slide';

/** The slide needs no observer, only a device that allows motion (not reduced motion, data saver or low memory). */
function mayMove(): boolean {
  if (typeof window.matchMedia !== 'function') return true;
  return motionAllowed({ ...readMotionEnvironment(), hasObserver: true });
}

export interface SlidingPillOptions {
  /**
   * True when the current link is laid out but must not carry the pill (a collapsed sidebar group clips it, the pill
   * would float over the next group). The pill hides until the link shows again.
   */
  hidden?: ((current: HTMLElement, menu: HTMLElement) => boolean) | undefined;
  /** Extra elements whose size changes move the current link (the sidebar's groups open and close). */
  watch?: string | undefined;
  /**
   * The pill also glides to the entry the mouse is over or the keyboard has focused, and back to the current entry when
   * they leave (the public menus). Touch never moves it, and a mouse click's focus does not either.
   */
  follow?: boolean | undefined;
}

/** Keyboard focus (not the focus a mouse click leaves behind); a browser that cannot tell counts as not. */
function focusVisible(element: Element): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return false;
  }
}

/**
 * Places the pill under the current link. `data-pill` on the menu is `none` (no current entry, or the menu is hidden),
 * `still` (placed without a transition: first paint, a resize, a font arriving) or `slide` (the route changed, the
 * pill moves with a transition). The geometry goes in custom properties on the menu, so React never re-renders.
 * A device with reduced motion, data saver or low memory never slides: the pill is placed `still`.
 */
export function useSlidingPill(signature: string, options: SlidingPillOptions = {}) {
  const nav = useRef<HTMLElement | null>(null);
  const placed = useRef(false);
  /** The box the pill was last given, so a resize that changes nothing never cancels a slide in progress. */
  const lastBox = useRef('');
  const settings = useRef(options);
  settings.current = options;

  /** The entry the mouse is over / the keyboard is on (`follow` menus); the pill goes there instead of the current one. */
  const hovered = useRef<HTMLElement | null>(null);
  const focused = useRef<HTMLElement | null>(null);

  const place = (animate: boolean) => {
    const element = nav.current;
    if (!element) return;
    const route = element.querySelector<HTMLElement>('a[aria-current]');
    if (!route || route.offsetWidth === 0 || settings.current.hidden?.(route, element) === true) {
      placed.current = false;
      lastBox.current = '';
      element.dataset['pill'] = 'none' satisfies PillMode;
      element
        .querySelectorAll('[data-under]')
        .forEach((link) => link.removeAttribute('data-under'));
      return;
    }
    // The entry the pill sits under: what the pointer or the keys are on, else the current page's entry.
    const wanted = hovered.current ?? focused.current;
    const current = wanted?.isConnected && element.contains(wanted) ? wanted : route;
    element.querySelectorAll('a').forEach((link) => {
      if (link === current) link.setAttribute('data-under', '');
      else link.removeAttribute('data-under');
    });
    const box = [current.offsetLeft, current.offsetTop, current.offsetWidth, current.offsetHeight];
    if (!animate && placed.current && box.join() === lastBox.current) return;
    lastBox.current = box.join();
    element.style.setProperty('--ls-pill-x', `${box[0]}px`);
    element.style.setProperty('--ls-pill-y', `${box[1]}px`);
    element.style.setProperty('--ls-pill-w', `${box[2]}px`);
    element.style.setProperty('--ls-pill-h', `${box[3]}px`);
    const slide = animate && placed.current && mayMove();
    element.dataset['pill'] = (slide ? 'slide' : 'still') satisfies PillMode;
    placed.current = true;
  };

  // A route change (the current entry or the entries themselves changed): slide.
  useBrowserLayoutEffect(() => {
    place(true);
    // `place` only reads refs; the signature is what says the menu changed.
  }, [signature]);

  // A menu that was hidden (a phone), grew (member entries arriving) or changed width (web font): jump, never slide.
  useEffect(() => {
    const element = nav.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    // An observer reports once when it starts watching; that is not a change, and must not cancel a slide in progress.
    let started = false;
    const observer = new ResizeObserver(() => {
      if (!started) {
        started = true;
        return;
      }
      place(false);
    });
    observer.observe(element);
    element.querySelectorAll('a').forEach((link) => observer.observe(link));
    const watch = settings.current.watch;
    if (watch) element.querySelectorAll(watch).forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [signature]);

  // The public menus: the pill follows the mouse and the keyboard focus, and goes back to the current entry on leaving.
  const follow = options.follow === true;
  useEffect(() => {
    const element = nav.current;
    if (!follow || !element) return;
    const linkOf = (target: EventTarget | null): HTMLElement | null => {
      const link = target instanceof Element ? target.closest('a') : null;
      return link && element.contains(link) ? link : null;
    };
    const onOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const link = linkOf(event.target);
      if (!link || link === hovered.current) return;
      hovered.current = link;
      place(true);
    };
    const onLeave = () => {
      if (!hovered.current) return;
      hovered.current = null;
      place(true);
    };
    const onFocusIn = (event: FocusEvent) => {
      const link = linkOf(event.target);
      if (!link || !focusVisible(link)) return;
      focused.current = link;
      place(true);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (linkOf(event.relatedTarget)) return;
      if (!focused.current) return;
      focused.current = null;
      place(true);
    };
    element.addEventListener('pointerover', onOver);
    element.addEventListener('pointerleave', onLeave);
    element.addEventListener('focusin', onFocusIn);
    element.addEventListener('focusout', onFocusOut);
    return () => {
      element.removeEventListener('pointerover', onOver);
      element.removeEventListener('pointerleave', onLeave);
      element.removeEventListener('focusin', onFocusIn);
      element.removeEventListener('focusout', onFocusOut);
      hovered.current = null;
      focused.current = null;
    };
    // `place` only reads refs.
  }, [follow]);

  return nav;
}
