import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getWorkforceDictionary } from '../../../i18n/workforce';
import { availableWidgets, WIDGETS } from '../../../lib/workforce/dashboard/widgets';
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
  assert.doesNotMatch(manager, new RegExp(vi.dashboard.widgets.paidInvoices));

  const ownerHtml = render(<DashboardScreen />, owner);
  assert.deepEqual(
    titles(ownerHtml, vi),
    availableWidgets(owner).map((widget) => widget.id),
  );
  assert.match(ownerHtml, new RegExp(vi.dashboard.ownerNote));
});

test('a branch widget without a resolved branch says so instead of staying blank; the grid has an accessible name', () => {
  const html = render(<DashboardScreen />, owner);
  assert.match(html, new RegExp(vi.dashboard.noBranchWidgets));
  assert.match(html, new RegExp(`aria-label="${vi.dashboard.gridLabel}"`));
  assert.match(html, /ls-sortable-bare ls-widget-grid/);
});

test('size classes come from the layout: the paid invoices widget is wide by default', () => {
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

test('widget titles are one clamped line with the full text as title, so a long title never shifts the value row', () => {
  const html = render(<DashboardScreen />, owner);
  const headings = [
    ...html.matchAll(/<h2 class="ls-card-title ls-card-title-clamp"([^>]*)>([^<]*)<\/h2>/g),
  ];
  assert.ok(headings.length >= 4, 'every widget heading is clamped');
  for (const [, attributes, text] of headings) {
    assert.ok(attributes!.includes(`title="${text}"`), `title carries "${text}"`);
  }
  assert.match(html, /ls-card-header ls-card-header-clamp/);
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
