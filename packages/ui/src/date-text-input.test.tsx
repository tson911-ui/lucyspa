import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { installDom } from './dom-harness';

// DateTextInput in a real DOM (jsdom): the staff date field typed as dd/mm/yyyy that reports an ISO date.
const dom = installDom();
const { window } = dom;
after(() => window.close());
const { act, useState } = await import('react');
const { createRoot } = await import('react-dom/client');
const ui = await import('./index');

function mount(node: React.ReactNode) {
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return {
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const input = () => window.document.querySelector<HTMLInputElement>('input')!;
function type(element: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    setter.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}
const focus = (element: HTMLInputElement) =>
  act(() => {
    element.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
    element.focus();
  });
const blur = (element: HTMLInputElement) =>
  act(() => {
    element.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }));
    element.blur();
  });

function Harness({
  start,
  min,
  max,
  log,
}: {
  start: string;
  min?: string;
  max?: string;
  log: string[];
}) {
  const [value, setValue] = useState(start);
  return (
    <ui.DateTextInput
      aria-label="Ngày"
      value={value}
      min={min}
      max={max}
      onChange={(event) => {
        log.push(event.target.value);
        setValue(event.target.value);
      }}
    />
  );
}

test('shows the ISO value as dd/mm/yyyy and reports an ISO date once the date is whole', () => {
  const log: string[] = [];
  const view = mount(<Harness start="2026-10-09" log={log} />);
  assert.equal(input().value, '09/10/2026');
  assert.equal(input().getAttribute('placeholder'), 'dd/mm/yyyy…');
  focus(input());
  type(input(), '1');
  type(input(), '15/03');
  assert.deepEqual(log, [], 'nothing is reported while the date is half typed');
  type(input(), '15032027');
  assert.deepEqual(log, ['2027-03-15']);
  assert.equal(input().value, '15/03/2027');
  view.unmount();
});

test('half a date goes back to the screen date on leaving the field; clearing reports empty', () => {
  const log: string[] = [];
  const view = mount(<Harness start="2026-10-09" log={log} />);
  focus(input());
  type(input(), '15/0');
  blur(input());
  assert.equal(input().value, '09/10/2026');
  assert.deepEqual(log, []);
  focus(input());
  type(input(), '');
  assert.deepEqual(log, ['']);
  view.unmount();
});

test('a date outside min and max is not reported and is marked invalid', () => {
  const log: string[] = [];
  const view = mount(<Harness start="2026-10-09" max="2026-10-09" log={log} />);
  focus(input());
  type(input(), '10102026');
  assert.deepEqual(log, []);
  assert.equal(input().getAttribute('aria-invalid'), 'true');
  blur(input());
  assert.equal(input().value, '09/10/2026');
  view.unmount();
});

test('an ISO date pasted or set by a native-style change is accepted', () => {
  const log: string[] = [];
  const view = mount(<Harness start="" log={log} />);
  type(input(), '2026-10-09');
  assert.deepEqual(log, ['2026-10-09']);
  assert.equal(input().value, '09/10/2026');
  view.unmount();
});

function DateTimeHarness({ start, log }: { start: string; log: string[] }) {
  const [value, setValue] = useState(start);
  return (
    <ui.DateTimeInput
      id="valid-from"
      timeLabel="Giờ"
      timeError="Nhập giờ dạng 14:30."
      value={value}
      onValueChange={(next) => {
        log.push(next);
        setValue(next);
      }}
    />
  );
}

const boxes = () => [...window.document.querySelectorAll<HTMLInputElement>('input')];

test('DateTimeInput: clearing or half typing either part reports empty, never the stale value', () => {
  const log: string[] = [];
  const view = mount(<DateTimeHarness start="2026-10-09T09:30" log={log} />);
  const [date, time] = boxes();
  assert.equal(date!.value, '09/10/2026');
  assert.equal(time!.value, '09:30');
  assert.equal(time!.getAttribute('placeholder'), 'HH:mm…');
  focus(time!);
  type(time!, '');
  assert.deepEqual(log, [''], 'a cleared time with a date present reports empty');
  assert.equal(date!.value, '09/10/2026', 'the date stays on screen');
  type(time!, '1430');
  assert.deepEqual(log, ['', '2026-10-09T14:30']);
  type(time!, '14:3');
  assert.deepEqual(log, ['', '2026-10-09T14:30', ''], 'a half typed time is not a value');
  type(time!, '14:35');
  focus(date!);
  type(date!, '');
  assert.equal(log.at(-1), '', 'a cleared date with a time present reports empty');
  assert.equal(time!.value, '14:35');
  view.unmount();
});

test('DateTimeInput: a time left incomplete is invalid and says what to fix, described by the time box', () => {
  const log: string[] = [];
  const view = mount(<DateTimeHarness start="2026-10-09T09:30" log={log} />);
  const [, time] = boxes();
  focus(time!);
  type(time!, '9');
  assert.equal(window.document.querySelector('.ls-error'), null, 'no error while typing');
  blur(time!);
  assert.equal(time!.value, '9', 'the typed text stays for the person to fix');
  assert.equal(time!.getAttribute('aria-invalid'), 'true');
  const error = window.document.querySelector('.ls-error')!;
  assert.match(error.textContent ?? '', /14:30/);
  assert.equal(time!.getAttribute('aria-describedby'), error.id);
  assert.equal(error.parentElement!.getAttribute('aria-live'), 'polite');
  view.unmount();
});
