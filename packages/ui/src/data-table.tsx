'use client';

import { isValidElement, useId, useMemo, useState, type ReactNode } from 'react';
import { cx } from './cx';
import { Select } from './form';
import { Icon } from './icons';
import { Skeleton } from './feedback';
import { Pagination, type PaginationLabels } from './pagination';
import {
  ariaSort,
  clampPage,
  fillTemplate,
  nextSort,
  sliceRows,
  sortRows,
  totalPages,
  type SortState,
  type SortValue,
} from './paging-core';

export interface DataTableColumn<Row> {
  key: string;
  /** Column heading; also the label of the value in the phone card list. */
  header: string;
  cell: (row: Row) => ReactNode;
  align?: 'start' | 'center' | 'end' | undefined;
  sortable?: boolean | undefined;
  /** What `mode="client"` sorts by; without it the column cannot be sorted in the browser. */
  sortValue?: ((row: Row) => SortValue) | undefined;
  /** Hidden on tablets narrower than this (contract section 13); a phone card list shows every field. */
  hideBelow?: 'md' | 'lg' | 'xl' | '2xl' | undefined;
  /** Left out of the phone card list (a field that adds little next to the title); every other width shows it. */
  hidePhone?: boolean | undefined;
  /** In a `phoneRows="compact"` list: the field that stays in the normal text color (the others are muted), e.g. the customer. */
  phoneEmphasis?: boolean | undefined;
  /** The card title on a phone: shown first, larger, without its label. */
  mobileTitle?: boolean | undefined;
  /** The trailing "Actions" column: heading visually hidden but present, cells right aligned. */
  actions?: boolean | undefined;
  /**
   * A small leading picture (`MediaThumb`): the first column, heading visually hidden but present, no label in the phone card,
   * where the picture sits at the top start beside the title.
   */
  leading?: boolean | undefined;
  /**
   * Widest the column's content may grow (`xs` 96, `sm` 144, `md` 224, `lg` 320 px). Only `truncate`
   * and `wrap` cells are held to it; a column without either stays on one line at its natural width.
   */
  width?: 'xs' | 'sm' | 'md' | 'lg' | undefined;
  /** One line, cut with an ellipsis at `width` (default `md`); the full text is the `title`. */
  truncate?: boolean | undefined;
  /** Up to two lines at `width` (default `md`), then cut; the full text is the `title`. */
  wrap?: boolean | undefined;
  /** Right aligned, one line, tabular digits (money, counts, durations). */
  numeric?: boolean | undefined;
}

export interface DataTableSortLabels {
  /** Accessible name and visible label of the select, e.g. "Sort by". */
  label: string;
  /** e.g. "{column} (A to Z)" */
  ascending: string;
  /** e.g. "{column} (Z to A)" */
  descending: string;
}

export interface DataTablePaging {
  page: number;
  pageSize: number;
  /** Server mode only: the total rows behind the loaded page. Client mode counts the rows. */
  total?: number | undefined;
  onPageChange: (page: number) => void;
  onPageSizeChange?: ((pageSize: number) => void) | undefined;
  labels: PaginationLabels;
}

/** A list that is never paged says why (for example a fixed short list, or `CursorPagination` below). */
export interface DataTablePagingOff {
  off: string;
}

/** More rows than this on one page without paging is a mistake (frontend rule 8). */
export const MAX_UNPAGED_ROWS = 20;

