'use client';

import {
  LOYALTY_TIERS_V1,
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
  Badge,
  Card,
  CardHeader,
  DataTable,
  DescriptionList,
  Icon,
  InfoTable,
  ListSection,
  Notice,
  ProgressBar,
  type DataTableColumn,
  type IconName,
} from '@lucy-spa/ui';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Locale } from '../../../i18n/locales';
import { fill } from '../../../i18n/customer';
import { customerLoyaltyDictionary } from '../../../i18n/customer-loyalty';
import {
  loyaltyNames as loyaltyDictionary,
  loyaltyWalletInline,
} from '../../../i18n/loyalty-names';
import { cachedRead } from '../../../lib/customer/fetch-cache';
import { formatVnd } from '../../../lib/customer/invoice';
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
} from '../../../lib/customer/loyalty';
import { AccountScreen } from '../account-frame';
import { formatPercent, formatPoints, memberPagingLabels } from '../member-format';
import { useUrlPage } from '../member-paging';
import { MemberEmpty, StatusBadge } from '../member-ui';
import { useCustomer } from '../session';
import { LoadState, useFetch } from './bookings';

/** The paged blocks of the page: their first read starts with the summary's, not after it (rbp loyalty.tsx:63-92). */
const LOYALTY_BLOCKS = [
  { path: '/api/v1/me/loyalty/history', param: 'historyPage' },
  { path: '/api/v1/me/loyalty/combos', param: 'combosPage' },
  { path: '/api/v1/me/loyalty/combo-uses', param: 'usesPage' },
  { path: '/api/v1/me/loyalty/referrals', param: 'referralsPage' },
  { path: '/api/v1/me/loyalty/gifts', param: 'giftsPage' },
] as const;

/** The amount that earns one point, as the page prints every amount (Intl, "₫"), never typed into the copy. */
const POINT_VALUE_VND = '1000';

/**
 * "Điểm thưởng và ưu đãi": the signed-in customer's own points, tier, combos, referrals and gifts (Phase 5 P5-10, design 15).
 * Read only; the server answers from the session, and only with masked names for anyone else. While the loyalty programme has
 * not started the page is one notice and nothing else (Owner's answer of 2026-10-05, pending confirmation). Nothing on the page
 * moves by itself: no count-up, no reveal (Owner G1-G8).
 */
export function CustomerLoyaltyScreen() {
  const { api, t, locale, base } = useCustomer();
  const text = customerLoyaltyDictionary(locale);
  const summary = useFetch(
    () => api.get<CustomerLoyaltySummaryResponse>('/api/v1/me/loyalty'),
    'summary',
    { cache: '/api/v1/me/loyalty' },
  );
  // The blocks' reads go out beside the summary's and wait in the shared read cache; each block picks its own up when it mounts.
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    for (const block of LOYALTY_BLOCKS) {
      const page = Math.max(1, Math.floor(Number(search.get(block.param))) || 1);
      cachedRead(`${block.path}?page=${page}`, () => api.get(block.path, { page })).catch(
        () => undefined,
      );
    }
  }, [api]);
  if (!summary.data) {
    return (
      <AccountScreen title={text.title} description={text.intro}>
        <LoadState error={summary.error} retry={summary.retry} />
      </AccountScreen>
    );
  }
  if (!summary.data.live) {
    return (
      <AccountScreen title={text.title} description={text.intro}>
        <Notice tone="info">{text.notLive}</Notice>
      </AccountScreen>
    );
  }
  const wallets = summary.data.wallets;
  const noPointsYet = wallets.every((wallet) => wallet.balancePoints === 0);
  return (
    <AccountScreen title={text.title} description={text.intro}>
      <div className="ls-mem-sections">
        <div className="ls-mem-wallets">
          {wallets.map((wallet) => (
            <WalletCard key={wallet.wallet} wallet={wallet} />
          ))}
        </div>
        {noPointsYet ? (
          <MemberEmpty
            icon="award"
            title={text.start.title}
            actionHref={`${base}/book`}
            actionLabel={t.home.bookCta}
          >
            {fill(text.start.text, { amount: formatVnd(POINT_VALUE_VND, locale) })}
          </MemberEmpty>
        ) : null}
        <TiersSection
          spa={wallets.find((w) => w.wallet === 'SPA')?.tier ?? 'NONE'}
          beauty={wallets.find((w) => w.wallet === 'BEAUTY')?.tier ?? 'NONE'}
        />
        <HistorySection />
        <ListSection title={text.more.title}>
          <div className="ls-mem-subsections">
            <CombosSection />
            <ComboUsesSection />
            <ReferralsSection />
            <GiftsSection />
          </div>
        </ListSection>
      </div>
    </AccountScreen>
  );
}

