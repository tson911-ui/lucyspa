import type {
  DiscountCreateRequest,
  DiscountDetailResponse,
  DiscountIneligibleReason,
  DiscountScopeName,
  DiscountStatusName,
  DiscountVersionInput,
  DiscountVersionRequest,
  DiscountVersionResponse,
  InvoiceDiscountCandidate,
} from '@lucy-spa/contracts';
import type { Locale } from '../../i18n/locales';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { ApiError } from './api';
import { formatVnd, isVndInput } from './format';
import { errorMessage } from './workflows';

/**
 * Discount programs and voucher codes (Phase 4 Step 6). Only the Owner-level configuration lives here; the
 * POS never types a percentage or an amount, it can only choose a configured code. Percentages are entered as
 * a decimal percent with at most two decimals and sent as integer basis points (no floating point); validity
 * instants are entered in Vietnam time (UTC+7, no daylight saving) and sent as ISO instants.
 */

export interface DiscountForm {
  code: string;
  nameVi: string;
  nameEn: string;
  requiresCode: boolean;
  kind: 'PERCENT' | 'FIXED_AMOUNT';
  /** A decimal percent such as "10" or "12.5". */
  percent: string;
  fixedAmount: string;
  /** `YYYY-MM-DDTHH:mm` (datetime-local), Vietnam time. */
  validFrom: string;
  validUntil: string;
  minSpend: string;
  /** What the program may discount (Phase 6 P6-11): services, products or both. */
  scope: DiscountScopeName;
  /** `ALL_SERVICES` = every item of the scope (the name is the contract's); `SELECTED` = only the chosen targets. */
  scopeMode: 'ALL_SERVICES' | 'SELECTED';
  serviceIds: string[];
  categoryIds: string[];
  brandIds: string[];
  productCategoryIds: string[];
  productIds: string[];
  limitTotal: string;
  limitPerCustomer: string;
}

export type DiscountProblem =
  'code' | 'name' | 'percent' | 'amount' | 'window' | 'minSpend' | 'scope' | 'limit';

export const emptyDiscountForm = (): DiscountForm => ({
  code: '',
  nameVi: '',
  nameEn: '',
  requiresCode: false,
  kind: 'PERCENT',
  percent: '',
  fixedAmount: '',
  validFrom: '',
  validUntil: '',
  minSpend: '0',
  scope: 'SERVICES',
  scopeMode: 'ALL_SERVICES',
  serviceIds: [],
  categoryIds: [],
  brandIds: [],
  productCategoryIds: [],
  productIds: [],
  limitTotal: '',
  limitPerCustomer: '',
});

/** Whether the scope reaches services / products. */
export const scopeHasServices = (scope: DiscountScopeName) => scope !== 'PRODUCTS';
export const scopeHasProducts = (scope: DiscountScopeName) => scope !== 'SERVICES';

/** "12.5" -> 1250 basis points; null when it is not a percent with at most two decimals in (0, 100]. */
export function percentToBp(text: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const bp = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  return bp >= 1 && bp <= 10_000 ? bp : null;
}

