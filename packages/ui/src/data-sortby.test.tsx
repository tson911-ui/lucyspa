import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { DataTableColumn } from './index';
import { installDom } from './dom-harness';

// The phone "Sort by" select of DataTable (the card list hides the header row).
const dom = installDom();
const { window } = dom;
after(() => window.close());
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { DataTable } = await import('./index');

interface Row {
  id: string;
  name: string;
}
const rows: Row[] = [
  { id: '3', name: 'Cẩm' },
  { id: '1', name: 'An' },
  { id: '2', name: 'Bình' },
];
const columns: DataTableColumn<Row>[] = [
  {
    key: 'name',
    header: 'Tên',
    sortable: true,
    sortValue: (row) => row.name,
    cell: (row) => row.name,
  },
  { key: 'note', header: 'Ghi chú', cell: () => '-' },
];
const labels = {
  label: 'Sắp xếp theo',
  ascending: '{column} (tăng dần)',
  descending: '{column} (giảm dần)',
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

test('Sort by: one option per sortable column and direction, current sort selected', () => {
  const view = mount(
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      caption="t"
      sortLabels={labels}
      sort={{ key: 'name', direction: 'desc' }}
    />,
  );
  const select = view.container.querySelector('.ls-sortby select') as HTMLSelectElement;
  assert.ok(select, 'the select exists');
  assert.equal(view.container.querySelector('.ls-sortby label')?.textContent, 'Sắp xếp theo');
  assert.equal(
    select.getAttribute('id'),
    view.container.querySelector('.ls-sortby label')?.getAttribute('for'),
    'label is wired to the select',
  );
  assert.deepEqual(
    [...select.options].map((option) => option.textContent),
    ['Tên (tăng dần)', 'Tên (giảm dần)'],
    'only sortable columns',
  );
  assert.equal(select.value, 'name:desc');
  view.unmount();
});

test('Sort by: choosing an option sorts (client) and reports the change', () => {
  const seen: string[] = [];
  const view = mount(
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      caption="t"
      sortLabels={labels}
      onSortChange={(sort) => seen.push(`${sort.key}:${sort.direction}`)}
    />,
  );
  const select = view.container.querySelector('.ls-sortby select') as HTMLSelectElement;
  act(() => {
    select.value = 'name:asc';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  assert.deepEqual(seen, ['name:asc']);
  assert.deepEqual(
    [...view.container.querySelectorAll('tbody td:first-child')].map((cell) => cell.textContent),
    ['An', 'Bình', 'Cẩm'],
  );
  view.unmount();
});

test('Sort by: absent without labels or without a sortable column', () => {
  const plain = mount(
    <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} caption="t" />,
  );
  assert.equal(plain.container.querySelector('.ls-sortby'), null);
  plain.unmount();
  const fixed = mount(
    <DataTable
      columns={[{ key: 'note', header: 'Ghi chú', cell: () => '-' }]}
      rows={rows}
      rowKey={(row) => row.id}
      caption="t"
      sortLabels={labels}
    />,
  );
  assert.equal(fixed.container.querySelector('.ls-sortby'), null);
  fixed.unmount();
});
