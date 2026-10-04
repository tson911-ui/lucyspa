'use client';

import type {
  LoyaltyAdjustmentResponse,
  LoyaltyLedgerEntryResponse,
  LoyaltyLedgerPageResponse,
  LoyaltyProfileResponse,
  LoyaltyWalletResponse,
} from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  Card,
  CardHeader,
  DataTable,
  FacetedFilter,
  Grid,
  ListSection,
  ListToolbar,
  RowActions,
  Stack,
  Stat,
  useUrlState,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useMemo, useState } from 'react';
import { loyaltyDictionary } from '../../../i18n/loyalty';
import { fill } from '../../../i18n/workforce';
import { formatDateTime } from '../../../lib/workforce/format';
import { paginationLabels, toolbarLabels } from '../../../lib/workforce/list-view';
import {
  canCorrect,
  formatPoints,
  loyaltyBranches,
  tierTone,
} from '../../../lib/workforce/loyalty';
import {
  LEDGER_DEFAULTS,
  LOYALTY_PAGE_SIZE,
  LOYALTY_RESET_KEYS,
  normalizeLedger,
} from '../../../lib/workforce/loyalty-list';
import { useBranches } from '../data';
import { PrefetchLink as Link } from '../link';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
  useResource,
  useSuccessToast,
} from '../ui';
import { AdjustDialog } from './loyalty-adjust-dialog';

/**
 * One customer's points (Phase 5 P5-3): the Spa and Beauty balances with their tier, and the permanent ledger
 * (read-only history, newest first, 20 per page). The only write is the adjustment dialog, which adds a new line
 * (optionally linked to the line it corrects); old lines are never edited or deleted.
 */