/** 1250 -> "12.5", 1000 -> "10". */
export function bpToPercent(bp: number): string {
  const whole = Math.floor(bp / 100);
  const fraction = String(bp % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

const VN_OFFSET_MS = 7 * 3_600_000;

/** A `datetime-local` value read as Vietnam time -> ISO instant (null when malformed). */
export function vnLocalToIso(text: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const utc = Date.UTC(y, mo - 1, d, h, mi) - VN_OFFSET_MS;
  const date = new Date(utc);
  const back = new Date(utc + VN_OFFSET_MS);
  if (
    Number.isNaN(date.getTime()) ||
    back.getUTCFullYear() !== y ||
    back.getUTCMonth() !== mo - 1 ||
    back.getUTCDate() !== d
  ) {
    return null;
  }
  return date.toISOString();
}

/** ISO instant -> `datetime-local` text in Vietnam time. */
export function isoToVnLocal(iso: string): string {
  const date = new Date(new Date(iso).getTime() + VN_OFFSET_MS);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 16);
}

/** Vietnam time shown for reading ("dd/mm/yyyy HH:mm" or ISO-like for English). */
export function formatVnInstant(iso: string, locale: Locale): string {
  const local = isoToVnLocal(iso);
  if (!local) return iso;
  const [date = '', time = ''] = local.split('T');
  const [y, m, d] = date.split('-');
  return locale === 'vi' ? `${d}/${m}/${y} ${time}` : `${date} ${time}`;
}

function limitOf(text: string): number | null | 'invalid' {
  const value = text.trim();
  if (!value) return null;
  if (!/^[1-9][0-9]{0,9}$/.test(value)) return 'invalid';
  const number = Number(value);
  return number <= 2_147_483_647 ? number : 'invalid';
}

/** The version configuration, or the first problem (the API validates everything again). */
export function versionInputOf(
  form: DiscountForm,
): { version: DiscountVersionInput } | { problem: DiscountProblem } {
  let percentBp: number | undefined;
  let fixedAmountVnd: string | undefined;
  if (form.kind === 'PERCENT') {
    const bp = percentToBp(form.percent);
    if (bp === null) return { problem: 'percent' };
    percentBp = bp;
  } else {
    const amount = form.fixedAmount.trim();
    if (!isVndInput(amount) || amount === '0') return { problem: 'amount' };
    fixedAmountVnd = amount;
  }
  const validFrom = vnLocalToIso(form.validFrom);
  const validUntil = vnLocalToIso(form.validUntil);
  if (!validFrom || !validUntil || validUntil <= validFrom) return { problem: 'window' };
  const minSpend = form.minSpend.trim() || '0';
  if (!isVndInput(minSpend)) return { problem: 'minSpend' };
  // Only the targets that fit the scope are kept and sent (the server refuses a target of the wrong kind, and a "selected"
  // program with nothing selected); switching the scope in the form therefore never leaves a stale choice behind.
  const selected = form.scopeMode === 'SELECTED';
  const services = selected && scopeHasServices(form.scope);
  const products = selected && scopeHasProducts(form.scope);
  const serviceIds = services ? form.serviceIds : [];
  const categoryIds = services ? form.categoryIds : [];
  const brandIds = products ? form.brandIds : [];
  const productCategoryIds = products ? form.productCategoryIds : [];
  const productIds = products ? form.productIds : [];
  if (
    selected &&
    serviceIds.length +
      categoryIds.length +
      brandIds.length +
      productCategoryIds.length +
      productIds.length ===
      0
  ) {
    return { problem: 'scope' };
  }
  const usageLimitTotal = limitOf(form.limitTotal);
  const usageLimitPerCustomer = limitOf(form.limitPerCustomer);
  if (usageLimitTotal === 'invalid' || usageLimitPerCustomer === 'invalid') {
    return { problem: 'limit' };
  }
  const version: DiscountVersionInput = {
    kind: form.kind,
    ...(percentBp === undefined ? {} : { percentBp }),
    ...(fixedAmountVnd === undefined ? {} : { fixedAmountVnd }),
    validFrom,
    validUntil,
    minSpendVnd: minSpend,
    scopeMode: form.scopeMode,
    serviceIds,
    categoryIds,
    // A services-only program sends exactly what it always did (the server reads a missing scope as SERVICES); any other scope is
    // stated with its product targets, so a new version never silently falls back to services only.
    ...(form.scope === 'SERVICES'
      ? {}
      : { scope: form.scope, brandIds, productCategoryIds, productIds }),
    usageLimitTotal,
    usageLimitPerCustomer,
  };
  return { version };
}

const PROGRAM_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

export function createRequestOf(
  form: DiscountForm,
): { body: DiscountCreateRequest } | { problem: DiscountProblem } {
  const code = form.code.trim().toUpperCase();
  if (!PROGRAM_CODE.test(code)) return { problem: 'code' };
  const nameVi = form.nameVi.normalize('NFC').trim();
  const nameEn = form.nameEn.normalize('NFC').trim();
  if (!nameVi || !nameEn) return { problem: 'name' };
  const version = versionInputOf(form);
  if ('problem' in version) return version;
  return {
    body: { code, nameVi, nameEn, requiresCode: form.requiresCode, version: version.version },
  };
}

export function versionRequestOf(
  form: DiscountForm,
  expectedVersion: number,
): { body: DiscountVersionRequest } | { problem: DiscountProblem } {
  const nameVi = form.nameVi.normalize('NFC').trim();
  const nameEn = form.nameEn.normalize('NFC').trim();
  if (!nameVi || !nameEn) return { problem: 'name' };
  const version = versionInputOf(form);
  if ('problem' in version) return version;
  return { body: { expectedVersion, nameVi, nameEn, version: version.version } };
}

/** The form prefilled from a program's current version (a new version starts from what is in force). */
export function formFromProgram(program: DiscountDetailResponse): DiscountForm {
  const current = program.current;
  return {
    code: program.code,
    nameVi: program.nameVi,
    nameEn: program.nameEn,
    requiresCode: program.requiresCode,
    kind: current.kind,
    percent: current.percentBp === null ? '' : bpToPercent(current.percentBp),
    fixedAmount: current.fixedAmountVnd ?? '',
    validFrom: isoToVnLocal(current.validFrom),
    validUntil: isoToVnLocal(current.validUntil),
    minSpend: current.minSpendVnd,
    scope: current.scope ?? 'SERVICES',
    scopeMode: current.scopeMode,
    serviceIds: [...current.serviceIds],
    categoryIds: [...current.categoryIds],
    brandIds: [...(current.brandIds ?? [])],
    productCategoryIds: [...(current.productCategoryIds ?? [])],
    productIds: [...(current.productIds ?? [])],
    limitTotal: current.usageLimitTotal === null ? '' : String(current.usageLimitTotal),
    limitPerCustomer:
      current.usageLimitPerCustomer === null ? '' : String(current.usageLimitPerCustomer),
  };
}

/** "10%" or "50.000 ₫": what a program version gives, in the reader's locale. */
export function benefitLabel(
  version: Pick<DiscountVersionResponse, 'kind' | 'percentBp' | 'fixedAmountVnd'>,
  locale: Locale,
): string {
  if (version.kind === 'PERCENT' && version.percentBp !== null) {
    const percent = bpToPercent(version.percentBp);
    return `${locale === 'vi' ? percent.replace('.', ',') : percent}%`;
  }
  return version.fixedAmountVnd === null ? '—' : formatVnd(version.fixedAmountVnd, locale);
}

export function candidateBenefitLabel(candidate: InvoiceDiscountCandidate, locale: Locale): string {
  return benefitLabel(candidate, locale);
}

export function statusTone(
  status: DiscountStatusName,
): 'success' | 'error' | 'info' | 'warning' | 'neutral' {
  switch (status) {
    case 'ACTIVE':
      return 'success';
    case 'SCHEDULED':
      return 'info';
    case 'PAUSED':
      return 'warning';
    case 'EXPIRED':
    case 'TERMINATED':
      return 'neutral';
  }
}

/** The localized reason a candidate is not eligible. */
export function ineligibleText(reason: DiscountIneligibleReason, t: WorkforceDictionary): string {
  return t.pos.ineligible[reason];
}

/** The reason a voucher code is required to be non-empty and short before it is sent. */
export function voucherCodeOf(text: string): string | null {
  const code = text.trim();
  return code && [...code].length <= 64 ? code : null;
}

/** Discount texts come first; everything else as elsewhere. */
export function discountErrorMessage(error: unknown, t: WorkforceDictionary): string {
  const texts = t.discounts.errors as Record<string, string>;
  if (error instanceof ApiError && error.code in texts) return texts[error.code] as string;
  return errorMessage(error, t);
}
