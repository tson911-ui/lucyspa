'use client';

import { Button, Card, CardHeader, IconButton, SegmentedControl, SortableGrid } from '@lucy-spa/ui';
import { useEffect, useMemo, useState } from 'react';
import { fill } from '../../../i18n/workforce';
import {
  hideWidget,
  readLayout,
  reorderVisible,
  resizeWidget,
  resolveLayout,
  showWidget,
  toSaved,
  writeLayout,
  type PlacedWidget,
  type ResolvedLayout,
} from '../../../lib/workforce/dashboard/layout';
import { availableWidgets, widgetBranchIds } from '../../../lib/workforce/dashboard/widgets';
import { useBranchMap, DashboardDataProvider } from '../dashboard/data';
import { WidgetHost } from '../dashboard/widget-host';
import { RecoveryEmailSection } from '../recovery-email';
import { useAccount, useWorkforce } from '../session';
import { Notice, PageHeader, Select } from '../ui';

/**
 * Dashboard (UX/UI redesign Step 7, docs/UXUI_REDESIGN_DESIGN.md 14, 15): a greeting, the branch scope
 * selector, and a grid of widgets the account may see. Customize mode reorders (drag, touch, keyboard, Move
 * buttons), resizes and hides widgets; the layout is saved per user and device.
 */
export function DashboardScreen() {
  return (
    <DashboardDataProvider>
      <Dashboard />
    </DashboardDataProvider>
  );
}

/** `localStorage` can be missing or blocked; then the layout simply is not remembered. */
function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function Dashboard() {
  const { t } = useWorkforce();
  const { account } = useAccount();
  const employee = account.kind === 'EMPLOYEE';
  const branches = useBranchMap();
  const available = useMemo(() => availableWidgets(account), [account]);
  const [saved, setSaved] = useState<ReturnType<typeof readLayout>>(null);
  const [editing, setEditing] = useState(false);
  const [branchId, setBranchId] = useState<string | null>(null);

  // Read after mount so the server and first client render agree (the layout lives in the browser).
  useEffect(() => {
    setSaved(readLayout(storage(), account.id));
  }, [account.id]);

  const branchChoices = useMemo(() => {
    const active = [...(branches.data?.values() ?? [])]
      .filter((branch) => branch.isActive)
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    const allowed = new Set(
      widgetBranchIds(
        account,
        active.map((branch) => branch.id),
      ),
    );
    return active.filter((branch) => allowed.has(branch.id));
  }, [account, branches.data]);
  useEffect(() => {
    if (!branchChoices.some((branch) => branch.id === branchId)) {
      setBranchId(branchChoices[0]?.id ?? null);
    }
  }, [branchChoices, branchId]);

  const layout = useMemo(() => resolveLayout(available, saved), [available, saved]);
  const commit = (next: ResolvedLayout) => {
    const value = toSaved(next);
    setSaved(value);
    writeLayout(storage(), account.id, value);
  };
  const reset = () => {
    setSaved(null);
    writeLayout(storage(), account.id, null);
  };

  const showBranchWidgets = layout.visible.some(({ meta }) => meta.scope === 'branch');
  const copy = t.dashboard;

  return (
    <>
      <PageHeader title={fill(copy.greeting, { name: account.displayName })} intro={copy.intro}>
        <div className="ls-dashboard-tools">
          {showBranchWidgets && branchChoices.length > 1 ? (
            <Select
              id="dashboard-branch"
              aria-label={copy.scope}
              title={branchChoices.find((branch) => branch.id === branchId)?.name}
              value={branchId ?? ''}
              onChange={(event) => setBranchId(event.target.value)}
              options={branchChoices.map((branch) => ({ value: branch.id, label: branch.name }))}
            />
          ) : null}
          <Button
            variant={editing ? 'primary' : 'secondary'}
            icon={editing ? 'check' : 'settings'}
            aria-pressed={editing}
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? copy.customizeDone : copy.customize}
          </Button>
        </div>
      </PageHeader>
      {!employee ? <Notice tone="info">{copy.ownerNote}</Notice> : null}
      {/* Account recovery: verify the recovery email while still signed in. */}
      <RecoveryEmailSection />
      {editing ? (
        <Card as="section" aria-label={copy.customize}>
          <CardHeader
            title={copy.customize}
            description={copy.customizeHelp}
            actions={
              <Button variant="secondary" onClick={reset}>
                {copy.customizeReset}
              </Button>
            }
          />
          <p className="ls-stat-note">
            {layout.hidden.length === 0 ? copy.hiddenNone : copy.hiddenTitle}
          </p>
          {layout.hidden.length > 0 ? (
            <ul className="ls-widget-footer">
              {layout.hidden.map((meta) => (
                <li key={meta.id}>
                  <Button
                    variant="secondary"
                    icon="plus"
                    onClick={() => commit(showWidget(layout, meta.id))}
                  >
                    {fill(copy.add, { name: copy.widgets[meta.id] })}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}
      <SortableGrid<PlacedWidget>
        items={layout.visible}
        getId={(placed) => placed.meta.id}
        getLabel={(placed) => copy.widgets[placed.meta.id]}
        itemClassName={(placed) => `ls-widget-${placed.size}`}
        onReorder={(ids) => commit(reorderVisible(layout, ids))}
        labels={copy.sortable}
        ariaLabel={copy.gridLabel}
        disabled={!editing}
        variant="bare"
        className="ls-widget-grid"
        renderItem={(placed) => (
          <>
            {editing ? (
              <div className="ls-widget-edit">
                {placed.meta.sizes.length > 1 ? (
                  <SegmentedControl
                    label={fill(copy.sizeOf, { name: copy.widgets[placed.meta.id] })}
                    value={placed.size}
                    onChange={(size) => commit(resizeWidget(layout, placed.meta.id, size))}
                    options={placed.meta.sizes.map((size) => ({
                      value: size,
                      label: copy.sizes[size],
                    }))}
                  />
                ) : null}
                <IconButton
                  icon="eye-off"
                  label={fill(copy.hide, { name: copy.widgets[placed.meta.id] })}
                  onClick={() => commit(hideWidget(layout, placed.meta.id))}
                />
              </div>
            ) : null}
            <WidgetHost placed={placed} branchId={branchId} />
          </>
        )}
      />
    </>
  );
}
