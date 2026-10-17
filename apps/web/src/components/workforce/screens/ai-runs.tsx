'use client';

import type { AiRunList, AiRunPreview, AiRunRow, AiRunScope } from '@lucy-spa/contracts';
import {
  Card,
  CardHeader,
  Cluster,
  ConfirmDialog,
  DescriptionList,
  Field,
  FormDialog,
  NumberInput,
  Select,
  Stack,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { aiDraftsDictionary } from '../../../i18n/ai-drafts';
import { fill } from '../../../i18n/workforce';
import { confirmError, formOverlayLabels } from '../../../lib/workforce/form-labels';
import { formatVnd } from '../../../lib/workforce/format';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';
import { Badge, Button, Loading, Notice, useResource, useSuccessToast } from '../ui';
import { formatCount } from './products-links';

const RUNS = '/api/v1/ai/product-runs';

const OPEN_STATUSES = ['QUEUED', 'RUNNING', 'PAUSED_CAP', 'PAUSED_USER', 'PAUSED_ERROR'];

const statusTone = (status: AiRunRow['status']) =>
  status === 'DONE'
    ? 'success'
    : status === 'RUNNING' || status === 'QUEUED'
      ? 'info'
      : status === 'CANCELLED'
        ? 'neutral'
        : 'warning';

/**
 * The latest run on the drafts page (Claude integration CI-R3): its state and counts, pause / resume / cancel in the card header, the
 * "Cho phép chạy tiếp" unlock once three drafts were judged (the Owner only; the server decides), and the hint while it is locked.
 */
export function RunsPanel({
  data,
  onChanged,
}: {
  data: AiRunList;
  onChanged: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = aiDraftsDictionary(locale);
  const r = text.runs;
  const notify = useSuccessToast();
  const run = data.runs[0];
  // Which command is running: only the pressed button shows progress, the others wait disabled (wig ai-runs.tsx:110).
  const [pending, setPending] = useState<'pause' | 'resume' | 'unlock' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  async function command(kind: 'pause' | 'resume', row: AiRunRow) {
    if (pending) return;
    setPending(kind);
    setFailure(null);
    try {
      await api.post(`${RUNS}/${row.id}/${kind}`, { expectedRowVersion: row.rowVersion });
      notify(kind === 'pause' ? r.paused : r.resumed);
      await onChanged();
    } catch (error) {
      setFailure(errorMessage(error, t));
      await onChanged().catch(() => undefined);
    } finally {
      setPending(null);
    }
  }

  async function unlock() {
    if (pending) return;
    setPending('unlock');
    setFailure(null);
    try {
      await api.post(`${RUNS}/unlock`, { expectedRowVersion: data.settingsRowVersion });
      notify(r.unlocked);
      await onChanged();
    } catch (error) {
      setFailure(errorMessage(error, t));
      await onChanged().catch(() => undefined);
    } finally {
      setPending(null);
    }
  }

  const open = run !== undefined && OPEN_STATUSES.includes(run.status);
  // The page header's "Chạy viết lại" is the view's one filled button; unlocking is the outline.
  const unlockButton = (
    <Button
      variant="secondary"
      loading={pending === 'unlock'}
      disabled={pending !== null && pending !== 'unlock'}
      onClick={() => void unlock()}
    >
      {r.unlock}
    </Button>
  );
  const money = (value: string | null) => (value === null ? null : formatVnd(value, locale));
  if (run === undefined && data.unlocked) return null;
  if (run === undefined) {
    // No run yet: one line of guidance above the list, not a card holding a single sentence.
    return data.canUnlock ? (
      <Notice tone="info">
        <Stack gap="field">
          <span>{r.unlockNotice}</span>
          <span>{unlockButton}</span>
          {failure ? <span>{failure}</span> : null}
        </Stack>
      </Notice>
    ) : (
      <p className="ls-hint">{fill(r.lockedHint, { done: String(Math.min(3, data.reviewed)) })}</p>
    );
  }
  return (
    <Card as="section" aria-label={r.title}>
      <CardHeader
        title={run ? r.latest : r.title}
        actions={
          run && open ? (
            <Cluster>
              {data.canUnlock ? unlockButton : null}
              {run.status === 'QUEUED' || run.status === 'RUNNING' ? (
                <Button
                  variant="secondary"
                  icon="pause"
                  loading={pending === 'pause'}
                  disabled={pending !== null && pending !== 'pause'}
                  onClick={() => void command('pause', run)}
                >
                  {r.pause}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  icon="play"
                  loading={pending === 'resume'}
                  disabled={pending !== null && pending !== 'resume'}
                  onClick={() => void command('resume', run)}
                >
                  {r.resume}
                </Button>
              )}
              <Button
                variant="danger-outline"
                onClick={() => setCancelling(true)}
                disabled={pending !== null}
              >
                {r.cancel}
              </Button>
            </Cluster>
          ) : data.canUnlock ? (
            unlockButton
          ) : undefined
        }
      />
      <Stack gap="block">
        {failure ? <Notice tone="error">{failure}</Notice> : null}
        {run ? (
          <>
            <Cluster>
              <Badge tone={statusTone(run.status)}>{r.statuses[run.status]}</Badge>
              <span>{r.scopes[run.scope]}</span>
            </Cluster>
            {run.status === 'PAUSED_CAP' ||
            run.status === 'PAUSED_ERROR' ||
            run.status === 'PAUSED_USER' ? (
              <Notice tone="warning">
                {
                  r.pauseReasons[
                    (run.pauseReason && run.pauseReason in r.pauseReasons
                      ? run.pauseReason
                      : 'OTHER') as keyof typeof r.pauseReasons
                  ]
                }
              </Notice>
            ) : null}
            <DescriptionList
              items={[
                {
                  label: r.progress,
                  value: fill(r.counts, {
                    ready: formatCount(locale, run.counts.draftReady),
                    writing: formatCount(locale, run.counts.queued + run.counts.generating),
                    failed: formatCount(locale, run.counts.failed + run.counts.needsAttention),
                    applied: formatCount(locale, run.counts.applied),
                  }),
                },
                {
                  label: r.costLabel,
                  value:
                    run.estimateVnd === null
                      ? r.costUnknown
                      : fill(r.cost, {
                          estimate: money(run.estimateVnd) ?? '',
                          spent: money(run.spentVnd) ?? '',
                        }),
                },
              ]}
            />
          </>
        ) : null}
        {data.canUnlock ? (
          <Notice tone="info">{r.unlockNotice}</Notice>
        ) : !data.unlocked ? (
          <p className="ls-hint">
            {fill(r.lockedHint, { done: String(Math.min(3, data.reviewed)) })}
          </p>
        ) : null}
      </Stack>
      {cancelling && run ? (
        <ConfirmDialog
          title={r.cancelTitle}
          description={r.cancelBody}
          tone="danger"
          confirmLabel={r.cancelConfirm}
          busyLabel={r.cancelling}
          cancelLabel={r.keep}
          referenceLabel={t.errors.reference}
          describeError={confirmError(t)}
          onConfirm={async () => {
            await api.post(`${RUNS}/${run.id}/cancel`, { expectedRowVersion: run.rowVersion });
            setCancelling(false);
            notify(r.cancelled);
            await onChanged();
          }}
          onCancel={() => setCancelling(false)}
        />
      ) : null}
    </Card>
  );
}

/** "Chạy viết lại": choose what to run, read what it would take and cost, then start. Starting calls nothing and changes no product. */
export function StartRunDialog({
  data,
  onClose,
  onStarted,
}: {
  data: AiRunList;
  onClose: () => void;
  onStarted: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = aiDraftsDictionary(locale);
  const r = text.runs;
  const hasFirst = data.runs.some(
    (run) => run.scope === 'FIRST_THREE' && run.status !== 'CANCELLED',
  );
  const [scope, setScope] = useState<AiRunScope>(hasFirst ? 'ALL_PENDING' : 'FIRST_THREE');
  const [limit, setLimit] = useState('20');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const limitValue = Number(limit);
  const limitOk =
    scope !== 'ALL_PENDING' ||
    (Number.isInteger(limitValue) && limitValue >= 1 && limitValue <= 400);
  const preview = useResource(
    () =>
      limitOk
        ? api.get<AiRunPreview>(`${RUNS}/preview`, {
            scope,
            limit: scope === 'ALL_PENDING' ? limitValue : undefined,
          })
        : Promise.resolve(null),
    [api, scope, limitValue, limitOk],
  );
  const view = preview.data;
  const money = (value: string | null) => (value === null ? '—' : formatVnd(value, locale));
  const count = (value: number) => formatCount(locale, value);

  async function submit() {
    if (pending || !view || view.blocked.length > 0) return;
    setPending(true);
    setFailure(null);
    try {
      await api.post(RUNS, {
        scope,
        ...(scope === 'ALL_PENDING' ? { limit: limitValue } : {}),
      });
      await onStarted();
    } catch (error) {
      setFailure(errorMessage(error, t));
      await preview.reload().catch(() => undefined);
    } finally {
      setPending(false);
    }
  }

  return (
    <FormDialog
      title={r.startTitle}
      description={r.startBody}
      labels={{ ...formOverlayLabels(t, r.startConfirm), submitting: r.starting }}
      busy={pending}
      submitDisabled={!view || view.blocked.length > 0 || !limitOk}
      // A typed limit is input: closing asks before discarding it (C60).
      dirty={limit !== '20'}
      error={failure ? <Notice tone="error">{failure}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <Stack gap="block">
        <Field label={r.startScope}>
          {(control) => (
            <Select
              {...control}
              name="scope"
              autoComplete="off"
              options={[
                { value: 'FIRST_THREE', label: r.scopes.FIRST_THREE },
                { value: 'ALL_PENDING', label: r.scopes.ALL_PENDING },
              ]}
              value={scope}
              disabled={pending}
              onChange={(event) => setScope(event.target.value as AiRunScope)}
            />
          )}
        </Field>
        {scope === 'ALL_PENDING' ? (
          <Field
            label={r.startLimit}
            hint={r.startLimitHint}
            {...(!limitOk ? { error: r.startLimitHint } : {})}
          >
            {(control) => (
              <NumberInput
                {...control}
                name="limit"
                autoComplete="off"
                min={1}
                max={400}
                step={1}
                value={limit}
                disabled={pending}
                onChange={(event) => setLimit(event.target.value)}
              />
            )}
          </Field>
        ) : null}
        {!view ? (
          <Loading t={t} />
        ) : (
          <>
            {view.blocked.map((code) => (
              <Notice key={code} tone="warning">
                {r.blocked[code]}
              </Notice>
            ))}
            <DescriptionList
              items={[
                { label: r.facts.count, value: count(view.count) },
                { label: r.facts.pending, value: count(view.pending) },
                // A model id is a code token: never machine-translated.
                { label: r.facts.model, value: <span translate="no">{view.model}</span> },
                { label: r.facts.estimate, value: money(view.estimateVnd) },
                { label: r.facts.capLeft, value: money(view.capLeftVnd) },
              ]}
            />
          </>
        )}
      </Stack>
    </FormDialog>
  );
}
