'use client';

import type {
  AdvancesReport,
  CashDifferencesReport,
  PayrollMonthlyReport,
} from '@lucy-spa/contracts';
import { Stat, addDays } from '@lucy-spa/ui';
import { useMemo } from 'react';
import { reportsCDictionary } from '../../../i18n/reports-c';
import { fill } from '../../../i18n/workforce';
import type { WidgetProps } from '../../../lib/workforce/dashboard/widgets';
import { formatVnd, todayIn } from '../../../lib/workforce/format';
import { REPORT_ZONE } from '../../../lib/workforce/reports';
import { useWorkforce } from '../session';
import { useShared } from './data';
import { WidgetFrame } from './widget-frame';

/**
 * Two money-alert widgets (Phase 8 P8-14), each one answer of the very reports their link opens: the days of the last 30 whose cash count was
 * off, and the pay runs of earlier months not paid yet with the advances still outstanding. Before the books start they say so. The API decides
 * every permission again; a person who may not read the data gets the compact "no access" card.
 */
export function CashAlertsWidget({ size, title }: WidgetProps) {
  const { api, locale } = useWorkforce();
  const d = reportsCDictionary(locale).widgets;
  const today = useMemo(() => todayIn(REPORT_ZONE), []);
  const resource = useShared(`reports:cash-alerts:${today}`, (passive) =>
    api.get<CashDifferencesReport>(
      '/api/v1/reports/cash/differences',
      { from: addDays(today, -29), to: today },
      { passive },
    ),
  );
  return (
    <WidgetFrame
      title={title}
      size={size}
      resource={resource}
      info={d.cashInfo}
      isEmpty={(data) => data.started && data.totals.days === 0}
      emptyText={d.cashEmpty}
      link={{ path: '/reports/cash?tab=differences', label: d.openCash }}
    >
      {(data) =>
        data.started ? (
          <Stat
            label={d.cashAlerts}
            value={data.totals.alerts}
            format={{ valueFormat: 'count', locale }}
            note={fill(d.cashDays, { count: data.totals.days })}
          />
        ) : (
          <p className="ls-hint">{d.cashNotStarted}</p>
        )
      }
    </WidgetFrame>
  );
}

export function PayrollAlertsWidget({ size, title }: WidgetProps) {
  const { api, locale } = useWorkforce();
  const d = reportsCDictionary(locale).widgets;
  const today = useMemo(() => todayIn(REPORT_ZONE), []);
  const month = `${today.slice(0, 7)}-01`;
  const resource = useShared(`reports:payroll-alerts:${month}`, async (passive) => {
    const [runs, advances] = await Promise.all([
      api.get<PayrollMonthlyReport>(
        '/api/v1/reports/payroll/monthly',
        { from: addDays(month, -92), to: today },
        { passive },
      ),
      api.get<AdvancesReport>('/api/v1/reports/payroll/advances', {}, { passive }),
    ]);
    return {
      started: runs.started,
      // A month before this one whose pay run is not paid yet.
      unpaid: runs.rows.filter((row) => row.month < month && row.status !== 'PAID').length,
      outstandingVnd: advances.totals.outstandingVnd,
    };
  });
  return (
    <WidgetFrame
      title={title}
      size={size}
      resource={resource}
      info={d.payInfo}
      isEmpty={(data) => data.started && data.unpaid === 0 && data.outstandingVnd === '0'}
      emptyText={d.payEmpty}
      link={{ path: '/reports/pay', label: d.openPay }}
    >
      {(data) =>
        data.started ? (
          <Stat
            label={d.payUnpaid}
            value={data.unpaid}
            format={{ valueFormat: 'count', locale }}
            note={fill(d.payOutstanding, { amount: formatVnd(data.outstandingVnd, locale) })}
          />
        ) : (
          <p className="ls-hint">{d.payNotStarted}</p>
        )
      }
    </WidgetFrame>
  );
}
