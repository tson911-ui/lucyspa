import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CursorPagination,
  DataTable,
  DescriptionList,
  FilterChips,
  ListToolbar,
  MediaThumb,
  Pagination,
  Tabs,
  type DataTableColumn,
  type PaginationLabels,
} from './index';

// Longest-Vietnamese-label rule (contract section 5): text is carried whole, wrapping is CSS's job.
const LONG =
  'Xác nhận hủy lịch hẹn của khách hàng đã đặt trước qua điện thoại và ghi chú thêm yêu cầu đặc biệt';

const html = renderToStaticMarkup;
const css = readFileSync(new URL('components.css', import.meta.url), 'utf8');

const labels: PaginationLabels = {
  nav: 'Trang của danh sách Nhân viên',
  first: 'Trang đầu',
  previous: 'Trang trước',
  next: 'Trang sau',
  last: 'Trang cuối',
  pageNumber: 'Trang {page}',
  summary: 'Hiển thị {from}-{to} trong {total}',
  pageSize: 'Số dòng mỗi trang',
  pageSizeOption: '{size} dòng mỗi trang',
};

interface Person {
  id: string;
  code: string;
  name: string;
}
const people: Person[] = [
  { id: 'c', code: 'NV03', name: 'Cường' },
  { id: 'a', code: 'NV01', name: 'An' },
  { id: 'b', code: 'NV02', name: LONG },
];
const columns: DataTableColumn<Person>[] = [
  {
    key: 'code',
    header: 'Mã',
    sortable: true,
    sortValue: (row) => row.code,
    cell: (row) => row.code,
  },
  {
    key: 'name',
    header: 'Họ tên',
    mobileTitle: true,
    sortable: true,
    sortValue: (row) => row.name,
    cell: (row) => row.name,
  },
  { key: 'branch', header: 'Chi nhánh', hideBelow: 'md', cell: () => 'Lucy A' },
  { key: 'title', header: 'Chức danh', hideBelow: 'lg', cell: () => 'Nhân viên' },
  {
    key: 'actions',
    header: 'Thao tác',
    actions: true,
    cell: (row) => <a href={`/x/${row.id}`}>Chi tiết</a>,
  },
];

function names(markup: string): string[] {
  return [
    ...markup.matchAll(/<td[^>]*data-label="Mã"[^>]*><span class="ls-cell-value">([^<]*)</g),
  ].map((match) => match[1] ?? '');
}

test('DataTable: an empty value shows an em dash; the value sits in its own span (phone card rows)', () => {
  const markup = html(
    <DataTable
      paging={{ off: 'test' }}
      mode="server"
      columns={[
        { key: 'a', header: 'Mã', cell: () => '' },
        { key: 'b', header: 'Tên', cell: () => null },
        { key: 'c', header: 'Chức danh', cell: () => 'Học viên' },
      ]}
      rows={[{ id: '1' }]}
      rowKey={(row) => row.id}
      caption="t"
    />,
  );
  assert.equal(markup.match(/<span class="ls-cell-value">—<\/span>/g)?.length, 2);
  assert.match(markup, /<span class="ls-cell-value">Học viên<\/span>/);
});

test('DataTable: a hidePhone column is marked for the phone card list only; other widths still show it', () => {
  const markup = html(
    <DataTable
      paging={{ off: 'test' }}
      mode="server"
      columns={[
        { key: 'a', header: 'Mã', mobileTitle: true, cell: () => 'INV-1' },
        { key: 'b', header: 'Lập lúc', hidePhone: true, cell: () => '19:41' },
        { key: 'c', header: 'Khách', cell: () => 'Hoàng Thị Lan' },
      ]}
      rows={[{ id: '1' }]}
      rowKey={(row) => row.id}
      caption="t"
    />,
  );
  assert.equal((markup.match(/ls-hide-phone/g) ?? []).length, 2, 'its heading and its cell');
  assert.match(markup, /<td[^>]*ls-hide-phone[^>]*data-label="Lập lúc"/);
  assert.doesNotMatch(markup, /<td[^>]*ls-hide-md|ls-hide-lg|ls-hide-xl/, 'no width is hidden');
});

