import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { installDom } from './dom-harness';
import { SORT_TRANSITION_MS, moveBy, reorder } from './sortable-core';

const dom = installDom();
const { window } = dom;
after(() => window.close());
const { act, useState } = await import('react');
const { createRoot } = await import('react-dom/client');
const { SortableGrid, SortableList } = await import('./index');

const labels = {
  dragHandle: 'Kéo để sắp xếp {name}',
  moveEarlier: 'Chuyển {name} lên trước',
  moveLater: 'Chuyển {name} xuống sau',
  roleDescription: 'mục sắp xếp được',
  instructions: 'Nhấn Space để nhấc, phím mũi tên để di chuyển, Space để thả.',
  lifted: '{name} đã nhấc, vị trí {position} trên {count}.',
  moved: '{name} ở vị trí {position} trên {count}.',
  dropped: '{name} đã thả ở vị trí {position} trên {count}.',
  cancelled: 'Đã hủy. {name} ở vị trí {position} trên {count}.',
};

interface Item {
  id: string;
  name: string;
}
const start: Item[] = [
  { id: 'a', name: 'Lịch hẹn hôm nay' },
  { id: 'b', name: 'Khách đang phục vụ' },
  { id: 'c', name: 'Hóa đơn đã thanh toán trong bảy ngày gần nhất' },
];

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

function Harness({
  grid = false,
  disabled = false,
  log,
}: {
  grid?: boolean;
  disabled?: boolean;
  log: string[][];
}) {
  const [items, setItems] = useState(start);
  const Component = grid ? SortableGrid : SortableList;
  return (
    <Component
      items={items}
      getId={(item: Item) => item.id}
      getLabel={(item: Item) => item.name}
      renderItem={(item: Item) => <span className="content">{item.name}</span>}
      onReorder={(ids: string[]) => {
        log.push(ids);
        setItems(ids.map((id) => items.find((item) => item.id === id)!));
      }}
      labels={labels}
      ariaLabel="Bố cục"
      disabled={disabled}
    />
  );
}

const names = (container: Element) =>
  [...container.querySelectorAll('.content')].map((node) => node.textContent);
const button = (container: Element, label: string) =>
  [...container.querySelectorAll('button')].find(
    (node) => node.getAttribute('aria-label') === label,
  ) as HTMLButtonElement;

