'use client';

import type { PaymentAnomalyListResponse } from '@lucy-spa/contracts';
import { Stat } from '@lucy-spa/ui';
import { AWAITING_LIMIT, type WidgetProps } from '../../../lib/workforce/dashboard/widgets';
import { useWorkforce } from '../session';
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
