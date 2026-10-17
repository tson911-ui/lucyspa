'use client';

import { useEffect, useRef } from 'react';

/** True for a plain click on a link to another page of this site (not a new tab, a download or an anchor on the same page). */
function leavesPage(event: MouseEvent): HTMLAnchorElement | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const link = (event.target as Element | null)?.closest?.('a[href]');
  if (!(link instanceof HTMLAnchorElement)) return null;
  if (link.target && link.target !== '_self') return null;
  if (link.hasAttribute('download')) return null;
  const to = new URL(link.href, window.location.href);
  if (to.origin !== window.location.origin) return null;
  if (to.pathname === window.location.pathname && to.search === window.location.search) return null;
  return link;
}

/**
 * Warns before leaving a form that holds unsent entries (wig Forms: unsaved changes). Only while `dirty` is true: the browser's own
 * question on reload or close, and a plain question before following a link inside the site (header, footer, tab bar). Never after
 * the form is sent (the caller passes `dirty = false` then). `options.confirm` decides in a test.
 */
export function useUnsavedGuard(
  dirty: boolean,
  message: string,
  options: {
    /** Runs when the visitor chose to leave through a link (e.g. forget a kept draft). */
    onLeave?: (() => void) | undefined;
    confirm?: ((text: string) => boolean) | undefined;
    /** Read at the moment of leaving: false when the page itself is navigating away on purpose (e.g. to the payment page). */
    stillDirty?: (() => boolean) | undefined;
  } = {},
): void {
  const ask = useRef({ message, ...options });
  ask.current = { message, ...options };

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (ask.current.stillDirty && !ask.current.stillDirty()) return;
      event.preventDefault();
      // Older browsers need a value to show their question; the text itself is the browser's.
      event.returnValue = '';
    };
    // Capture on the document runs before the router's own click handler on the app root.
    const click = (event: MouseEvent) => {
      if (!leavesPage(event)) return;
      if (ask.current.stillDirty && !ask.current.stillDirty()) return;
      const confirm = ask.current.confirm ?? ((text: string) => window.confirm(text));
      if (confirm(ask.current.message)) {
        ask.current.onLeave?.();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', click, true);
    };
  }, [dirty]);
}

/** For a control that navigates by code (the sign-in / register switch): asks first while the form holds entries. */
export function confirmLeave(dirty: boolean, message: string): boolean {
  return !dirty || window.confirm(message);
}
