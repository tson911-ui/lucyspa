'use client';

import type {
  AiDraftApplyResponse,
  AiDraftContent,
  AiDraftDetail,
  AiDraftWarning,
} from '@lucy-spa/contracts';
import {
  ActionBar,
  Breadcrumbs,
  Card,
  CardHeader,
  CheckField,
  DescriptionList,
  Field,
  FormActions,
  FormDialog,
  FormGrid,
  Stack,
  Tabs,
  Textarea,
  useUnsavedChangesGuard,
  type MenuItem,
} from '@lucy-spa/ui';
import { useEffect, useRef, useState } from 'react';
import { aiDraftsDictionary } from '../../../i18n/ai-drafts';
import { fill } from '../../../i18n/workforce';
import {
  editRequest,
  errorKey,
  fieldSpecs,
  isConflict,
  isDirty,
  readField,
  rowsFor,
  serverField,
  workingContent,
  writeField,
  type FieldSpec,
} from '../../../lib/workforce/ai-drafts';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { formatDateTime } from '../../../lib/workforce/format';
import { canGlobal } from '../../../lib/workforce/permissions';
import { errorMessage } from '../../../lib/workforce/workflows';
import { PrefetchLink as Link } from '../link';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
  useResource,
  useSuccessToast,
} from '../ui';

const BASE = '/api/v1/ai/product-drafts';
const POLL_MS = 4000;
const ZONE = 'Asia/Ho_Chi_Minh';

type Overlay = 'apply' | 'reject' | 'regenerate' | null;
type Text = ReturnType<typeof aiDraftsDictionary>;

/**
 * One draft on its own page (Claude integration CI-R2). The current text of the product sits beside the draft, field by field, in two
 * language tabs; the draft side is editable. Apply is the page's one primary action and is available only for a ready, fresh draft with
 * nothing to fix and nothing unsaved; the server checks all of it again. Reject and rewrite are in the header menu, never next to the
 * primary button by accident.
 */
export function AiDraftScreen({ id }: { id: string }) {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const text = aiDraftsDictionary(locale);
  const allowed = canGlobal(account, 'USE_AI_CONTENT');
  const loaded = useResource(
    () =>
      allowed ? api.get<AiDraftDetail>(`${BASE}/${encodeURIComponent(id)}`) : Promise.resolve(null),
    [api, id, allowed],
  );
  const [detail, setDetail] = useState<AiDraftDetail | null>(null);
  useEffect(() => {
    if (loaded.data) setDetail(loaded.data);
  }, [loaded.data]);
  // The first time a ready draft is opened by a reviewer it is recorded (the page approval of CI-R3 counts on it).
  const viewed = useRef(false);
  useEffect(() => {
    if (!detail || viewed.current || detail.viewedAt !== null || detail.status !== 'DRAFT_READY')
      return;
    viewed.current = true;
    api
      .post<AiDraftDetail>(`${BASE}/${encodeURIComponent(id)}/view`, {})
      .then(setDetail)
      .catch(() => undefined);
  }, [api, id, detail]);
  const waiting = detail?.status === 'QUEUED' || detail?.status === 'GENERATING';
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void loaded.reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, loaded]);

  if (!allowed) {
    return (
      <>
        <PageHeader title={text.title} intro={text.intro} />
        <Empty>{text.noAccess}</Empty>
      </>
    );
  }
  if (loaded.error && !detail) {
    return <ErrorState error={loaded.error} t={t} onRetry={() => void loaded.reload()} />;
  }
  if (!detail) return <Loading t={t} page />;
  return (
    <DraftPanel
      key={`${detail.id}:${detail.rowVersion}`}
      detail={detail}
      onChange={setDetail}
      reload={async () => {
        await loaded.reload();
      }}
    />
  );
}

/** The label of the field a warning is about ("Mô tả (Tiếng Việt)"), or '' when it is about the draft as a whole. */
function warningField(field: string | undefined, text: Text): string {
  const name = field ?? '';
  const english = /En(\.|$)/.test(name);
  const key = name.startsWith('sections') ? name.split('.')[1] : name;
  const label = text.fields[(key ?? '') as keyof Text['fields']];
  return label ? `${label} (${english ? text.detail.en : text.detail.vi})` : '';
}

