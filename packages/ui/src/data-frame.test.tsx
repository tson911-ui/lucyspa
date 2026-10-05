import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { installDom } from './dom-harness';
import {
  DataTable,
  FacetedFilter,
  ListSection,
  ListToolbar,
  MultiValue,
  RowActions,
  type DataTableColumn,
  type MenuItem,
  type PaginationLabels,
} from './index';

// Data frame (plan 7.5c): column policy, paging guard, row menu, toolbar, faceted filter, multi value.
const dom = installDom();
const { window } = dom;
after(() => window.close());
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');

const html = renderToStaticMarkup;
const css = readFileSync(new URL('components.css', import.meta.url), 'utf8');

const LONG_BRANCH =
  'Lucy Spa Đà Nẵng Bãi Biển Mỹ Khê Premium Resort & Wellness, Nguyễn Văn Hưởng, TP. Thủ Đức (chi nhánh trung tâm)';

interface Row {
  id: string;
  name: string;
  price: number | null;
}
const rows: Row[] = [
  { id: '1', name: LONG_BRANCH, price: 350000 },
  { id: '2', name: 'An', price: null },
];

const labels: PaginationLabels = {
  nav: 'Trang',
  first: 'Đầu',
  previous: 'Trước',
  next: 'Sau',
  last: 'Cuối',
  pageNumber: 'Trang {page}',
  summary: 'Hiển thị {from}-{to} trong {total}',
  pageSize: 'Số dòng',
  pageSizeOption: '{size} dòng',
};

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
const $ = (container: ParentNode, selector: string) => container.querySelector(selector);
const $$ = (container: ParentNode, selector: string) => [...container.querySelectorAll(selector)];

function withErrors<T>(run: () => T): { result: T; errors: string[] } {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void errors.push(args.map(String).join(' '));
  try {
    return { result: run(), errors };
  } finally {
    console.error = original;
  }
}

test('DataTable column policy: truncate and wrap clip at a width and repeat the text as title', () => {
  const columns: DataTableColumn<Row>[] = [
    { key: 'name', header: 'Chi nhánh', truncate: true, cell: (row) => row.name },
    { key: 'wrapped', header: 'Ghi chú', wrap: true, width: 'lg', cell: (row) => row.name },
    { key: 'plain', header: 'Tên', cell: (row) => row.name },
    { key: 'price', header: 'Giá', numeric: true, cell: (row) => row.price },
  ];
  const markup = html(
    <DataTable
      paging={{ off: 'test' }}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      caption="t"
    />,
  );
  assert.match(
    markup,
    /<td[^>]*class="ls-col-md"[^>]*><span class="ls-cell-value ls-cell-truncate" title="Lucy Spa/,
  );
  assert.match(markup, /<td[^>]*class="ls-col-lg"[^>]*><span class="ls-cell-value ls-cell-wrap"/);
  assert.match(markup, /<th[^>]*class="ls-col-md"/, 'header shares the width class');
  assert.match(
    markup,
    /<td[^>]*class="ls-cell-numeric ls-cell-end"[^>]*><span class="ls-cell-value">350000</,
    'numbers are right aligned with tabular digits',
  );
  assert.match(markup, /<span class="ls-cell-value">—<\/span>/, 'an empty number is a dash');
  assert.ok(markup.includes(LONG_BRANCH.replace('&', '&amp;')), 'the long value is carried whole');
  assert.doesNotMatch(
    markup.match(/<td[^>]*><span class="ls-cell-value">Lucy/)?.[0] ?? '',
    /ls-cell-truncate|ls-cell-wrap/,
    'a column without a policy stays on its natural width',
  );
  assert.doesNotMatch(markup, /style=/);
});

test('DataTable: more than 20 rows without paging logs an error; a reason is required', () => {
  const many = Array.from({ length: 21 }, (_, index) => ({
    id: String(index),
    name: `Dòng ${index}`,
    price: index,
  }));
  const columns: DataTableColumn<Row>[] = [{ key: 'name', header: 'Tên', cell: (row) => row.name }];
  const long = withErrors(() =>
    html(
      <DataTable
        paging={{ off: 'fixed list' }}
        columns={columns}
        rows={many}
        rowKey={(row) => row.id}
        caption="t"
      />,
    ),
  );
  assert.equal(long.errors.length, 1);
  assert.match(long.errors[0]!, /21 rows without paging/);

  const noReason = withErrors(() =>
    html(
      <DataTable
        paging={{ off: ' ' }}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        caption="t"
      />,
    ),
  );
  assert.match(noReason.errors.join(), /written reason/);

  const fine = withErrors(() =>
    html(
      <DataTable
        mode="client"
        paging={{ page: 1, pageSize: 20, onPageChange: () => undefined, labels }}
        columns={columns}
        rows={many}
        rowKey={(row) => row.id}
        caption="t"
      />,
    ),
  );
  assert.deepEqual(fine.errors, [], 'a paged list of any size is fine');
});

