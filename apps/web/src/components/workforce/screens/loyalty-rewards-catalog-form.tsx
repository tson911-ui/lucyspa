'use client';

import type {
  RewardCatalogItemResponse,
  RewardCatalogListResponse,
  RewardServiceOption,
} from '@lucy-spa/contracts';
import {
  CheckField,
  Field,
  FormDrawer,
  FormGrid,
  NumberInput,
  Select,
  TextInput,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { rewardDictionary } from '../../../i18n/reward';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import {
  REWARD_KINDS,
  createItemRequest,
  draftFromItem,
  editItemRequest,
  emptyItemDraft,
  rewardErrorText,
  rewardName,
  validateItemDraft,
  type RewardIssue,
  type RewardItemDraft,
} from '../../../lib/workforce/reward';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';
import { Notice } from '../ui';

/**
 * The reward form (Phase 5 P5-9, `MANAGE_REWARD_CATALOG`): a medium form, so a drawer. A new item starts empty. Editing changes
 * the names, the validity and the active flag; the kind and the service never change. The validity rule applies to later grants
 * only: a reward already granted keeps the validity it was granted with.
 */
export function RewardItemDrawer({
  item,
  services,
  onDone,
  onClose,
}: {
  /** The item being edited, or null for a new one. */
  item: RewardCatalogItemResponse | null;
  services: readonly RewardServiceOption[];
  onDone: () => void;
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const r = rewardDictionary(locale);
  const f = r.form;
  const [initial] = useState(() => (item ? draftFromItem(item) : emptyItemDraft()));
  const [draft, setDraft] = useState<RewardItemDraft>(initial);
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = item !== null;
  const errors = validateItemDraft(draft, editing);
  const set = (patch: Partial<RewardItemDraft>) => setDraft((state) => ({ ...state, ...patch }));
  const issueText = (issue: RewardIssue | undefined) =>
    checked && issue ? (issue === 'required' ? f.required : f.invalid) : undefined;

  async function submit() {
    if (pending) return;
    setChecked(true);
    setError(null);
    const body = item ? editItemRequest(draft, item.rowVersion) : createItemRequest(draft);
    if (!body) return;
    setPending(true);
    try {
      await api.post<RewardCatalogListResponse | RewardCatalogItemResponse>(
        item ? `/api/v1/rewards/catalog/${item.id}/edit` : '/api/v1/rewards/catalog',
        body,
      );
      onDone();
    } catch (failure) {
      setError(rewardErrorText(failure, locale, (cause) => errorMessage(cause, t)));
      setPending(false);
    }
  }

  const showService = draft.kind === 'FREE_SERVICE';
  return (
    <FormDrawer
      title={editing ? f.editTitle : f.createTitle}
      labels={{ ...formOverlayLabels(t, f.submit), submitting: f.submitting }}
      busy={pending}
      dirty={JSON.stringify(draft) !== JSON.stringify(initial)}
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <Field label={f.kind} hint={f.kindHint} error={issueText(errors.kind)} required={!editing}>
          {(control) =>
            editing ? (
              <TextInput {...control} value={r.kind[item.kind]} readOnly disabled />
            ) : (
              <Select
                {...control}
                value={draft.kind}
                placeholder={f.kindPlaceholder}
                options={REWARD_KINDS.map((kind) => ({ value: kind, label: r.kind[kind] }))}
                onChange={(event) =>
                  set({
                    kind: event.target.value as RewardItemDraft['kind'],
                    serviceId: event.target.value === 'FREE_SERVICE' ? draft.serviceId : '',
                  })
                }
              />
            )
          }
        </Field>
        {showService ? (
          <Field
            label={f.service}
            hint={f.serviceHint}
            error={issueText(errors.serviceId)}
            required={!editing}
          >
            {(control) =>
              editing ? (
                <TextInput
                  {...control}
                  value={item.service ? rewardName(item.service, locale) : ''}
                  readOnly
                  disabled
                />
              ) : (
                <Select
                  {...control}
                  value={draft.serviceId}
                  placeholder={f.servicePlaceholder}
                  options={services.map((service) => ({
                    value: service.id,
                    label: rewardName(service, locale),
                  }))}
                  onChange={(event) => set({ serviceId: event.target.value })}
                />
              )
            }
          </Field>
        ) : null}
        <Field label={f.nameVi} error={issueText(errors.nameVi)} required>
          {(control) => (
            <TextInput
              {...control}
              autoComplete="off"
              maxLength={200}
              value={draft.nameVi}
              onChange={(event) => set({ nameVi: event.target.value })}
            />
          )}
        </Field>
        <Field label={f.nameEn} error={issueText(errors.nameEn)} required>
          {(control) => (
            <TextInput
              {...control}
              autoComplete="off"
              maxLength={200}
              value={draft.nameEn}
              onChange={(event) => set({ nameEn: event.target.value })}
            />
          )}
        </Field>
        <Field label={f.expiry} width="md">
          {(control) => (
            <Select
              {...control}
              value={draft.expiry}
              options={[
                { value: 'never', label: f.expiryNever },
                { value: 'days', label: f.expiryAfter },
              ]}
              onChange={(event) =>
                set({ expiry: event.target.value === 'days' ? 'days' : 'never' })
              }
            />
          )}
        </Field>
        {draft.expiry === 'days' ? (
          <Field
            label={f.days}
            hint={f.daysHint}
            error={issueText(errors.days)}
            width="md"
            required
          >
            {(control) => (
              <NumberInput
                {...control}
                inputMode="numeric"
                min={1}
                max={3650}
                value={draft.days}
                onChange={(event) => set({ days: event.target.value })}
              />
            )}
          </Field>
        ) : null}
        <CheckField
          label={f.active}
          hint={f.activeHint}
          checked={draft.active}
          onChange={(event) => set({ active: event.target.checked })}
        />
      </FormGrid>
    </FormDrawer>
  );
}
