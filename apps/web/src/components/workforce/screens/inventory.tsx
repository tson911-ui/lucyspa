'use client';

import type { InventoryContextResponse } from '@lucy-spa/contracts';
import { Select, Tabs, useUrlState } from '@lucy-spa/ui';
import { useState, type ReactNode } from 'react';
import { inventoryDictionary } from '../../../i18n/inventory';
import {
  availableTabs,
  branchesForTab,
  INVENTORY_LIST_DEFAULTS,
  INVENTORY_PAGE_KEYS,
  normalizeInventoryList,
  resolveBranch,
  resolveTab,
  type InventoryTab,
} from '../../../lib/workforce/inventory';
import { useWorkforce } from '../session';
import { Button, ErrorState, Loading, Notice, PageHeader } from '../ui';
import { CountCreateDialog, CountsTab } from './inventory-counts';
import { ReceiptsTab } from './inventory-receipts';
import { StockTab } from './inventory-stock';
import { SuppliersTab } from './inventory-suppliers';
import { ProductSettingsDialog } from './product-settings-dialog';
import { useInventoryContext } from './use-inventory-command';

type Dialog = 'count' | 'supplier' | 'settings' | null;

/**
 * "Kho hàng": the stock of a branch, its receipts, physical counts and the suppliers, as four tabs kept in the address bar. What
 * each person sees comes from the API's context (the branches and flags they hold); the API authorizes every request again. The
 * page header has the one primary action of the open tab and, for MANAGE_PRODUCTS, "Cài đặt" (the expiry-warning setting).
 */
export function InventoryScreen() {
  const { t } = useWorkforce();
  const context = useInventoryContext();
  if (context.error && !context.data) {
    return <ErrorState error={context.error} t={t} onRetry={() => void context.reload()} />;
  }
  if (!context.data) return <Loading t={t} page />;
  return <InventoryView context={context.data} />;
}

/** The page's content (also rendered on its own by the tests). */
export function InventoryView({ context }: { context: InventoryContextResponse }) {
  const { locale, base, navigate } = useWorkforce();
  const text = inventoryDictionary(locale);
  const [list, updateList] = useUrlState(INVENTORY_LIST_DEFAULTS, {
    normalize: normalizeInventoryList,
    resetOnChange: INVENTORY_PAGE_KEYS,
  });
  const [dialog, setDialog] = useState<Dialog>(null);
  const tabs = availableTabs(context);
  const tab = resolveTab(context, list.tab);
  if (!tab) {
    return (
      <>
        <PageHeader title={text.title} />
        <Notice tone="info">{text.noAccess}</Notice>
      </>
    );
  }
  const branch = tab === 'suppliers' ? null : resolveBranch(context, list.branch, tab);

  const branchControl = (id: InventoryTab): ReactNode => {
    const options = branchesForTab(context, id);
    const current = resolveBranch(context, list.branch, id);
    if (options.length < 2 || !current) return null;
    return (
      <Select
        aria-label={text.branch}
        value={current.id}
        options={options.map((entry) => ({ value: entry.id, label: entry.name }))}
        onChange={(event) => updateList({ branch: event.target.value })}
      />
    );
  };
  const panel = (id: InventoryTab): ReactNode => {
    if (id === 'suppliers') {
      return (
        <SuppliersTab
          list={list}
          updateList={updateList}
          creating={dialog === 'supplier'}
          onCreateClose={() => setDialog(null)}
        />
      );
    }
    const current = resolveBranch(context, list.branch, id);
    if (!current) return <Notice tone="info">{text.noAccess}</Notice>;
    const control = branchControl(id);
    if (id === 'stock') {
      return (
        <StockTab
          branchId={current.id}
          branchControl={control}
          list={list}
          updateList={updateList}
        />
      );
    }
    if (id === 'receipts') {
      return (
        <ReceiptsTab
          branchId={current.id}
          branchControl={control}
          list={list}
          updateList={updateList}
        />
      );
    }
    return (
      <CountsTab
        branchId={current.id}
        branchControl={control}
        list={list}
        updateList={updateList}
      />
    );
  };

  return (
    <>
      <PageHeader title={text.title}>
        {context.manageProducts ? (
          <Button variant="secondary" icon="settings" onClick={() => setDialog('settings')}>
            {text.settings}
          </Button>
        ) : null}
        {tab === 'receipts' && branch?.receipts ? (
          <Button
            variant="primary"
            icon="plus"
            onClick={() =>
              navigate?.(`${base}/inventory/receipts/new?branch=${encodeURIComponent(branch.id)}`)
            }
          >
            {text.receipts.add}
          </Button>
        ) : null}
        {tab === 'counts' && branch?.adjust ? (
          <Button variant="primary" icon="plus" onClick={() => setDialog('count')}>
            {text.counts.add}
          </Button>
        ) : null}
        {tab === 'suppliers' && context.manageProducts ? (
          <Button variant="primary" icon="plus" onClick={() => setDialog('supplier')}>
            {text.suppliers.add}
          </Button>
        ) : null}
      </PageHeader>
      <Tabs
        label={text.title}
        value={tab}
        onChange={(next) => updateList({ tab: next })}
        tabs={tabs.map((id) => ({ id, label: text.tabs[id], panel: panel(id) }))}
      />
      {dialog === 'settings' ? (
        <ProductSettingsDialog fields={['expiry']} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'count' && branch ? (
        <CountCreateDialog branchId={branch.id} onClose={() => setDialog(null)} />
      ) : null}
    </>
  );
}
