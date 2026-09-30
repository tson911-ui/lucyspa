'use client';

import type {
  CustomerBookingDetail,
  CustomerBookingListResponse,
  CustomerBookingSummary,
} from '@lucy-spa/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { fill } from '../../../i18n/customer';
import { ApiError } from '../../../lib/api/client';
import {
  customerErrorMessage,
  formatDateTime,
  formatTime,
  formatVndRange,
  statusTone,
} from '../../../lib/customer/booking';
import { Badge, Field, Notice, SubmitButton } from '../../workforce/ui';
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
      <p className="wf-muted" role="status">
        {t.common.loading}
      </p>
    );
  }
  const reference = error instanceof ApiError ? error.requestId : null;
  return (
    <Notice tone="error">
      <p>{customerErrorMessage(error, t)}</p>
      {reference ? (
        <p className="wf-small">
          {t.errors.reference}: {reference}
        </p>
      ) : null}
      <button type="button" className="wf-button wf-button-quiet" onClick={retry}>
        {t.common.reload}
      </button>
    </Notice>
  );
}

function BookingCard({ item }: { item: CustomerBookingSummary }) {
  const { t, locale, base } = useCustomer();
  return (
    <li className="cu-card">
      <div className="cu-card-head">
        <strong>{formatDateTime(item.startsAt, item.branch.timezone, locale)}</strong>
        <Badge tone={statusTone(item.status)}>{t.bookings.status[item.status]}</Badge>
      </div>
      <p>{item.serviceNames.map((name) => (locale === 'vi' ? name.vi : name.en)).join(' · ')}</p>
      <p className="wf-muted">
        {item.branch.name} · {t.bookings.code} {item.code}
      </p>
      <Link href={`${base}/bookings/${item.id}`} className="wf-button wf-button-quiet">
        {t.bookings.open}
      </Link>
    </li>
  );
}

/** The member area home: account details, upcoming bookings and the booking entry point. */
export function CustomerHomeScreen() {
  const { api, t, base } = useCustomer();
  const { account } = useCustomerAccount();
  const list = useFetch(() => api.get<CustomerBookingListResponse>('/api/v1/me/bookings'), 'home');
  return (
    <section className="cu-panel">
      <h1>{fill(t.home.title, { name: account.displayName })}</h1>
      <p className="wf-muted">{t.home.intro}</p>
      <div className="cu-actions">
        <Link href={`${base}/book`} className="wf-button wf-button-primary wf-button-large">
          {t.home.bookCta}
        </Link>
        <Link href={`${base}/bookings`} className="wf-button">
          {t.home.bookingsCta}
        </Link>
      </div>
      <h2>{t.home.upcoming}</h2>
      {list.data ? (
        list.data.upcoming.length === 0 ? (
          <p className="wf-empty">{t.home.none}</p>
        ) : (
          <ul className="cu-cards">
            {list.data.upcoming.slice(0, 3).map((item) => (
              <BookingCard key={item.id} item={item} />
            ))}
          </ul>
        )
      ) : (
        <LoadState error={list.error} retry={list.retry} />
      )}
      <h2>{t.home.profile}</h2>
      <dl className="cu-summary">
        <dt>{t.home.name}</dt>
        <dd>{account.displayName}</dd>
        <dt>{t.home.languagePref}</dt>
        <dd>{account.locale === 'vi' ? 'Tiếng Việt' : 'English'}</dd>
      </dl>
    </section>
  );
}

/** "Lịch hẹn của tôi": upcoming and history, both from the server. */
export function CustomerBookingsScreen() {
  const { api, t, base } = useCustomer();
  const list = useFetch(() => api.get<CustomerBookingListResponse>('/api/v1/me/bookings'), 'list');
  return (
    <section className="cu-panel">
      <h1>{t.bookings.title}</h1>
      <p>
        <Link href={`${base}/book`} className="wf-button wf-button-primary">
          {t.home.bookCta}
        </Link>
      </p>
      {list.data ? (
        <>
          <h2>{t.bookings.upcoming}</h2>
          {list.data.upcoming.length === 0 ? (
            <p className="wf-empty">{t.bookings.emptyUpcoming}</p>
          ) : (
            <ul className="cu-cards">
              {list.data.upcoming.map((item) => (
                <BookingCard key={item.id} item={item} />
              ))}
            </ul>
          )}
          <h2>{t.bookings.history}</h2>
          {list.data.history.length === 0 ? (
            <p className="wf-empty">{t.bookings.emptyHistory}</p>
          ) : (
            <ul className="cu-cards">
              {list.data.history.map((item) => (
                <BookingCard key={item.id} item={item} />
              ))}
            </ul>
          )}
        </>
      ) : (
        <LoadState error={list.error} retry={list.retry} />
      )}
    </section>
  );
}

