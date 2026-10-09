'use client';

import type { CampaignDetailResponse } from '@lucy-spa/contracts';
import { DescriptionList, Field, FormDrawer, FormGrid, Textarea, TextInput } from '@lucy-spa/ui';
import { useState } from 'react';
import { campaignDictionary } from '../../../i18n/campaigns';
import {
  campaignPath,
  campaignTone,
  campaignWindow,
  firstProblemField,
  infoDraftOf,
  infoEditRequest,
  validateInfo,
  CAMPAIGN_ZONE,
  type CampaignFormField,
  type CampaignInfoDraft,
} from '../../../lib/workforce/campaigns';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { formatDateTime } from '../../../lib/workforce/format';
import { useWorkforce } from '../session';
import { Badge, Button, Notice, Section, useSuccessToast } from '../ui';
import { useCampaignAction, type SendCampaign } from './campaign-dialogs';

/** Name, address, period and internal note. A draft can edit them; after publishing they are read-only. */
export function InfoSection({
  campaign,
  send,
}: {
  campaign: CampaignDetailResponse;
  send: SendCampaign;
}) {
  const { locale } = useWorkforce();
  const c = campaignDictionary(locale);
  const i = c.info;
  const notify = useSuccessToast();
  const [editing, setEditing] = useState(false);
  const stamp = (iso: string) => formatDateTime(iso, CAMPAIGN_ZONE, locale);
  return (
    <>
      {!campaign.can.edit ? <Notice tone="info">{i.locked}</Notice> : null}
      <Section
        title={i.title}
        actions={
          campaign.can.edit ? (
            <Button variant="secondary" icon="edit" onClick={() => setEditing(true)}>
              {i.edit}
            </Button>
          ) : undefined
        }
      >
        <DescriptionList
          columns={2}
          items={[
            {
              label: i.status,
              value: <Badge tone={campaignTone(campaign.state)}>{c.states[campaign.state]}</Badge>,
            },
            { label: i.window, value: campaignWindow(campaign, locale) },
            { label: c.fields.nameVi, value: campaign.nameVi },
            { label: c.fields.nameEn, value: campaign.nameEn },
            { label: c.fields.slug, value: campaign.slug },
            { label: i.link, value: campaignPath(campaign.slug, locale) },
            {
              label: i.publishedAt,
              value: campaign.publishedAt ? stamp(campaign.publishedAt) : i.notPublished,
            },
            { label: c.fields.note, value: campaign.internalNote ?? i.noteNone },
            ...(campaign.endedEarlyAt
              ? [
                  { label: i.endedEarly, value: stamp(campaign.endedEarlyAt) },
                  { label: i.endedReason, value: campaign.endedEarlyReason },
                ]
              : []),
          ]}
        />
      </Section>
      {editing ? (
        <InfoDrawer
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

function InfoDrawer({
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
  const [initial] = useState<CampaignInfoDraft>(() => infoDraftOf(campaign));
  const [draft, setDraft] = useState<CampaignInfoDraft>(initial);
  const [checked, setChecked] = useState(false);
  const command = useCampaignAction(send);
  const problems = checked ? validateInfo(draft, initial) : {};
  const text = (field: CampaignFormField) => {
    if (command.field === field && command.message) return command.message;
    const key = problems[field];
    return key ? c.problems[key] : undefined;
  };

  async function submit() {
    setChecked(true);
    const field = firstProblemField(validateInfo(draft, initial));
    if (field) {
      document.getElementById(`campaign-info-${field}`)?.focus();
      return;
    }
    const body = infoEditRequest(draft, campaign);
    if (!body) {
      onClose();
      return;
    }
    if (await command.run(`/api/v1/product-campaigns/${campaign.id}/edit`, body)) onDone();
  }

  return (
    <FormDrawer
      title={c.info.editTitle}
      labels={{ ...formOverlayLabels(t, c.save), submitting: c.saving }}
      busy={command.pending}
      dirty={JSON.stringify(draft) !== JSON.stringify(initial)}
      error={
        command.message && !command.field ? (
          <Notice tone="error">{command.message}</Notice>
        ) : undefined
      }
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid cols={1}>
        <Field id="campaign-info-nameVi" label={c.fields.nameVi} error={text('nameVi')} required>
          {(control) => (
            <TextInput
              {...control}
              value={draft.nameVi}
              onChange={(event) => setDraft({ ...draft, nameVi: event.target.value })}
            />
          )}
        </Field>
        <Field id="campaign-info-nameEn" label={c.fields.nameEn} error={text('nameEn')} required>
          {(control) => (
            <TextInput
              {...control}
              value={draft.nameEn}
              onChange={(event) => setDraft({ ...draft, nameEn: event.target.value })}
            />
          )}
        </Field>
        <Field
          id="campaign-info-slug"
          label={c.fields.slug}
          hint={c.fields.slugHint}
          error={text('slug')}
          required
        >
          {(control) => (
            <TextInput
              {...control}
              autoComplete="off"
              spellCheck={false}
              value={draft.slug}
              onChange={(event) => {
                command.clear();
                setDraft({ ...draft, slug: event.target.value });
              }}
            />
          )}
        </Field>
        <Field
          id="campaign-info-startsAt"
          label={c.fields.startsAt}
          hint={c.fields.startsHint}
          error={text('startsAt')}
          required
        >
          {(control) => (
            <TextInput
              {...control}
              type="datetime-local"
              value={draft.startsAt}
              onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })}
            />
          )}
        </Field>
        <Field id="campaign-info-endsAt" label={c.fields.endsAt} error={text('endsAt')} required>
          {(control) => (
            <TextInput
              {...control}
              type="datetime-local"
              value={draft.endsAt}
              onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })}
            />
          )}
        </Field>
        <Field
          id="campaign-info-note"
          label={c.fields.note}
          hint={c.fields.noteHint}
          error={text('note')}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              value={draft.note}
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            />
          )}
        </Field>
      </FormGrid>
    </FormDrawer>
  );
}
