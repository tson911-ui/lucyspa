import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { installDom } from './dom-harness';
import { scheduleLayout, type ScheduleItem } from './schedule-strip';

const DAY = 86_400_000;
const item = (id: string, from: number, to: number): ScheduleItem => ({
  id,
  start: from * DAY,
  end: to * DAY,
  tone: 'info',
  label: id,
});

test('schedule layout: windows and "now" are placed across the whole covered range', () => {
  const layout = scheduleLayout([item('a', 0, 10), item('b', 10, 30)], 5 * DAY);
  assert.deepEqual(
    layout.segments.map(({ id, left, width }) => [id, Math.round(left), Math.round(width)]),
    [
      ['a', 0, 33],
      ['b', 33, 67],
    ],
  );
  assert.equal(Math.round(layout.now), 17);
  assert.equal(layout.min, 0);
  assert.equal(layout.max, 30 * DAY);
});

test('schedule layout: "now" before every window widens the range to include it', () => {
  const before = scheduleLayout([item('a', 10, 20)], 0);
  assert.equal(before.now, 0);
  assert.equal(before.segments[0]?.left, 50);
  assert.equal(before.segments[0]?.width, 50);
  const after = scheduleLayout([item('a', 0, 10)], 30 * DAY);
  assert.equal(after.now, 100);
  assert.equal(Math.round(after.segments[0]?.width ?? 0), 33);
});

test('schedule layout: a tiny window gets a minimum width and never leaves the track', () => {
  const layout = scheduleLayout(
    [item('a', 0, 1000), { ...item('z', 1000, 1000), end: 1000 * DAY + 1 }],
    0,
  );
  const last = layout.segments[1];
  assert.ok(last && last.width >= 1.5);
  assert.ok(last.left + last.width <= 100 + 1e-9);
  assert.deepEqual(scheduleLayout([], 7).segments, []);
  assert.equal(scheduleLayout([], 7).now, 0, 'one instant: no division by zero');
});

const dom = installDom();
const { window } = dom;
after(() => window.close());
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const ui = await import('./index');

test('ScheduleStrip: a decorative picture (hidden from assistive technology) with the two end dates', () => {
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <ui.ScheduleStrip
        items={[
          { ...item('a', 0, 10), tone: 'success' },
          { ...item('b', 10, 20), tone: 'neutral' },
        ]}
        now={5 * DAY}
        startLabel="01/01"
        endLabel="21/01"
        nowLabel="Hiện tại"
      />,
    ),
  );
  const strip = container.querySelector('.ls-schedule');
  assert.equal(strip?.getAttribute('aria-hidden'), 'true');
  assert.equal(container.querySelectorAll('.ls-schedule-seg').length, 2);
  assert.ok(container.querySelector('.ls-schedule-seg-success'));
  assert.ok(container.querySelector('.ls-schedule-seg-neutral'));
  assert.equal(container.querySelector('.ls-schedule-now')?.getAttribute('title'), 'Hiện tại');
  assert.deepEqual(
    [...container.querySelectorAll('.ls-schedule-axis span')].map((span) => span.textContent),
    ['01/01', '21/01'],
  );
  act(() => root.unmount());
  container.remove();
});

test('schedule styles: tokens only', () => {
  const css = readFileSync(new URL('components.css', import.meta.url), 'utf8');
  const start = css.indexOf('.ls-schedule {');
  assert.ok(start > 0);
  const block = css.slice(start);
  assert.match(block, /\.ls-schedule-seg-success\s*\{[^}]*var\(--ls-success\)/);
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b/i, 'no hex colour');
  assert.doesNotMatch(
    block,
    /(?:gap|padding|margin)[^;]*\d(?:px|rem)/,
    'no px/rem spacing literal',
  );
});
