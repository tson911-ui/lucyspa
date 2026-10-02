'use client';

import {
  getSeasonPreset,
  isSeasonPresetKey,
  SEASON_GREETING_MAX_LENGTH,
  SEASON_PRESETS,
  type WebsitePopupListResponse,
  type WebsiteSeasonListResponse,
  type WebsiteSeasonResponse,
  type WebsiteSlideListResponse,
} from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  Card,
  Cluster,
  DescriptionList,
  Field,
  focusFirstInvalid,
  FormActions,
  FormGrid,
  FormSection,
  Page,
  SeasonPresetPicker,
  SeasonPreview,
  Spinner,
  Stack,
  Switch,
  TextInput,
  useUnsavedChangesGuard,
} from '@lucy-spa/ui';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { organizationDictionary } from '../../../i18n/organization';
import { fill } from '../../../i18n/workforce';
import { ApiError } from '../../../lib/api/client';
import { canGlobal } from '../../../lib/workforce/permissions';
import { popupName, popupTone } from '../../../lib/workforce/popups';
import {
  emptySeasonForm,
  formOfSeason,
  previewGreeting,
  problemField,
  seasonFormChanged,
  seasonInputOf,
  seasonOverlapId,
  type SeasonForm,
  type SeasonProblem,
} from '../../../lib/workforce/seasons';
import { slideName, slideTone } from '../../../lib/workforce/slides';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Notice,
  PageHeader,
  useResource,
  useSuccessToast,
} from '../ui';
import { SlideDrawer } from './website-slide-drawer';

const PROBLEMS: ReadonlySet<string> = new Set<SeasonProblem>([
  'presetKey',
  'label',
  'greetingVi',
  'greetingEn',
  'startDate',
  'lastDate',
  'window',
]);

/** The API names the field it refused; the form's day fields are `startsAt` / `endsAt`. */
const serverProblem = (error: unknown): SeasonProblem | null => {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED' || !error.field) {
    return null;
  }
  if (error.field === 'startsAt') return 'startDate';
  if (error.field === 'endsAt') return 'lastDate';
  return PROBLEMS.has(error.field) ? (error.field as SeasonProblem) : null;
};

/**
 * Create or edit one season on its own page (a long form with a live preview, contract FR9):
 * `/website/seasons/new` and `/website/seasons/:id`. Saving returns to the seasons tab with a toast. The server
 * decides every rule again (one enabled season at a time, the preset list, the lengths).
 */
export function SeasonFormScreen({ id }: { id: string | null }) {
  const { t, base, locale } = useWorkforce();
  const { account } = useAccount();
  const text = organizationDictionary(locale);
  const back = `${base}/website?tab=season`;
  const title = id ? t.seasons.editTitle : t.seasons.createTitle;
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
        <Notice tone="info">{t.seasons.noAccess}</Notice>
      ) : (
        <SeasonFormBody id={id} back={back} />
      )}
    </Page>
  );
}

