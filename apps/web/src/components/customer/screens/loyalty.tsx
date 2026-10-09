'use client';

import {
  REFERRAL_AWARD_POINTS,
  type CustomerComboResponse,
  type CustomerComboUseResponse,
  type CustomerGiftResponse,
  type CustomerLedgerItemResponse,
  type CustomerLoyaltySummaryResponse,
  type CustomerPageResponse,
  type CustomerReferralItemResponse,
  type LoyaltyWalletResponse,
} from '@lucy-spa/contracts';
import {
  Card,
  CardHeader,
  Cluster,
  DataTable,
  DescriptionList,
  Grid,
  ListSection,
  Notice,
  Page,
  PageHeader,
  Reveal,
  Stat,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useRef, useState } from 'react';
import { fill } from '../../../i18n/customer';
import { customerLoyaltyDictionary } from '../../../i18n/customer-loyalty';
import { loyaltyDictionary, loyaltyWalletInline } from '../../../i18n/loyalty';
import { getWorkforceDictionary } from '../../../i18n/workforce';
import {
  comboTone,
  formatDay,
  formatSignedPoints,
  giftTone,
  historyText,
  tierMarks,
  referralTone,
  tierRows,
  usedByText,
  type TierRow,
} from '../../../lib/customer/loyalty';
import { paginationLabels } from '../../../lib/workforce/list-view';
import { formatPoints, tierTone } from '../../../lib/workforce/loyalty';
import { Badge, Empty } from '../../workforce/ui';
import { useCustomer } from '../session';
import { LoadState, useFetch } from './bookings';

/**
 * "Điểm thưởng và ưu đãi": the signed-in customer's own points, tier, combos, referrals and gifts (Phase 5 P5-10, design 15).
 * Read only; the server answers from the session, and only with masked names for anyone else. While the loyalty programme has
 * not started the page is one notice and nothing else (Owner's answer of 2026-10-05, pending confirmation).
 */
export function CustomerLoyaltyScreen() {
  const { api, locale } = useCustomer();
  const text = customerLoyaltyDictionary(locale);
  const summary = useFetch(
    () => api.get<CustomerLoyaltySummaryResponse>('/api/v1/me/loyalty'),
    'summary',
  );
  const head = <PageHeader title={text.title} description={text.intro} />;
  if (!summary.data) {
    return (
      <Page>
        {head}
        <LoadState error={summary.error} retry={summary.retry} />
      </Page>
    );
  }
  if (!summary.data.live) {
    return (
      <Page>
        {head}
        <Notice tone="info">{text.notLive}</Notice>
      </Page>
    );
  }
  return (
    <Page>
      {head}
      <Grid min="md" gap="page">
        {summary.data.wallets.map((wallet) => (
          <WalletCard key={wallet.wallet} wallet={wallet} />
        ))}
      </Grid>
      <TiersSection
        spa={summary.data.wallets.find((w) => w.wallet === 'SPA')?.tier ?? 'NONE'}
        beauty={summary.data.wallets.find((w) => w.wallet === 'BEAUTY')?.tier ?? 'NONE'}
      />
      <HistorySection />
      <CombosSection />
      <ComboUsesSection />
      <ReferralsSection />
      <GiftsSection />
    </Page>
  );
}

/**
 * One wallet: points, tier, the distance to the next tier and the Member Discount row; both cards carry the same rows, each with
 * the real tier % of its own wallet (the Beauty wallet since Phase 6 P6-11: the server answers each wallet's own tier).
 */