/**
 * One wallet: points, tier, the distance to the next tier and the Member Discount row; both cards carry the same rows, each with
 * the real tier % of its own wallet (the Beauty wallet since Phase 6 P6-11: the server answers each wallet's own tier). The tier sits
 * on its own line under the title in every card, so the two cards keep one height (B6).
 */
export function WalletCard({ wallet }: { wallet: LoyaltyWalletResponse }) {
  const { locale, t } = useCustomer();
  const text = customerLoyaltyDictionary(locale);
  const l = loyaltyDictionary(locale);
  const toGo =
    wallet.nextTier && wallet.pointsToNextTier !== null
      ? fill(text.points.toGo, {
          n: formatPoints(wallet.pointsToNextTier, locale),
          tier: l.tiers[wallet.nextTier],
        })
      : text.points.topTier;
  // Where the balance sits between the lowest balance of its tier and the lowest balance of the next one (the shared tier table).
  const from = LOYALTY_TIERS_V1.find((entry) => entry.tier === wallet.tier)?.fromPoints ?? 0;
  const upTo = LOYALTY_TIERS_V1.find((entry) => entry.tier === wallet.nextTier)?.fromPoints;
  const progress =
    upTo !== undefined && upTo > from
      ? ((wallet.balancePoints - from) / (upTo - from)) * 100
      : undefined;
  return (
    <Card as="section" aria-label={l.wallets[wallet.wallet]} className="ls-mem-wallet">
      <CardHeader title={l.wallets[wallet.wallet]} />
      <p className="ls-mem-wallet-tier">
        <Badge tone="neutral" icon="award">
          {l.tiers[wallet.tier]}
        </Badge>
      </p>
      <p className="ls-mem-points">
        {fill(t.home.points, { n: formatPoints(wallet.balancePoints, locale) })}
      </p>
      {progress !== undefined ? (
        <div className="ls-acct-progress">
          <ProgressBar value={progress} label={toGo} />
          <p className="ls-acct-progress-text">{toGo}</p>
        </div>
      ) : (
        <p className="ls-acct-progress-text">{toGo}</p>
      )}
      <DescriptionList
        className="ls-mem-summary"
        items={[
          {
            label: text.points.memberDiscount,
            value:
              wallet.memberDiscountBp > 0
                ? formatPercent(wallet.memberDiscountBp / 100, locale)
                : text.points.noDiscount,
          },
        ]}
      />
    </Card>
  );
}

/** The brand names of the two wallets (the same in both languages) for the tier marks. */
const WALLET_BRANDS = { SPA: 'Lucy Spa', BEAUTY: 'Lucy Beauty' } as const;

/**
 * The five tiers with their points and Member Discount, read from the shared tier table, as a real table (wig loyalty.tsx:178) with
 * hairlines (no shadow). The customer's own tiers are marked by a tick and words: one mark when both wallets are in the same tier, one
 * for each wallet when they differ (the two wallets have their own tier). The marks are words in ink, never a tier colour.
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
  return (
    <ListSection title={text.tiers.title}>
      <p className="ls-mem-hint">
        {fill(text.tiers.rule, { amount: formatVnd(POINT_VALUE_VND, locale) })}
      </p>
      <div className="ls-mem-tiers">
        <InfoTable
          header={[
            { node: text.tiers.columns.tier, label: text.tiers.columns.tier },
            { node: text.tiers.columns.points, label: text.tiers.columns.points },
            { node: text.tiers.columns.discount, label: text.tiers.columns.discount },
          ]}
          rows={tierRows().map((row) => [
            <span key="tier" className="ls-mem-tier-cell">
              <span className="ls-mem-tier-name">{l.tiers[row.tier]}</span>
              {tierMarks(row.tier, spa, beauty, text.tiers, WALLET_BRANDS).map((mark) => (
                <span key={mark} className="ls-mem-own">
                  <Icon name="check" size={16} aria-hidden="true" />
                  {mark}
                </span>
              ))}
            </span>,
            formatPoints(row.fromPoints, locale),
            formatPercent(row.discountPercent, locale),
          ])}
        />
      </div>
    </ListSection>
  );
}

/** The heading of one block: a page section (h2) or a block inside the "Combo, quà tặng và giới thiệu" section (h3). */
function Block({ title, level, children }: { title: string; level: 2 | 3; children: ReactNode }) {
  if (level === 2) return <ListSection title={title}>{children}</ListSection>;
  return (
    <section className="ls-mem-subsection">
      <h3 className="ls-mem-subtitle">{title}</h3>
      {children}
    </section>
  );
}

