'use client';

import type {
  MediaAssetSummary,
  WebsitePopupMedia,
  WebsiteSlideResponse,
} from '@lucy-spa/contracts';
import {
  Cluster,
  Field,
  FormDrawer,
  FormGrid,
  FormSection,
  MediaPreview,
  Stack,
  Switch,
  TextInput,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { ApiError } from '../../../lib/api/client';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { mediaVariantUrl } from '../../../lib/workforce/media';
import {
  emptySlideForm,
  formOfSlide,
  problemField,
  slideFormChanged,
  slideInputOf,
  type SlideForm,
  type SlideProblem,
} from '../../../lib/workforce/slides';
import { runMutation } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';
import { Button, ErrorState, Notice, useSubmit } from '../ui';
import { MediaPicker } from './media-picker';

const PROBLEMS: ReadonlySet<string> = new Set<SlideProblem>([
  'media',
  'mobileMedia',
  'titleVi',
  'titleEn',
  'subtitleVi',
  'subtitleEn',
  'linkLabelVi',
  'linkLabelEn',
  'linkLabel',
  'linkUrl',
  'altVi',
  'altEn',
  'startsAt',
  'endsAt',
  'window',
]);

/** The API names the field it refused; `mediaId` is the form's image. */
const serverProblem = (error: unknown): SlideProblem | null => {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED' || !error.field) {
    return null;
  }
  if (error.field === 'mediaId') return 'media';
  if (error.field === 'mobileMediaId') return 'mobileMedia';
  return PROBLEMS.has(error.field) ? (error.field as SlideProblem) : null;
};

const mediaOf = (asset: MediaAssetSummary): WebsitePopupMedia => ({
  id: asset.id,
  filename: asset.originalFilename,
  width: asset.width,
  height: asset.height,
  altVi: asset.altVi,
  altEn: asset.altEn,
});

/**
 * Create or edit one slide in a drawer (design 16.7, FR9: a medium form). The desktop image is required, the
 * phone image optional; both come from the media library (an image without a Vietnamese description is
 * described first, in the picker). The server decides every rule again: the visible limit, the link rule and
 * the images. A new slide goes to the end of the slider.
 */
