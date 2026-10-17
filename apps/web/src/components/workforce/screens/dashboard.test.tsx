import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getWorkforceDictionary } from '../../../i18n/workforce';
import { availableWidgets, WIDGETS } from '../../../lib/workforce/dashboard/widgets';
import { navigationFor } from '../../../lib/workforce/permissions';
import { shortcutsFor } from '../dashboard/personal-widgets';
import { WidgetHost } from '../dashboard/widget-host';
import { employee, owner, render } from '../../../test/support';
import { DashboardScreen } from './dashboard';

const vi = getWorkforceDictionary('vi');
const en = getWorkforceDictionary('en');

// The markup escapes apostrophes ("Today's bookings").
const escaped = (text: string) => text.replace(/'/g, '&#x27;');
const titles = (html: string, t: typeof vi) =>
  WIDGETS.filter((widget) => html.includes(`>${escaped(t.dashboard.widgets[widget.id])}</h2>`)).map(
    (widget) => widget.id,
  );

test('first paint: greeting, the customize toggle, and only the widgets the account may see', () => {
  const html = render(<DashboardScreen />, employee());
  assert.match(html, /Xin chào, Lan/);
  assert.match(html, new RegExp(`aria-pressed="false"[^>]*>(?:<[^>]+>)*${vi.dashboard.customize}`));
  assert.deepEqual(titles(html, vi), ['myAttendance', 'myLeave', 'notifications', 'quickLinks']);
  // Outside customize mode nothing can be dragged.
  assert.doesNotMatch(html, /ls-sortable-handle/);
});

test('widgets follow permissions; the Owner sees management widgets but no personal ones', () => {
  const manager = render(
    <DashboardScreen />,
    employee([['VIEW_BOOKINGS', 'A'], ['APPROVE_LEAVE']]),
  );
  assert.deepEqual(titles(manager, vi), [
    'todayBookings',
    'inService',
    'waiting',
    'pendingLeave',
    'myAttendance',
    'myLeave',
    'notifications',
    'quickLinks',
  ]);
  assert.doesNotMatch(manager, new RegExp(vi.dashboard.widgets.revenue));

  const ownerHtml = render(<DashboardScreen />, owner);
  assert.deepEqual(
    titles(ownerHtml, vi),
    availableWidgets(owner).map((widget) => widget.id),
  );
  assert.match(ownerHtml, new RegExp(vi.dashboard.ownerNote));
});

test('a branch widget without a resolved branch says so instead of staying blank; the grid has an accessible name', () => {
  // First paint: the branch list is still loading, so a branch widget shows its loading state, never the "no branch" message
  // that would flash before the branch arrives (rbp rerender-derived-state).
  const html = render(<DashboardScreen />, owner);
  assert.doesNotMatch(html, new RegExp(vi.dashboard.noBranchWidgets));
  assert.match(html, new RegExp(vi.dashboard.widgetLoading));
  assert.match(html, new RegExp(`aria-label="${vi.dashboard.gridLabel}"`));
  assert.match(html, /ls-sortable-bare ls-widget-grid/);
  // Once the list has answered without a branch, the widget says so.
  const meta = WIDGETS.find((widget) => widget.scope === 'branch')!;
  const resolved = render(<WidgetHost placed={{ meta, size: 'm' }} branchId={null} />, owner);
  assert.match(resolved, new RegExp(vi.dashboard.noBranchWidgets));
});

test('size classes come from the layout: the revenue widget is wide by default', () => {
  const html = render(
    <DashboardScreen />,
    employee([
      ['VIEW_INVOICES', 'A'],
      ['VIEW_REVENUE', 'A'],
    ]),
  );
  assert.match(html, /ls-sortable-item ls-widget-xl/);
  assert.match(html, /ls-sortable-item ls-widget-s/);
});

test('widget titles wrap in full: no clamp and no tooltip copy of the title (Owner answer 7)', () => {
  const html = render(<DashboardScreen />, owner);
  const headings = [...html.matchAll(/<h2 class="ls-card-title"([^>]*)>([^<]*)<\/h2>/g)];
  assert.ok(headings.length >= 4, 'every widget has a plain heading');
  for (const [, attributes] of headings) assert.ok(!attributes!.includes('title='));
  assert.doesNotMatch(html, /ls-card-title-clamp|ls-card-header-clamp/);
});

test('"Lối tắt" lists the everyday tasks the account may open, most used first, at most eight (Owner answer 5)', () => {
  const keys = (account: Parameters<typeof navigationFor>[0]) =>
    shortcutsFor(navigationFor(account)).map((item) => item.key);
  const mine = keys(employee());
  // Only pages the sidebar offers; never the dashboard itself.
  const offered = new Set(navigationFor(employee()).map((item) => item.key));
  assert.ok(mine.length > 0 && mine.every((key) => offered.has(key)));
  assert.ok(!mine.includes('dashboard'));
  const ownerKeys = keys(owner);
  assert.ok(ownerKeys.length <= 8);
  assert.equal(ownerKeys[0], 'pos');
  assert.ok(!keys(employee()).includes('pos'));
});

test('the Owner note is a notice, not loose text, and the layout button says what it does', () => {
  const html = render(<DashboardScreen />, owner);
  assert.match(html, /class="ls-notice ls-notice-info"[\s\S]*Tài khoản chủ spa không có chấm công/);
  assert.equal(vi.dashboard.customize, 'Sắp xếp bố cục');
  assert.match(vi.dashboard.customizeHelp, /Kéo thẻ để sắp xếp/);
  assert.match(en.dashboard.customizeHelp, /Drag a card/);
});

test('English dictionary has every widget title and the same structure as Vietnamese', () => {
  const html = render(<DashboardScreen />, employee(), 'en');
  assert.match(html, /Hello, Lan/);
  assert.deepEqual(titles(html, en), ['myAttendance', 'myLeave', 'notifications', 'quickLinks']);
  assert.deepEqual(
    Object.keys(en.dashboard.widgets).sort(),
    Object.keys(vi.dashboard.widgets).sort(),
  );
  assert.deepEqual(
    Object.keys(en.dashboard.sortable).sort(),
    Object.keys(vi.dashboard.sortable).sort(),
  );
  for (const meta of WIDGETS) assert.ok(vi.dashboard.widgets[meta.id], meta.id);
});
