import {
  campaignRulePrice,
  CAMPAIGN_MAX_ITEMS_PER_ADD,
  CAMPAIGN_STATES,
  type CampaignCreateRequest,
  type CampaignDetailResponse,
  type CampaignEditRequest,
  type CampaignFilter,
  type CampaignGroupRequest,
  type CampaignGroupResponse,
  type CampaignItemRow,
  type CampaignPresentation,
  type CampaignRule,
  type CampaignRuleKindName,
  type CampaignState,
} from '@lucy-spa/contracts';
import { campaignDictionary } from '../../i18n/campaigns';
import type { Locale } from '../../i18n/locales';
import { fill } from '../../i18n/workforce';
import { ApiError, type Query } from './api';
import { isoToVnLocal, vnLocalToIso } from './discounts';
import { formatDateTime, formatVnd } from './format';
import { normalizePage } from './list-view';

/**
 * Phase 6 Wave 4 / P6-23: the pure part of the campaign screens (list and page state in the address bar, requests, validation,
 * rule texts and price previews, error texts). The API checks everything again; these limits mirror `campaign.core.ts` and
 * `campaign.input.ts` because the contracts package does not export them. Pages are always 20 rows on the server.
 */

export const CAMPAIGN_ZONE = 'Asia/Ho_Chi_Minh';
export const CAMPAIGN_ADD_LIMIT = CAMPAIGN_MAX_ITEMS_PER_ADD;

export const CAMPAIGN_LIMITS = Object.freeze({
  slugMin: 3,
  slugMax: 60,
  nameMax: 200,
  noteMax: 2000,
  reasonMax: 2000,
  percentMax: 90,
  moneyMax: 1_000_000_000,
});

/** Longest text of each presentation field (the API's `PRESENTATION_FIELDS`). */
export const PRESENTATION_LIMITS = Object.freeze({
  badgeVi: 24,
  badgeEn: 24,
  headlineVi: 120,
  headlineEn: 120,
  messageVi: 300,
  messageEn: 300,
  ctaLabelVi: 40,
  ctaLabelEn: 40,
});
export type PresentationTextField = keyof typeof PRESENTATION_LIMITS;
export const PRESENTATION_TEXT_FIELDS = Object.keys(PRESENTATION_LIMITS) as PresentationTextField[];

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const length = (text: string): number => [...text.trim()].length;

// ------------------------------------------------------------------------------------------------ address name

/** "Đồng giá mùa hè" -> "dong-gia-mua-he". The Vietnamese đ has no accent form, so it is mapped by hand. */
export function suggestSlug(name: string): string {
  const base = name
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.slice(0, CAMPAIGN_LIMITS.slugMax).replace(/-+$/, '');
}

export function isValidSlug(slug: string): boolean {
  const text = slug.trim();
  return (
    text.length >= CAMPAIGN_LIMITS.slugMin &&
    text.length <= CAMPAIGN_LIMITS.slugMax &&
    SLUG_PATTERN.test(text)
  );
}

/** The public sale page of a campaign (a path, for display). */
export const campaignPath = (slug: string, locale: Locale): string =>
  `/${locale}/products?campaign=${slug}`;

// ----------------------------------------------------------------------------------------------- state and tones

export type CampaignTone = 'success' | 'info' | 'warning' | 'neutral' | 'error';

export function campaignTone(state: CampaignState): CampaignTone {
  switch (state) {
    case 'ACTIVE':
      return 'success';
    case 'SCHEDULED':
      return 'info';
    default:
      return 'neutral';
  }
}

export const campaignName = (
  campaign: { nameVi: string; nameEn: string },
  locale: Locale,
): string => (locale === 'vi' ? campaign.nameVi : campaign.nameEn);

/** "dd/mm/yyyy HH:mm to dd/mm/yyyy HH:mm" in Vietnam time. */
export function campaignWindow(
  campaign: { startsAt: string; endsAt: string },
  locale: Locale,
): string {
  return fill(campaignDictionary(locale).detail.window, {
    from: formatDateTime(campaign.startsAt, CAMPAIGN_ZONE, locale),
    to: formatDateTime(campaign.endsAt, CAMPAIGN_ZONE, locale),
  });
}