test('DataTable: a leading picture column has a hidden heading, no card label, and MediaThumb keeps its square without a picture', () => {
  const markup = html(
    <DataTable
      paging={{ off: 'test' }}
      mode="server"
      columns={[
        {
          key: 'image',
          header: 'Ảnh sản phẩm',
          leading: true,
          cell: (row: { id: string }) => <MediaThumb src={row.id === '1' ? '/t/1' : null} />,
        },
        { key: 'name', header: 'Tên', mobileTitle: true, cell: () => 'Sữa rửa mặt' },
      ]}
      rows={[{ id: '1' }, { id: '2' }]}
      rowKey={(row) => row.id}
      caption="t"
    />,
  );
  assert.match(
    markup,
    /<th[^>]*ls-cell-leading[^>]*><span class="ls-visually-hidden">Ảnh sản phẩm<\/span>/,
  );
  assert.doesNotMatch(markup, /<td[^>]*ls-cell-leading[^>]*data-label/, 'no label in the card');
  assert.match(markup, /<span class="ls-thumb"><img src="\/t\/1" alt=""/, 'decorative picture');
  assert.equal((markup.match(/class="ls-thumb"/g) ?? []).length, 2, 'both rows hold the square');
  assert.match(markup, /<span class="ls-thumb"><svg/, 'placeholder icon when there is no picture');
});

test('DataTable: semantic table, labelled cells, hidden actions heading, responsive classes', () => {
  const markup = html(
    <DataTable
      paging={{ off: 'test' }}
      columns={columns}
      rows={people}
      rowKey={(row) => row.id}
      caption="Bảng Nhân viên"
    />,
  );
  assert.match(markup, /<table class="ls-table">/);
  assert.match(markup, /<caption class="ls-visually-hidden">Bảng Nhân viên<\/caption>/);
  assert.equal((markup.match(/<th /g) ?? []).length, columns.length);
  assert.match(markup, /scope="col"/);
  assert.match(
    markup,
    /<th[^>]*ls-cell-actions[^>]*><span class="ls-visually-hidden">Thao tác<\/span>/,
    'the Actions heading exists for assistive technology',
  );
  assert.match(markup, /data-label="Chi nhánh"/, 'phone card list labels');
  assert.doesNotMatch(
    markup,
    /<td[^>]*ls-cell-title[^>]*data-label/,
    'the card title has no label',
  );
  assert.doesNotMatch(markup, /<td[^>]*ls-cell-actions[^>]*data-label/, 'actions have no label');
  assert.match(markup, /ls-hide-md/);
  assert.match(markup, /ls-hide-lg/);
  assert.ok(markup.includes(LONG), 'the longest Vietnamese value is carried whole');
  assert.doesNotMatch(markup, /style=/, 'no inline sizes');
});

test('DataTable client mode: sorts by the column value, exposes aria-sort, pages the loaded rows', () => {
  const sorted = html(
    <DataTable
      paging={{ off: 'test' }}
      columns={columns}
      rows={people}
      rowKey={(row) => row.id}
      caption="t"
      sort={{ key: 'code', direction: 'asc' }}
    />,
  );
  assert.deepEqual(names(sorted), ['NV01', 'NV02', 'NV03']);
  assert.match(sorted, /<th[^>]*aria-sort="ascending"[^>]*>.*?Mã/);
  assert.match(sorted, /aria-sort="none"/, 'other sortable columns say none');
  assert.equal((sorted.match(/aria-sort=/g) ?? []).length, 2, 'only sortable columns');
  const desc = html(
    <DataTable
      paging={{ off: 'test' }}
      columns={columns}
      rows={people}
      rowKey={(row) => row.id}
      caption="t"
      sort={{ key: 'code', direction: 'desc' }}
    />,
  );
  assert.deepEqual(names(desc), ['NV03', 'NV02', 'NV01']);
  assert.match(desc, /aria-sort="descending"/);
  assert.match(desc, /<button[^>]*class="ls-th-sort"/, 'the sort control is a real button');

  const many = Array.from({ length: 45 }, (_, index): Person => ({
    id: String(index),
    code: `NV${String(index + 1).padStart(2, '0')}`,
    name: `Người ${index + 1}`,
  }));
  const page2 = html(
    <DataTable
      columns={columns}
      rows={many}
      rowKey={(row) => row.id}
      caption="t"
      paging={{ page: 2, pageSize: 20, onPageChange: () => undefined, labels }}
    />,
  );
  assert.equal(names(page2).length, 20);
  assert.equal(names(page2)[0], 'NV21');
  assert.ok(page2.includes('Hiển thị 21-40 trong 45'));
  assert.match(page2, /aria-current="page"[^>]*>2</);
});

