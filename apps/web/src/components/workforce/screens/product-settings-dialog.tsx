'use client';

import type { ProductSettingsResponse } from '@lucy-spa/contracts';
import { Field, FormDialog, FormGrid, NumberInput } from '@lucy-spa/ui';
import { useState } from 'react';
import { productDictionary } from '../../../i18n/products';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import {
  draftFromSettings,
  settingsRequest,
  validateSettingsDraft,
  type SettingsDraft,
  type SettingsField,
  productErrorText,
} from '../../../lib/workforce/products';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';
import { ErrorState, Loading, Notice, useResource, useSuccessToast } from '../ui';

/**
 * "Cài đặt sản phẩm": the one settings row of the product module as a short form (a dialog). The same dialog serves the products
 * screen (`lead`: the default waiting time of items sold on order) and the inventory screen (`expiry`: how many days before a
 * lot expires it is warned about). It reads the row itself, so it always holds the current version; a conflict reloads it.
 */
export function ProductSettingsDialog({
  fields,
  onClose,
}: {
  fields: readonly SettingsField[];
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const p = productDictionary(locale);
  const resource = useResource(
    () => api.get<ProductSettingsResponse>('/api/v1/product-settings'),
    [api],
  );
  // The failure message lives here: after a conflict the row is reloaded, which gives the form a new key (a fresh draft).
  const [error, setError] = useState<string | null>(null);
  if (resource.data) {
    return (
      <SettingsForm
        key={resource.data.rowVersion}
        settings={resource.data}
        fields={fields}
        error={error}
        onError={setError}
        reload={resource.reload}
        onClose={onClose}
      />
    );
  }
  return (
    <FormDialog
      title={p.settings.title}
      labels={{ ...formOverlayLabels(t, p.settings.save), submitting: p.saving }}
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
    </FormDialog>
  );
}

const issue = (
  shown: boolean,
  field: SettingsField,
  draft: SettingsDraft,
  f: readonly SettingsField[],
) => (shown ? validateSettingsDraft(draft, f)[field] : undefined);

function SettingsForm({
  settings,
  fields,
  error,
  onError,
  reload,
  onClose,
}: {
  settings: ProductSettingsResponse;
  fields: readonly SettingsField[];
  error: string | null;
  onError: (message: string | null) => void;
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const p = productDictionary(locale);
  const s = p.settings;
  const notify = useSuccessToast();
  const [initial] = useState(() => draftFromSettings(settings));
  const [draft, setDraft] = useState<SettingsDraft>(initial);
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const set = (patch: Partial<SettingsDraft>) => setDraft((state) => ({ ...state, ...patch }));

  async function submit() {
    if (pending) return;
    setChecked(true);
    onError(null);
    if (Object.keys(validateSettingsDraft(draft, fields)).length > 0) return;
    const body = settingsRequest(draft, settings, fields);
    if (!body) {
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

  return (
    <FormDialog
      title={s.title}
      labels={{ ...formOverlayLabels(t, s.save), submitting: p.saving }}
      busy={pending}
      dirty={JSON.stringify(draft) !== JSON.stringify(initial)}
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid cols={1}>
        {fields.includes('lead') ? (
          <>
            <Field
              label={s.leadMin}
              error={issue(checked, 'lead', draft, fields) ? s.leadInvalid : undefined}
              required
            >
              {(control) => (
                <NumberInput
                  {...control}
                  inputMode="numeric"
                  min={1}
                  max={90}
                  value={draft.leadMin}
                  onChange={(event) => set({ leadMin: event.target.value })}
                />
              )}
            </Field>
            <Field label={s.leadMax} hint={s.leadHint} required>
              {(control) => (
                <NumberInput
                  {...control}
                  inputMode="numeric"
                  min={1}
                  max={90}
                  value={draft.leadMax}
                  onChange={(event) => set({ leadMax: event.target.value })}
                />
              )}
            </Field>
          </>
        ) : null}
        {fields.includes('badge') ? (
          <Field
            label={s.badgeField}
            hint={s.badgeHint}
            error={issue(checked, 'badge', draft, fields) ? s.badgeInvalid : undefined}
            required
          >
            {(control) => (
              <NumberInput
                {...control}
                inputMode="numeric"
                min={1}
                max={365}
                value={draft.badge}
                onChange={(event) => set({ badge: event.target.value })}
              />
            )}
          </Field>
        ) : null}
        {fields.includes('expiry') ? (
          <Field
            label={s.expiryField}
            hint={s.expiryHint}
            error={issue(checked, 'expiry', draft, fields) ? s.expiryInvalid : undefined}
            required
          >
            {(control) => (
              <NumberInput
                {...control}
                inputMode="numeric"
                min={1}
                max={730}
                value={draft.expiry}
                onChange={(event) => set({ expiry: event.target.value })}
              />
            )}
          </Field>
        ) : null}
      </FormGrid>
    </FormDialog>
  );
}