function SeasonFormBody({ id, back }: { id: string | null; back: string }) {
  const { api, t, locale, navigate } = useWorkforce();
  const notify = useSuccessToast();
  const text = t.seasons.form;
  const loaded = useResource(
    () =>
      id ? api.get<WebsiteSeasonResponse>(`/api/v1/website/seasons/${id}`) : Promise.resolve(null),
    [api, id],
  );
  const [initial, setInitial] = useState<SeasonForm | null>(id ? null : emptySeasonForm());
  const [form, setForm] = useState<SeasonForm | null>(initial);
  const [version, setVersion] = useState(1);
  const [problem, setProblem] = useState<SeasonProblem | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (loaded.data) {
      const next = formOfSeason(loaded.data);
      setInitial(next);
      setForm(next);
      setVersion(loaded.data.rowVersion);
    }
  }, [loaded.data]);
  useEffect(() => {
    if (problem && formRef.current) focusFirstInvalid(formRef.current);
  }, [problem]);

  const dirty = form !== null && initial !== null && seasonFormChanged(form, initial);
  useUnsavedChangesGuard(dirty && !pending);

  if (id && loaded.error) {
    return loaded.error instanceof ApiError && loaded.error.code === 'NOT_FOUND' ? (
      <Empty>{t.seasons.notFound}</Empty>
    ) : (
      <ErrorState error={loaded.error} t={t} onRetry={() => void loaded.reload()} />
    );
  }
  if (!form) return <Spinner label={t.common.loading} />;

  const change = (patch: Partial<SeasonForm>) => {
    setForm({ ...form, ...patch });
    setProblem(null);
    setMessage(null);
  };
  const error = (field: keyof SeasonForm) =>
    problem && problemField(problem) === field ? text.problems[problem] : undefined;

  /** A new season follows the suggested days of the theme until the Owner types their own. */
  function choosePreset(presetKey: string) {
    if (!form) return;
    const untouched = id === null && isUntouchedDates(form);
    change({
      presetKey,
      ...(untouched
        ? {
            startDate: emptySeasonForm(presetKey).startDate,
            lastDate: emptySeasonForm(presetKey).lastDate,
          }
        : {}),
    });
  }

  /** A refused save says why: an overlap names the other season, found in the current list. */
  async function refusal(failure: unknown): Promise<void> {
    const field = serverProblem(failure);
    if (field) {
      setProblem(field);
      return;
    }
    const other = seasonOverlapId(failure);
    if (other) {
      try {
        const list = await api.get<WebsiteSeasonListResponse>('/api/v1/website/seasons');
        const named = list.items.find((season) => season.id === other);
        if (named) {
          setMessage(fill(t.seasons.overlap, { name: named.label }));
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
    const request = seasonInputOf(form);
    if ('problem' in request) {
      setProblem(request.problem);
      return;
    }
    setPending(true);
    setProblem(null);
    setMessage(null);
    try {
      if (id) {
        await api.post<WebsiteSeasonResponse>(`/api/v1/website/seasons/${id}/update`, {
          ...request.body,
          expectedVersion: version,
        });
        notify(text.saved);
      } else {
        await api.post<WebsiteSeasonResponse>('/api/v1/website/seasons', request.body);
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

  const known = isSeasonPresetKey(form.presetKey) ? getSeasonPreset(form.presetKey) : null;
  const left = (value: string) => SEASON_GREETING_MAX_LENGTH - [...value.trim()].length;
  const scheduleNote = id
    ? known?.suggestedWindow === null
      ? text.lunar
      : undefined
    : known?.suggestedWindow === null
      ? text.lunar
      : known
        ? text.suggested
        : undefined;
  const heading = id ? t.seasons.editTitle : t.seasons.createTitle;

  return (
    <form ref={formRef} noValidate onSubmit={(event) => void submit(event)} aria-label={heading}>
      <Stack gap="block">
        <Card as="section" aria-label={heading}>
          <Stack gap="page">
            <FormSection title={text.presetSection} description={text.presetHint}>
              <SeasonPresetPicker
                name="season-preset"
                label={text.presetLabel}
                options={SEASON_PRESETS.map((preset) => ({
                  key: preset.key,
                  name: preset.name[locale],
                  ornamentId: preset.ornament.id,
                }))}
                value={form.presetKey}
                onChange={choosePreset}
              />
              {error('presetKey') ? <Notice tone="error">{error('presetKey')}</Notice> : null}
            </FormSection>
            <FormSection title={text.detailsSection}>
              <FormGrid cols={2}>
                <Field
                  label={text.label}
                  hint={text.labelHint}
                  required
                  requiredLabel={t.common.required}
                  error={error('label')}
                  full
                >
                  {(control) => (
                    <TextInput
                      {...control}
                      value={form.label}
                      onChange={(event) => change({ label: event.target.value })}
                    />
                  )}
                </Field>
              </FormGrid>
            </FormSection>
            <FormSection
              title={text.scheduleSection}
              description={[text.scheduleHint, scheduleNote].filter(Boolean).join(' ')}
            >
              <FormGrid cols={2}>
                <Field
                  label={text.startDate}
                  required
                  requiredLabel={t.common.required}
                  error={error('startDate')}
                >
                  {(control) => (
                    <TextInput
                      {...control}
                      type="date"
                      value={form.startDate}
                      onChange={(event) => change({ startDate: event.target.value })}
                    />
                  )}
                </Field>
                <Field
                  label={text.lastDate}
                  required
                  requiredLabel={t.common.required}
                  error={error('lastDate')}
                >
                  {(control) => (
                    <TextInput
                      {...control}
                      type="date"
                      value={form.lastDate}
                      onChange={(event) => change({ lastDate: event.target.value })}
                    />
                  )}
                </Field>
              </FormGrid>
            </FormSection>
            <FormSection
              title={text.greetingSection}
              description={fill(text.greetingHint, { max: SEASON_GREETING_MAX_LENGTH })}
            >
              <FormGrid cols={2}>
                <Field
                  label={text.greetingVi}
                  hint={fill(text.greetingLeft, { left: left(form.greetingVi) })}
                  error={error('greetingVi')}
                >
                  {(control) => (
                    <TextInput
                      {...control}
                      placeholder={known?.greeting.vi}
                      value={form.greetingVi}
                      onChange={(event) => change({ greetingVi: event.target.value })}
                    />
                  )}
                </Field>
                <Field
                  label={text.greetingEn}
                  hint={fill(text.greetingLeft, { left: left(form.greetingEn) })}
                  error={error('greetingEn')}
                >
                  {(control) => (
                    <TextInput
                      {...control}
                      placeholder={known?.greeting.en}
                      value={form.greetingEn}
                      onChange={(event) => change({ greetingEn: event.target.value })}
                    />
                  )}
                </Field>
              </FormGrid>
            </FormSection>
            <FormSection title={text.optionsSection} description={text.optionsHint}>
              <Stack gap="field">
                <Switch
                  checked={form.applyCustomer}
                  onCheckedChange={(applyCustomer) => change({ applyCustomer })}
                  label={text.customer}
                />
                <Switch
                  checked={form.applyAdmin}
                  onCheckedChange={(applyAdmin) => change({ applyAdmin })}
                  label={text.admin}
                />
                <Switch
                  checked={form.particlesEnabled}
                  onCheckedChange={(particlesEnabled) => change({ particlesEnabled })}
                  label={text.particles}
                />
              </Stack>
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
          {known ? (
            <SeasonPreview
              presetKey={known.key}
              ornamentId={known.ornament.id}
              title={text.previewBrand}
              greeting={previewGreeting(form, locale)}
              labels={{
                desktop: text.previewDesktop,
                phone: text.previewPhone,
                light: text.previewLight,
                dark: text.previewDark,
                frame: (device, theme) => fill(text.previewFrame, { device, theme }),
                accentSample: text.previewAccent,
                buttonSample: text.previewButton,
              }}
            />
          ) : (
            <Empty>{text.problems.presetKey}</Empty>
          )}
        </FormSection>
        {id ? <HolidayContent seasonId={id} season={loaded.data} /> : null}
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
  );
}

/** True while both days are still what a new form starts with (so a theme change may refill them). */
function isUntouchedDates(form: SeasonForm): boolean {
  const start = emptySeasonForm(form.presetKey);
  return form.startDate === start.startDate && form.lastDate === start.lastDate;
}

/**
 * The popups and slides that follow this season (design 20.6): what goes live with it, and the two shortcuts that
 * create one with the link already set. A popup opens its own page; a slide opens the same drawer as the slider tab.
 */
function HolidayContent({
  seasonId,
  season,
}: {
  seasonId: string;
  season: WebsiteSeasonResponse | null;
}) {
  const { api, t, locale, base, navigate } = useWorkforce();
  const notify = useSuccessToast();
  const text = t.seasons.holiday;
  const popups = useResource(
    () => api.get<WebsitePopupListResponse>('/api/v1/website/popups'),
    [api],
  );
  const slides = useResource(
    () => api.get<WebsiteSlideListResponse>('/api/v1/website/slides'),
    [api],
  );
  const [adding, setAdding] = useState(false);
  const followingPopups = (popups.data?.items ?? []).filter((popup) => popup.seasonId === seasonId);
  const followingSlides = (slides.data?.items ?? []).filter((slide) => slide.seasonId === seasonId);
  return (
    <>
      <FormSection
        title={text.section}
        description={text.hint}
        actions={
          <>
            <Button
              variant="secondary"
              icon="plus"
              onClick={() => navigate?.(`${base}/website/popups/new?season=${seasonId}`)}
            >
              {text.createPopup}
            </Button>
            <Button variant="secondary" icon="plus" onClick={() => setAdding(true)}>
              {text.createSlide}
            </Button>
          </>
        }
      >
        <DescriptionList
          items={[
            {
              label: text.popups,
              value:
                followingPopups.length === 0 ? (
                  text.none
                ) : (
                  <Stack gap="field">
                    {followingPopups.map((popup) => (
                      <Cluster key={popup.id}>
                        <Link
                          className="ls-link ls-season-link"
                          href={`${base}/website/popups/${popup.id}`}
                        >
                          {popupName(popup, locale, t.popups.untitled)}
                        </Link>
                        <Badge tone={popupTone(popup.status)}>
                          {t.popups.status[popup.status]}
                        </Badge>
                      </Cluster>
                    ))}
                  </Stack>
                ),
            },
            {
              label: text.slides,
              value:
                followingSlides.length === 0 ? (
                  text.none
                ) : (
                  <Stack gap="field">
                    {followingSlides.map((slide) => (
                      <Cluster key={slide.id}>
                        <span>{slideName(slide, locale, t.slides.untitled)}</span>
                        <Badge tone={slideTone(slide.status)}>
                          {t.slides.status[slide.status]}
                        </Badge>
                      </Cluster>
                    ))}
                  </Stack>
                ),
            },
          ]}
        />
      </FormSection>
      {adding ? (
        <SlideDrawer
          slide={null}
          season={season}
          reload={async () => {
            await slides.reload();
          }}
          onClose={() => setAdding(false)}
          onSaved={async (message) => {
            await slides.reload();
            setAdding(false);
            notify(message);
          }}
        />
      ) : null}
    </>
  );
}
