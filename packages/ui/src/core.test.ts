import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createConfirmController, typingMatches, type ConfirmState } from './confirm-core';
import {
  createDebouncer,
  describedBy,
  filterOptions,
  formatMoney,
  normalizeSearch,
  parseMoney,
} from './form-core';
import {
  DEFAULT_IMAGE_TYPES,
  formatBytes,
  precheckDimensions,
  precheckFile,
  uploaderReducer,
  type UploaderState,
} from './image-core';
import { nextEnabledIndex, orderActions, trapTarget, typeaheadIndex } from './menu-core';
import { placePanel } from './popover';
import { addToast, MAX_TOASTS, removeToast, type ToastData } from './toast-core';

// ---- Menu keyboard ---------------------------------------------------------------------------
test('arrow keys skip disabled entries and wrap; Home and End pick the ends', () => {
  const items = [{}, { disabled: true }, {}, {}];
  assert.equal(nextEnabledIndex(items, 0, 'ArrowDown'), 2, 'skips the disabled entry');
  assert.equal(nextEnabledIndex(items, 3, 'ArrowDown'), 0, 'wraps at the end');
  assert.equal(nextEnabledIndex(items, 0, 'ArrowUp'), 3, 'wraps at the start');
  assert.equal(nextEnabledIndex(items, -1, 'ArrowDown'), 0);
  assert.equal(nextEnabledIndex(items, 2, 'Home'), 0);
  assert.equal(nextEnabledIndex([{ disabled: true }, {}, { disabled: true }], 1, 'End'), 1);
  assert.equal(nextEnabledIndex([{ disabled: true }], 0, 'ArrowDown'), -1);
  assert.equal(nextEnabledIndex([], -1, 'Home'), -1);
});

test('typeahead finds the next label by prefix and cycles on a repeated letter', () => {
  const labels = ['Sửa', 'Sao chép', 'Xóa', 'Sắp xếp'];
  const none = [false, false, false, false];
  assert.equal(typeaheadIndex(labels, none, 0, 'x'), 2);
  assert.equal(typeaheadIndex(labels, none, 0, 'sa'), 1, 'longer prefix narrows the match');
  assert.equal(typeaheadIndex(labels, none, 0, 's'), 1, 'a repeated single letter moves on');
  assert.equal(typeaheadIndex(labels, none, 3, 's'), 0, 'and wraps');
  assert.equal(typeaheadIndex(labels, [false, true, false, false], 0, 'sao'), -1, 'skips disabled');
  assert.equal(typeaheadIndex(labels, none, 0, ' '), -1);
});

test('row action order is fixed: safe actions first, destructive last', () => {
  const items = [
    { id: 'delete', tone: 'danger' as const },
    { id: 'copy' },
    { id: 'archive', tone: 'default' as const },
    { id: 'end', tone: 'danger' as const },
  ];
  const { safe, danger } = orderActions(items);
  assert.deepEqual(
    safe.map((item) => item.id),
    ['copy', 'archive'],
  );
  assert.deepEqual(
    danger.map((item) => item.id),
    ['delete', 'end'],
  );
});

test('focus trap wraps Tab at both ends and leaves the middle to the browser', () => {
  assert.equal(trapTarget(2, 3, false), 0, 'Tab on the last element goes to the first');
  assert.equal(trapTarget(0, 3, true), 2, 'Shift+Tab on the first goes to the last');
  assert.equal(trapTarget(1, 3, false), null);
  assert.equal(trapTarget(1, 3, true), null);
  assert.equal(trapTarget(-1, 3, false), 0, 'focus outside the dialog is pulled back in');
  assert.equal(trapTarget(-1, 3, true), 2);
});

test('a popover opens below when it fits, above when it does not, and stays on screen', () => {
  const viewport = { width: 400, height: 600 };
  const panel = { width: 200, height: 120 };
  const low = { top: 100, bottom: 140, left: 300, right: 340 };
  assert.deepEqual(placePanel(low, panel, viewport, 'end'), { top: 144, left: 140 });
  const bottom = { top: 540, bottom: 580, left: 10, right: 50 };
  assert.equal(placePanel(bottom, panel, viewport, 'start').top, 416, 'flips above');
  assert.equal(placePanel(bottom, panel, viewport, 'end').left, 8, 'clamped to the left edge');
  const right = { top: 100, bottom: 140, left: 380, right: 396 };
  assert.equal(placePanel(right, panel, viewport, 'start').left, 192, 'clamped to the right edge');
});

