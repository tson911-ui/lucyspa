import type { PosBoardResponse } from '@lucy-spa/contracts';
import {
  addDays,
  comparisonRange,
  rangeDays,
  type ComparisonMode,
  type DateRange,
  type Series,
} from '@lucy-spa/ui';

// "Paid invoices" widget data (docs/UXUI_REDESIGN_DESIGN.md 14.3, Q-D5). It only re-reads what the POS board
// already returns: the sum of PAID invoice totals per branch business date over the board's window. It is
// labelled "Paid invoices", not "Revenue", and is not a security boundary (contract 14.3).

/** `take` of the invoices query in the API (`posBoard`): a window with this many rows may be cut off. */
export const BOARD_INVOICE_LIMIT = 200;

/** `take` of the "awaiting an invoice" query in the API: a full page means there may be more. */
export const AWAITING_LIMIT = 100;

export const boardWindow = (board: PosBoardResponse): DateRange => ({
  from: board.windowStart,
  to: board.date,
});

/** Every business date of a range, first to last. */
export function datesOf(range: DateRange): string[] {
  return Array.from({ length: rangeDays(range) }, (_, index) => addDays(range.from, index));
}

/** Sum of PAID invoice totals per date (integer VND), one number for each of `dates`. */
export function paidTotals(board: PosBoardResponse, dates: readonly string[]): number[] {
  const sums = new Map<string, bigint>();
  for (const invoice of board.invoices) {
    if (invoice.status !== 'PAID') continue;
    sums.set(
      invoice.businessDate,
      (sums.get(invoice.businessDate) ?? 0n) + BigInt(invoice.totalVnd),
    );
  }
  return dates.map((date) => Number(sums.get(date) ?? 0n));
}

/** The board may hold more invoices than one response carries, so its sums can be too low. */
export const mayBeIncomplete = (board: PosBoardResponse): boolean =>
  board.invoices.length >= BOARD_INVOICE_LIMIT;

export interface PreviousWindow {
  /** The `date` to request from the board: the last day of the previous range. */
  date: string;
  /** The days that response must cover, first to last: exactly as many as the current window. */
  dates: string[];
}

/**
 * The comparison window for the current board: `null` without a comparison, otherwise the shifted range
 * (kit `comparisonRange`) restated as exactly `rangeDays(current)` days from its first day. The board
 * always returns a window as long as the current one, so requesting `dates.at(-1)` covers `dates` and
 * the two series line up by index. (A "same period last year" range that crosses 29 February is a day
 * longer or shorter in calendar terms; this keeps the lengths equal, which the chart requires.)
 */
export function previousWindow(
  current: PosBoardResponse,
  mode: ComparisonMode,
): PreviousWindow | null {
  const currentRange = boardWindow(current);
  const shifted = comparisonRange(currentRange, mode);
  if (!shifted) return null;
  const days = rangeDays(currentRange);
  const dates = Array.from({ length: days }, (_, index) => addDays(shifted.from, index));
  return { date: dates[days - 1]!, dates };
}

/** Refuses a comparison board that does not cover exactly the requested days. */
export function assertPreviousMatches(board: PosBoardResponse, window: PreviousWindow): void {
  const covered = datesOf(boardWindow(board));
  if (covered.length !== window.dates.length || covered[0] !== window.dates[0]) {
    throw new RangeError('The comparison window does not match the requested days.');
  }
}

/**
 * Fetches the comparison board: one request for `window.date`, checked to cover exactly the days of the
 * window (so exactly as many previous days as current days, whatever the mode).
 */
export async function loadPreviousBoard(
  get: (date: string) => Promise<PosBoardResponse>,
  window: PreviousWindow,
): Promise<PosBoardResponse> {
  const board = await get(window.date);
  assertPreviousMatches(board, window);
  return board;
}

export interface PaidLabels {
  current: string;
  previous: string;
}

export interface PaidChartData {
  dates: string[];
  totals: number[];
  previousTotals: number[] | null;
  series: { current: Series[]; previous?: Series[] };
}

/**
 * The chart's data. `previous` is the board of `previousWindow(...)`; both series always have the same
 * number of points.
 */
export function paidChartData(
  current: PosBoardResponse,
  previous: PosBoardResponse | null,
  window: PreviousWindow | null,
  labels: PaidLabels,
): PaidChartData {
  const dates = datesOf(boardWindow(current));
  const totals = paidTotals(current, dates);
  let previousTotals: number[] | null = null;
  if (previous && window) {
    assertPreviousMatches(previous, window);
    previousTotals = paidTotals(previous, window.dates);
  }
  const series: Series[] = [
    { id: 'paid', label: labels.current, points: dates.map((x, i) => ({ x, y: totals[i]! })) },
  ];
  const result: PaidChartData['series'] = { current: series };
  if (previousTotals && window) {
    result.previous = [
      {
        id: 'paid',
        label: labels.previous,
        points: window.dates.map((x, i) => ({ x, y: previousTotals![i]! })),
      },
    ];
  }
  return { dates, totals, previousTotals, series: result };
}

/** Today (the last day of the window) against the day before, for the headline number. */
export function todayVersusYesterday(totals: readonly number[]): {
  today: number;
  yesterday: number | null;
} {
  return { today: totals.at(-1) ?? 0, yesterday: totals.length >= 2 ? totals.at(-2)! : null };
}
