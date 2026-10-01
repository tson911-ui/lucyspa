'use client';

import type {
  MediaAssetSummary,
  WebsitePopupListResponse,
  WebsitePopupResponse,
} from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  Card,
  Cluster,
  Field,
  focusFirstInvalid,
  FormActions,
  FormGrid,
  FormSection,
  MediaPreview,
  Page,
  PromoPreview,
  Spinner,
  Stack,
  Switch,
  Textarea,
  TextInput,
  useUnsavedChangesGuard,
} from '@lucy-spa/ui';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { organizationDictionary } from '../../../i18n/organization';
import { fill } from '../../../i18n/workforce';
import { ApiError } from '../../../lib/api/client';
import { POPUP_LIMITS } from '../../../lib/popup-core';
import { mediaVariantUrl } from '../../../lib/workforce/media';
import { canGlobal } from '../../../lib/workforce/permissions';
import {
  emptyPopupForm,
  formOfPopup,
  overlapId,
  popupFormChanged,
  popupInputOf,
  popupName,
  previewContent,
  previewImageOf,
  problemField,
  type PopupForm,
  type PopupProblem,
} from '../../../lib/workforce/popups';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useAccount, useWorkforce } from '../session';
import { Button, Empty, ErrorState, Notice, PageHeader, useResource, useSuccessToast } from '../ui';
import { MediaPicker } from './media-picker';

const PROBLEMS: ReadonlySet<string> = new Set<PopupProblem>([
  'content',
  'titleVi',
  'titleEn',
  'bodyVi',
  'bodyEn',
  'ctaLabelVi',
  'ctaLabelEn',
  'ctaLabel',
  'ctaUrl',
  'startsAt',
  'endsAt',
  'window',
]);

/** The API names the field it refused; "title" is the form's "image or title" rule. */
const serverProblem = (error: unknown): PopupProblem | null => {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED' || !error.field) {
    return null;
  }
  if (error.field === 'title') return 'content';
  return PROBLEMS.has(error.field) ? (error.field as PopupProblem) : null;
};

/**
 * Create or edit one promotional popup on its own page (a long form with a live preview, contract FR9):
 * `/website/popups/new` and `/website/popups/:id`. Saving returns to the popup tab with a toast. The server
 * decides every rule again (one enabled popup at a time, the image's Vietnamese description, the link rule).
 */
export function PopupFormScreen({ id }: { id: string | null }) {
  const { t, base, locale } = useWorkforce();
  const { account } = useAccount();
  const text = organizationDictionary(locale);
  const back = `${base}/website?tab=popup`;
  const title = id ? t.popups.editTitle : t.popups.createTitle;
  return (
    <Page width="form">
      <PageHeader
        title={title}
        breadcrumbs={
          <Breadcrumbs
            label={text.breadcrumbs}
            LinkComponent={Link}
            items={[{ label: t.website.title, href: back }, { label: title }]}
          />
        }
      />
      {!canGlobal(account, 'MANAGE_WEBSITE_CONTENT') ? (
        <Notice tone="info">{t.popups.noAccess}</Notice>
      ) : (
        <PopupForm id={id} back={back} />
      )}
    </Page>
  );
}

