'use client';

import type { WalkInMemberLookupResponse } from '@lucy-spa/contracts';
import {
  ButtonLink,
  Card,
  CardHeader,
  Cluster,
  EmptyState,
  Field,
  SegmentedControl,
  Select,
  Stack,
  Tabs,
  TextInput,
  useUrlState,
} from '@lucy-spa/ui';
import { useMemo, useRef, useState } from 'react';
import { comboDictionary } from '../../../i18n/combo';
import { comboSoldDictionary } from '../../../i18n/combo-sold';
import { loyaltyDictionary } from '../../../i18n/loyalty';
import { rewardDictionary } from '../../../i18n/reward';
import { fill } from '../../../i18n/workforce';
import { loyaltyBranches, loyaltyErrorMessage, loyaltyTabs } from '../../../lib/workforce/loyalty';
import {
  LOYALTY_PAGE_DEFAULTS,
  LOYALTY_RESET_KEYS,
  loyaltyGroupOf,
  loyaltyGroups,
  normalizeLoyaltyPage,
  type LoyaltyTabId,
} from '../../../lib/workforce/loyalty-list';
import { useBranches } from '../data';
import { useAccount, useWorkforce } from '../session';
import { Button, Loading, Notice, PageHeader } from '../ui';
import { LoyaltyCombos } from './loyalty-combos';
import { LoyaltyComboSold } from './loyalty-combo-sold';
import { FrozenCombos, LoyaltyComboUsage } from './loyalty-combo-usage';
import { LoyaltyExceptions } from './loyalty-exceptions';
import { LoyaltyBirthday } from './loyalty-birthday';
import { LoyaltyGoLive } from './loyalty-go-live';
import { LoyaltyReferrals } from './loyalty-referrals';
import { LoyaltyRewardCatalog } from './loyalty-rewards-catalog';
import { LoyaltyRewards } from './loyalty-rewards';
import { AdminButtonLink } from './admin-button-link';

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
  if (!Object.values(shown).some(Boolean)) {
    return (
      <>
        <PageHeader title={l.title} intro={l.intro} />
        <EmptyState icon="shield" title={l.empty.noAccessTitle}>
          {l.empty.noAccessText}
        </EmptyState>
      </>
    );
  }
  // Owner answer 5: six task groups; `?tab=` keeps the section id, so old links open the same section.
  const { groups, current } = loyaltyGroups(shown, state.tab);
  const sectionLabels: Record<LoyaltyTabId, string> = {
    customers: l.tabs.customers,
    referrals: l.tabs.referrals,
    exceptions: l.tabs.exceptions,
    combos: l.sections.combos,
    comboSold: comboSoldDictionary(locale).tab,
    comboUsage: comboDictionary(locale).usage.tab,
    rewardDesk: rewardDictionary(locale).tabs.desk,
    rewardCatalog: rewardDictionary(locale).tabs.catalog,
    birthday: l.tabs.birthday,
    goLive: l.tabs.goLive,
  };
  const section = current ? (
    <LoyaltySection
      tab={current}
      page={state.page}
      status={state.status}
      onPage={(page) => update({ page })}
      onStatus={(status) => update({ status })}
    />
  ) : null;
  return (
    <>
      <PageHeader title={l.title} intro={l.intro} />
      <Tabs
        label={l.tabsLabel}
        value={current ? loyaltyGroupOf(current) : groups[0]?.id}
        onChange={(id) => {
          const group = groups.find((item) => item.id === id);
          if (group && group.tabs[0]) update({ tab: group.tabs[0] });
        }}
        tabs={groups.map((group) => ({
          id: group.id,
          label: l.groups[group.id],
          panel:
            group.tabs.length > 1 && current ? (
              <Stack gap="block">
                <div className="ls-loyalty-sections">
                  <SegmentedControl<LoyaltyTabId>
                    label={l.sectionLabel}
                    value={current}
                    onChange={(tab) => update({ tab })}
                    options={group.tabs.map((tab) => ({ value: tab, label: sectionLabels[tab] }))}
                  />
                </div>
                {section}
              </Stack>
            ) : (
              section
            ),
        }))}
      />
    </>
  );
}

