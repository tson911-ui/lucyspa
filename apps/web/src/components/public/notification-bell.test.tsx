import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NotificationItem } from '@lucy-spa/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { BELL_PANEL_ITEMS, NotificationBell, panelItems } from './notification-bell';

const item = (n: number): NotificationItem => ({
  id: `n-${String(n).padStart(2, '0')}`,
  type: 'BOOKING_CREATED',
  branch: null,
  source: { type: 'Booking', id: `b-${n}`, code: `B${n}` },
  actionAt: `2026-10-${String(n).padStart(2, '0')}T03:00:00.000Z`,
  createdAt: `2026-10-${String(n).padStart(2, '0')}T03:00:00.000Z`,
  readAt: null,
  archivedAt: null,
  params: null,
});

test('the panel lists the newest notifications first and no more than it has room for', () => {
  const all = Array.from({ length: 12 }, (_, index) => item(index + 1));
  const shown = panelItems(all);
  assert.equal(shown.length, BELL_PANEL_ITEMS);
  assert.equal(shown[0]?.id, 'n-12');
  assert.equal(shown.at(-1)?.id, `n-${String(12 - BELL_PANEL_ITEMS + 1).padStart(2, '0')}`);
});

test('a visitor who is not signed in (or before the session is known) gets no bell', () => {
  assert.equal(renderToStaticMarkup(<NotificationBell locale="vi" />), '');
});
