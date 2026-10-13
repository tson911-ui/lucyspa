'use client';

import {
  AI_SEO_KINDS,
  AI_SEO_STATUSES,
  type AiSeoApplyResponse,
  type AiSeoCreateResponse,
  type AiSeoDetail,
  type AiSeoList,
  type AiSeoPreview,
  type AiSeoRow,
  type AiSeoStatus,
} from '@lucy-spa/contracts';
import {
  Cluster,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  Drawer,
  FacetedFilter,
  Field,
  FormDialog,
  ListSection,
  ListToolbar,
  RowActions,
  Select,
  Stack,
  Textarea,
  useUrlState,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useEffect, useState } from 'react';
import { aiSeoDictionary } from '../../../i18n/ai-seo';
import { fill } from '../../../i18n/workforce';
import {
  AI_SEO_LIST_DEFAULTS,
  AI_SEO_PAGE_KEYS,
  SEO_TARGET,
  applyRequest,
  editRequest,
  errorKey,
  formOf,
  hasEnglishText,
  isConflict,
  isDirty,
  isWorking,
  normalizeAiSeoList,
  serverField,
  statusTone,
  type SeoForm,
} from '../../../lib/workforce/ai-seo';
import { confirmError, formOverlayLabels } from '../../../lib/workforce/form-labels';
import { formatDateTime, formatVnd } from '../../../lib/workforce/format';
import { paginationLabels, toolbarLabels } from '../../../lib/workforce/list-view';
import { canGlobal } from '../../../lib/workforce/permissions';
import { errorMessage } from '../../../lib/workforce/workflows';
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

const BASE = '/api/v1/ai/seo-drafts';
const POLL_MS = 5000;
const ZONE = 'Asia/Ho_Chi_Minh';

/**
 * "Mô tả tìm kiếm và tiếng Anh" (Claude integration CI-E1): the search descriptions and English texts the AI drafted for services and the
 * home page, 20 per page, filtered by status and kind. A draft opens in a drawer (the text now beside the draft, editable) and is applied
 * one by one. While drafts are being written the list asks again every few seconds. Authority: `USE_AI_CONTENT`, global; applying needs
 * `MANAGE_SERVICES` (a service) or `MANAGE_WEBSITE_CONTENT` (the home page), checked by the server.
 */
export function AiSeoScreen() {
  const { locale } = useWorkforce();
  const { account } = useAccount();
  const text = aiSeoDictionary(locale);
  if (!canGlobal(account, 'USE_AI_CONTENT')) {
    return (
      <>
        <PageHeader title={text.title} intro={text.intro} />
        <Empty>{text.noAccess}</Empty>
      </>
    );
  }
  return <AiSeoPage />;
}