/** One own booking; cancellation until service START (O3), decided by the server. */
export function CustomerBookingDetailScreen({ id }: { id: string }) {
  const { api, t, locale, base } = useCustomer();
  const detail = useFetch(() => api.get<CustomerBookingDetail>(`/api/v1/me/bookings/${id}`), id);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{
    tone: 'success' | 'error' | 'warning';
    text: string;
  } | null>(null);

  async function cancel(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage(null);
    try {
      const result = await api.post<CustomerBookingDetail>(`/api/v1/me/bookings/${id}/cancel`, {
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      detail.set(result);
      setConfirming(false);
      setMessage(
        result.cancelledLate
          ? { tone: 'warning', text: `${t.bookings.cancelled} ${t.bookings.cancelledLate}` }
          : { tone: 'success', text: t.bookings.cancelled },
      );
    } catch (error) {
      setMessage({ tone: 'error', text: customerErrorMessage(error, t) });
      if (error instanceof ApiError && error.code === 'BOOKING_CANCEL_NOT_ALLOWED') detail.retry();
    } finally {
      setPending(false);
    }
  }

  if (!detail.data) {
    if (detail.error instanceof ApiError && detail.error.code === 'NOT_FOUND') {
      return (
        <section className="cu-panel">
          <Notice tone="warning">{t.bookings.notFound}</Notice>
          <Link href={`${base}/bookings`}>{t.bookings.title}</Link>
        </section>
      );
    }
    return (
      <section className="cu-panel">
        <LoadState error={detail.error} retry={detail.retry} />
      </section>
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
  return (
    <section className="cu-panel">
      <p>
        <Link href={`${base}/bookings`}>← {t.bookings.title}</Link>
      </p>
      <h1>{t.bookings.detailTitle}</h1>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <dl className="cu-summary">
        <dt>{t.bookings.code}</dt>
        <dd>{booking.code}</dd>
        <dt>{t.book.branch}</dt>
        <dd>{booking.branch.name}</dd>
        <dt>{t.book.when}</dt>
        <dd>
          {formatDateTime(booking.startsAt, zone, locale)} –{' '}
          {formatTime(booking.endsAt, zone, locale)}
        </dd>
        <dt>{t.bookings.statusLabel}</dt>
        <dd>
          <Badge tone={statusTone(booking.status)}>{t.bookings.status[booking.status]}</Badge>
        </dd>
      </dl>
      <h2>{t.bookings.services}</h2>
      <ol className="cu-lines">
        {booking.lines.map((line) => (
          <li key={line.sequence}>
            <strong>{locale === 'vi' ? line.serviceNameVi : line.serviceNameEn}</strong>
            <span className="wf-muted">
              {' '}
              · {formatTime(line.startsAt, zone, locale)}–{formatTime(line.endsAt, zone, locale)} ·{' '}
              {fill(t.book.duration, { minutes: line.durationMinutes })}
            </span>
            <br />
            <span>
              {t.bookings.recipient}: {recipient(line.recipientKey)} · {t.bookings.staff}:{' '}
              {line.employee.displayName}
              {line.assignmentMode === 'ANY' ? ` (${t.bookings.anyAssigned})` : ''}
            </span>
            <br />
            <span className="wf-muted">
              {t.book.referencePrice}: {formatVndRange(line.priceMinVnd, line.priceMaxVnd, locale)}
              {line.pricingUnit === 'PER_NAIL' ? ` ${t.book.perNail}` : ''}
            </span>
          </li>
        ))}
      </ol>
      <p className="wf-muted">{t.book.priceNote}</p>
      {booking.canCancel && !confirming ? (
        <button
          type="button"
          className="wf-button wf-button-danger"
          onClick={() => setConfirming(true)}
        >
          {t.bookings.cancelTitle}
        </button>
      ) : null}
      {booking.canCancel && confirming ? (
        <form className="cu-confirm" onSubmit={(event) => void cancel(event)}>
          <h2>{t.bookings.cancelTitle}</h2>
          <p>{t.bookings.cancelIntro}</p>
          <Field id="reason" label={t.bookings.cancelReason}>
            <textarea
              id="reason"
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <div className="cu-actions">
            <button
              type="button"
              className="wf-button"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              {t.bookings.keep}
            </button>
            <SubmitButton
              pending={pending}
              tone="danger"
              label={t.bookings.cancelConfirm}
              pendingLabel={t.bookings.cancelling}
            />
          </div>
        </form>
      ) : null}
    </section>
  );
}
