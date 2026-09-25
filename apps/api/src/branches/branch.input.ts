import type { BranchOperatingDay } from '@lucy-spa/contracts';
import { AuthError } from '../auth/auth.error.js';
import { text } from '../auth/registration.js';

export const BRANCH_LIMITS = Object.freeze({ nameMaxCodePoints: 200, reasonMaxCodePoints: 500 });

/** PRD 4.3 initial hours, applied once at creation and editable afterwards. */
export const DEFAULT_OPERATING_HOURS = Object.freeze({ opensAtMinute: 540, closesAtMinute: 1260 });
export const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';

export interface OperatingDay {
  isoWeekday: number;
  isClosed: boolean;
  opensAtMinute: number | null;
  closesAtMinute: number | null;
}

/** Codes are identifiers used across the system: trimmed, uppercased ASCII, immutable. */
export function normalizeBranchCode(value: string): string {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{0,31}$/.test(code)) throw new AuthError('VALIDATION_FAILED', 'code');
  return code;
}

export function normalizeBranchName(value: string): string {
  return text(value, 'name', BRANCH_LIMITS.nameMaxCodePoints);
}

export function normalizeOptionalReason(value: string | undefined): string | null {
  return value === undefined ? null : text(value, 'reason', BRANCH_LIMITS.reasonMaxCodePoints);
}

/**
 * IANA zone syntax checked here; the database's own zone list (used by the attendance
 * business-date trigger) is the final authority, checked inside the transaction.
 */
export function normalizeTimezone(value: string): string {
  const zone = value.trim();
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(zone) || zone.length > 64) {
    throw new AuthError('VALIDATION_FAILED', 'timezone');
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
  } catch {
    throw new AuthError('VALIDATION_FAILED', 'timezone');
  }
  return zone;
}

/** `HH:MM` branch-local wall clock to minutes since midnight; `24:00` only to close. */
export function parseLocalTime(value: string, field: string, allowEndOfDay: boolean): number {
  if (allowEndOfDay && value === '24:00') return 1440;
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(value);
  if (!match) throw new AuthError('VALIDATION_FAILED', field);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatLocalTime(minutes: number | null): string | null {
  if (minutes === null) return null;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** One to seven distinct weekdays; a closed day carries no times, an open day both. */
export function normalizeOperatingDays(days: readonly BranchOperatingDay[]): OperatingDay[] {
  if (days.length === 0 || days.length > 7) throw new AuthError('VALIDATION_FAILED', 'days');
  const seen = new Set<number>();
  const result = days.map((day): OperatingDay => {
    if (!Number.isInteger(day.isoWeekday) || day.isoWeekday < 1 || day.isoWeekday > 7) {
      throw new AuthError('VALIDATION_FAILED', 'isoWeekday');
    }
    if (seen.has(day.isoWeekday)) throw new AuthError('VALIDATION_FAILED', 'days');
    seen.add(day.isoWeekday);
    if (day.isClosed) {
      if (day.opensAt != null || day.closesAt != null) {
        throw new AuthError('VALIDATION_FAILED', 'opensAt');
      }
      return {
        isoWeekday: day.isoWeekday,
        isClosed: true,
        opensAtMinute: null,
        closesAtMinute: null,
      };
    }
    if (day.opensAt == null || day.closesAt == null) {
      throw new AuthError('VALIDATION_FAILED', day.opensAt == null ? 'opensAt' : 'closesAt');
    }
    const opensAtMinute = parseLocalTime(day.opensAt, 'opensAt', false);
    const closesAtMinute = parseLocalTime(day.closesAt, 'closesAt', true);
    if (opensAtMinute >= closesAtMinute) throw new AuthError('VALIDATION_FAILED', 'closesAt');
    return { isoWeekday: day.isoWeekday, isClosed: false, opensAtMinute, closesAtMinute };
  });
  return result.sort((a, b) => a.isoWeekday - b.isoWeekday);
}
