'use client';

import type {
  OperationalBooking,
  OperationalQueueKtv,
  OperationalTodayResponse,
} from '@lucy-spa/contracts';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { fill } from '../../../i18n/workforce';
import {
  BOARD_REFRESH_MS,
  boardBranches,
  boardErrorMessage,
  branchTime,
  matchesSearch,
  stateTone,
} from '../../../lib/workforce/booking-board';
import { useBranches } from '../data';
import { useAccount, useWorkforce } from '../session';
import { Badge, Empty, Field, Loading, Notice, PageHeader, Section, SubmitButton } from '../ui';

type Pending =
  | { kind: 'arrive'; booking: OperationalBooking }
  | { kind: 'noShow'; booking: OperationalBooking }
  | { kind: 'advance'; booking: OperationalBooking }
  | null;

/**
 * "Lịch hẹn hôm nay" (Phase 3 Step 5): the branch's bookings for its local day, customer
 * arrival, late-hold decisions and the computed queue. Every state, deadline and allowed action
 * comes from the server; the page never re-derives timing rules. It refreshes itself (passively,
 * so it never keeps a session alive) and after every command.
 */
export function BookingBoardScreen() {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const branches = useBranches(api);
  const allowed = useMemo(() => boardBranches(account, branches.data), [account, branches.data]);
  const [branchId, setBranchId] = useState('');
  const [board, setBoard] = useState<OperationalTodayResponse | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!branchId && allowed[0]) setBranchId(allowed[0].id);
  }, [allowed, branchId]);

  const load = useCallback(
    async (passive: boolean) => {
      if (!branchId) return;
      try {
        setBoard(
          await api.get<OperationalTodayResponse>(
            `/api/v1/operations/branches/${branchId}/today`,
            {},
            { passive },
          ),
        );
        setLoadError(null);
      } catch (error) {
        setLoadError(error);
      }
    },
    [api, branchId],
  );
  useEffect(() => {
    setBoard(null);
    void load(false);
    const timer = window.setInterval(() => void load(true), BOARD_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!pending || working) return;
    setWorking(true);
    setMessage(null);
    try {
      if (pending.kind === 'arrive') {
        await api.post(`/api/v1/operations/bookings/${pending.booking.id}/arrive`, {});
      } else if (pending.kind === 'noShow') {
        await api.post(`/api/v1/operations/bookings/${pending.booking.id}/no-show`, { reason });
      } else if (pending.booking.visit) {
        await api.post(`/api/v1/operations/visits/${pending.booking.visit.id}/advance`, { reason });
      }
      setMessage({
        tone: 'success',
        text: pending.kind === 'arrive' ? t.bookingBoard.arrived : t.bookingBoard.done,
      });
      setPending(null);
      setReason('');
    } catch (error) {
      setMessage({ tone: 'error', text: boardErrorMessage(error, t) });
    } finally {
      setWorking(false);
      await load(false);
    }
  }

  if (branches.loading && !branches.data) return <Loading t={t} />;
  if (allowed.length === 0) {
    return (
      <>
        <PageHeader title={t.bookingBoard.title} intro={t.bookingBoard.intro} />
        <Empty>{t.bookingBoard.noBranch}</Empty>
      </>
    );
  }
  const zone = board?.branch.timezone ?? 'UTC';
  const time = (iso: string) => branchTime(iso, zone, locale);
  const visible = board?.bookings.filter((booking) => matchesSearch(booking, search)) ?? [];

  return (
    <>
      <PageHeader title={t.bookingBoard.title} intro={t.bookingBoard.intro}>
        <button type="button" className="wf-button" onClick={() => void load(false)}>
          {t.bookingBoard.refresh}
        </button>
      </PageHeader>
      <div className="wf-filters">
        <Field id="board-branch" label={t.bookingBoard.branch}>
          <select
            id="board-branch"
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
          >
            {allowed.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="board-search" label={t.bookingBoard.search}>
          <input
            id="board-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
      </div>
      {board ? (
        <p className="wf-muted" aria-live="polite">
          {fill(t.bookingBoard.date, { date: board.date, time: time(board.now) })}
        </p>
      ) : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {loadError ? <Notice tone="error">{boardErrorMessage(loadError, t)}</Notice> : null}

      {pending ? (
        <form className="wf-card wf-form" onSubmit={(event) => void submit(event)}>
          <h2>
            {pending.kind === 'arrive'
              ? t.bookingBoard.arrive
              : pending.kind === 'noShow'
                ? t.bookingBoard.noShow
                : t.bookingBoard.advance}
          </h2>
          <p>
            {pending.kind === 'arrive'
              ? fill(t.bookingBoard.arriveConfirm, {
                  name: pending.booking.owner.displayName,
                  code: pending.booking.code,
                })
              : fill(
                  pending.kind === 'noShow'
                    ? t.bookingBoard.noShowIntro
                    : t.bookingBoard.advanceIntro,
                  {
                    code: pending.booking.visit?.code ?? pending.booking.code,
                  },
                )}
          </p>
          {pending.kind !== 'arrive' ? (
            <Field id="board-reason" label={t.bookingBoard.reason} required>
              <textarea
                id="board-reason"
                required
                maxLength={500}
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          ) : null}
          <div className="wf-row-actions">
            <button
              type="button"
              className="wf-button"
              disabled={working}
              onClick={() => setPending(null)}
            >
              {t.common.cancel}
            </button>
            <SubmitButton
              pending={working}
              tone={pending.kind === 'noShow' ? 'danger' : 'primary'}
              label={t.bookingBoard.confirm}
              pendingLabel={t.bookingBoard.working}
              disabled={pending.kind !== 'arrive' && !reason.trim()}
            />
          </div>
        </form>
      ) : null}

      <Section title={t.bookingBoard.bookings}>
        {!board && !loadError ? <Loading t={t} /> : null}
        {board && board.bookings.length === 0 ? <Empty>{t.bookingBoard.empty}</Empty> : null}
        {board && board.bookings.length > 0 && visible.length === 0 ? (
          <Empty>{t.bookingBoard.noMatch}</Empty>
        ) : null}
        {visible.length > 0 ? (
          <table className="wf-table">
            <thead>
              <tr>
                <th scope="col">{t.bookingBoard.time}</th>
                <th scope="col">{t.bookingBoard.customer}</th>
                <th scope="col">{t.bookingBoard.services}</th>
                <th scope="col">{t.bookingBoard.state}</th>
                <th scope="col">{t.bookingBoard.actions}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((booking) => (
                <tr key={booking.id}>
                  <td data-label={t.bookingBoard.time}>
                    <strong>
                      {time(booking.startsAt)}–{time(booking.endsAt)}
                    </strong>
                    <br />
                    <span className="wf-small">
                      {t.bookingBoard.code} {booking.code}
                    </span>
                  </td>
                  <td data-label={t.bookingBoard.customer}>
                    {booking.owner.displayName}
                    {booking.owner.phoneMasked ? (
                      <span className="wf-small"> · {booking.owner.phoneMasked}</span>
                    ) : null}
                  </td>
                  <td data-label={t.bookingBoard.services}>
                    <ul className="wf-plain-list">
                      {booking.lines.map((line) => (
                        <li key={line.sequence}>
                          {time(line.startsAt)}{' '}
                          {locale === 'vi' ? line.serviceNameVi : line.serviceNameEn} ·{' '}
                          {line.recipientName ?? t.bookingBoard.self} · {line.employee.displayName}
                          {line.conflict ? (
                            <Badge tone="warning">{t.bookingBoard.conflict}</Badge>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td data-label={t.bookingBoard.state}>
                    <Badge tone={stateTone(booking.state)}>
                      {t.bookingBoard.states[booking.state]}
                    </Badge>
                    <br />
                    <span className="wf-small">
                      {booking.visit
                        ? `${fill(t.bookingBoard.arrivedAt, { time: time(booking.visit.arrivedAt) })} (${t.bookingBoard.punctuality[booking.visit.punctuality]})`
                        : booking.state === 'UPCOMING'
                          ? fill(t.bookingBoard.arrivalOpens, {
                              time: time(booking.arrivalOpensAt),
                            })
                          : booking.state === 'LATE_HOLD' || booking.state === 'HOLD_EXPIRED'
                            ? fill(t.bookingBoard.holdUntil, { time: time(booking.holdUntil) })
                            : ''}
                    </span>
                  </td>
                  <td data-label={t.bookingBoard.actions}>
                    <div className="wf-row-actions">
                      {booking.actions.arrive ? (
                        <button
                          type="button"
                          className="wf-button wf-button-primary"
                          onClick={() => (
                            setPending({ kind: 'arrive', booking }),
                            setMessage(null)
                          )}
                        >
                          {t.bookingBoard.arrive}
                        </button>
                      ) : null}
                      {booking.actions.noShow ? (
                        <button
                          type="button"
                          className="wf-button wf-button-danger"
                          onClick={() => (
                            setPending({ kind: 'noShow', booking }),
                            setMessage(null)
                          )}
                        >
                          {t.bookingBoard.noShow}
                        </button>
                      ) : null}
                      {booking.actions.advance ? (
                        <button
                          type="button"
                          className="wf-button"
                          onClick={() => (
                            setPending({ kind: 'advance', booking }),
                            setMessage(null)
                          )}
                        >
                          {t.bookingBoard.advance}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Section>

      <Section title={t.bookingBoard.queue}>
        {board && board.queue.length === 0 ? <Empty>{t.bookingBoard.queueEmpty}</Empty> : null}
        <div className="wf-cards">
          {board?.queue.map((ktv) => (
            <QueueCard key={ktv.employee.id} ktv={ktv} time={time} />
          ))}
        </div>
      </Section>
    </>
  );
}

function QueueCard({ ktv, time }: { ktv: OperationalQueueKtv; time: (iso: string) => string }) {
  const { t, locale } = useWorkforce();
  const name = (vi: string, en: string) => (locale === 'vi' ? vi : en);
  return (
    <article className="wf-card" aria-label={ktv.employee.displayName}>
      <h3>
        {ktv.employee.displayName}{' '}
        <Badge tone={ktv.freeNow ? 'success' : 'neutral'}>
          {ktv.freeNow ? t.bookingBoard.free : t.bookingBoard.busy}
        </Badge>
      </h3>
      {ktv.serving.length > 0 ? (
        <p>
          <strong>{t.bookingBoard.serving}:</strong>{' '}
          {ktv.serving
            .map(
              (entry) =>
                `${entry.participantName} (${name(entry.serviceNameVi, entry.serviceNameEn)})`,
            )
            .join(', ')}
        </p>
      ) : null}
      <p className="wf-small">{t.bookingBoard.waiting}</p>
      {ktv.waiting.length === 0 ? (
        <p className="wf-muted">{t.bookingBoard.noWaiting}</p>
      ) : (
        <ol className="wf-plain-list">
          {ktv.waiting.map((entry) => (
            <li key={`${entry.visitId}-${entry.plannedStartAt}`}>
              {entry.position}. {entry.participantName} ·{' '}
              {name(entry.serviceNameVi, entry.serviceNameEn)} · {time(entry.plannedStartAt)}{' '}
              <Badge tone="info">{t.bookingBoard.groups[entry.group]}</Badge>
            </li>
          ))}
        </ol>
      )}
      {ktv.reserved.length > 0 ? (
        <>
          <p className="wf-small">{t.bookingBoard.reserved}</p>
          <ul className="wf-plain-list">
            {ktv.reserved.map((entry) => (
              <li key={`${entry.bookingId}-${entry.startsAt}`}>
                {time(entry.startsAt)}–{time(entry.endsAt)} · {entry.bookingCode} ·{' '}
                {t.bookingBoard.states[entry.state]}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </article>
  );
}
