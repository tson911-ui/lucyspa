import assert from 'node:assert/strict';
import { test } from 'node:test';
import { employee, owner } from '../../../test/support';
import {
  hideWidget,
  layoutKey,
  parseLayout,
  readLayout,
  reorderVisible,
  resizeWidget,
  resolveLayout,
  showWidget,
  toSaved,
  writeLayout,
} from './layout';
import { WIDGETS, allowedAtBranch, availableWidgets, widgetBranchIds } from './widgets';

const ids = (account: Parameters<typeof availableWidgets>[0]) =>
  availableWidgets(account).map((widget) => widget.id);

test('default layout per permission set: what the account may see, in default order', () => {
  assert.deepEqual(ids(employee()), ['myAttendance', 'myLeave', 'notifications', 'quickLinks']);
  assert.deepEqual(ids(owner), [
    'todayBookings',
    'inService',
    'waiting',
    'awaitingInvoice',
    'paymentAlerts',
    'pendingLeave',
    'paidInvoices',
    'notifications',
    'quickLinks',
  ]);
  assert.deepEqual(ids(employee([['VIEW_BOOKINGS', 'A']])), [
    'todayBookings',
    'inService',
    'waiting',
    'myAttendance',
    'myLeave',
    'notifications',
    'quickLinks',
  ]);
  assert.ok(ids(employee([['APPROVE_LEAVE']])).includes('pendingLeave'));
  assert.ok(ids(employee([['CORRECT_PAYMENTS', 'A']])).includes('paymentAlerts'));
  assert.ok(!ids(employee()).includes('pendingLeave'));
});

test('paid invoices need both VIEW_INVOICES and VIEW_REVENUE; awaiting invoices only the first', () => {
  const invoicesOnly = employee([['VIEW_INVOICES', 'A']]);
  assert.ok(ids(invoicesOnly).includes('awaitingInvoice'));
  assert.ok(!ids(invoicesOnly).includes('paidInvoices'));
  assert.ok(
    ids(
      employee([
        ['VIEW_INVOICES', 'A'],
        ['VIEW_REVENUE', 'A'],
      ]),
    ).includes('paidInvoices'),
  );
  assert.ok(!ids(employee([['VIEW_REVENUE', 'A']])).includes('paidInvoices'));
});

test('employees without attendance duty do not get the attendance widget; the Owner has no personal ones', () => {
  const exempt = { ...employee(), attendanceRequired: false };
  assert.ok(!ids(exempt).includes('myAttendance'));
  assert.ok(ids(exempt).includes('myLeave'));
  assert.ok(!ids(owner).includes('myLeave'));
});

test('branch widgets follow the selected branch; the selector lists branches with any usable widget', () => {
  const account = employee([
    ['VIEW_BOOKINGS', 'A'],
    ['VIEW_INVOICES', 'B'],
    ['VIEW_REVENUE', 'B'],
  ]);
  const paid = WIDGETS.find((widget) => widget.id === 'paidInvoices')!;
  const today = WIDGETS.find((widget) => widget.id === 'todayBookings')!;
  assert.equal(allowedAtBranch(account, paid, 'B'), true);
  assert.equal(allowedAtBranch(account, paid, 'A'), false);
  assert.equal(allowedAtBranch(account, today, 'A'), true);
  assert.equal(allowedAtBranch(account, today, 'B'), false);
  assert.deepEqual(widgetBranchIds(account, ['A', 'B', 'C']), ['A', 'B']);
});

test('no saved layout resolves to the defaults; a saved one applies order, hiding and sizes', () => {
  const available = availableWidgets(owner);
  const fresh = resolveLayout(available, null);
  assert.deepEqual(
    fresh.visible.map((placed) => placed.meta.id),
    available.map((widget) => widget.id),
  );
  assert.equal(fresh.hidden.length, 0);
  assert.equal(fresh.visible.find((placed) => placed.meta.id === 'paidInvoices')!.size, 'xl');

  const saved = parseLayout(
    JSON.stringify({
      version: 1,
      order: ['quickLinks', 'todayBookings'],
      hidden: ['inService'],
      sizes: { todayBookings: 'xl', waiting: 'xl', quickLinks: 'bogus' },
    }),
  )!;
  const resolved = resolveLayout(available, saved);
  const order = resolved.visible.map((placed) => placed.meta.id);
  assert.deepEqual(order.slice(0, 2), ['quickLinks', 'todayBookings']);
  assert.deepEqual(
    resolved.hidden.map((meta) => meta.id),
    ['inService'],
  );
  assert.equal(resolved.visible.find((p) => p.meta.id === 'todayBookings')!.size, 'xl');
  // 'xl' is not offered for `waiting`, and 'bogus' was dropped while parsing: both fall back.
  assert.equal(resolved.visible.find((p) => p.meta.id === 'waiting')!.size, 's');
  assert.equal(resolved.visible.find((p) => p.meta.id === 'quickLinks')!.size, 'm');
});