/** A block of the page: a heading and one server-paged table (20 rows a page). */
function PagedSection<T extends { id: string }>({
  title,
  hint,
  path,
  columns,
  empty,
  level = 3,
  pageParam,
}: {
  title: string;
  hint?: string;
  path: string;
  columns: DataTableColumn<T>[];
  empty: string;
  level?: 2 | 3;
  /** This block's page in the address bar (wig loyalty.tsx:233): Back and a reload keep it. */
  pageParam: string;
}) {
  const { api, t } = useCustomer();
  const [page, setPage] = useUrlPage(pageParam);
  const list = useFetch(() => api.get<CustomerPageResponse<T>>(path, { page }), `${path}-${page}`, {
    cache: `${path}?page=${page}`,
  });
  // The pager keeps its size while the next page loads: the last known total, kept in state and updated while rendering (no ref
  // written during render).
  const [total, setTotal] = useState(0);
  if (list.data && list.data.total !== total) setTotal(list.data.total);
  // Nothing in this block yet: its heading, what it is for and one quiet line, not an empty table in its own box.
  if (list.data && list.data.total === 0) {
    return (
      <Block title={title} level={level}>
        {hint ? <p className="ls-mem-hint">{hint}</p> : null}
        <p className="ls-empty-line">{empty}</p>
      </Block>
    );
  }
  return (
    <Block title={title} level={level}>
      {hint ? <p className="ls-mem-hint">{hint}</p> : null}
      <DataTable
        mode="server"
        className="ls-mem-rows"
        phoneRows="compact"
        caption={fill(t.list.table, { list: title })}
        columns={columns}
        rows={list.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={!list.data && !list.error}
        loadingLabel={t.common.loading}
        error={list.error ? <LoadState error={list.error} retry={list.retry} /> : undefined}
        empty={list.data ? <p className="ls-empty-line">{empty}</p> : undefined}
        paging={{
          page,
          pageSize: list.data?.pageSize ?? 20,
          total: list.data?.total ?? total,
          onPageChange: setPage,
          labels: memberPagingLabels(t, title),
        }}
      />
    </Block>
  );
}

/** The columns of this block, built once per language (react-best-practices rerender-memo: not a new array every render). */
function historyColumns(locale: Locale): DataTableColumn<CustomerLedgerItemResponse>[] {
  const text = customerLoyaltyDictionary(locale);
  const l = loyaltyDictionary(locale);
  return [
    {
      key: 'date',
      header: text.history.columns.date,
      mobileTitle: true,
      cell: (item) => formatDay(item.createdAt, locale),
    },
    {
      key: 'what',
      header: text.history.columns.what,
      phoneEmphasis: true,
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
      cell: (item) => formatSignedPoints(item.points, locale),
    },
  ];
}

function HistorySection() {
  const { locale } = useCustomer();
  const text = customerLoyaltyDictionary(locale);
  const columns = useMemo(() => historyColumns(locale), [locale]);
  return (
    <PagedSection<CustomerLedgerItemResponse>
      title={text.history.title}
      path="/api/v1/me/loyalty/history"
      pageParam="historyPage"
      columns={columns}
      empty={text.history.empty}
      level={2}
    />
  );
}

/** A neutral state of a combo or a gift still shows an icon with its word (B18). */
const NEUTRAL_ICONS: Partial<Record<string, IconName>> = {
  USED_UP: 'check',
  EXPIRED: 'clock',
  VOIDED: 'x-circle',
  WAITING: 'clock',
};

/** The columns of this block, built once per language (react-best-practices rerender-memo: not a new array every render). */
function combosColumns(locale: Locale): DataTableColumn<CustomerComboResponse>[] {
  const text = customerLoyaltyDictionary(locale);
  const name = (row: CustomerComboResponse) => (locale === 'vi' ? row.nameVi : row.nameEn);
  const service = (row: CustomerComboResponse) =>
    locale === 'vi' ? row.serviceNameVi : row.serviceNameEn;
  return [
    {
      key: 'combo',
      header: text.combos.columns.combo,
      mobileTitle: true,
      cell: (row) => (
        <span className="ls-mem-cell-stack">
          <span>{name(row)}</span>
          <span className="ls-mem-cell-sub">{service(row)}</span>
        </span>
      ),
    },
    {
      key: 'status',
      header: text.combos.columns.status,
      cell: (row) => (
        <StatusBadge tone={comboTone(row.status)} icon={NEUTRAL_ICONS[row.status]}>
          {text.combos.status[row.status]}
        </StatusBadge>
      ),
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
}

function CombosSection() {
  const { locale } = useCustomer();
  const text = customerLoyaltyDictionary(locale);
  const columns = useMemo(() => combosColumns(locale), [locale]);
  return (
    <PagedSection<CustomerComboResponse>
      title={text.combos.title}
      hint={text.combos.hint}
      path="/api/v1/me/loyalty/combos"
      pageParam="combosPage"
      columns={columns}
      empty={text.combos.empty}
    />
  );
}

/** The columns of this block, built once per language (react-best-practices rerender-memo: not a new array every render). */
function comboUsesColumns(locale: Locale): DataTableColumn<CustomerComboUseResponse>[] {
  const text = customerLoyaltyDictionary(locale);
  return [
    {
      key: 'date',
      header: text.uses.columns.date,
      mobileTitle: true,
      cell: (use) => formatDay(use.usedAt, locale),
    },
    {
      key: 'combo',
      header: text.uses.columns.combo,
      phoneEmphasis: true,
      cell: (use) => (locale === 'vi' ? use.comboNameVi : use.comboNameEn),
    },
    {
      key: 'who',
      header: text.uses.columns.who,
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
      cell: (use) => use.branchName,
    },
  ];
}

function ComboUsesSection() {
  const { locale } = useCustomer();
  const text = customerLoyaltyDictionary(locale);
  const columns = useMemo(() => comboUsesColumns(locale), [locale]);
  return (
    <PagedSection<CustomerComboUseResponse>
      title={text.uses.title}
      hint={text.uses.hint}
      path="/api/v1/me/loyalty/combo-uses"
      pageParam="usesPage"
      columns={columns}
      empty={text.uses.empty}
    />
  );
}

/** The columns of this block, built once per language (react-best-practices rerender-memo: not a new array every render). */
function referralsColumns(locale: Locale): DataTableColumn<CustomerReferralItemResponse>[] {
  const text = customerLoyaltyDictionary(locale);
  return [
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
        <StatusBadge tone={referralTone(row.status)} icon={NEUTRAL_ICONS[row.status]}>
          {text.referrals.status[row.status]}
        </StatusBadge>
      ),
    },
  ];
}

function ReferralsSection() {
  const { locale } = useCustomer();
  const text = customerLoyaltyDictionary(locale);
  const walletInline = loyaltyWalletInline(locale);
  const columns = useMemo(() => referralsColumns(locale), [locale]);
  return (
    <PagedSection<CustomerReferralItemResponse>
      title={text.referrals.title}
      hint={fill(text.referrals.hint, {
        n: REFERRAL_AWARD_POINTS,
        spa: walletInline.SPA,
        beauty: walletInline.BEAUTY,
      })}
      path="/api/v1/me/loyalty/referrals"
      pageParam="referralsPage"
      columns={columns}
      empty={text.referrals.empty}
    />
  );
}

/** The columns of this block, built once per language (react-best-practices rerender-memo: not a new array every render). */
function giftsColumns(locale: Locale): DataTableColumn<CustomerGiftResponse>[] {
  const text = customerLoyaltyDictionary(locale);
  return [
    {
      key: 'gift',
      header: text.gifts.columns.gift,
      mobileTitle: true,
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
      cell: (row) => (
        <StatusBadge tone={giftTone(row.status)} icon={NEUTRAL_ICONS[row.status]}>
          {text.gifts.status[row.status]}
        </StatusBadge>
      ),
    },
    {
      key: 'expires',
      header: text.gifts.columns.expires,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => (row.expiresAt ? formatDay(row.expiresAt, locale) : text.gifts.noExpiry),
    },
  ];
}

function GiftsSection() {
  const { locale } = useCustomer();
  const text = customerLoyaltyDictionary(locale);
  const columns = useMemo(() => giftsColumns(locale), [locale]);
  return (
    <PagedSection<CustomerGiftResponse>
      title={text.gifts.title}
      path="/api/v1/me/loyalty/gifts"
      pageParam="giftsPage"
      columns={columns}
      empty={text.gifts.empty}
    />
  );
}
