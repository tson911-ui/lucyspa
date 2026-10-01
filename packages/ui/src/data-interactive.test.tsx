import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { installDom } from './dom-harness';
import type { DataTableColumn } from './index';

// Interactive behaviour in a real DOM (jsdom): keyboard, clicks, address-bar state and the phone
// filter sheet. The DOM must exist before React DOM loads, hence the dynamic imports.
const dom = installDom();
const { window } = dom;
after(() => window.close());
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const ui = await import('./index');

function mount(node: React.ReactNode) {
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const click = (element: Element) =>
  act(() => {
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
const press = (element: Element, key: string) =>
  act(() => {
    element.dispatchEvent(
      new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  });
const $ = (container: ParentNode, selector: string) => container.querySelector(selector);
const $$ = (container: ParentNode, selector: string) => [...container.querySelectorAll(selector)];

test('Tabs: arrows move focus and select, Home/End jump, disabled tabs are skipped', () => {
  const seen: string[] = [];
  const view = mount(
    <ui.Tabs
      label="Chi tiết"
      onChange={(id) => seen.push(id)}
      tabs={[
        { id: 'a', label: 'A', panel: <p id="pa">Panel A</p> },
        { id: 'b', label: 'B', panel: <p id="pb">Panel B</p>, disabled: true },
        { id: 'c', label: 'C', panel: <p id="pc">Panel C</p> },
        { id: 'd', label: 'D', panel: <p id="pd">Panel D</p> },
      ]}
    />,
  );
  const tabs = $$(view.container, '[role="tab"]') as HTMLElement[];
  assert.ok($(view.container, '#pa'), 'first enabled tab is selected');
  tabs[0]!.focus();
  press(tabs[0]!, 'ArrowRight');
  assert.equal(window.document.activeElement, tabs[2], 'B is disabled, so focus goes to C');
  assert.ok(
    $(view.container, '#pc') && !$(view.container, '#pa'),
    'and C is selected (automatic activation)',
  );
  assert.equal(tabs[2]!.getAttribute('tabindex'), '0');
  assert.equal(tabs[0]!.getAttribute('tabindex'), '-1', 'roving tabindex');
  press(tabs[2]!, 'End');
  assert.equal(window.document.activeElement, tabs[3]);
  press(tabs[3]!, 'ArrowRight');
  assert.equal(window.document.activeElement, tabs[0], 'wraps to the first tab');
  press(tabs[0]!, 'ArrowLeft');
  assert.equal(window.document.activeElement, tabs[3], 'and back to the last');
  press(tabs[3]!, 'Home');
  assert.equal(window.document.activeElement, tabs[0]);
  click(tabs[2]!);
  assert.deepEqual(seen, ['c', 'd', 'a', 'd', 'a', 'c']);
  view.unmount();
});

test('Tabs: controlled value follows the parent', () => {
  let value = 'a';
  const render = () => (
    <ui.Tabs
      label="x"
      value={value}
      onChange={(id) => (value = id)}
      tabs={[
        { id: 'a', label: 'A', panel: <p id="pa">A</p> },
        { id: 'b', label: 'B', panel: <p id="pb">B</p> },
      ]}
    />
  );
  const view = mount(render());
  click($$(view.container, '[role="tab"]')[1]!);
  assert.equal(value, 'b', 'the parent is told');
  assert.ok($(view.container, '#pa'), 'the view stays until the parent passes the new value');
  view.unmount();
});

test('Pagination: buttons change the page; page size change is reported', () => {
  const pages: number[] = [];
  const sizes: number[] = [];
  const labels = {
    nav: 'Trang',
    first: 'Đầu',
    previous: 'Trước',
    next: 'Sau',
    last: 'Cuối',
    pageNumber: 'Trang {page}',
    summary: '{from}-{to}/{total}',
    pageSize: 'Dòng',
    pageSizeOption: '{size}',
  };
  const view = mount(
    <ui.Pagination
      page={3}
      pageSize={20}
      total={133}
      onPageChange={(p) => pages.push(p)}
      onPageSizeChange={(s) => sizes.push(s)}
      labels={labels}
    />,
  );
  const byLabel = (label: string) => $(view.container, `[aria-label="${label}"]`) as HTMLElement;
  click(byLabel('Trước'));
  click(byLabel('Sau'));
  click(byLabel('Đầu'));
  click(byLabel('Cuối'));
  click(byLabel('Trang 4'));
  assert.deepEqual(pages, [2, 4, 1, 7, 4]);
  const select = $(view.container, 'select') as HTMLSelectElement;
  act(() => {
    select.value = '50';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  assert.deepEqual(sizes, [50]);
  view.unmount();
});

interface Row {
  id: string;
  name: string;
}
const rows: Row[] = [
  { id: '3', name: 'Cẩm' },
  { id: '1', name: 'An' },
  { id: '2', name: 'Bình' },
];
const cols: DataTableColumn<Row>[] = [
  {
    key: 'name',
    header: 'Tên',
    sortable: true,
    sortValue: (row) => row.name,
    cell: (row) => row.name,
  },
];
const cellTexts = (container: Element) => $$(container, 'tbody td').map((cell) => cell.textContent);

test('DataTable: header click sorts in the browser and toggles the direction', () => {
  const view = mount(
    <ui.DataTable
      paging={{ off: 'test' }}
      columns={cols}
      rows={rows}
      rowKey={(row) => row.id}
      caption="t"
    />,
  );
  assert.deepEqual(
    cellTexts(view.container),
    ['Cẩm', 'An', 'Bình'],
    'loaded order until a sort is chosen',
  );
  const header = () => $(view.container, 'th') as HTMLElement;
  click($(view.container, '.ls-th-sort')!);
  assert.deepEqual(cellTexts(view.container), ['An', 'Bình', 'Cẩm']);
  assert.equal(header().getAttribute('aria-sort'), 'ascending');
  click($(view.container, '.ls-th-sort')!);
  assert.deepEqual(cellTexts(view.container), ['Cẩm', 'Bình', 'An']);
  assert.equal(header().getAttribute('aria-sort'), 'descending');
  view.unmount();
});

test('DataTable: server mode reports the sort and does not reorder rows itself', () => {
  const requested: string[] = [];
  const view = mount(
    <ui.DataTable
      paging={{ off: 'test' }}
      mode="server"
      columns={cols}
      rows={rows}
      rowKey={(row) => row.id}
      caption="t"
      onSortChange={(sort) => requested.push(`${sort.key}:${sort.direction}`)}
    />,
  );
  click($(view.container, '.ls-th-sort')!);
  assert.deepEqual(requested, ['name:asc']);
  assert.deepEqual(
    cellTexts(view.container),
    ['Cẩm', 'An', 'Bình'],
    'the server decides the order',
  );
  view.unmount();
});

const DEFAULTS = { q: '', status: '', page: 1, pageSize: 20 };

function UrlProbe({
  onState,
}: {
  onState: (
    state: typeof DEFAULTS,
    update: ReturnType<typeof ui.useUrlState<typeof DEFAULTS>>[1],
  ) => void;
}) {
  const [state, update] = ui.useUrlState(DEFAULTS, { resetOnChange: ['page'] });
  onState(state, update);
  return <output>{JSON.stringify(state)}</output>;
}

test('useUrlState: reads the address bar, writes history entries, follows Back', async () => {
  window.history.replaceState(null, '', '/employees?page=3&tab=roles');
  let state = DEFAULTS;
  let update!: ReturnType<typeof ui.useUrlState<typeof DEFAULTS>>[1];
  const view = mount(
    <UrlProbe
      onState={(s, u) => {
        state = s;
        update = u;
      }}
    />,
  );
  assert.equal(state.page, 3, 'initial state comes from the URL');
  const start = window.history.length;

  act(() => update({ status: 'active' }));
  assert.equal(
    window.location.search,
    '?tab=roles&status=active',
    'a filter change drops the page (default) and keeps foreign params',
  );
  assert.equal(state.status, 'active');
  assert.equal(state.page, 1, 'page reset to 1');
  assert.equal(window.history.length, start + 1, 'a filter change adds a history entry');

  act(() => update({ q: 'hoa' }, { replace: true }));
  assert.equal(window.history.length, start + 1, 'typing in the search box replaces the entry');
  assert.match(window.location.search, /q=hoa/);

  act(() => update({ page: 2 }));
  assert.equal(state.page, 2);
  assert.match(window.location.search, /page=2/);
  const before = window.history.length;
  act(() => update({ page: 2 }));
  assert.equal(window.history.length, before, 'no change, no new entry');

  // jsdom dispatches popstate asynchronously: wait for it (up to 2 s) instead of a fixed pause, which
  // is too short when the machine is busy (the whole-repo run shares the CPU with the API tests).
  await act(async () => {
    window.history.back();
    for (let waited = 0; state.page !== 1 && waited < 2000; waited += 20) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  });
  assert.equal(state.page, 1, 'Back returns to the previous state');
  view.unmount();
});

test('ListToolbar: on a phone the filters move into a sheet and the count of applied filters shows', () => {
  const labels = {
    toolbar: 'Bộ lọc',
    filters: 'Bộ lọc',
    reset: 'Xóa',
    close: 'Đóng',
    apply: 'Xem',
  };
  const node = (
    <ui.ListToolbar
      labels={labels}
      search={<input aria-label="Tìm" />}
      filters={<select aria-label="Trạng thái" />}
      activeFilters={2}
      onReset={() => undefined}
    />
  );
  dom.setPhone(false);
  const desktop = mount(node);
  assert.ok($(desktop.container, 'select'), 'desktop: filters inline');
  assert.ok(!$(window.document, '.ls-drawer'));
  desktop.unmount();

  dom.setPhone(true);
  const phone = mount(node);
  assert.ok(!$(phone.container, 'select'), 'phone: no inline filters');
  const button = $$(phone.container, 'button').find(
    (b) => b.getAttribute('aria-label') === 'Bộ lọc (2)',
  );
  assert.ok(button, 'a Filters button with the number of applied filters');
  click(button!);
  const sheet = $(window.document, '.ls-drawer');
  assert.ok(sheet, 'the sheet opens');
  assert.ok($(sheet!, 'select'), 'with the filters inside');
  assert.equal(
    window.document.querySelectorAll('select').length,
    1,
    'the filters exist once, not duplicated',
  );
  press(sheet!, 'Escape');
  assert.ok(!$(window.document, '.ls-drawer'), 'Escape closes the sheet');
  phone.unmount();
  dom.setPhone(false);
});

test('FilterChips: the remove button reports its chip', () => {
  const removed: string[] = [];
  const view = mount(
    <ui.FilterChips
      chips={[
        { key: 'branch', label: 'Chi nhánh: A' },
        { key: 'status', label: 'Trạng thái: B' },
      ]}
      removeLabel="Bỏ {filter}"
      onRemove={(key) => removed.push(key)}
    />,
  );
  click($(view.container, '[aria-label="Bỏ Trạng thái: B"]')!);
  assert.deepEqual(removed, ['status']);
  view.unmount();
});
