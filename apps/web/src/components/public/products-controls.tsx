'use client';

import { Button, Drawer, Pagination, SearchInput, Select } from '@lucy-spa/ui';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import {
  activeFilterCount,
  PRODUCTS_LIST_ID,
  PUBLIC_PRODUCTS_PAGE_SIZE,
  productsHref,
  withFilter,
  type ProductsState,
} from '../../lib/public-products-core';

/**
 * The search, the filter button of a phone or tablet and the sort of the cosmetics list (design 16.2). The state lives in the
 * address bar: a change goes to the new address and the page is read again on the server, so a filtered list can be shared and
 * the Back button undoes it. The filter links themselves are drawn by the server page and handed in as `children`.
 */
export function ProductsToolbar({
  locale,
  state,
  children,
}: {
  locale: Locale;
  state: ProductsState;
  /** The filter groups (links) shown in the sheet of a phone or tablet; none when the catalog has nothing to filter by. */
  children?: ReactNode;
}) {
  const text = getSiteText(locale).products;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const go = (next: ProductsState) => router.push(productsHref(locale, next), { scroll: false });
  const active = activeFilterCount(state);
  return (
    <div className="ls-prod-tools" role="search" aria-label={text.searchLabel}>
      <SearchInput
        value={state.q}
        label={text.searchLabel}
        clearLabel={text.searchClear}
        placeholder={text.searchLabel}
        onSearch={(q) => {
          if (q !== state.q) go(withFilter(state, { q }));
        }}
      />
      {children ? (
        <Button
          variant="secondary"
          icon="filter"
          className="ls-prod-filter-button"
          onClick={() => setOpen(true)}
        >
          {active > 0 ? `${text.filterButton} (${active})` : text.filterButton}
        </Button>
      ) : null}
      <Select
        className="ls-prod-sort"
        aria-label={text.sortLabel}
        value={state.sort}
        options={(['featured', 'newest', 'price_asc', 'price_desc'] as const).map((sort) => ({
          value: sort,
          label: text.sorts[sort],
        }))}
        onChange={(event) =>
          go(withFilter(state, { sort: event.target.value as ProductsState['sort'] }))
        }
      />
      {children ? (
        <Drawer
          open={open}
          onClose={() => setOpen(false)}
          title={text.filterTitle}
          side="bottom"
          closeLabel={text.filterDone}
          footer={
            <>
              {active > 0 ? (
                <Button
                  variant="ghost"
                  onClick={() => go(withFilter(state, { category: '', brand: '' }))}
                >
                  {text.filterReset}
                </Button>
              ) : null}
              <Button variant="primary" onClick={() => setOpen(false)}>
                {text.filterDone}
              </Button>
            </>
          }
        >
          <div className="ls-prod-sheet">{children}</div>
        </Drawer>
      ) : null}
    </div>
  );
}

/** Numbered pages of the list, 20 to a page; a page is a new address (and a new server read). */
export function ProductsPager({
  locale,
  state,
  total,
}: {
  locale: Locale;
  state: ProductsState;
  total: number;
}) {
  const text = getSiteText(locale).products.pager;
  const router = useRouter();
  return (
    <Pagination
      className="ls-prod-pager"
      page={state.page}
      pageSize={PUBLIC_PRODUCTS_PAGE_SIZE}
      total={total}
      onPageChange={(page) => {
        // The pager is at the bottom of the list: bring the top of the next page into view (works for the phone shell's scroller too).
        document.getElementById(PRODUCTS_LIST_ID)?.scrollIntoView({ block: 'start' });
        router.push(productsHref(locale, { ...state, page }), { scroll: false });
      }}
      labels={{
        nav: text.nav,
        first: text.first,
        previous: text.previous,
        next: text.next,
        last: text.last,
        pageNumber: text.pageNumber,
        summary: text.summary,
        pageSize: text.nav,
        pageSizeOption: '{size}',
      }}
    />
  );
}
