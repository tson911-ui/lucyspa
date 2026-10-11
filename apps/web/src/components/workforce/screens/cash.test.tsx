import type { CashFundItem, CashOverviewResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cashDictionary } from '../../../i18n/cash';
import { navigationFor } from '../../../lib/workforce/permissions';
import { employee, owner, render } from '../../../test/support';
import { CashView } from './cash';

const text = cashDictionary('vi');
const noop = () => Promise.resolve();

const fund = (patch: Partial<CashFundItem> = {}): CashFundItem => ({
  id: 'f1',
  kind: 'CASH',
  branch: { id: 'a', code: 'A', name: 'Nguyễn Quang Bích' },
  name: 'Quỹ tiền mặt Nguyễn Quang Bích',
  openingBalanceVnd: '1000000',
  balanceVnd: '1250000',
  lastClosedDate: '2026-10-10',
  ...patch,
});

const overview = (patch: Partial<CashOverviewResponse> = {}): CashOverviewResponse => ({
  goLive: { at: '2026-10-11T02:00:00.000Z', setBy: { id: 'owner-1', name: 'Chủ' } },
  branches: [
    {
      branch: { id: 'a', code: 'A', name: 'Nguyễn Quang Bích' },
      view: true,
      manage: true,
      deposit: true,
    },
  ],
  canGoLive: false,
  funds: [fund()],
  defaultNextFloatVnd: '1000000',
  differenceAlerts: 0,
  alertThresholdVnd: '50000',
  ...patch,
});

const view = (data: CashOverviewResponse, account = owner, locale: 'vi' | 'en' = 'vi') =>
  render(<CashView overview={data} reload={noop} />, account, locale);

const buttons = (html: string, cls: string) =>
  html.match(new RegExp(`ls-btn-${cls}`, 'g'))?.length ?? 0;

test('before the Owner starts the book: an explanation and one primary action only for the Owner', () => {
  const startable = view(overview({ goLive: null, canGoLive: true, funds: [] }));
  assert.match(startable, /<h1[^>]*>Sổ quỹ<\/h1>/);
  assert.match(startable, new RegExp(text.notLive.title));
  assert.match(startable, new RegExp(text.notLive.body.slice(0, 30)));
  assert.equal(buttons(startable, 'primary'), 1);
  assert.match(startable, new RegExp(text.notLive.start));
  const waiting = view(
    overview({ goLive: null, canGoLive: false, funds: [] }),
    employee([['VIEW_CASH', 'a']]),
  );
  assert.match(waiting, new RegExp(text.notLive.waiting));
  assert.equal(buttons(waiting, 'primary'), 0);
  assert.doesNotMatch(waiting, new RegExp(text.notLive.body.slice(0, 30)));
});

test('a live cash fund: balance, opening balance, last closed day, one primary action, the three tabs', () => {
  const html = view(overview());
  assert.match(html, /<h1[^>]*>Sổ quỹ<\/h1>/);
  assert.equal(buttons(html, 'primary'), 1);
  assert.match(html, new RegExp(text.actions.record));
  assert.match(html, /1\.250\.000 ₫/);
  assert.match(html, /1\.000\.000 ₫/);
  assert.match(html, /10\/10\/2026/);
  assert.match(html, /Quỹ tiền mặt Nguyễn Quang Bích/);
  for (const label of [text.tabs.book, text.tabs.closing, text.tabs.reconcile]) {
    assert.match(html, new RegExp(label));
  }
  // The heading of the card is text only: no count, no symbol.
  assert.doesNotMatch(html, /<h2[^>]*>[^<]*[0-9][^<]*<\/h2>/);
});

test('a person who may only read sees the fund but no primary action', () => {
  const html = view(
    overview({
      branches: [
        {
          branch: { id: 'a', code: 'A', name: 'Nguyễn Quang Bích' },
          view: true,
          manage: false,
          deposit: false,
        },
      ],
    }),
    employee([['VIEW_CASH', 'a']]),
  );
  assert.equal(buttons(html, 'primary'), 0);
  assert.doesNotMatch(html, new RegExp(text.actions.record));
  assert.match(html, /1\.250\.000 ₫/);
});

test('a collector who may only hand cash in still gets the entry action', () => {
  const html = view(
    overview({
      branches: [
        {
          branch: { id: 'a', code: 'A', name: 'Nguyễn Quang Bích' },
          view: true,
          manage: false,
          deposit: true,
        },
      ],
    }),
    employee([
      ['VIEW_CASH', 'a'],
      ['COLLECT_PAYMENTS', 'a'],
    ]),
  );
  assert.equal(buttons(html, 'primary'), 1);
  assert.match(html, new RegExp(text.actions.record));
});

test('the bank fund has no daily closing and no reconciliation tab; several funds get a selector', () => {
  const bank = fund({
    id: 'fb',
    kind: 'BANK',
    branch: null,
    name: 'Quỹ ngân hàng',
    balanceVnd: '5000000',
  });
  const html = view(overview({ funds: [bank, fund()] }));
  assert.match(html, /5\.000\.000 ₫/);
  assert.doesNotMatch(html, new RegExp(`>${text.tabs.closing}<`));
  assert.doesNotMatch(html, new RegExp(`>${text.tabs.reconcile}<`));
  assert.match(html, new RegExp(`aria-label="${text.fund.label}"`));
  assert.match(html, /Quỹ ngân hàng/);
});

test('large count differences are announced; none means no notice', () => {
  const alert = view(overview({ differenceAlerts: 2 }));
  assert.match(alert, /Chốt quỹ lệch lớn/);
  assert.match(alert, /2 lần, mỗi lần lệch từ 50\.000 ₫ trở lên/);
  assert.doesNotMatch(view(overview()), /mỗi lần lệch từ/);
});

test('the same page in English', () => {
  const html = view(overview({ differenceAlerts: 1 }), owner, 'en');
  assert.match(html, /<h1[^>]*>Cash book<\/h1>/);
  assert.match(html, /Record entry/);
  assert.match(html, /1,250,000 ₫/);
  assert.match(html, /each off by 50,000 ₫ or more/);
});

test('the menu offers the cash book to those who hold a cash permission at some branch', () => {
  const keys = (account: Parameters<typeof navigationFor>[0]) =>
    navigationFor(account).map((item) => item.key);
  assert.ok(keys(owner).includes('cash'));
  assert.ok(keys(employee([['VIEW_CASH', 'a']])).includes('cash'));
  assert.ok(keys(employee([['MANAGE_CASH', 'a']])).includes('cash'));
  assert.ok(!keys(employee([['COLLECT_PAYMENTS', 'a']])).includes('cash'));
  assert.ok(!keys(employee([])).includes('cash'));
});
