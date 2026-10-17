'use client';

import type { RevenueReport } from '@lucy-spa/contracts';
import { LineChart, SegmentedControl, Stat, addDays, useUrlState } from '@lucy-spa/ui';
import { useMemo } from 'react';
import { reportsDictionary } from '../../../i18n/reports';
import { fill } from '../../../i18n/workforce';
import { formatVnd, todayIn } from '../../../lib/workforce/format';
import {
  isEmptyRevenue,
  REPORT_ZONE,
  revenueSeries,
  vndNumber,
} from '../../../lib/workforce/reports';
import type { WidgetProps } from '../../../lib/workforce/dashboard/widgets';
import { useWorkforce } from '../session';
import { useShared } from './data';
import { WidgetFrame } from './widget-frame';

/**
 * "Doanh thu" (Phase 8 P8-5, Owner OQ-P8-2: replaces "Hóa đơn đã thanh toán"): today against yesterday and the last seven days, for every
 * branch the person may read. It is one answer of `GET /reports/revenue`, the very figures of the report page, so the two never differ.
 * Money collected minus money given back, tips not included; the paid-invoices count stays as a second line.
 */
/** The compare choice lives in the address bar ("?cmp=previous"), so Back/Forward and a shared link keep it. */
const COMPARE_DEFAULTS = { cmp: 'none' };
const COMPARE_OPTIONS = {
  normalize: (state: typeof COMPARE_DEFAULTS) => ({
    cmp: state.cmp === 'previous' ? 'previous' : 'none',
  }),
};

export function RevenueWidget({ size, title }: WidgetProps) {
  const { api, t, locale } = useWorkforce();
  const w = reportsDictionary(locale);
  const d = w.dashboard;
  const kit = t.dashboard.kit;
  const [compare, updateCompare] = useUrlState(COMPARE_DEFAULTS, COMPARE_OPTIONS);
  const mode: 'none' | 'previous' = compare.cmp === 'previous' ? 'previous' : 'none';
  const setMode = (next: 'none' | 'previous') => updateCompare({ cmp: next });
  const today = useMemo(() => todayIn(REPORT_ZONE), []);
  const resource = useShared(`revenue:${today}:${mode}`, (passive) =>
    api.get<RevenueReport>(
      '/api/v1/reports/revenue',
      {
        from: addDays(today, -6),
        to: today,
        bucket: 'day',
        compare: mode === 'previous' ? 'previous' : undefined,
      },
      { passive },
    ),
  );
  const format = { valueFormat: 'vnd', locale } as const;
  const words = { up: kit.up, down: kit.down, flat: kit.flat };
  return (
    <WidgetFrame
      title={title}
      size={size}
      resource={resource}
      info={d.info}
      isEmpty={(report) => mode === 'none' && isEmptyRevenue(report)}
      emptyText={d.empty}
      link={{ path: '/reports/revenue', label: d.open }}
    >
      {(report) => {
        const last = report.series.at(-1);
        const before = report.series.at(-2);
        const held = vndNumber(report.onlineHeldVnd);
        return (
          <>
            <Stat
              label={d.today}
              value={vndNumber(last?.netVnd ?? '0')}
              format={format}
              previous={before ? vndNumber(before.netVnd) : null}
              labels={{ ...words, comparedTo: d.comparedTo }}
              note={[
                fill(d.paid, { count: String(report.paidInvoices.count) }),
                ...(held > 0
                  ? [fill(d.held, { amount: formatVnd(report.onlineHeldVnd, locale) })]
                  : []),
              ].join(', ')}
            />
            <SegmentedControl<'none' | 'previous'>
              label={kit.compareLabel}
              value={mode}
              onChange={setMode}
              options={[
                { value: 'none', label: kit.compareNone },
                { value: 'previous', label: kit.comparePrevious },
              ]}
            />
            <LineChart
              title={`${title}. ${d.sevenDays}`}
              data={revenueSeries(report, w)}
              format={format}
              labels={{
                ...words,
                xHeader: kit.xHeader,
                previous: kit.previous,
                showTable: kit.showTable,
                showChart: kit.showChart,
                plotHint: kit.plotHint,
              }}
            />
          </>
        );
      }}
    </WidgetFrame>
  );
}