test('DataTable server mode: shows the given page and the server total', () => {
  const markup = html(
    <DataTable
      mode="server"
      columns={columns}
      rows={people}
      rowKey={(row) => row.id}
      caption="t"
      paging={{ page: 3, pageSize: 20, total: 133, onPageChange: () => undefined, labels }}
    />,
  );
  assert.deepEqual(names(markup), ['NV03', 'NV01', 'NV02'], 'rows are not re-sorted or re-sliced');
  assert.ok(markup.includes('Hiển thị 41-60 trong 133'));
  assert.match(markup, /aria-label="Trang 7"/);
});

test('DataTable states: skeleton rows while loading, error and empty replace the table', () => {
  const loading = html(
    <DataTable
      paging={{ off: 'test' }}
      columns={columns}
      rows={[]}
      rowKey={(row) => row.id}
      caption="t"
      loading
      loadingLabel="Đang tải…"
    />,
  );
  assert.equal((loading.match(/ls-tr-skeleton/g) ?? []).length, 5, 'five skeleton rows');
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /role="status">Đang tải…/);
  assert.match(loading, /<tr[^>]*ls-tr-skeleton[^>]*aria-hidden="true"/, 'skeleton is decorative');

  const refreshing = html(
    <DataTable
      paging={{ off: 'test' }}
      columns={columns}
      rows={people}
      rowKey={(row) => row.id}
      caption="t"
      loading
    />,
  );
  assert.equal(
    (refreshing.match(/ls-tr-skeleton/g) ?? []).length,
    0,
    'loaded rows stay while reloading',
  );
  assert.match(refreshing, /ls-table-refreshing/);

  const failed = html(
    <DataTable
      paging={{ off: 'test' }}
      columns={columns}
      rows={[]}
      rowKey={(row) => row.id}
      caption="t"
      error={<p>Không tải được.</p>}
    />,
  );
  assert.ok(failed.includes('Không tải được.'));
  assert.doesNotMatch(failed, /<table/);

  const empty = html(
    <DataTable
      paging={{ off: 'test' }}
      columns={columns}
      rows={[]}
      rowKey={(row) => row.id}
      caption="t"
      empty={<p>Chưa có nhân viên.</p>}
    />,
  );
  assert.ok(empty.includes('Chưa có nhân viên.'));
  assert.doesNotMatch(empty, /<table|ls-pagination/, 'no table and no pager on an empty list');
});