const warningMessage = (warning: AiDraftWarning, text: Text): string =>
  text.warnings[
    (Object.keys(text.warnings).includes(warning.code)
      ? warning.code
      : 'OTHER') as keyof Text['warnings']
  ];

/** The warnings grouped by field, one row per field (a field with two problems lists both). */
function warningRows(warnings: readonly AiDraftWarning[], text: Text) {
  const groups = new Map<string, AiDraftWarning[]>();
  for (const warning of warnings) {
    const label = warningField(warning.field, text) || text.detail.warningsGeneral;
    groups.set(label, [...(groups.get(label) ?? []), warning]);
  }
  return [...groups].map(([label, list]) => ({
    label,
    value: (
      <div>
        {list.map((warning, index) => (
          <div key={`${warning.code}:${index}`}>
            <Badge tone={warning.blocking ? 'warning' : 'neutral'}>
              {warning.blocking ? text.detail.blockingTag : text.detail.noteTag}
            </Badge>{' '}
            {warningMessage(warning, text)}
          </div>
        ))}
      </div>
    ),
  }));
}

function DraftPanel({
  detail,
  onChange,
  reload,
}: {
  detail: AiDraftDetail;
  onChange: (detail: AiDraftDetail) => void;
  reload: () => Promise<void>;
}) {
  const { api, t, locale, base } = useWorkforce();
  const { account } = useAccount();
  const text = aiDraftsDictionary(locale);
  const d = text.detail;
  const notify = useSuccessToast();
  const canApply = canGlobal(account, 'MANAGE_PRODUCTS');
  const saved = workingContent(detail);
  const [working, setWorking] = useState<AiDraftContent | null>(saved);
  const [useName, setUseName] = useState(detail.useNameSuggestion);
  const [language, setLanguage] = useState<'vi' | 'en'>('vi');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);

  const dirty = isDirty(detail, working, useName);
  useUnsavedChangesGuard(dirty && !pending);
  const ready = detail.status === 'DRAFT_READY' && working !== null;
  const editable = ready && !detail.stale;
  const soft = detail.warnings.filter((warning) => !warning.blocking);

  const fail = async (error: unknown) => {
    if (isConflict(error)) {
      setMessage(d.conflict);
      await reload();
      return;
    }
    const field = serverField(error);
    if (field) {
      setProblem((text.fieldErrors as Record<string, string>)[field] ?? text.fieldErrors.generic);
      return;
    }
    setMessage(errorMessage(error, t));
  };

  async function run<T>(work: () => Promise<T>, done: (value: T) => void) {
    if (pending) return;
    setPending(true);
    setMessage(null);
    setProblem(null);
    try {
      done(await work());
    } catch (error) {
      await fail(error);
    } finally {
      setPending(false);
    }
  }

  const save = () =>
    run(
      () =>
        api.post<AiDraftDetail>(
          `${BASE}/${detail.id}/edit`,
          editRequest(detail, working!, useName),
        ),
      (next) => {
        onChange(next);
        notify(d.saved);
      },
    );

  const retry = () =>
    run(
      () =>
        api.post<AiDraftDetail>(`${BASE}/${detail.id}/retry`, {
          expectedRowVersion: detail.rowVersion,
        }),
      (next) => {
        onChange(next);
        notify(d.retried);
      },
    );

  const menu: MenuItem[] = [
    ...(detail.canRegenerate && !detail.stale
      ? [
          {
            id: 'regenerate',
            label: d.regenerate,
            icon: 'refresh' as const,
            onSelect: () => setOverlay('regenerate'),
          },
        ]
      : []),
    ...(['FAILED', 'NEEDS_ATTENTION', 'STALE'].includes(detail.status) || detail.stale
      ? [
          {
            id: 'retry',
            label: d.retry,
            icon: 'refresh' as const,
            onSelect: () => void retry(),
          },
        ]
      : []),
    ...(['QUEUED', 'DRAFT_READY', 'NEEDS_ATTENTION', 'FAILED', 'STALE'].includes(detail.status)
      ? [
          {
            id: 'reject',
            label: d.reject,
            icon: 'close' as const,
            tone: 'danger' as const,
            onSelect: () => setOverlay('reject'),
          },
        ]
      : []),
  ];
  // A stale draft is retried, never regenerated from the old text: the menu shows one of the two.
  const applyBlockedReason = !canApply
    ? d.forbiddenApply
    : dirty
      ? d.blockedReason.unsaved
      : detail.blocking
        ? d.blockedReason.blocking
        : detail.stale
          ? d.blockedReason.stale
          : undefined;

  const specs = fieldSpecs(language);
  const failureReason = (): string => {
    const key = errorKey(detail.errorCode, Object.keys(text.errors));
    return text.errors[key as keyof Text['errors']];
  };

  return (
    <>
      <PageHeader
        title={detail.product.nameVi}
        breadcrumbs={
          <Breadcrumbs
            label={text.breadcrumbs}
            LinkComponent={Link}
            items={[
              { label: text.title, href: `${base}/product-rewrites` },
              { label: detail.product.code },
            ]}
          />
        }
      >
        <ActionBar
          label={d.more}
          moreLabel={d.more}
          actions={menu}
          primary={
            ready ? (
              <Button
                variant="primary"
                icon="check"
                onClick={() => setOverlay('apply')}
                disabled={applyBlockedReason !== undefined}
                {...(applyBlockedReason ? { disabledReason: applyBlockedReason } : {})}
              >
                {d.apply}
              </Button>
            ) : undefined
          }
        />
      </PageHeader>
      <Stack gap="page">
        {detail.status === 'APPLIED' ? (
          <Notice tone="success">
            {fill(d.infoApplied, {
              time: detail.appliedAt ? formatDateTime(detail.appliedAt, ZONE, locale) : '',
            })}
          </Notice>
        ) : null}
        {detail.status === 'REJECTED' ? <Notice tone="info">{d.infoRejected}</Notice> : null}
        {detail.status === 'QUEUED' || detail.status === 'GENERATING' ? (
          <Notice tone="info">{d.infoPending}</Notice>
        ) : null}
        {detail.status === 'FAILED' || detail.status === 'NEEDS_ATTENTION' ? (
          <Notice tone="warning">{fill(d.failed, { reason: failureReason() })}</Notice>
        ) : null}
        {detail.stale && detail.status !== 'APPLIED' && detail.status !== 'REJECTED' ? (
          <Notice tone="warning">{d.stale}</Notice>
        ) : null}
        {message ? <Notice tone="error">{message}</Notice> : null}
        {problem ? <Notice tone="error">{problem}</Notice> : null}

        {detail.warnings.length > 0 && working !== null ? (
          <Card as="section" aria-label={d.warningsTitle}>
            <CardHeader title={d.warningsTitle} />
            <DescriptionList items={warningRows(detail.warnings, text)} />
          </Card>
        ) : null}

        {working === null ? (
          <Empty>{d.noDraft}</Empty>
        ) : (
          <>
            <Tabs
              label={d.languageTabs}
              value={language}
              onChange={(value) => setLanguage(value === 'en' ? 'en' : 'vi')}
              tabs={[
                { id: 'vi', label: d.vi, panel: null },
                { id: 'en', label: d.en, panel: null },
              ]}
            />
            <Card as="section" aria-label={language === 'vi' ? d.vi : d.en}>
              <Stack gap="page">
                {language === 'vi' && detail.nameViSuggestion ? (
                  <Stack gap="field">
                    <FormGrid cols={2}>
                      <Field label={`${d.current}: ${text.fields.nameVi}`}>
                        {(control) => (
                          <Textarea {...control} readOnly rows={2} value={detail.product.nameVi} />
                        )}
                      </Field>
                      <Field label={`${d.draft}: ${d.nameSuggestion}`}>
                        {(control) => (
                          <Textarea
                            {...control}
                            readOnly
                            rows={2}
                            value={detail.nameViSuggestion ?? ''}
                          />
                        )}
                      </Field>
                    </FormGrid>
                    <CheckField
                      label={d.useName}
                      checked={useName}
                      disabled={!editable || pending}
                      onChange={(event) => setUseName(event.target.checked)}
                    />
                  </Stack>
                ) : null}
                {specs.map((spec) => (
                  <FieldRow
                    key={spec.path}
                    spec={spec}
                    current={readField(detail.current, spec)}
                    value={readField(working, spec)}
                    text={text}
                    disabled={!editable || pending}
                    onChange={(value) => {
                      setWorking(writeField(working, spec, value));
                      setProblem(null);
                    }}
                  />
                ))}
              </Stack>
            </Card>
            {detail.factsKept.length > 0 || detail.uncertain.length > 0 ? (
              <Card as="section" aria-label={d.aiNotes}>
                <CardHeader title={d.aiNotes} />
                <Stack gap="field">
                  {detail.factsKept.length > 0 ? (
                    <p>
                      <strong>{d.factsKept}:</strong> {detail.factsKept.join(', ')}
                    </p>
                  ) : null}
                  {detail.uncertain.length > 0 ? (
                    <p>
                      <strong>{d.uncertain}:</strong> {detail.uncertain.join(', ')}
                    </p>
                  ) : null}
                </Stack>
              </Card>
            ) : null}
            {editable && dirty ? (
              <FormActions
                cancel={
                  <Button
                    variant="secondary"
                    disabled={pending}
                    onClick={() => {
                      setWorking(saved);
                      setUseName(detail.useNameSuggestion);
                      setProblem(null);
                    }}
                  >
                    {d.revert}
                  </Button>
                }
                primary={
                  <Button variant="primary" loading={pending} onClick={() => void save()}>
                    {pending ? d.saving : d.save}
                  </Button>
                }
              />
            ) : null}
          </>
        )}
      </Stack>
      {overlay === 'apply' ? (
        <ApplyDialog
          detail={detail}
          soft={soft}
          onClose={() => setOverlay(null)}
          onResult={(result) => {
            setOverlay(null);
            onChange(result.detail);
            if (result.result === 'APPLIED') notify(d.applied);
            else setMessage(d.staleNow);
          }}
          onConflict={reload}
        />
      ) : null}
      {overlay === 'reject' ? (
        <TextDialog
          kind="reject"
          detail={detail}
          onClose={() => setOverlay(null)}
          onDone={(next) => {
            setOverlay(null);
            onChange(next);
            notify(d.rejected);
          }}
          onConflict={reload}
        />
      ) : null}
      {overlay === 'regenerate' ? (
        <TextDialog
          kind="regenerate"
          detail={detail}
          onClose={() => setOverlay(null)}
          onDone={(next) => {
            setOverlay(null);
            onChange(next);
            notify(d.regenerated);
          }}
          onConflict={reload}
        />
      ) : null}
    </>
  );
}

