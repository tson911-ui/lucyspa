'use client';

import { Tabs, useUrlState } from '@lucy-spa/ui';
import { useCallback, useState } from 'react';
import { payDictionary } from '../../../i18n/pay';
import {
  PAY_PAGE_DEFAULTS,
  PAY_RESET_KEYS,
  normalizePayPage,
  payTabsFor,
  type PayPageState,
} from '../../../lib/workforce/pay';
import { useAccount, useWorkforce } from '../session';
import { Empty, PageHeader, useSuccessToast } from '../ui';
import { AddRuleButton, PayCommission } from './pay-commission';
import { PayCodes } from './pay-codes';
import { PaySalaries } from './pay-salaries';
import { PayTour } from './pay-tour';

/**
 * "Lương và hoa hồng" (Phase 7 P7-11): base salaries, the tour paid per service, the commission rules for product sales and the staff
 * codes for online orders, as four tabs. Every list is a table with its history one click away; every change is a new dated line.
 * Which tabs a person sees follows their permissions (the API decides again on every request).
 */
export function PayScreen() {
  const { locale } = useWorkforce();
  const { account } = useAccount();
  const p = payDictionary(locale);
  const tabs = payTabsFor(account);
  const [state, update] = useUrlState(PAY_PAGE_DEFAULTS, {
    normalize: (next: PayPageState) => normalizePayPage(next, tabs),
    resetOnChange: PAY_RESET_KEYS,
  });
  const [adding, setAdding] = useState(false);
  const [bump, setBump] = useState(0);
  const [canAdd, setCanAdd] = useState(false);
  const notify = useSuccessToast();
  const onLoaded = useCallback((value: boolean) => setCanAdd(value), []);
  if (tabs.length === 0) {
    return (
      <>
        <PageHeader title={p.title} intro={p.intro} />
        <Empty>{p.common.loadError}</Empty>
      </>
    );
  }
  const tab = (tabs as readonly string[]).includes(state.tab) ? state.tab : tabs[0]!;
  const panels = {
    salaries: <PaySalaries state={state} update={(patch) => update(patch)} />,
    tour: <PayTour state={state} update={(patch) => update(patch)} />,
    commission: (
      <PayCommission
        state={state}
        update={(patch) => update(patch)}
        adding={adding}
        bump={bump}
        onLoaded={onLoaded}
        onCloseAdd={() => setAdding(false)}
        onAdded={() => {
          setAdding(false);
          notify(p.commission.done);
          setBump((value) => value + 1);
        }}
      />
    ),
    codes: <PayCodes state={state} update={(patch) => update(patch)} />,
  } as const;
  return (
    <>
      <PageHeader title={p.title} intro={p.intro}>
        {tab === 'commission' && canAdd ? <AddRuleButton onClick={() => setAdding(true)} /> : null}
      </PageHeader>
      <Tabs
        label={p.tabsLabel}
        value={tab}
        onChange={(id) => update({ tab: id })}
        tabs={tabs.map((id) => ({ id, label: p.tabs[id], panel: panels[id] }))}
      />
    </>
  );
}
