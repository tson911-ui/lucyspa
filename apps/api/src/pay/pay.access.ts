import { PAY_BACKDATE_DAYS, PAY_FUTURE_DAYS } from '@lucy-spa/contracts';
import { AuthError } from '../auth/auth.error.js';
import type { AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';

/**
 * Phase 7 Wave B: who may read and change pay configuration (design section 9). Rules (tour, commission) are shop-wide: changing them
 * needs `MANAGE_PAY_RULES` (GLOBAL); reading them is also open to the payroll permissions. Salaries follow the employee's branches
 * (`VIEW_EMPLOYEE_PAY` / `MANAGE_EMPLOYEE_PAY`) and the shop-wide payroll permissions. Always decided inside the command's transaction.
 */
const GLOBAL = { kind: 'GLOBAL' } as const;

export const canManageRules = (context: AdminContext): boolean =>
  decide(context.actor.graph, 'MANAGE_PAY_RULES', GLOBAL);

export const canReadRules = (context: AdminContext): boolean =>
  canManageRules(context) ||
  decide(context.actor.graph, 'MANAGE_PAYROLL', GLOBAL) ||
  decide(context.actor.graph, 'APPROVE_PAYROLL', GLOBAL);

export const holdsPayrollShopWide = (context: AdminContext): boolean =>
  decide(context.actor.graph, 'MANAGE_PAYROLL', GLOBAL) ||
  decide(context.actor.graph, 'APPROVE_PAYROLL', GLOBAL);

export function requireRead(context: AdminContext): boolean {
  if (!canReadRules(context)) throw new AuthError('FORBIDDEN');
  return canManageRules(context);
}

export function requireManage(context: AdminContext): void {
  if (!canManageRules(context)) throw new AuthError('FORBIDDEN');
}

/** The branch-local calendar day (all branches are in Vietnam; the shop's own clock). */
export function shopToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day inside the allowed window around today (a rule may start soon; nothing is dated years ago or ahead). */
export function effectiveDate(
  value: unknown,
  field: string,
  today: string,
  options: { future: boolean } = { future: true },
): string {
  if (typeof value !== 'string' || !DATE.test(value))
    throw new AuthError('VALIDATION_FAILED', field);
  if (new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  const earliest = addDays(today, -PAY_BACKDATE_DAYS);
  const latest = options.future ? addDays(today, PAY_FUTURE_DAYS) : today;
  if (value < earliest || value > latest) throw new AuthError('VALIDATION_FAILED', field);
  return value;
}
