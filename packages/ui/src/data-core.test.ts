import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ariaSort,
  clampPage,
  compareValues,
  fillTemplate,
  nextSort,
  nextTabIndex,
  pageAfterSizeChange,
  pageItems,
  pageRange,
  pageSizeChoices,
  pagerState,
  sliceRows,
  sortRows,
  totalPages,
} from './paging-core';
import { applyUrlPatch, parseUrlState, serializeUrlState } from './url-state-core';

test('paging math: pages, clamping, ranges and slices', () => {
  assert.equal(totalPages(0, 20), 1, 'an empty list still has page 1');
  assert.equal(totalPages(20, 20), 1);
  assert.equal(totalPages(21, 20), 2);
  assert.equal(totalPages(133, 20), 7);
  assert.equal(totalPages(5, 0), 5, 'a zero size cannot divide by zero');
  assert.equal(clampPage(0, 7), 1);
  assert.equal(clampPage(9, 7), 7);
  assert.equal(clampPage(2.9, 7), 2);
  assert.equal(clampPage(Number.NaN, 7), 1);
  // "Showing 21-40 of 133"
  assert.deepEqual(pageRange(2, 20, 133), { from: 21, to: 40 });
  assert.deepEqual(pageRange(7, 20, 133), { from: 121, to: 133 }, 'the last page is short');
  assert.deepEqual(pageRange(1, 20, 0), { from: 0, to: 0 });
  assert.deepEqual(pageRange(99, 20, 133), { from: 121, to: 133 }, 'a stale page is clamped');
  const rows = Array.from({ length: 45 }, (_, index) => index + 1);
  assert.deepEqual(sliceRows(rows, 1, 20), rows.slice(0, 20));
  assert.deepEqual(sliceRows(rows, 3, 20), [41, 42, 43, 44, 45]);
  assert.deepEqual(
    sliceRows(rows, 9, 20),
    [41, 42, 43, 44, 45],
    'beyond the end shows the last page',
  );
  assert.deepEqual(sliceRows([], 1, 20), []);
});

test('page links: first, last, neighbours and gaps; pager boundaries', () => {
  assert.deepEqual(pageItems(1, 1), []);
  assert.deepEqual(pageItems(1, 8), [1, 2, 'gap', 8]);
  assert.deepEqual(pageItems(5, 8), [1, 'gap', 4, 5, 6, 7, 8]);
  assert.deepEqual(pageItems(3, 8), [1, 2, 3, 4, 'gap', 8]);
  assert.deepEqual(pageItems(2, 3), [1, 2, 3]);
  assert.deepEqual(pageItems(50, 100), [1, 'gap', 49, 50, 51, 'gap', 100]);
  const first = pagerState(1, 8);
  assert.deepEqual(
    [first.visible, first.previousDisabled, first.nextDisabled],
    [true, true, false],
  );
  const last = pagerState(8, 8);
  assert.deepEqual([last.previousDisabled, last.nextDisabled], [false, true]);
  assert.equal(pagerState(1, 1).visible, false);
});

test('page size: offered choices and keeping the user place', () => {
  assert.deepEqual(pageSizeChoices(20), [10, 20, 50]);
  assert.deepEqual(
    pageSizeChoices(25),
    [10, 20, 25, 50],
    'an unusual current size is still listed',
  );
  // Row 21 was the first shown at page 2 of 20; with 50 per page it is on page 1.
  assert.equal(pageAfterSizeChange(2, 20, 50), 1);
  assert.equal(pageAfterSizeChange(3, 20, 10), 5, 'rows 41-60 start at page 5 of 10');
  assert.equal(pageAfterSizeChange(1, 20, 10), 1);
});

test('templates fill known placeholders and leave unknown ones visible', () => {
  assert.equal(
    fillTemplate('Hiển thị {from}-{to} trong {total}', { from: 1, to: 20, total: 133 }),
    'Hiển thị 1-20 trong 133',
  );
  assert.equal(fillTemplate('{a} {b}', { a: 'x' }), 'x {b}');
});

