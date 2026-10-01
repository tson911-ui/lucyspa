'use client';

import { Field, FormGrid, NumberInput } from '@lucy-spa/ui';
import type { WorkforceDictionary } from '../../../i18n/workforce';
import { durationProblem, type DurationForm } from '../../../lib/workforce/durations';
import { Notice } from '../ui';

/**
 * The three service durations: the customer-facing estimate (minimum and maximum) and the
 * one internal scheduling duration. Shared by the create and edit forms; renders its own
 * `FormGrid`, so it can sit directly in a form.
 */
export function DurationFields({
  idPrefix,
  value,
  onChange,
  t,
}: {
  idPrefix: string;
  value: DurationForm;
  onChange: (next: DurationForm) => void;
  t: WorkforceDictionary;
}) {
  const problem = durationProblem(value);
  const input = (key: keyof DurationForm, label: string, hint?: string) => (
    <Field id={`${idPrefix}-${key}`} label={label} required {...(hint ? { hint } : {})}>
      {(control) => (
        <NumberInput
          {...control}
          min={1}
          max={1440}
          step={1}
          invalid={problem !== null}
          value={value[key]}
          onChange={(event) => onChange({ ...value, [key]: event.target.value })}
        />
      )}
    </Field>
  );
  return (
    <>
      <FormGrid>
        {input('estimatedMinMinutes', t.services.estimatedMin, t.services.estimateHint)}
        {input('estimatedMaxMinutes', t.services.estimatedMax)}
        {input('durationMinutes', t.services.duration, t.services.durationNote)}
      </FormGrid>
      {problem ? (
        <Notice tone="error">
          {problem === 'invalid'
            ? t.services.durationInvalid
            : problem === 'maxBeforeMin'
              ? t.services.durationMaxBeforeMin
              : t.services.durationSlotTooShort}
        </Notice>
      ) : null}
    </>
  );
}
