'use client';

import type { PaymentAnomalyListResponse } from '@lucy-spa/contracts';
import { ComparisonToggle, LineChart, Notice, Stat, type ComparisonMode } from '@lucy-spa/ui';
import { useState } from 'react';
import {
  AWAITING_LIMIT,
  loadPreviousBoard,
  mayBeIncomplete,
  paidChartData,
  previousWindow,
  todayVersusYesterday,
} from '../../../lib/workforce/dashboard/paid-invoices';
import type { WidgetProps } from '../../../lib/workforce/dashboard/widgets';
import { useWorkforce } from '../session';
import { ErrorState } from '../ui';
import { usePosBoard, useShared } from './data';
import { WidgetFrame } from './widget-frame';

export function AwaitingInvoiceWidget({ branchId, size, title }: WidgetProps) {
  const { t, locale } = useWorkforce();
  const board = usePosBoard(branchId);
  const copy = t.dashboard.awaiting;
  return (
    <WidgetFrame
      title={title}
      size={size}
      resource={board}
      link={{ path: '/pos', label: copy.open }}
    >
      {(data) => (
        <Stat
          label={copy.count}
          value={data.awaiting.length}
          format={{ valueFormat: 'count', locale }}
          {...(data.awaiting.length >= AWAITING_LIMIT ? { note: copy.more } : {})}
        />
      )}
    </WidgetFrame>
  );
}

export function PaymentAlertsWidget({ branchId, size, title }: WidgetProps) {
  const { api, t, locale } = useWorkforce();
  const copy = t.dashboard.alerts;
  const alerts = useShared(branchId ? `alerts:${branchId}` : null, (passive) =>
    api.get<PaymentAnomalyListResponse>(
      `/api/v1/pos/branches/${branchId}/payment-anomalies`,
      { status: 'OPEN' },
      { passive },
    ),
  );
  return (
    <WidgetFrame
      title={title}
      size={size}
      resource={alerts}
      link={{ path: '/pos', label: copy.open }}
    >
      {(data) => (
        <Stat
          label={copy.count}
          value={data.anomalies.length}
          format={{ valueFormat: 'count', locale }}
          {...(data.anomalies.length === 0 ? { note: copy.none } : {})}
        />
      )}
    </WidgetFrame>
  );
}

/**
 * "Paid invoices" (never "Revenue" before Phase 8 defines it, Q-D5): today against yesterday, and a 7-day
 * line with an optional comparison. The comparison board is requested for exactly the days of the current
 * window (`previousWindow`), so the two series always have the same number of points.
 */
export function PaidInvoicesWidget({ branchId, size, title }: WidgetProps) {
  const { api, t, locale } = useWorkforce();
  const copy = t.dashboard.paid;
  const kit = t.dashboard.kit;
  const [mode, setMode] = useState<ComparisonMode>('none');
  const current = usePosBoard(branchId);
  const window = current.data ? previousWindow(current.data, mode) : null;
  const previous = useShared(
    window && branchId ? `pos:${branchId}:${window.date}` : null,
    (passive) =>
      loadPreviousBoard(
        (date) => api.get(`/api/v1/pos/branches/${branchId}/board`, { date }, { passive }),
        window!,
      ),
  );
  const format = { valueFormat: 'vnd', locale } as const;
  const words = { up: kit.up, down: kit.down, flat: kit.flat };
  return (
    <WidgetFrame
      title={title}
      size={size}
      resource={current}
      info={copy.info}
      link={{ path: '/pos', label: copy.open }}
    >
      {(board) => {
        const data = paidChartData(board, window && previous.data ? previous.data : null, window, {
          current: copy.current,
          previous: kit.previous,
        });
        const { today, yesterday } = todayVersusYesterday(data.totals);
        return (
          <>
            {mayBeIncomplete(board) ? <Notice tone="warning">{copy.incomplete}</Notice> : null}
            <Stat
              label={copy.today}
              value={today}
              format={format}
              previous={yesterday}
              labels={{ ...words, comparedTo: copy.comparedTo }}
            />
            <ComparisonToggle
              value={mode}
              onChange={setMode}
              labels={{
                label: kit.compareLabel,
                none: kit.compareNone,
                previous: kit.comparePrevious,
                lastYear: kit.compareLastYear,
              }}
            />
            {window && previous.error && !previous.data ? (
              <ErrorState error={previous.error} t={t} onRetry={() => void previous.reload()} />
            ) : null}
            <LineChart
              title={`${title}. ${copy.subtitle}`}
              data={data.series}
              format={format}
              area
              labels={{
                ...words,
                xHeader: kit.xHeader,
                previous: kit.previous,
                showTable: kit.showTable,
                showChart: kit.showChart,
                plotHint: kit.plotHint,
              }}
            />
            {data.totals.every((total) => total === 0) ? (
              <p className="ls-stat-note">{copy.empty}</p>
            ) : null}
          </>
        );
      }}
    </WidgetFrame>
  );
}
