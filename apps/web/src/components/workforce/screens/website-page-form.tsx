'use client';

import {
  WEBSITE_PAGE_LIMITS,
  WEBSITE_PAGE_ROLES,
  type WebsitePageListResponse,
  type WebsitePageResponse,
} from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  Card,
  Field,
  focusFirstInvalid,
  FormActions,
  FormGrid,
  FormSection,
  Page,
  Select,
  Spinner,
  Stack,
  Switch,
  Textarea,
  TextInput,
} from '@lucy-spa/ui';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { organizationDictionary } from '../../../i18n/organization';
import { fill } from '../../../i18n/workforce';
import { ApiError } from '../../../lib/api/client';
import { canGlobal } from '../../../lib/workforce/permissions';
import {
  emptyPageForm,
  formOfPage,
  pageFormChanged,
  pageInputOf,
  pagePublicPath,
  roleHolderId,
  serverPageIssue,
  type PageForm,
  type PageIssue,
} from '../../../lib/workforce/pages';
import { errorMessage } from '../../../lib/workforce/workflows';
import { ListCrumbLink } from '../link';
import { useAccount, useWorkforce } from '../session';
import { Button, Empty, ErrorState, Notice, PageHeader, useResource, useSuccessToast } from '../ui';
import { RichEditor } from './rich-editor';
import { useWebsiteLeaveGuard } from './website-leave';

/**
 * Create or edit one information page on its own page (a long text with a preview, contract FR9): `/website/pages/new` and
 * `/website/pages/:id`. Saving returns to the pages tab with a toast. The server decides every rule again (the address, the one
 * published terms and privacy page, the markup rules).
 */
export function PageFormScreen({ id }: { id: string | null }) {
  const { t, base, locale } = useWorkforce();
  const { account } = useAccount();
  const text = organizationDictionary(locale);
  const back = `${base}/website?tab=pages`;
  const title = id ? t.pages.editTitle : t.pages.createTitle;
  return (
    <Page width="form">
      <PageHeader
        title={title}
        breadcrumbs={
          <Breadcrumbs
            label={text.breadcrumbs}
            LinkComponent={ListCrumbLink}
            items={[{ label: t.website.title, href: back }, { label: title }]}
          />
        }
      />
      {!canGlobal(account, 'MANAGE_WEBSITE_CONTENT') ? (
        <Notice tone="info">{t.pages.noAccess}</Notice>
      ) : (
        <PageForm id={id} back={back} />
      )}
    </Page>
  );
}

const lineOf = (issue: PageIssue | null) => issue?.line ?? 0;

