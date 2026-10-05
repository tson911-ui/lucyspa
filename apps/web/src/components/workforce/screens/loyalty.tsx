'use client';

import type { WalkInMemberLookupResponse } from '@lucy-spa/contracts';
import {
  Card,
  CardHeader,
  Cluster,
  Field,
  Select,
  Stack,
  Tabs,
  TextInput,
  useUrlState,
} from '@lucy-spa/ui';
import { useMemo, useState } from 'react';
import { comboDictionary } from '../../../i18n/combo';
import { comboSoldDictionary } from '../../../i18n/combo-sold';
import { loyaltyDictionary } from '../../../i18n/loyalty';
import { rewardDictionary } from '../../../i18n/reward';
import { fill } from '../../../i18n/workforce';
import { loyaltyBranches, loyaltyErrorMessage, loyaltyTabs } from '../../../lib/workforce/loyalty';
import {
  LOYALTY_PAGE_DEFAULTS,
  LOYALTY_RESET_KEYS,
  normalizeLoyaltyPage,
  type LoyaltyTabId,
} from '../../../lib/workforce/loyalty-list';
import { useBranches } from '../data';
import { useAccount, useWorkforce } from '../session';
import { Button, Empty, Loading, Notice, PageHeader } from '../ui';
import { LoyaltyCombos } from './loyalty-combos';
import { LoyaltyComboSold } from './loyalty-combo-sold';
import { FrozenCombos, LoyaltyComboUsage } from './loyalty-combo-usage';
import { LoyaltyExceptions } from './loyalty-exceptions';
import { LoyaltyBirthday } from './loyalty-birthday';
import { LoyaltyGoLive } from './loyalty-go-live';
import { LoyaltyReferrals } from './loyalty-referrals';
import { LoyaltyRewardCatalog } from './loyalty-rewards-catalog';
import { LoyaltyRewards } from './loyalty-rewards';

type Member = WalkInMemberLookupResponse['members'][number];

/**
 * "Điểm thưởng" (Phase 5 P5-3): find a customer by the exact phone or email and open their points profile;
 * the loyalty exceptions list and the Owner's go-live switch live in their own tabs. Each tab appears only
 * for an account that holds its permission (the API authorizes every request again).
 */
export function LoyaltyScreen() {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const l = loyaltyDictionary(locale);
  const branches = useBranches(api);
  const shown = useMemo(() => loyaltyTabs(account, branches.data), [account, branches.data]);
  const [state, update] = useUrlState(LOYALTY_PAGE_DEFAULTS, {
    normalize: normalizeLoyaltyPage,
    resetOnChange: LOYALTY_RESET_KEYS,
  });

  if (branches.loading && !branches.data) return <Loading t={t} page />;
  if (
    !shown.customers &&
    !shown.referrals &&
    !shown.exceptions &&
    !shown.combos &&
    !shown.comboUsage &&
    !shown.comboSold &&
    !shown.rewardDesk &&
    !shown.rewardCatalog &&
    !shown.birthday &&
    !shown.goLive
  ) {
    return (
      <>
        <PageHeader title={l.title} intro={l.intro} />
        <Empty>{l.noAccess}</Empty>
      </>
    );
  }
  const tabs = [
    { id: 'customers', label: l.tabs.customers, show: shown.customers, panel: <CustomerLookup /> },
    {
      id: 'referrals',
      label: l.tabs.referrals,
      show: shown.referrals,
      panel: (
        <LoyaltyReferrals
          page={state.page}
          status={state.status}
          onPage={(page) => update({ page })}
          onStatus={(status) => update({ status })}
        />
      ),
    },
    {
      id: 'exceptions',
      label: l.tabs.exceptions,
      show: shown.exceptions,
      panel: (
        <Stack gap="page">
          <LoyaltyExceptions page={state.page} onPage={(page) => update({ page })} />
          <FrozenCombos />
        </Stack>
      ),
    },
    {
      id: 'combos',
      label: comboDictionary(locale).tab,
      show: shown.combos,
      panel: <LoyaltyCombos />,
    },
    {
      id: 'comboSold',
      label: comboSoldDictionary(locale).tab,
      show: shown.comboSold,
      panel: (
        <Stack gap="page">
          <LoyaltyComboSold
            page={state.page}
            status={state.status}
            onPage={(page) => update({ page })}
            onStatus={(status) => update({ status })}
          />
        </Stack>
      ),
    },
    {
      id: 'comboUsage',
      label: comboDictionary(locale).usage.tab,
      show: shown.comboUsage,
      panel: <LoyaltyComboUsage page={state.page} onPage={(page) => update({ page })} />,
    },
    {
      id: 'rewardDesk',
      label: rewardDictionary(locale).tabs.desk,
      show: shown.rewardDesk,
      panel: <LoyaltyRewards />,
    },
    {
      id: 'rewardCatalog',
      label: rewardDictionary(locale).tabs.catalog,
      show: shown.rewardCatalog,
      panel: <LoyaltyRewardCatalog />,
    },
    {
      id: 'birthday',
      label: l.tabs.birthday,
      show: shown.birthday,
      panel: <LoyaltyBirthday />,
    },
    { id: 'goLive', label: l.tabs.goLive, show: shown.goLive, panel: <LoyaltyGoLive /> },
  ].filter((tab) => tab.show);
  return (
    <>
      <PageHeader title={l.title} intro={l.intro} />
      <Tabs
        label={l.tabsLabel}
        value={state.tab || tabs[0]?.id}
        onChange={(id) => update({ tab: id as LoyaltyTabId })}
        tabs={tabs.map(({ id, label, panel }) => ({ id, label, panel }))}
      />
    </>
  );
}