// ---- Forms -----------------------------------------------------------------------------------
test('money is an integer VND: digits only, grouped with dots, empty is null', () => {
  assert.equal(parseMoney('1.234.567 ₫'), 1234567);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney('12,5'), 125, 'a decimal separator never produces a fraction');
  assert.equal(parseMoney('99999999999999999999'), undefined, 'unsafe integers are refused');
  assert.equal(formatMoney(1234567), '1.234.567');
  assert.equal(formatMoney(999), '999');
  assert.equal(formatMoney(0), '0');
  assert.equal(formatMoney(null), '');
  assert.equal(formatMoney(1000000, ' '), '1 000 000');
});

test('search ignores case and Vietnamese diacritics, including the stroke d', () => {
  assert.equal(normalizeSearch('Nguyễn Thị Đào'), 'nguyen thi dao');
  const options = [
    { value: 'a', label: 'Nguyễn Văn An' },
    { value: 'b', label: 'Đồng Thị Bình' },
    { value: 'c', label: 'Lê Hoàng' },
  ];
  assert.deepEqual(
    filterOptions(options, 'nguyen').map((option) => option.value),
    ['a'],
  );
  assert.deepEqual(
    filterOptions(options, 'DONG').map((option) => option.value),
    ['b'],
  );
  assert.deepEqual(
    filterOptions(options, 'hoàng').map((option) => option.value),
    ['c'],
  );
  assert.equal(filterOptions(options, '  ').length, 3, 'a blank query shows everything');
  assert.equal(filterOptions(options, 'zzz').length, 0);
});

test('the debouncer fires once with the last value and can be cancelled', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const seen: string[] = [];
    const debounced = createDebouncer((value: string) => seen.push(value), 300);
    debounced.call('n');
    mock.timers.tick(200);
    debounced.call('ng');
    mock.timers.tick(299);
    assert.deepEqual(seen, [], 'not yet');
    mock.timers.tick(1);
    assert.deepEqual(seen, ['ng']);
    debounced.call('x');
    debounced.cancel();
    mock.timers.tick(1000);
    assert.deepEqual(seen, ['ng'], 'a cancelled call never fires');
  } finally {
    mock.timers.reset();
  }
});

test('aria-describedby joins only the ids that exist', () => {
  assert.equal(describedBy('a', undefined, 'b', false, null), 'a b');
  assert.equal(describedBy(undefined, false), undefined);
});

// ---- Toasts ----------------------------------------------------------------------------------
test('toasts are capped, keep the newest, and can be removed', () => {
  let list: ToastData[] = [];
  for (let index = 1; index <= MAX_TOASTS + 2; index += 1) {
    list = addToast(list, { id: `t${index}`, tone: 'info', message: `m${index}` });
  }
  assert.equal(list.length, MAX_TOASTS);
  assert.equal(list[0]?.id, `t${3}`);
  assert.equal(list.at(-1)?.id, `t${MAX_TOASTS + 2}`);
  assert.deepEqual(
    removeToast(list, 't4').map((toast) => toast.id),
    ['t3', 't5', 't6'],
  );
});

// ---- ConfirmDialog behaviour (parity with the existing delete dialog) -------------------------
function controllerFixture(onConfirm: (reason?: string) => Promise<void>) {
  const calls = { confirm: 0, cancel: 0 };
  const states: ConfirmState[] = [];
  const controller = createConfirmController({
    onConfirm: (reason) => {
      calls.confirm += 1;
      return onConfirm(reason);
    },
    onCancel: () => {
      calls.cancel += 1;
    },
    onChange: (state) => states.push(state),
  });
  return { controller, calls, states };
}

test('confirm: creating the dialog and cancelling send nothing', () => {
  const { controller, calls } = controllerFixture(() => Promise.resolve());
  assert.equal(calls.confirm, 0, 'nothing is sent until the confirm button is pressed');
  assert.equal(controller.cancel(), true);
  assert.equal(calls.cancel, 1);
  assert.equal(calls.confirm, 0);
});

