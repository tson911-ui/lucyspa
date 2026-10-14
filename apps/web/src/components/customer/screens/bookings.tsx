'use client';

import type {
  CustomerBookingDetail,
  CustomerBookingListResponse,
  CustomerBookingSummary,
  CustomerInvoiceListResponse,
  CustomerLoyaltySummaryResponse,
} from '@lucy-spa/contracts';
import {
  Button,
  buttonClass,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  EmptyState,
  ErrorState,
  Icon,
  ListSection,
  Notice,
  Reveal,
  RowActions,
  Skeleton,
  type DataTableColumn,
} from '@lucy-spa/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { fill } from '../../../i18n/customer';
import { customerLoyaltyDictionary } from '../../../i18n/customer-loyalty';
import { loyaltyDictionary } from '../../../i18n/loyalty';
import { getWorkforceDictionary } from '../../../i18n/workforce';
import { ApiError } from '../../../lib/api/client';
import {
  customerErrorMessage,
  formatDateTime,
  formatTime,
  formatVndRange,
  statusTone,
} from '../../../lib/customer/booking';
import { formatBusinessDate, formatVnd, invoiceTone } from '../../../lib/customer/invoice';
import { formatPoints } from '../../../lib/workforce/loyalty';
import { useClientPaging } from '../../../lib/workforce/use-client-paging';
import { useUnreadCount } from '../../notifications/inbox';
import { Badge, Empty } from '../../workforce/ui';
import { AccountScreen, accountSections } from '../account-frame';
import { useCustomer, useCustomerAccount } from '../session';

export function useFetch<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = useState<{ data: T | null; error: unknown }>({
    data: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ data: null, error: null });
    load()
      .then((data) => active && setState({ data, error: null }))
      .catch((error: unknown) => active && setState({ data: null, error }));
    return () => {
      active = false;
    };
    // `key` captures every input of `load`.
  }, [key, attempt]);
  return {
    ...state,
    retry: useCallback(() => setAttempt((value) => value + 1), []),
    set: (data: T) => setState({ data, error: null }),
  };
}

export function LoadState({ error, retry }: { error: unknown; retry: () => void }) {
  const { t } = useCustomer();
  if (!error) {
    return (
      <div role="status">
        <span className="ls-hint">{t.common.loading}</span>
        <Skeleton lines={3} />
      </div>
    );
  }
  return (
    <ErrorState
      message={customerErrorMessage(error, t)}
      reference={error instanceof ApiError ? error.requestId : null}
      referenceLabel={t.errors.reference}
      onRetry={retry}
      retryLabel={t.common.reload}
    />
  );
}

/** A page whose record is missing: the notice and the way back, in the page's own frame. */
export function NotFoundPage({
  message,
  backHref,
  backLabel,
}: {
  message: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <AccountScreen title={backLabel} narrow>
      <Notice tone="warning">{message}</Notice>
      <div>
        <Link href={backHref} className={buttonClass('secondary')}>
          {backLabel}
        </Link>
      </div>
    </AccountScreen>
  );
}

/** Bookings as one table (Part 2 contract 5.6): the time is the link to the booking, the row menu opens it too. */
function BookingsTable({
  items,
  listName,
  empty,
  paged = true,
  loading = false,
  skeletonRows = 5,
}: {
  items: readonly CustomerBookingSummary[];
  listName: string;
  empty: ReactNode;
  /** The overview shows a fixed short list and says so instead of paging. */
  paged?: boolean;
  /** Skeleton rows in the final layout while the bookings load (what follows the table does not move). */
  loading?: boolean;
  skeletonRows?: number;
}) {
  const { t, locale, base } = useCustomer();
  const router = useRouter();
  const w = getWorkforceDictionary(locale);
  const paging = useClientPaging(w, listName);
  const columns: DataTableColumn<CustomerBookingSummary>[] = [
    {
      key: 'when',
      header: t.bookings.columns.when,
      mobileTitle: true,
      cell: (item) => (
        <Link className="ls-link" href={`${base}/bookings/${item.id}`}>
          {formatDateTime(item.startsAt, item.branch.timezone, locale)}
        </Link>
      ),
    },
    {
      key: 'services',
      header: t.bookings.columns.services,
      truncate: true,
      width: 'lg',
      // The first service and "+N" for the rest: a cell holds one short value (frontend rule 8).
      cell: (item) => {
        const [first, ...rest] = item.serviceNames.map((name) =>
          locale === 'vi' ? name.vi : name.en,
        );
        return first === undefined ? '—' : rest.length > 0 ? `${first} +${rest.length}` : first;
      },
    },
    {
      key: 'branch',
      header: t.bookings.columns.branch,
      hideBelow: 'lg',
      truncate: true,
      cell: (item) => item.branch.name,
    },
    {
      key: 'status',
      header: t.bookings.columns.status,
      cell: (item) => (
        <Badge tone={statusTone(item.status)}>{t.bookings.status[item.status]}</Badge>
      ),
    },
    {
      key: 'actions',
      header: t.bookings.columns.actions,
      actions: true,
      cell: (item) => (
        <RowActions
          menuLabel={fill(t.bookings.actionsFor, { code: item.code })}
          items={[
            {
              id: 'open',
              label: t.bookings.open,
              icon: 'eye',
              onSelect: () => router.push(`${base}/bookings/${item.id}`),
            },
          ]}
        />
      ),
    },
  ];
  // One branch only: a column that says the same thing on every row is left out.
  const oneBranch = new Set(items.map((item) => item.branch.name)).size <= 1;
  return (
    <DataTable
      mode="client"
      className="ls-cards-one-line"
      caption={fill(w.common.list.table, { list: listName })}
      columns={oneBranch ? columns.filter((column) => column.key !== 'branch') : columns}
      rows={items}
      rowKey={(item) => item.id}
      empty={empty}
      loading={loading}
      loadingLabel={t.common.loading}
      skeletonRows={skeletonRows}
      paging={
        paged ? paging : { off: 'A fixed short list on the overview; the full list has the pager.' }
      }
    />
  );
}