test('sorting: numeric, Vietnamese collation, empty values last, stable', () => {
  assert.ok(compareValues(2, 10) < 0, 'numbers compare as numbers');
  assert.ok(compareValues('a2', 'a10') < 0, 'natural order inside text');
  assert.ok(compareValues('Anh', 'Ánh') === 0, 'accents do not decide the order');
  assert.ok(compareValues(null, 'a') > 0 && compareValues('a', undefined) < 0);
  type Row = { id: number; name: string | null };
  const data: Row[] = [
    { id: 1, name: 'Lan' },
    { id: 2, name: null },
    { id: 3, name: 'An' },
    { id: 4, name: 'Lan' },
  ];
  const value = (row: Row) => row.name;
  assert.deepEqual(
    sortRows(data, { key: 'name', direction: 'asc' }, value).map((row) => row.id),
    [3, 1, 4, 2],
    'ascending: equal names keep their order, empty last',
  );
  assert.deepEqual(
    sortRows(data, { key: 'name', direction: 'desc' }, value).map((row) => row.id),
    [1, 4, 3, 2],
    'descending keeps empty values last too',
  );
  assert.deepEqual(sortRows(data, null, value), data, 'no sort keeps the loaded order');
  assert.notEqual(sortRows(data, null, value), data, 'the input array is never mutated');
  assert.deepEqual(nextSort(null, 'name'), { key: 'name', direction: 'asc' });
  assert.deepEqual(nextSort({ key: 'name', direction: 'asc' }, 'name'), {
    key: 'name',
    direction: 'desc',
  });
  assert.deepEqual(nextSort({ key: 'name', direction: 'desc' }, 'code'), {
    key: 'code',
    direction: 'asc',
  });
  assert.equal(ariaSort({ key: 'a', direction: 'desc' }, 'a'), 'descending');
  assert.equal(ariaSort({ key: 'a', direction: 'asc' }, 'b'), 'none');
  assert.equal(ariaSort(null, 'a'), 'none');
});

test('tabs: arrows wrap, Home/End jump, disabled tabs are skipped', () => {
  const tabs = [{}, { disabled: true }, {}, {}];
  assert.equal(nextTabIndex(tabs, 0, 'ArrowRight'), 2, 'skips the disabled tab');
  assert.equal(nextTabIndex(tabs, 3, 'ArrowRight'), 0, 'wraps to the start');
  assert.equal(nextTabIndex(tabs, 0, 'ArrowLeft'), 3, 'wraps to the end');
  assert.equal(nextTabIndex(tabs, 2, 'Home'), 0);
  assert.equal(nextTabIndex(tabs, 0, 'End'), 3);
  assert.equal(nextTabIndex([{ disabled: true }], 0, 'ArrowRight'), -1);
  assert.equal(nextTabIndex([], 0, 'Home'), -1);
});

const DEFAULTS = { q: '', status: '', pageSize: 20, page: 1, other: 1 };

test('URL state: defaults stay out of the URL, bad values fall back, foreign params survive', () => {
  assert.deepEqual(parseUrlState('', DEFAULTS), DEFAULTS);
  assert.deepEqual(parseUrlState('?q=hoa&page=3&pageSize=50', DEFAULTS), {
    ...DEFAULTS,
    q: 'hoa',
    page: 3,
    pageSize: 50,
  });
  assert.equal(parseUrlState('?page=abc', DEFAULTS).page, 1, 'not a number');
  assert.equal(parseUrlState('?page=1.5', DEFAULTS).page, 1, 'not a whole number');
  assert.equal(parseUrlState('?page=99999999999', DEFAULTS).page, 1, 'absurdly large');
  assert.equal(parseUrlState('?tab=x', DEFAULTS).q, '', 'unknown params are ignored');
  assert.equal(
    parseUrlState('?page=0', DEFAULTS, (state) => ({ ...state, page: Math.max(1, state.page) }))
      .page,
    1,
    'normalize runs',
  );
  assert.equal(serializeUrlState(DEFAULTS, DEFAULTS), '', 'a fresh list has a clean URL');
  assert.equal(
    serializeUrlState({ ...DEFAULTS, q: 'hoa lan', page: 2 }, DEFAULTS),
    '?q=hoa+lan&page=2',
  );
  assert.equal(
    serializeUrlState({ ...DEFAULTS, page: 2 }, DEFAULTS, '?tab=roles&page=5'),
    '?tab=roles&page=2',
    'foreign params kept, owned param replaced',
  );
  assert.equal(
    serializeUrlState(DEFAULTS, DEFAULTS, '?tab=roles&page=5'),
    '?tab=roles',
    'a default removes the param',
  );
  // Round trip with characters that need encoding.
  const state = { ...DEFAULTS, q: 'Nguyễn & Trần=1' };
  assert.equal(parseUrlState(serializeUrlState(state, DEFAULTS), DEFAULTS).q, state.q);
});

test('URL state: changing a filter or the page size returns to page 1', () => {
  const state = { ...DEFAULTS, page: 4 };
  const reset = ['page'];
  assert.equal(applyUrlPatch(state, { page: 5 }, DEFAULTS, reset).page, 5, 'paging keeps the page');
  assert.equal(
    applyUrlPatch(state, { status: 'active' }, DEFAULTS, reset).page,
    1,
    'a filter resets',
  );
  assert.equal(applyUrlPatch(state, { pageSize: 50 }, DEFAULTS, reset).page, 1, 'page size resets');
  assert.equal(
    applyUrlPatch(state, { q: '' }, DEFAULTS, reset).page,
    4,
    'an unchanged value is not a change',
  );
  assert.equal(
    applyUrlPatch(state, { status: 'active', page: 2 }, DEFAULTS, reset).page,
    2,
    'an explicit page wins',
  );
  assert.equal(
    applyUrlPatch(state, { status: 'active' }, DEFAULTS).page,
    4,
    'no reset keys, no reset',
  );
});