/** The period by day only ("09/10/2026 đến 11/10/2026", Vietnam time), short enough for a table column. */
export function campaignDays(
  campaign: { startsAt: string; endsAt: string },
  locale: Locale,
): string {
  const day = (iso: string) => {
    const [y = '', m = '', d = ''] = isoToVnLocal(iso).slice(0, 10).split('-');
    return locale === 'vi' ? `${d}/${m}/${y}` : `${y}-${m}-${d}`;
  };
  return fill(campaignDictionary(locale).detail.window, {
    from: day(campaign.startsAt),
    to: day(campaign.endsAt),
  });
}

// --------------------------------------------------------------------------------------------------- list state

export const CAMPAIGN_LIST_DEFAULTS = { q: '', state: '', page: 1 };
export type CampaignListState = typeof CAMPAIGN_LIST_DEFAULTS;
/** A page number returns to 1 when the search or the state filter changes. */
export const CAMPAIGN_LIST_PAGE_KEYS: readonly string[] = ['page'];

export function normalizeCampaignList(state: CampaignListState): CampaignListState {
  return {
    q: state.q.slice(0, 80),
    state: (CAMPAIGN_STATES as readonly string[]).includes(state.state) ? state.state : '',
    page: normalizePage(state.page),
  };
}

export function campaignListQuery(state: CampaignListState): Query {
  const query: Query = { page: state.page };
  if (state.q.trim() !== '') query['q'] = state.q.trim();
  if (state.state !== '') query['state'] = state.state;
  return query;
}

// ------------------------------------------------------------------------------------------------ page state

export const CAMPAIGN_TAB_IDS = ['items', 'picker', 'display', 'info'] as const;
export type CampaignTabId = (typeof CAMPAIGN_TAB_IDS)[number];
export const CAMPAIGN_PROBLEMS = ['NO_DISCOUNT', 'OVERLAP', 'OWN_PROMOTION'] as const;
export type CampaignProblem = (typeof CAMPAIGN_PROBLEMS)[number];

/** Everything the campaign page keeps in the address bar: the tab, and the filters and page of the two product lists. */
export const CAMPAIGN_DETAIL_DEFAULTS = {
  tab: '',
  ipage: 1,
  iq: '',
  group: '',
  problem: '',
  ppage: 1,
  pq: '',
  brand: '',
  category: '',
  min: '',
  max: '',
  stock: '',
};
export type CampaignDetailState = typeof CAMPAIGN_DETAIL_DEFAULTS;
export const CAMPAIGN_DETAIL_PAGE_KEYS: readonly string[] = ['ipage', 'ppage'];

/** Digits only, no leading zeros, at most ten digits (a price bound); empty when nothing usable is left. */
export function moneyBound(text: string): string {
  return text.replace(/\D/g, '').replace(/^0+/, '').slice(0, 10);
}

export function normalizeCampaignDetail(state: CampaignDetailState): CampaignDetailState {
  return {
    tab: (CAMPAIGN_TAB_IDS as readonly string[]).includes(state.tab) ? state.tab : '',
    ipage: normalizePage(state.ipage),
    iq: state.iq.slice(0, 80),
    group: state.group.slice(0, 64),
    problem: (CAMPAIGN_PROBLEMS as readonly string[]).includes(state.problem) ? state.problem : '',
    ppage: normalizePage(state.ppage),
    pq: state.pq.slice(0, 80),
    brand: state.brand.slice(0, 64),
    category: state.category.slice(0, 64),
    min: moneyBound(state.min),
    max: moneyBound(state.max),
    stock: state.stock === '1' ? '1' : '',
  };
}

/** The tab to show: the one in the address, else the products tab; a tab the campaign does not offer falls back to it. */
export function activeTab(state: CampaignDetailState, editable: boolean): CampaignTabId {
  const tab = (CAMPAIGN_TAB_IDS as readonly string[]).includes(state.tab)
    ? (state.tab as CampaignTabId)
    : 'items';
  return tab === 'picker' && !editable ? 'items' : tab;
}

export function itemsQuery(state: CampaignDetailState): Query {
  const query: Query = { page: state.ipage };
  if (state.iq.trim() !== '') query['q'] = state.iq.trim();
  if (state.group !== '') query['groupId'] = state.group;
  if (state.problem !== '') query['problem'] = state.problem;
  return query;
}

