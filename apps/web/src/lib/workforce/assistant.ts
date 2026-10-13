import { ASSISTANT_LIMITS, type AssistantBlock } from '@lucy-spa/contracts';

/** The report page each report id of the catalogue lives on (the assistant links to the ones its answer used). */
const ROUTE: Record<string, string> = {
  'revenue-overview': 'revenue',
  refunds: 'refunds',
  'revenue-by-service': 'sales',
  'revenue-by-product': 'sales',
  'customers-visits': 'customers',
  'bookings-funnel': 'customers',
  'cash-daily': 'cash',
  'cash-funds': 'cash',
  'labour-cost': 'pay',
  'payroll-monthly': 'pay',
  advances: 'pay',
  profit: 'profit',
  reviews: 'reviews',
};

export type ReportPage =
  'revenue' | 'refunds' | 'sales' | 'customers' | 'cash' | 'pay' | 'profit' | 'reviews';

export const reportPageOf = (reportId: string): ReportPage | null =>
  (ROUTE[reportId] as ReportPage | undefined) ?? null;

/** The distinct report pages of an answer, in the order they were used (two reports on one page give one link). */
export function reportPages(reportIds: readonly string[]): ReportPage[] {
  const pages: ReportPage[] = [];
  for (const id of reportIds) {
    const page = reportPageOf(id);
    if (page !== null && !pages.includes(page)) pages.push(page);
  }
  return pages;
}

export const reportHref = (base: string, page: ReportPage): string => `${base}/reports/${page}`;

export const QUESTION_MAX = ASSISTANT_LIMITS.questionMax;

/** The question as it will be sent: trimmed, and whether it can be sent at all. */
export function readyQuestion(value: string): { text: string; ok: boolean } {
  const text = value.trim();
  return { text, ok: text !== '' && [...text].length <= QUESTION_MAX };
}

export const blockKey = (block: AssistantBlock | null): AssistantBlock | 'OTHER' =>
  block ?? 'OTHER';

/** The code of a failed ask, as one the dictionary has a sentence for. */
export function askErrorKey(
  error: unknown,
): 'RATE_LIMITED' | 'FORBIDDEN' | 'VALIDATION_FAILED' | 'OTHER' {
  const code = Reflect.get(Object(error), 'code') as unknown;
  return code === 'RATE_LIMITED' || code === 'FORBIDDEN' || code === 'VALIDATION_FAILED'
    ? code
    : 'OTHER';
}

/** `2026-10-01` to `01/10/2026` for the line that says which dates an answer used. */
export const dayText = (day: string): string => {
  const [y, m, d] = day.split('-');
  return y && m && d ? `${d}/${m}/${y}` : day;
};
