'use client';

import type {
  BirthdayRewardConfigResponse,
  BirthdayRewardVersionResponse,
} from '@lucy-spa/contracts';
import {
  CheckField,
  Field,
  FormDrawer,
  FormGrid,
  Icon,
  MoneyInput,
  NumberInput,
  RadioGroup,
  Stack,
  TextInput,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { birthdayDictionary } from '../../../i18n/birthday';
import {
  birthdayErrorText,
  birthdayRequest,
  draftFromVersion,
  emptyBirthdayDraft,
  validateBirthdayDraft,
  type BirthdayDraft,
  type DraftIssue,
} from '../../../lib/workforce/birthday';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';
import { Notice } from '../ui';

/** The error line of a choice group, drawn like a field error (the radio groups have no error slot of their own). */
function ChoiceError({ text }: { text: string }) {
  return (
    <p className="ls-error" role="alert">
      <Icon name="x-circle" size={16} />
      <span>{text}</span>
    </p>
  );
}

/**
 * The Owner's birthday gift form (Phase 5 P5-6, `MANAGE_BIRTHDAY_REWARDS`, Owner only): a medium form, so a drawer. Nothing is
 * preset on a first setup, and the usage limit has no preselected option: saving is refused until the Owner picks one. Saving
 * appends a new version; finalized invoices keep the version they were computed under.
 */
export function BirthdayFormDrawer({
  current,
  onDone,
  onClose,
}: {
  /** The version being edited, or null on the first setup. */
  current: BirthdayRewardVersionResponse | null;
  onDone: (config: BirthdayRewardConfigResponse) => void;
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const b = birthdayDictionary(locale);
  const f = b.form;
  const [initial] = useState(() => (current ? draftFromVersion(current) : emptyBirthdayDraft()));
  const [draft, setDraft] = useState<BirthdayDraft>(initial);
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = validateBirthdayDraft(draft);
  const set = (patch: Partial<BirthdayDraft>) => setDraft((state) => ({ ...state, ...patch }));
  const issueText = (issue: DraftIssue | undefined) =>
    checked && issue ? (issue === 'windowTooLong' ? f.windowTooLong : f[issue]) : undefined;

  async function submit() {
    if (pending) return;
    setChecked(true);
    const body = birthdayRequest(draft, current?.versionNo ?? null);
    if (!body) return;
    setPending(true);
    setError(null);
    try {
      onDone(await api.post<BirthdayRewardConfigResponse>('/api/v1/loyalty/birthday-reward', body));
    } catch (failure) {
      setError(birthdayErrorText(failure, locale, (cause) => errorMessage(cause, t)));
      setPending(false);
    }
  }

  return (
    <FormDrawer
      title={current ? f.editTitle : f.createTitle}
      labels={{ ...formOverlayLabels(t, f.submit), submitting: f.submitting }}
      busy={pending}
      dirty={JSON.stringify(draft) !== JSON.stringify(initial)}
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <CheckField
          label={f.active}
          hint={f.activeHint}
          checked={draft.isActive}
          onChange={(event) => set({ isActive: event.target.checked })}
        />
        <RadioGroup
          legend={f.kind}
          name="birthday-kind"
          required
          invalid={checked && errors.kind !== undefined}
          value={draft.kind}
          onValueChange={(kind) => set({ kind: kind as 'PERCENT' | 'FIXED_AMOUNT' })}
          options={[
            { value: 'PERCENT', label: f.kindPercent },
            { value: 'FIXED_AMOUNT', label: f.kindFixed },
          ]}
        />
        {checked && errors.kind ? <ChoiceError text={f.required} /> : null}
        {draft.kind === 'PERCENT' ? (
          <Field
            label={f.percent}
            hint={f.percentHint}
            error={issueText(errors.value)}
            width="md"
            required
          >
            {(control) => (
              <TextInput
                {...control}
                inputMode="decimal"
                autoComplete="off"
                maxLength={6}
                value={draft.percent}
                onChange={(event) => set({ percent: event.target.value })}
              />
            )}
          </Field>
        ) : null}
        {draft.kind === 'FIXED_AMOUNT' ? (
          <Field
            label={f.fixed}
            hint={f.fixedHint}
            error={issueText(errors.value)}
            width="md"
            required
          >
            {(control) => (
              <MoneyInput
                {...control}
                unit="₫"
                separator={locale === 'vi' ? '.' : ','}
                value={draft.fixed}
                onValueChange={(fixed) => set({ fixed })}
              />
            )}
          </Field>
        ) : null}
        <Field label={f.minSpend} hint={f.minSpendHint} width="md">
          {(control) => (
            <MoneyInput
              {...control}
              unit="₫"
              separator={locale === 'vi' ? '.' : ','}
              value={draft.minSpend}
              onValueChange={(minSpend) => set({ minSpend })}
            />
          )}
        </Field>
        <Field
          label={f.before}
          hint={f.beforeHint}
          error={issueText(errors.before)}
          width="md"
          required
        >
          {(control) => (
            <NumberInput
              {...control}
              inputMode="numeric"
              min={0}
              max={364}
              value={draft.before}
              onChange={(event) => set({ before: event.target.value })}
            />
          )}
        </Field>
        <Field
          label={f.after}
          hint={f.afterHint}
          error={issueText(errors.after)}
          width="md"
          required
        >
          {(control) => (
            <NumberInput
              {...control}
              inputMode="numeric"
              min={0}
              max={364}
              value={draft.after}
              onChange={(event) => set({ after: event.target.value })}
            />
          )}
        </Field>
        <Stack gap="field">
          <span className="ls-label">{f.combine}</span>
          <p className="ls-hint">{f.combineHint}</p>
          <CheckField
            label={f.combineMember}
            checked={draft.combineMember}
            onChange={(event) => set({ combineMember: event.target.checked })}
          />
          <CheckField
            label={f.combinePromotion}
            checked={draft.combinePromotion}
            onChange={(event) => set({ combinePromotion: event.target.checked })}
          />
          <CheckField
            label={f.combineVoucher}
            checked={draft.combineVoucher}
            onChange={(event) => set({ combineVoucher: event.target.checked })}
          />
        </Stack>
        <RadioGroup
          legend={f.usage}
          name="birthday-usage"
          required
          invalid={checked && errors.usage !== undefined}
          value={draft.usage}
          onValueChange={(usage) => set({ usage: usage as BirthdayDraft['usage'] })}
          options={[
            { value: 'ONE', label: f.usageOne },
            { value: 'MANY', label: f.usageMany },
            { value: 'UNLIMITED', label: f.usageUnlimited },
          ]}
        />
        <p className="ls-hint">{f.usageHint}</p>
        {checked && errors.usage ? <ChoiceError text={f.required} /> : null}
        {draft.usage === 'MANY' ? (
          <Field
            label={f.usageCount}
            hint={f.usageCountHint}
            error={issueText(errors.usageCount)}
            width="md"
            required
          >
            {(control) => (
              <NumberInput
                {...control}
                inputMode="numeric"
                min={2}
                max={1000}
                value={draft.usageCount}
                onChange={(event) => set({ usageCount: event.target.value })}
              />
            )}
          </Field>
        ) : null}
      </FormGrid>
    </FormDrawer>
  );
}