/**
 * Data table (docs/UXUI_REDESIGN_DESIGN.md 9.4, 10.2, 10.4; plan 7.5c).
 *
 * - `mode="client"`: `rows` is the whole loaded list; the table sorts and pages it in the browser.
 * - `mode="server"`: `rows` is the current page; the caller pages and (optionally) sorts by
 *   `sort` / `onSortChange` and passes `paging.total`.
 * - `paging` is required: pass the pager, or `{ off: 'reason' }`. In development more than 20 rows
 *   with paging off logs an error.
 *
 * Every row has one height; a cell is one line unless its column opts into `wrap` (two lines) and
 * long text uses `truncate`; numbers use `numeric`. Loading shows skeleton rows in the final layout,
 * `error` and `empty` replace the table inside the same single-border surface, and below 640 px the
 * same markup becomes a stacked card list (CSS), keeping the row actions.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  mode = 'client',
  sort,
  defaultSort = null,
  onSortChange,
  paging,
  loading = false,
  loadingLabel,
  skeletonRows = 5,
  error,
  empty,
  selectedKey,
  sortLabels,
  phoneRows = 'cards',
  className,
}: {
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Accessible name of the table (not drawn). */
  caption: string;
  mode?: 'client' | 'server' | undefined;
  /** Controlled sort; omit for an uncontrolled table that starts at `defaultSort`. */
  sort?: SortState | null | undefined;
  defaultSort?: SortState | null | undefined;
  onSortChange?: ((sort: SortState) => void) | undefined;
  paging: DataTablePaging | DataTablePagingOff;
  loading?: boolean | undefined;
  /** Announced while loading, e.g. "Loading…". */
  loadingLabel?: string | undefined;
  skeletonRows?: number | undefined;
  /** Blocking error content (usually an `ErrorState`); replaces the table. */
  error?: ReactNode | undefined;
  /** Empty-state content, shown when there are no rows and nothing is loading. */
  empty?: ReactNode | undefined;
  selectedKey?: string | undefined;
  /**
   * Text of the phone "Sort by" select (the card list hides the header row, so this is how a phone
   * user sorts). `ascending` / `descending` take a `{column}` placeholder. Without it there is none.
   */
  sortLabels?: DataTableSortLabels | undefined;
  /**
   * What a row becomes on a phone: `cards` (default, every field with its label) or `compact` (one list surface; the title, the
   * numeric column and the row menu on the first line, the other fields without labels on the second). For a list a cashier
   * scans quickly, whose fields explain themselves (a name, a status, an amount).
   */
  phoneRows?: 'cards' | 'compact' | undefined;
  className?: string | undefined;
}) {
  const [ownSort, setOwnSort] = useState<SortState | null>(defaultSort);
  const activeSort = sort === undefined ? ownSort : sort;

  const sortId = useId();

  function applySort(next: SortState) {
    if (sort === undefined) setOwnSort(next);
    onSortChange?.(next);
  }

  function changeSort(key: string) {
    applySort(nextSort(activeSort, key));
  }

  const sortByKey = useMemo(() => {
    const values = new Map(columns.map((column) => [column.key, column.sortValue]));
    return (row: Row, key: string): SortValue => values.get(key)?.(row);
  }, [columns]);

  const client = mode === 'client';
  const ordered = useMemo(
    () => (client ? sortRows(rows, activeSort, sortByKey) : [...rows]),
    [client, rows, activeSort, sortByKey],
  );
  const pager = 'off' in paging ? undefined : paging;
  const total = client ? rows.length : (pager?.total ?? rows.length);
  const visible = client && pager ? sliceRows(ordered, pager.page, pager.pageSize) : ordered;

  if (process.env.NODE_ENV !== 'production' && 'off' in paging) {
    if (paging.off.trim() === '') console.error('DataTable: paging off needs a written reason.');
    if (visible.length > MAX_UNPAGED_ROWS) {
      console.error(
        `DataTable: ${visible.length} rows without paging (limit ${MAX_UNPAGED_ROWS}); use paging.`,
      );
    }
  }

  const showSkeleton = loading && rows.length === 0;
  const isEmpty = !loading && !error && rows.length === 0;

  if (error) return <div className={cx('ls-table-state', className)}>{error}</div>;
  if (isEmpty) return <div className={cx('ls-table-state', className)}>{empty}</div>;

  return (
    <div className={cx('ls-table-block', className)}>
      {sortLabels && columns.some((column) => column.sortable) ? (
        <div className="ls-sortby">
          <label className="ls-label" htmlFor={sortId}>
            {sortLabels.label}
          </label>
          <Select
            id={sortId}
            value={activeSort ? `${activeSort.key}:${activeSort.direction}` : ''}
            placeholder={activeSort ? undefined : sortLabels.label}
            options={columns
              .filter((column) => column.sortable)
              .flatMap((column) => [
                {
                  value: `${column.key}:asc`,
                  label: fillTemplate(sortLabels.ascending, { column: column.header }),
                },
                {
                  value: `${column.key}:desc`,
                  label: fillTemplate(sortLabels.descending, { column: column.header }),
                },
              ])}
            onChange={(event) => {
              const [key, direction] = event.target.value.split(':');
              if (key && (direction === 'asc' || direction === 'desc'))
                applySort({ key, direction });
            }}
          />
        </div>
      ) : null}
      <div className="ls-table-wrap" aria-busy={loading || undefined}>
        <table
          className={cx(
            'ls-table',
            phoneRows === 'compact' && 'ls-table-compact',
            loading && !showSkeleton && 'ls-table-refreshing',
          )}
        >
          <caption className="ls-visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cellClass(column)}
                  aria-sort={column.sortable ? ariaSort(activeSort, column.key) : undefined}
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      className="ls-th-sort"
                      onClick={() => changeSort(column.key)}
                    >
                      <span>{column.header}</span>
                      <Icon
                        name={
                          activeSort?.key === column.key && activeSort.direction === 'desc'
                            ? 'arrow-down'
                            : 'arrow-up'
                        }
                        size={16}
                        className={cx(
                          'ls-th-arrow',
                          activeSort?.key === column.key && 'ls-th-arrow-active',
                        )}
                      />
                    </button>
                  ) : column.actions || column.leading ? (
                    <span className="ls-visually-hidden">{column.header}</span>
                  ) : (
                    column.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {showSkeleton
              ? Array.from({ length: skeletonRows }, (_, index) => (
                  <tr key={`skeleton-${index}`} className="ls-tr-skeleton" aria-hidden="true">
                    {columns.map((column) => (
                      <td key={column.key} className={cellClass(column)}>
                        <Skeleton width={column.actions ? '4rem' : '70%'} />
                      </td>
                    ))}
                  </tr>
                ))
              : visible.map((row) => {
                  const key = rowKey(row);
                  return (
                    <tr
                      key={key}
                      className={cx(key === selectedKey && 'ls-tr-selected')}
                      aria-current={key === selectedKey ? 'true' : undefined}
                    >
                      {columns.map((column) => (
                        <td
                          key={column.key}
                          className={cellClass(column)}
                          data-label={
                            column.actions || column.leading || column.mobileTitle
                              ? undefined
                              : column.header
                          }
                          // The phone card shows the title on one line; the full name stays in the tooltip.
                          title={column.mobileTitle ? nodeText(column.cell(row)) : undefined}
                        >
                          {renderCell(column, row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
      {showSkeleton && loadingLabel ? (
        <p className="ls-visually-hidden" role="status">
          {loadingLabel}
        </p>
      ) : null}
      {pager && total > 0 ? (
        <Pagination
          page={clampPage(pager.page, totalPages(total, pager.pageSize))}
          pageSize={pager.pageSize}
          total={total}
          onPageChange={pager.onPageChange}
          onPageSizeChange={pager.onPageSizeChange}
          labels={pager.labels}
        />
      ) : null}
    </div>
  );
}

function renderCell<Row>(column: DataTableColumn<Row>, row: Row): ReactNode {
  const clipped = column.truncate || column.wrap;
  const content = column.cell(row);
  if (column.actions || column.leading) return content;
  const clip = cx(column.truncate ? 'ls-cell-truncate' : column.wrap && 'ls-cell-wrap');
  if (column.mobileTitle) {
    return clipped ? (
      <span className={clip} title={plainText(content)}>
        {content}
      </span>
    ) : (
      content
    );
  }
  const value = valueOrDash(content);
  return (
    <span className={cx('ls-cell-value', clip)} title={clipped ? plainText(value) : undefined}>
      {value}
    </span>
  );
}

/** The text a node renders (strings and numbers through elements and fragments), for a tooltip. */
function nodeText(node: ReactNode): string | undefined {
  const parts: string[] = [];
  const walk = (child: ReactNode): void => {
    if (typeof child === 'string' || typeof child === 'number') parts.push(String(child));
    else if (Array.isArray(child)) child.forEach(walk);
    else if (isValidElement<{ children?: ReactNode }>(child)) walk(child.props.children);
  };
  walk(node);
  const text = parts.join('').trim();
  return text === '' ? undefined : text;
}

/** The `title` of a clipped cell: only plain text can be repeated as a tooltip. */
function plainText(content: ReactNode): string | undefined {
  return typeof content === 'string' || typeof content === 'number' ? String(content) : undefined;
}

/** An empty value reads as an em dash, never as a blank cell (UX gate, section 21.1). */
function valueOrDash(content: ReactNode): ReactNode {
  return content === null || content === undefined || content === false || content === ''
    ? '—'
    : content;
}

function cellClass<Row>(column: DataTableColumn<Row>): string {
  const width = column.width ?? (column.truncate || column.wrap ? 'md' : undefined);
  return cx(
    width && `ls-col-${width}`,
    column.numeric && 'ls-cell-numeric',
    (column.align === 'end' || column.numeric) && 'ls-cell-end',
    column.align === 'center' && 'ls-cell-center',
    column.actions && 'ls-cell-actions',
    column.leading && 'ls-cell-leading',
    column.mobileTitle && 'ls-cell-title',
    column.hideBelow === 'md' && 'ls-hide-md',
    column.hideBelow === 'lg' && 'ls-hide-lg',
    column.hideBelow === 'xl' && 'ls-hide-xl',
    column.hideBelow === '2xl' && 'ls-hide-2xl',
    column.hidePhone && 'ls-hide-phone',
    column.phoneEmphasis && 'ls-phone-emphasis',
  );
}