test('unknown ids are ignored; new widgets append to the end; unavailable ones are skipped', () => {
  const saved = parseLayout(
    JSON.stringify({
      version: 1,
      order: ['removedWidget', 'notifications', 'myLeave'],
      hidden: ['alsoRemoved'],
      sizes: {},
    }),
  )!;
  // A plain employee: `myLeave` exists, `todayBookings` does not, and `myAttendance`/`quickLinks` are new here.
  const resolved = resolveLayout(availableWidgets(employee()), saved);
  assert.deepEqual(
    resolved.visible.map((placed) => placed.meta.id),
    ['notifications', 'myLeave', 'myAttendance', 'quickLinks'],
  );
  assert.equal(resolved.hidden.length, 0);
});

test('a saved layout with widgets the account lost does not break; they return in place when permitted again', () => {
  const manager = employee([['VIEW_BOOKINGS', 'A']]);
  const custom = reorderVisible(resolveLayout(availableWidgets(manager), null), [
    'quickLinks',
    'waiting',
    'todayBookings',
    'inService',
    'myAttendance',
    'myLeave',
    'notifications',
  ]);
  const saved = toSaved(custom);
  const demoted = resolveLayout(availableWidgets(employee()), saved);
  assert.deepEqual(
    demoted.visible.map((placed) => placed.meta.id),
    ['quickLinks', 'myAttendance', 'myLeave', 'notifications'],
  );
  const restored = resolveLayout(availableWidgets(manager), saved);
  assert.deepEqual(
    restored.visible.map((placed) => placed.meta.id),
    [
      'quickLinks',
      'waiting',
      'todayBookings',
      'inService',
      'myAttendance',
      'myLeave',
      'notifications',
    ],
  );
});

test('edits: reorder never drops a widget; hide, restore at the end, resize only to offered sizes', () => {
  let layout = resolveLayout(availableWidgets(employee()), null);
  layout = reorderVisible(layout, ['quickLinks', 'notifications']);
  assert.deepEqual(
    layout.visible.map((p) => p.meta.id),
    ['quickLinks', 'notifications', 'myAttendance', 'myLeave'],
  );
  layout = hideWidget(layout, 'notifications');
  assert.deepEqual(
    layout.hidden.map((m) => m.id),
    ['notifications'],
  );
  assert.equal(
    layout.visible.some((p) => p.meta.id === 'notifications'),
    false,
  );
  layout = resizeWidget(layout, 'myLeave', 's');
  assert.equal(layout.visible.find((p) => p.meta.id === 'myLeave')!.size, 's');
  layout = resizeWidget(layout, 'myLeave', 'xl');
  assert.equal(layout.visible.find((p) => p.meta.id === 'myLeave')!.size, 's', 'xl is not offered');
  layout = showWidget(layout, 'notifications');
  assert.equal(layout.visible.at(-1)!.meta.id, 'notifications');
  assert.equal(layout.hidden.length, 0);
  assert.equal(
    hideWidget(layout, 'todayBookings'),
    layout,
    'hiding a widget that is not there is a no-op',
  );
});

test('persistence round trip through storage, per account', () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  const available = availableWidgets(owner);
  let layout = resolveLayout(available, null);
  layout = hideWidget(reorderVisible(layout, ['quickLinks', 'notifications']), 'waiting');
  layout = resizeWidget(layout, 'todayBookings', 'xl');
  writeLayout(storage, 'owner-1', toSaved(layout));
  assert.ok(store.has(layoutKey('owner-1')));
  assert.equal(layoutKey('owner-1'), 'ls-dashboard:owner-1');
  assert.equal(readLayout(storage, 'other'), null, 'another account has its own layout');

  const again = resolveLayout(available, readLayout(storage, 'owner-1'));
  assert.deepEqual(
    again.visible.map((p) => [p.meta.id, p.size]),
    layout.visible.map((p) => [p.meta.id, p.size]),
  );
  assert.deepEqual(
    again.hidden.map((m) => m.id),
    ['waiting'],
  );

  // Reset to default removes the stored layout.
  writeLayout(storage, 'owner-1', null);
  assert.equal(readLayout(storage, 'owner-1'), null);
});

test('corrupt or blocked storage falls back to the defaults', () => {
  for (const raw of [
    '{',
    'null',
    '[]',
    '{"version":2,"order":[],"hidden":[]}',
    '{"version":1,"order":[1],"hidden":[]}',
  ]) {
    assert.equal(parseLayout(raw), null, raw);
  }
  const blocked = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
    removeItem: () => {
      throw new Error('denied');
    },
  };
  assert.equal(readLayout(blocked, 'x'), null);
  assert.doesNotThrow(() => writeLayout(blocked, 'x', null));
  assert.equal(readLayout(null, 'x'), null);
});
