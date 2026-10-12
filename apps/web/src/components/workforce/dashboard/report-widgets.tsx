'use client';

import type {
  ExpiryReport,
  LowStockReport,
  OnlineOrderReport,
  RefundReport,
} from '@lucy-spa/contracts';
import { Stat, addDays } from '@lucy-spa/ui';
import { useMemo } from 'react';
import { reportsBDictionary } from '../../../i18n/reports-b';
import { fill } from '../../../i18n/workforce';
import type { WidgetProps } from '../../../lib/workforce/dashboard/widgets';
import { formatVnd, todayIn } from '../../../lib/workforce/format';
import { REPORT_ZONE, vndNumber } from '../../../lib/workforce/reports';
import { useWorkforce } from '../session';
import { useShared } from './data';
import { WidgetFrame } from './widget-frame';

/**
 * Three small widgets of the report area (Phase 8 P8-10), each one answer of the very report the link opens, so the numbers never differ:
 * stock that needs attention, refunds given today, and online orders waiting for delivery. Each is a count or an amount with one line of
 * context, for every branch the person may read; the API decides every permission again.
 */
const EXPIRY_WINDOW_DAYS = '30';

export function StockAlertsWidget({ size, title }: WidgetProps) {
  const { api, locale } = useWorkforce();
  const d = reportsBDictionary(locale).widgets;
  const resource = useShared('reports:stock-alerts', async (passive) => {
    const [low, expiry] = await Promise.all([
      api.get<LowStockReport>('/api/v1/reports/stock/low', {}, { passive }),
      api.get<ExpiryReport>(
        '/api/v1/reports/stock/expiry',
        { days: EXPIRY_WINDOW_DAYS },
        { passive },
      ),
    ]);
    return { low: low.rows.length, expiring: expiry.rows.length };
  });
  const format = { valueFormat: 'count', locale } as const;
  return (
    <WidgetFrame
      title={title}
      size={size}
      resource={resource}
      info={d.stockInfo}
      isEmpty={(data) => data.low === 0 && data.expiring === 0}
      emptyText={d.stockEmpty}
      link={{ path: '/reports/stock', label: d.openStock }}
    >
      {(data) => (
        <>
          <Stat label={d.low} value={data.low} format={format} />
          <Stat label={d.expiring} value={data.expiring} format={format} />
        </>
      )}
    </WidgetFrame>
  );
}

export function RefundsTodayWidget({ size, title }: WidgetProps) {
  const { api, locale } = useWorkforce();
  const d = reportsBDictionary(locale).widgets;
  const today = useMemo(() => todayIn(REPORT_ZONE), []);
  const resource = useShared(`reports:refunds:${today}`, (passive) =>
    api.get<RefundReport>('/api/v1/reports/refunds', { from: today, to: today }, { passive }),
  );
  return (
    <WidgetFrame
      title={title}
      size={size}
      resource={resource}
      info={d.refundsInfo}
      isEmpty={(data) => data.total === 0}
      emptyText={d.refundsEmpty}
      link={{ path: '/reports/refunds', label: d.openRefunds }}
    >
      {(data) => (
        <Stat
          label={d.refundsAmount}
          value={vndNumber(data.totals.refundsVnd) + vndNumber(data.totals.exchangesVnd)}
          format={{ valueFormat: 'vnd', locale }}
          note={[
            fill(d.refundsNote, { count: String(data.total) }),
            ...(data.totals.paymentAnomalies > 0
              ? [fill(d.refundsAnomalies, { count: String(data.totals.paymentAnomalies) })]
              : []),
          ].join(' · ')}
        />
      )}
    </WidgetFrame>
  );
}

export function OnlineOrdersWidget({ size, title }: WidgetProps) {
  const { api, locale } = useWorkforce();
  const d = reportsBDictionary(locale).widgets;
  const today = useMemo(() => todayIn(REPORT_ZONE), []);
  const resource = useShared(`reports:online:${today}`, (passive) =>
    api.get<OnlineOrderReport>(
      '/api/v1/reports/online-orders',
      { from: addDays(today, -29), to: today },
      { passive },
    ),
  );
  return (
    <WidgetFrame
      title={title}
      size={size}
      resource={resource}
      info={d.onlineInfo}
      isEmpty={(data) => data.summary.awaitingDelivery === 0}
      emptyText={d.onlineEmpty}
      link={{ path: '/reports/sales?tab=online', label: d.openOnline }}
    >
      {(data) => (
        <Stat
          label={d.awaiting}
          value={data.summary.awaitingDelivery}
          format={{ valueFormat: 'count', locale }}
          note={fill(d.held, { amount: formatVnd(data.summary.heldVnd, locale) })}
        />
      )}
    </WidgetFrame>
  );
}
