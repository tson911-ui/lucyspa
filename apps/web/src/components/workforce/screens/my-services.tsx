'use client';

import type { MyServiceWorkResponse, ServiceExecutionWork } from '@lucy-spa/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { BOARD_REFRESH_MS } from '../../../lib/workforce/booking-board';
import {
  executionActionAllowed,
  executionBranches,
  executionErrorMessage,
} from '../../../lib/workforce/service-execution';
import { useBranches } from '../data';
import { useAccount, useWorkforce } from '../session';
import { Badge, Empty, Field, Loading, Notice, PageHeader, Section } from '../ui';

export function MyServicesScreen() {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const branches = useBranches(api);
  const allowed = useMemo(
    () => executionBranches(account, branches.data),
    [account, branches.data],
  );
  const [branchId, setBranchId] = useState('');
  const [board, setBoard] = useState<MyServiceWorkResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const mutating = useRef(false);

  useEffect(() => {
    if (!allowed.some((branch) => branch.id === branchId)) setBranchId(allowed[0]?.id ?? '');
  }, [allowed, branchId]);

  const load = useCallback(
    async (passive: boolean) => {
      if (!branchId || mutating.current) return;
      const current = ++generation.current;
      setLoading(true);
      try {
        const result = await api.get<MyServiceWorkResponse>(
          `/api/v1/operations/branches/${branchId}/my-services`,
          {},
          { passive },
        );
        if (current === generation.current) {
          setBoard(result);
          setError(null);
        }
      } catch (cause) {
        if (current === generation.current) setError(cause);
      } finally {
        if (current === generation.current) setLoading(false);
      }
    },
    [api, branchId],
  );

  useEffect(() => {
    setBoard(null);
    setError(null);
    setMessage(null);
    void load(false);
    const timer = window.setInterval(() => void load(true), BOARD_REFRESH_MS);
    return () => {
      generation.current += 1;
      window.clearInterval(timer);
    };
  }, [load]);

  async function act(line: ServiceExecutionWork, action: 'start' | 'end') {
    if (mutating.current || loading || error || !executionActionAllowed(line, action)) return;
    mutating.current = true;
    generation.current += 1; // an older passive read must never overwrite a mutation result
    setPending(line.lineId);
    setMessage(null);
    setError(null);
    let succeeded = false;
    try {
      const updated = await api.post<ServiceExecutionWork>(
        `/api/v1/operations/service-lines/${line.lineId}/${action}`,
        {},
      );
      setBoard((previous) =>
        previous
          ? {
              ...previous,
              lines: previous.lines.map((item) =>
                item.lineId === updated.lineId ? updated : item,
              ),
            }
          : previous,
      );
      setMessage(action === 'start' ? t.execution.started : t.execution.ended);
      succeeded = true;
    } catch (cause) {
      setError(cause);
    } finally {
      mutating.current = false;
      setPending(null);
      // Refresh the other lines' eligibility and visit state after the mutation response.
      if (succeeded) await load(false);
    }
  }

  const timestamp = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
      timeZone: board?.branch.timezone ?? 'UTC',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(iso));

  return (
    <>
      <PageHeader title={t.execution.title} intro={t.execution.intro}>
        <button
          className="wf-button"
          type="button"
          disabled={pending !== null || loading}
          onClick={() => void load(false)}
        >
          {t.bookingBoard.refresh}
        </button>
      </PageHeader>
      {branches.loading && !branches.data ? <Loading t={t} /> : null}
      {branches.error ? (
        <Notice tone="error">{executionErrorMessage(branches.error, t)}</Notice>
      ) : null}
      {!branches.loading && allowed.length === 0 ? <Empty>{t.execution.noBranch}</Empty> : null}
      {allowed.length > 0 ? (
        <Field id="execution-branch" label={t.bookingBoard.branch}>
          <select
            id="execution-branch"
            value={branchId}
            disabled={pending !== null}
            onChange={(event) => setBranchId(event.target.value)}
          >
            {allowed.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {error ? <Notice tone="error">{executionErrorMessage(error, t)}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}
      {loading && !board ? <Loading t={t} /> : null}
      {board?.lines.length === 0 ? <Empty>{t.execution.empty}</Empty> : null}
      {board?.branch.id === branchId
        ? board.lines.map((line) => (
            <Section
              key={line.lineId}
              title={`${locale === 'vi' ? line.service.nameVi : line.service.nameEn} · ${line.visitCode}`}
            >
              <Badge
                tone={
                  line.status === 'IN_PROGRESS'
                    ? 'info'
                    : line.status === 'DONE'
                      ? 'success'
                      : 'neutral'
                }
              >
                {t.execution.states[line.status]}
              </Badge>
              <p>
                {line.participantName ?? t.execution.participant} ·{' '}
                {fill(t.execution.sequence, { number: line.sequence })}
              </p>
              {line.plannedStartAt && line.plannedEndAt ? (
                <p className="wf-small">
                  {t.execution.planned}: {timestamp(line.plannedStartAt)} –{' '}
                  {timestamp(line.plannedEndAt)}
                </p>
              ) : null}
              {line.execution ? (
                <>
                  <p>
                    {t.execution.actualStart}: {timestamp(line.execution.startedAt)}
                  </p>
                  <p className="wf-small">
                    {t.execution.expectedEnd}: {timestamp(line.execution.expectedEndAt)}
                  </p>
                  {line.execution.endedAt ? (
                    <p>
                      {t.execution.actualEnd}: {timestamp(line.execution.endedAt)}
                    </p>
                  ) : null}
                </>
              ) : null}
              {line.visitStatus === 'COMPLETED' ? <p>{t.execution.visitCompleted}</p> : null}
              {line.status === 'PLANNED' && line.actions.startBlockedBy ? (
                <p className="wf-small">{t.execution.errors[line.actions.startBlockedBy]}</p>
              ) : null}
              {line.status === 'PLANNED' || line.status === 'IN_PROGRESS' ? (
                <button
                  type="button"
                  className="wf-button wf-button-primary"
                  disabled={
                    pending !== null ||
                    loading ||
                    Boolean(error) ||
                    !executionActionAllowed(line, line.status === 'PLANNED' ? 'start' : 'end')
                  }
                  onClick={() => void act(line, line.status === 'PLANNED' ? 'start' : 'end')}
                >
                  {pending === line.lineId
                    ? t.execution.working
                    : line.status === 'PLANNED'
                      ? t.execution.start
                      : t.execution.end}
                </button>
              ) : null}
            </Section>
          ))
        : null}
    </>
  );
}
