import { addDays, type DateRange } from '@lucy-spa/ui';

/**
 * Phase 8 P8-14: the logic behind the audit-log screen, apart from the markup. The period and the action code live in the address, so a view of the
 * log can be shared; a value that does not parse falls back to "the last 30 days, every action" instead of failing.
 */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACTION = /^[A-Z][A-Z0-9_]{0,63}$/;

export type AuditState = {
  /** Empty = the last 30 days. */
  from: string;
  to: string;
  /** Empty = every action; otherwise one exact action code. */
  action: string;
};

export const AUDIT_DEFAULTS: AuditState = { from: '', to: '', action: '' };

export function normalizeAudit(state: AuditState): AuditState {
  const from = DATE.test(state.from) ? state.from : '';
  const to = DATE.test(state.to) ? state.to : '';
  const ordered = from !== '' && to !== '' && to >= from;
  return {
    from: ordered ? from : '',
    to: ordered ? to : '',
    action: ACTION.test(state.action) ? state.action : '',
  };
}

/** The API's query: days become instants at the shop's time zone (the end is the start of the next day, as the API reads `to` as "before"). */
export function auditQuery(
  range: DateRange,
  action: string,
  cursor: string | null,
  zone: string,
  zoned: (local: string, zone: string) => string | null,
): Record<string, string | number | undefined> {
  return {
    limit: 100,
    from: zoned(`${range.from}T00:00`, zone) ?? undefined,
    to: zoned(`${addDays(range.to, 1)}T00:00`, zone) ?? undefined,
    action: action === '' ? undefined : action,
    cursor: cursor ?? undefined,
  };
}