export function WalletCard({ wallet }: { wallet: LoyaltyWalletResponse }) {
  const { locale } = useCustomer();
  const text = customerLoyaltyDictionary(locale);
  const l = loyaltyDictionary(locale);
  return (
    <Reveal>
      <Card as="section" aria-label={l.wallets[wallet.wallet]}>
        <CardHeader
          title={l.wallets[wallet.wallet]}
          actions={<Badge tone={tierTone(wallet.tier)}>{l.tiers[wallet.tier]}</Badge>}
        />
        <Stat
          label={text.points.balance}
          value={wallet.balancePoints}
          format={{ valueFormat: 'count', locale }}
          note={
            wallet.nextTier && wallet.pointsToNextTier !== null
              ? fill(text.points.toGo, {
                  n: formatPoints(wallet.pointsToNextTier, locale),
                  tier: l.tiers[wallet.nextTier],
                })
              : text.points.topTier
          }
        />
        <DescriptionList
          items={[
            {
              label: text.points.memberDiscount,
              value:
                wallet.memberDiscountBp > 0
                  ? `${wallet.memberDiscountBp / 100}%`
                  : text.points.noDiscount,
            },
          ]}
        />
      </Card>
    </Reveal>
  );
}

/** The brand names of the two wallets (the same in both languages) for the tier marks. */
const WALLET_BRANDS = { SPA: 'Lucy Spa', BEAUTY: 'Lucy Beauty' } as const;

/**
 * The five tiers with their points and Member Discount, read from the shared tier table. The customer's own tiers are marked: one
 * badge when both wallets are in the same tier, one badge for each wallet when they differ (the two wallets have their own tier).
 */
export function TiersSection({
  spa,
  beauty,
}: {
  spa: LoyaltyWalletResponse['tier'];
  beauty: LoyaltyWalletResponse['tier'];
}) {
  const { locale } = useCustomer();
  const text = customerLoyaltyDictionary(locale);
  const l = loyaltyDictionary(locale);
  const w = getWorkforceDictionary(locale);
  const columns: DataTableColumn<TierRow>[] = [
    {
      key: 'tier',
      header: text.tiers.columns.tier,
      mobileTitle: true,
      cell: (row) => (
        <span>
          <Cluster gap="inline">
            {l.tiers[row.tier]}
            {tierMarks(row.tier, spa, beauty, text.tiers, WALLET_BRANDS).map((mark) => (
              <Badge key={mark} tone={tierTone(row.tier)}>
                {mark}
              </Badge>
            ))}
          </Cluster>
        </span>
      ),
    },
    {
      key: 'points',
      header: text.tiers.columns.points,
      numeric: true,
      cell: (row) => formatPoints(row.fromPoints, locale),
    },
    {
      key: 'discount',
      header: text.tiers.columns.discount,
      numeric: true,
      cell: (row) => `${row.discountPercent}%`,
    },
  ];
  return (
    <Reveal>
      <ListSection title={text.tiers.title}>
        <p className="ls-hint">{text.tiers.rule}</p>
        <DataTable
          mode="client"
          caption={fill(w.common.list.table, { list: text.tiers.title })}
          columns={columns}
          rows={tierRows()}
          rowKey={(row) => row.tier}
          selectedKey={spa === beauty && spa !== 'NONE' ? spa : undefined}
          paging={{ off: 'The five tiers of the locked tier table: a fixed short list.' }}
        />
      </ListSection>
    </Reveal>
  );
}

