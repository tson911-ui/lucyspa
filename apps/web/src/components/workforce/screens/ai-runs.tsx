'use client';

import type {
  AiPageApproveResponse,
  AiPageResponse,
  AiRunList,
  AiRunPreview,
  AiRunRow,
  AiRunScope,
} from '@lucy-spa/contracts';
import {
  Card,
  CardHeader,
  Cluster,
  ConfirmDialog,
  DescriptionList,
  Drawer,
  Field,
  FormDialog,
  NumberInput,
  Select,
  Stack,
} from '@lucy-spa/ui';
import { useEffect, useState } from 'react';
import { aiDraftsDictionary } from '../../../i18n/ai-drafts';
import { fill } from '../../../i18n/workforce';
import { confirmError, formOverlayLabels } from '../../../lib/workforce/form-labels';
import { formatVnd } from '../../../lib/workforce/format';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';
import { Badge, Button, Empty, Loading, Notice, useResource, useSuccessToast } from '../ui';

const RUNS = '/api/v1/ai/product-runs';
const DRAFTS = '/api/v1/ai/product-drafts';

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
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  async function command(kind: 'pause' | 'resume', row: AiRunRow) {
    if (pending) return;
    setPending(true);
    setFailure(null);
    try {
      await api.post(`${RUNS}/${row.id}/${kind}`, { expectedRowVersion: row.rowVersion });
      notify(kind === 'pause' ? r.paused : r.resumed);
      await onChanged();
    } catch (error) {
      setFailure(errorMessage(error, t));
      await onChanged().catch(() => undefined);
    } finally {
      setPending(false);
    }
  }

  async function unlock() {
    if (pending) return;
    setPending(true);
    setFailure(null);
    try {
      await api.post(`${RUNS}/unlock`, { expectedRowVersion: data.settingsRowVersion });
      notify(r.unlocked);
      await onChanged();
    } catch (error) {
      setFailure(errorMessage(error, t));
      await onChanged().catch(() => undefined);
    } finally {
      setPending(false);
    }
  }

  const open = run !== undefined && OPEN_STATUSES.includes(run.status);
  const unlockButton = (
    <Button variant="primary" loading={pending} onClick={() => void unlock()}>
      {r.unlock}
    </Button>
  );
  const money = (value: string | null) => (value === null ? null : formatVnd(value, locale));
  if (run === undefined && data.unlocked) return null;
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
                  icon="close"
                  loading={pending}
                  onClick={() => void command('pause', run)}
                >
                  {r.pause}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  icon="refresh"
                  loading={pending}
                  onClick={() => void command('resume', run)}
                >
                  {r.resume}
                </Button>
              )}
              <Button
                variant="danger-outline"
                onClick={() => setCancelling(true)}
                disabled={pending}
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
                    ready: String(run.counts.draftReady),
                    writing: String(run.counts.queued + run.counts.generating),
                    failed: String(run.counts.failed + run.counts.needsAttention),
                    applied: String(run.counts.applied),
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
          busyLabel={t.common.saving}
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
      labels={{ ...formOverlayLabels(t, r.startConfirm), submitting: t.common.saving }}
      busy={pending}
      submitDisabled={!view || view.blocked.length > 0 || !limitOk}
      error={failure ? <Notice tone="error">{failure}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <Stack gap="block">
        <Field label={r.startScope}>
          {(control) => (
            <Select
              {...control}
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
                { label: r.facts.count, value: String(view.count) },
                { label: r.facts.pending, value: String(view.pending) },
                { label: r.facts.model, value: view.model },
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

/**
 * "Duyệt cả trang": the ready drafts of one page are shown as the text that would go on the website; opening it records that this
 * reviewer saw them; one confirm approves those without any note. Offered only after three drafts were applied one by one.
 */
export function PageApprovalDrawer({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = aiDraftsDictionary(locale);
  const p = text.page;
  const loaded = useResource(() => api.get<AiPageResponse>(`${DRAFTS}/page`), [api]);
  const page = loaded.data;
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [viewed, setViewed] = useState(false);
  const eligible = page?.items.filter((item) => item.eligible) ?? [];

  // Showing the page is what "seen" means: it is recorded once the drafts are on screen.
  useEffect(() => {
    if (!page || viewed || page.items.length === 0) return;
    setViewed(true);
    api.post(`${DRAFTS}/page-view`, { itemIds: page.items.map((item) => item.id) }).catch(() => {
      setFailure(p.loadFailed);
    });
  }, [api, page, viewed, p.loadFailed]);

  async function approve() {
    const result = await api.post<AiPageApproveResponse>(`${DRAFTS}/page-approve`, {
      itemIds: eligible.map((item) => item.id),
    });
    setConfirming(false);
    await onDone(
      fill(p.done, { applied: String(result.applied) }) +
        (result.skipped.length > 0
          ? fill(p.doneSkipped, { skipped: String(result.skipped.length) })
          : ''),
    );
  }

  return (
    <Drawer
      open
      title={p.title}
      closeLabel={t.common.close}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {p.close}
          </Button>
          <Button
            variant="primary"
            icon="check"
            disabled={eligible.length === 0 || !viewed}
            onClick={() => setConfirming(true)}
          >
            {eligible.length === 0
              ? p.approveNone
              : fill(p.approve, { count: String(eligible.length) })}
          </Button>
        </>
      }
    >
      {loaded.error && !page ? (
        <Notice tone="error">{p.loadFailed}</Notice>
      ) : !page ? (
        <Loading t={t} />
      ) : (
        <Stack gap="page">
          <p>{p.intro}</p>
          {failure ? <Notice tone="error">{failure}</Notice> : null}
          {page.items.length === 0 ? <Empty>{p.empty}</Empty> : null}
          {page.items.map((item) => (
            <section key={item.id} aria-label={item.productName}>
              <Stack gap="field">
                <h3>{item.productName}</h3>
                <DescriptionList
                  items={[
                    { label: p.description, value: item.descriptionVi },
                    { label: p.seoTitle, value: item.seoTitleVi },
                  ]}
                />
                {!item.eligible ? <Badge tone="warning">{p.notEligible}</Badge> : null}
              </Stack>
            </section>
          ))}
        </Stack>
      )}
      {confirming ? (
        <ConfirmDialog
          title={fill(p.confirmTitle, { count: String(eligible.length) })}
          description={fill(p.confirmBody, { count: String(eligible.length) })}
          facts={[
            { label: p.confirmFacts.products, value: String(eligible.length) },
            ...(page && page.items.length > eligible.length
              ? [
                  {
                    label: p.confirmFacts.skipped,
                    value: String(page.items.length - eligible.length),
                  },
                ]
              : []),
          ]}
          tone="warning"
          confirmLabel={fill(p.confirm, { count: String(eligible.length) })}
          busyLabel={t.common.saving}
          cancelLabel={t.common.cancel}
          referenceLabel={t.errors.reference}
          describeError={confirmError(t)}
          onConfirm={approve}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </Drawer>
  );
}