/** One field: what the product has now (read only) beside the draft (editable), with the length rule for the search texts. */
function FieldRow({
  spec,
  current,
  value,
  text,
  disabled,
  onChange,
}: {
  spec: FieldSpec;
  current: string;
  value: string;
  text: Text;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const d = text.detail;
  const label = text.fields[spec.label as keyof Text['fields']] ?? spec.label;
  const over = spec.limit !== undefined && value.length > spec.limit;
  return (
    <FormGrid cols={2}>
      <Field label={`${d.current}: ${label}`}>
        {(control) => (
          <Textarea
            {...control}
            readOnly
            rows={rowsFor(current)}
            value={current}
            placeholder={d.emptyCurrent}
          />
        )}
      </Field>
      <Field
        label={`${d.draft}: ${label}`}
        {...(spec.limit !== undefined && !over
          ? { hint: fill(d.countOf, { count: String(value.length), max: String(spec.limit) }) }
          : {})}
        {...(over
          ? { error: fill(d.overLimit, { count: String(value.length), max: String(spec.limit) }) }
          : {})}
      >
        {(control) => (
          <Textarea
            {...control}
            rows={rowsFor(value)}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
      </Field>
    </FormGrid>
  );
}

function ApplyDialog({
  detail,
  soft,
  onClose,
  onResult,
  onConflict,
}: {
  detail: AiDraftDetail;
  soft: AiDraftWarning[];
  onClose: () => void;
  onResult: (result: AiDraftApplyResponse) => void;
  onConflict: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = aiDraftsDictionary(locale);
  const d = text.detail;
  const [ack, setAck] = useState(false);
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit() {
    setChecked(true);
    if (pending || (soft.length > 0 && !ack)) return;
    setPending(true);
    setFailure(null);
    try {
      onResult(
        await api.post<AiDraftApplyResponse>(`${BASE}/${detail.id}/apply`, {
          expectedRowVersion: detail.rowVersion,
          ...(soft.length > 0 ? { acknowledgeWarnings: true } : {}),
        }),
      );
    } catch (error) {
      if (isConflict(error)) {
        await onConflict().catch(() => undefined);
        setFailure(d.conflict);
      } else {
        const field = serverField(error);
        setFailure(
          field
            ? ((text.fieldErrors as Record<string, string>)[field] ?? text.fieldErrors.generic)
            : errorMessage(error, t),
        );
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <FormDialog
      title={d.applyTitle}
      description={d.applyBody}
      labels={{ ...formOverlayLabels(t, d.applyConfirm), submitting: t.common.saving }}
      busy={pending}
      error={failure ? <Notice tone="error">{failure}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      {soft.length > 0 ? (
        <Stack gap="field">
          <Notice tone="info">{fill(d.applyNotes, { count: String(soft.length) })}</Notice>
          <CheckField
            label={d.applyAck}
            checked={ack}
            onChange={(event) => setAck(event.target.checked)}
            {...(checked && !ack ? { error: text.fieldErrors.acknowledgeWarnings } : {})}
          />
        </Stack>
      ) : null}
    </FormDialog>
  );
}

/** The two small questions: why a draft is rejected, and what to change when it is written again. Both are one optional line. */
function TextDialog({
  kind,
  detail,
  onClose,
  onDone,
  onConflict,
}: {
  kind: 'reject' | 'regenerate';
  detail: AiDraftDetail;
  onClose: () => void;
  onDone: (next: AiDraftDetail) => void;
  onConflict: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = aiDraftsDictionary(locale);
  const d = text.detail;
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const rejecting = kind === 'reject';

  async function submit() {
    if (pending) return;
    setPending(true);
    setFailure(null);
    try {
      const line = value.trim();
      onDone(
        await api.post<AiDraftDetail>(`${BASE}/${detail.id}/${kind}`, {
          expectedRowVersion: detail.rowVersion,
          ...(line !== '' ? (rejecting ? { reason: line } : { instruction: line }) : {}),
        }),
      );
    } catch (error) {
      if (isConflict(error)) {
        await onConflict().catch(() => undefined);
        setFailure(d.conflict);
      } else {
        const field = serverField(error);
        setFailure(
          field
            ? ((text.fieldErrors as Record<string, string>)[field] ?? text.fieldErrors.generic)
            : errorMessage(error, t),
        );
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <FormDialog
      title={rejecting ? d.rejectTitle : d.regenerateTitle}
      description={
        rejecting ? d.rejectBody : fill(d.regenerateBody, { used: String(detail.regenerations) })
      }
      labels={{
        ...formOverlayLabels(t, rejecting ? d.rejectConfirm : d.regenerateConfirm),
        submitting: t.common.saving,
      }}
      busy={pending}
      dirty={value.trim() !== ''}
      error={failure ? <Notice tone="error">{failure}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field label={rejecting ? d.rejectReason : d.regenerateHint}>
        {(control) => (
          <Textarea
            {...control}
            rows={3}
            maxLength={300}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
      </Field>
    </FormDialog>
  );
}
