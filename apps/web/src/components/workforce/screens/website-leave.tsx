'use client';

import { ConfirmDialog, useUnsavedChangesGuard } from '@lucy-spa/ui';
import { useEffect, useState, type ReactNode } from 'react';
import type { WorkforceDictionary } from '../../../i18n/workforce';

/**
 * The way out of a website page form (info page, popup, season) while it has unsaved edits (wig "warn before navigation with unsaved
 * changes"): the browser asks before the tab closes or reloads, and every in-app way out asks "Bỏ thay đổi?" first: the form's Cancel
 * (`leave`) and any same-site link clicked meanwhile (breadcrumb, back chevron, sidebar, a link in the form). A link that opens a new
 * tab, a download, a modified click (Ctrl/Cmd/Shift/middle) and a link inside a dialog are left alone. Saving clears `dirty` first,
 * so a save never asks.
 */
/** The website screen's tab switch: cancelable, so a form with unsaved edits can ask first (see useWebsiteLeaveGuard). */
export const WEBSITE_TAB_EVENT = 'ls:website-tab';
export type WebsiteTabEvent = CustomEvent<{ go: () => void }>;

/** Asks the open website form whether the tab may change; true when nothing holds it (the caller then switches). */
export function requestWebsiteTab(go: () => void): boolean {
  return window.dispatchEvent(
    new CustomEvent(WEBSITE_TAB_EVENT, { cancelable: true, detail: { go } }),
  );
}

export function useWebsiteLeaveGuard(
  dirty: boolean,
  navigate: ((path: string) => void) | undefined,
  t: WorkforceDictionary,
): { leave: (path: string) => void; dialog: ReactNode } {
  useUnsavedChangesGuard(dirty);
  const [target, setTarget] = useState<string | null>(null);
  // A website tab switch held while the form is dirty (the tabs are buttons, not links).
  const [heldTab, setHeldTab] = useState<(() => void) | null>(null);

  useEffect(() => {
    if (!dirty) return undefined;
    const onTab = (event: Event) => {
      event.preventDefault();
      const { go } = (event as WebsiteTabEvent).detail;
      setHeldTab(() => go);
    };
    window.addEventListener(WEBSITE_TAB_EVENT, onTab);
    return () => window.removeEventListener(WEBSITE_TAB_EVENT, onTab);
  }, [dirty]);

  useEffect(() => {
    if (!dirty || !navigate) return undefined;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      if (anchor.closest('[role="dialog"]')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search)
        return;
      // Captured before the router link's own handler, which then sees the prevented default and does not navigate.
      event.preventDefault();
      setTarget(`${url.pathname}${url.search}${url.hash}`);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [dirty, navigate]);

  const dialog =
    target !== null || heldTab !== null ? (
      <ConfirmDialog
        title={t.common.form.discardTitle}
        description={t.common.form.discardBody}
        tone="warning"
        confirmLabel={t.common.form.discardConfirm}
        cancelLabel={t.common.form.discardKeep}
        describeError={() => ({ message: '' })}
        onConfirm={async () => {
          const tab = heldTab;
          setTarget(null);
          setHeldTab(null);
          if (tab) tab();
          else if (target !== null) navigate?.(target);
        }}
        onCancel={() => {
          setTarget(null);
          setHeldTab(null);
        }}
      />
    ) : null;

  return { leave: (path) => (dirty ? setTarget(path) : navigate?.(path)), dialog };
}