/** A section of the page: a heading and one server-paged table (20 rows a page). */
function PagedSection<T extends { id: string }>({
  title,
  hint,
  path,
  columns,
  empty,
}: {
  title: string;
  hint?: string;
  path: string;
  columns: DataTableColumn<T>[];
  empty: string;
}) {
  const { api, t, locale } = useCustomer();
  const w = getWorkforceDictionary(locale);
  const [page, setPage] = useState(1);
  const list = useFetch(() => api.get<CustomerPageResponse<T>>(path, { page }), `${path}-${page}`);
  // The pager keeps its size while the next page loads.
  const total = useRef(0);
  if (list.data) total.current = list.data.total;
  // Nothing in this section yet: its heading, what it is for and one quiet line, not an empty table in its own box.
  if (list.data && list.data.total === 0) {
    return (
      <Reveal>
        <ListSection title={title}>
          {hint ? <p className="ls-hint">{hint}</p> : null}
          <p className="ls-empty-line">{empty}</p>
        </ListSection>
      </Reveal>
    );
  }
  return (
    <Reveal>
      <ListSection title={title}>
        {hint ? <p className="ls-hint">{hint}</p> : null}
        <DataTable
          mode="server"
          className="ls-cards-one-line"
          caption={fill(w.common.list.table, { list: title })}
          columns={columns}
          rows={list.data?.items ?? []}
          rowKey={(row) => row.id}
          loading={!list.data && !list.error}
          loadingLabel={t.common.loading}
          error={list.error ? <LoadState error={list.error} retry={list.retry} /> : undefined}
          empty={list.data ? <Empty>{empty}</Empty> : undefined}
          paging={{
            page,
            pageSize: list.data?.pageSize ?? 20,
            total: list.data?.total ?? total.current,
            onPageChange: setPage,
            labels: paginationLabels(w, title),
          }}
        />
      </ListSection>
    </Reveal>
  );
}

function HistorySection() {
  const { locale } = useCustomer();
  const text = customerLoyaltyDictionary(locale);
  const l = loyaltyDictionary(locale);
  const columns: DataTableColumn<CustomerLedgerItemResponse>[] = [
    {
      key: 'date',
      header: text.history.columns.date,
      mobileTitle: true,
      cell: (item) => formatDay(item.createdAt, locale),
    },
    {
      key: 'what',
      header: text.history.columns.what,
      truncate: true,
      cell: (item) => historyText(item, text),
    },
    {
      key: 'wallet',
      header: text.history.columns.wallet,
      cell: (item) => l.wallets[item.wallet],
    },
    {
      key: 'points',
      header: text.history.columns.points,
      numeric: true,
      cell: (item) => <strong>{formatSignedPoints(item.points, locale)}</strong>,
    },
  ];
  return (
    <PagedSection<CustomerLedgerItemResponse>
      title={text.history.title}
      path="/api/v1/me/loyalty/history"
      columns={columns}
      empty={text.history.empty}
    />
  );
}

function CombosSection() {
  const { locale } = useCustomer();
  const text = customerLoyaltyDictionary(locale);
  const name = (row: CustomerComboResponse) => (locale === 'vi' ? row.nameVi : row.nameEn);
  const service = (row: CustomerComboResponse) =>
    locale === 'vi' ? row.serviceNameVi : row.serviceNameEn;
  const columns: DataTableColumn<CustomerComboResponse>[] = [
    {
      key: 'combo',
      header: text.combos.columns.combo,
      mobileTitle: true,
      cell: (row) => (
        <>
          <strong>{name(row)}</strong>
          <br />
          <span className="ls-hint">{service(row)}</span>
        </>
      ),
    },
    {
      key: 'status',
      header: text.combos.columns.status,
      cell: (row) => <Badge tone={comboTone(row.status)}>{text.combos.status[row.status]}</Badge>,
    },
    {
      key: 'paid',
      header: text.combos.columns.paid,
      numeric: true,
      cell: (row) => fill(text.combos.left, { left: row.paidLeft, total: row.paidSessions }),
    },
    {
      key: 'bonus',
      header: text.combos.columns.bonus,
      numeric: true,
      cell: (row) =>
        row.bonusSessions > 0
          ? fill(text.combos.left, { left: row.bonusLeft, total: row.bonusSessions })
          : '—',
    },
    {
      key: 'expires',
      header: text.combos.columns.expires,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => (row.expiresAt ? formatDay(row.expiresAt, locale) : text.combos.noExpiry),
    },
  ];
  return (
    <PagedSection<CustomerComboResponse>
      title={text.combos.title}
      hint={text.combos.hint}
      path="/api/v1/me/loyalty/combos"
      columns={columns}
      empty={text.combos.empty}
    />
  );
}

