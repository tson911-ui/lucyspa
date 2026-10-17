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
  EmptyState,
  Field,
  FormActions,
  FormDialog,
  FormGrid,
  PageHeader,
  Stack,
  Tabs,
  Textarea,
  useUnsavedChangesGuard,
  useUrlState,
  type MenuItem,
} from '@lucy-spa/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  statusTone,
  workingContent,
  writeField,
  type FieldSpec,
} from '../../../lib/workforce/ai-drafts';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { formatDateTime } from '../../../lib/workforce/format';
import { canGlobal } from '../../../lib/workforce/permissions';
import { errorMessage } from '../../../lib/workforce/workflows';
import { opensInput } from '../../../lib/workforce/opens-input';
import { ListCrumbLink } from '../link';
import { useAccount, useWorkforce } from '../session';
import { Badge, Button, ErrorState, Loading, Notice, useResource, useSuccessToast } from '../ui';
import { listFormat } from './pos-format';
import { focusInvalidSoon } from './products-links';

const BASE = '/api/v1/ai/product-drafts';

// The language tab lives in the address bar (Back/Forward and a shared link open the same language).
const LANGUAGE_URL = { lang: 'vi' };
const LANGUAGE_OPTIONS = {
  normalize: (state: typeof LANGUAGE_URL) => ({ lang: state.lang === 'en' ? 'en' : 'vi' }),
};
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
  // A command's answer is kept beside the loaded draft it was made from; a fresh load replaces it (no mirror effect, rbp
  // ai-draft-detail.tsx:84-86: the copy is derived in render).
  const [local, setLocal] = useState<{ from: AiDraftDetail | null; value: AiDraftDetail } | null>(
    null,
  );
  const detail = local && local.from === loaded.data ? local.value : loaded.data;
  const loadedData = loaded.data;
  const setDetail = useCallback(
    (value: AiDraftDetail) => setLocal({ from: loadedData, value }),
    [loadedData],
  );
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
  }, [api, id, detail, setDetail]);
  const waiting = detail?.status === 'QUEUED' || detail?.status === 'GENERATING';
  const reloadDraft = loaded.reload;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void reloadDraft(), POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, reloadDraft]);

  if (!allowed) {
    return (
      <>
        <PageHeader title={text.title} description={text.intro} />
        <Notice tone="info">{text.noAccess}</Notice>
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
            <Badge tone="neutral">{text.detail.noteTag}</Badge> {warningMessage(warning, text)}
          </div>
        ))}
      </div>
    ),
  }));
}

