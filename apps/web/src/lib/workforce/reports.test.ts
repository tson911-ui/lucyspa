import type { RevenueReport } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reportsDictionary } from '../../i18n/reports';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { ApiError } from './api';
import {
  exportRequest,
  isEmptyRevenue,
  normalizeRefundPage,
  normalizeRevenuePage,
  REVENUE_PAGE_DEFAULTS,
  revenueRange,
  revenueSeries,
  reportErrorMessage,
  sideSlices,
  vnd,
  vndNumber,
} from './reports';

const w = reportsDictionary('vi');
const t = getWorkforceDictionary('vi');

test('the address is cleaned: unknown tab, bucket and comparison fall back; a backwards range is dropped', () => {
  assert.deepEqual(normalizeRevenuePage(REVENUE_PAGE_DEFAULTS), REVENUE_PAGE_DEFAULTS);
  const dirty = normalizeRevenuePage({
    from: '2026-10-12',
    to: '2026-10-01',
    branch: 'a',
    compare: 'year' as never,
    bucket: 'hour' as never,
    tab: 'bogus' as never,
  });
  assert.deepEqual(dirty, { ...REVENUE_PAGE_DEFAULTS, branch: 'a' });
  const good = normalizeRevenuePage({
    ...REVENUE_PAGE_DEFAULTS,
    from: '2026-10-01',
    to: '2026-10-12',
    compare: 'previous',
    bucket: 'week',
    tab: 'method',
  });
  assert.equal(good.compare, 'previous');
  assert.equal(good.bucket, 'week');
  assert.equal(good.tab, 'method');
  assert.deepEqual(normalizeRefundPage({ from: 'x', to: '2026-10-01', branch: '', page: -3 }), {
    from: '',
    to: '',
    branch: '',
    page: 1,
  });
});

test('the default period is the last 30 days ending today; an address with both dates wins', () => {
  assert.deepEqual(revenueRange({ from: '', to: '' }, '2026-10-12'), {
    from: '2026-09-13',
    to: '2026-10-12',
  });
  assert.deepEqual(revenueRange({ from: '2026-10-01', to: '2026-10-05' }, '2026-10-12'), {
    from: '2026-10-01',
    to: '2026-10-05',
  });
});

test('money: grouped dong, a minus sign kept in front, strings turned into numbers only for charts', () => {
  assert.equal(vnd('1250000', 'vi'), '1.250.000 ₫');
  assert.equal(vnd('-50000', 'vi'), '-50.000 ₫');
  assert.equal(vnd('1250000', 'en'), '1,250,000 ₫');
  assert.equal(vndNumber('1250000'), 1250000);
  assert.equal(vndNumber('-5'), -5);
  assert.equal(vndNumber('12.5'), 0);
});

const point = (start: string, net: string) => ({
  start,
  netVnd: net,
  collectedVnd: net,
  refundsVnd: '0',
  exchangesVnd: '0',
  shippingVnd: '0',
});

const report = (patch: Partial<RevenueReport> = {}): RevenueReport =>
  ({
    series: [point('2026-10-11', '100'), point('2026-10-12', '200')],
    previousSeries: null,
    totals: point('x', '300'),
    bySide: [
      { key: 'SPA', netVnd: '200', shareBp: 6667 },
      { key: 'BEAUTY', netVnd: '100', shareBp: 3333 },
      { key: 'UNCLASSIFIED', netVnd: '0', shareBp: 0 },
    ],
    ...patch,
  }) as RevenueReport;

test('the chart: this period, and the one before aligned by position when asked for', () => {
  const alone = revenueSeries(report(), w);
  assert.equal(alone.current[0]?.points.length, 2);
  assert.equal(alone.previous, undefined);
  assert.deepEqual(alone.current[0]?.points[1], { x: '2026-10-12', y: 200 });
  const compared = revenueSeries(
    report({
      previousSeries: [point('2026-10-09', '50'), point('2026-10-10', '60'), point('x', '9')],
    }),
    w,
  );
  assert.equal(compared.previous?.[0]?.points.length, 2, 'never longer than this period');
  assert.equal(compared.previous?.[0]?.label, w.revenue.chart.previous);
});

test('the donut shows only the groups above zero; an empty period is recognised', () => {
  assert.deepEqual(
    sideSlices(report(), w).map((slice) => [slice.id, slice.value]),
    [
      ['SPA', 200],
      ['BEAUTY', 100],
    ],
  );
  const zero = point('x', '0');
  assert.equal(isEmptyRevenue(report({ totals: zero })), true);
  assert.equal(isEmptyRevenue(report({ totals: { ...zero, refundsVnd: '5' } })), false);
});

test('the export request carries the filters on screen, the branch only when chosen, and the language', () => {
  assert.deepEqual(
    exportRequest(
      'revenue-by-branch',
      'csv',
      { range: { from: '2026-10-01', to: '2026-10-12' }, branch: '', compare: 'none', bucket: '' },
      'vi',
    ),
    {
      report: 'revenue-by-branch',
      format: 'csv',
      from: '2026-10-01',
      to: '2026-10-12',
      locale: 'vi',
    },
  );
  assert.deepEqual(
    exportRequest(
      'revenue-overview',
      'xlsx',
      {
        range: { from: '2026-10-01', to: '2026-10-12' },
        branch: 'b1',
        compare: 'previous',
        bucket: 'week',
      },
      'en',
    ),
    {
      report: 'revenue-overview',
      format: 'xlsx',
      from: '2026-10-01',
      to: '2026-10-12',
      branchId: 'b1',
      compare: 'previous',
      bucket: 'week',
      locale: 'en',
    },
  );
});

test('errors: the report words for its own codes, the common words for the rest', () => {
  assert.equal(
    reportErrorMessage(new ApiError(503, 'REPORT_TIMEOUT'), w, t),
    w.errors['REPORT_TIMEOUT'],
  );
  assert.equal(reportErrorMessage(new ApiError(429, 'EXPORT_BUSY'), w, t), w.errors['EXPORT_BUSY']);
  assert.notEqual(reportErrorMessage(new ApiError(500, 'SOMETHING'), w, t), '');
});
