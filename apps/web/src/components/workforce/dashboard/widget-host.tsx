'use client';

import { Suspense } from 'react';
import type { PlacedWidget } from '../../../lib/workforce/dashboard/layout';
import { allowedAtBranch } from '../../../lib/workforce/dashboard/widgets';
import { useAccount, useWorkforce } from '../session';
import { WIDGET_COMPONENTS } from './registry';
import { WidgetBoundary, WidgetMessage, WidgetSkeleton } from './widget-frame';

/**
 * One widget in the grid: gates a branch widget on the selected branch (a hint; the API answers 403 the same
 * way), then renders it inside its own error boundary and Suspense (it is loaded on demand).
 */
export function WidgetHost({
  placed,
  branchId,
}: {
  placed: PlacedWidget;
  branchId: string | null;
}) {
  const { t } = useWorkforce();
  const { account } = useAccount();
  const { meta, size } = placed;
  const title = t.dashboard.widgets[meta.id];
  if (meta.scope === 'branch') {
    if (!branchId) {
      return (
        <WidgetMessage
          title={title}
          size={size}
          icon="info"
          message={t.dashboard.noBranchWidgets}
        />
      );
    }
    if (!allowedAtBranch(account, meta, branchId)) {
      return (
        <WidgetMessage title={title} size={size} icon="shield" message={t.dashboard.noAccess} />
      );
    }
  }
  const Component = WIDGET_COMPONENTS[meta.id];
  return (
    <WidgetBoundary title={title} size={size}>
      <Suspense fallback={<WidgetSkeleton title={title} size={size} />}>
        <Component branchId={branchId} size={size} title={title} />
      </Suspense>
    </WidgetBoundary>
  );
}