function ComboUsesSection() {
  const { locale } = useCustomer();
  const text = customerLoyaltyDictionary(locale);
  const columns: DataTableColumn<CustomerComboUseResponse>[] = [
    {
      key: 'date',
      header: text.uses.columns.date,
      mobileTitle: true,
      cell: (use) => formatDay(use.usedAt, locale),
    },
    {
      key: 'combo',
      header: text.uses.columns.combo,
      truncate: true,
      cell: (use) => (locale === 'vi' ? use.comboNameVi : use.comboNameEn),
    },
    {
      key: 'who',
      header: text.uses.columns.who,
      truncate: true,
      cell: (use) => usedByText(use, text),
    },
    {
      key: 'session',
      header: text.uses.columns.session,
      hideBelow: 'md',
      cell: (use) => (use.sessionKind === 'PAID' ? text.uses.paid : text.uses.bonus),
    },
    {
      key: 'branch',
      header: text.uses.columns.branch,
      hideBelow: 'lg',
      truncate: true,
      cell: (use) => use.branchName,
    },
  ];
  return (
    <PagedSection<CustomerComboUseResponse>
      title={text.uses.title}
      hint={text.uses.hint}
      path="/api/v1/me/loyalty/combo-uses"
      columns={columns}
      empty={text.uses.empty}
    />
  );
}

function ReferralsSection() {
  const { locale } = useCustomer();
  const text = customerLoyaltyDictionary(locale);
  const walletInline = loyaltyWalletInline(locale);
  const columns: DataTableColumn<CustomerReferralItemResponse>[] = [
    {
      key: 'who',
      header: text.referrals.columns.who,
      mobileTitle: true,
      cell: (row) => row.referredMasked,
    },
    {
      key: 'date',
      header: text.referrals.columns.date,
      hideBelow: 'md',
      cell: (row) => formatDay(row.boundAt, locale),
    },
    {
      key: 'status',
      header: text.referrals.columns.status,
      cell: (row) => (
        <Badge tone={referralTone(row.status)}>{text.referrals.status[row.status]}</Badge>
      ),
    },
  ];
  return (
    <PagedSection<CustomerReferralItemResponse>
      title={text.referrals.title}
      hint={fill(text.referrals.hint, {
        n: REFERRAL_AWARD_POINTS,
        spa: walletInline.SPA,
        beauty: walletInline.BEAUTY,
      })}
      path="/api/v1/me/loyalty/referrals"
      columns={columns}
      empty={text.referrals.empty}
    />
  );
}

function GiftsSection() {
  const { locale } = useCustomer();
  const text = customerLoyaltyDictionary(locale);
  const columns: DataTableColumn<CustomerGiftResponse>[] = [
    {
      key: 'gift',
      header: text.gifts.columns.gift,
      mobileTitle: true,
      truncate: true,
      cell: (row) => (locale === 'vi' ? row.nameVi : row.nameEn),
    },
    {
      key: 'kind',
      header: text.gifts.columns.kind,
      hideBelow: 'md',
      cell: (row) => text.gifts.kind[row.kind],
    },
    {
      key: 'left',
      header: text.gifts.columns.left,
      numeric: true,
      cell: (row) => fill(text.gifts.left, { left: row.quantityLeft, total: row.quantityIssued }),
    },
    {
      key: 'status',
      header: text.gifts.columns.status,
      cell: (row) => <Badge tone={giftTone(row.status)}>{text.gifts.status[row.status]}</Badge>,
    },
    {
      key: 'expires',
      header: text.gifts.columns.expires,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => (row.expiresAt ? formatDay(row.expiresAt, locale) : text.gifts.noExpiry),
    },
  ];
  return (
    <PagedSection<CustomerGiftResponse>
      title={text.gifts.title}
      path="/api/v1/me/loyalty/gifts"
      columns={columns}
      empty={text.gifts.empty}
    />
  );
}
