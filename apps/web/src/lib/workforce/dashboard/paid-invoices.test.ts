import type { PosBoardInvoice, PosBoardResponse } from '@lucy-spa/contracts';
import { addDays, rangeDays } from '@lucy-spa/ui';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BOARD_INVOICE_LIMIT,
  assertPreviousMatches,
  datesOf,
  boardWindow,
  loadPreviousBoard,
  mayBeIncomplete,
  paidChartData,
  paidTotals,
  previousWindow,
  todayVersusYesterday,
} from './paid-invoices';

const invoice = (
  id: string,
  businessDate: string,
  totalVnd: string,
  status: PosBoardInvoice['status'] = 'PAID',
): PosBoardInvoice => ({
  id,
  code: id,
  status,
  kind: 'VISIT',
  visitId: `v-${id}`,
  visitCode: `V-${id}`,
  comboName: null,
  payerName: null,
  totalVnd,
  businessDate,
  createdAt: `${businessDate}T05:00:00.000Z`,
});

/** A board as the API builds it: `date` and the six days before it. */
const board = (date: string, invoices: PosBoardInvoice[] = []): PosBoardResponse => ({
  branch: { id: 'b1', name: 'Q1', timezone: 'Asia/Ho_Chi_Minh' },
  date,
  windowStart: addDays(date, -6),
  awaiting: [],
  invoices,
  canManage: false,
  canSellCombos: false,
});

const labels = { current: 'Đã thanh toán', previous: 'Kỳ trước' };

test('paid totals sum only PAID invoices per business date; empty days are zero', () => {
  const current = board('2026-09-30', [
    invoice('1', '2026-09-30', '150000'),
    invoice('2', '2026-09-30', '50000'),
    invoice('3', '2026-09-30', '999000', 'CANCELLED'),
    invoice('4', '2026-09-30', '999000', 'PENDING_PAYMENT'),
    invoice('5', '2026-09-29', '70000'),
  ]);
  const dates = datesOf(boardWindow(current));
  assert.equal(dates.length, 7);
  assert.deepEqual(paidTotals(current, dates), [0, 0, 0, 0, 0, 70000, 200000]);
  assert.deepEqual(todayVersusYesterday([1, 2, 3]), { today: 3, yesterday: 2 });
  assert.deepEqual(todayVersusYesterday([5]), { today: 5, yesterday: null });
});

test('no comparison means no previous window', () => {
  assert.equal(previousWindow(board('2026-09-30'), 'none'), null);
});

test('previous period: exactly as many days as the current window, ending the day before it', () => {
  const current = board('2026-09-30');
  const window = previousWindow(current, 'previous')!;
  assert.equal(window.dates.length, rangeDays(boardWindow(current)));
  assert.equal(window.dates[0], '2026-09-17');
  assert.equal(window.date, '2026-09-23');
  assert.equal(window.dates.at(-1), window.date);
});

test('same period last year keeps the length even across a leap day', () => {
  // 27 Feb to 4 Mar 2028 (crossing 29 Feb): one year earlier the calendar range is a day shorter.
  const current = board('2028-03-04');
  assert.equal(rangeDays(boardWindow(current)), 7);
  const window = previousWindow(current, 'lastYear')!;
  assert.equal(window.dates.length, 7);
  assert.equal(window.dates[0], '2027-02-27');
  assert.equal(window.date, '2027-03-05');
});

test('the loader requests one board, for the window date, and refuses one of another length', async () => {
  const current = board('2026-09-30');
  const window = previousWindow(current, 'previous')!;
  const requested: string[] = [];
  const loaded = await loadPreviousBoard((date) => {
    requested.push(date);
    return Promise.resolve(board(date));
  }, window);
  assert.deepEqual(requested, ['2026-09-23']);
  assert.equal(datesOf(boardWindow(loaded)).length, datesOf(boardWindow(current)).length);

  const shorter: PosBoardResponse = { ...board('2026-09-23'), windowStart: '2026-09-20' };
  await assert.rejects(
    loadPreviousBoard(() => Promise.resolve(shorter), window),
    RangeError,
  );
  assert.throws(() => assertPreviousMatches(board('2026-09-24'), window), RangeError);
});

test('chart data: both series have the same number of points, aligned by index', () => {
  const current = board('2026-09-30', [invoice('1', '2026-09-30', '100000')]);
  const window = previousWindow(current, 'previous')!;
  const previous = board(window.date, [invoice('2', '2026-09-23', '40000')]);
  const data = paidChartData(current, previous, window, labels);
  assert.equal(data.series.current[0]!.points.length, 7);
  assert.equal(data.series.previous![0]!.points.length, 7);
  assert.equal(data.series.previous![0]!.points.at(-1)!.y, 40000);
  assert.equal(data.series.previous![0]!.points[0]!.x, '2026-09-17');
  assert.equal(data.series.current[0]!.points.at(-1)!.y, 100000);

  const single = paidChartData(current, null, null, labels);
  assert.equal(single.series.previous, undefined);
  assert.equal(single.previousTotals, null);
});

test('a full invoice page is flagged as possibly incomplete', () => {
  const many = Array.from({ length: BOARD_INVOICE_LIMIT }, (_, i) =>
    invoice(String(i), '2026-09-30', '1000'),
  );
  assert.equal(mayBeIncomplete(board('2026-09-30', many)), true);
  assert.equal(mayBeIncomplete(board('2026-09-30', many.slice(1))), false);
});