/** The picker's read: strings only, empty filters left out (the API reads `inStockOnly` as the text "true"). */
export function pickerQuery(state: CampaignDetailState): Query {
  const query: Query = { page: state.ppage };
  if (state.pq.trim() !== '') query['q'] = state.pq.trim();
  if (state.brand !== '') query['brandId'] = state.brand;
  if (state.category !== '') query['categoryId'] = state.category;
  if (state.min !== '') query['minPriceVnd'] = state.min;
  if (state.max !== '') query['maxPriceVnd'] = state.max;
  if (state.stock === '1') query['inStockOnly'] = 'true';
  return query;
}

/** The same filter as the body of "add all filtered results": typed, empty parts omitted, `inStockOnly` a real boolean. */
export function pickerFilter(state: CampaignDetailState): CampaignFilter {
  const filter: CampaignFilter = {};
  if (state.pq.trim() !== '') filter.q = state.pq.trim();
  if (state.brand !== '') filter.brandId = state.brand;
  if (state.category !== '') filter.categoryId = state.category;
  if (state.min !== '') filter.minPriceVnd = state.min;
  if (state.max !== '') filter.maxPriceVnd = state.max;
  if (state.stock === '1') filter.inStockOnly = true;
  return filter;
}

/** The lowest price is above the highest: the API refuses it, so the screen does not ask. */
export function priceRangeInvalid(state: Pick<CampaignDetailState, 'min' | 'max'>): boolean {
  return state.min !== '' && state.max !== '' && BigInt(state.min) > BigInt(state.max);
}

export function pickerFilterCount(state: CampaignDetailState): number {
  return (
    (state.pq.trim() ? 1 : 0) +
    (state.brand ? 1 : 0) +
    (state.category ? 1 : 0) +
    (state.min ? 1 : 0) +
    (state.max ? 1 : 0) +
    (state.stock ? 1 : 0)
  );
}

export function itemsFilterCount(state: CampaignDetailState): number {
  return (state.iq.trim() ? 1 : 0) + (state.group ? 1 : 0) + (state.problem ? 1 : 0);
}

// --------------------------------------------------------------------------------------------------- groups

/** Groups are shown as "Nhóm 1", "Nhóm 2"…: consecutive by order, whatever the stored positions are. */
export function groupNumbers(groups: readonly CampaignGroupResponse[]): Map<string, number> {
  return new Map(
    [...groups]
      .sort((a, b) => a.position - b.position)
      .map((group, index) => [group.id, index + 1]),
  );
}

export interface RuleDraft {
  kind: CampaignRuleKindName;
  value: string;
}

export const EMPTY_RULE_DRAFT: RuleDraft = { kind: 'PERCENT', value: '' };

export const ruleDraftOf = (rule: CampaignRule): RuleDraft => ({
  kind: rule.kind,
  value: rule.value,
});

export const ruleRange = (kind: CampaignRuleKindName): { min: number; max: number } => ({
  min: 1,
  max: kind === 'PERCENT' ? CAMPAIGN_LIMITS.percentMax : CAMPAIGN_LIMITS.moneyMax,
});

/** A rule value is a whole number in range: 1-90 percent, or 1 to 1,000,000,000 dong. */
export function ruleValueValid(draft: RuleDraft): boolean {
  if (!/^[1-9][0-9]{0,9}$/.test(draft.value)) return false;
  const { min, max } = ruleRange(draft.kind);
  const value = Number(draft.value);
  return value >= min && value <= max;
}

export function groupRequest(draft: RuleDraft, expectedVersion: number): CampaignGroupRequest {
  return { expectedVersion, rule: { kind: draft.kind, value: draft.value } };
}

/** "Giảm 20%", "Giảm 30.000 ₫", "Đồng giá 99.000 ₫". */
export function ruleText(rule: CampaignRule, locale: Locale): string {
  const texts = campaignDictionary(locale).groups.ruleLabels;
  return fill(texts[rule.kind], {
    value: rule.kind === 'PERCENT' ? rule.value : formatVnd(rule.value, locale),
  });
}

/** The price a rule gives for a list price, as digits; null when it gives no discount (or the rule is not valid yet). */
export function rulePreviewPrice(rule: RuleDraft, listPriceVnd: string): string | null {
  if (!ruleValueValid(rule)) return null;
  const price = campaignRulePrice({ kind: rule.kind, value: rule.value }, BigInt(listPriceVnd));
  return price === null ? null : price.toString();
}

/** The example list price the rule form uses ("giá 500.000 ₫"). */
export const RULE_EXAMPLE_LIST_VND = '500000';

// ---------------------------------------------------------------------------------------------------- items