/** The screen of one loyalty section (one of the ten; the URL keeps its id). */
function LoyaltySection({
  tab,
  page,
  status,
  onPage,
  onStatus,
}: {
  tab: LoyaltyTabId;
  page: number;
  status: string;
  onPage: (page: number) => void;
  onStatus: (status: string) => void;
}) {
  switch (tab) {
    case 'customers':
      return <CustomerLookup />;
    case 'referrals':
      return <LoyaltyReferrals page={page} status={status} onPage={onPage} onStatus={onStatus} />;
    case 'exceptions':
      return (
        <Stack gap="page">
          <LoyaltyExceptions page={page} onPage={onPage} />
          <FrozenCombos />
        </Stack>
      );
    case 'combos':
      return <LoyaltyCombos />;
    case 'comboSold':
      return <LoyaltyComboSold page={page} status={status} onPage={onPage} onStatus={onStatus} />;
    case 'comboUsage':
      return <LoyaltyComboUsage page={page} onPage={onPage} />;
    case 'rewardDesk':
      return <LoyaltyRewards />;
    case 'rewardCatalog':
      return <LoyaltyRewardCatalog />;
    case 'birthday':
      return <LoyaltyBirthday />;
    case 'goLive':
      return <LoyaltyGoLive />;
  }
}

/**
 * Exact phone or email only (never by name, no partial match). One primary button: "Find customer" until a
 * match is found, then "Open points profile". Changing the text goes back to searching.
 */
function CustomerLookup() {
  const { api, t, locale, base } = useWorkforce();
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
  const [missing, setMissing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const member: Member | null = lookup?.members[0] ?? null;
  const branch = branchId || allowed[0]?.id || '';
  const contacts = [member?.phoneMasked, member?.emailMasked].filter(Boolean).join(', ');

  async function submit() {
    // The button stays enabled (validate on submit): an empty field shows its error at the field and takes focus.
    if (!value.trim()) {
      setMissing(true);
      inputRef.current?.focus();
      return;
    }
    if (searching || !branch) return;
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
    <Card as="section" className="ls-loyalty-lookup" aria-label={l.lookup.title}>
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
            <SegmentedControl<'phone' | 'email'>
              label={l.lookup.by}
              value={by}
              options={[
                { value: 'phone', label: l.lookup.phone },
                { value: 'email', label: l.lookup.email },
              ]}
              onChange={(next) => (setBy(next), setLookup(null), setMissing(false))}
            />
            <Field
              label={by === 'phone' ? l.lookup.phone : l.lookup.email}
              width="lg"
              error={missing ? l.lookupRequired : undefined}
            >
              {(control) => (
                <TextInput
                  {...control}
                  ref={inputRef}
                  name={by === 'phone' ? 'lookup-phone' : 'lookup-email'}
                  type={by === 'phone' ? 'tel' : 'email'}
                  inputMode={by === 'phone' ? 'tel' : 'email'}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={by === 'phone' ? 32 : 320}
                  value={value}
                  onChange={(event) => (
                    setValue(event.target.value),
                    setLookup(null),
                    setMissing(false)
                  )}
                />
              )}
            </Field>
            {/* Found: the way on is a real link to the profile (modifier-click opens a tab); before that, the search button. */}
            {member ? (
              <ButtonLink
                LinkComponent={AdminButtonLink}
                href={`${base}/loyalty/${member.id}`}
                variant="primary"
                icon="eye"
              >
                {l.lookup.open}
              </ButtonLink>
            ) : (
              <Button type="submit" variant="primary" icon="search" loading={searching}>
                {searching ? l.lookup.searching : l.lookup.search}
              </Button>
            )}
          </Cluster>
          {error ? <Notice tone="error">{error}</Notice> : null}
          {member ? (
            <Notice tone="success">
              {fill(l.lookup.found, { name: member.displayName })}
              {contacts ? ` (${contacts})` : ''}
            </Notice>
          ) : null}
          {lookup && lookup.members.length === 0 ? (
            <Notice tone="info">{l.lookup.notFound}</Notice>
          ) : null}
          {!lookup && !error ? (
            <EmptyState icon="search" title={l.lookupEmpty.title}>
              {l.lookupEmpty.text}
            </EmptyState>
          ) : null}
        </Stack>
      </form>
    </Card>
  );
}