test('pure helpers: reorder and moveBy keep every id and refuse impossible moves', () => {
  assert.deepEqual(reorder(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(reorder(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(reorder(['a', 'b'], 0, 5), ['a', 'b']);
  assert.deepEqual(moveBy(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
  assert.equal(moveBy(['a', 'b', 'c'], 'a', -1), null, 'already first');
  assert.equal(moveBy(['a', 'b', 'c'], 'c', 1), null, 'already last');
  assert.equal(moveBy(['a', 'b', 'c'], 'x', 1), null, 'unknown id');
});

test('the item animation length is the base motion token', () => {
  const tokens = readFileSync(new URL('tokens.css', import.meta.url), 'utf8');
  const base = /--ls-dur-base:\s*(\d+)ms/.exec(tokens);
  assert.equal(Number(base?.[1]), SORT_TRANSITION_MS);
});

test('every item has a named drag handle with the sortable role description and instructions', () => {
  const view = mount(<Harness log={[]} />);
  const handle = button(view.container, 'Kéo để sắp xếp Lịch hẹn hôm nay');
  assert.ok(handle, 'handle is named after the item');
  assert.equal(handle.getAttribute('aria-roledescription'), 'mục sắp xếp được');
  const instructions = window.document.getElementById(
    handle.getAttribute('aria-describedby') ?? '',
  );
  assert.equal(instructions?.textContent, labels.instructions);
  assert.equal(view.container.querySelectorAll('.ls-sortable-handle').length, 3);
  assert.equal(view.container.querySelector('ul')?.getAttribute('aria-label'), 'Bố cục');
  view.unmount();
});

test('Move buttons reorder, refuse at the edges, announce, and keep focus on the same button', () => {
  const log: string[][] = [];
  const view = mount(<Harness log={log} />);
  const first = 'Chuyển Lịch hẹn hôm nay lên trước';
  assert.equal(
    button(view.container, first).getAttribute('aria-disabled'),
    'true',
    'first item cannot move earlier',
  );
  assert.equal(
    button(
      view.container,
      'Chuyển Hóa đơn đã thanh toán trong bảy ngày gần nhất xuống sau',
    ).getAttribute('aria-disabled'),
    'true',
  );

  act(() => button(view.container, first).click());
  assert.deepEqual(log, [], 'a click at the edge does nothing');

  const later = button(view.container, 'Chuyển Lịch hẹn hôm nay xuống sau');
  later.focus();
  act(() => later.click());
  assert.deepEqual(log, [['b', 'a', 'c']]);
  assert.deepEqual(names(view.container), [
    'Khách đang phục vụ',
    'Lịch hẹn hôm nay',
    'Hóa đơn đã thanh toán trong bảy ngày gần nhất',
  ]);
  assert.equal(
    (window.document.activeElement as HTMLElement | null)?.getAttribute('aria-label'),
    'Chuyển Lịch hẹn hôm nay xuống sau',
    'focus stays on the same item and direction',
  );
  const status = [...view.container.parentElement!.querySelectorAll('[role="status"]')].map(
    (node) => node.textContent,
  );
  assert.ok(
    status.some((text) => text === 'Lịch hẹn hôm nay ở vị trí 2 trên 3.'),
    `announced: ${status.join(' | ')}`,
  );

  const earlier = button(view.container, 'Chuyển Lịch hẹn hôm nay lên trước');
  act(() => earlier.click());
  assert.deepEqual(log.at(-1), ['a', 'b', 'c'], 'moving back restores the order');
  view.unmount();
});

test('the grid offers Move earlier / later too, inside a bar above each tile', () => {
  const log: string[][] = [];
  const view = mount(<Harness grid log={log} />);
  assert.equal(view.container.querySelectorAll('.ls-sortable-bar').length, 3);
  assert.ok(view.container.querySelector('.ls-sortable-grid'));
  act(() => button(view.container, 'Chuyển Khách đang phục vụ xuống sau').click());
  assert.deepEqual(log, [['a', 'c', 'b']]);
  view.unmount();
});

// jsdom has no layout: give each sortable item a 200 x 50 box stacked in order so dnd-kit's
// keyboard sensor can find "the next item down".
function stackItems() {
  const proto = window.Element.prototype as unknown as { getBoundingClientRect: () => DOMRect };
  const original = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function (this: Element) {
    const id = this.getAttribute('data-sortable-id');
    if (!id) return original.call(this);
    const index = [...(this.parentElement?.children ?? [])].indexOf(this);
    const top = index * 60;
    return {
      x: 0,
      y: top,
      top,
      left: 0,
      right: 200,
      bottom: top + 50,
      width: 200,
      height: 50,
      toJSON: () => ({}),
    } as DOMRect;
  };
  return () => {
    proto.getBoundingClientRect = original;
  };
}

const key = (target: EventTarget, code: string) =>
  act(() => {
    target.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        key: code === 'Space' ? ' ' : code,
        code,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
// The keyboard sensor starts listening for arrows one tick after the lift.
const tick = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
const live = () =>
  [...window.document.querySelectorAll('[role="status"]')]
    .map((node) => node.textContent ?? '')
    .join(' | ');

test('keyboard: Space lifts, arrows move, Space drops and reports the new order', async () => {
  const restore = stackItems();
  const log: string[][] = [];
  const view = mount(<Harness log={log} />);
  const handle = button(view.container, 'Kéo để sắp xếp Khách đang phục vụ');
  handle.focus();
  key(handle, 'Space');
  await tick();
  assert.match(live(), /Khách đang phục vụ đã nhấc, vị trí 2 trên 3\./);
  key(window.document, 'ArrowDown');
  assert.match(live(), /Khách đang phục vụ ở vị trí 3 trên 3\./);
  key(window.document, 'Space');
  assert.match(live(), /Khách đang phục vụ đã thả ở vị trí 3 trên 3\./);
  assert.deepEqual(log, [['a', 'c', 'b']]);
  view.unmount();
  restore();
});

test('keyboard: Escape while lifted cancels without reordering', async () => {
  const restore = stackItems();
  const log: string[][] = [];
  const view = mount(<Harness log={log} />);
  const handle = button(view.container, 'Kéo để sắp xếp Lịch hẹn hôm nay');
  handle.focus();
  key(handle, 'Space');
  await tick();
  key(window.document, 'ArrowDown');
  key(window.document, 'Escape');
  assert.match(live(), /Đã hủy\. Lịch hẹn hôm nay ở vị trí 1 trên 3\./);
  assert.deepEqual(log, []);
  view.unmount();
  restore();
});

test('disabled (outside edit mode): no handles, no buttons, nothing to drag by accident', () => {
  const view = mount(<Harness disabled log={[]} />);
  assert.equal(view.container.querySelectorAll('button').length, 0);
  assert.deepEqual(
    names(view.container),
    start.map((item) => item.name),
  );
  view.unmount();
});
