'use client';

import { Field, FormGrid, NumberInput } from '@lucy-spa/ui';
import type { WorkforceDictionary } from '../../../i18n/workforce';
import { durationProblem, type DurationForm } from '../../../lib/workforce/durations';

/** A whole number of minutes from 1 to 1440 (the field-level part of the duration rule). */
const wholeMinutes = (value: string) =>
  /^[1-9][0-9]{0,3}$/.test(value.trim()) && Number(value) <= 1440;

/**
 * The message each duration field shows: a malformed value at its own field, "max before min" at the maximum, "slot too short" at
 * the scheduling duration (the API checks the same rule again).
 */
export function durationErrors(
  value: DurationForm,
  t: WorkforceDictionary,
): Partial<Record<keyof DurationForm, string>> {
  const problem = durationProblem(value);
  if (problem === null) return {};
  if (problem === 'maxBeforeMin') return { estimatedMaxMinutes: t.services.durationMaxBeforeMin };
  if (problem === 'slotTooShort') return { durationMinutes: t.services.durationSlotTooShort };
  const errors: Partial<Record<keyof DurationForm, string>> = {};
  for (const key of ['estimatedMinMinutes', 'estimatedMaxMinutes', 'durationMinutes'] as const) {
    if (!wholeMinutes(value[key])) errors[key] = t.services.durationInvalid;
  }
  return errors;
}

/**
 * The three service durations: the customer-facing estimate (minimum and maximum) and the
 * one internal scheduling duration. Shared by the create and edit forms; renders its own
 * `FormGrid`, so it can sit directly in a form. A problem shows at the field it belongs to
 * (`showErrors` after a submit; a value that is already wrong shows at once).
 */
export function DurationFields({
  idPrefix,
  value,
  onChange,
  t,
  showErrors = false,
}: {
  idPrefix: string;
  value: DurationForm;
  onChange: (next: DurationForm) => void;
  t: WorkforceDictionary;
  showErrors?: boolean | undefined;
}) {
  const errors = durationErrors(value, t);
  // An empty field is reported only after a submit; a typed but wrong value is reported while typing.
  const shown = (key: keyof DurationForm) =>
    showErrors || value[key].trim() !== '' ? errors[key] : undefined;
  const input = (key: keyof DurationForm, label: string, hint?: string) => (
    <Field
      id={`${idPrefix}-${key}`}
      label={label}
      required
      {...(hint ? { hint } : {})}
      error={shown(key)}
    >
      {(control) => (
        <NumberInput
          {...control}
          name={key}
          min={1}
          max={1440}
          step={1}
          value={value[key]}
          onChange={(event) => onChange({ ...value, [key]: event.target.value })}
        />
      )}
    </Field>
  );
  return (
    <FormGrid>
      {input('estimatedMinMinutes', t.services.estimatedMin, t.services.estimateHint)}
      {input('estimatedMaxMinutes', t.services.estimatedMax)}
      {input('durationMinutes', t.services.duration, t.services.durationNote)}
    </FormGrid>
  );
}
