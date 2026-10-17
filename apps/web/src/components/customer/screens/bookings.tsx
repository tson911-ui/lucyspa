'use client';

import type {
  CustomerBookingDetail,
  CustomerBookingListResponse,
  CustomerBookingSummary,
  CustomerInvoiceListResponse,
  CustomerLoyaltySummaryResponse,
} from '@lucy-spa/contracts';
import {
  Badge,
  Button,
  buttonClass,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  ErrorState,
  Icon,
  ListSection,
  Notice,
  Skeleton,
  type DataTableColumn,
} from '@lucy-spa/ui';
import Link from 'next/link';
import { NAV_TRANSITION } from '../../../lib/nav-transition';
import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { fill } from '../../../i18n/customer';
import { customerLoyaltyDictionary } from '../../../i18n/customer-loyalty';
import { loyaltyNames as loyaltyDictionary } from '../../../i18n/loyalty-names';
import { ApiError } from '../../../lib/api/client';
import {
  customerErrorMessage,
  formatDateTime,
  formatTime,
  formatVndRange,
  statusTone,
} from '../../../lib/customer/booking';
import {
  cachedRead,
  invalidateCachedReads,
  peekCachedRead,
} from '../../../lib/customer/fetch-cache';
import { formatBusinessDate, formatVnd, invoiceTone } from '../../../lib/customer/invoice';
import { useUnreadCount } from '../../notifications/unread';
import { AccountScreen, accountSections } from '../account-frame';
import { formatPoints } from '../member-format';
import { useMemberPaging } from '../member-paging';
import { MemberEmpty, RowLink, StatusBadge } from '../member-ui';
import { useCustomer, useCustomerAccount } from '../session';

/**
 * Loads data for a screen; a change of `key` (every input of `load`) loads again. With `cache` (the request's own identity: its path
 * and query, never a short name that two screens could share) reads are shared and reused for a short while (lib/customer/fetch-cache):
 * two components asking for the same thing send one request, and a recent answer paints at once. Without it every mount reads afresh
 * (the shop screens' behaviour, unchanged).
 */
