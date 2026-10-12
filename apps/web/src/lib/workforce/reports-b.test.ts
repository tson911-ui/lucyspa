import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bpToPercent,
  durationText,
  normalizeReportPage,
  percentFromBp,
  pickName,
  REPORT_PAGE_DEFAULTS,
  SALES_TABS,
} from './reports-b';

test('the page state: bad dates, an unknown tab, grouping, window or page fall back to the defaults', () => {
  const ok = normalizeReportPage(
    {
      ...REPORT_PAGE_DEFAULTS,
      from: '2026-10-01',
      to: '2026-10-12',
      tab: 'products',
      by: 'brand',
      days: '90',
      page: 3,
    },
    SALES_TABS,
  );
  assert.deepEqual(
    [ok.from, ok.to, ok.tab, ok.by, ok.days, ok.page],
    ['2026-10-01', '2026-10-12', 'products', 'brand', '90', 3],
  );
  const bad = normalizeReportPage(
    {
      ...REPORT_PAGE_DEFAULTS,
      from: '12/10/2026',
      to: '2026-10-12',
      tab: 'nope',
      by: 'colour' as never,
      days: '7' as never,
      bucket: 'hour' as never,
      page: -2,
    },
    SALES_TABS,
  );
  assert.deepEqual(
    [bad.from, bad.to, bad.tab, bad.by, bad.days, bad.bucket, bad.page],
    ['', '', '', 'variant', '60', '', 1],
  );
  // A range that runs backwards is dropped as a whole, never half kept.
  const backwards = normalizeReportPage(
    { ...REPORT_PAGE_DEFAULTS, from: '2026-10-12', to: '2026-10-01' },
    SALES_TABS,
  );
  assert.deepEqual([backwards.from, backwards.to], ['', '']);
});

test("basis points read as percents in the person's language", () => {
  assert.equal(percentFromBp(6571, 'vi'), '65,7%');
  assert.equal(percentFromBp(6571, 'en'), '65.7%');
  assert.equal(percentFromBp(5000, 'vi'), '50%');
  assert.equal(bpToPercent(2500), 25);
});

test('minutes read as hours and minutes', () => {
  assert.equal(durationText(450, 'vi'), '7 giờ 30 phút');
  assert.equal(durationText(45, 'vi'), '45 phút');
  assert.equal(durationText(120, 'vi'), '2 giờ');
  assert.equal(durationText(450, 'en'), '7 h 30 min');
  assert.equal(durationText(-5, 'vi'), '0 phút');
});

test('a name falls back to the other language when empty', () => {
  assert.equal(pickName('vi', 'Kem', 'Cream'), 'Kem');
  assert.equal(pickName('en', 'Kem', 'Cream'), 'Cream');
  assert.equal(pickName('en', 'Kem', ''), 'Kem');
  assert.equal(pickName('vi', '', 'Cream'), 'Cream');
});
