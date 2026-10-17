'use client';

import type {
  CancelledServiceLineResponse,
  OperationalActiveVisit,
  OperationalActiveVisitLine,
  OperationalTodayResponse,
  OperationalWaitingEntry,
  WalkInOptionsResponse,
  WalkInVisitResponse,
} from '@lucy-spa/contracts';
import { ListToolbar, SearchInput, Select, useUrlState } from '@lucy-spa/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fill } from '../../../i18n/workforce';
import {
  BOARD_REFRESH_MS,
  boardBranches,
  boardErrorMessage,
  matchesSearch,
} from '../../../lib/workforce/booking-board';
import { formatDate } from '../../../lib/workforce/format';
import { toolbarLabels } from '../../../lib/workforce/list-view';
import type { resolveEndBody } from '../../../lib/workforce/visit-completion';
import { reasonBody } from '../../../lib/workforce/visit-completion';
import { waitReasonText, walkInCancelBody } from '../../../lib/workforce/walk-in';
import { AddServiceDialog } from './add-service';
import {
  BoardConfirm,
  IntentDialog,
  ResolveEndDialog,
  type BoardCommand,
} from './booking-board-dialogs';
import {
  ActiveSection,
  BookingsSection,
  PoolSection,
  QueueSection,
  type Time,
} from './booking-board-sections';
import { useBranches } from '../data';
import { useAccount, useWorkforce } from '../session';
import { Empty, Loading, Notice, PageHeader, useSuccessToast } from '../ui';
import { clockRange, clockTime } from './pos-format';
import { canAt } from '../../../lib/workforce/permissions';

// The board's view in the address (module constant, as useUrlState asks).
const BOARD_VIEW_DEFAULTS: { branch: string; q: string } = { branch: '', q: '' };

