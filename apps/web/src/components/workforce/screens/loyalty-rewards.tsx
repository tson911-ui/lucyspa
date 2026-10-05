'use client';

import type {
  RewardEntitlementPageResponse,
  RewardEntitlementResponse,
  RewardLookupResponse,
} from '@lucy-spa/contracts';
import {
  Card,
  CardHeader,
  Cluster,
  DataTable,
  Field,
  ListSection,
  RowActions,
  Select,
  Stack,
  TextInput,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useMemo, useState } from 'react';
import { rewardDictionary } from '../../../i18n/reward';
import { fill } from '../../../i18n/workforce';
import { formatDateTime } from '../../../lib/workforce/format';
import { paginationLabels } from '../../../lib/workforce/list-view';
import { LOYALTY_PAGE_SIZE } from '../../../lib/workforce/loyalty-list';
import { rewardBranches, rewardName, statusTone } from '../../../lib/workforce/reward';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useBranches } from '../data';
import { useAccount, useWorkforce } from '../session';
import { Badge, Button, Empty, ErrorState, Notice, useResource, useSuccessToast } from '../ui';
import {
  IssueRewardDialog,
  RestoreUseDialog,
  RevokeRewardDialog,
  RewardHistoryDialog,
  UseRewardDialog,
} from './loyalty-rewards-dialogs';

const ZONE = 'Asia/Ho_Chi_Minh';

type Member = RewardLookupResponse['members'][number];
type Action =
  | { kind: 'issue' }
  | { kind: 'use' | 'revoke' | 'restore' | 'history'; entitlement: RewardEntitlementResponse };

/**
 * "Cấp quà tặng" (Phase 5 P5-9, `ISSUE_REWARDS` at a branch): find a member by the EXACT phone, then grant a reward, mark a unit
 * as used, revoke the rest (a reason is required) and read the full history. A manager who holds `MANAGE_REWARD_CATALOG` can also
 * restore a use marked by mistake. Rewards have nothing to do with points. Nothing is ever deleted; every action is audited.
 */