test('confirm: a second press while the request runs is ignored, and it cannot be dismissed', async () => {
  let release: () => void = () => undefined;
  const { controller, calls } = controllerFixture(
    () => new Promise<void>((resolve) => (release = resolve)),
  );
  const first = controller.confirm('reason');
  assert.equal(controller.state.pending, true);
  assert.equal(await controller.confirm(), false, 'no double submit');
  assert.equal(controller.cancel(), false, 'Escape, backdrop and Cancel do nothing while busy');
  assert.equal(calls.confirm, 1);
  assert.equal(calls.cancel, 0);
  release();
  assert.equal(await first, true);
});

test('confirm: a refusal keeps the dialog open, shows the reason and allows another try', async () => {
  const failure = new Error('in use');
  let attempts = 0;
  const { controller, states } = controllerFixture(() => {
    attempts += 1;
    return attempts === 1 ? Promise.reject(failure) : Promise.resolve();
  });
  assert.equal(await controller.confirm(), false);
  assert.deepEqual(controller.state, { pending: false, error: failure });
  assert.equal(controller.cancel(), true, 'dismissable again after a refusal');
  assert.equal(await controller.confirm(), true);
  assert.equal(states.at(-1)?.error, null, 'the earlier error is cleared on a new attempt');
});

test('confirm: the written reason is passed to the action', async () => {
  const seen: Array<string | undefined> = [];
  const { controller } = controllerFixture((reason) => {
    seen.push(reason);
    return Promise.resolve();
  });
  await controller.confirm('customer asked');
  assert.deepEqual(seen, ['customer asked']);
});

test('typing confirmation needs the exact code', () => {
  assert.equal(typingMatches(' NAIL_GEL ', 'NAIL_GEL'), true);
  assert.equal(typingMatches('nail_gel', 'NAIL_GEL'), false);
  assert.equal(typingMatches('', 'NAIL_GEL'), false);
});

// ---- Image uploader --------------------------------------------------------------------------
test('image prechecks reject the wrong type, too large files and too small pictures', () => {
  const rules = { accept: DEFAULT_IMAGE_TYPES, maxBytes: 10_000_000 };
  assert.equal(precheckFile({ type: 'image/png', size: 1000 }, rules), null);
  assert.equal(precheckFile({ type: 'image/gif', size: 1000 }, rules), 'type');
  assert.equal(precheckFile({ type: 'application/pdf', size: 1000 }, rules), 'type');
  assert.equal(precheckFile({ type: 'image/webp', size: 10_000_001 }, rules), 'size');
  assert.equal(precheckDimensions({ width: 1920, height: 800 }, { minWidth: 1920 }), null);
  assert.equal(precheckDimensions({ width: 1000, height: 800 }, { minWidth: 1920 }), 'dimensions');
  assert.equal(precheckDimensions({ width: 10, height: 10 }, {}), null);
});

test('file sizes are shown in decimal units with the locale separator', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1_536_000), '1.5 MB');
  assert.equal(formatBytes(1_536_000, ','), '1,5 MB');
  assert.equal(formatBytes(2_000_000), '2 MB');
});

test('the uploader moves idle -> uploading -> error -> idle and clamps progress', () => {
  let state: UploaderState = { status: 'idle' };
  state = uploaderReducer(state, { type: 'start', fileName: 'a.png' });
  assert.deepEqual(state, { status: 'uploading', fileName: 'a.png', progress: null });
  state = uploaderReducer(state, { type: 'progress', progress: 140 });
  assert.equal(state.status === 'uploading' && state.progress, 100);
  state = uploaderReducer(state, { type: 'fail', message: 'nope', retryable: true });
  assert.deepEqual(state, { status: 'error', message: 'nope', retryable: true });
  assert.deepEqual(
    uploaderReducer(state, { type: 'progress', progress: 5 }),
    state,
    'late progress after a failure is ignored',
  );
  assert.deepEqual(uploaderReducer(state, { type: 'reset' }), { status: 'idle' });
});
