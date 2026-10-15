import type {
  ReportRegistryResponse,
  RevenuePoint,
  RevenueReport,
  RevenueTotals,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reportsDictionary } from '../../../i18n/reports';
import { REVENUE_PAGE_DEFAULTS } from '../../../lib/workforce/reports';
import { owner, render } from '../../../test/support';
import { RevenueBody, RevenueView } from './reports-revenue';

const w = reportsDictionary('vi');

const branches = [
  { id: 'a', code: 'A', name: 'Nguyễn Quang Bích' },
  { id: 'b', code: 'B', name: 'Quận 1' },
];

const registry = (
  patch: { available?: boolean; exportable?: boolean; branchIds?: string[] } = {},
): ReportRegistryResponse => ({
  generatedAt: '2026-10-12T03:00:00.000Z',
  branches,
  reports: [
    {
      id: 'revenue-overview',
      area: 'revenue',
      wave: 'A',
      available: patch.available ?? true,
      exportable: patch.exportable ?? true,
      exportReauth: false,
      branchIds: patch.branchIds ?? ['a', 'b'],
    },
  ],
});

const totals = (patch: Partial<RevenueTotals> = {}): RevenueTotals => ({
  netVnd: '2500000',
  collectedVnd: '2900000',
  refundsVnd: '300000',
  exchangesVnd: '100000',
  shippingVnd: '0',
  ...patch,
});

const point = (start: string, net: string): RevenuePoint => ({ start, ...totals({ netVnd: net }) });

const report = (patch: Partial<RevenueReport> = {}): RevenueReport => ({
  generatedAt: '2026-10-12T03:00:00.000Z',
  period: { from: '2026-10-11', to: '2026-10-12', previous: null },
  bucket: 'day',
  branches,
  totals: totals(),
  previousTotals: null,
  series: [point('2026-10-11', '1000000'), point('2026-10-12', '1500000')],
  previousSeries: null,
  byBranch: [
    {
      branch: branches[0]!,
      netVnd: '1800000',
      collectedVnd: '2000000',
      refundsVnd: '200000',
      exchangesVnd: '0',
      paidInvoices: 12,
      visits: 9,
      previousNetVnd: null,
    },
    {
      branch: branches[1]!,
      netVnd: '700000',
      collectedVnd: '900000',
      refundsVnd: '100000',
      exchangesVnd: '100000',
      paidInvoices: 4,
      visits: 3,
      previousNetVnd: null,
    },
  ],
  bySide: [
    { key: 'SPA', netVnd: '1500000', shareBp: 6000 },
    { key: 'BEAUTY', netVnd: '1000000', shareBp: 4000 },
  ],
  byKind: [
    { key: 'SERVICE', netVnd: '1500000', shareBp: 6000 },
    { key: 'PRODUCT', netVnd: '1000000', shareBp: 4000 },
  ],
  byChannel: [
    { key: 'COUNTER', netVnd: '2500000', shareBp: 10000 },
    { key: 'ONLINE', netVnd: '0', shareBp: 0 },
  ],
  byMethod: [
    { method: 'CASH', inVnd: '1900000', outVnd: '400000', netVnd: '1500000' },
    { method: 'PAYOS', inVnd: '1000000', outVnd: '0', netVnd: '1000000' },
    { method: 'TRANSFER', inVnd: '0', outVnd: '0', netVnd: '0' },
  ],
  paidInvoices: { count: 16, totalVnd: '3200000', averageVnd: '200000' },
  visits: 12,
  onlineHeldVnd: '450000',
  unclassifiedVnd: '0',
  ...patch,
});

const buttons = (html: string, cls: string) =>
  html.match(new RegExp(`ls-btn-${cls}`, 'g'))?.length ?? 0;

const body = (data: RevenueReport) =>
  render(
    <RevenueBody data={data} w={w} state={REVENUE_PAGE_DEFAULTS} update={() => undefined} />,
    owner,
  );

test('the revenue page: one h1, one primary action "Xuất file" only for a person who may export, the toolbar named', () => {
  const html = render(<RevenueView registry={registry()} />, owner);
  assert.match(html, /<h1[^>]*>Doanh thu<\/h1>/);
  assert.equal(buttons(html, 'primary'), 1);
  assert.match(html, new RegExp(w.common.export));
  assert.match(html, /role="search"/);
  assert.match(html, /ls-no-print/);
  const readOnly = render(<RevenueView registry={registry({ exportable: false })} />, owner);
  assert.equal(buttons(readOnly, 'primary'), 0);
  assert.match(readOnly, /<h1[^>]*>Doanh thu<\/h1>/);
});

test('a person who may read no branch gets the explanation, not an empty chart', () => {
  const none = render(
    <RevenueView registry={registry({ available: false, branchIds: [] })} />,
    owner,
  );
  assert.match(none, new RegExp(w.revenue.emptyBranches));
  assert.doesNotMatch(none, /ls-kpi/);
});

test('the figures: the headline, collected, given back (refunds + exchanges), invoices, visits and what is held', () => {
  const html = body(report());
  assert.match(html, new RegExp(`>${w.revenue.kpi.net}<`));
  assert.match(html, /2\.500\.000/);
  assert.match(html, /2\.900\.000/);
  assert.match(html, /400\.000/); // 300,000 refunds + 100,000 exchanges
  assert.match(html, new RegExp(w.revenue.kpi.paidInvoices));
  assert.match(html, /Trung bình 200\.000\u00a0₫ một hóa đơn/);
  assert.match(html, new RegExp(w.revenue.kpi.held));
  assert.match(html, /450\.000/);
  assert.match(html, new RegExp(w.revenue.kpi.visits));
  // The definition of revenue is on the page, and a heading carries no number or symbol.
  assert.match(html, new RegExp(w.revenue.definitionTitle));
  assert.doesNotMatch(html, /<h[1-3][^>]*>[^<]*[0-9][^<]*<\/h[1-3]>/);
});

test('the three tabs are there and the branch table is the first', () => {
  const html = body(report());
  for (const label of [w.revenue.tabs.branch, w.revenue.tabs.kind, w.revenue.tabs.method]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /Nguyễn Quang Bích/);
  assert.match(html, /Quận 1/);
  assert.match(html, /1\.800\.000/);
});

test('comparison: the change against the previous period is shown with words, not colour alone', () => {
  const html = body(report({ previousTotals: totals({ netVnd: '2000000' }) }));
  assert.ok(html.includes('+25,0% tăng'));
  assert.match(html, new RegExp(w.common.vsPrevious));
});

test('money that could not be placed in Spa or Cosmetics is shown, never hidden', () => {
  const quiet = body(report());
  assert.doesNotMatch(quiet, /Có .* chưa biết thuộc nhóm/);
  const loud = body(report({ unclassifiedVnd: '200000' }));
  assert.match(loud, /Có 200\.000\u00a0₫ chưa biết thuộc nhóm Spa hay Mỹ phẩm/);
});

test('a period with no money shows the empty message instead of a flat chart', () => {
  const empty = body(
    report({
      totals: totals({ netVnd: '0', collectedVnd: '0', refundsVnd: '0', exchangesVnd: '0' }),
      series: [point('2026-10-12', '0')],
    }),
  );
  assert.match(empty, new RegExp(w.revenue.empty));
});

test('English: the same page in English', () => {
  const html = render(<RevenueView registry={registry()} />, owner, 'en');
  assert.match(html, /<h1[^>]*>Revenue<\/h1>/);
  assert.match(html, /Export/);
});
