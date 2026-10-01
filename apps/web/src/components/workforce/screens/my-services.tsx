'use client';

import type { MyServiceWorkResponse, ServiceExecutionWork } from '@lucy-spa/contracts';
import {
  Button,
  Card,
  CardHeader,
  DescriptionList,
  Grid,
  ListToolbar,
  RowActions,
  Select,
  type DescriptionItem,
} from '@lucy-spa/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { BOARD_REFRESH_MS } from '../../../lib/workforce/booking-board';
import { resultsText, toolbarLabels } from '../../../lib/workforce/list-view';
import {
  executionActionAllowed,
  executionBranches,
  executionErrorMessage,
} from '../../../lib/workforce/service-execution';
import { AddServiceDialog } from './add-service';
import { useBranches } from '../data';
import { useAccount, useWorkforce } from '../session';
import { Badge, Empty, Loading, Notice, PageHeader, useSuccessToast } from '../ui';

/**
 * "Dịch vụ của tôi": the work the signed-in staff member is assigned today. One card per service
 * line (a staff member has a handful of lines at a time, and Start/End must stay one clear tap on a
 * phone), equal heights, the primary action last in the card, "Add service" in the card's menu.
 */
export function MyServicesScreen() {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const notify = useSuccessToast();
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
  const [adding, setAdding] = useState<ServiceExecutionWork | null>(null);
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

  const success = (text: string) => notify(text, () => setMessage(text));

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
      success(action === 'start' ? t.execution.started : t.execution.ended);
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

  // The planned slot is read as hours of the day; the actual times keep the date and the seconds.
  const clock = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
      timeZone: board?.branch.timezone ?? 'UTC',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  const lines = board?.branch.id === branchId ? board.lines : [];

  function details(line: ServiceExecutionWork): DescriptionItem[] {
    const e = t.execution;
    return [
      { label: e.participant, value: line.participantName },
      ...(line.plannedStartAt && line.plannedEndAt
        ? [
            {
              label: e.planned,
              value: `${clock(line.plannedStartAt)} – ${clock(line.plannedEndAt)}`,
            },
          ]
        : []),
      ...(line.execution
        ? [
            { label: e.actualStart, value: timestamp(line.execution.startedAt) },
            { label: e.expectedEnd, value: timestamp(line.execution.expectedEndAt) },
            ...(line.execution.endedAt
              ? [{ label: e.actualEnd, value: timestamp(line.execution.endedAt) }]
              : []),
          ]
        : []),
    ];
  }

  function primaryAction(line: ServiceExecutionWork) {
    if (line.status !== 'PLANNED' && line.status !== 'IN_PROGRESS') return null;
    const action = line.status === 'PLANNED' ? 'start' : 'end';
    const allowedNow = executionActionAllowed(line, action);
    const reason =
      !allowedNow && line.status === 'PLANNED' && line.actions.startBlockedBy
        ? t.execution.errors[line.actions.startBlockedBy]
        : undefined;
    return (
      <Button
        variant="primary"
        size="lg"
        fullWidth
        loading={pending === line.lineId}
        disabled={pending !== null || loading || Boolean(error) || !allowedNow}
        {...(reason ? { disabledReason: reason } : {})}
        onClick={() => void act(line, action)}
      >
        {pending === line.lineId
          ? t.execution.working
          : line.status === 'PLANNED'
            ? t.execution.start
            : t.execution.end}
      </Button>
    );
  }

  return (
    <>
      <PageHeader title={t.execution.title} intro={t.execution.intro} />
      {branches.loading && !branches.data ? <Loading t={t} /> : null}
      {branches.error ? (
        <Notice tone="error">{executionErrorMessage(branches.error, t)}</Notice>
      ) : null}
      {!branches.loading && allowed.length === 0 ? <Empty>{t.execution.noBranch}</Empty> : null}
      {allowed.length > 0 ? (
        <ListToolbar
          labels={toolbarLabels(t)}
          resultCount={board ? resultsText(t, lines.length) : undefined}
          reload={{ label: t.bookingBoard.refresh, onClick: () => void load(false), busy: loading }}
          search={
            <Select
              id="execution-branch"
              aria-label={t.bookingBoard.branch}
              value={branchId}
              disabled={pending !== null}
              options={allowed.map((branch) => ({ value: branch.id, label: branch.name }))}
              onChange={(event) => setBranchId(event.target.value)}
            />
          }
        />
      ) : null}
      {error ? <Notice tone="error">{executionErrorMessage(error, t)}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}
      {loading && !board ? <Loading t={t} /> : null}
      {board?.branch.id === branchId && lines.length === 0 ? (
        <Empty>{t.execution.empty}</Empty>
      ) : null}
      {lines.length > 0 ? (
        <Grid min="lg" gap="block">
          {lines.map((line) => {
            const name = locale === 'vi' ? line.service.nameVi : line.service.nameEn;
            return (
              <Card as="article" key={line.lineId} aria-label={`${name} · ${line.visitCode}`}>
                <CardHeader
                  title={name}
                  description={`${line.visitCode} · ${fill(t.execution.sequence, { number: line.sequence })}`}
                  headingLevel={3}
                  clamp
                  actions={
                    line.actions.addService ? (
                      <RowActions
                        menuLabel={fill(t.common.list.actionsFor, { name: line.visitCode })}
                        items={[
                          {
                            id: 'add',
                            label: t.bookingBoard.addService,
                            icon: 'plus',
                            disabled: pending !== null,
                            onSelect: () => setAdding(line),
                          },
                        ]}
                      />
                    ) : undefined
                  }
                />
                <div>
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
                </div>
                <DescriptionList items={details(line)} />
                {line.visitStatus === 'COMPLETED' ? (
                  <p className="ls-hint">{t.execution.visitCompleted}</p>
                ) : null}
                {primaryAction(line)}
              </Card>
            );
          })}
        </Grid>
      ) : null}
      {adding ? (
        <AddServiceDialog
          visitId={adding.visitId}
          visitCode={adding.visitCode}
          participants={[{ id: adding.participantId, name: adding.participantName }]}
          onClose={() => setAdding(null)}
          onAdded={(text) => {
            setAdding(null);
            success(text);
            void load(false);
          }}
        />
      ) : null}
    </>
  );
}
