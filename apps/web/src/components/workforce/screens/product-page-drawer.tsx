'use client';

import type { MediaAssetSummary, ProductSettingsResponse } from '@lucy-spa/contracts';
import {
  Cluster,
  Field,
  FormDrawer,
  FormGrid,
  FormSection,
  MediaPreview,
  Stack,
  Textarea,
  TextInput,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { productDictionary } from '../../../i18n/products';
import { fill } from '../../../i18n/workforce';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { mediaVariantUrl } from '../../../lib/workforce/media';
import {
  draftFromPage,
  nextLineKey,
  pageChanged,
  pageProblem,
  pageRequest,
  PAGE_LIMITS,
  type PageDraft,
  type PageProblem,
} from '../../../lib/workforce/product-page';
import { productErrorText } from '../../../lib/workforce/products';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';
import { Button, ErrorState, Loading, Notice, useResource, useSuccessToast } from '../ui';
import { MediaPicker } from './media-picker';

/**
 * "Trang mỹ phẩm": the Owner-written copy of the public cosmetics page (OQ-P6-28) in a drawer (FR9: a medium form): the picture
 * and words at the top and the commitment box. Everything left empty stays hidden on the public page. The drawer reads the settings
 * row itself, so it always holds the current version; a conflict reloads it and the form starts again from the saved values.
 */
export function ProductPageDrawer({ onClose }: { onClose: () => void }) {
  const { api, t, locale } = useWorkforce();
  const p = productDictionary(locale);
  const resource = useResource(
    () => api.get<ProductSettingsResponse>('/api/v1/product-settings'),
    [api],
  );
  const [error, setError] = useState<string | null>(null);
  if (resource.data) {
    return (
      <PageForm
        key={resource.data.rowVersion}
        settings={resource.data}
        error={error}
        onError={setError}
        reload={resource.reload}
        onClose={onClose}
      />
    );
  }
  return (
    <FormDrawer
      title={p.page.title}
      labels={{ ...formOverlayLabels(t, p.page.save), submitting: p.saving }}
      busy={false}
      submitDisabled
      onClose={onClose}
      onSubmit={() => undefined}
    >
      {resource.error ? (
        <ErrorState error={resource.error} t={t} onRetry={() => void resource.reload()} />
      ) : (
        <Loading t={t} />
      )}
    </FormDrawer>
  );
}

function PageForm({
  settings,
  error,
  onError,
  reload,
  onClose,
}: {
  settings: ProductSettingsResponse;
  error: string | null;
  onError: (message: string | null) => void;
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const p = productDictionary(locale);
  const s = p.page;
  const notify = useSuccessToast();
  const [initial] = useState(() => draftFromPage(settings.publicPage));
  const [draft, setDraft] = useState<PageDraft>(initial);
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [picking, setPicking] = useState(false);
  const set = (patch: Partial<PageDraft>) => setDraft((state) => ({ ...state, ...patch }));
  const problem: PageProblem | null = checked ? pageProblem(draft) : null;
  const shows = (...kinds: PageProblem[]) =>
    problem !== null && kinds.includes(problem) ? s.problems[problem] : undefined;

  const setLine = (key: number, patch: { textVi?: string; textEn?: string }) =>
    set({ lines: draft.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) });

  async function submit() {
    if (pending) return;
    setChecked(true);
    onError(null);
    const body = pageRequest(draft, settings.rowVersion);
    if (!body) return;
    if (!pageChanged(draft, initial)) {
      onClose();
      return;
    }
    setPending(true);
    try {
      await api.post('/api/v1/product-settings/edit', body);
      notify(s.saved);
      onClose();
    } catch (failure) {
      onError(productErrorText(failure, locale, (cause) => errorMessage(cause, t)));
      await reload().catch(() => undefined);
      setPending(false);
    }
  }

  const choose = (asset: MediaAssetSummary) => {
    set({ mediaId: asset.id });
    setPicking(false);
  };

  return (
    <>
      <FormDrawer
        title={s.title}
        labels={{ ...formOverlayLabels(t, s.save), submitting: p.saving }}
        busy={pending}
        dirty={pageChanged(draft, initial)}
        error={
          error || shows('tooLong') ? (
            <Notice tone="error">{error ?? shows('tooLong')}</Notice>
          ) : undefined
        }
        onClose={onClose}
        onSubmit={submit}
      >
        <Stack gap="page">
          <FormSection title={s.heroSection} description={s.heroHint}>
            {draft.mediaId ? (
              <MediaPreview src={mediaVariantUrl(draft.mediaId, 'md')} alt={s.imagePreview} />
            ) : (
              <p className="ls-hint">{s.imageNone}</p>
            )}
            <Cluster>
              <Button variant="secondary" onClick={() => setPicking(true)}>
                {draft.mediaId ? s.imageChange : s.imageChoose}
              </Button>
              {draft.mediaId ? (
                <Button variant="ghost" onClick={() => set({ mediaId: null })}>
                  {s.imageRemove}
                </Button>
              ) : null}
            </Cluster>
            <FormGrid>
              <Field label={s.heroTitleVi} error={shows('heroTitle')}>
                {(control) => (
                  <TextInput
                    {...control}
                    value={draft.heroTitleVi}
                    onChange={(event) => set({ heroTitleVi: event.target.value })}
                  />
                )}
              </Field>
              <Field label={s.heroTitleEn}>
                {(control) => (
                  <TextInput
                    {...control}
                    value={draft.heroTitleEn}
                    onChange={(event) => set({ heroTitleEn: event.target.value })}
                  />
                )}
              </Field>
              <Field label={s.heroTextVi} error={shows('heroText')}>
                {(control) => (
                  <Textarea
                    {...control}
                    rows={3}
                    value={draft.heroTextVi}
                    onChange={(event) => set({ heroTextVi: event.target.value })}
                  />
                )}
              </Field>
              <Field label={s.heroTextEn}>
                {(control) => (
                  <Textarea
                    {...control}
                    rows={3}
                    value={draft.heroTextEn}
                    onChange={(event) => set({ heroTextEn: event.target.value })}
                  />
                )}
              </Field>
            </FormGrid>
          </FormSection>
          <FormSection title={s.commitmentSection} description={s.commitmentHint}>
            <FormGrid>
              <Field label={s.commitmentTitleVi} error={shows('commitmentTitle')}>
                {(control) => (
                  <TextInput
                    {...control}
                    value={draft.commitmentTitleVi}
                    onChange={(event) => set({ commitmentTitleVi: event.target.value })}
                  />
                )}
              </Field>
              <Field label={s.commitmentTitleEn}>
                {(control) => (
                  <TextInput
                    {...control}
                    value={draft.commitmentTitleEn}
                    onChange={(event) => set({ commitmentTitleEn: event.target.value })}
                  />
                )}
              </Field>
            </FormGrid>
            {draft.lines.map((line, index) => (
              <Stack key={line.key} gap="field">
                <FormGrid>
                  <Field label={fill(s.lineVi, { n: index + 1 })}>
                    {(control) => (
                      <TextInput
                        {...control}
                        value={line.textVi}
                        onChange={(event) => setLine(line.key, { textVi: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field label={fill(s.lineEn, { n: index + 1 })}>
                    {(control) => (
                      <TextInput
                        {...control}
                        value={line.textEn}
                        onChange={(event) => setLine(line.key, { textEn: event.target.value })}
                      />
                    )}
                  </Field>
                </FormGrid>
                <Cluster>
                  <Button
                    variant="ghost"
                    icon="trash"
                    onClick={() => set({ lines: draft.lines.filter((x) => x.key !== line.key) })}
                  >
                    {fill(s.removeLine, { n: index + 1 })}
                  </Button>
                </Cluster>
              </Stack>
            ))}
            {shows('lines') ? <Notice tone="error">{shows('lines')}</Notice> : null}
            {draft.lines.length < PAGE_LIMITS.commitmentLines ? (
              <Cluster>
                <Button
                  variant="secondary"
                  icon="plus"
                  onClick={() =>
                    set({
                      lines: [
                        ...draft.lines,
                        { key: nextLineKey(draft.lines), textVi: '', textEn: '' },
                      ],
                    })
                  }
                >
                  {s.addLine}
                </Button>
              </Cluster>
            ) : null}
          </FormSection>
        </Stack>
      </FormDrawer>
      {picking ? <MediaPicker onPick={choose} onClose={() => setPicking(false)} /> : null}
    </>
  );
}