export function useFetch<T>(load: () => Promise<T>, key: string, options: { cache?: string } = {}) {
  const cache = options.cache;
  // The first render matches the server's (nothing loaded): reading the shared cache during render made a part that hydrates after
  // another (streamed Suspense) paint data where the server painted the loading state, a hydration text mismatch (React #418). The
  // recent answer is applied in a layout effect instead: before the browser paints, so still no loading flash.
  const [state, setState] = useState<{ data: T | null; error: unknown }>({
    data: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  useLayoutEffect(() => {
    let active = true;
    const recent = cache ? peekCachedRead<T>(cache) : undefined;
    setState({ data: recent ?? null, error: null });
    if (recent !== undefined) return;
    (cache ? cachedRead(cache, load) : load())
      .then((data) => active && setState({ data, error: null }))
      .catch((error: unknown) => active && setState({ data: null, error }));
    return () => {
      active = false;
    };
    // `key` captures every input of `load`; `cache` follows it.
  }, [key, attempt]);
  return {
    ...state,
    retry: useCallback(() => {
      if (cache) invalidateCachedReads(cache);
      setAttempt((value) => value + 1);
    }, [cache]),
    set: (data: T) => {
      // A screen that writes shows the server's answer; the cached read of the same thing is now old.
      if (cache) invalidateCachedReads(cache);
      setState({ data, error: null });
    },
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

/** A page whose record is missing: the page says so in its heading and offers the way back to the list, in the page's own frame. */
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
    <AccountScreen title={message} narrow>
      <div>
        <Link href={backHref} className={buttonClass('secondary')} transitionTypes={NAV_TRANSITION}>
          {backLabel}
        </Link>
      </div>
    </AccountScreen>
  );
}

/** The services of a booking in full (they wrap; nothing is cut, C15). */
function servicesText(item: CustomerBookingSummary, locale: 'vi' | 'en'): string {
  return item.serviceNames.map((name) => (locale === 'vi' ? name.vi : name.en)).join(', ');
}

/** A neutral booking state still shows an icon with its word (B18): a finished visit is a tick. */
function BookingStatus({ status }: { status: CustomerBookingSummary['status'] }) {
  const { t } = useCustomer();
  return (
    <StatusBadge tone={statusTone(status)} icon={status === 'COMPLETED' ? 'check' : undefined}>
      {t.bookings.status[status]}
    </StatusBadge>
  );
}

/**
 * Bookings as one hairline table (DESIGN.md 8.4): the whole row opens the booking (the time is its name), so there is no row menu that
 * repeats the link. Below 640 px the rows stay in one surface (`phoneRows="compact"`), not one card per booking.
 */
function BookingsTable({
  items,
  listName,
  pageParam,
}: {
  items: readonly CustomerBookingSummary[];
  listName: string;
  /** The name of this list's page in the address bar (two lists share the screen). */
  pageParam: string;
}) {
  const { t, locale, base } = useCustomer();
  const paging = useMemberPaging(t, listName, pageParam);
  // One branch only: a column that says the same thing on every row is left out.
  const oneBranch = new Set(items.map((item) => item.branch.name)).size <= 1;
  // One column set per language, area and branch case (not per render): a client table re-sorts when its columns change (rbp-ui).
  const columns = useMemo<DataTableColumn<CustomerBookingSummary>[]>(() => {
    const all: DataTableColumn<CustomerBookingSummary>[] = [
      {
        key: 'when',
        header: t.bookings.columns.when,
        mobileTitle: true,
        cell: (item) => {
          const when = formatDateTime(item.startsAt, item.branch.timezone, locale);
          return (
            <RowLink
              href={`${base}/bookings/${item.id}`}
              label={`${when}, ${servicesText(item, locale)}`}
            >
              {when}
            </RowLink>
          );
        },
      },
      {
        key: 'services',
        header: t.bookings.columns.services,
        cell: (item) => servicesText(item, locale) || '—',
      },
      {
        key: 'branch',
        header: t.bookings.columns.branch,
        hideBelow: 'lg',
        cell: (item) => item.branch.name,
      },
      {
        key: 'status',
        header: t.bookings.columns.status,
        cell: (item) => <BookingStatus status={item.status} />,
      },
    ];
    return oneBranch ? all.filter((column) => column.key !== 'branch') : all;
  }, [t, locale, base, oneBranch]);
  return (
    <DataTable
      mode="client"
      className="ls-mem-rows"
      phoneRows="compact"
      drillDown
      caption={fill(t.list.table, { list: listName })}
      columns={columns}
      rows={items}
      rowKey={(item) => item.id}
      paging={paging}
    />
  );
}

/**
 * One summary card of the account home (DESIGN.md 9.2, B19): the whole card is one link (its heading and a chevron say where it goes);
 * nothing inside it is a button.
 */
function SummaryCard({
  href,
  title,
  children,
}: {
  href: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className="ls-acct-card ls-mem-card" transitionTypes={NAV_TRANSITION}>
      <div className="ls-mem-card-head">
        <h2 className="ls-acct-card-title">{title}</h2>
        <Icon name="chevron-right" size={20} aria-hidden="true" />
      </div>
      <div className="ls-acct-card-body">{children}</div>
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
    { cache: '/api/v1/me/bookings' },
  );
  const loyalty = useFetch(
    () => api.get<CustomerLoyaltySummaryResponse>('/api/v1/me/loyalty'),
    'home-loyalty',
    { cache: '/api/v1/me/loyalty' },
  );
  const invoices = useFetch(
    () => api.get<CustomerInvoiceListResponse>('/api/v1/me/invoices'),
    'home-invoices',
    { cache: '/api/v1/me/invoices' },
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
      title={fill(t.home.greetingTitle, { name: account.displayName })}
      description={t.home.intro}
    >
      <div className="ls-acct-grid ls-mem-grid">
        <SummaryCard
          href={next ? `${base}/bookings/${next.id}` : `${base}/book`}
          title={t.home.upcoming}
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
              <p className="ls-acct-card-note">{servicesText(next, locale)}</p>
              <BookingStatus status={next.status} />
            </>
          ) : (
            <>
              {quiet(t.home.none)}
              {quiet(t.home.bookHint)}
            </>
          )}
        </SummaryCard>
        <SummaryCard href={`${base}/loyalty`} title={t.home.hubRewards}>
          {loyalty.error ? (
            quiet(customerErrorMessage(loyalty.error, t))
          ) : !loyalty.data ? (
            loading
          ) : !loyalty.data.live ? (
            quiet(points.notLive)
          ) : (
            <dl className="ls-mem-facts">
              {loyalty.data.wallets.map((wallet) => (
                <div key={wallet.wallet}>
                  <dt>{l.wallets[wallet.wallet]}</dt>
                  <dd>
                    <span>
                      {fill(t.home.points, { n: formatPoints(wallet.balancePoints, locale) })}
                    </span>
                    <Badge tone="neutral" icon="award">
                      {l.tiers[wallet.tier]}
                    </Badge>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </SummaryCard>
        <SummaryCard
          href={latest ? `${base}/invoices/${latest.id}` : `${base}/invoices`}
          title={t.home.lastInvoice}
        >
          {invoices.error ? (
            quiet(customerErrorMessage(invoices.error, t))
          ) : !invoices.data ? (
            loading
          ) : latest ? (
            <>
              <p className="ls-acct-card-figure">{formatVnd(latest.totalVnd, locale)}</p>
              <p className="ls-acct-card-note">{formatBusinessDate(latest.businessDate, locale)}</p>
              <StatusBadge
                tone={invoiceTone(latest.status)}
                icon={latest.status === 'CANCELLED' ? 'x-circle' : undefined}
              >
                {t.invoices.status[latest.status]}
              </StatusBadge>
            </>
          ) : (
            quiet(t.home.noInvoice)
          )}
        </SummaryCard>
        <SummaryCard href={`${base}/notifications`} title={t.home.hubNotifications}>
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
      </div>
      {/* A phone has no tabs: the same six places as one list (below 768 px only; the tabs take over from there). */}
      <nav aria-label={t.nav.menu} className="ls-acct-list">
        <ul className="ls-hub">
          {accountSections(t, base)
            .filter((section) => section.key !== 'home')
            .map((section) => (
              <li key={section.key}>
                <Link href={section.href} transitionTypes={NAV_TRANSITION}>
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
  const list = useFetch(() => api.get<CustomerBookingListResponse>('/api/v1/me/bookings'), 'list', {
    cache: '/api/v1/me/bookings',
  });
  return (
    <AccountScreen title={t.bookings.title}>
      {list.data && list.data.upcoming.length === 0 && list.data.history.length === 0 ? (
        <MemberEmpty
          icon="calendar-check"
          title={t.bookings.emptyTitle}
          actionHref={`${base}/book`}
          actionLabel={t.home.bookCta}
        >
          {t.bookings.emptyAll}
        </MemberEmpty>
      ) : list.data ? (
        <div className="ls-mem-sections">
          <ListSection title={t.bookings.upcoming}>
            {list.data.upcoming.length === 0 ? (
              <p className="ls-empty-line">{t.bookings.emptyUpcoming}</p>
            ) : (
              <BookingsTable
                items={list.data.upcoming}
                listName={t.bookings.upcoming}
                pageParam="upcomingPage"
              />
            )}
          </ListSection>
          <ListSection title={t.bookings.history}>
            {list.data.history.length === 0 ? (
              <p className="ls-empty-line">{t.bookings.emptyHistory}</p>
            ) : (
              <BookingsTable
                items={list.data.history}
                listName={t.bookings.history}
                pageParam="historyPage"
              />
            )}
          </ListSection>
        </div>
      ) : (
        <LoadState error={list.error} retry={list.retry} />
      )}
    </AccountScreen>
  );
}

/** One own booking; cancellation until service START (O3), decided by the server. */
export function CustomerBookingDetailScreen({ id }: { id: string }) {
  const { api, t, locale, base } = useCustomer();
  const detail = useFetch(() => api.get<CustomerBookingDetail>(`/api/v1/me/bookings/${id}`), id, {
    cache: `/api/v1/me/bookings/${id}`,
  });
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
      <AccountScreen title={t.bookings.detailTitle} backLabel={t.bookings.back} narrow>
        <LoadState error={detail.error} retry={detail.retry} />
      </AccountScreen>
    );
  }
  const booking = detail.data;
  const zone = booking.branch.timezone;
  const when = `${formatDateTime(booking.startsAt, zone, locale)}–${formatTime(booking.endsAt, zone, locale)}`;
  const cancelled = booking.status === 'CANCELLED';
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
      invalidateCachedReads('/api/v1/me/bookings');
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
    <AccountScreen title={t.bookings.detailTitle} description={when} backLabel={t.bookings.back}>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {cancelled && !message ? (
        <p className="ls-mem-status-line">
          <Icon name="x-circle" size={20} aria-hidden="true" />
          {t.bookings.cancelledLine}
        </p>
      ) : null}
      <div className="ls-mem-split">
        <Card as="section" aria-label={t.bookings.services} className="ls-mem-main">
          <CardHeader title={t.bookings.services} />
          <ul className="ls-mem-lines">
            {booking.lines.map((line) => (
              <li key={line.sequence} className="ls-mem-line">
                <div className="ls-mem-line-head">
                  <p className="ls-mem-line-name">
                    {locale === 'vi' ? line.serviceNameVi : line.serviceNameEn}
                  </p>
                  <p className="ls-mem-line-price">
                    {formatVndRange(line.priceMinVnd, line.priceMaxVnd, locale)}
                    {line.pricingUnit === 'PER_NAIL' ? ` ${t.book.perNail}` : ''}
                  </p>
                </div>
                <dl className="ls-mem-facts">
                  <div>
                    <dt>{t.book.when}</dt>
                    <dd>
                      {formatTime(line.startsAt, zone, locale)}–
                      {formatTime(line.endsAt, zone, locale)}
                    </dd>
                  </div>
                  <div>
                    <dt>{t.bookings.durationLabel}</dt>
                    <dd>{fill(t.book.duration, { minutes: line.durationMinutes })}</dd>
                  </div>
                  <div>
                    <dt>{t.bookings.recipient}</dt>
                    <dd>{recipient(line.recipientKey)}</dd>
                  </div>
                  <div>
                    <dt>{t.bookings.staff}</dt>
                    <dd>
                      {line.employee.displayName}
                      {line.assignmentMode === 'ANY' ? ` (${t.bookings.anyAssigned})` : ''}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <p className="ls-mem-note">{t.book.priceNote}</p>
        </Card>
        <Card as="section" aria-label={t.bookings.detailTitle} className="ls-mem-aside">
          <BookingStatus status={booking.status} />
          <DescriptionList
            className="ls-mem-summary"
            items={[
              { label: t.bookings.code, value: <span translate="no">{booking.code}</span> },
              { label: t.book.branch, value: booking.branch.name },
              { label: t.book.when, value: when },
            ]}
          />
          {booking.canCancel ? (
            <div className="ls-mem-aside-actions">
              <Button variant="danger-outline" onClick={() => setCancelling(true)}>
                {t.bookings.cancelOpen}
              </Button>
            </div>
          ) : cancelled ? (
            <div className="ls-mem-aside-actions">
              <Link
                href={`${base}/book`}
                className={buttonClass('primary')}
                transitionTypes={NAV_TRANSITION}
              >
                {t.bookings.bookAgain}
              </Link>
            </div>
          ) : null}
        </Card>
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