/** What the worker fixed before saving, one row per field: what was wrong (or what was tidied) and who fixed it. */
function autoFixRows(detail: AiDraftDetail, text: Text) {
  const groups = new Map<string, string[]>();
  for (const fix of detail.autoFixes) {
    const label = warningField(fix.field, text) || text.detail.warningsGeneral;
    const what =
      (text.detail.autoFixCodes as Record<string, string>)[fix.code] ??
      (text.warnings as Record<string, string>)[fix.code] ??
      text.warnings.OTHER;
    const how = text.detail.autoFixHow[fix.how];
    groups.set(label, [...(groups.get(label) ?? []), `${what.replace(/[.]$/u, '')} (${how})`]);
  }
  return [...groups].map(([label, list]) => ({
    label,
    value: (
      <div>
        {list.map((line, index) => (
          <div key={`${index}:${line}`}>{line}</div>
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
  const [{ lang }, updateLang] = useUrlState(LANGUAGE_URL, LANGUAGE_OPTIONS);
  const language = lang === 'en' ? 'en' : 'vi';
  // A refused field from the server: shown at that field when the draft has one by that name, else above the form.
  const [problem, setProblem] = useState<{ field: string; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);

  const dirty = isDirty(detail, working, useName);
  useUnsavedChangesGuard(dirty && !pending);
  const ready = detail.status === 'DRAFT_READY' && working !== null;
  const editable = ready && !detail.stale;

  const fail = async (error: unknown) => {
    if (isConflict(error)) {
      setMessage(d.conflict);
      await reload();
      return;
    }
    const field = serverField(error);
    if (field) {
      setProblem({
        field,
        message: (text.fieldErrors as Record<string, string>)[field] ?? text.fieldErrors.generic,
      });
      const target = [...fieldSpecs('vi'), ...fieldSpecs('en')].find((spec) => spec.path === field);
      if (target) {
        // Inline at the failing field (wig ai-draft-detail.tsx:373): open its language tab and move focus there.
        updateLang({ lang: target.language });
        focusInvalidSoon();
      }
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
            label: opensInput(d.regenerate),
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
            label: opensInput(d.reject),
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
      : detail.stale
        ? d.blockedReason.stale
        : undefined;

  const specs = fieldSpecs(language);
  const problemAtField =
    problem !== null &&
    [...fieldSpecs('vi'), ...fieldSpecs('en')].some((spec) => spec.path === problem.field);
  const failureReason = (): string => {
    const key = errorKey(detail.errorCode, Object.keys(text.errors));
    return text.errors[key as keyof Text['errors']];
  };

  return (
    <>
      <PageHeader
        title={detail.product.nameVi}
        status={<Badge tone={statusTone(detail.status)}>{text.statuses[detail.status]}</Badge>}
        breadcrumbs={
          <Breadcrumbs
            label={text.breadcrumbs}
            LinkComponent={ListCrumbLink}
            items={[
              { label: text.title, href: `${base}/product-rewrites` },
              { label: detail.product.code },
            ]}
          />
        }
        actions={
          <ActionBar
            label={d.more}
            moreLabel={d.more}
            actions={menu}
            primary={
              ready ? (
                <Button
                  // While there are unsaved edits the form's "Lưu" is the one filled button; Apply waits as the outline.
                  variant={dirty ? 'secondary' : 'primary'}
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
        }
      />
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
        {problem && !problemAtField ? <Notice tone="error">{problem.message}</Notice> : null}

        {detail.warnings.length > 0 && working !== null ? (
          <Card as="section" aria-label={d.warningsTitle}>
            <CardHeader title={d.warningsTitle} />
            <Stack gap="field">
              <p className="ls-hint">{d.warningsHint}</p>
              <DescriptionList items={warningRows(detail.warnings, text)} />
            </Stack>
          </Card>
        ) : null}
        {detail.autoFixes.length > 0 && working !== null ? (
          <Card as="section" aria-label={d.autoFixTitle}>
            <CardHeader title={d.autoFixTitle} />
            <Stack gap="field">
              <p className="ls-hint">{d.autoFixHint}</p>
              <DescriptionList items={autoFixRows(detail, text)} />
            </Stack>
          </Card>
        ) : null}

        {working === null ? (
          <EmptyState title={d.noDraftTitle}>{d.noDraft}</EmptyState>
        ) : (
          <>
            <Tabs
              label={d.languageTabs}
              value={language}
              onChange={(value) => updateLang({ lang: value === 'en' ? 'en' : 'vi' })}
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
                      <ReadOnlyText
                        label={`${d.current}: ${text.fields.nameVi}`}
                        value={detail.product.nameVi}
                        empty={d.emptyCurrent}
                      />
                      <ReadOnlyText
                        label={`${d.draft}: ${d.nameSuggestion}`}
                        value={detail.nameViSuggestion ?? ''}
                        empty={d.emptyCurrent}
                      />
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
                    serverError={problem?.field === spec.path ? problem.message : undefined}
                    disabled={!editable || pending}
                    onChange={(value) => {
                      setWorking(writeField(working, spec, value));
                      setProblem(null);
                    }}
                  />
                ))}
              </Stack>
            </Card>
            {detail.factsKept.length > 0 ||
            detail.uncertain.length > 0 ||
            detail.suitableForInferred ? (
              <Card as="section" aria-label={d.aiNotes}>
                <CardHeader title={d.aiNotes} />
                <Stack gap="field">
                  <p className="ls-hint">{d.adminOnly}</p>
                  {detail.suitableForInferred ? <p>{d.suitableInferred}</p> : null}
                  {detail.factsKept.length > 0 ? (
                    <p>
                      <strong>{d.factsKept}:</strong> {listFormat(locale).format(detail.factsKept)}
                    </p>
                  ) : null}
                  {detail.uncertain.length > 0 ? (
                    <p>
                      <strong>{d.uncertain}:</strong> {listFormat(locale).format(detail.uncertain)}
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
          notes={detail.warnings.length}
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

/**
 * Reference text that cannot be edited (the product's current text, the suggested name): a label and the text itself, not a read-only
 * textarea, so it is read as text and adds no tab stop (wig ai-draft-detail.tsx:414). Line breaks are kept; long words wrap.
 */
function ReadOnlyText({ label, value, empty }: { label: string; value: string; empty: string }) {
  return (
    <div className="ls-adm-c-ref">
      <p className="ls-adm-c-ref-label">{label}</p>
      <p className={value === '' ? 'ls-adm-c-ref-text ls-adm-c-muted' : 'ls-adm-c-ref-text'}>
        {value === '' ? empty : value}
      </p>
    </div>
  );
}

/** One field: what the product has now (read only) beside the draft (editable), with the length rule for the search texts. */
function FieldRow({
  spec,
  current,
  value,
  text,
  serverError,
  disabled,
  onChange,
}: {
  spec: FieldSpec;
  current: string;
  value: string;
  text: Text;
  /** The server's refusal of this field (after a save). */
  serverError?: string | undefined;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const d = text.detail;
  const label = text.fields[spec.label as keyof Text['fields']] ?? spec.label;
  const over = spec.limit !== undefined && value.length > spec.limit;
  return (
    <FormGrid cols={2}>
      <ReadOnlyText label={`${d.current}: ${label}`} value={current} empty={d.emptyCurrent} />
      <Field
        label={`${d.draft}: ${label}`}
        {...(spec.limit !== undefined && !over
          ? { hint: fill(d.countOf, { count: String(value.length), max: String(spec.limit) }) }
          : {})}
        {...(over
          ? { error: fill(d.overLimit, { count: String(value.length), max: String(spec.limit) }) }
          : serverError
            ? { error: serverError }
            : {})}
      >
        {(control) => (
          <Textarea
            {...control}
            // One name per field ("descriptionVi", "sections.usage.en"), not one shared name for every box.
            name={spec.path}
            autoComplete="off"
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
  notes,
  onClose,
  onResult,
  onConflict,
}: {
  detail: AiDraftDetail;
  notes: number;
  onClose: () => void;
  onResult: (result: AiDraftApplyResponse) => void;
  onConflict: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = aiDraftsDictionary(locale);
  const d = text.detail;
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit() {
    if (pending) return;
    setPending(true);
    setFailure(null);
    try {
      onResult(
        await api.post<AiDraftApplyResponse>(`${BASE}/${detail.id}/apply`, {
          expectedRowVersion: detail.rowVersion,
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
      labels={{ ...formOverlayLabels(t, d.applyConfirm), submitting: d.applying }}
      busy={pending}
      error={failure ? <Notice tone="error">{failure}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      {notes > 0 ? (
        <Notice tone="info">{fill(d.applyNotes, { count: String(notes) })}</Notice>
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
        submitting: rejecting ? d.rejecting : d.regenerating,
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
            name="reason"
            autoComplete="off"
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
