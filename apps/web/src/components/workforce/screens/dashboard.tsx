'use client';

import {
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  IconButton,
  SegmentedControl,
  SortableGrid,
  useUrlState,
} from '@lucy-spa/ui';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { fill } from '../../../i18n/workforce';
import { confirmError } from '../../../lib/workforce/form-labels';
import {
  hideWidget,
  layoutKey,
  parseLayout,
  reorderVisible,
  resizeWidget,
  resolveLayout,
  showWidget,
  toSaved,
  writeLayout,
  type PlacedWidget,
  type ResolvedLayout,
  type SavedLayout,
} from '../../../lib/workforce/dashboard/layout';
import {
  availableWidgets,
  widgetBranchIds,
  type WidgetId,
} from '../../../lib/workforce/dashboard/widgets';
import { useBranchMap, DashboardDataProvider } from '../dashboard/data';
import { preloadWidgets } from '../dashboard/registry';
import { WidgetHost } from '../dashboard/widget-host';
import { RecoveryEmailSection } from '../recovery-email';
import { useAccount, useWorkforce } from '../session';
import { AdminSeasonChip } from '../../season/admin-season-chip';
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

/** Fired after this tab saves the layout (the `storage` event covers the other tabs). */
const LAYOUT_EVENT = 'ls:dashboard-layout';

function subscribeLayout(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(LAYOUT_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(LAYOUT_EVENT, onChange);
  };
}

/**
 * The saved layout, read from the browser through `useSyncExternalStore`: the server render and hydration use the
 * default layout (no snapshot on the server), then the stored one applies without an effect that sets state after mount.
 */
function useStoredLayout(accountId: string): SavedLayout | null {
  const raw = useSyncExternalStore(
    subscribeLayout,
    () => {
      try {
        return storage()?.getItem(layoutKey(accountId)) ?? null;
      } catch {
        return null;
      }
    },
    () => null,
  );
  return useMemo(() => parseLayout(raw), [raw]);
}

/** Address-bar state of the dashboard: the branch the branch widgets show (`?branch=`). */
const DASHBOARD_URL_DEFAULTS = { branch: '' };

function Dashboard() {
  const { t, locale } = useWorkforce();
  const { account } = useAccount();
  const employee = account.kind === 'EMPLOYEE';
  const branches = useBranchMap();
  const available = useMemo(() => availableWidgets(account), [account]);
  const stored = useStoredLayout(account.id);
  // A layout that could not be written (blocked storage) still applies for this visit.
  const [unsaved, setUnsaved] = useState<SavedLayout | null | undefined>(undefined);
  const saved = unsaved === undefined ? stored : unsaved;
  const [editing, setEditing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [url, updateUrl] = useUrlState(DASHBOARD_URL_DEFAULTS);
  const chosenBranch = url.branch || null;
  const setBranchId = (branch: string) => updateUrl({ branch });

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
  // Derived in render (no effect): the chosen branch while it is still offered, else the first choice.
  const branchId = branchChoices.some((branch) => branch.id === chosenBranch)
    ? chosenBranch
    : (branchChoices[0]?.id ?? null);

  const layout = useMemo(() => resolveLayout(available, saved), [available, saved]);
  const visibleKey = layout.visible.map(({ meta }) => meta.id).join(',');
  // The chunks of the widgets on screen start loading with the layout, not when each host renders (rbp bundle-preload).
  useEffect(() => {
    if (visibleKey) preloadWidgets(visibleKey.split(',') as WidgetId[]);
  }, [visibleKey]);
  // While the branch list loads, a branch widget shows its skeleton, not "no branch".
  const branchesPending = branches.data === null && !branches.error;
  const commit = (next: ResolvedLayout) => {
    const value = toSaved(next);
    setUnsaved(value);
    writeLayout(storage(), account.id, value);
    window.dispatchEvent(new Event(LAYOUT_EVENT));
  };
  const reset = async () => {
    setUnsaved(null);
    writeLayout(storage(), account.id, null);
    window.dispatchEvent(new Event(LAYOUT_EVENT));
    setConfirmReset(false);
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
      <AdminSeasonChip locale={locale} />
      {!employee ? <Notice tone="info">{copy.ownerNote}</Notice> : null}
      {/* Account recovery: verify the recovery email while still signed in. */}
      <RecoveryEmailSection />
      {editing ? (
        <Card as="section" aria-label={copy.customize}>
          <CardHeader
            title={copy.customize}
            description={copy.customizeHelp}
            actions={
              <Button variant="secondary" onClick={() => setConfirmReset(true)}>
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
            <WidgetHost placed={placed} branchId={branchId} branchesPending={branchesPending} />
          </>
        )}
      />
      {/* Resetting wipes the saved order, sizes and hidden cards: it asks first (wig dashboard.tsx:129). */}
      {confirmReset ? (
        <ConfirmDialog
          tone="warning"
          title={copy.resetTitle}
          description={copy.resetText}
          confirmLabel={copy.customizeReset}
          cancelLabel={t.common.cancel}
          describeError={confirmError(t)}
          onConfirm={reset}
          onCancel={() => setConfirmReset(false)}
        />
      ) : null}
    </>
  );
}