test('DataTable empty and error states sit inside the one table surface (CSS)', () => {
  assert.match(css, /\.ls-table-state\s*\{[^}]*border:\s*1px solid var\(--ls-border\)/);
  assert.match(css, /\.ls-table-state \.ls-empty\s*\{[^}]*border:\s*0/);
  const markup = html(
    <DataTable
      paging={{ off: 'test' }}
      columns={[{ key: 'a', header: 'A', cell: () => 'x' }]}
      rows={[]}
      rowKey={() => 'k'}
      caption="t"
      empty={<p>Chưa có CTV.</p>}
    />,
  );
  assert.match(markup, /<div class="ls-table-state"><p>Chưa có CTV\.<\/p><\/div>/);
});

test('table CSS: one row height, one line per cell, no wrapping headers, card list on a phone', () => {
  const cells = /\.ls-table th,\s*\.ls-table td\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(cells, /height:\s*var\(--ls-row-h\)/);
  assert.match(cells, /white-space:\s*nowrap/);
  assert.doesNotMatch(cells.replace(/border-bottom:[^;]*;/, ''), /\d+px/, 'no pixel literals');
  assert.match(css, /\.ls-cell-wrap\s*\{[^}]*line-clamp:\s*2/);
  assert.match(css, /\.ls-cell-truncate\s*\{[^}]*text-overflow:\s*ellipsis/);
  const phone = css.slice(css.indexOf('Phone: the same table becomes a stacked card list'));
  assert.match(phone, /\.ls-table td\s*\{[^}]*height:\s*auto;[^}]*white-space:\s*normal/s);
  assert.match(phone, /\.ls-cell-truncate,\s*\.ls-cell-wrap\s*\{[^}]*max-width:\s*none/s);
  assert.match(
    phone,
    /\.ls-table \.ls-cell-actions\s*\{[^}]*position:\s*absolute;[^}]*inset-block-start/s,
    'the row menu sits at the top right of the card',
  );
  assert.match(css, /\.ls-pagination\s*\{[^}]*justify-content:\s*flex-end/s);
  assert.match(css, /\.ls-pagination-summary\s*\{[^}]*margin-inline-end:\s*auto/s);
});

test('ListToolbar: one centered row, count and reload at the trailing end, no labels above', () => {
  const toolbar = {
    toolbar: 'Bộ lọc',
    filters: 'Bộ lọc',
    reset: 'Xóa',
    close: 'Đóng',
    apply: 'Xem',
  };
  const markup = html(
    <ListToolbar
      labels={toolbar}
      search={<input aria-label="Tìm" />}
      filters={<select aria-label="Trạng thái" />}
      activeFilters={1}
      onReset={() => undefined}
      resultCount="12 kết quả"
      reload={{ label: 'Tải lại', onClick: () => undefined }}
    />,
  );
  const end = markup.slice(markup.indexOf('ls-toolbar-end'));
  assert.ok(end.indexOf('12 kết quả') < end.indexOf('aria-label="Tải lại"'), 'count then reload');
  assert.ok(
    markup.indexOf('Xóa') < markup.indexOf('ls-toolbar-end'),
    'reset sits before the trailing group',
  );
  assert.doesNotMatch(markup, /<label/, 'no label above any control');
  assert.match(css, /\.ls-toolbar-row\s*\{[^}]*align-items:\s*center/s);
  assert.match(
    css,
    /\.ls-toolbar-search\s*\{[^}]*flex:\s*1 1 15rem;[^}]*max-width:\s*20rem/s,
    'search is 240-320 px',
  );
});

test('RowActions menu order: view/edit first, safe actions, divider, destructive last', () => {
  const items: MenuItem[] = [
    { id: 'edit', label: 'Chỉnh sửa', onSelect: () => undefined },
    { id: 'end', label: 'Kết thúc', tone: 'danger', onSelect: () => undefined },
    { id: 'copy', label: 'Nhân bản', onSelect: () => undefined },
  ];
  const view = mount(<RowActions menuLabel="Thao tác" items={items} />);
  click($(view.container, 'button[aria-haspopup="menu"]')!);
  const entries = $$(window.document, '[role="menu"] > *').map(
    (element) => element.getAttribute('role') + ':' + (element.textContent ?? ''),
  );
  assert.deepEqual(entries, [
    'menuitem:Chỉnh sửa',
    'menuitem:Nhân bản',
    'separator:',
    'menuitem:Kết thúc',
  ]);
  assert.ok($(window.document, '.ls-menu-item-danger'), 'the destructive item is in danger text');
  view.unmount();
});