/**
 * Exact phone or email only (never by name, no partial match). One primary button: "Find customer" until a
 * match is found, then "Open points profile". Changing the text goes back to searching.
 */
function CustomerLookup() {
  const { api, t, locale, base, navigate } = useWorkforce();
  const { account } = useAccount();
  const l = loyaltyDictionary(locale);
  const branches = useBranches(api);
  const allowed = useMemo(() => loyaltyBranches(account, branches.data), [account, branches.data]);
  const [branchId, setBranchId] = useState('');
  const [by, setBy] = useState<'phone' | 'email'>('phone');
  const [value, setValue] = useState('');
  const [lookup, setLookup] = useState<WalkInMemberLookupResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const member: Member | null = lookup?.members[0] ?? null;
  const branch = branchId || allowed[0]?.id || '';

  async function submit() {
    if (member) {
      navigate?.(`${base}/loyalty/${member.id}`);
      return;
    }
    if (searching || !value.trim() || !branch) return;
    setSearching(true);
    setError(null);
    try {
      setLookup(
        await api.get<WalkInMemberLookupResponse>(`/api/v1/loyalty/branches/${branch}/members`, {
          [by]: value.trim(),
        }),
      );
    } catch (failure) {
      setLookup(null);
      setError(loyaltyErrorMessage(failure, t, locale));
    } finally {
      setSearching(false);
    }
  }

  return (
    <Card as="section" aria-label={l.lookup.title}>
      <CardHeader title={l.lookup.title} description={l.lookup.hint} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Stack gap="block">
          <Cluster gap="inline" align="end">
            {allowed.length > 1 ? (
              <Field label={l.lookup.branch} width="md">
                {(control) => (
                  <Select
                    {...control}
                    value={branch}
                    options={allowed.map((item) => ({ value: item.id, label: item.name }))}
                    onChange={(event) => (setBranchId(event.target.value), setLookup(null))}
                  />
                )}
              </Field>
            ) : null}
            <Field label={l.lookup.by} width="sm">
              {(control) => (
                <Select
                  {...control}
                  value={by}
                  options={[
                    { value: 'phone', label: l.lookup.phone },
                    { value: 'email', label: l.lookup.email },
                  ]}
                  onChange={(event) => (
                    setBy(event.target.value as 'phone' | 'email'),
                    setLookup(null)
                  )}
                />
              )}
            </Field>
            <Field label={by === 'phone' ? l.lookup.phone : l.lookup.email} width="lg">
              {(control) => (
                <TextInput
                  {...control}
                  type={by === 'phone' ? 'tel' : 'email'}
                  inputMode={by === 'phone' ? 'tel' : 'email'}
                  autoComplete="off"
                  maxLength={by === 'phone' ? 32 : 320}
                  value={value}
                  onChange={(event) => (setValue(event.target.value), setLookup(null))}
                />
              )}
            </Field>
            <Button
              type="submit"
              variant="primary"
              icon={member ? 'eye' : 'search'}
              loading={searching}
              disabled={!member && !value.trim()}
            >
              {searching ? l.lookup.searching : member ? l.lookup.open : l.lookup.search}
            </Button>
          </Cluster>
          {error ? <Notice tone="error">{error}</Notice> : null}
          {member ? (
            <Notice tone="success">
              {fill(l.lookup.found, { name: member.displayName })}
              {member.phoneMasked ? ` · ${member.phoneMasked}` : ''}
              {member.emailMasked ? ` · ${member.emailMasked}` : ''}
            </Notice>
          ) : null}
          {lookup && lookup.members.length === 0 ? (
            <Notice tone="info">{l.lookup.notFound}</Notice>
          ) : null}
        </Stack>
      </form>
    </Card>
  );
}
