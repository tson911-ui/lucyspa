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
  ListToolbar,
  RowActions,
  Select,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fill } from '../../../i18n/workforce';
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

export function ReassignmentScreen() {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const notify = useSuccessToast();
  const branches = useBranches(api);
  const allowed = useMemo(
    () => reassignmentBranches(account, branches.data),
    [account, branches.data],
  );
  const [branchId, setBranchId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [conflictsOnly, setConflictsOnly] = useState(true);
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
  const [paging, setPaging] = useState({ page: 1, pageSize: 20 });
  const generation = useRef(0);
  const optionGeneration = useRef(0);
  const mutation = useRef(false);

  useEffect(() => {
    if (!allowed.some((b) => b.id === branchId)) setBranchId(allowed[0]?.id ?? '');
  }, [allowed, branchId]);
  const load = useCallback(
    async (cursor?: string) => {
      if (!branchId) return;
      const current = ++generation.current;
      optionGeneration.current += 1;
      setAnchor(null);
      setOptions(null);
      setOptionsLoading(false);
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
    setPaging((current) => ({ ...current, page: 1 }));
    void load();
    return () => {
      generation.current += 1;
      optionGeneration.current += 1;
    };
  }, [load]);

  async function inspect(line: ReassignmentLine, selectedScope: ReassignmentScope) {
    if (mutation.current) return;
    const current = ++optionGeneration.current;
    setAnchor(line);
    setScope(selectedScope);
    setOptions(null);
    setOptionsLoading(true);
    setReplacement('');
    setReason('');
    setAcknowledged(false);
    setError(null);
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
      setBoard((previous) =>
        previous
          ? {
              ...previous,
              lines: previous.lines.flatMap((line) => {
                const updated = result.lines.find(
                  (entry) => entry.id === line.id && entry.kind === line.kind,
                );
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
      // A stale candidate/version must be inspected again; retain the safe error after reload.
      await load();
      setError(cause);
    } finally {
      mutation.current = false;
      setSaving(false);
    }
  }
  const timestamp = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
      timeZone: board?.branch.timezone ?? 'UTC',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  const serviceName = (line: ReassignmentLine) =>
    locale === 'vi' ? line.service.nameVi : line.service.nameEn;
  const rows = board?.branch.id === branchId ? board.lines : [];
  const r = t.reassignment;
  const activeFilters = (from ? 1 : 0) + (to ? 1 : 0) + (conflictsOnly ? 0 : 1);

  const columns: DataTableColumn<ReassignmentLine>[] = [
    {
      key: 'code',
      header: r.code,
      mobileTitle: true,
      cell: (line) => (
        <span className="ls-cell-stack">
          <span className="ls-cell-main">{line.parentCode}</span>
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
            <span className="ls-cell-title" title={serviceName(line)}>
              {serviceName(line)}
            </span>
            <span className="ls-cell-sub ls-cell-title" title={request}>
              {request}
            </span>
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
      truncate: true,
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
          resultCount={board ? `${board.from} – ${board.to}` : undefined}
          onReset={() => (setFrom(''), setTo(''), setConflictsOnly(true))}
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
              onChange={(event) => {
                setFrom('');
                setTo('');
                setBranchId(event.target.value);
              }}
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
                onChange={(event) => setFrom(event.target.value)}
              />
              <DateTextInput
                id="reassignment-to"
                aria-label={r.to}
                title={r.to}
                value={to}
                disabled={saving}
                onChange={(event) => setTo(event.target.value)}
              />
              <Select
                id="reassignment-conflicts"
                aria-label={r.conflictsOnly}
                value={conflictsOnly ? 'conflicts' : 'all'}
                disabled={saving}
                options={[
                  { value: 'conflicts', label: r.conflictsOnly },
                  { value: 'all', label: r.allLines },
                ]}
                onChange={(event) => setConflictsOnly(event.target.value === 'conflicts')}
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
            empty={board ? <Empty>{r.empty}</Empty> : undefined}
            paging={{
              ...paging,
              onPageChange: (page) => setPaging((current) => ({ ...current, page })),
              onPageSizeChange: (pageSize) => setPaging({ page: 1, pageSize }),
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