export function itemProblems(row: CampaignItemRow): CampaignProblem[] {
  const problems: CampaignProblem[] = [];
  if (row.campaignPriceVnd === null) problems.push('NO_DISCOUNT');
  if (row.otherCampaigns.length > 0) problems.push('OVERLAP');
  if (row.hasOwnPromotion) problems.push('OWN_PROMOTION');
  return problems;
}

export const productLine = (row: { productName: string; variantLabel: string | null }): string =>
  row.variantLabel ? `${row.productName} · ${row.variantLabel}` : row.productName;

export function discountText(percent: number | null): string {
  return percent === null ? '—' : `${percent}%`;
}

// ------------------------------------------------------------------------------------------------- selection

/** Toggles one product in a selection kept across pages; the selection never goes past what one add can take. */
export function toggleSelected(
  ids: readonly string[],
  id: string,
  max: number = CAMPAIGN_ADD_LIMIT,
): string[] {
  if (ids.includes(id)) return ids.filter((entry) => entry !== id);
  return ids.length >= max ? [...ids] : [...ids, id];
}

export function selectAll(
  ids: readonly string[],
  pageIds: readonly string[],
  max: number = CAMPAIGN_ADD_LIMIT,
): string[] {
  return [...new Set([...ids, ...pageIds])].slice(0, max);
}

// --------------------------------------------------------------------------------------------------- create

export interface CampaignCreateDraft {
  slug: string;
  /** Once the person types in the address field it stops following the name. */
  slugTouched: boolean;
  nameVi: string;
  nameEn: string;
  startsAt: string;
  endsAt: string;
  note: string;
}

/** A new campaign starts tomorrow 08:00 and ends a week later at 23:59 (Vietnam time). */
export function emptyCreateDraft(now: Date = new Date()): CampaignCreateDraft {
  const day = (offset: number) =>
    isoToVnLocal(new Date(now.getTime() + offset * 86_400_000).toISOString()).slice(0, 10);
  return {
    slug: '',
    slugTouched: false,
    nameVi: '',
    nameEn: '',
    startsAt: `${day(1)}T08:00`,
    endsAt: `${day(8)}T23:59`,
    note: '',
  };
}

export type CampaignProblemKey =
  | 'slug'
  | 'nameVi'
  | 'nameEn'
  | 'startsAt'
  | 'startsPast'
  | 'endsAt'
  | 'endsBefore'
  | 'endsPast'
  | 'note';
export type CampaignFormField = 'slug' | 'nameVi' | 'nameEn' | 'startsAt' | 'endsAt' | 'note';
export type CampaignFormProblems = Partial<Record<CampaignFormField, CampaignProblemKey>>;

interface FormValues {
  slug: string;
  nameVi: string;
  nameEn: string;
  startsAt: string;
  endsAt: string;
  note: string;
}

function problemsOf(
  draft: FormValues,
  now: Date,
  fields: readonly CampaignFormField[],
): CampaignFormProblems {
  const problems: CampaignFormProblems = {};
  const has = (field: CampaignFormField) => fields.includes(field);
  if (has('slug') && !isValidSlug(draft.slug)) problems.slug = 'slug';
  if (has('nameVi') && (length(draft.nameVi) < 1 || length(draft.nameVi) > CAMPAIGN_LIMITS.nameMax))
    problems.nameVi = 'nameVi';
  if (has('nameEn') && (length(draft.nameEn) < 1 || length(draft.nameEn) > CAMPAIGN_LIMITS.nameMax))
    problems.nameEn = 'nameEn';
  if (has('note') && length(draft.note) > CAMPAIGN_LIMITS.noteMax) problems.note = 'note';
  const starts = vnLocalToIso(draft.startsAt);
  const ends = vnLocalToIso(draft.endsAt);
  if (has('startsAt')) {
    if (starts === null) problems.startsAt = 'startsAt';
    else if (new Date(starts) <= now) problems.startsAt = 'startsPast';
  }
  if (has('endsAt')) {
    if (ends === null) problems.endsAt = 'endsAt';
    else if (starts !== null && new Date(ends) <= new Date(starts)) problems.endsAt = 'endsBefore';
    else if (new Date(ends) <= now) problems.endsAt = 'endsPast';
  }
  return problems;
}

const ALL_FIELDS: readonly CampaignFormField[] = [
  'slug',
  'nameVi',
  'nameEn',
  'startsAt',
  'endsAt',
  'note',
];

