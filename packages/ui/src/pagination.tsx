'use client';

import { Button } from './button';
import { cx } from './cx';
import { Icon } from './icons';
import { Select } from './form';
import {
  PAGE_SIZES,
  clampPage,
  fillTemplate,
  pageRange,
  pageSizeChoices,
  pagerState,
  totalPages,
} from './paging-core';

export interface PaginationLabels {
  /** Accessible name of the pager, e.g. "Pages of Employees". */
  nav: string;
  first: string;
  previous: string;
  next: string;
  last: string;
  /** With `{page}`, e.g. "Page {page}". */
  pageNumber: string;
  /** With `{from}`, `{to}` and `{total}`, e.g. "Showing {from}-{to} of {total}". */
  summary: string;
  /** Accessible name of the page-size select. */
  pageSize: string;
  /** With `{size}`, e.g. "{size} per page". */
  pageSizeOption: string;
}

/**
 * Numbered pages for a list. Works for `page` + `total` from a server and for a list already loaded in
 * the browser (the caller passes `total = rows.length`). The row-count line is always drawn; the
 * page buttons only when there is more than one page, and the page-size select only when the total
 * exceeds the smallest size.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizes = PAGE_SIZES,
  labels,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Omit to hide the page-size select (for example when the server fixes the size). */
  onPageSizeChange?: ((pageSize: number) => void) | undefined;
  pageSizes?: readonly number[] | undefined;
  labels: PaginationLabels;
  className?: string | undefined;
}) {
  const pages = totalPages(total, pageSize);
  const current = clampPage(page, pages);
  const { from, to } = pageRange(current, pageSize, total);
  const state = pagerState(current, pages);
  const choices = pageSizeChoices(pageSize, pageSizes);
  const showSize = onPageSizeChange !== undefined && total > Math.min(...choices);
  return (
    <div className={cx('ls-pagination', className)}>
      <p className="ls-pagination-summary">{fillTemplate(labels.summary, { from, to, total })}</p>
      {showSize ? (
        <Select
          className="ls-pagination-size"
          aria-label={labels.pageSize}
          value={String(pageSize)}
          options={choices.map((size) => ({
            value: String(size),
            label: fillTemplate(labels.pageSizeOption, { size }),
          }))}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
        />
      ) : null}
      {state.visible ? (
        <nav className="ls-pagination-nav" aria-label={labels.nav}>
          <button
            type="button"
            className="ls-page-btn"
            aria-label={labels.first}
            disabled={state.previousDisabled}
            onClick={() => onPageChange(1)}
          >
            «
          </button>
          <button
            type="button"
            className="ls-page-btn"
            aria-label={labels.previous}
            disabled={state.previousDisabled}
            onClick={() => onPageChange(current - 1)}
          >
            <Icon name="chevron-left" />
          </button>
          {state.items.map((item, index) =>
            item === 'gap' ? (
              <span key={`gap-${index}`} className="ls-page-gap" aria-hidden="true">
                …
              </span>
            ) : (
              <button
                key={item}
                type="button"
                className={cx('ls-page-btn', item === current && 'ls-page-current')}
                aria-current={item === current ? 'page' : undefined}
                aria-label={fillTemplate(labels.pageNumber, { page: item })}
                onClick={() => onPageChange(item)}
              >
                {item}
              </button>
            ),
          )}
          <button
            type="button"
            className="ls-page-btn"
            aria-label={labels.next}
            disabled={state.nextDisabled}
            onClick={() => onPageChange(current + 1)}
          >
            <Icon name="chevron-right" />
          </button>
          <button
            type="button"
            className="ls-page-btn"
            aria-label={labels.last}
            disabled={state.nextDisabled}
            onClick={() => onPageChange(pages)}
          >
            »
          </button>
        </nav>
      ) : null}
    </div>
  );
}

export interface CursorPaginationLabels {
  nav: string;
  /** "Load more" (append mode) */
  loadMore: string;
  previous: string;
  next: string;
  loading: string;
}

/**
 * Pager for keyset (cursor) APIs, which know neither the page number nor the total. Without
 * `onPrevious` it is a single "Load more" button that appends rows; with it, Previous/Next step
 * through pages of rows the caller already fetched or can fetch again.
 */
export function CursorPagination({
  hasNext,
  hasPrevious = false,
  loading = false,
  onNext,
  onPrevious,
  summary,
  labels,
  className,
}: {
  hasNext: boolean;
  hasPrevious?: boolean | undefined;
  loading?: boolean | undefined;
  onNext: () => void;
  onPrevious?: (() => void) | undefined;
  /** Optional row-count text, e.g. "20 shown". */
  summary?: string | undefined;
  labels: CursorPaginationLabels;
  className?: string | undefined;
}) {
  if (!onPrevious && !hasNext && !summary) return null;
  return (
    <div className={cx('ls-pagination', className)}>
      {summary ? <p className="ls-pagination-summary">{summary}</p> : null}
      {onPrevious || hasNext ? (
        <nav className="ls-pagination-nav" aria-label={labels.nav}>
          {onPrevious ? (
            <Button variant="secondary" disabled={!hasPrevious || loading} onClick={onPrevious}>
              {labels.previous}
            </Button>
          ) : null}
          <Button
            variant="secondary"
            loading={loading}
            disabled={!hasNext}
            onClick={onNext}
            aria-label={loading ? labels.loading : undefined}
          >
            {onPrevious ? labels.next : labels.loadMore}
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