function PageForm({ id, back }: { id: string | null; back: string }) {
  const { api, t, locale, navigate } = useWorkforce();
  const publishHintId = useId();
  const notify = useSuccessToast();
  const text = t.pages.form;
  const loaded = useResource(
    () =>
      id ? api.get<WebsitePageResponse>(`/api/v1/website/pages/${id}`) : Promise.resolve(null),
    [api, id],
  );
  const [initial, setInitial] = useState<PageForm | null>(id ? null : emptyPageForm());
  const [form, setForm] = useState<PageForm | null>(initial);
  const [version, setVersion] = useState(1);
  const [issue, setIssue] = useState<PageIssue | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  // A newly loaded page (first load, or the reload after a conflict) resets the form while rendering, not in an effect
  // (rerender-derived-state-no-effect): the old values never paint once.
  const [seen, setSeen] = useState<WebsitePageResponse | null>(null);
  if (loaded.data && loaded.data !== seen) {
    const next = formOfPage(loaded.data);
    setSeen(loaded.data);
    setInitial(next);
    setForm(next);
    setVersion(loaded.data.version);
  }
  useEffect(() => {
    if (issue && formRef.current) focusFirstInvalid(formRef.current);
  }, [issue]);

  const dirty = form !== null && initial !== null && pageFormChanged(form, initial);
  const { leave, dialog } = useWebsiteLeaveGuard(dirty && !pending, navigate, t);

  if (id && loaded.error) {
    return loaded.error instanceof ApiError && loaded.error.code === 'NOT_FOUND' ? (
      <Empty>{t.pages.notFound}</Empty>
    ) : (
      <ErrorState error={loaded.error} t={t} onRetry={() => void loaded.reload()} />
    );
  }
  if (!form) return <Spinner label={t.common.loading} />;

  const change = (patch: Partial<PageForm>) => {
    setForm({ ...form, ...patch });
    setIssue(null);
    setMessage(null);
  };
  /** The reason a field shows: the issue's words, with its line and limit filled in. */
  const error = (field: keyof PageForm): string | undefined => {
    if (!issue || issue.field !== field || issue.kind === 'roleTaken') return undefined;
    return fill(text.problems[issue.kind], {
      line: lineOf(issue),
      max:
        issue.kind === 'titleTooLong'
          ? WEBSITE_PAGE_LIMITS.title
          : issue.kind === 'seoTitleTooLong'
            ? WEBSITE_PAGE_LIMITS.seoTitle
            : issue.kind === 'seoDescriptionTooLong'
              ? WEBSITE_PAGE_LIMITS.seoDescription
              : issue.kind === 'tooManyBlocks'
                ? WEBSITE_PAGE_LIMITS.blocks
                : WEBSITE_PAGE_LIMITS.body,
    });
  };

  /** A refused save says why: the terms or privacy role names the page that holds it, found in the current list. */
  async function refusal(failure: unknown): Promise<void> {
    const holder = roleHolderId(failure);
    if (holder !== null) {
      setIssue({ field: 'role', kind: 'roleTaken', other: holder });
      try {
        const list = await api.get<WebsitePageListResponse>('/api/v1/website/pages');
        const named = list.items.find((page) => page.id === holder);
        setMessage(
          named
            ? fill(t.pages.roleTaken, {
                name: locale === 'en' ? (named.titleEn ?? named.titleVi) : named.titleVi,
                role: t.pages.role[named.role],
              })
            : t.pages.roleTakenUnknown,
        );
      } catch {
        setMessage(t.pages.roleTakenUnknown);
      }
      return;
    }
    const field = serverPageIssue(failure);
    if (field) {
      setIssue(field);
      return;
    }
    setMessage(errorMessage(failure, t));
    if (failure instanceof ApiError && failure.code === 'CONFLICT') await loaded.reload();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || !form) return;
    const request = pageInputOf(form);
    if ('issue' in request) {
      setIssue(request.issue);
      return;
    }
    setPending(true);
    setIssue(null);
    setMessage(null);
    try {
      if (id) {
        await api.post<WebsitePageResponse>(`/api/v1/website/pages/${id}/update`, {
          ...request.body,
          expectedVersion: version,
        });
        notify(text.saved);
      } else {
        await api.post<WebsitePageResponse>('/api/v1/website/pages', request.body);
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

  const label = id ? t.pages.editTitle : t.pages.createTitle;
  return (
    <>
      <form ref={formRef} noValidate onSubmit={(event) => void submit(event)} aria-label={label}>
        <Stack gap="block">
          <Card as="section" aria-label={label}>
            <Stack gap="page">
              <FormSection title={text.pageSection} description={text.pageHint}>
                <FormGrid cols={2}>
                  <Field
                    label={text.titleVi}
                    required
                    requiredLabel={t.common.required}
                    error={error('titleVi')}
                  >
                    {(control) => (
                      <TextInput
                        {...control}
                        name="title-vi"
                        value={form.titleVi}
                        onChange={(event) => change({ titleVi: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field label={text.titleEn} hint={text.titleEnHint} error={error('titleEn')}>
                    {(control) => (
                      <TextInput
                        {...control}
                        name="title-en"
                        value={form.titleEn}
                        onChange={(event) => change({ titleEn: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field
                    label={text.slug}
                    hint={`${text.slugHint} ${fill(text.slugPreview, {
                      path: pagePublicPath(locale, form.slug.trim().toLowerCase() || '…'),
                    })}`}
                    required
                    requiredLabel={t.common.required}
                    error={error('slug')}
                  >
                    {(control) => (
                      <TextInput
                        {...control}
                        name="slug"
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={form.slug}
                        onChange={(event) => change({ slug: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field
                    label={text.role}
                    hint={text.roleHints[form.role]}
                    error={
                      issue?.kind === 'roleTaken' && issue.field === 'role'
                        ? text.problems.roleTaken
                        : undefined
                    }
                  >
                    {(control) => (
                      <Select
                        {...control}
                        value={form.role}
                        options={WEBSITE_PAGE_ROLES.map((role) => ({
                          value: role,
                          label: t.pages.role[role],
                        }))}
                        onChange={(event) =>
                          change({ role: event.target.value as PageForm['role'] })
                        }
                      />
                    )}
                  </Field>
                </FormGrid>
              </FormSection>
              <FormSection title={text.contentSection} description={text.contentHint}>
                <Stack gap="field">
                  <RichEditor
                    label={text.bodyVi}
                    hint=""
                    required
                    requiredLabel={t.common.required}
                    language="vi"
                    value={form.bodyVi}
                    error={error('bodyVi')}
                    onChange={(bodyVi) => change({ bodyVi })}
                  />
                  <RichEditor
                    label={text.bodyEn}
                    hint=""
                    language="en"
                    value={form.bodyEn}
                    error={error('bodyEn')}
                    onChange={(bodyEn) => change({ bodyEn })}
                  />
                </Stack>
              </FormSection>
              <FormSection title={text.seoSection} description={text.seoHint}>
                <FormGrid cols={2}>
                  <Field
                    label={text.seoTitleVi}
                    hint={fill(text.seoTitleHint, { max: WEBSITE_PAGE_LIMITS.seoTitle })}
                    error={error('seoTitleVi')}
                  >
                    {(control) => (
                      <TextInput
                        {...control}
                        name="seo-title-vi"
                        value={form.seoTitleVi}
                        onChange={(event) => change({ seoTitleVi: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field
                    label={text.seoTitleEn}
                    hint={fill(text.seoTitleHint, { max: WEBSITE_PAGE_LIMITS.seoTitle })}
                    error={error('seoTitleEn')}
                  >
                    {(control) => (
                      <TextInput
                        {...control}
                        name="seo-title-en"
                        value={form.seoTitleEn}
                        onChange={(event) => change({ seoTitleEn: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field
                    label={text.seoDescriptionVi}
                    hint={fill(text.seoDescriptionHint, {
                      max: WEBSITE_PAGE_LIMITS.seoDescription,
                    })}
                    error={error('seoDescriptionVi')}
                  >
                    {(control) => (
                      <Textarea
                        {...control}
                        name="seo-description-vi"
                        autoComplete="off"
                        rows={3}
                        value={form.seoDescriptionVi}
                        onChange={(event) => change({ seoDescriptionVi: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field
                    label={text.seoDescriptionEn}
                    hint={fill(text.seoDescriptionHint, {
                      max: WEBSITE_PAGE_LIMITS.seoDescription,
                    })}
                    error={error('seoDescriptionEn')}
                  >
                    {(control) => (
                      <Textarea
                        {...control}
                        name="seo-description-en"
                        autoComplete="off"
                        rows={3}
                        value={form.seoDescriptionEn}
                        onChange={(event) => change({ seoDescriptionEn: event.target.value })}
                      />
                    )}
                  </Field>
                </FormGrid>
              </FormSection>
              <FormSection title={text.statusSection}>
                <Switch
                  checked={form.isPublished}
                  onCheckedChange={(isPublished) => change({ isPublished })}
                  label={text.published}
                  aria-describedby={publishHintId}
                />
                <p className="ls-hint" id={publishHintId}>
                  {text.publishedHint}
                </p>
              </FormSection>
              {message ? <Notice tone="error">{message}</Notice> : null}
            </Stack>
          </Card>
          <FormActions
            cancel={
              <Button variant="secondary" onClick={() => leave(back)} disabled={pending}>
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
      {dialog}
    </>
  );
}