export function validateCreate(
  draft: CampaignCreateDraft,
  now: Date = new Date(),
): CampaignFormProblems {
  return problemsOf(draft, now, ALL_FIELDS);
}

/** The first invalid field in form order, to focus it. */
export function firstProblemField(problems: CampaignFormProblems): CampaignFormField | null {
  return ALL_FIELDS.find((field) => problems[field] !== undefined) ?? null;
}

export function createRequest(
  draft: CampaignCreateDraft,
  now: Date = new Date(),
): CampaignCreateRequest | null {
  if (Object.keys(validateCreate(draft, now)).length > 0) return null;
  const note = draft.note.trim();
  return {
    slug: draft.slug.trim(),
    nameVi: draft.nameVi.trim(),
    nameEn: draft.nameEn.trim(),
    internalNote: note === '' ? null : note,
    startsAt: vnLocalToIso(draft.startsAt) as string,
    endsAt: vnLocalToIso(draft.endsAt) as string,
  };
}

/** A name typed into the form: the address follows it until the person edits the address. */
export function withName(
  draft: CampaignCreateDraft,
  patch: Partial<Pick<CampaignCreateDraft, 'nameVi' | 'nameEn'>>,
): CampaignCreateDraft {
  const next = { ...draft, ...patch };
  return next.slugTouched || patch.nameVi === undefined
    ? next
    : { ...next, slug: suggestSlug(next.nameVi) };
}

// ------------------------------------------------------------------------------------------------ info (draft)

export interface CampaignInfoDraft {
  slug: string;
  nameVi: string;
  nameEn: string;
  startsAt: string;
  endsAt: string;
  note: string;
}

export const infoDraftOf = (campaign: CampaignDetailResponse): CampaignInfoDraft => ({
  slug: campaign.slug,
  nameVi: campaign.nameVi,
  nameEn: campaign.nameEn,
  startsAt: isoToVnLocal(campaign.startsAt),
  endsAt: isoToVnLocal(campaign.endsAt),
  note: campaign.internalNote ?? '',
});

export function validateInfo(
  draft: CampaignInfoDraft,
  initial: CampaignInfoDraft,
  now: Date = new Date(),
): CampaignFormProblems {
  // The start may stay in the past of an old draft only until it is published (the publish says so); a changed one must be future.
  const fields = ALL_FIELDS.filter(
    (field) => field !== 'startsAt' || draft.startsAt !== initial.startsAt,
  );
  const problems = problemsOf(draft, now, fields);
  // An unchanged end is not checked against now (the API checks it only when it is sent).
  if (draft.endsAt === initial.endsAt && problems.endsAt === 'endsPast') delete problems.endsAt;
  return problems;
}

/** Only the changed keys: the API refuses a draft-only key on a published campaign, and an empty edit. Null: nothing changed. */
export function infoEditRequest(
  draft: CampaignInfoDraft,
  campaign: CampaignDetailResponse,
): CampaignEditRequest | null {
  const initial = infoDraftOf(campaign);
  const request: CampaignEditRequest = { expectedVersion: campaign.rowVersion };
  let changed = false;
  if (draft.slug.trim() !== initial.slug) {
    request.slug = draft.slug.trim();
    changed = true;
  }
  if (draft.nameVi.trim() !== initial.nameVi) {
    request.nameVi = draft.nameVi.trim();
    changed = true;
  }
  if (draft.nameEn.trim() !== initial.nameEn) {
    request.nameEn = draft.nameEn.trim();
    changed = true;
  }
  if (draft.startsAt !== initial.startsAt) {
    request.startsAt = vnLocalToIso(draft.startsAt) as string;
    changed = true;
  }
  if (draft.endsAt !== initial.endsAt) {
    request.endsAt = vnLocalToIso(draft.endsAt) as string;
    changed = true;
  }
  if (draft.note.trim() !== initial.note.trim()) {
    request.internalNote = draft.note.trim() === '' ? null : draft.note.trim();
    changed = true;
  }
  return changed ? request : null;
}

// ----------------------------------------------------------------------------------------- presentation

export interface PresentationDraft {
  badgeVi: string;
  badgeEn: string;
  headlineVi: string;
  headlineEn: string;
  messageVi: string;
  messageEn: string;
  ctaLabelVi: string;
  ctaLabelEn: string;
  bannerMediaId: string | null;
}

