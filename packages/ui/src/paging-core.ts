// Pure paging, sorting and tabbing logic for the data components (docs/UXUI_REDESIGN_DESIGN.md
// 9.4 and 10.2). Free of DOM and React so it is unit tested in Node; the components only call it.

export const PAGE_SIZES = [10, 20, 50] as const;
export const DEFAULT_PAGE_SIZE = 20;

/** Fills `{name}` placeholders. Unknown placeholders are left as written. */
export function fillTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

/** Number of pages for `total` rows; always at least 1 so an empty list still has "page 1". */
export function totalPages(total: number, pageSize: number): number {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  return Math.max(1, Math.ceil(Math.max(0, total) / size));
}

/** A page number forced into 1..pages; anything that is not a number becomes 1. */
export function clampPage(page: number, pages: number): number {
  const whole = Math.floor(page);
  if (!Number.isFinite(whole)) return 1;
  return Math.min(Math.max(1, whole), Math.max(1, pages));
}

/** "Showing 21-40 of 133": 1-based inclusive bounds; 0-0 when there are no rows. */
export function pageRange(
  page: number,
  pageSize: number,
  total: number,
): { from: number; to: number } {
  if (total <= 0) return { from: 0, to: 0 };
  const current = clampPage(page, totalPages(total, pageSize));
  const from = (current - 1) * pageSize + 1;
  return { from, to: Math.min(total, current * pageSize) };
}

/** The rows of one page of an already loaded list (client paging). */
export function sliceRows<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const current = clampPage(page, totalPages(rows.length, pageSize));
  return rows.slice((current - 1) * pageSize, current * pageSize);
}

export type PageItem = number | 'gap';

/**
 * Page links: always the first and last page, the current page with one neighbour on each side, and
 * a gap for skipped ranges. A gap that would hide a single page shows that page instead.
 * E.g. page 5 of 8 gives 1 … 4 5 6 7 8.
 */
export function pageItems(current: number, pages: number): PageItem[] {
  if (pages <= 1) return [];
  const wanted = new Set([1, pages, current - 1, current, current + 1]);
  const numbers = [...wanted].filter((page) => page >= 1 && page <= pages).sort((a, b) => a - b);
  const items: PageItem[] = [];
  let previous = 0;
  for (const page of numbers) {
    if (page - previous === 2) items.push(page - 1);
    else if (page - previous > 2) items.push('gap');
    items.push(page);
    previous = page;
  }
  return items;
}

/** What the pager shows: hidden for one page; previous/first and next/last disabled at the ends. */
export function pagerState(page: number, pages: number) {
  return {
    visible: pages > 1,
    previousDisabled: page <= 1,
    nextDisabled: page >= pages,
    items: pageItems(page, pages),
  };
}

/** Page sizes offered for a list: the choices, plus the current size when it is not one of them. */
export function pageSizeChoices(
  current: number,
  choices: readonly number[] = PAGE_SIZES,
): number[] {
  return choices.includes(current) ? [...choices] : [...choices, current].sort((a, b) => a - b);
}

/**
 * Page to show after the page size changes: the page that contains the first row currently shown,
 * so the user does not lose their place.
 */
export function pageAfterSizeChange(page: number, oldSize: number, newSize: number): number {
  const firstRow = (Math.max(1, page) - 1) * oldSize;
  return Math.floor(firstRow / Math.max(1, newSize)) + 1;
}

// ---------------------------------------------------------------------------------------------
// Sorting

export type SortDirection = 'asc' | 'desc';
export interface SortState {
  key: string;
  direction: SortDirection;
}
export type SortValue = string | number | null | undefined;

/** Header click: a new column starts ascending; the same column flips direction. */
export function nextSort(current: SortState | null, key: string): SortState {
  if (current?.key === key) return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  return { key, direction: 'asc' };
}

export function ariaSort(
  sort: SortState | null | undefined,
  key: string,
): 'ascending' | 'descending' | 'none' {
  if (sort?.key !== key) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });

/** Empty values sort last in both directions; numbers compare numerically, text by Vietnamese collation. */
export function compareValues(a: SortValue, b: SortValue): number {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

/** A sorted copy; the sort is stable so equal rows keep their loaded order. */
export function sortRows<T>(
  rows: readonly T[],
  sort: SortState | null | undefined,
  getValue: (row: T, key: string) => SortValue,
): T[] {
  if (!sort) return [...rows];
  const direction = sort.direction === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: getValue(row, sort.key) }))
    .sort((left, right) => {
      const aEmpty = left.value === null || left.value === undefined || left.value === '';
      const bEmpty = right.value === null || right.value === undefined || right.value === '';
      // Empty values stay last whatever the direction.
      if (aEmpty || bEmpty) {
        if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
        return left.index - right.index;
      }
      return direction * compareValues(left.value, right.value) || left.index - right.index;
    })
    .map((entry) => entry.row);
}

// ---------------------------------------------------------------------------------------------
// Tabs

export type TabKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

/** Index of the tab a key moves to (wrapping, skipping disabled tabs); -1 when none is enabled. */
export function nextTabIndex(
  tabs: readonly { disabled?: boolean | undefined }[],
  current: number,
  key: TabKey,
): number {
  const count = tabs.length;
  const enabled = (index: number) => !tabs[index]?.disabled;
  if (count === 0) return -1;
  if (key === 'Home') return tabs.findIndex((_, index) => enabled(index));
  if (key === 'End') {
    for (let index = count - 1; index >= 0; index -= 1) if (enabled(index)) return index;
    return -1;
  }
  const step = key === 'ArrowRight' ? 1 : -1;
  let index = current;
  for (let tries = 0; tries < count; tries += 1) {
    index = (index + step + count) % count;
    if (enabled(index)) return index;
  }
  return -1;
}