export function LoyaltyCustomerScreen({ userId }: { userId: string }) {
  const { api, t, locale, base } = useWorkforce();
  const { account } = useAccount();
  const l = loyaltyDictionary(locale);
  const notify = useSuccessToast();
  const branches = useBranches(api);
  const allowed = useMemo(() => loyaltyBranches(account, branches.data), [account, branches.data]);
  const branchId = allowed[0]?.id ?? '';
  const [list, updateList] = useUrlState(LEDGER_DEFAULTS, {
    normalize: normalizeLedger,
    resetOnChange: LOYALTY_RESET_KEYS,
  });
  const profile = useResource(
    () =>
      branchId
        ? api.get<LoyaltyProfileResponse>(
            `/api/v1/loyalty/branches/${branchId}/customers/${userId}`,
          )
        : Promise.resolve(null),
    [api, branchId, userId],
  );
  const ledger = useResource(
    () =>
      branchId
        ? api.get<LoyaltyLedgerPageResponse>(
            `/api/v1/loyalty/branches/${branchId}/customers/${userId}/ledger`,
            { wallet: list.wallet || undefined, page: list.page },
          )
        : Promise.resolve(null),
    [api, branchId, userId, list.wallet, list.page],
  );
  const [overlay, setOverlay] = useState<{ correcting: LoyaltyLedgerEntryResponse | null } | null>(
    null,
  );

  if (branches.loading && !branches.data) return <Loading t={t} page />;
  if (allowed.length === 0) {
    return (
      <>
        <PageHeader title={l.title} intro={l.intro} />
        <Empty>{l.noBranch}</Empty>
      </>
    );
  }
  if (profile.error && !profile.data) {
    return <ErrorState error={profile.error} t={t} onRetry={() => void profile.reload()} />;
  }
  if (!profile.data) return <Loading t={t} page />;
  const { customer, goLive, wallets, can } = profile.data;
  const canAdjust = can.adjust && goLive.active;

  const done = (result: LoyaltyAdjustmentResponse) => {
    setOverlay(null);
    notify(
      result.entry.shortfallPoints > 0
        ? fill(l.adjust.doneShortfall, { n: formatPoints(result.entry.shortfallPoints, locale) })
        : l.adjust.done,
    );
    void profile.reload();
    void ledger.reload();
  };

  const zone = allowed[0] ? (branches.data?.get(allowed[0].id)?.timezone ?? 'UTC') : 'UTC';
  const columns: DataTableColumn<LoyaltyLedgerEntryResponse>[] = [
    {
      key: 'when',
      header: l.columns.when,
      mobileTitle: true,
      cell: (entry) => formatDateTime(entry.createdAt, zone, locale),
    },
    { key: 'wallet', header: l.columns.wallet, cell: (entry) => l.wallets[entry.wallet] },
    {
      key: 'kind',
      header: l.columns.kind,
      truncate: true,
      width: 'md',
      cell: (entry) => l.kinds[entry.kind],
    },
    {
      key: 'points',
      header: l.columns.points,
      numeric: true,
      cell: (entry) => formatPoints(entry.points, locale, true),
    },
    {
      key: 'shortfall',
      header: l.columns.shortfall,
      numeric: true,
      hideBelow: 'md',
      cell: (entry) =>
        entry.shortfallPoints > 0 ? formatPoints(entry.shortfallPoints, locale) : '—',
    },
    {
      key: 'source',
      header: l.columns.source,
      hideBelow: 'lg',
      cell: (entry) =>
        entry.invoiceCode
          ? `${entry.invoiceCode}${entry.paidSeq && entry.paidSeq > 1 ? ` · #${entry.paidSeq}` : ''}`
          : (entry.actorName ?? '—'),
    },
    {
      key: 'detail',
      header: l.columns.detail,
      hideBelow: 'xl',
      truncate: true,
      width: 'lg',
      cell: (entry) =>
        entry.reason ??
        (entry.correctsEntryId ? l.correctsLine : entry.corrected ? l.corrected : '—'),
    },
    ...(can.adjust && goLive.active
      ? [
          {
            key: 'actions',
            header: t.common.actions,
            actions: true,
            cell: (entry: LoyaltyLedgerEntryResponse) => (
              <RowActions
                menuLabel={fill(l.actionsFor, { kind: l.kinds[entry.kind] })}
                items={[
                  {
                    id: 'correct',
                    label: l.correct,
                    icon: 'edit',
                    disabled: !canCorrect(entry),
                    onSelect: () => setOverlay({ correcting: entry }),
                  },
                ]}
              />
            ),
          },
        ]
      : []),
  ];

  const rows = ledger.data?.items ?? [];
  return (
    <>
      <PageHeader
        title={customer.displayName}
        intro={[customer.phoneMasked, customer.emailMasked].filter(Boolean).join(' · ')}
        breadcrumbs={
          <Breadcrumbs
            label={l.profile.breadcrumbs}
            LinkComponent={Link}
            items={[{ label: l.title, href: `${base}/loyalty` }, { label: customer.displayName }]}
          />
        }
      >
        {canAdjust ? (
          <Button variant="primary" icon="plus" onClick={() => setOverlay({ correcting: null })}>
            {l.profile.adjust}
          </Button>
        ) : null}
      </PageHeader>
      <Stack gap="page">
        {!goLive.active ? <Notice tone="info">{l.profile.notLive}</Notice> : null}
        <Grid min="md" gap="page">
          {wallets.map((wallet) => (
            <WalletCard key={wallet.wallet} wallet={wallet} />
          ))}
        </Grid>
        <ListSection title={l.profile.ledger}>
          <ListToolbar
            labels={toolbarLabels(t)}
            activeFilters={list.wallet ? 1 : 0}
            onReset={() => updateList({ wallet: '' })}
            reload={{ label: t.common.reload, onClick: () => void ledger.reload() }}
            filters={
              <FacetedFilter
                label={l.profile.wallet}
                clearLabel={t.common.list.clearChoice}
                options={(['SPA', 'BEAUTY'] as const).map((wallet) => ({
                  value: wallet,
                  label: l.wallets[wallet],
                }))}
                selected={list.wallet ? [list.wallet] : []}
                onChange={([wallet]) => updateList({ wallet: wallet ?? '' })}
              />
            }
          />
          <DataTable
            mode="server"
            caption={fill(t.common.list.table, { list: l.profile.ledger })}
            columns={columns}
            rows={rows}
            rowKey={(entry) => entry.id}
            loading={ledger.loading && !ledger.data}
            loadingLabel={t.common.loading}
            error={
              ledger.error ? (
                <ErrorState error={ledger.error} t={t} onRetry={() => void ledger.reload()} />
              ) : undefined
            }
            empty={
              ledger.data ? (
                <Empty>{list.wallet ? l.profile.noEntriesFiltered : l.profile.noEntries}</Empty>
              ) : undefined
            }
            paging={{
              page: list.page,
              pageSize: LOYALTY_PAGE_SIZE,
              total: ledger.data?.total ?? rows.length,
              onPageChange: (page) => updateList({ page }),
              labels: paginationLabels(t, l.profile.ledger),
            }}
          />
        </ListSection>
      </Stack>
      {overlay ? (
        <AdjustDialog
          userId={userId}
          correcting={overlay.correcting}
          onDone={done}
          onClose={() => setOverlay(null)}
        />
      ) : null}
    </>
  );
}

/** One wallet: balance, tier and the distance to the next tier (the tier is derived from the balance). */
function WalletCard({ wallet }: { wallet: LoyaltyWalletResponse }) {
  const { locale } = useWorkforce();
  const l = loyaltyDictionary(locale);
  return (
    <Card as="section" aria-label={l.wallets[wallet.wallet]}>
      <CardHeader
        title={l.wallets[wallet.wallet]}
        actions={<Badge tone={tierTone(wallet.tier)}>{l.tiers[wallet.tier]}</Badge>}
      />
      <Stat
        label={l.profile.balance}
        value={wallet.balancePoints}
        format={{ valueFormat: 'count', locale }}
        note={
          wallet.nextTier && wallet.pointsToNextTier !== null
            ? fill(l.profile.toGo, {
                n: formatPoints(wallet.pointsToNextTier, locale),
                tier: l.tiers[wallet.nextTier],
              })
            : l.profile.topTier
        }
      />
    </Card>
  );
}
