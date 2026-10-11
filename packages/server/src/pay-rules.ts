/**
 * Phase 7 P7-8/P7-9 (design PHASE7_PAYROLL_FUNDS.md 4.2): which pay rule is in force for a service, a product line or a person on a
 * date. Rules are append-only, effective-dated rows; the row in force on a date is the latest one with `effectiveFrom <= date`. The
 * functions here are pure (they take the rows) so the order of preference is tested without a database; `loadCommissionRules` and
 * friends in the callers fetch the rows.
 */
export type CommissionScopeName = 'SHOP' | 'BRAND' | 'CATEGORY' | 'PRODUCT';
export type CommissionKindName = 'PERCENT' | 'FIXED_PER_UNIT';

export interface CommissionRuleRow {
  id: string;
  scope: CommissionScopeName;
  brandId: string | null;
  categoryId: string | null;
  productId: string | null;
  employeeUserId: string | null;
  kind: CommissionKindName;
  /** Basis points for PERCENT (0..10000); whole dong per unit for FIXED_PER_UNIT. */
  value: bigint;
  /** `YYYY-MM-DD`. */
  effectiveFrom: string;
}

export interface CommissionContext {
  employeeUserId: string;
  productId: string;
  categoryId: string | null;
  brandId: string | null;
}

/**
 * The most specific rule in force wins (a rule of value 0 is a real rule that pays nothing and stops the search):
 * employee+product, product, employee+category, category, employee+brand, brand, employee default, shop default.
 */
export function pickCommissionRule(
  rules: readonly CommissionRuleRow[],
  context: CommissionContext,
  date: string,
): CommissionRuleRow | null {
  const inForce = rules.filter((rule) => rule.effectiveFrom <= date);
  const latest = (match: (rule: CommissionRuleRow) => boolean): CommissionRuleRow | null => {
    let best: CommissionRuleRow | null = null;
    for (const rule of inForce) {
      if (!match(rule)) continue;
      if (best === null || rule.effectiveFrom > best.effectiveFrom) best = rule;
    }
    return best;
  };
  const mine = (rule: CommissionRuleRow) => rule.employeeUserId === context.employeeUserId;
  const anyone = (rule: CommissionRuleRow) => rule.employeeUserId === null;
  const steps: Array<(rule: CommissionRuleRow) => boolean> = [
    (r) => r.scope === 'PRODUCT' && r.productId === context.productId && mine(r),
    (r) => r.scope === 'PRODUCT' && r.productId === context.productId && anyone(r),
    (r) =>
      context.categoryId !== null &&
      r.scope === 'CATEGORY' &&
      r.categoryId === context.categoryId &&
      mine(r),
    (r) =>
      context.categoryId !== null &&
      r.scope === 'CATEGORY' &&
      r.categoryId === context.categoryId &&
      anyone(r),
    (r) =>
      context.brandId !== null && r.scope === 'BRAND' && r.brandId === context.brandId && mine(r),
    (r) =>
      context.brandId !== null && r.scope === 'BRAND' && r.brandId === context.brandId && anyone(r),
    (r) => r.scope === 'SHOP' && mine(r),
    (r) => r.scope === 'SHOP' && anyone(r),
  ];
  for (const step of steps) {
    const found = latest(step);
    if (found) return found;
  }
  return null;
}

/**
 * The commission of one product line (PRD 26; P7-T6). PERCENT: basis points of the line's net, half up to 1 dong (Phase 4 Q3);
 * FIXED_PER_UNIT: the amount times the units sold. Never negative.
 */
export function commissionAmount(
  rule: Pick<CommissionRuleRow, 'kind' | 'value'>,
  netVnd: bigint,
  quantity: number,
): bigint {
  if (netVnd < 0n || !Number.isSafeInteger(quantity) || quantity < 0) return 0n;
  if (rule.kind === 'FIXED_PER_UNIT') return rule.value * BigInt(quantity);
  return (netVnd * rule.value + 5_000n) / 10_000n;
}

/**
 * The commission reversed by a refund of `unitsNow` units out of `unitsSold`, cumulative so many partial refunds never exceed the
 * original and the last one returns exactly what is left: `floor`-style rounding is avoided by taking the difference of two
 * cumulative, half-up rounded shares.
 */
export function proportionalShare(
  total: bigint,
  unitsBefore: number,
  unitsNow: number,
  unitsSold: number,
): bigint {
  if (unitsSold <= 0 || unitsNow <= 0) return 0n;
  const cumulative = (units: number): bigint =>
    (total * BigInt(Math.min(units, unitsSold)) * 2n + BigInt(unitsSold)) /
    (BigInt(unitsSold) * 2n);
  return cumulative(unitsBefore + unitsNow) - cumulative(unitsBefore);
}

export interface TourRuleRow {
  id: string;
  serviceId: string;
  amountVnd: bigint;
  effectiveFrom: string;
}

/** The tour rule of a service in force on a date, or null (no rule: no tour and the line is listed as "no rule"). */
export function pickTourRule(
  rules: readonly TourRuleRow[],
  serviceId: string,
  date: string,
): TourRuleRow | null {
  let best: TourRuleRow | null = null;
  for (const rule of rules) {
    if (rule.serviceId !== serviceId || rule.effectiveFrom > date) continue;
    if (best === null || rule.effectiveFrom > best.effectiveFrom) best = rule;
  }
  return best;
}

export interface SalaryVersionRow {
  employeeUserId: string;
  amountVnd: bigint | null;
  effectiveFrom: string;
}

/** The salary version in force on a date (its amount may be null: "no salary from then"), or null when none is recorded yet. */
export function pickSalaryVersion(
  versions: readonly SalaryVersionRow[],
  employeeUserId: string,
  date: string,
): SalaryVersionRow | null {
  let best: SalaryVersionRow | null = null;
  for (const version of versions) {
    if (version.employeeUserId !== employeeUserId || version.effectiveFrom > date) continue;
    if (best === null || version.effectiveFrom > best.effectiveFrom) best = version;
  }
  return best;
}
