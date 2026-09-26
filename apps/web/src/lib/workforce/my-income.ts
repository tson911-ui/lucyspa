import type { IncomePeriod, MyIncomeResponse } from '@lucy-spa/contracts';
import type { WorkforceApi } from './api';

/**
 * "Thu nhập của tôi / My Income" (follow-up Step 7). The server aggregates; the page only
 * asks for a period around an anchor date. The session decides whose income it is.
 */
export function loadMyIncome(
  api: WorkforceApi,
  period: IncomePeriod,
  date: string | null,
): Promise<MyIncomeResponse> {
  return api.get<MyIncomeResponse>('/api/v1/me/income', { period, ...(date ? { date } : {}) });
}

/** The anchor of the previous or next period (a day, 7 days, or a calendar month). */
export function shiftAnchor(date: string, period: IncomePeriod, direction: 1 | -1): string {
  const anchor = new Date(`${date}T00:00:00.000Z`);
  if (period === 'MONTH') {
    return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + direction, 1))
      .toISOString()
      .slice(0, 10);
  }
  const days = period === 'WEEK' ? 7 : 1;
  return new Date(anchor.getTime() + direction * days * 86_400_000).toISOString().slice(0, 10);
}
