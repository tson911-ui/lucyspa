import { fill, type WorkforceDictionary } from '../../i18n/workforce';

/** Form values (strings as typed) for a service's durations, in minutes. */
export interface DurationForm {
  estimatedMinMinutes: string;
  estimatedMaxMinutes: string;
  durationMinutes: string;
}

export type DurationProblem = 'invalid' | 'maxBeforeMin' | 'slotTooShort';

const MAX_MINUTES = 1440;

function minutes(value: string): number | null {
  if (!/^[0-9]{1,4}$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return parsed >= 1 && parsed <= MAX_MINUTES ? parsed : null;
}

/**
 * UX mirror of the API's duration invariant:
 * `1 <= estimated min <= estimated max <= scheduling duration <= 1440`, whole minutes.
 * The API (and SQL) remain authoritative.
 */
export function durationProblem(form: DurationForm): DurationProblem | null {
  const min = minutes(form.estimatedMinMinutes);
  const max = minutes(form.estimatedMaxMinutes);
  const slot = minutes(form.durationMinutes);
  if (min === null || max === null || slot === null) return 'invalid';
  if (max < min) return 'maxBeforeMin';
  if (slot < max) return 'slotTooShort';
  return null;
}

export function durationNumbers(form: DurationForm) {
  return {
    estimatedMinMinutes: Number(form.estimatedMinMinutes.trim()),
    estimatedMaxMinutes: Number(form.estimatedMaxMinutes.trim()),
    durationMinutes: Number(form.durationMinutes.trim()),
  };
}

/** Customer-facing estimate label: "30–45 min", or "60 min" for an exact duration. */
export function formatEstimate(min: number, max: number, t: WorkforceDictionary): string {
  return min === max
    ? fill(t.services.estimateExact, { min })
    : fill(t.services.estimateRange, { min, max });
}
