'use client';

import type { CampaignDetailResponse } from '@lucy-spa/contracts';
import {
  Cluster,
  DescriptionList,
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
import { campaignDictionary } from '../../../i18n/campaigns';
import { fill } from '../../../i18n/workforce';
import {
  badgePreview,
  PRESENTATION_LIMITS,
  presentationDraftOf,
  presentationEditRequest,
  presentationProblems,
  type PresentationDraft,
  type PresentationTextField,
} from '../../../lib/workforce/campaigns';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { mediaVariantUrl } from '../../../lib/workforce/media';
import { useWorkforce } from '../session';
import { Badge, Button, Notice, Section, useSuccessToast } from '../ui';
import { useCampaignAction, type SendCampaign } from './campaign-dialogs';
import { MediaPicker } from './media-picker';

/**
 * What customers see while the campaign runs: the badge on product cards, the headline, message and button text of the sale page
 * and its banner. Editable at any time before the campaign ends, even after publishing; a small preview shows the badge and banner.
 */
export function DisplaySection({
  campaign,
  send,
}: {
  campaign: CampaignDetailResponse;
  send: SendCampaign;
}) {
  const { locale } = useWorkforce();
  const c = campaignDictionary(locale);
  const d = c.display;
  const notify = useSuccessToast();
  const [editing, setEditing] = useState(false);
  const badge = badgePreview(campaign, locale);

  return (
    <>
      <Section
        title={d.title}
        actions={
          campaign.can.editPresentation ? (
            <Button variant="secondary" icon="edit" onClick={() => setEditing(true)}>
              {d.edit}
            </Button>
          ) : undefined
        }
      >
        <Stack gap="block">
          <p className="ls-hint">{d.intro}</p>
          <DescriptionList
            columns={2}
            items={[
              { label: d.badgeVi, value: campaign.badgeVi ?? d.notSet },
              { label: d.badgeEn, value: campaign.badgeEn ?? d.notSet },
              { label: d.headlineVi, value: campaign.headlineVi ?? d.notSet },
              { label: d.headlineEn, value: campaign.headlineEn ?? d.notSet },
              { label: d.messageVi, value: campaign.messageVi ?? d.notSet },
              { label: d.messageEn, value: campaign.messageEn ?? d.notSet },
              { label: d.ctaVi, value: campaign.ctaLabelVi ?? d.notSet },
              { label: d.ctaEn, value: campaign.ctaLabelEn ?? d.notSet },
            ]}
          />
          <DescriptionList
            items={[
              {
                label: d.previewBadge,
                value: <Badge tone="success">{badge ?? d.badgeAuto}</Badge>,
              },
            ]}
          />

          {campaign.bannerMediaId ? (
            <MediaPreview
              src={mediaVariantUrl(campaign.bannerMediaId, 'md')}
              alt={d.bannerPreview}
            />
          ) : (
            <p className="ls-hint">{d.bannerNone}</p>
          )}
        </Stack>
      </Section>
      {editing ? (
        <DisplayDrawer
          campaign={campaign}
          send={send}
          onClose={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            notify(c.saved);
          }}
        />
      ) : null}
    </>
  );
}

const PAIRS: ReadonlyArray<{
  vi: PresentationTextField;
  en: PresentationTextField;
  viLabel: 'badgeVi' | 'headlineVi' | 'messageVi' | 'ctaVi';
  enLabel: 'badgeEn' | 'headlineEn' | 'messageEn' | 'ctaEn';
  multiline: boolean;
}> = [
  { vi: 'badgeVi', en: 'badgeEn', viLabel: 'badgeVi', enLabel: 'badgeEn', multiline: false },
  {
    vi: 'headlineVi',
    en: 'headlineEn',
    viLabel: 'headlineVi',
    enLabel: 'headlineEn',
    multiline: false,
  },
  { vi: 'messageVi', en: 'messageEn', viLabel: 'messageVi', enLabel: 'messageEn', multiline: true },
  { vi: 'ctaLabelVi', en: 'ctaLabelEn', viLabel: 'ctaVi', enLabel: 'ctaEn', multiline: false },
];

function DisplayDrawer({
  campaign,
  send,
  onClose,
  onDone,
}: {
  campaign: CampaignDetailResponse;
  send: SendCampaign;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, locale } = useWorkforce();
  const c = campaignDictionary(locale);
  const d = c.display;
  const [initial] = useState<PresentationDraft>(() => presentationDraftOf(campaign));
  const [draft, setDraft] = useState<PresentationDraft>(initial);
  const [picking, setPicking] = useState(false);
  const [checked, setChecked] = useState(false);
  const command = useCampaignAction(send);
  const tooLong = new Set(presentationProblems(draft));
  const set = (patch: Partial<PresentationDraft>) => setDraft((state) => ({ ...state, ...patch }));

  async function submit() {
    setChecked(true);
    if (tooLong.size > 0) return;
    const body = presentationEditRequest(draft, campaign);
    if (!body) {
      onClose();
      return;
    }
    if (await command.run(`/api/v1/product-campaigns/${campaign.id}/edit`, body)) onDone();
  }

  const field = (name: PresentationTextField, label: string, multiline: boolean) => {
    const limit = PRESENTATION_LIMITS[name];
    const left = limit - [...draft[name].trim()].length;
    return (
      <Field
        key={name}
        label={label}
        hint={left >= 0 ? fill(d.hint, { left }) : undefined}
        error={checked && tooLong.has(name) ? fill(c.problems.text, { max: limit }) : undefined}
      >
        {(control) =>
          multiline ? (
            <Textarea
              {...control}
              rows={3}
              value={draft[name]}
              onChange={(event) => set({ [name]: event.target.value })}
            />
          ) : (
            <TextInput
              {...control}
              value={draft[name]}
              onChange={(event) => set({ [name]: event.target.value })}
            />
          )
        }
      </Field>
    );
  };

  return (
    <>
      <FormDrawer
        title={d.editTitle}
        labels={{ ...formOverlayLabels(t, c.save), submitting: c.saving }}
        busy={command.pending}
        dirty={JSON.stringify(draft) !== JSON.stringify(initial)}
        error={command.message ? <Notice tone="error">{command.message}</Notice> : undefined}
        onClose={onClose}
        onSubmit={submit}
      >
        <Stack gap="block">
          <FormSection title={d.sectionTexts}>
            <FormGrid cols={2}>
              {PAIRS.flatMap((pair) => [
                field(pair.vi, d[pair.viLabel], pair.multiline),
                field(pair.en, d[pair.enLabel], pair.multiline),
              ])}
            </FormGrid>
          </FormSection>
          <FormSection title={d.sectionBanner} description={d.bannerHint}>
            {draft.bannerMediaId ? (
              <MediaPreview
                src={mediaVariantUrl(draft.bannerMediaId, 'md')}
                alt={d.bannerPreview}
              />
            ) : (
              <p className="ls-hint">{d.bannerNone}</p>
            )}
            <Cluster>
              <Button variant="secondary" onClick={() => setPicking(true)}>
                {draft.bannerMediaId ? d.bannerChange : d.bannerChoose}
              </Button>
              {draft.bannerMediaId ? (
                <Button variant="ghost" onClick={() => set({ bannerMediaId: null })}>
                  {d.bannerRemove}
                </Button>
              ) : null}
            </Cluster>
          </FormSection>
        </Stack>
      </FormDrawer>
      {picking ? (
        <MediaPicker
          onPick={(asset) => {
            set({ bannerMediaId: asset.id });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </>
  );
}