type Overlay =
  | { kind: 'command'; command: BoardCommand }
  | { kind: 'resolveEnd'; visit: OperationalActiveVisit; line: OperationalActiveVisitLine }
  | { kind: 'addService'; visit: OperationalActiveVisit }
  | { kind: 'intent'; entry: OperationalWaitingEntry }
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
  const notify = useSuccessToast();
  const branches = useBranches(api);
  const allowed = useMemo(() => boardBranches(account, branches.data), [account, branches.data]);
  // Branch and search live in the address (wig :66): a shared link or Back/Forward restores the same board.
  const [view, setView] = useUrlState(BOARD_VIEW_DEFAULTS);
  // The first allowed branch is derived, not copied into state by an effect (rbp :74-76).
  const branchId = allowed.some((branch) => branch.id === view.branch)
    ? view.branch
    : (allowed[0]?.id ?? '');
  const search = view.q;
  // The board of the branch on screen; an answer for another branch is never shown (derived, no reset effect).
  const [loaded, setLoaded] = useState<{ branch: string; board: OperationalTodayResponse } | null>(
    null,
  );
  const [failure, setFailure] = useState<{ branch: string; error: unknown } | null>(null);
  const board = loaded?.branch === branchId ? loaded.board : null;
  const loadError = failure?.branch === branchId ? failure.error : null;
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [working, setWorking] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [options, setOptions] = useState<WalkInOptionsResponse | null>(null);
  const [optionsFailed, setOptionsFailed] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(
    async (passive: boolean) => {
      if (!branchId) return;
      // The passive refresh waits while the tab is hidden or a menu or dialog is open, so it never pulls a row (and the focus
      // on its action) away from the person using it (wig :99).
      if (
        passive &&
        (document.hidden || document.querySelector('[role="menu"], [aria-modal="true"]'))
      )
        return;
      try {
        const next = await api.get<OperationalTodayResponse>(
          `/api/v1/operations/branches/${branchId}/today`,
          {},
          { passive },
        );
        setLoaded({ branch: branchId, board: next });
        setFailure(null);
      } catch (error) {
        setFailure({ branch: branchId, error });
      }
    },
    [api, branchId],
  );
  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(true), BOARD_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  // The staff a waiting walk-in can ask for (needed only to change that request). Asked at the same time as the board, from the
  // person's own permission, not after the board's answer (rbp :103-119); a failure is said, not swallowed (wig :115).
  const canChange = account ? canAt(account, 'MANAGE_BOOKINGS', branchId) : false;
  useEffect(() => {
    if (!canChange || !branchId) return;
    let active = true;
    api
      .get<WalkInOptionsResponse>(
        `/api/v1/operations/branches/${branchId}/walk-in-options`,
        {},
        { passive: true },
      )
      .then((data) => {
        if (!active) return;
        setOptions(data);
        setOptionsFailed(false);
      })
      .catch(() => active && setOptionsFailed(true));
    return () => {
      active = false;
    };
  }, [api, branchId, canChange]);

  /** Success is a toast (a notice where no toast provider is mounted); errors stay with their dialog. */
  const succeed = (text: string) => notify(text, () => setMessage({ tone: 'success', text }));
  const closeOverlay = () => (setOverlay(null), setDialogError(null));
  // Stable handlers and clock for the memoised sections (rbp :248, :303-345): a poll or a busy flag does not rebuild them all.
  const zone = board?.branch.timezone ?? 'UTC';
  const time = useMemo<Time>(
    () =>
      Object.assign((iso: string) => clockTime(locale, zone, iso), {
        range: (startIso: string, endIso: string) => clockRange(locale, zone, startIso, endIso),
      }),
    [locale, zone],
  );
  const openCommand = useCallback(
    (command: BoardCommand) => (setMessage(null), setOverlay({ kind: 'command', command })),
    [],
  );
  const openResolve = useCallback(
    (visit: OperationalActiveVisit, line: OperationalActiveVisitLine) => (
      setMessage(null),
      setDialogError(null),
      setOverlay({ kind: 'resolveEnd', visit, line })
    ),
    [],
  );
  const openCancelLine = useCallback(
    (visit: OperationalActiveVisit, line: OperationalActiveVisitLine) => (
      setMessage(null),
      setOverlay({ kind: 'command', command: { kind: 'cancelLine', visit, line } })
    ),
    [],
  );
  const openAddService = useCallback(
    (visit: OperationalActiveVisit) => (
      setMessage(null),
      setOverlay({ kind: 'addService', visit })
    ),
    [],
  );
  const openIntent = useCallback(
    (entry: OperationalWaitingEntry) => (
      setMessage(null),
      setDialogError(null),
      setOverlay({ kind: 'intent', entry })
    ),
    [],
  );

  /** Runs a confirmed command exactly as the inline form did; a refusal throws so its dialog shows it. */
  async function run(command: BoardCommand, reason: string) {
    setMessage(null);
    try {
      if (command.kind === 'arrive') {
        await api.post(`/api/v1/operations/bookings/${command.booking.id}/arrive`, {});
        succeed(t.bookingBoard.arrived);
      } else if (command.kind === 'noShow') {
        await api.post(`/api/v1/operations/bookings/${command.booking.id}/no-show`, { reason });
        succeed(t.bookingBoard.done);
      } else if (command.kind === 'cancelWalkIn') {
        const body = walkInCancelBody(reason);
        if (!body) throw new Error('reason');
        await api.post(`/api/v1/operations/visits/${command.visitId}/cancel-walk-in`, body);
        succeed(t.bookingBoard.walkInCancelled);
      } else if (command.kind === 'cancelLine') {
        const body = reasonBody(reason);
        if (!body) throw new Error('reason');
        const result = await api.post<CancelledServiceLineResponse>(
          `/api/v1/operations/service-lines/${command.line.id}/cancel`,
          body,
        );
        succeed(
          result.visitStatus === 'COMPLETED'
            ? t.bookingBoard.visitClosed
            : result.visitStatus === 'CANCELLED'
              ? t.bookingBoard.visitCancelled
              : t.bookingBoard.lineCancelled,
        );
      } else {
        await api.post(`/api/v1/operations/visits/${command.visitId}/advance`, { reason });
        succeed(t.bookingBoard.done);
      }
    } finally {
      await load(false);
    }
  }

  async function resolveEnd(
    lineId: string,
    body: NonNullable<ReturnType<typeof resolveEndBody>>,
  ): Promise<boolean> {
    if (working) return false;
    setWorking(true);
    setDialogError(null);
    try {
      await api.post(`/api/v1/operations/service-lines/${lineId}/resolve-end`, body);
      succeed(t.bookingBoard.resolved);
      return true;
    } catch (error) {
      setDialogError(boardErrorMessage(error, t));
      return false;
    } finally {
      setWorking(false);
      await load(false);
    }
  }

  async function assign(entry: OperationalWaitingEntry) {
    if (busy) return;
    setBusy(entry.participantId);
    setMessage(null);
    try {
      const result = await api.post<WalkInVisitResponse>(
        `/api/v1/operations/visits/${entry.visitId}/participants/${entry.participantId}/assign`,
        {},
      );
      const participant = result.participants.find(
        (item) => item.participantId === entry.participantId,
      );
      if (participant?.state === 'ASSIGNED') {
        succeed(fill(t.bookingBoard.assignedNow, { name: entry.participantName }));
      } else {
        setMessage({
          tone: 'error',
          text: fill(t.bookingBoard.stillWaiting, {
            name: entry.participantName,
            reason: waitReasonText(participant?.waitReason ?? null, t),
          }),
        });
      }
    } catch (error) {
      setMessage({ tone: 'error', text: boardErrorMessage(error, t) });
    } finally {
      setBusy(null);
      await load(false);
    }
  }

  async function saveIntents(
    entry: OperationalWaitingEntry,
    changes: { lineId: string; requested: string }[],
  ): Promise<boolean> {
    if (working) return false;
    setWorking(true);
    setDialogError(null);
    try {
      for (const change of changes) {
        await api.post(`/api/v1/operations/visits/${entry.visitId}/lines/${change.lineId}/intent`, {
          requestedEmployeeUserId: change.requested === 'ANY' ? null : change.requested,
        });
      }
      succeed(t.bookingBoard.intentSaved);
      return true;
    } catch (error) {
      setDialogError(boardErrorMessage(error, t));
      return false;
    } finally {
      setWorking(false);
      await load(false);
    }
  }

  // The latest assign (it reads the busy row) behind a stable handler for the memoised pool section.
  const assignRef = useRef(assign);
  assignRef.current = assign;
  const onAssign = useCallback(
    (entry: OperationalWaitingEntry) => void assignRef.current(entry),
    [],
  );
  const visible = useMemo(
    () => board?.bookings.filter((booking) => matchesSearch(booking, search)) ?? [],
    [board, search],
  );

  if (branches.loading && !branches.data) return <Loading t={t} page />;
  if (allowed.length === 0) {
    return (
      <>
        <PageHeader title={t.bookingBoard.title} intro={t.bookingBoard.intro} />
        <Empty>{t.bookingBoard.noBranch}</Empty>
      </>
    );
  }
  const onlyBranch = allowed.length === 1 ? allowed[0] : null;
  const loading = !board && !loadError;
  const serviceName = (line: OperationalActiveVisitLine) =>
    locale === 'vi' ? line.serviceNameVi : line.serviceNameEn;

  return (
    <>
      {/* The day and the last refresh sit in the subtitle, outside any live region: the 30 s refresh is not read out every
          time (wig :272). The toolbar's status slot is left for search results. */}
      <PageHeader
        title={t.bookingBoard.title}
        intro={[
          onlyBranch
            ? fill(t.bookingBoard.introBranch, { branch: onlyBranch.name })
            : t.bookingBoard.intro,
          board
            ? fill(t.bookingBoard.date, {
                date: formatDate(board.date, locale),
                time: time(board.now),
              })
            : '',
          // A failed background refresh is said here, once and quietly, with the last board kept on screen: no alert every 30 s
          // and nothing pushed down above the lists (wig :301).
          board && loadError ? t.bookingBoard.stale : '',
        ]
          .filter(Boolean)
          .join(' ')}
      />
      <ListToolbar
        labels={toolbarLabels(t)}
        activeFilters={search ? 1 : 0}
        onReset={() => setView({ q: '' })}
        reload={{ label: t.bookingBoard.refresh, onClick: () => void load(false) }}
        search={
          <SearchInput
            id="board-search"
            value={search}
            label={t.bookingBoard.search}
            clearLabel={t.common.list.clearSearch}
            onSearch={(value) => setView({ q: value }, { replace: true })}
          />
        }
        filters={
          onlyBranch ? undefined : (
            <Select
              id="board-branch"
              aria-label={t.bookingBoard.branch}
              value={branchId}
              options={allowed.map((branch) => ({ value: branch.id, label: branch.name }))}
              onChange={(event) => setView({ branch: event.target.value })}
            />
          )
        }
      />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {loadError && !board ? <Notice tone="error">{boardErrorMessage(loadError, t)}</Notice> : null}
      {canChange && optionsFailed ? (
        <Notice tone="warning">{t.bookingBoard.optionsFailed}</Notice>
      ) : null}

      <BookingsSection
        bookings={visible}
        loading={loading}
        empty={
          board && board.bookings.length === 0
            ? t.bookingBoard.empty
            : board && visible.length === 0
              ? t.bookingBoard.noMatch
              : null
        }
        time={time}
        onCommand={openCommand}
      />
      <ActiveSection
        board={board}
        loading={loading}
        time={time}
        onResolve={openResolve}
        onCancelLine={openCancelLine}
        onAddService={openAddService}
      />
      <PoolSection
        board={board}
        loading={loading}
        busy={busy}
        canChangeIntent={options !== null}
        onAssign={onAssign}
        onChangeIntent={openIntent}
        onCommand={openCommand}
        time={time}
      />
      <QueueSection board={board} time={time} />

      {overlay?.kind === 'command' ? (
        <BoardConfirm
          command={overlay.command}
          serviceName={serviceName}
          onRun={run}
          onClose={closeOverlay}
        />
      ) : null}
      {overlay?.kind === 'resolveEnd' && board ? (
        <ResolveEndDialog
          visit={overlay.visit}
          line={overlay.line}
          serviceName={serviceName(overlay.line)}
          now={board.now}
          time={time}
          working={working}
          error={dialogError}
          onResolve={resolveEnd}
          onClose={closeOverlay}
        />
      ) : null}
      {overlay?.kind === 'addService' ? (
        <AddServiceDialog
          visitId={overlay.visit.id}
          visitCode={overlay.visit.code}
          participants={overlay.visit.participants}
          onAdded={(text) => (succeed(text), void load(false))}
          onClose={closeOverlay}
        />
      ) : null}
      {overlay?.kind === 'intent' && options ? (
        <IntentDialog
          entry={overlay.entry}
          options={options}
          working={working}
          error={dialogError}
          onSave={(changes) => saveIntents(overlay.entry, changes)}
          onClose={closeOverlay}
        />
      ) : null}
    </>
  );
}