function PopupForm({ id, back }: { id: string | null; back: string }) {
  const { api, t, locale, navigate } = useWorkforce();
  const notify = useSuccessToast();
  const text = t.popups.form;
  const loaded = useResource(
    () =>
      id ? api.get<WebsitePopupResponse>(`/api/v1/website/popups/${id}`) : Promise.resolve(null),
    [api, id],
  );
  const [initial, setInitial] = useState<PopupForm | null>(id ? null : emptyPopupForm());
  const [form, setForm] = useState<PopupForm | null>(initial);
  const [version, setVersion] = useState(1);
  const [problem, setProblem] = useState<PopupProblem | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [picking, setPicking] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (loaded.data) {
      const next = formOfPopup(loaded.data);
      setInitial(next);
      setForm(next);
      setVersion(loaded.data.rowVersion);
    }
  }, [loaded.data]);
  useEffect(() => {
    if (problem && formRef.current) focusFirstInvalid(formRef.current);
  }, [problem]);

  const dirty = form !== null && initial !== null && popupFormChanged(form, initial);
  useUnsavedChangesGuard(dirty && !pending);

  if (id && loaded.error) {
    return loaded.error instanceof ApiError && loaded.error.code === 'NOT_FOUND' ? (
      <Empty>{t.popups.notFound}</Empty>
    ) : (
      <ErrorState error={loaded.error} t={t} onRetry={() => void loaded.reload()} />
    );
  }
  if (!form) return <Spinner label={t.common.loading} />;

  const change = (patch: Partial<PopupForm>) => {
    setForm({ ...form, ...patch });
    setProblem(null);
    setMessage(null);
  };
  const error = (field: keyof PopupForm) =>
    problem && problemField(problem) === field ? text.problems[problem] : undefined;

  /** A refused save says why: an overlap names the other popup, found in the current list. */
  async function refusal(failure: unknown): Promise<void> {
    const field = serverProblem(failure);
    if (field) {
      setProblem(field);
      return;
    }
    const other = overlapId(failure);
    if (other) {
      try {
        const list = await api.get<WebsitePopupListResponse>('/api/v1/website/popups');
        const named = list.items.find((popup) => popup.id === other);
        if (named) {
          setMessage(fill(t.popups.overlap, { name: popupName(named, locale, t.popups.untitled) }));
          return;
        }
      } catch {
        // Fall through to the generic message.
      }
    }
    setMessage(errorMessage(failure, t));
    if (failure instanceof ApiError && failure.code === 'CONFLICT') await loaded.reload();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || !form) return;
    const request = popupInputOf(form);
    if ('problem' in request) {
      setProblem(request.problem);
      return;
    }
    setPending(true);
    setProblem(null);
    setMessage(null);
    try {
      if (id) {
        await api.post<WebsitePopupResponse>(`/api/v1/website/popups/${id}/update`, {
          ...request.body,
          expectedVersion: version,
        });
        notify(text.saved);
      } else {
        await api.post<WebsitePopupResponse>('/api/v1/website/popups', request.body);
        notify(text.created);
      }
      // Saved: the guard must not ask about the page we are leaving.
      setInitial(form);
      navigate?.(back);
    } catch (failure) {
      await refusal(failure);
      setPending(false);
    }
  }

  const choose = (asset: MediaAssetSummary) => {
    change({
      media: {
        id: asset.id,
        filename: asset.originalFilename,
        width: asset.width,
        height: asset.height,
        altVi: asset.altVi,
        altEn: asset.altEn,
      },
    });
    setPicking(false);
  };

  const content = previewContent(form, locale, previewImageOf(form.media, locale));
  const left = (value: string) => POPUP_LIMITS.body - [...value.trim()].length;

  return (
    <>
      <form
        ref={formRef}
        noValidate
        onSubmit={(event) => void submit(event)}
        aria-label={id ? t.popups.editTitle : t.popups.createTitle}
      >
        <Stack gap="block">
          <Card as="section" aria-label={id ? t.popups.editTitle : t.popups.createTitle}>
            <Stack gap="page">
              <FormSection title={text.contentSection} description={text.contentHint}>
                <FormGrid cols={2}>
                  <Field label={text.titleVi} error={error('titleVi')}>
                    {(control) => (
                      <TextInput
                        {...control}
                        value={form.titleVi}
                        onChange={(event) => change({ titleVi: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field label={text.titleEn} error={error('titleEn')}>
                    {(control) => (
                      <TextInput
                        {...control}
                        value={form.titleEn}
                        onChange={(event) => change({ titleEn: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field
                    label={text.bodyVi}
                    hint={fill(text.bodyHint, { max: POPUP_LIMITS.body, left: left(form.bodyVi) })}
                    error={error('bodyVi')}
                  >
                    {(control) => (
                      <Textarea
                        {...control}
                        rows={4}
                        value={form.bodyVi}
                        onChange={(event) => change({ bodyVi: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field
                    label={text.bodyEn}
                    hint={fill(text.bodyHint, { max: POPUP_LIMITS.body, left: left(form.bodyEn) })}
                    error={error('bodyEn')}
                  >
                    {(control) => (
                      <Textarea
                        {...control}
                        rows={4}
                        value={form.bodyEn}
                        onChange={(event) => change({ bodyEn: event.target.value })}
                      />
                    )}
                  </Field>
                </FormGrid>
              </FormSection>
              <FormSection title={text.imageSection} description={text.imageHint}>
                {form.media ? (
                  <Stack gap="field">
                    <MediaPreview
                      src={mediaVariantUrl(form.media.id, 'md')}
                      alt={fill(text.imagePreview, { name: form.media.filename })}
                    />
                    <p className="ls-hint">{form.media.filename}</p>
                  </Stack>
                ) : (
                  <p className="ls-hint">{text.imageNone}</p>
                )}
                <Cluster>
                  <Button variant="secondary" onClick={() => setPicking(true)}>
                    {form.media ? text.imageChange : text.imageChoose}
                  </Button>
                  {form.media ? (
                    <Button variant="ghost" onClick={() => change({ media: null })}>
                      {text.imageRemove}
                    </Button>
                  ) : null}
                </Cluster>
              </FormSection>
              <FormSection title={text.linkSection} description={text.linkHint}>
                <FormGrid cols={2}>
                  <Field label={text.ctaLabelVi} error={error('ctaLabelVi')}>
                    {(control) => (
                      <TextInput
                        {...control}
                        value={form.ctaLabelVi}
                        onChange={(event) => change({ ctaLabelVi: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field label={text.ctaLabelEn} error={error('ctaLabelEn')}>
                    {(control) => (
                      <TextInput
                        {...control}
                        value={form.ctaLabelEn}
                        onChange={(event) => change({ ctaLabelEn: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field label={text.ctaUrl} hint={text.ctaUrlHint} error={error('ctaUrl')} full>
                    {(control) => (
                      <TextInput
                        {...control}
                        inputMode="url"
                        autoComplete="off"
                        value={form.ctaUrl}
                        onChange={(event) => change({ ctaUrl: event.target.value })}
                      />
                    )}
                  </Field>
                </FormGrid>
              </FormSection>
              <FormSection title={text.scheduleSection} description={text.scheduleHint}>
                <FormGrid cols={2}>
                  <Field
                    label={text.startsAt}
                    required
                    requiredLabel={t.common.required}
                    error={error('startsAt')}
                  >
                    {(control) => (
                      <TextInput
                        {...control}
                        type="datetime-local"
                        value={form.startsAt}
                        onChange={(event) => change({ startsAt: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field
                    label={text.endsAt}
                    required
                    requiredLabel={t.common.required}
                    error={error('endsAt')}
                  >
                    {(control) => (
                      <TextInput
                        {...control}
                        type="datetime-local"
                        value={form.endsAt}
                        onChange={(event) => change({ endsAt: event.target.value })}
                      />
                    )}
                  </Field>
                </FormGrid>
              </FormSection>
              <FormSection title={text.statusSection}>
                <Switch
                  checked={form.isEnabled}
                  onCheckedChange={(isEnabled) => change({ isEnabled })}
                  label={text.enabled}
                />
                <p className="ls-hint">{text.enabledHint}</p>
              </FormSection>
              {message ? <Notice tone="error">{message}</Notice> : null}
            </Stack>
          </Card>
          <FormSection title={text.previewSection} description={text.previewHint}>
            {content ? (
              <PromoPreview
                content={content}
                desktopLabel={text.previewDesktop}
                phoneLabel={text.previewPhone}
              />
            ) : (
              <Empty>{text.previewEmpty}</Empty>
            )}
          </FormSection>
          <FormActions
            cancel={
              <Button variant="secondary" onClick={() => navigate?.(back)} disabled={pending}>
                {t.common.cancel}
              </Button>
            }
            primary={
              <Button type="submit" variant="primary" loading={pending}>
                {pending ? text.saving : text.save}
              </Button>
            }
          />
        </Stack>
      </form>
      {picking ? <MediaPicker onPick={choose} onClose={() => setPicking(false)} /> : null}
    </>
  );
}