export function LoyaltyRewards() {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const r = rewardDictionary(locale);
  const d = r.desk;
  const notify = useSuccessToast();
  const branches = useBranches(api);
  const allowed = useMemo(() => rewardBranches(account, branches.data), [account, branches.data]);
  const [branchId, setBranchId] = useState('');
  const branch = branchId || allowed[0]?.id || '';
  const [phone, setPhone] = useState('');
  const [member, setMember] = useState<Member | null>(null);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<Action | null>(null);

  const list = useResource(
    () =>
      member && branch
        ? api.get<RewardEntitlementPageResponse>(
            `/api/v1/rewards/branches/${branch}/customers/${member.id}/entitlements`,
            { page },
          )
        : Promise.resolve(null),
    [api, branch, member?.id, page],
  );

  async function search() {
    if (searching || !phone.trim() || !branch) return;
    setSearching(true);
    setError(null);
    try {
      const found = await api.get<RewardLookupResponse>(
        `/api/v1/rewards/branches/${branch}/lookup`,
        { phone: phone.trim() },
      );
      setMember(found.members[0] ?? null);
      setSearched(true);
      setPage(1);
    } catch (failure) {
      setMember(null);
      setSearched(false);
      setError(errorMessage(failure, t));
    } finally {
      setSearching(false);
    }
  }

  const done = (message: string) => {
    setAction(null);
    notify(message);
    void list.reload();
  };

  const rows = list.data?.items ?? [];
  const columns: DataTableColumn<RewardEntitlementResponse>[] = [
    {
      key: 'item',
      header: d.list.item,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (row) => rewardName(row.item, locale),
    },
    { key: 'kind', header: d.list.kind, hideBelow: 'lg', cell: (row) => r.kind[row.item.kind] },
    { key: 'issued', header: d.list.issued, numeric: true, cell: (row) => row.quantityIssued },
    {
      key: 'used',
      header: d.list.used,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => row.quantityUsed,
    },
    { key: 'left', header: d.list.left, numeric: true, cell: (row) => row.quantityLeft },
    {
      key: 'status',
      header: d.list.status,
      cell: (row) => <Badge tone={statusTone(row.status)}>{r.status[row.status]}</Badge>,
    },
    {
      key: 'expires',
      header: d.list.expires,
      hideBelow: 'lg',
      cell: (row) => (row.expiresAt ? formatDateTime(row.expiresAt, ZONE, locale) : '—'),
    },
    {
      key: 'issuedAt',
      header: d.list.issuedAt,
      hideBelow: 'xl',
      cell: (row) => formatDateTime(row.issuedAt, ZONE, locale),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (row) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: rewardName(row.item, locale) })}
          items={[
            {
              id: 'history',
              label: d.actions.history,
              icon: 'eye' as const,
              onSelect: () => setAction({ kind: 'history', entitlement: row }),
            },
            ...(row.can.use
              ? [
                  {
                    id: 'use',
                    label: d.actions.use,
                    icon: 'check' as const,
                    onSelect: () => setAction({ kind: 'use', entitlement: row }),
                  },
                ]
              : []),
            ...(row.can.restore
              ? [
                  {
                    id: 'restore',
                    label: d.actions.restore,
                    icon: 'swap' as const,
                    onSelect: () => setAction({ kind: 'restore', entitlement: row }),
                  },
                ]
              : []),
            ...(row.can.revoke
              ? [
                  {
                    id: 'revoke',
                    label: d.actions.revoke,
                    icon: 'trash' as const,
                    tone: 'danger' as const,
                    onSelect: () => setAction({ kind: 'revoke', entitlement: row }),
                  },
                ]
              : []),
          ]}
        />
      ),
    },
  ];

  if (branches.data && allowed.length === 0) return <Empty>{d.noBranch}</Empty>;
  const live = list.data?.loyaltyLive ?? true;
  return (
    <Stack gap="page">
      <p className="ls-hint">{d.intro}</p>
      <Card as="section" aria-label={d.lookup.title}>
        <CardHeader title={d.lookup.title} />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <Stack gap="block">
            <Cluster gap="inline" align="end">
              {allowed.length > 1 ? (
                <Field label={d.lookup.branch} width="md">
                  {(control) => (
                    <Select
                      {...control}
                      value={branch}
                      options={allowed.map((item) => ({ value: item.id, label: item.name }))}
                      onChange={(event) => {
                        setBranchId(event.target.value);
                        setMember(null);
                        setSearched(false);
                      }}
                    />
                  )}
                </Field>
              ) : null}
              <Field label={d.lookup.phone} width="lg">
                {(control) => (
                  <TextInput
                    {...control}
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                    maxLength={32}
                    value={phone}
                    onChange={(event) => {
                      setPhone(event.target.value);
                      setMember(null);
                      setSearched(false);
                    }}
                  />
                )}
              </Field>
              <Button
                type="submit"
                variant="primary"
                icon="search"
                loading={searching}
                disabled={!phone.trim()}
              >
                {searching ? d.lookup.searching : d.lookup.search}
              </Button>
            </Cluster>
            {error ? <Notice tone="error">{error}</Notice> : null}
            {member ? (
              <Notice tone="success">
                {fill(d.lookup.found, { name: member.displayName })}
                {member.phoneMasked ? ` · ${member.phoneMasked}` : ''}
              </Notice>
            ) : null}
            {searched && !member ? <Notice tone="info">{d.lookup.notFound}</Notice> : null}
          </Stack>
        </form>
      </Card>
      {member ? (
        <>
          {!live ? <Notice tone="info">{r.notLive}</Notice> : null}
          <ListSection
            title={fill(d.list.title, { name: member.displayName })}
            count={list.data?.total}
            actions={
              list.data?.canIssue ? (
                <Button
                  variant="primary"
                  icon="plus"
                  disabled={!live}
                  onClick={() => setAction({ kind: 'issue' })}
                >
                  {d.actions.issue}
                </Button>
              ) : undefined
            }
          >
            <DataTable
              mode="server"
              caption={fill(t.common.list.table, { list: d.title })}
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              loading={list.loading && !list.data}
              loadingLabel={t.common.loading}
              error={
                list.error ? (
                  <ErrorState error={list.error} t={t} onRetry={() => void list.reload()} />
                ) : undefined
              }
              empty={list.data ? <Empty>{d.list.none}</Empty> : undefined}
              paging={{
                page,
                pageSize: LOYALTY_PAGE_SIZE,
                total: list.data?.total ?? rows.length,
                onPageChange: setPage,
                labels: paginationLabels(t, d.title),
              }}
            />
          </ListSection>
        </>
      ) : null}
      {action?.kind === 'issue' && member ? (
        <IssueRewardDialog
          branchId={branch}
          customerId={member.id}
          onDone={() => done(d.issueDialog.done)}
          onClose={() => setAction(null)}
        />
      ) : null}
      {action?.kind === 'use' ? (
        <UseRewardDialog
          branchId={branch}
          entitlement={action.entitlement}
          onDone={() => done(d.useDialog.done)}
          onClose={() => setAction(null)}
        />
      ) : null}
      {action?.kind === 'revoke' ? (
        <RevokeRewardDialog
          branchId={branch}
          entitlement={action.entitlement}
          onDone={() => done(d.revokeDialog.done)}
          onClose={() => setAction(null)}
        />
      ) : null}
      {action?.kind === 'restore' ? (
        <RestoreUseDialog
          entitlement={action.entitlement}
          onDone={() => done(d.restoreDialog.done)}
          onClose={() => setAction(null)}
        />
      ) : null}
      {action?.kind === 'history' ? (
        <RewardHistoryDialog entitlement={action.entitlement} onClose={() => setAction(null)} />
      ) : null}
    </Stack>
  );
}