/**
 * One summary card of the account home (DESIGN.md 9.2): a heading, a short line or two, and a pill that says where the card goes. The whole
 * card is one link; hovering it fills the pill (rule 4), not the card.
 */
function SummaryCard({
  href,
  title,
  cta,
  children,
}: {
  href: string;
  title: string;
  cta: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className="ls-acct-card">
      <h2 className="ls-acct-card-title">{title}</h2>
      <div className="ls-acct-card-body">{children}</div>
      <span className="ls-acct-card-cta">
        {cta}
        <Icon name="chevron-right" size={16} aria-hidden="true" />
      </span>
    </Link>
  );
}

/** The member area home: a greeting and four cards (next appointment, points, latest invoice, notifications), each one link. */
export function CustomerHomeScreen() {
  const { api, t, locale, base } = useCustomer();
  const { account } = useCustomerAccount();
  const bookings = useFetch(
    () => api.get<CustomerBookingListResponse>('/api/v1/me/bookings'),
    'home',
  );
  const loyalty = useFetch(
    () => api.get<CustomerLoyaltySummaryResponse>('/api/v1/me/loyalty'),
    'home-loyalty',
  );
  const invoices = useFetch(
    () => api.get<CustomerInvoiceListResponse>('/api/v1/me/invoices'),
    'home-invoices',
  );
  const unread = useUnreadCount(api);
  const points = customerLoyaltyDictionary(locale);
  const l = loyaltyDictionary(locale);
  const next = bookings.data?.upcoming[0];
  const latest = invoices.data?.invoices[0];
  const quiet = (text: string) => <p className="ls-acct-card-note">{text}</p>;
  const loading = <Skeleton lines={2} />;
  return (
    <AccountScreen
      title={t.home.title}
      description={`${fill(t.home.greeting, { name: account.displayName })} ${t.home.intro}`}
    >
      <div className="ls-acct-grid">
        <Reveal index={0}>
          <SummaryCard
            href={next ? `${base}/bookings/${next.id}` : `${base}/book`}
            title={t.home.upcoming}
            cta={next ? t.home.openBooking : t.home.bookCta}
          >
            {bookings.error ? (
              quiet(customerErrorMessage(bookings.error, t))
            ) : !bookings.data ? (
              loading
            ) : next ? (
              <>
                <p className="ls-acct-card-figure">
                  {formatDateTime(next.startsAt, next.branch.timezone, locale)}
                </p>
                <p className="ls-acct-card-note">
                  {next.serviceNames
                    .map((name) => (locale === 'vi' ? name.vi : name.en))
                    .join(', ')}
                </p>
                <Badge tone={statusTone(next.status)}>{t.bookings.status[next.status]}</Badge>
              </>
            ) : (
              quiet(t.home.none)
            )}
          </SummaryCard>
        </Reveal>
        <Reveal index={1}>
          <SummaryCard href={`${base}/loyalty`} title={t.home.hubRewards} cta={t.home.openPoints}>
            {loyalty.error ? (
              quiet(customerErrorMessage(loyalty.error, t))
            ) : !loyalty.data ? (
              loading
            ) : !loyalty.data.live ? (
              quiet(points.notLive)
            ) : (
              <dl className="ls-acct-points">
                {loyalty.data.wallets.map((wallet) => (
                  <div key={wallet.wallet}>
                    <dt>{l.wallets[wallet.wallet]}</dt>
                    <dd>
                      {formatPoints(wallet.balancePoints, locale)} · {l.tiers[wallet.tier]}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </SummaryCard>
        </Reveal>
        <Reveal index={2}>
          <SummaryCard
            href={latest ? `${base}/invoices/${latest.id}` : `${base}/invoices`}
            title={t.home.lastInvoice}
            cta={t.home.openInvoices}
          >
            {invoices.error ? (
              quiet(customerErrorMessage(invoices.error, t))
            ) : !invoices.data ? (
              loading
            ) : latest ? (
              <>
                <p className="ls-acct-card-figure">{formatVnd(latest.totalVnd, locale)}</p>
                <p className="ls-acct-card-note">
                  {formatBusinessDate(latest.businessDate, locale)}
                </p>
                <Badge tone={invoiceTone(latest.status)}>{t.invoices.status[latest.status]}</Badge>
              </>
            ) : (
              quiet(t.home.noInvoice)
            )}
          </SummaryCard>
        </Reveal>
        <Reveal index={3}>
          <SummaryCard
            href={`${base}/notifications`}
            title={t.home.hubNotifications}
            cta={t.home.openNotifications}
          >
            {unread.failed
              ? quiet(t.errors.unavailable)
              : unread.count === null
                ? loading
                : quiet(
                    unread.count > 0
                      ? fill(t.home.unreadCount, { count: unread.count })
                      : t.home.unreadNone,
                  )}
          </SummaryCard>
        </Reveal>
      </div>
      {/* A phone has no tabs: the same six places as one list. */}
      <nav aria-label={t.nav.menu} className="ls-acct-list">
        <ul className="ls-hub">
          {accountSections(t, base)
            .filter((section) => section.key !== 'home')
            .map((section) => (
              <li key={section.key}>
                <Link href={section.href}>
                  <span>{section.label}</span>
                  <Icon name="chevron-right" size={16} aria-hidden="true" />
                </Link>
              </li>
            ))}
        </ul>
      </nav>
    </AccountScreen>
  );
}

/** "Lịch hẹn của tôi": upcoming and history, both from the server. */
export function CustomerBookingsScreen() {
  const { api, t, base } = useCustomer();
  const list = useFetch(() => api.get<CustomerBookingListResponse>('/api/v1/me/bookings'), 'list');
  return (
    <AccountScreen title={t.bookings.title}>
      {list.data && list.data.upcoming.length === 0 && list.data.history.length === 0 ? (
        <EmptyState
          icon="calendar-check"
          action={
            <Link href={`${base}/book`} className={buttonClass('primary')}>
              {t.home.bookCta}
            </Link>
          }
        >
          {t.bookings.emptyAll}
        </EmptyState>
      ) : list.data ? (
        <>
          <Reveal>
            <ListSection title={t.bookings.upcoming}>
              {list.data.upcoming.length === 0 ? (
                <p className="ls-empty-line">{t.bookings.emptyUpcoming}</p>
              ) : (
                <BookingsTable
                  items={list.data.upcoming}
                  listName={t.bookings.upcoming}
                  empty={<Empty>{t.bookings.emptyUpcoming}</Empty>}
                />
              )}
            </ListSection>
          </Reveal>
          <Reveal>
            <ListSection title={t.bookings.history}>
              {list.data.history.length === 0 ? (
                <p className="ls-empty-line">{t.bookings.emptyHistory}</p>
              ) : (
                <BookingsTable
                  items={list.data.history}
                  listName={t.bookings.history}
                  empty={<Empty>{t.bookings.emptyHistory}</Empty>}
                />
              )}
            </ListSection>
          </Reveal>
        </>
      ) : (
        <LoadState error={list.error} retry={list.retry} />
      )}
    </AccountScreen>
  );
}

/** One own booking; cancellation until service START (O3), decided by the server. */
export function CustomerBookingDetailScreen({ id }: { id: string }) {
  const { api, t, locale, base } = useCustomer();
  const detail = useFetch(() => api.get<CustomerBookingDetail>(`/api/v1/me/bookings/${id}`), id);
  const [cancelling, setCancelling] = useState(false);
  const [message, setMessage] = useState<{
    tone: 'success' | 'danger' | 'warning';
    text: string;
  } | null>(null);

  if (!detail.data) {
    if (detail.error instanceof ApiError && detail.error.code === 'NOT_FOUND') {
      return (
        <NotFoundPage
          message={t.bookings.notFound}
          backHref={`${base}/bookings`}
          backLabel={t.bookings.title}
        />
      );
    }
    return (
      <AccountScreen title={t.bookings.detailTitle} narrow>
        <LoadState error={detail.error} retry={detail.retry} />
      </AccountScreen>
    );
  }
  const booking = detail.data;
  const zone = booking.branch.timezone;
  const recipient = (key: string) => {
    const entry = booking.recipients.find((item) => item.key === key);
    if (!entry) return '';
    return entry.relation === 'SELF'
      ? t.book.self
      : `${entry.displayName ?? ''} (${t.book.relations[entry.relation]})`;
  };

  async function cancel(reason?: string) {
    try {
      const result = await api.post<CustomerBookingDetail>(`/api/v1/me/bookings/${id}/cancel`, {
        ...(reason ? { reason } : {}),
      });
      detail.set(result);
      setCancelling(false);
      setMessage(
        result.cancelledLate
          ? { tone: 'warning', text: `${t.bookings.cancelled} ${t.bookings.cancelledLate}` }
          : { tone: 'success', text: t.bookings.cancelled },
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === 'BOOKING_CANCEL_NOT_ALLOWED') {
        // The booking moved on while the dialog was open: show the reason on the page and reload the record.
        setCancelling(false);
        setMessage({ tone: 'danger', text: customerErrorMessage(error, t) });
        detail.retry();
        return;
      }
      throw error;
    }
  }

  return (
    <AccountScreen
      title={t.bookings.detailTitle}
      description={booking.code}
      actions={
        booking.canCancel ? (
          <Button variant="danger-outline" onClick={() => setCancelling(true)}>
            {t.bookings.cancelTitle}
          </Button>
        ) : undefined
      }
    >
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <div className="ls-order-layout ls-order-layout-aside-first">
        <Reveal>
          <Card as="section" aria-label={t.bookings.detailTitle} className="ls-order-aside">
            <DescriptionList
              items={[
                { label: t.bookings.code, value: booking.code },
                { label: t.book.branch, value: booking.branch.name },
                {
                  label: t.book.when,
                  value: `${formatDateTime(booking.startsAt, zone, locale)} – ${formatTime(booking.endsAt, zone, locale)}`,
                },
                {
                  label: t.bookings.statusLabel,
                  value: (
                    <Badge tone={statusTone(booking.status)}>
                      {t.bookings.status[booking.status]}
                    </Badge>
                  ),
                },
              ]}
            />
          </Card>
        </Reveal>
        <Reveal>
          <Card as="section" aria-label={t.bookings.services} className="ls-order-main-card">
            <CardHeader title={t.bookings.services} />
            <ul className="ls-line-list">
              {booking.lines.map((line) => (
                <li key={line.sequence} className="ls-line-item">
                  <p className="ls-line-title">
                    {line.sequence}. {locale === 'vi' ? line.serviceNameVi : line.serviceNameEn}
                  </p>
                  <p className="ls-line-price">
                    {formatVndRange(line.priceMinVnd, line.priceMaxVnd, locale)}
                    {line.pricingUnit === 'PER_NAIL' ? ` ${t.book.perNail}` : ''}
                  </p>
                  <p className="ls-line-meta">
                    {formatTime(line.startsAt, zone, locale)}–
                    {formatTime(line.endsAt, zone, locale)} ·{' '}
                    {fill(t.book.duration, { minutes: line.durationMinutes })}
                  </p>
                  <p className="ls-line-meta">
                    {t.bookings.recipient}: {recipient(line.recipientKey)} · {t.bookings.staff}:{' '}
                    {line.employee.displayName}
                    {line.assignmentMode === 'ANY' ? ` (${t.bookings.anyAssigned})` : ''}
                  </p>
                </li>
              ))}
            </ul>
            <p className="ls-detail-note">{t.book.priceNote}</p>
          </Card>
        </Reveal>
      </div>
      {cancelling ? (
        <ConfirmDialog
          title={t.bookings.cancelTitle}
          description={t.bookings.cancelIntro}
          facts={[
            { label: t.bookings.code, value: booking.code },
            { label: t.book.when, value: formatDateTime(booking.startsAt, zone, locale) },
          ]}
          tone="danger"
          confirmLabel={t.bookings.cancelConfirm}
          busyLabel={t.bookings.cancelling}
          cancelLabel={t.bookings.keep}
          reasonField={{ label: t.bookings.cancelReason }}
          referenceLabel={t.errors.reference}
          describeError={(error) => ({
            message: customerErrorMessage(error, t),
            reference: error instanceof ApiError ? error.requestId : null,
          })}
          onCancel={() => setCancelling(false)}
          onConfirm={(reason) => cancel(reason)}
        />
      ) : null}
    </AccountScreen>
  );
}