test('Pagination: ARIA, current page, boundaries, always a count line', () => {
  const middle = html(
    <Pagination
      page={2}
      pageSize={20}
      total={133}
      onPageChange={() => undefined}
      labels={labels}
    />,
  );
  assert.match(middle, /<nav[^>]*aria-label="Trang của danh sách Nhân viên"/);
  assert.match(middle, /aria-current="page"[^>]*>2</);
  assert.equal((middle.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(middle, /aria-label="Trang đầu"/);
  assert.match(middle, /aria-label="Trang cuối"/);
  assert.match(middle, /aria-label="Trang 3"/);
  assert.ok(middle.includes('Hiển thị 21-40 trong 133'));
  assert.doesNotMatch(middle, /<select/, 'no page-size select without a handler');

  const first = html(
    <Pagination
      page={1}
      pageSize={20}
      total={133}
      onPageChange={() => undefined}
      labels={labels}
    />,
  );
  assert.match(
    first,
    /<button[^>]*aria-label="Trang trước"[^>]*disabled=""|<button[^>]*disabled=""[^>]*aria-label="Trang trước"/,
  );
  assert.match(first, /aria-label="Trang đầu"[^>]*disabled=""/);
  const last = html(
    <Pagination
      page={7}
      pageSize={20}
      total={133}
      onPageChange={() => undefined}
      labels={labels}
    />,
  );
  assert.match(last, /aria-label="Trang sau"[^>]*disabled=""/);
  assert.match(last, /aria-label="Trang cuối"[^>]*disabled=""/);

  const single = html(
    <Pagination
      page={1}
      pageSize={20}
      total={7}
      onPageChange={() => undefined}
      onPageSizeChange={() => undefined}
      labels={labels}
    />,
  );
  assert.doesNotMatch(single, /<nav/, 'one page: no page buttons');
  assert.ok(single.includes('Hiển thị 1-7 trong 7'), 'the count line stays');
  assert.doesNotMatch(single, /<select/, 'no size choice when everything fits the smallest size');
  const none = html(
    <Pagination page={1} pageSize={20} total={0} onPageChange={() => undefined} labels={labels} />,
  );
  assert.ok(none.includes('Hiển thị 0-0 trong 0'));

  const sized = html(
    <Pagination
      page={1}
      pageSize={20}
      total={133}
      onPageChange={() => undefined}
      onPageSizeChange={() => undefined}
      labels={labels}
    />,
  );
  assert.match(sized, /<select[^>]*aria-label="Số dòng mỗi trang"/);
  for (const size of [10, 20, 50]) assert.ok(sized.includes(`${size} dòng mỗi trang`));
  assert.match(sized, /<option value="20" selected/, 'the current size is selected');
});

test('CursorPagination: load more or previous/next, busy state, nothing when done', () => {
  const cursor = {
    nav: 'Trang',
    loadMore: 'Tải thêm',
    previous: 'Trước',
    next: 'Sau',
    loading: 'Đang tải…',
  };
  const more = html(<CursorPagination hasNext onNext={() => undefined} labels={cursor} />);
  assert.ok(more.includes('Tải thêm'));
  assert.doesNotMatch(more, /Trước/);
  assert.equal(
    html(<CursorPagination hasNext={false} onNext={() => undefined} labels={cursor} />),
    '',
    'nothing more to load',
  );
  const stepper = html(
    <CursorPagination
      hasNext
      hasPrevious={false}
      onNext={() => undefined}
      onPrevious={() => undefined}
      labels={cursor}
    />,
  );
  assert.ok(stepper.includes('Sau') && stepper.includes('Trước'));
  assert.match(
    stepper,
    /<button[^>]*disabled=""[^>]*>(?:<[^>]+>)*Trước/,
    'previous is off on the first step',
  );
  const busy = html(<CursorPagination hasNext loading onNext={() => undefined} labels={cursor} />);
  assert.match(busy, /aria-busy="true"/);
});

test('ListToolbar: search landmark, live count, reset only when filters apply, chips', () => {
  const toolbar = {
    toolbar: 'Tìm kiếm và bộ lọc',
    filters: 'Bộ lọc',
    reset: 'Xóa bộ lọc',
    close: 'Đóng',
    apply: 'Xem kết quả',
  };
  const on = html(
    <ListToolbar
      labels={toolbar}
      search={<input aria-label="Tìm" />}
      filters={<select aria-label="Trạng thái" />}
      activeFilters={2}
      resultCount="12 kết quả"
      onReset={() => undefined}
      actions={<button type="button">Xuất</button>}
      chips={
        <FilterChips
          chips={[{ key: 'status', label: `Trạng thái: ${LONG}` }]}
          onRemove={() => undefined}
          removeLabel="Bỏ bộ lọc {filter}"
        />
      }
    />,
  );
  assert.match(
    on,
    /role="search"[^>]*aria-label="Tìm kiếm và bộ lọc"|aria-label="Tìm kiếm và bộ lọc"[^>]*role="search"/,
  );
  assert.match(on, /<p class="ls-toolbar-count" role="status">12 kết quả<\/p>/);
  assert.ok(on.includes('Xóa bộ lọc'));
  assert.match(
    on,
    /aria-label="Bỏ bộ lọc Trạng thái: Xác nhận/,
    'each chip says what removing it does',
  );
  assert.ok(on.includes(LONG));
  const off = html(
    <ListToolbar
      labels={toolbar}
      search={<input />}
      filters={<select />}
      activeFilters={0}
      onReset={() => undefined}
    />,
  );
  assert.doesNotMatch(off, /Xóa bộ lọc/, 'nothing to reset');
  assert.doesNotMatch(off, /ls-toolbar-count/);
  assert.equal(html(<FilterChips chips={[]} onRemove={() => undefined} removeLabel="x" />), '');
});

test('DescriptionList: real dl markup, empty values, long values', () => {
  const markup = html(
    <DescriptionList
      columns={2}
      items={[
        { label: 'Mã', value: 'NV01' },
        { label: 'Ghi chú', value: LONG },
        { label: 'Email', value: '' },
        { label: 'Điện thoại', value: null },
      ]}
    />,
  );
  assert.match(markup, /^<dl class="ls-dl ls-dl-2">/);
  assert.equal((markup.match(/<dt /g) ?? []).length, 4);
  assert.equal((markup.match(/<dd /g) ?? []).length, 4);
  assert.ok(markup.includes(LONG));
  assert.equal((markup.match(/>—</g) ?? []).length, 2, 'empty values show a dash');
});

test('DescriptionList totals: amounts at the trailing edge, the closing line is strong', () => {
  const markup = html(
    <DescriptionList
      layout="totals"
      columns={2}
      items={[
        { label: 'Tạm tính', value: '500.000 ₫' },
        { label: 'Tổng tiền', value: '450.000 ₫', strong: true },
      ]}
    />,
  );
  assert.match(markup, /^<dl class="ls-dl ls-dl-totals">/, 'totals ignore the two-column grid');
  assert.equal((markup.match(/ls-dl-row-strong/g) ?? []).length, 1);
  assert.match(css, /\.ls-dl-totals \.ls-dl-value \{[^}]*white-space: nowrap/);
  assert.match(css, /\.ls-dl-totals \.ls-dl-value \{[^}]*text-align: end/);
});

test('Tabs: tablist semantics, roving tabindex, only the selected panel renders', () => {
  const markup = html(
    <Tabs
      label="Chi tiết nhân sự"
      defaultValue="skills"
      tabs={[
        { id: 'overview', label: 'Tổng quan', panel: <p>Nội dung tổng quan</p> },
        { id: 'skills', label: LONG, panel: <p>Nội dung kỹ năng</p> },
        { id: 'roles', label: 'Vai trò', panel: <p>Nội dung vai trò</p>, disabled: true },
      ]}
    />,
  );
  assert.match(
    markup,
    /role="tablist"[^>]*aria-label="Chi tiết nhân sự"|aria-label="Chi tiết nhân sự"[^>]*role="tablist"/,
  );
  assert.equal((markup.match(/role="tab"/g) ?? []).length, 3);
  assert.equal((markup.match(/aria-selected="true"/g) ?? []).length, 1);
  assert.match(
    markup,
    /aria-selected="true"[^>]*tabindex="0"|tabindex="0"[^>]*aria-selected="true"/,
  );
  assert.equal(
    (markup.match(/tabindex="-1"/g) ?? []).length,
    2,
    'the other tabs are not in the tab order',
  );
  assert.match(markup, /role="tabpanel"[^>]*aria-labelledby="[^"]+-tab-skills"/);
  assert.ok(markup.includes('Nội dung kỹ năng'));
  assert.ok(!markup.includes('Nội dung tổng quan'), 'other panels are not rendered');
  assert.match(markup, /<button[^>]*disabled=""[^>]*>Vai trò/);
  assert.ok(markup.includes(LONG));
  // An unknown or disabled selection falls back to the first enabled tab.
  const fallback = html(
    <Tabs
      label="x"
      value="roles"
      tabs={[
        { id: 'a', label: 'A', panel: <p>PA</p> },
        { id: 'roles', label: 'R', panel: <p>PR</p>, disabled: true },
      ]}
    />,
  );
  assert.ok(fallback.includes('PA') && !fallback.includes('PR'));
});
