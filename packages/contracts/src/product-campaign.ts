// ---------------------------------------------------------------------------------------------------------------
// Phase 6 Wave 4 / P6-23: promotion campaigns (PRD 24.1; design 2.39). A campaign gives a group of variants a temporary price from a
// rule, without ever editing a base price. Money is integer VND carried as a decimal string. The admin side needs MANAGE_PRODUCT_PRICES
// (design 3.3); the public side is anonymous and read-only and shows only ACTIVE campaigns.
// ---------------------------------------------------------------------------------------------------------------

export const CAMPAIGN_RULE_KINDS = ['PERCENT', 'AMOUNT', 'PRICE'] as const;
export type CampaignRuleKindName = (typeof CAMPAIGN_RULE_KINDS)[number];
/** DRAFT is not published; SCHEDULED is published and not started; ACTIVE runs now; ENDED is over or was ended by hand. */
export type CampaignState = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'ENDED';
export const CAMPAIGN_PAGE_SIZE = 20;
export const CAMPAIGN_ITEMS_PAGE_SIZE = 20;
export const CAMPAIGN_MAX_ITEMS_PER_ADD = 2000;
export const CAMPAIGN_MAX_GROUPS = 10;
export const CAMPAIGN_STATES = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'ENDED'] as const;

/** The rule as typed: PERCENT is a whole percent (1-90), AMOUNT and PRICE are whole VND. */
export interface CampaignRule {
  kind: CampaignRuleKindName;
  value: string;
}

/**
 * The price a rule gives from a list price: the discount of a percent is rounded DOWN to a whole VND (the price is never below what the
 * percent says). Null when the rule gives no discount (the price would not be below the list price, or not above 0). The same arithmetic
 * is in the database function `lucy_variant_campaign_at`.
 */
export function campaignRulePrice(rule: CampaignRule, listPriceVnd: bigint): bigint | null {
  const value = BigInt(rule.value);
  const price =
    rule.kind === 'PERCENT'
      ? listPriceVnd - (listPriceVnd * value) / 100n
      : rule.kind === 'AMOUNT'
        ? listPriceVnd - value
        : value;
  return price >= 1n && price < listPriceVnd ? price : null;
}

export interface CampaignPresentation {
  badgeVi: string | null;
  badgeEn: string | null;
  headlineVi: string | null;
  headlineEn: string | null;
  messageVi: string | null;
  messageEn: string | null;
  ctaLabelVi: string | null;
  ctaLabelEn: string | null;
  bannerMediaId: string | null;
}

export interface CampaignListRow {
  id: string;
  slug: string;
  nameVi: string;
  nameEn: string;
  state: CampaignState;
  startsAt: string;
  endsAt: string;
  endedEarlyAt: string | null;
  groupCount: number;
  itemCount: number;
}

export interface CampaignListResponse {
  rows: CampaignListRow[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CampaignGroupResponse {
  id: string;
  position: number;
  rule: CampaignRule;
  itemCount: number;
}

/**
 * What the Owner reviews before publishing (PRD 24.1): how many products are chosen, how many get no discount from their rule (they
 * are left out of the sale and shown so a mistake is seen), how many are also covered by another campaign or a promotion of their own
 * in the same time (the lowest price applies, never the sum), and the lowest/highest discount percent.
 */
export interface CampaignReview {
  itemCount: number;
  noDiscountCount: number;
  overlapCount: number;
  ownPromotionCount: number;
  /** Rounded whole percents of the items that get a discount; null when none does. */
  minPercent: number | null;
  maxPercent: number | null;
}

export interface CampaignDetailResponse extends CampaignPresentation {
  id: string;
  slug: string;
  nameVi: string;
  nameEn: string;
  internalNote: string | null;
  startsAt: string;
  endsAt: string;
  state: CampaignState;
  publishedAt: string | null;
  endedEarlyAt: string | null;
  endedEarlyReason: string | null;
  rowVersion: number;
  /** The image URL of the banner (a public media rendition), when one is set. */
  bannerUrl: string | null;
  groups: CampaignGroupResponse[];
  review: CampaignReview;
  can: {
    edit: boolean;
    editPresentation: boolean;
    changeItems: boolean;
    publish: boolean;
    end: boolean;
    remove: boolean;
  };
}

/** One chosen product of a campaign with the price its rule gives and what else touches it in the same time. */
export interface CampaignItemRow {
  variantId: string;
  groupId: string;
  sku: string;
  productCode: string;
  productName: string;
  variantLabel: string | null;
  brandName: string | null;
  listPriceVnd: string;
  /** Null when the rule gives no discount for the list price now. */
  campaignPriceVnd: string | null;
  discountPercent: number | null;
  /** Another published campaign overlapping this one in time covers the variant: the lowest price wins. */
  otherCampaigns: { id: string; nameVi: string; priceVnd: string | null }[];
  /** The variant has its own promotion overlapping this campaign: the lowest price wins. */
  hasOwnPromotion: boolean;
}

export interface CampaignItemsResponse {
  rows: CampaignItemRow[];
  page: number;
  pageSize: number;
  total: number;
}

/** A variant the picker can add. `groupId` is set when it is already in this campaign. */
export interface CampaignPickerRow {
  variantId: string;
  sku: string;
  productCode: string;
  productName: string;
  variantLabel: string | null;
  brandName: string | null;
  categoryName: string | null;
  listPriceVnd: string;
  available: number;
  groupId: string | null;
}

export interface CampaignPickerResponse {
  rows: CampaignPickerRow[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CampaignFilter {
  brandId?: string | null;
  categoryId?: string | null;
  /** Name, variant label or SKU. */
  q?: string | null;
  minPriceVnd?: string | null;
  maxPriceVnd?: string | null;
  /** Only variants with stock available at any branch. */
  inStockOnly?: boolean;
}

/** POST /api/v1/product-campaigns (MANAGE_PRODUCT_PRICES) */
export interface CampaignCreateRequest {
  slug: string;
  nameVi: string;
  nameEn: string;
  internalNote?: string | null;
  startsAt: string;
  endsAt: string;
}

/** POST /api/v1/product-campaigns/:id/edit. A draft takes every field; a published campaign takes only the presentation. */
export interface CampaignEditRequest extends Partial<CampaignPresentation> {
  expectedVersion: number;
  slug?: string;
  nameVi?: string;
  nameEn?: string;
  internalNote?: string | null;
  startsAt?: string;
  endsAt?: string;
}

export interface CampaignGroupRequest {
  expectedVersion: number;
  rule: CampaignRule;
}

export interface CampaignItemsAddRequest {
  expectedVersion: number;
  groupId: string;
  variantIds: string[];
}

export interface CampaignItemsAddFilteredRequest {
  expectedVersion: number;
  groupId: string;
  filter: CampaignFilter;
}

export interface CampaignItemsRemoveRequest {
  expectedVersion: number;
  variantIds: string[];
}

export interface CampaignPublishRequest {
  expectedVersion: number;
}

export interface CampaignEndRequest {
  expectedVersion: number;
  reason: string;
}

/** What the public site shows of a running campaign: the badge on cards, the banner and the sale page. */
export interface PublicCampaignRef {
  slug: string;
  name: string;
  badge: string | null;
}

export interface PublicCampaign extends PublicCampaignRef {
  headline: string | null;
  message: string | null;
  ctaLabel: string | null;
  bannerUrl: string | null;
  endsAt: string;
}

/** GET /api/v1/public/campaigns?locale : the campaigns running now, most recently started first. */
export interface PublicCampaignsResponse {
  campaigns: PublicCampaign[];
}
