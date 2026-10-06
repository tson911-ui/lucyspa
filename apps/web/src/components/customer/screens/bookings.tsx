'use client';

import type {
  CustomerBookingDetail,
  CustomerBookingListResponse,
  CustomerBookingSummary,
} from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  Button,
  buttonClass,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  ErrorState,
  ListSection,
  Notice,
  Page,
  PageHeader,
  Reveal,
  RowActions,
  Skeleton,
  type DataTableColumn,
} from '@lucy-spa/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { fill } from '../../../i18n/customer';
import { getWorkforceDictionary } from '../../../i18n/workforce';
import { ApiError } from '../../../lib/api/client';
import {
  customerErrorMessage,
  formatDateTime,
  formatTime,
  formatVndRange,
  statusTone,
} from '../../../lib/customer/booking';
import { useClientPaging } from '../../../lib/workforce/use-client-paging';
import { Badge, Empty } from '../../workforce/ui';
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
    <Page width="form">
      <Notice tone="warning">{message}</Notice>
      <div>
        <Link href={backHref} className={buttonClass('secondary')}>
          {backLabel}
        </Link>
      </div>
    </Page>
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
  return (
    <DataTable
      mode="client"
      className="ls-cards-one-line"
      caption={fill(w.common.list.table, { list: listName })}
      columns={columns}
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

/** The member area home: the booking entry point, upcoming bookings and the account details. */
export function CustomerHomeScreen() {
  const { api, t, base } = useCustomer();
  const { account } = useCustomerAccount();
  const list = useFetch(() => api.get<CustomerBookingListResponse>('/api/v1/me/bookings'), 'home');
  return (
    <Page>
      <PageHeader
        title={t.home.title}
        description={t.home.intro}
        actions={
          <Link href={`${base}/book`} className={buttonClass('primary')}>
            {t.home.bookCta}
          </Link>
        }
      />
      <Reveal>
        <ListSection
          title={t.home.upcoming}
          actions={
            <Link href={`${base}/bookings`} className={buttonClass('ghost')}>
              {t.home.viewAll}
            </Link>
          }
        >
          {list.error ? (
            <LoadState error={list.error} retry={list.retry} />
          ) : (
            <BookingsTable
              items={list.data ? list.data.upcoming.slice(0, 3) : []}
              listName={t.home.upcoming}
              empty={<Empty>{t.home.none}</Empty>}
              paged={false}
              loading={!list.data}
              skeletonRows={3}
            />
          )}
        </ListSection>
      </Reveal>
      <Reveal>
        <Card as="section" aria-label={t.home.profile}>
          <CardHeader title={t.home.profile} />
          <DescriptionList
            items={[
              { label: t.home.name, value: account.displayName },
              {
                label: t.home.languagePref,
                value: account.locale === 'vi' ? 'Tiếng Việt' : 'English',
              },
            ]}
          />
        </Card>
      </Reveal>
    </Page>
  );
}

/** "Lịch hẹn của tôi": upcoming and history, both from the server. */
export function CustomerBookingsScreen() {
  const { api, t, base } = useCustomer();
  const list = useFetch(() => api.get<CustomerBookingListResponse>('/api/v1/me/bookings'), 'list');
  return (
    <Page>
      <PageHeader
        title={t.bookings.title}
        actions={
          <Link href={`${base}/book`} className={buttonClass('primary')}>
            {t.home.bookCta}
          </Link>
        }
      />
      {list.data ? (
        <>
          <Reveal>
            <ListSection title={t.bookings.upcoming}>
              <BookingsTable
                items={list.data.upcoming}
                listName={t.bookings.upcoming}
                empty={<Empty>{t.bookings.emptyUpcoming}</Empty>}
              />
            </ListSection>
          </Reveal>
          <Reveal>
            <ListSection title={t.bookings.history}>
              <BookingsTable
                items={list.data.history}
                listName={t.bookings.history}
                empty={<Empty>{t.bookings.emptyHistory}</Empty>}
              />
            </ListSection>
          </Reveal>
        </>
      ) : (
        <LoadState error={list.error} retry={list.retry} />
      )}
    </Page>
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
      <Page width="form">
        <LoadState error={detail.error} retry={detail.retry} />
      </Page>
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
    <Page width="form">
      <PageHeader
        title={t.bookings.detailTitle}
        breadcrumbs={
          <Breadcrumbs
            label={t.nav.menu}
            LinkComponent={Link}
            items={[{ label: t.bookings.title, href: `${base}/bookings` }, { label: booking.code }]}
          />
        }
        actions={
          booking.canCancel ? (
            <Button variant="danger-outline" onClick={() => setCancelling(true)}>
              {t.bookings.cancelTitle}
            </Button>
          ) : undefined
        }
      />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Reveal>
        <Card as="section" aria-label={t.bookings.detailTitle}>
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
        <Card as="section" aria-label={t.bookings.services}>
          <CardHeader title={t.bookings.services} />
          <DescriptionList
            items={booking.lines.map((line) => ({
              label: `${line.sequence}. ${locale === 'vi' ? line.serviceNameVi : line.serviceNameEn}`,
              value: (
                <>
                  {formatTime(line.startsAt, zone, locale)}–{formatTime(line.endsAt, zone, locale)}{' '}
                  · {fill(t.book.duration, { minutes: line.durationMinutes })}
                  <br />
                  {t.bookings.recipient}: {recipient(line.recipientKey)} · {t.bookings.staff}:{' '}
                  {line.employee.displayName}
                  {line.assignmentMode === 'ANY' ? ` (${t.bookings.anyAssigned})` : ''}
                  <br />
                  {t.book.referencePrice}:{' '}
                  {formatVndRange(line.priceMinVnd, line.priceMaxVnd, locale)}
                  {line.pricingUnit === 'PER_NAIL' ? ` ${t.book.perNail}` : ''}
                </>
              ),
            }))}
          />
          <p className="ls-detail-note">{t.book.priceNote}</p>
        </Card>
      </Reveal>
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
    </Page>
  );
}
