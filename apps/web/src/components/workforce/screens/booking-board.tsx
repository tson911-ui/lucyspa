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
import { ListToolbar, SearchInput, Select } from '@lucy-spa/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fill } from '../../../i18n/workforce';
import {
  BOARD_REFRESH_MS,
  boardBranches,
  boardErrorMessage,
  branchTime,
  matchesSearch,
} from '../../../lib/workforce/booking-board';
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
} from './booking-board-sections';
import { useBranches } from '../data';
import { useAccount, useWorkforce } from '../session';
import { Empty, Loading, Notice, PageHeader, useSuccessToast } from '../ui';

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
  const [branchId, setBranchId] = useState('');
  const [board, setBoard] = useState<OperationalTodayResponse | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [search, setSearch] = useState('');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [working, setWorking] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [options, setOptions] = useState<WalkInOptionsResponse | null>(null);
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

  // The staff a waiting walk-in can ask for (needed only to change that request).
  const canChange = board?.permissions.arrive ?? false;
  useEffect(() => {
    if (!canChange || !branchId) return;
    let active = true;
    api
      .get<WalkInOptionsResponse>(
        `/api/v1/operations/branches/${branchId}/walk-in-options`,
        {},
        { passive: true },
      )
      .then((data) => active && setOptions(data))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, branchId, canChange]);

  /** Success is a toast (a notice where no toast provider is mounted); errors stay with their dialog. */
  const succeed = (text: string) => notify(text, () => setMessage({ tone: 'success', text }));
  const closeOverlay = () => (setOverlay(null), setDialogError(null));

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
  const loading = !board && !loadError;
  const serviceName = (line: OperationalActiveVisitLine) =>
    locale === 'vi' ? line.serviceNameVi : line.serviceNameEn;

  return (
    <>
      <PageHeader title={t.bookingBoard.title} intro={t.bookingBoard.intro} />
      <ListToolbar
        labels={toolbarLabels(t)}
        activeFilters={search ? 1 : 0}
        resultCount={
          board ? fill(t.bookingBoard.date, { date: board.date, time: time(board.now) }) : undefined
        }
        onReset={() => setSearch('')}
        reload={{ label: t.bookingBoard.refresh, onClick: () => void load(false) }}
        search={
          <SearchInput
            id="board-search"
            value={search}
            label={t.bookingBoard.search}
            placeholder={t.bookingBoard.search}
            clearLabel={t.common.list.clearSearch}
            onSearch={setSearch}
          />
        }
        filters={
          <Select
            id="board-branch"
            aria-label={t.bookingBoard.branch}
            value={branchId}
            options={allowed.map((branch) => ({ value: branch.id, label: branch.name }))}
            onChange={(event) => setBranchId(event.target.value)}
          />
        }
      />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {loadError ? <Notice tone="error">{boardErrorMessage(loadError, t)}</Notice> : null}

      <BookingsSection
        board={board}
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
        onCommand={(command) => (setMessage(null), setOverlay({ kind: 'command', command }))}
      />
      <ActiveSection
        board={board}
        loading={loading}
        time={time}
        onResolve={(visit, line) => (
          setMessage(null),
          setDialogError(null),
          setOverlay({ kind: 'resolveEnd', visit, line })
        )}
        onCancelLine={(visit, line) => (
          setMessage(null),
          setOverlay({ kind: 'command', command: { kind: 'cancelLine', visit, line } })
        )}
        onAddService={(visit) => (setMessage(null), setOverlay({ kind: 'addService', visit }))}
      />
      <PoolSection
        board={board}
        loading={loading}
        busy={busy}
        canChangeIntent={options !== null}
        onAssign={(entry) => void assign(entry)}
        onChangeIntent={(entry) => (
          setMessage(null),
          setDialogError(null),
          setOverlay({ kind: 'intent', entry })
        )}
        onCommand={(command) => (setMessage(null), setOverlay({ kind: 'command', command }))}
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