test('MultiValue: first value, "+N" badge opens the whole list, one value is plain, none is a dash', () => {
  const many = ['Lucy Spa Hà Nội', LONG_BRANCH, 'Lucy Spa Quận 1'];
  const view = mount(
    <MultiValue values={many} moreLabel="Xem {count} chi nhánh" listLabel="Chi nhánh" />,
  );
  assert.equal($(view.container, '.ls-multi-first')?.textContent, 'Lucy Spa Hà Nội');
  const badge = $(view.container, 'button.ls-multi-more')!;
  assert.equal(badge.textContent, '+2');
  assert.equal(badge.getAttribute('aria-label'), 'Xem 3 chi nhánh');
  assert.equal(badge.getAttribute('aria-expanded'), 'false');
  assert.ok(!$(window.document, '.ls-multi-list'));
  click(badge);
  assert.equal(badge.getAttribute('aria-expanded'), 'true');
  const items = $$(window.document, '.ls-multi-list li').map((item) => item.textContent);
  assert.deepEqual(items, many);
  assert.equal($(window.document, '.ls-multi-list')?.getAttribute('aria-label'), 'Chi nhánh');
  act(() => {
    window.document.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
  });
  assert.ok(!$(window.document, '.ls-multi-list'), 'Escape closes it');
  view.unmount();

  const one = html(<MultiValue values={['A']} moreLabel="m {count}" listLabel="l" />);
  assert.doesNotMatch(one, /<button/);
  assert.equal(html(<MultiValue values={[]} moreLabel="m" listLabel="l" />), '<span>—</span>');
});

test('FacetedFilter: the button names itself, shows the choice, single mode replaces and closes', () => {
  const calls: string[][] = [];
  const options = [
    { value: 'ACTIVE', label: 'Đang làm việc', count: 12 },
    { value: 'PENDING', label: 'Chờ thiết lập', count: 3 },
  ];
  function Harness({ selected }: { selected: string[] }) {
    return (
      <FacetedFilter
        label="Trạng thái"
        options={options}
        selected={selected}
        onChange={(next) => calls.push(next)}
        clearLabel="Xóa lọc"
      />
    );
  }
  const view = mount(<Harness selected={[]} />);
  const button = $(view.container, 'button')!;
  assert.equal(button.textContent, 'Trạng thái');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  click(button);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  const panel = $(window.document, '.ls-facet-panel')!;
  assert.equal(panel.getAttribute('aria-label'), 'Trạng thái');
  assert.equal($$(panel, 'input[type="radio"]').length, 2, 'single mode uses radios');
  assert.deepEqual(
    $$(panel, '.ls-facet-count').map((count) => count.textContent),
    ['12', '3'],
    'counts at the end of each row',
  );
  assert.ok(!$$(panel, 'button').some((b) => b.textContent === 'Xóa lọc'), 'no Clear while empty');
  click($$(panel, 'input')[1]!);
  assert.deepEqual(calls, [['PENDING']]);
  assert.ok(!$(window.document, '.ls-facet-panel'), 'single mode closes after choosing');
  view.unmount();

  const chosen = mount(<Harness selected={['PENDING']} />);
  assert.equal($(chosen.container, '.ls-facet-summary')?.textContent, 'Chờ thiết lập');
  click($(chosen.container, 'button')!);
  click($$(window.document, '.ls-facet-panel button').find((b) => b.textContent === 'Xóa lọc')!);
  assert.deepEqual(calls.at(-1), [], 'Clear empties the selection');
  chosen.unmount();
});

test('FacetedFilter multiple: checkboxes toggle and the panel stays open; several show a count', () => {
  const calls: string[][] = [];
  const options = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
    { value: 'c', label: 'C' },
  ];
  const view = mount(
    <FacetedFilter
      label="Chi nhánh"
      options={options}
      selected={['a', 'b']}
      multiple
      onChange={(next) => calls.push(next)}
      clearLabel="Xóa"
      countLabel={(count) => `${count} đã chọn`}
    />,
  );
  assert.equal($(view.container, '.ls-facet-summary')?.textContent, '2 đã chọn');
  click($(view.container, 'button')!);
  const boxes = $$(window.document, '.ls-facet-panel input[type="checkbox"]');
  assert.equal(boxes.length, 3);
  click(boxes[2]!);
  click(boxes[0]!);
  assert.deepEqual(calls, [['a', 'b', 'c'], ['b']]);
  assert.ok($(window.document, '.ls-facet-panel'), 'stays open for more choices');
  view.unmount();
});

test('ListSection: a heading and its content, 16 px apart, not a card', () => {
  const markup = html(
    <ListSection title="Quản lý" headingId="mgr">
      <p>bảng</p>
    </ListSection>,
  );
  assert.match(
    markup,
    /<section class="ls-list-section" aria-labelledby="mgr"><div class="ls-list-section-head"><h2 [^>]*id="mgr">Quản lý<\/h2><\/div><p>bảng<\/p>/,
  );
  // The title is text only: a section takes no count (Owner rule 2026-10-05).
  assert.doesNotMatch(markup, /<span/);
  assert.doesNotMatch(markup, /ls-card/);
  assert.match(css, /\.ls-list-section\s*\{[^}]*gap:\s*var\(--ls-space-4\)/s);
  // The action of this list only sits at the trailing edge of the title row.
  const withAction = html(
    <ListSection title="Vai trò" actions={<button type="button">Gán vai trò</button>}>
      <p>bảng</p>
    </ListSection>,
  );
  assert.match(
    withAction,
    /<\/h2><div class="ls-list-section-actions"><button type="button">Gán vai trò<\/button><\/div><\/div>/,
  );
  assert.match(css, /\.ls-list-section-head\s*\{[^}]*justify-content:\s*space-between/s);
});
