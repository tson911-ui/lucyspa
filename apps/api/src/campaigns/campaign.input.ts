import {
  CAMPAIGN_MAX_ITEMS_PER_ADD,
  CAMPAIGN_RULE_KINDS,
  type CampaignFilter,
  type CampaignRule,
  type CampaignRuleKindName,
} from '@lucy-spa/contracts';
import { AuthError } from '../auth/auth.error.js';
import * as input from '../inventory/inventory.input.js';
import * as product from '../products/product-catalog.input.js';

/**
 * Phase 6 Wave 4 (P6-23): parsing of everything the campaign screens send. Every parser throws `VALIDATION_FAILED` with a safe field name
 * and touches nothing else; the decorators of the controller only keep the wrong types out.
 */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const PRESENTATION_FIELDS = [
  ['badgeVi', 24],
  ['badgeEn', 24],
  ['headlineVi', 120],
  ['headlineEn', 120],
  ['messageVi', 300],
  ['messageEn', 300],
  ['ctaLabelVi', 40],
  ['ctaLabelEn', 40],
] as const;

export function slug(value: unknown): string {
  if (typeof value !== 'string') throw new AuthError('VALIDATION_FAILED', 'slug');
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 60 || !SLUG.test(trimmed)) {
    throw new AuthError('VALIDATION_FAILED', 'slug');
  }
  return trimmed;
}

export function rule(value: unknown, field = 'rule'): CampaignRule {
  const body = input.record(value, field, ['kind', 'value']);
  const kind = body['kind'];
  if (typeof kind !== 'string' || !CAMPAIGN_RULE_KINDS.includes(kind as CampaignRuleKindName)) {
    throw new AuthError('VALIDATION_FAILED', `${field}.kind`);
  }
  const raw = body['value'];
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,9}$/.test(raw)) {
    throw new AuthError('VALIDATION_FAILED', `${field}.value`);
  }
  const amount = BigInt(raw);
  if (kind === 'PERCENT' && amount > 90n)
    throw new AuthError('VALIDATION_FAILED', `${field}.value`);
  if (amount > 1_000_000_000n) throw new AuthError('VALIDATION_FAILED', `${field}.value`);
  return { kind: kind as CampaignRuleKindName, value: raw };
}

export function variantIds(value: unknown, field = 'variantIds'): string[] {
  const list = input.list(value, field, CAMPAIGN_MAX_ITEMS_PER_ADD);
  if (list.length === 0) throw new AuthError('VALIDATION_FAILED', field);
  const ids = list.map((entry, index) => product.uuid(entry, `${field}.${index}`));
  if (new Set(ids).size !== ids.length) throw new AuthError('VALIDATION_FAILED', field);
  return ids;
}

export interface ParsedFilter {
  brandId: string | null;
  categoryId: string | null;
  q: string | null;
  minPriceVnd: bigint | null;
  maxPriceVnd: bigint | null;
  inStockOnly: boolean;
}

export function filter(value: unknown, field = 'filter'): ParsedFilter {
  const body = input.record(value ?? {}, field, [
    'brandId',
    'categoryId',
    'q',
    'minPriceVnd',
    'maxPriceVnd',
    'inStockOnly',
  ]) as Record<string, unknown> & CampaignFilter;
  const money = (raw: unknown, name: string): bigint | null => {
    if (raw === undefined || raw === null || raw === '') return null;
    return product.positiveMoney(raw, `${field}.${name}`);
  };
  const q = body['q'];
  if (q !== undefined && q !== null && (typeof q !== 'string' || q.length > 80)) {
    throw new AuthError('VALIDATION_FAILED', `${field}.q`);
  }
  const inStock = body['inStockOnly'];
  if (inStock !== undefined && typeof inStock !== 'boolean') {
    throw new AuthError('VALIDATION_FAILED', `${field}.inStockOnly`);
  }
  const min = money(body['minPriceVnd'], 'minPriceVnd');
  const max = money(body['maxPriceVnd'], 'maxPriceVnd');
  if (min !== null && max !== null && min > max) {
    throw new AuthError('VALIDATION_FAILED', `${field}.maxPriceVnd`);
  }
  return {
    brandId: product.optionalUuid(body['brandId'], `${field}.brandId`),
    categoryId: product.optionalUuid(body['categoryId'], `${field}.categoryId`),
    q: typeof q === 'string' && q.trim() !== '' ? q.trim() : null,
    minPriceVnd: min,
    maxPriceVnd: max,
    inStockOnly: inStock === true,
  };
}
