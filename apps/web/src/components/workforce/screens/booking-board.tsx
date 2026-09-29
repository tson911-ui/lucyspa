'use client';

import type {
  CancelledServiceLineResponse,
  OperationalActiveVisit,
  OperationalActiveVisitLine,
  OperationalBooking,
  OperationalQueueKtv,
  OperationalTodayResponse,
  OperationalWaitingEntry,
  WalkInOptionsResponse,
  WalkInVisitResponse,
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
import {
  elapsedMinutes,
  reasonBody,
  resolveEndBody,
  type ResolveEndMode,
} from '../../../lib/workforce/visit-completion';
import { waitReasonText, walkInCancelBody } from '../../../lib/workforce/walk-in';
import { useBranches } from '../data';
import { useAccount, useWorkforce } from '../session';
import { Badge, Empty, Field, Loading, Notice, PageHeader, Section, SubmitButton } from '../ui';

type Pending =
  | { kind: 'arrive'; booking: OperationalBooking }
  | { kind: 'noShow'; booking: OperationalBooking }
  | { kind: 'advance'; visitId: string; code: string }
  | { kind: 'cancelWalkIn'; visitId: string; code: string }
  | { kind: 'resolveEnd'; visit: OperationalActiveVisit; line: OperationalActiveVisitLine }
  | { kind: 'cancelLine'; visit: OperationalActiveVisit; line: OperationalActiveVisitLine }
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
  const [endMode, setEndMode] = useState<ResolveEndMode>('NOW');
  const [endMinutes, setEndMinutes] = useState('');
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
      } else if (pending.kind === 'cancelWalkIn') {
        const body = walkInCancelBody(reason);
        if (!body) return;
        await api.post(`/api/v1/operations/visits/${pending.visitId}/cancel-walk-in`, body);
      } else if (pending.kind === 'resolveEnd') {
        const execution = pending.line.execution;
        if (!execution || !board) return;
        const body = resolveEndBody({
          reason,
          mode: endMode,
          minutes: endMinutes,
          startedAt: execution.startedAt,
          expectedEndAt: execution.expectedEndAt,
          now: board.now,
        });
        if (!body) return;
        await api.post(`/api/v1/operations/service-lines/${pending.line.id}/resolve-end`, body);
      } else if (pending.kind === 'cancelLine') {
        const body = reasonBody(reason);
        if (!body) return;
        const result = await api.post<CancelledServiceLineResponse>(
          `/api/v1/operations/service-lines/${pending.line.id}/cancel`,
          body,
        );
        if (result.visitStatus === 'COMPLETED' || result.visitStatus === 'CANCELLED') {
          setMessage({
            tone: 'success',
            text:
              result.visitStatus === 'COMPLETED'
                ? t.bookingBoard.visitClosed
                : t.bookingBoard.visitCancelled,
          });
          setPending(null);
          setReason('');
          return;
        }
      } else {
        await api.post(`/api/v1/operations/visits/${pending.visitId}/advance`, { reason });
      }
      setMessage({
        tone: 'success',
        text:
          pending.kind === 'arrive'
            ? t.bookingBoard.arrived
            : pending.kind === 'cancelWalkIn'
              ? t.bookingBoard.walkInCancelled
              : pending.kind === 'resolveEnd'
                ? t.bookingBoard.resolved
                : pending.kind === 'cancelLine'
                  ? t.bookingBoard.lineCancelled
                  : t.bookingBoard.done,
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
                : pending.kind === 'cancelWalkIn'
                  ? t.bookingBoard.cancelWalkIn
                  : pending.kind === 'resolveEnd'
                    ? t.bookingBoard.resolveEnd
                    : pending.kind === 'cancelLine'
                      ? t.bookingBoard.cancelLine
                      : t.bookingBoard.advance}
          </h2>
          <p>
            {pending.kind === 'arrive'
              ? fill(t.bookingBoard.arriveConfirm, {
                  name: pending.booking.owner.displayName,
                  code: pending.booking.code,
                })
              : pending.kind === 'noShow'
                ? fill(t.bookingBoard.noShowIntro, { code: pending.booking.code })
                : pending.kind === 'cancelWalkIn'
                  ? fill(t.bookingBoard.cancelWalkInIntro, { code: pending.code })
                  : pending.kind === 'resolveEnd'
                    ? fill(t.bookingBoard.resolveEndIntro, {
                        service:
                          locale === 'vi' ? pending.line.serviceNameVi : pending.line.serviceNameEn,
                        staff: pending.line.employee?.displayName ?? '',
                      })
                    : pending.kind === 'cancelLine'
                      ? fill(t.bookingBoard.cancelLineIntro, {
                          service:
                            locale === 'vi'
                              ? pending.line.serviceNameVi
                              : pending.line.serviceNameEn,
                        })
                      : fill(t.bookingBoard.advanceIntro, { code: pending.code })}
          </p>
          {pending.kind === 'resolveEnd' && pending.line.execution && board ? (
            <ResolveEndTime
              execution={pending.line.execution}
              now={board.now}
              time={time}
              mode={endMode}
              minutes={endMinutes}
              onMode={setEndMode}
              onMinutes={setEndMinutes}
            />
          ) : null}
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
              tone={
                pending.kind === 'noShow' ||
                pending.kind === 'cancelWalkIn' ||
                pending.kind === 'cancelLine'
                  ? 'danger'
                  : 'primary'
              }
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
                            setPending({
                              kind: 'advance',
                              visitId: booking.visit!.id,
                              code: booking.visit!.code,
                            }),
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

      <Section title={t.bookingBoard.active}>
        <p className="wf-small">{t.bookingBoard.activeIntro}</p>
        {board && board.activeVisits.length === 0 ? (
          <Empty>{t.bookingBoard.activeEmpty}</Empty>
        ) : null}
        {board && board.activeVisits.length > 0 ? (
          <ActiveVisits
            visits={board.activeVisits}
            time={time}
            onResolve={(visit, line) => (
              setPending({ kind: 'resolveEnd', visit, line }),
              setReason(''),
              setEndMode('NOW'),
              setEndMinutes(''),
              setMessage(null)
            )}
            onCancelLine={(visit, line) => (
              setPending({ kind: 'cancelLine', visit, line }),
              setReason(''),
              setMessage(null)
            )}
          />
        ) : null}
      </Section>

      <Section title={t.bookingBoard.pool}>
        <p className="wf-small">{t.bookingBoard.poolIntro}</p>
        {board && board.waitingPool.length === 0 ? <Empty>{t.bookingBoard.poolEmpty}</Empty> : null}
        {board && board.waitingPool.length > 0 ? (
          <WaitingPool
            board={board}
            time={time}
            onCancel={(entry) => (
              setPending({ kind: 'cancelWalkIn', visitId: entry.visitId, code: entry.visitCode }),
              setReason(''),
              setMessage(null)
            )}
            onAdvance={(entry) => (
              setPending({ kind: 'advance', visitId: entry.visitId, code: entry.visitCode }),
              setMessage(null)
            )}
            onDone={(text, tone) => (setMessage({ tone, text }), void load(false))}
          />
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

function ActiveVisits({
  visits,
  time,
  onResolve,
  onCancelLine,
}: {
  visits: OperationalActiveVisit[];
  time: (iso: string) => string;
  onResolve: (visit: OperationalActiveVisit, line: OperationalActiveVisitLine) => void;
  onCancelLine: (visit: OperationalActiveVisit, line: OperationalActiveVisitLine) => void;
}) {
  const { t, locale } = useWorkforce();
  return (
    <div className="wf-cards">
      {visits.map((visit) => (
        <article className="wf-card" key={visit.id} aria-label={visit.code}>
          <h3>{fill(t.bookingBoard.activeVisit, { code: visit.code })}</h3>
          <ul className="wf-plain-list">
            {visit.lines.map((line) => (
              <li key={line.id}>
                {line.participantName ?? t.bookingBoard.self} ·{' '}
                {locale === 'vi' ? line.serviceNameVi : line.serviceNameEn} ·{' '}
                {line.employee?.displayName ?? t.bookingBoard.activeUnassigned}{' '}
                <Badge tone={line.status === 'IN_PROGRESS' ? 'info' : 'neutral'}>
                  {t.bookingBoard.lineStatuses[line.status]}
                </Badge>
                {line.execution ? (
                  <>
                    {' '}
                    <span className="wf-small">
                      {fill(t.bookingBoard.runningSince, {
                        start: time(line.execution.startedAt),
                        end: time(line.execution.expectedEndAt),
                      })}
                    </span>
                    {line.execution.overdue ? (
                      <Badge tone="warning">{t.bookingBoard.overdue}</Badge>
                    ) : null}
                  </>
                ) : null}
                <div className="wf-row-actions">
                  {line.actions.resolve ? (
                    <button
                      type="button"
                      className="wf-button"
                      onClick={() => onResolve(visit, line)}
                    >
                      {t.bookingBoard.resolveEnd}
                    </button>
                  ) : null}
                  {line.actions.cancel ? (
                    <button
                      type="button"
                      className="wf-button wf-button-danger"
                      onClick={() => onCancelLine(visit, line)}
                    >
                      {t.bookingBoard.cancelLine}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

/** The constrained end-time choices for a forgotten END (never a free timestamp editor). */
function ResolveEndTime({
  execution,
  now,
  time,
  mode,
  minutes,
  onMode,
  onMinutes,
}: {
  execution: { startedAt: string; expectedEndAt: string };
  now: string;
  time: (iso: string) => string;
  mode: ResolveEndMode;
  minutes: string;
  onMode: (mode: ResolveEndMode) => void;
  onMinutes: (value: string) => void;
}) {
  const { t } = useWorkforce();
  const expectedPassed = Date.parse(execution.expectedEndAt) <= Date.parse(now);
  const max = elapsedMinutes(execution.startedAt, now);
  return (
    <fieldset>
      <legend>{t.bookingBoard.resolveMode}</legend>
      <label>
        <input type="radio" checked={mode === 'NOW'} onChange={() => onMode('NOW')} />{' '}
        {t.bookingBoard.resolveModeNow}
      </label>
      {expectedPassed ? (
        <label>
          <input type="radio" checked={mode === 'EXPECTED'} onChange={() => onMode('EXPECTED')} />{' '}
          {fill(t.bookingBoard.resolveModeExpected, { time: time(execution.expectedEndAt) })}
        </label>
      ) : null}
      <label>
        <input type="radio" checked={mode === 'MINUTES'} onChange={() => onMode('MINUTES')} />{' '}
        {t.bookingBoard.resolveModeMinutes}
      </label>
      {mode === 'MINUTES' ? (
        <Field
          id="board-minutes"
          label={fill(t.bookingBoard.resolveMinutes, { max: String(max) })}
          required
        >
          <input
            id="board-minutes"
            inputMode="numeric"
            value={minutes}
            onChange={(event) => onMinutes(event.target.value)}
          />
        </Field>
      ) : null}
    </fieldset>
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

/**
 * Step 6: the branch waiting pool (unassigned walk-in services: no KTV, no time). The order is
 * advisory; staff assign any entry that fits. "Assign staff" asks the server to place the
 * participant's whole sequence now (it may stay waiting); the requested KTV of a waiting service
 * can change until it is assigned.
 */
function WaitingPool({
  board,
  time,
  onAdvance,
  onCancel,
  onDone,
}: {
  board: OperationalTodayResponse;
  time: (iso: string) => string;
  onAdvance: (entry: OperationalWaitingEntry) => void;
  onCancel: (entry: OperationalWaitingEntry) => void;
  onDone: (text: string, tone: 'success' | 'error') => void;
}) {
  const { api, t, locale } = useWorkforce();
  const [options, setOptions] = useState<WalkInOptionsResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [intent, setIntent] = useState<Record<string, string>>({});
  const canChange = board.permissions.arrive;
  useEffect(() => {
    if (!canChange) return;
    let active = true;
    api
      .get<WalkInOptionsResponse>(
        `/api/v1/operations/branches/${board.branch.id}/walk-in-options`,
        {},
        { passive: true },
      )
      .then((data) => active && setOptions(data))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, board.branch.id, canChange]);
  const name = (vi: string, en: string) => (locale === 'vi' ? vi : en);

  async function assign(entry: OperationalWaitingEntry) {
    if (busy) return;
    setBusy(entry.participantId);
    try {
      const result = await api.post<WalkInVisitResponse>(
        `/api/v1/operations/visits/${entry.visitId}/participants/${entry.participantId}/assign`,
        {},
      );
      const participant = result.participants.find(
        (item) => item.participantId === entry.participantId,
      );
      onDone(
        participant?.state === 'ASSIGNED'
          ? fill(t.bookingBoard.assignedNow, { name: entry.participantName })
          : fill(t.bookingBoard.stillWaiting, {
              name: entry.participantName,
              reason: waitReasonText(participant?.waitReason ?? null, t),
            }),
        participant?.state === 'ASSIGNED' ? 'success' : 'error',
      );
    } catch (error) {
      onDone(boardErrorMessage(error, t), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function saveIntent(entry: OperationalWaitingEntry, lineId: string) {
    const choice = intent[lineId];
    if (busy || choice === undefined) return;
    setBusy(lineId);
    try {
      await api.post(`/api/v1/operations/visits/${entry.visitId}/lines/${lineId}/intent`, {
        requestedEmployeeUserId: choice === 'ANY' ? null : choice,
      });
      onDone(t.bookingBoard.intentSaved, 'success');
    } catch (error) {
      onDone(boardErrorMessage(error, t), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <ol className="wf-cards">
      {board.waitingPool.map((entry) => (
        <li key={entry.participantId} className="wf-card">
          <h3>
            {entry.position}. {entry.participantName}{' '}
            <Badge tone="neutral">{t.walkIn.kinds[entry.participantKind]}</Badge>{' '}
            <Badge tone="info">{t.bookingBoard.groups[entry.group]}</Badge>
          </h3>
          <p className="wf-small">
            {entry.visitCode} · {fill(t.bookingBoard.arrivedShort, { time: time(entry.arrivedAt) })}
          </p>
          <ul className="wf-plain-list">
            {entry.lines.map((line) => {
              const staff =
                options?.services.find((service) => service.id === line.serviceId)?.employees ?? [];
              const current = line.requestedEmployee?.id ?? 'ANY';
              return (
                <li key={line.id}>
                  {name(line.serviceNameVi, line.serviceNameEn)} · {line.durationMinutes}′ ·{' '}
                  {line.requestedEmployee
                    ? fill(t.bookingBoard.requested, { name: line.requestedEmployee.displayName })
                    : t.bookingBoard.any}
                  {entry.actions.changeIntent && options ? (
                    <span className="wf-inline-form">
                      <label className="wf-visually-hidden" htmlFor={`intent-${line.id}`}>
                        {t.bookingBoard.changeStaff}
                      </label>
                      <select
                        id={`intent-${line.id}`}
                        value={intent[line.id] ?? current}
                        onChange={(event) =>
                          setIntent((values) => ({ ...values, [line.id]: event.target.value }))
                        }
                      >
                        <option value="ANY">{t.walkIn.anyStaff}</option>
                        {staff.map((employee) => (
                          <option key={employee.id} value={employee.id}>
                            {employee.displayName}
                            {employee.checkedIn ? '' : ` ${t.walkIn.notCheckedIn}`}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="wf-button wf-button-quiet"
                        disabled={busy !== null || (intent[line.id] ?? current) === current}
                        onClick={() => void saveIntent(entry, line.id)}
                      >
                        {t.bookingBoard.save}
                      </button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="wf-row-actions">
            {entry.actions.assign ? (
              <button
                type="button"
                className="wf-button wf-button-primary"
                disabled={busy !== null}
                aria-busy={busy === entry.participantId}
                onClick={() => void assign(entry)}
              >
                {busy === entry.participantId ? t.bookingBoard.assigning : t.bookingBoard.assignNow}
              </button>
            ) : null}
            {entry.actions.advance ? (
              <button type="button" className="wf-button" onClick={() => onAdvance(entry)}>
                {t.bookingBoard.advance}
              </button>
            ) : null}
            {entry.actions.cancel ? (
              <button
                type="button"
                className="wf-button wf-button-danger"
                onClick={() => onCancel(entry)}
              >
                {t.bookingBoard.cancelWalkIn}
              </button>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