export function SlideDrawer({
  slide,
  reload,
  onClose,
  onSaved,
}: {
  /** The slide to edit, or null to add one. */
  slide: WebsiteSlideResponse | null;
  /** Reloads the list behind the drawer (after a stale version the drawer gets the current slide). */
  reload: () => Promise<void>;
  onClose: () => void;
  /** Called after a successful save with the message to show; the list reloads and the drawer closes. */
  onSaved: (message: string) => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const text = t.slides.form;
  const submit = useSubmit();
  const [initial] = useState<SlideForm>(() => (slide ? formOfSlide(slide) : emptySlideForm()));
  const [form, setForm] = useState<SlideForm>(initial);
  const [problem, setProblem] = useState<SlideProblem | null>(null);
  const [picking, setPicking] = useState<'media' | 'mobileMedia' | null>(null);

  const change = (patch: Partial<SlideForm>) => {
    setForm({ ...form, ...patch });
    setProblem(null);
    submit.clear();
  };
  const error = (field: keyof SlideForm) =>
    problem && problemField(problem) === field ? text.problems[problem] : undefined;

  async function save() {
    const request = slideInputOf(form);
    if ('problem' in request) {
      setProblem(request.problem);
      return;
    }
    setProblem(null);
    let failure: unknown = null;
    const ok = await submit.run(async () => {
      const outcome = await runMutation(
        () =>
          slide
            ? api.post<WebsiteSlideResponse>(`/api/v1/website/slides/${slide.id}/update`, {
                ...request.body,
                expectedVersion: slide.rowVersion,
              })
            : api.post<WebsiteSlideResponse>('/api/v1/website/slides', request.body),
        // A stale version: the list reloads and the drawer asks again with the current version.
        reload,
      );
      if (!outcome.ok) failure = outcome.error;
      return outcome;
    }, '');
    if (ok) await onSaved(slide ? text.saved : text.created);
    else {
      const field = serverProblem(failure);
      if (field) setProblem(field);
    }
  }

  const dirty = slideFormChanged(form, initial);
  const summary = problem ? undefined : submit.error;
  const picture = (media: WebsitePopupMedia | null, none: string) =>
    media ? (
      <Stack gap="field">
        <MediaPreview
          src={mediaVariantUrl(media.id, 'md')}
          alt={fill(text.imagePreview, { name: media.filename })}
        />
        <p className="ls-hint">{media.filename}</p>
      </Stack>
    ) : (
      <p className="ls-hint">{none}</p>
    );

  return (
    <>
      <FormDrawer
        title={slide ? t.slides.editTitle : t.slides.createTitle}
        labels={formOverlayLabels(t, text.save)}
        busy={submit.pending}
        dirty={dirty}
        submitDisabled={slide !== null && !dirty}
        error={summary ? <ErrorState error={summary} t={t} /> : undefined}
        onClose={onClose}
        onSubmit={save}
      >
        <Stack gap="page">
          <FormSection title={text.imageSection} description={text.imageHint}>
            {picture(form.media, text.imageNone)}
            {error('media') ? <Notice tone="error">{error('media')}</Notice> : null}
            <Cluster>
              <Button variant="secondary" onClick={() => setPicking('media')}>
                {form.media ? text.imageChange : text.imageChoose}
              </Button>
            </Cluster>
          </FormSection>
          <FormSection title={text.mobileSection} description={text.mobileHint}>
            {picture(form.mobileMedia, text.mobileNone)}
            {error('mobileMedia') ? <Notice tone="error">{error('mobileMedia')}</Notice> : null}
            <Cluster>
              <Button variant="secondary" onClick={() => setPicking('mobileMedia')}>
                {form.mobileMedia ? text.imageChange : text.imageChoose}
              </Button>
              {form.mobileMedia ? (
                <Button variant="ghost" onClick={() => change({ mobileMedia: null })}>
                  {text.mobileRemove}
                </Button>
              ) : null}
            </Cluster>
          </FormSection>
          <FormSection title={text.contentSection} description={text.contentHint}>
            <FormGrid>
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
              <Field label={text.subtitleVi} error={error('subtitleVi')}>
                {(control) => (
                  <TextInput
                    {...control}
                    value={form.subtitleVi}
                    onChange={(event) => change({ subtitleVi: event.target.value })}
                  />
                )}
              </Field>
              <Field label={text.subtitleEn} error={error('subtitleEn')}>
                {(control) => (
                  <TextInput
                    {...control}
                    value={form.subtitleEn}
                    onChange={(event) => change({ subtitleEn: event.target.value })}
                  />
                )}
              </Field>
            </FormGrid>
          </FormSection>
          <FormSection title={text.linkSection} description={text.linkHint}>
            <FormGrid>
              <Field label={text.linkLabelVi} error={error('linkLabelVi')}>
                {(control) => (
                  <TextInput
                    {...control}
                    value={form.linkLabelVi}
                    onChange={(event) => change({ linkLabelVi: event.target.value })}
                  />
                )}
              </Field>
              <Field label={text.linkLabelEn} error={error('linkLabelEn')}>
                {(control) => (
                  <TextInput
                    {...control}
                    value={form.linkLabelEn}
                    onChange={(event) => change({ linkLabelEn: event.target.value })}
                  />
                )}
              </Field>
              <Field label={text.linkUrl} hint={text.linkUrlHint} error={error('linkUrl')}>
                {(control) => (
                  <TextInput
                    {...control}
                    inputMode="url"
                    autoComplete="off"
                    value={form.linkUrl}
                    onChange={(event) => change({ linkUrl: event.target.value })}
                  />
                )}
              </Field>
            </FormGrid>
          </FormSection>
          <FormSection title={text.altSection} description={text.altHint}>
            <FormGrid>
              <Field label={text.altVi} error={error('altVi')}>
                {(control) => (
                  <TextInput
                    {...control}
                    value={form.altVi}
                    onChange={(event) => change({ altVi: event.target.value })}
                  />
                )}
              </Field>
              <Field label={text.altEn} error={error('altEn')}>
                {(control) => (
                  <TextInput
                    {...control}
                    value={form.altEn}
                    onChange={(event) => change({ altEn: event.target.value })}
                  />
                )}
              </Field>
            </FormGrid>
          </FormSection>
          <FormSection title={text.scheduleSection} description={text.scheduleHint}>
            <FormGrid>
              <Field label={text.startsAt} error={error('startsAt')}>
                {(control) => (
                  <TextInput
                    {...control}
                    type="datetime-local"
                    value={form.startsAt}
                    onChange={(event) => change({ startsAt: event.target.value })}
                  />
                )}
              </Field>
              <Field label={text.endsAt} error={error('endsAt')}>
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
        </Stack>
      </FormDrawer>
      {picking ? (
        <MediaPicker
          onPick={(asset) => {
            if (picking === 'media') change({ media: mediaOf(asset) });
            else change({ mobileMedia: mediaOf(asset) });
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </>
  );
}
