'use client';

import type { ComboListResponse, ComboResponse, ComboServiceOption } from '@lucy-spa/contracts';
import {
  CheckField,
  Field,
  FormDrawer,
  FormGrid,
  MoneyInput,
  NumberInput,
  Select,
  TextInput,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { comboDictionary } from '../../../i18n/combo';
import {
  comboErrorText,
  createRequest,
  draftFromCombo,
  emptyComboDraft,
  validateComboDraft,
  versionRequest,
  type ComboDraft,
  type ComboIssue,
} from '../../../lib/workforce/combo';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';
import { Notice } from '../ui';

/**
 * The combo form (Phase 5 P5-7, `MANAGE_COMBOS`): a medium form, so a drawer. A new combo starts empty; editing starts from the
 * current version and appends a new one (the service never changes). Lucy Spa combos do not expire, so there is no expiry field.
 */
export function ComboFormDrawer({
  combo,
  services,
  onDone,
  onClose,
}: {
  /** The combo being edited, or null for a new one. */
  combo: ComboResponse | null;
  services: readonly ComboServiceOption[];
  onDone: () => void;
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const c = comboDictionary(locale);
  const f = c.form;
  const [initial] = useState(() => (combo ? draftFromCombo(combo) : emptyComboDraft()));
  const [draft, setDraft] = useState<ComboDraft>(initial);
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = validateComboDraft(draft, combo !== null);
  const set = (patch: Partial<ComboDraft>) => setDraft((state) => ({ ...state, ...patch }));
  const issueText = (issue: ComboIssue | undefined) =>
    checked && issue ? (issue === 'required' ? f.required : f.invalid) : undefined;

  async function submit() {
    if (pending) return;
    setChecked(true);
    setError(null);
    const body = combo ? versionRequest(draft, combo.current.versionNo) : createRequest(draft);
    if (!body) return;
    setPending(true);
    try {
      await api.post<ComboListResponse | ComboResponse>(
        combo ? `/api/v1/combos/${combo.id}/versions` : '/api/v1/combos',
        body,
      );
      onDone();
    } catch (failure) {
      setError(comboErrorText(failure, locale, (cause) => errorMessage(cause, t)));
      setPending(false);
    }
  }

  const serviceName = (service: ComboServiceOption) =>
    locale === 'vi' ? service.nameVi : service.nameEn;
  return (
    <FormDrawer
      title={combo ? f.editTitle : f.createTitle}
      labels={{ ...formOverlayLabels(t, f.submit), submitting: f.submitting }}
      busy={pending}
      dirty={JSON.stringify(draft) !== JSON.stringify(initial)}
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <Field
          label={f.service}
          hint={f.serviceHint}
          error={issueText(errors.serviceId)}
          required={combo === null}
        >
          {(control) =>
            combo ? (
              <TextInput {...control} value={serviceName(combo.service)} readOnly disabled />
            ) : (
              <Select
                {...control}
                value={draft.serviceId}
                placeholder={f.servicePlaceholder}
                options={services.map((service) => ({
                  value: service.id,
                  label: serviceName(service),
                }))}
                onChange={(event) => set({ serviceId: event.target.value })}
              />
            )
          }
        </Field>
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
        <Field label={f.paid} hint={f.paidHint} error={issueText(errors.paid)} width="md" required>
          {(control) => (
            <NumberInput
              {...control}
              inputMode="numeric"
              min={1}
              max={200}
              value={draft.paid}
              onChange={(event) => set({ paid: event.target.value })}
            />
          )}
        </Field>
        <Field
          label={f.bonus}
          hint={f.bonusHint}
          error={issueText(errors.bonus)}
          width="md"
          required
        >
          {(control) => (
            <NumberInput
              {...control}
              inputMode="numeric"
              min={0}
              max={200}
              value={draft.bonus}
              onChange={(event) => set({ bonus: event.target.value })}
            />
          )}
        </Field>
        <Field
          label={f.price}
          hint={f.priceHint}
          error={issueText(errors.price)}
          width="md"
          required
        >
          {(control) => (
            <MoneyInput
              {...control}
              unit="₫"
              separator={locale === 'vi' ? '.' : ','}
              value={draft.price}
              onValueChange={(price) => set({ price })}
            />
          )}
        </Field>
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
