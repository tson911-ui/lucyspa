'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
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
  hideBelow?: 'md' | 'lg' | undefined;
  /** The card title on a phone: shown first, larger, without its label. */
  mobileTitle?: boolean | undefined;
  /** The trailing "Actions" column: heading visually hidden but present, cells right aligned. */
  actions?: boolean | undefined;
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

/**
 * Data table (docs/UXUI_REDESIGN_DESIGN.md 9.4, 10.2, 10.4).
 *
 * - `mode="client"`: `rows` is the whole loaded list; the table sorts and pages it in the browser.
 * - `mode="server"`: `rows` is the current page; the caller pages and (optionally) sorts by
 *   `sort` / `onSortChange` and passes `paging.total`.
 *
 * Loading shows skeleton rows in the final layout, `error` and `empty` replace the table, and below
 * 640 px the same markup becomes a stacked card list (CSS), keeping the row actions.
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
  paging?: DataTablePaging | undefined;
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
  const total = client ? rows.length : (paging?.total ?? rows.length);
  const visible = client && paging ? sliceRows(ordered, paging.page, paging.pageSize) : ordered;

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
        <table className={cx('ls-table', loading && !showSkeleton && 'ls-table-refreshing')}>
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
                  ) : column.actions ? (
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
                            column.actions || column.mobileTitle ? undefined : column.header
                          }
                        >
                          {column.actions || column.mobileTitle ? (
                            column.cell(row)
                          ) : (
                            <span className="ls-cell-value">{valueOrDash(column.cell(row))}</span>
                          )}
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
      {paging && total > 0 ? (
        <Pagination
          page={clampPage(paging.page, totalPages(total, paging.pageSize))}
          pageSize={paging.pageSize}
          total={total}
          onPageChange={paging.onPageChange}
          onPageSizeChange={paging.onPageSizeChange}
          labels={paging.labels}
        />
      ) : null}
    </div>
  );
}

/** An empty value reads as an em dash, never as a blank cell (UX gate, section 21.1). */
function valueOrDash(content: ReactNode): ReactNode {
  return content === null || content === undefined || content === false || content === ''
    ? '—'
    : content;
}

function cellClass<Row>(column: DataTableColumn<Row>): string {
  return cx(
    column.align === 'end' && 'ls-cell-end',
    column.align === 'center' && 'ls-cell-center',
    column.actions && 'ls-cell-actions',
    column.mobileTitle && 'ls-cell-title',
    column.hideBelow === 'md' && 'ls-hide-md',
    column.hideBelow === 'lg' && 'ls-hide-lg',
  );
}