function AiSeoPage() {
  const { api, t, locale } = useWorkforce();
  const text = aiSeoDictionary(locale);
  const [state, update] = useUrlState(AI_SEO_LIST_DEFAULTS, {
    normalize: normalizeAiSeoList,
    resetOnChange: AI_SEO_PAGE_KEYS,
  });
  const list = useResource(
    () =>
      api.get<AiSeoList>(BASE, {
        status: state.status || undefined,
        kind: state.kind || undefined,
        page: state.page,
      }),
    [api, state.status, state.kind, state.page],
  );
  const data = list.data;
  const notify = useSuccessToast();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const working = data !== null && data.byStatus.QUEUED + data.byStatus.GENERATING > 0;
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => void list.reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [working, list]);

  const columns: DataTableColumn<AiSeoRow>[] = [
    {
      key: 'target',
      header: text.columns.target,
      mobileTitle: true,
      truncate: true,
      width: 'md',
      cell: (row) => (
        <button type="button" className="ls-link" title={row.label} onClick={() => setOpen(row.id)}>
          {row.label}
        </button>
      ),
    },
    {
      key: 'kind',
      header: text.columns.kind,
      hideBelow: 'md',
      cell: (row) => text.kinds[row.kind],
    },
    {
      key: 'status',
      header: text.columns.status,
      cell: (row) => <Badge tone={statusTone(row.status)}>{text.statuses[row.status]}</Badge>,
    },
    {
      key: 'notes',
      header: text.columns.notes,
      hideBelow: 'md',
      truncate: true,
      width: 'md',
      cell: (row) => {
        const parts = [
          row.warnings > 0 ? fill(text.notes.soft, { count: String(row.warnings) }) : null,
        ].filter((part): part is string => part !== null);
        const line = parts.length === 0 ? text.notes.none : parts.join(' · ');
        return <span title={line}>{line}</span>;
      },
    },
    {
      key: 'updated',
      header: text.columns.updated,
      hideBelow: 'lg',
      cell: (row) => formatDateTime(row.updatedAt, ZONE, locale),
    },
    {
      key: 'cost',
      header: text.columns.cost,
      numeric: true,
      hideBelow: 'lg',
      cell: (row) => (row.costVnd === null ? '—' : formatVnd(row.costVnd, locale)),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (row) => (
        <RowActions
          menuLabel={fill(text.menuLabel, { name: row.label })}
          items={[{ id: 'open', label: text.open, icon: 'eye', onSelect: () => setOpen(row.id) }]}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader title={text.title} intro={text.intro}>
        <Button variant="primary" icon="sparkles" onClick={() => setCreating(true)}>
          {text.create.action}
        </Button>
      </PageHeader>
      <ListSection title={text.table}>
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={(state.status ? 1 : 0) + (state.kind ? 1 : 0)}
          onReset={() => update({ status: '', kind: '' })}
          reload={{ label: t.common.reload, onClick: () => void list.reload() }}
          resultCount={data ? String(data.total) : undefined}
          filters={
            <>
              <FacetedFilter
                label={text.filterStatus}
                clearLabel={t.common.list.clearChoice}
                options={AI_SEO_STATUSES.map((value: AiSeoStatus) => ({
                  value,
                  label: `${text.statuses[value]} (${data?.byStatus[value] ?? 0})`,
                }))}
                selected={state.status ? [state.status] : []}
                onChange={([value]) => update({ status: value ?? '' })}
              />
              <FacetedFilter
                label={text.filterKind}
                clearLabel={t.common.list.clearChoice}
                options={AI_SEO_KINDS.map((value) => ({ value, label: text.kinds[value] }))}
                selected={state.kind ? [state.kind] : []}
                onChange={([value]) => update({ kind: value ?? '' })}
              />
            </>
          }
        />
        <DataTable
          mode="server"
          caption={fill(t.common.list.table, { list: text.table })}
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          loading={list.loading && !data}
          loadingLabel={t.common.loading}
          error={
            list.error && !data ? (
              <ErrorState error={list.error} t={t} onRetry={() => void list.reload()} />
            ) : undefined
          }
          empty={
            data ? (
              <Empty>{state.status || state.kind ? text.emptyFiltered : text.empty}</Empty>
            ) : undefined
          }
          paging={{
            page: state.page,
            pageSize: data?.pageSize ?? 20,
            total: data?.total ?? 0,
            onPageChange: (page) => update({ page }),
            labels: paginationLabels(t, text.table),
          }}
        />
      </ListSection>
      {creating ? (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreated={async (message) => {
            setCreating(false);
            notify(message);
            await list.reload();
          }}
        />
      ) : null}
      {open ? (
        <DraftDrawer
          id={open}
          onClose={() => setOpen(null)}
          onChanged={async (message) => {
            if (message) notify(message);
            await list.reload();
          }}
        />
      ) : null}
    </>
  );
}

/** "Tạo bản nháp": choose what to write for, read what it would take and cost, then queue. Queueing calls nothing and changes nothing. */
function CreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (message: string) => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = aiSeoDictionary(locale);
  const c = text.create;
  const [scope, setScope] = useState<'MISSING_SERVICES' | 'SHOP'>('MISSING_SERVICES');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const preview = useResource(
    () => api.get<AiSeoPreview>(`${BASE}/preview`, { scope }),
    [api, scope],
  );
  const view = preview.data;
  const money = (value: string | null) => (value === null ? '—' : formatVnd(value, locale));

  async function submit() {
    if (pending || !view || view.blocked.length > 0) return;
    setPending(true);
    setFailure(null);
    try {
      const result = await api.post<AiSeoCreateResponse>(BASE, { scope });
      await onCreated(
        fill(c.done, { queued: String(result.queued) }) +
          (result.alreadyOpen > 0 ? fill(c.doneOpen, { open: String(result.alreadyOpen) }) : ''),
      );
    } catch (error) {
      setFailure(errorMessage(error, t));
      await preview.reload().catch(() => undefined);
    } finally {
      setPending(false);
    }
  }

  return (
    <FormDialog
      title={c.title}
      description={c.body}
      labels={{ ...formOverlayLabels(t, c.confirm), submitting: t.common.saving }}
      busy={pending}
      submitDisabled={!view || view.blocked.length > 0}
      error={failure ? <Notice tone="error">{failure}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <Stack gap="block">
        <Field label={c.scope}>
          {(control) => (
            <Select
              {...control}
              options={[
                { value: 'MISSING_SERVICES', label: c.scopes.MISSING_SERVICES },
                { value: 'SHOP', label: c.scopes.SHOP },
              ]}
              value={scope}
              disabled={pending}
              onChange={(event) => setScope(event.target.value as 'MISSING_SERVICES' | 'SHOP')}
            />
          )}
        </Field>
        {!view ? (
          <Loading t={t} />
        ) : (
          <>
            {view.blocked.map((code) => (
              <Notice key={code} tone="warning">
                {c.blocked[code]}
              </Notice>
            ))}
            <DescriptionList
              items={[
                { label: c.facts.count, value: String(view.count) },
                { label: c.facts.model, value: view.model },
                { label: c.facts.estimate, value: money(view.estimateVnd) },
                { label: c.facts.capLeft, value: money(view.capLeftVnd) },
              ]}
            />
          </>
        )}
      </Stack>
    </FormDialog>
  );
}

/** One draft: the text now beside the draft, editable; warnings above; apply, save an edit, reject, write again, or try again. */
function DraftDrawer({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: (message: string | null) => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = aiSeoDictionary(locale);
  const d = text.drawer;
  const detailResource = useResource(() => api.get<AiSeoDetail>(`${BASE}/${id}`), [api, id]);
  const detail = detailResource.data;
  const [form, setForm] = useState<SeoForm | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [fieldProblem, setFieldProblem] = useState<keyof SeoForm | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [instruction, setInstruction] = useState('');

  // The form starts from the draft (or its saved edit) and starts again whenever the server's version of it changes.
  useEffect(() => {
    if (detail) {
      setForm(formOf(detail));
    }
  }, [detail?.id, detail?.rowVersion]);
  // A draft being written reloads itself.
  useEffect(() => {
    if (!detail || !isWorking(detail.status)) return;
    const timer = setInterval(() => void detailResource.reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [detail, detailResource]);

  async function run(work: () => Promise<string | null>) {
    if (pending) return;
    setPending(true);
    setFailure(null);
    setFieldProblem(null);
    try {
      const message = await work();
      await detailResource.reload();
      await onChanged(message);
    } catch (error) {
      setFieldProblem(serverField(error));
      setFailure(isConflict(error) ? d.conflict : errorMessage(error, t));
      await detailResource.reload().catch(() => undefined);
    } finally {
      setPending(false);
    }
  }

  const label = detail?.current.label ?? '';
  const editable =
    detail !== null && (detail.status === 'DRAFT_READY' || detail.status === 'NEEDS_ATTENTION');
  const dirty = detail && form ? isDirty(form, detail) : false;
  const canApply =
    detail !== null && detail.status === 'DRAFT_READY' && detail.draft !== null && !dirty;

  const box = (name: keyof SeoForm, title: string, now: string, limit: number | null) => (
    <Stack gap="field" key={name}>
      <h3>{title}</h3>
      <DescriptionList items={[{ label: d.current, value: now.trim() === '' ? d.none : now }]} />
      <Field
        label={d.draft}
        {...(fieldProblem === name ? { error: d.fieldTooLong } : {})}
        hint={
          limit === null
            ? undefined
            : fill(d.characters, {
                count: String([...(form?.[name] ?? '')].length),
                limit: String(limit),
              })
        }
      >
        {(control) => (
          <Textarea
            {...control}
            rows={limit === null ? 5 : 3}
            value={form?.[name] ?? ''}
            disabled={pending || !editable}
            onChange={(event) =>
              setForm((current) => (current ? { ...current, [name]: event.target.value } : current))
            }
          />
        )}
      </Field>
    </Stack>
  );

  return (
    <Drawer
      open
      title={label || text.title}
      closeLabel={t.common.close}
      onClose={onClose}
      footer={
        detail ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              {d.close}
            </Button>
            {editable ? (
              <>
                <Button
                  variant="danger-outline"
                  disabled={pending}
                  onClick={() => setRejecting(true)}
                >
                  {d.reject}
                </Button>
                {detail.canRegenerate ? (
                  <Button
                    variant="secondary"
                    disabled={pending}
                    onClick={() => setRegenerating(true)}
                  >
                    {d.regenerate}
                  </Button>
                ) : null}
                {dirty ? (
                  <Button
                    variant="secondary"
                    loading={pending}
                    onClick={() =>
                      void run(async () => {
                        if (!form) return null;
                        await api.post(`${BASE}/${id}/edit`, editRequest(form, detail));
                        return d.saved;
                      })
                    }
                  >
                    {d.save}
                  </Button>
                ) : null}
                <Button
                  variant="primary"
                  icon="check"
                  loading={pending}
                  disabled={!canApply}
                  onClick={() =>
                    void run(async () => {
                      const result = await api.post<AiSeoApplyResponse>(
                        `${BASE}/${id}/apply`,
                        applyRequest(detail),
                      );
                      return result.result === 'APPLIED' ? d.applied : d.staleNow;
                    })
                  }
                >
                  {d.apply}
                </Button>
              </>
            ) : detail.status === 'FAILED' ||
              detail.status === 'NEEDS_ATTENTION' ||
              detail.status === 'STALE' ? (
              <Button
                variant="primary"
                icon="refresh"
                loading={pending}
                onClick={() =>
                  void run(async () => {
                    await api.post(`${BASE}/${id}/retry`, {
                      expectedRowVersion: detail.rowVersion,
                    });
                    return d.retried;
                  })
                }
              >
                {d.retry}
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    >
      {detailResource.error && !detail ? (
        <Notice tone="error">{d.loadFailed}</Notice>
      ) : !detail || !form ? (
        <Loading t={t} />
      ) : (
        <Stack gap="page">
          <Cluster3 detail={detail} />
          {failure ? <Notice tone="error">{failure}</Notice> : null}
          {isWorking(detail.status) ? <Notice tone="info">{d.working}</Notice> : null}
          {detail.stale && detail.status !== 'APPLIED' && detail.status !== 'REJECTED' ? (
            <Notice tone="warning">{d.stale}</Notice>
          ) : null}
          {detail.errorCode &&
          (detail.status === 'FAILED' || detail.status === 'NEEDS_ATTENTION') ? (
            <Notice tone="error">
              <strong>{d.failedTitle}. </strong>
              {
                text.errors[
                  errorKey(detail.errorCode, Object.keys(text.errors)) as keyof typeof text.errors
                ]
              }
            </Notice>
          ) : null}
          {detail.warnings.length > 0 ? (
            <Stack gap="field">
              <h3>{d.warningsTitle}</h3>
              {detail.warnings.map((warning, index) => (
                <Notice key={`${warning.code}-${warning.field ?? ''}-${index}`} tone="warning">
                  <strong>{d.noteTag}: </strong>
                  {text.warnings[warning.code] ?? text.warnings['OTHER']}
                  {warning.field && text.fields[warning.field]
                    ? ` (${text.fields[warning.field]})`
                    : ''}
                  {warning.detail && warning.detail !== 'NOT_REQUESTED'
                    ? ` · ${warning.detail}`
                    : ''}
                </Notice>
              ))}
            </Stack>
          ) : null}
          {detail.draft || detail.edited ? (
            <>
              {box('seoDescriptionVi', d.seoVi, detail.current.seoDescriptionVi, SEO_TARGET)}
              {box('seoDescriptionEn', d.seoEn, detail.current.seoDescriptionEn, SEO_TARGET)}
              {hasEnglishText(detail)
                ? box(
                    'englishText',
                    detail.current.englishLabel === 'INTRO' ? d.englishIntro : d.englishDescription,
                    detail.current.englishNow,
                    null,
                  )
                : null}
              {hasEnglishText(detail) ? <p className="ls-hint">{d.englishHint}</p> : null}
              <DescriptionList
                items={[
                  {
                    label: d.source,
                    value: detail.current.sourceVi.trim() === '' ? d.none : detail.current.sourceVi,
                  },
                ]}
              />
            </>
          ) : null}
        </Stack>
      )}
      {rejecting && detail ? (
        <ConfirmDialog
          title={d.reject}
          description={d.rejectBody}
          tone="danger"
          confirmLabel={d.reject}
          busyLabel={t.common.saving}
          cancelLabel={t.common.cancel}
          referenceLabel={t.errors.reference}
          describeError={confirmError(t)}
          onConfirm={async () => {
            await api.post(`${BASE}/${id}/reject`, { expectedRowVersion: detail.rowVersion });
            setRejecting(false);
            await onChanged(d.rejected);
            onClose();
          }}
          onCancel={() => setRejecting(false)}
        />
      ) : null}
      {regenerating && detail ? (
        <FormDialog
          title={d.regenerateTitle}
          description={d.regenerateBody}
          labels={{ ...formOverlayLabels(t, d.regenerateConfirm), submitting: t.common.saving }}
          busy={pending}
          onClose={() => setRegenerating(false)}
          onSubmit={async () => {
            await api.post(`${BASE}/${id}/regenerate`, {
              expectedRowVersion: detail.rowVersion,
              ...(instruction.trim() === '' ? {} : { instruction: instruction.trim() }),
            });
            setRegenerating(false);
            setInstruction('');
            await detailResource.reload();
            await onChanged(d.regenerated);
          }}
        >
          <Field label={d.regenerateField}>
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                maxLength={600}
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
              />
            )}
          </Field>
        </FormDialog>
      ) : null}
    </Drawer>
  );
}

/** The kind and status of the draft, in one line under the drawer title. */
function Cluster3({ detail }: { detail: AiSeoDetail }) {
  const { locale } = useWorkforce();
  const text = aiSeoDictionary(locale);
  return (
    <Cluster>
      <Badge tone={statusTone(detail.status)}>{text.statuses[detail.status]}</Badge>
      <span>{text.kinds[detail.kind]}</span>
    </Cluster>
  );
}
