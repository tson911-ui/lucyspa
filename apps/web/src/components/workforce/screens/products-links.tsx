'use client';

import {
  buttonClass,
  ConfirmDialog,
  focusFirstInvalid,
  Icon,
  motionAllowed,
  readMotionEnvironment,
  useUnsavedChangesGuard,
  useUrlState,
  DEFAULT_PAGE_SIZE,
  type DataTablePaging,
  type ButtonVariant,
  type IconName,
  type MenuLinkComponent,
} from '@lucy-spa/ui';
import { useState, type ReactNode } from 'react';
import type { WorkforceDictionary } from '../../../i18n/workforce';
import {
  normalizePage,
  normalizePageSize,
  paginationLabels,
} from '../../../lib/workforce/list-view';
import { PrefetchLink } from '../link';

// Router links for the catalog and stock screens (session 10, Step 6). A menu item or a header action that navigates is a real link
// (Ctrl/Cmd+click, middle-click, wig "links use <a>") that moves client-side, so the staff shell is not reloaded (kit ButtonLink is a
// plain anchor).

const countFormats = new Map<string, Intl.NumberFormat>();

/**
 * A count or a stock quantity with the locale's grouping ("1.250" in vi, "1,250" in en; wig "Intl.NumberFormat, not hardcoded
 * formats"). One formatter per locale, built once (rbp js-cache-function-results).
 */
export function formatCount(locale: string, value: number): string {
  let format = countFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale);
    countFormats.set(locale, format);
  }
  return format.format(value);
}

/** The staff router link as a kit `Menu`/`RowActions` link, so an item with an `href` ("Chi tiết") navigates client-side. */
export const RouterMenuLink: MenuLinkComponent = (props) => <PrefetchLink {...props} />;

/**
 * After a refused submit (the screen's own check marked fields `aria-invalid`), focus the first invalid field once React has drawn
 * the errors (wig "focus first error on submit"). `scope` is the form; without one, the topmost open dialog, else the page.
 */
export function focusInvalidSoon(scope?: ParentNode | null): void {
  if (typeof requestAnimationFrame !== 'function') return;
  requestAnimationFrame(() => {
    const dialogs = document.querySelectorAll('[role="dialog"]');
    focusFirstInvalid(scope ?? dialogs[dialogs.length - 1] ?? document);
  });
}

/**
 * A page form's way out (wig "warn before navigation with unsaved changes"): the browser asks before the tab closes or reloads while
 * the form is dirty, and the form's Cancel asks "Bỏ thay đổi?" (the same words as the kit's dialog and drawer forms) before it leaves.
 * Returns `leave` for the Cancel button and the `dialog` to render.
 */
export function useLeaveGuard(
  dirty: boolean,
  go: () => void,
  t: WorkforceDictionary,
): { leave: () => void; dialog: ReactNode } {
  useUnsavedChangesGuard(dirty);
  const [asking, setAsking] = useState(false);
  const dialog = asking ? (
    <ConfirmDialog
      title={t.common.form.discardTitle}
      description={t.common.form.discardBody}
      tone="warning"
      confirmLabel={t.common.form.discardConfirm}
      cancelLabel={t.common.form.discardKeep}
      describeError={() => ({ message: '' })}
      onConfirm={async () => {
        setAsking(false);
        go();
      }}
      onCancel={() => setAsking(false)}
    />
  ) : null;
  return { leave: () => (dirty ? setAsking(true) : go()), dialog };
}

/**
 * Brings a section of the same page into view (product price history, campaign products): a smooth scroll only when the device
 * allows motion (reduced motion, data saver and low memory jump straight there; wig product-detail.tsx:90, campaign-detail.tsx:148).
 * The target carries `ls-adm-c-anchor` (scroll-margin-top below the sticky top bar).
 */
export function scrollToSection(id: string): void {
  document.getElementById(id)?.scrollIntoView({
    behavior: motionAllowed(readMotionEnvironment()) ? 'smooth' : 'auto',
    block: 'start',
  });
}

type PagingState = Record<string, number>;

/**
 * Page and page size of a client-side table kept in the address bar under two keys of its own, so Back/Forward and a shared link
 * restore the page (wig "URL reflects state"; replaces `useState`/`useClientPaging` pagers). Call once at module level per table:
 * `const useLotsPaging = urlPaging('lpage', 'lsize');` then `useLotsPaging(t, label)` in the component.
 */
export function urlPaging(pageKey: string, sizeKey: string) {
  const defaults: PagingState = { [pageKey]: 1, [sizeKey]: DEFAULT_PAGE_SIZE };
  const options = {
    normalize: (state: PagingState): PagingState => ({
      [pageKey]: normalizePage(state[pageKey] ?? 1),
      [sizeKey]: normalizePageSize(state[sizeKey] ?? DEFAULT_PAGE_SIZE),
    }),
    resetOnChange: [pageKey],
  };
  return function useUrlPaging(t: WorkforceDictionary, list: string): DataTablePaging {
    const [state, update] = useUrlState(defaults, options);
    return {
      page: state[pageKey] ?? 1,
      pageSize: state[sizeKey] ?? DEFAULT_PAGE_SIZE,
      onPageChange: (page) => update({ [pageKey]: page }),
      onPageSizeChange: (pageSize) => update({ [sizeKey]: pageSize }),
      labels: paginationLabels(t, list),
    };
  };
}

/** A link styled as a kit button (the header "Thêm sản phẩm", an empty state's next step). */
export function RouterButtonLink({
  href,
  variant = 'secondary',
  icon,
  children,
}: {
  href: string;
  variant?: ButtonVariant | undefined;
  icon?: IconName | undefined;
  children: ReactNode;
}) {
  return (
    <PrefetchLink href={href} className={buttonClass(variant, 'md')}>
      {icon ? <Icon name={icon} /> : null}
      <span className="ls-btn-label">{children}</span>
    </PrefetchLink>
  );
}