export const presentationDraftOf = (campaign: CampaignPresentation): PresentationDraft => ({
  badgeVi: campaign.badgeVi ?? '',
  badgeEn: campaign.badgeEn ?? '',
  headlineVi: campaign.headlineVi ?? '',
  headlineEn: campaign.headlineEn ?? '',
  messageVi: campaign.messageVi ?? '',
  messageEn: campaign.messageEn ?? '',
  ctaLabelVi: campaign.ctaLabelVi ?? '',
  ctaLabelEn: campaign.ctaLabelEn ?? '',
  bannerMediaId: campaign.bannerMediaId,
});

/** The fields whose text is longer than the API takes. */
export function presentationProblems(draft: PresentationDraft): PresentationTextField[] {
  return PRESENTATION_TEXT_FIELDS.filter(
    (field) => length(draft[field]) > PRESENTATION_LIMITS[field],
  );
}

export function presentationEditRequest(
  draft: PresentationDraft,
  campaign: CampaignDetailResponse,
): CampaignEditRequest | null {
  if (presentationProblems(draft).length > 0) return null;
  const request: CampaignEditRequest = { expectedVersion: campaign.rowVersion };
  let changed = false;
  for (const field of PRESENTATION_TEXT_FIELDS) {
    const next = draft[field].trim() === '' ? null : draft[field].trim();
    if (next !== campaign[field]) {
      request[field] = next;
      changed = true;
    }
  }
  if (draft.bannerMediaId !== campaign.bannerMediaId) {
    request.bannerMediaId = draft.bannerMediaId;
    changed = true;
  }
  return changed ? request : null;
}

/** The badge a customer sees on a product: the campaign's own text, else the discount percent. */
export function badgePreview(
  campaign: Pick<CampaignPresentation, 'badgeVi' | 'badgeEn'>,
  locale: Locale,
): string | null {
  const text = locale === 'vi' ? campaign.badgeVi : campaign.badgeEn;
  return text && text.trim() !== '' ? text : null;
}

// ---------------------------------------------------------------------------------------------------- review

export type PublishBlocker = 'CAMPAIGN_EMPTY' | 'CAMPAIGN_NO_DISCOUNT' | 'CAMPAIGN_START_PASSED';

/** What stops a draft from being published right now (the API stops it too): the first reason, else null. */
export function publishBlocker(
  campaign: Pick<CampaignDetailResponse, 'startsAt' | 'review' | 'can'>,
  now: Date = new Date(),
): PublishBlocker | null {
  if (!campaign.can.publish) return null;
  if (new Date(campaign.startsAt) < now) return 'CAMPAIGN_START_PASSED';
  if (campaign.review.itemCount === 0) return 'CAMPAIGN_EMPTY';
  if (campaign.review.noDiscountCount === campaign.review.itemCount) return 'CAMPAIGN_NO_DISCOUNT';
  return null;
}

export function rangeText(
  review: Pick<CampaignDetailResponse['review'], 'minPercent' | 'maxPercent'>,
  locale: Locale,
): string {
  const texts = campaignDictionary(locale).review;
  if (review.minPercent === null || review.maxPercent === null) return '—';
  return review.minPercent === review.maxPercent
    ? fill(texts.rangeSame, { value: review.minPercent })
    : fill(texts.rangeValue, { min: review.minPercent, max: review.maxPercent });
}

// ---------------------------------------------------------------------------------------------------- errors

/** A stale version: someone else saved first. The screen asks to reload instead of reloading silently. */
export const isStaleVersion = (error: unknown): boolean =>
  error instanceof ApiError && error.code === 'CONFLICT' && error.field === null;

/** The form field an error names (a taken address, a bad end time), when the form has it. */
export function campaignErrorField(error: unknown): CampaignFormField | null {
  if (!(error instanceof ApiError) || error.field === null) return null;
  return (ALL_FIELDS as readonly string[]).includes(error.field)
    ? (error.field as CampaignFormField)
    : null;
}

/** The text of a failed campaign command: the campaign codes first, then the shared texts. */
export function campaignErrorText(
  error: unknown,
  locale: Locale,
  fallback: (error: unknown) => string,
): string {
  if (error instanceof ApiError) {
    const texts = campaignDictionary(locale).errors as Record<string, string>;
    if (error.code in texts) return texts[error.code] as string;
    if (error.code === 'VALIDATION_FAILED' && error.field !== null) {
      if (error.field === 'slug') return campaignDictionary(locale).problems.slug;
      if (error.field in texts) return texts[error.field] as string;
    }
  }
  return fallback(error);
}
