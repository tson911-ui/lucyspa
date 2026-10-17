'use client';

import type {
  ReassignmentLine,
  ReassignmentScope,
  ReassignmentWorkResponse,
  ReplacementOptionsResponse,
  ReassignServicesResponse,
} from '@lucy-spa/contracts';
import {
  CursorPagination,
  DataTable,
  DateTextInput,
  EmptyState,
  ListToolbar,
  RowActions,
  SegmentedControl,
  Select,
  useUrlState,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { formatDate } from '../../../lib/workforce/format';
import { cursorLabels, paginationLabels, toolbarLabels } from '../../../lib/workforce/list-view';
import {
  reassignmentBody,
  reassignmentBranches,
  reassignmentError,
} from '../../../lib/workforce/reassignment';
import { useBranches } from '../data';
import { useAccount, useWorkforce } from '../session';
import { Badge, Empty, Loading, Notice, PageHeader, useSuccessToast } from '../ui';
import { ReassignmentDialog } from './reassignment-dialog';
import { PAGE_SIZE } from './pos-url';

// The list's view in the address (module constants, as useUrlState asks); the page returns to 1 when a filter changes.
const REASSIGN_DEFAULTS: { branch: string; from: string; to: string; show: string; page: number } =
  {
    branch: '',
    from: '',
    to: '',
    show: 'conflicts',
    page: 1,
  };
const REASSIGN_URL_OPTIONS = { resetOnChange: ['page'] } as const;
const REASSIGN_SHOW = ['conflicts', 'all'] as const;

export function ReassignmentScreen() {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const notify = useSuccessToast();
  const branches = useBranches(api);
  const allowed = useMemo(
    () => reassignmentBranches(account, branches.data),
    [account, branches.data],
  );
  // Branch, dates, the conflict filter and the page live in the address (wig :42): Back/Forward and a shared link restore them.
  const [view, setView] = useUrlState(REASSIGN_DEFAULTS, REASSIGN_URL_OPTIONS);
  // The first allowed branch is derived, not copied in by an effect (rbp :62-64).
  const branchId = allowed.some((branch) => branch.id === view.branch)
    ? view.branch
    : (allowed[0]?.id ?? '');
  const { from, to } = view;
  const conflictsOnly = view.show !== 'all';
  const [board, setBoard] = useState<ReassignmentWorkResponse | null>(null);
  const [anchor, setAnchor] = useState<ReassignmentLine | null>(null);
  const [scope, setScope] = useState<ReassignmentScope>('PARTICIPANT');
  const [options, setOptions] = useState<ReplacementOptionsResponse | null>(null);
  const [replacement, setReplacement] = useState('');
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const generation = useRef(0);
  const optionGeneration = useRef(0);
  const mutation = useRef(false);

  // `keepDialog`: after a refused reassign the board is read again but the dialog stays open with the chosen replacement and the
  // typed reason, and shows the refusal there (wig :169).
  const load = useCallback(
    async (cursor?: string, keepDialog = false) => {
      if (!branchId) return;
      const current = ++generation.current;
      if (!keepDialog) {
        optionGeneration.current += 1;
        setAnchor(null);
        setOptions(null);
        setOptionsLoading(false);
      }
      setLoading(true);
      try {
        const result = await api.get<ReassignmentWorkResponse>(
          `/api/v1/operations/branches/${branchId}/reassignment-work`,
          {
            ...(from ? { from } : {}),
            ...(to ? { to } : {}),
            conflictsOnly: String(conflictsOnly),
            ...(cursor ? { cursor } : {}),
          },
        );
        if (current === generation.current) {
          setBoard((old) =>
            cursor && old ? { ...result, lines: [...old.lines, ...result.lines] } : result,
          );
          setError(null);
        }
      } catch (cause) {
        if (current === generation.current) setError(cause);
      } finally {
        if (current === generation.current) setLoading(false);
      }
    },
    [api, branchId, from, to, conflictsOnly],
  );
  useEffect(() => {
    setBoard(null);
    setSuccess(false);
    void load();
    return () => {
      generation.current += 1;
      optionGeneration.current += 1;
    };
  }, [load]);

  async function inspect(
    line: ReassignmentLine,
    selectedScope: ReassignmentScope,
    keepError = false,
  ) {
    if (mutation.current) return;
    const current = ++optionGeneration.current;
    // A new service starts clean; changing the scope of the same one keeps the typed reason and the acknowledgement (wig :117),
    // only the replacement is chosen again from the new candidates.
    const sameLine = anchor !== null && anchor.id === line.id && anchor.kind === line.kind;
    setAnchor(line);
    setScope(selectedScope);
    setOptions(null);
    setOptionsLoading(true);
    if (!keepError) setReplacement('');
    if (!sameLine) {
      setReason('');
      setAcknowledged(false);
    }
    if (!keepError) setError(null);
    setSuccess(false);
    try {
      const result = await api.get<ReplacementOptionsResponse>(
        `/api/v1/operations/assignment-lines/${line.kind}/${line.id}/replacements`,
        { scope: selectedScope },
      );
      if (current === optionGeneration.current) setOptions(result);
    } catch (cause) {
      if (current === optionGeneration.current) setError(cause);
    } finally {
      if (current === optionGeneration.current) setOptionsLoading(false);
    }
  }

  async function submit() {
    const body = reassignmentBody(options, replacement, reason, acknowledged);
    if (!anchor || !body || mutation.current) return;
    let failed: { cause: unknown } | null = null;
    mutation.current = true;
    setSaving(true);
    setError(null);
    setSuccess(false);
    generation.current += 1;
    optionGeneration.current += 1;
    try {
      const result = await api.post<ReassignServicesResponse>(
        `/api/v1/operations/assignment-lines/${anchor.kind}/${anchor.id}/reassign`,
        body,
      );
      // One lookup map of the moved lines instead of a find per board line (rbp js-index-maps).
      const moved = new Map(result.lines.map((entry) => [`${entry.kind}:${entry.id}`, entry]));
      setBoard((previous) =>
        previous
          ? {
              ...previous,
              lines: previous.lines.flatMap((line) => {
                const updated = moved.get(`${line.kind}:${line.id}`);
                return updated
                  ? conflictsOnly && !updated.leaveConflict
                    ? []
                    : [updated]
                  : [line];
              }),
            }
          : previous,
      );
      notify(t.reassignment.success, () => setSuccess(true));
      await load();
    } catch (cause) {
      failed = { cause };
    } finally {
      mutation.current = false;
      setSaving(false);
    }
    if (failed) {
      // A stale candidate/version must be inspected again: the board is read again, the dialog keeps its input and shows why.
      await load(undefined, true);
      setError(failed.cause);
      void inspect(anchor, scope, true);
    }
  }
  // One cached formatter per locale and zone, not one per call (rbp js-cache-function-results).
  const zone = board?.branch.timezone ?? 'UTC';
  const stampFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
        timeZone: zone,
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale, zone],
  );
  const timestamp = (iso: string) => stampFormat.format(new Date(iso));
  const serviceName = (line: ReassignmentLine) =>
    locale === 'vi' ? line.service.nameVi : line.service.nameEn;
  const rows = board && board.branch.id === branchId ? board.lines : [];
  const r = t.reassignment;
  const activeFilters = (from ? 1 : 0) + (to ? 1 : 0) + (conflictsOnly ? 0 : 1);

  const columns: DataTableColumn<ReassignmentLine>[] = [
    {
      key: 'code',
      header: r.code,
      mobileTitle: true,
      cell: (line) => (
        <span className="ls-cell-stack">
          <span className="ls-cell-main" translate="no">
            {line.parentCode}
          </span>
          <span className="ls-cell-sub">{line.participantName ?? t.execution.participant}</span>
        </span>
      ),
    },
    {
      key: 'service',
      header: r.serviceCol,
      width: 'sm',
      cell: (line) => {
        const request = line.assignmentMode === 'SPECIFIC' ? r.specificShort : r.anyShort;
        return (
          <span className="ls-cell-stack">
            {/* Wrapped by word, never cut (Owner answer 7). */}
            <span className="ls-pos-name">{serviceName(line)}</span>
            <span className="ls-cell-sub ls-pos-name">{request}</span>
          </span>
        );
      },
    },
    {
      key: 'time',
      header: r.timeCol,
      hideBelow: 'lg',
      cell: (line) => (
        <span className="ls-cell-stack">
          <span className="ls-cell-main">{timestamp(line.plannedStartAt)}</span>
          <span className="ls-cell-sub">{timestamp(line.plannedEndAt)}</span>
        </span>
      ),
    },
    {
      key: 'current',
      header: r.current,
      hideBelow: 'xl',
      wrap: true,
      cell: (line) => line.employee.displayName,
    },
    {
      key: 'leave',
      header: r.leave,
      cell: (line) => (line.leaveConflict ? <Badge tone="warning">{r.leave}</Badge> : '—'),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (line) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: line.parentCode })}
          items={[
            {
              id: 'inspect',
              label: r.inspect,
              icon: 'swap',
              disabled: saving || loading || Boolean(error),
              // Why it is unavailable is said in the item (wig :255).
              ...(error && !saving && !loading ? { disabledReason: r.reloadFirst } : {}),
              onSelect: () => void inspect(line, 'PARTICIPANT'),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader title={r.title} intro={r.intro} />
      {branches.loading && !branches.data ? <Loading t={t} /> : null}
      {branches.error ? <Notice tone="error">{reassignmentError(branches.error, t)}</Notice> : null}
      {!branches.loading && allowed.length === 0 ? <Empty>{r.noBranch}</Empty> : null}
      {allowed.length ? (
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={activeFilters}
          // The range in the person's date format, not raw ISO (wig :274).
          resultCount={
            board
              ? `${formatDate(board.from, locale)} – ${formatDate(board.to, locale)}`
              : undefined
          }
          onReset={() => setView({ from: '', to: '', show: 'conflicts' })}
          reload={{
            label: r.refresh,
            onClick: () => void load(),
            busy: loading,
          }}
          search={
            <Select
              id="reassignment-branch"
              aria-label={t.bookingBoard.branch}
              value={branchId}
              disabled={saving}
              options={allowed.map((branch) => ({ value: branch.id, label: branch.name }))}
              onChange={(event) => setView({ branch: event.target.value, from: '', to: '' })}
            />
          }
          filters={
            <>
              <DateTextInput
                id="reassignment-from"
                aria-label={r.from}
                title={r.from}
                value={from}
                disabled={saving}
                onChange={(event) => setView({ from: event.target.value })}
              />
              <DateTextInput
                id="reassignment-to"
                aria-label={r.to}
                title={r.to}
                value={to}
                disabled={saving}
                onChange={(event) => setView({ to: event.target.value })}
              />
              {/* C47/C48: two exclusive choices are a segmented control, blocked as a whole while a reassignment saves. */}
              <SegmentedControl
                label={r.showLabel}
                className="ls-pos-reassign-show"
                value={conflictsOnly ? 'conflicts' : 'all'}
                disabled={saving}
                options={REASSIGN_SHOW.map((value) => ({
                  value,
                  label: value === 'conflicts' ? r.conflictsOnly : r.allLines,
                }))}
                onChange={(show) => setView({ show })}
              />
            </>
          }
        />
      ) : null}
      {error && !anchor ? <Notice tone="error">{reassignmentError(error, t)}</Notice> : null}
      {success ? <Notice tone="success">{r.success}</Notice> : null}
      {allowed.length ? (
        <>
          <DataTable
            mode="client"
            caption={fill(t.common.list.table, { list: r.title })}
            columns={columns}
            rows={rows}
            rowKey={(line) => `${line.kind}:${line.id}`}
            loading={loading && rows.length === 0}
            loadingLabel={t.common.loading}
            empty={board ? <EmptyState icon="calendar-check">{r.empty}</EmptyState> : undefined}
            paging={{
              page: view.page,
              pageSize: PAGE_SIZE,
              onPageChange: (page) => setView({ page }),
              labels: paginationLabels(t, r.title),
            }}
          />
          {board?.nextCursor ? (
            <CursorPagination
              hasNext
              loading={loading}
              onNext={() => void load(board.nextCursor!)}
              labels={{ ...cursorLabels(t, r.title), loadMore: r.more }}
            />
          ) : null}
        </>
      ) : null}
      {anchor ? (
        <ReassignmentDialog
          anchor={anchor}
          scope={scope}
          options={options}
          loading={optionsLoading}
          replacement={replacement}
          reason={reason}
          acknowledged={acknowledged}
          saving={saving}
          error={error ? reassignmentError(error, t) : null}
          serviceName={serviceName}
          timestamp={timestamp}
          onScope={(next) => void inspect(anchor, next)}
          onReplacement={setReplacement}
          onReason={setReason}
          onAcknowledged={setAcknowledged}
          onSubmit={submit}
          onClose={() => {
            optionGeneration.current += 1;
            setAnchor(null);
            setOptions(null);
            setOptionsLoading(false);
          }}
        />
      ) : null}
    </>
  );
}
