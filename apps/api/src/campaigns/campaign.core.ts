import {
  CAMPAIGN_ITEMS_PAGE_SIZE,
  CAMPAIGN_MAX_GROUPS,
  CAMPAIGN_MAX_ITEMS_PER_ADD,
  CAMPAIGN_PAGE_SIZE,
  CAMPAIGN_STATES,
  campaignRulePrice,
  type CampaignCreateRequest,
  type CampaignDetailResponse,
  type CampaignEditRequest,
  type CampaignEndRequest,
  type CampaignGroupRequest,
  type CampaignItemRow,
  type CampaignItemsAddFilteredRequest,
  type CampaignItemsAddRequest,
  type CampaignItemsRemoveRequest,
  type CampaignItemsResponse,
  type CampaignListResponse,
  type CampaignPickerResponse,
  type CampaignPublishRequest,
  type CampaignReview,
  type CampaignRule,
  type CampaignState,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { FROM_FOLDED, likeLiteral, searchTokens, TO_FOLDED } from '../employees/employee-search.js';
import * as bounded from '../inventory/inventory.input.js';
import * as product from '../products/product-catalog.input.js';
import { requirePrices } from '../products/product-catalog.present.js';
import { publicMediaUrl } from '../website/popup.core.js';
import * as parse from './campaign.input.js';

/**
 * Phase 6 Wave 4 (P6-23; PRD 24.1; design 2.39): the campaign engine's commands and reads.
 *
 * - Authority is `MANAGE_PRODUCT_PRICES`, GLOBAL (design 3.3, W4-8), decided inside every command before anything is read.
 * - A campaign is a DRAFT until published. A draft is free to change and affects no price. Publishing freezes the window, the groups and the
 *   products (the database guard says the same): invoices priced by the campaign must keep reproducing their price. A published campaign can
 *   be ended early, once, with a reason; its texts and image can still change. It never rewrites a base price.
 * - Overlapping campaigns, or a campaign and a promotion of the variant itself, are shown in the review; they are never added together:
 *   the price function takes the lowest price.
 * - Lock order: the campaign row (FOR UPDATE), then its groups and items (the database guard shares the campaign row).
 */
type Tx = Prisma.TransactionClient;

const DRAFT_ONLY_FIELDS = [
  'slug',
  'nameVi',
  'nameEn',
  'internalNote',
  'startsAt',
  'endsAt',
] as const;

export function campaignState(
  row: { publishedAt: Date | null; startsAt: Date; endsAt: Date; endedEarlyAt: Date | null },
  now: Date,
): CampaignState {
  if (row.publishedAt === null) return 'DRAFT';
  // Ending by hand takes effect at once (the stamp is the database clock of that moment, a hair after this transaction's own `now`).
  if (row.endedEarlyAt !== null || row.endsAt <= now) return 'ENDED';
  return row.startsAt > now ? 'SCHEDULED' : 'ACTIVE';
}

async function lockCampaign(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM product_campaigns WHERE id = ${id}::uuid FOR UPDATE`;
  if (rows.length === 0) throw new AuthError('NOT_FOUND');
  return tx.productCampaign.findUniqueOrThrow({ where: { id } });
}

function campaignId(value: string): string {
  return product.uuid(value, 'id');
}

// ----------------------------------------------------------------------------------------------------- facts

interface ItemFact {
  variantId: string;
  groupId: string;
  sku: string;
  productCode: string;
  productName: string;
  variantLabel: string | null;
  brandName: string | null;
  listPriceVnd: bigint;
  rule: CampaignRule;
  overlapping: { id: string; nameVi: string; rule: CampaignRule }[];
  hasOwnPromotion: boolean;
}

interface FactRow {
  variant_id: string;
  group_id: string;
  sku: string;
  product_code: string;
  product_name: string;
  variant_label: string | null;
  brand_name: string | null;
  list_price_vnd: bigint;
  rule_kind: CampaignRule['kind'];
  rule_value: bigint;
  own_promotion: boolean;
}

/** Every chosen product of a campaign with the list price in force NOW and the things that touch it in the same time. */
async function itemFacts(
  tx: Tx,
  campaign: { id: string; startsAt: Date; endsAt: Date },
): Promise<ItemFact[]> {
  const rows = await tx.$queryRaw<FactRow[]>`
    SELECT i.variant_id, i.group_id, v.sku, p.code AS product_code, p.name_vi AS product_name, v.label_vi AS variant_label,
           b.name_vi AS brand_name, l.list_price_vnd, g.rule_kind, g.rule_value,
           EXISTS (
             SELECT 1 FROM product_promotions pr
             WHERE pr.variant_id = v.id AND pr.starts_at < ${campaign.endsAt}::timestamptz
               AND ${campaign.startsAt}::timestamptz < COALESCE(pr.ended_early_at, pr.ends_at)
           ) AS own_promotion
    FROM product_campaign_items i
    JOIN product_campaign_groups g ON g.id = i.group_id
    JOIN product_variants v ON v.id = i.variant_id
    JOIN products p ON p.id = v.product_id
    LEFT JOIN brands b ON b.id = p.brand_id
    CROSS JOIN LATERAL (
      SELECT pv.list_price_vnd FROM product_price_versions pv WHERE pv.variant_id = v.id ORDER BY pv.version_no DESC LIMIT 1
    ) l
    WHERE i.campaign_id = ${campaign.id}::uuid
    ORDER BY p.name_vi, v.sku, v.id`;
  const others = rows.length
    ? await tx.$queryRaw<
        {
          variant_id: string;
          id: string;
          name_vi: string;
          rule_kind: CampaignRule['kind'];
          rule_value: bigint;
        }[]
      >`
        SELECT i.variant_id, o.id, o.name_vi, g.rule_kind, g.rule_value
        FROM product_campaign_items i
        JOIN product_campaigns o ON o.id = i.campaign_id
        JOIN product_campaign_groups g ON g.id = i.group_id
        WHERE o.id <> ${campaign.id}::uuid AND o.published_at IS NOT NULL
          AND o.starts_at < ${campaign.endsAt}::timestamptz
          AND ${campaign.startsAt}::timestamptz < COALESCE(o.ended_early_at, o.ends_at)
          AND (o.ended_early_at IS NULL OR o.ended_early_at > o.starts_at)
          AND i.variant_id IN (SELECT variant_id FROM product_campaign_items WHERE campaign_id = ${campaign.id}::uuid)`
    : [];
  const byVariant = new Map<string, ItemFact['overlapping']>();
  for (const row of others) {
    const list = byVariant.get(row.variant_id) ?? [];
    list.push({
      id: row.id,
      nameVi: row.name_vi,
      rule: { kind: row.rule_kind, value: row.rule_value.toString() },
    });
    byVariant.set(row.variant_id, list);
  }
  return rows.map((row) => ({
    variantId: row.variant_id,
    groupId: row.group_id,
    sku: row.sku,
    productCode: row.product_code,
    productName: row.product_name,
    variantLabel: row.variant_label,
    brandName: row.brand_name,
    listPriceVnd: row.list_price_vnd,
    rule: { kind: row.rule_kind, value: row.rule_value.toString() },
    overlapping: byVariant.get(row.variant_id) ?? [],
    hasOwnPromotion: row.own_promotion,
  }));
}

/** Rounded whole percent of (list - price) / list, half up. */
function percentOff(list: bigint, price: bigint): number {
  return Number(((list - price) * 200n + list) / (2n * list));
}

function toRow(fact: ItemFact): CampaignItemRow {
  const price = campaignRulePrice(fact.rule, fact.listPriceVnd);
  return {
    variantId: fact.variantId,
    groupId: fact.groupId,
    sku: fact.sku,
    productCode: fact.productCode,
    productName: fact.productName,
    variantLabel: fact.variantLabel,
    brandName: fact.brandName,
    listPriceVnd: fact.listPriceVnd.toString(),
    campaignPriceVnd: price === null ? null : price.toString(),
    discountPercent: price === null ? null : percentOff(fact.listPriceVnd, price),
    otherCampaigns: fact.overlapping.map((other) => {
      const otherPrice = campaignRulePrice(other.rule, fact.listPriceVnd);
      return {
        id: other.id,
        nameVi: other.nameVi,
        priceVnd: otherPrice === null ? null : otherPrice.toString(),
      };
    }),
    hasOwnPromotion: fact.hasOwnPromotion,
  };
}

function review(facts: readonly ItemFact[]): CampaignReview {
  const rows = facts.map(toRow);
  const percents = rows.flatMap((row) =>
    row.discountPercent === null ? [] : [row.discountPercent],
  );
  return {
    itemCount: rows.length,
    noDiscountCount: rows.filter((row) => row.campaignPriceVnd === null).length,
    overlapCount: rows.filter((row) => row.otherCampaigns.length > 0).length,
    ownPromotionCount: rows.filter((row) => row.hasOwnPromotion).length,
    minPercent: percents.length ? Math.min(...percents) : null,
    maxPercent: percents.length ? Math.max(...percents) : null,
  };
}

// ----------------------------------------------------------------------------------------------------- reads

export async function listCampaigns(
  context: AdminContext,
  query: { state?: string; q?: string; page?: string },
): Promise<CampaignListResponse> {
  requirePrices(context);
  const { tx, now } = context;
  const state = query.state === undefined || query.state === '' ? null : query.state;
  if (state !== null && !CAMPAIGN_STATES.includes(state as CampaignState)) {
    throw new AuthError('VALIDATION_FAILED', 'state');
  }
  const q = (query.q ?? '').trim();
  if (q.length > 80) throw new AuthError('VALIDATION_FAILED', 'q');
  const page = query.page === undefined ? 1 : Number(query.page);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10_000)
    throw new AuthError('VALIDATION_FAILED', 'page');
  const patterns = searchTokens(q)
    .slice(0, 5)
    .map((term) => `%${likeLiteral(term)}%`);
  const rows = await tx.$queryRaw<
    {
      id: string;
      slug: string;
      name_vi: string;
      name_en: string;
      starts_at: Date;
      ends_at: Date;
      ended_early_at: Date | null;
      state: CampaignState;
      groups: bigint;
      items: bigint;
      total: bigint;
    }[]
  >`
    WITH c AS (
      SELECT c.*, CASE
        WHEN c.published_at IS NULL THEN 'DRAFT'
        WHEN c.ended_early_at IS NOT NULL OR c.ends_at <= ${now}::timestamptz THEN 'ENDED'
        WHEN c.starts_at > ${now}::timestamptz THEN 'SCHEDULED' ELSE 'ACTIVE' END AS state
      FROM product_campaigns c
      WHERE (cardinality(${patterns}::text[]) = 0 OR NOT EXISTS (
        SELECT 1 FROM unnest(${patterns}::text[]) AS t(pat)
        WHERE translate(lower(normalize(c.name_vi || ' ' || c.name_en || ' ' || c.slug, NFC)), ${FROM_FOLDED}, ${TO_FOLDED}) NOT LIKE t.pat))
    )
    SELECT c.id, c.slug, c.name_vi, c.name_en, c.starts_at, c.ends_at, c.ended_early_at, c.state,
           (SELECT count(*) FROM product_campaign_groups g WHERE g.campaign_id = c.id) AS groups,
           (SELECT count(*) FROM product_campaign_items i WHERE i.campaign_id = c.id) AS items,
           count(*) OVER () AS total
    FROM c
    WHERE (${state}::text IS NULL OR c.state = ${state})
    ORDER BY CASE c.state WHEN 'ACTIVE' THEN 0 WHEN 'SCHEDULED' THEN 1 WHEN 'DRAFT' THEN 2 ELSE 3 END, c.starts_at DESC, c.id
    LIMIT ${CAMPAIGN_PAGE_SIZE} OFFSET ${(page - 1) * CAMPAIGN_PAGE_SIZE}`;
  return {
    rows: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      nameVi: row.name_vi,
      nameEn: row.name_en,
      state: row.state,
      startsAt: row.starts_at.toISOString(),
      endsAt: row.ends_at.toISOString(),
      endedEarlyAt: row.ended_early_at ? row.ended_early_at.toISOString() : null,
      groupCount: Number(row.groups),
      itemCount: Number(row.items),
    })),
    page,
    pageSize: CAMPAIGN_PAGE_SIZE,
    total: rows.length ? Number(rows[0]!.total) : 0,
  };
}

export async function getCampaign(
  context: AdminContext,
  id: string,
): Promise<CampaignDetailResponse> {
  requirePrices(context);
  return present(context, campaignId(id));
}

async function present(context: AdminContext, id: string): Promise<CampaignDetailResponse> {
  const { tx, now } = context;
  const row = await tx.productCampaign.findUnique({
    where: { id },
    include: { groups: { orderBy: { position: 'asc' } } },
  });
  if (!row) throw new AuthError('NOT_FOUND');
  const facts = await itemFacts(tx, row);
  const perGroup = new Map<string, number>();
  for (const fact of facts) perGroup.set(fact.groupId, (perGroup.get(fact.groupId) ?? 0) + 1);
  const state = campaignState(row, now);
  const draft = state === 'DRAFT';
  return {
    id: row.id,
    slug: row.slug,
    nameVi: row.nameVi,
    nameEn: row.nameEn,
    internalNote: row.internalNote,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    state,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    endedEarlyAt: row.endedEarlyAt ? row.endedEarlyAt.toISOString() : null,
    endedEarlyReason: row.endedEarlyReason,
    rowVersion: row.rowVersion,
    badgeVi: row.badgeVi,
    badgeEn: row.badgeEn,
    headlineVi: row.headlineVi,
    headlineEn: row.headlineEn,
    messageVi: row.messageVi,
    messageEn: row.messageEn,
    ctaLabelVi: row.ctaLabelVi,
    ctaLabelEn: row.ctaLabelEn,
    bannerMediaId: row.bannerMediaId,
    bannerUrl: row.bannerMediaId ? publicMediaUrl(row.bannerMediaId, 'lg') : null,
    groups: row.groups.map((group) => ({
      id: group.id,
      position: group.position,
      rule: { kind: group.ruleKind, value: group.ruleValue.toString() },
      itemCount: perGroup.get(group.id) ?? 0,
    })),
    review: review(facts),
    can: {
      edit: draft,
      editPresentation: state !== 'ENDED',
      changeItems: draft,
      publish: draft,
      end: state === 'ACTIVE' || state === 'SCHEDULED',
      remove: draft,
    },
  };
}

export async function campaignItems(
  context: AdminContext,
  id: string,
  query: { page?: string; q?: string; groupId?: string; problem?: string },
): Promise<CampaignItemsResponse> {
  requirePrices(context);
  const row = await context.tx.productCampaign.findUnique({
    where: { id: campaignId(id) },
    select: { id: true, startsAt: true, endsAt: true },
  });
  if (!row) throw new AuthError('NOT_FOUND');
  const page = query.page === undefined ? 1 : Number(query.page);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10_000)
    throw new AuthError('VALIDATION_FAILED', 'page');
  const q = (query.q ?? '').trim();
  if (q.length > 80) throw new AuthError('VALIDATION_FAILED', 'q');
  const groupId =
    query.groupId === undefined || query.groupId === ''
      ? null
      : product.uuid(query.groupId, 'groupId');
  const problem = query.problem === undefined || query.problem === '' ? null : query.problem;
  if (problem !== null && !['NO_DISCOUNT', 'OVERLAP', 'OWN_PROMOTION'].includes(problem)) {
    throw new AuthError('VALIDATION_FAILED', 'problem');
  }
  const terms = searchTokens(q).slice(0, 5);
  const facts = await itemFacts(context.tx, row);
  const fold = (text: string) => foldText(text);
  const rows = facts
    .filter((fact) => groupId === null || fact.groupId === groupId)
    .filter((fact) =>
      terms.every((term) =>
        fold(
          `${fact.productName} ${fact.variantLabel ?? ''} ${fact.brandName ?? ''} ${fact.sku}`,
        ).includes(term),
      ),
    )
    .map(toRow)
    .filter((entry) =>
      problem === null
        ? true
        : problem === 'NO_DISCOUNT'
          ? entry.campaignPriceVnd === null
          : problem === 'OVERLAP'
            ? entry.otherCampaigns.length > 0
            : entry.hasOwnPromotion,
    );
  const start = (page - 1) * CAMPAIGN_ITEMS_PAGE_SIZE;
  return {
    rows: rows.slice(start, start + CAMPAIGN_ITEMS_PAGE_SIZE),
    page,
    pageSize: CAMPAIGN_ITEMS_PAGE_SIZE,
    total: rows.length,
  };
}

function foldText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
}

interface PickerSql {
  rows: {
    variant_id: string;
    sku: string;
    product_code: string;
    product_name: string;
    variant_label: string | null;
    brand_name: string | null;
    category_name: string | null;
    list_price_vnd: bigint;
    available: bigint | null;
    group_id: string | null;
    total: bigint;
  }[];
}

/** The variants that match a filter, for the picker and for "select all of the filtered result". */
async function pickVariants(
  tx: Tx,
  id: string,
  filter: parse.ParsedFilter,
  window: { limit: number; offset: number },
): Promise<PickerSql['rows']> {
  const patterns = searchTokens(filter.q ?? '')
    .slice(0, 5)
    .map((term) => `%${likeLiteral(term)}%`);
  return tx.$queryRaw<PickerSql['rows']>`
    SELECT v.id AS variant_id, v.sku, p.code AS product_code, p.name_vi AS product_name, v.label_vi AS variant_label,
           b.name_vi AS brand_name, c.name_vi AS category_name, l.list_price_vnd,
           (SELECT sum(sl.on_hand - sl.reserved) FROM stock_levels sl WHERE sl.variant_id = v.id) AS available,
           i.group_id, count(*) OVER () AS total
    FROM product_variants v
    JOIN products p ON p.id = v.product_id AND p.status = 'PUBLISHED'
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN product_categories c ON c.id = p.category_id
    CROSS JOIN LATERAL (
      SELECT pv.list_price_vnd FROM product_price_versions pv WHERE pv.variant_id = v.id ORDER BY pv.version_no DESC LIMIT 1
    ) l
    LEFT JOIN product_campaign_items i ON i.variant_id = v.id AND i.campaign_id = ${id}::uuid
    WHERE v.is_active
      AND (${filter.brandId}::uuid IS NULL OR p.brand_id = ${filter.brandId}::uuid)
      AND (${filter.categoryId}::uuid IS NULL OR p.category_id = ${filter.categoryId}::uuid
           OR p.category_id IN (SELECT id FROM product_categories WHERE parent_id = ${filter.categoryId}::uuid))
      AND (${filter.minPriceVnd}::bigint IS NULL OR l.list_price_vnd >= ${filter.minPriceVnd}::bigint)
      AND (${filter.maxPriceVnd}::bigint IS NULL OR l.list_price_vnd <= ${filter.maxPriceVnd}::bigint)
      AND (NOT ${filter.inStockOnly} OR COALESCE((SELECT sum(sl.on_hand - sl.reserved) FROM stock_levels sl WHERE sl.variant_id = v.id), 0) > 0)
      AND (cardinality(${patterns}::text[]) = 0 OR NOT EXISTS (
        SELECT 1 FROM unnest(${patterns}::text[]) AS t(pat)
        WHERE translate(lower(normalize(
                p.name_vi || ' ' || p.name_en || ' ' || COALESCE(b.name_vi, '') || ' ' || COALESCE(b.name_en, '') || ' '
                || COALESCE(v.label_vi, '') || ' ' || COALESCE(v.label_en, '') || ' ' || v.sku, NFC)),
              ${FROM_FOLDED}, ${TO_FOLDED}) NOT LIKE t.pat))
    ORDER BY p.name_vi, v.sort_order, v.id
    LIMIT ${window.limit} OFFSET ${window.offset}`;
}

export async function campaignPicker(
  context: AdminContext,
  id: string,
  query: Record<string, string | undefined>,
): Promise<CampaignPickerResponse> {
  requirePrices(context);
  const campaign = campaignId(id);
  if (
    !(await context.tx.productCampaign.findUnique({
      where: { id: campaign },
      select: { id: true },
    }))
  ) {
    throw new AuthError('NOT_FOUND');
  }
  const page = query['page'] === undefined ? 1 : Number(query['page']);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10_000)
    throw new AuthError('VALIDATION_FAILED', 'page');
  const filter = parse.filter({
    brandId: query['brandId'] || null,
    categoryId: query['categoryId'] || null,
    q: query['q'] || null,
    minPriceVnd: query['minPriceVnd'] || null,
    maxPriceVnd: query['maxPriceVnd'] || null,
    inStockOnly: query['inStockOnly'] === 'true',
  });
  const rows = await pickVariants(context.tx, campaign, filter, {
    limit: CAMPAIGN_ITEMS_PAGE_SIZE,
    offset: (page - 1) * CAMPAIGN_ITEMS_PAGE_SIZE,
  });
  return {
    rows: rows.map((row) => ({
      variantId: row.variant_id,
      sku: row.sku,
      productCode: row.product_code,
      productName: row.product_name,
      variantLabel: row.variant_label,
      brandName: row.brand_name,
      categoryName: row.category_name,
      listPriceVnd: row.list_price_vnd.toString(),
      available: Math.max(0, Number(row.available ?? 0n)),
      groupId: row.group_id,
    })),
    page,
    pageSize: CAMPAIGN_ITEMS_PAGE_SIZE,
    total: rows.length ? Number(rows[0]!.total) : 0,
  };
}

// -------------------------------------------------------------------------------------------------- commands

function presentationData(body: Record<string, unknown>): Record<string, string | null> {
  const data: Record<string, string | null> = {};
  for (const [field, max] of parse.PRESENTATION_FIELDS) {
    if (body[field] !== undefined) data[field] = product.optionalText(body[field], field, max);
  }
  return data;
}

async function bannerData(
  tx: Tx,
  body: Record<string, unknown>,
): Promise<{ bannerMediaId?: string | null }> {
  if (body['bannerMediaId'] === undefined) return {};
  const mediaId = product.optionalUuid(body['bannerMediaId'], 'bannerMediaId');
  if (
    mediaId !== null &&
    !(await tx.mediaAsset.findUnique({ where: { id: mediaId }, select: { id: true } }))
  ) {
    throw new AuthError('VALIDATION_FAILED', 'bannerMediaId');
  }
  return { bannerMediaId: mediaId };
}

const CREATE_KEYS = ['slug', 'nameVi', 'nameEn', 'internalNote', 'startsAt', 'endsAt'] as const;
const PRESENTATION_KEYS = [
  'badgeVi',
  'badgeEn',
  'headlineVi',
  'headlineEn',
  'messageVi',
  'messageEn',
  'ctaLabelVi',
  'ctaLabelEn',
  'bannerMediaId',
] as const;

export async function createCampaign(
  context: AdminContext,
  request: CampaignCreateRequest,
): Promise<CampaignDetailResponse> {
  requirePrices(context);
  const body = bounded.record(request, 'body', CREATE_KEYS);
  const slug = parse.slug(body['slug']);
  const nameVi = product.name(body['nameVi'], 'nameVi');
  const nameEn = product.name(body['nameEn'], 'nameEn');
  const note = product.optionalText(body['internalNote'], 'internalNote', 2000);
  const startsAt = product.instant(body['startsAt'], 'startsAt');
  const endsAt = product.instant(body['endsAt'], 'endsAt');
  if (endsAt <= startsAt) throw new AuthError('VALIDATION_FAILED', 'endsAt');
  const { tx, now } = context;
  if (endsAt <= now) throw new AuthError('VALIDATION_FAILED', 'endsAt');
  if (await tx.productCampaign.findUnique({ where: { slug }, select: { id: true } })) {
    throw new AuthError('CAMPAIGN_SLUG_TAKEN', 'slug');
  }
  const created = await tx.productCampaign.create({
    data: {
      slug,
      nameVi,
      nameEn,
      internalNote: note,
      startsAt,
      endsAt,
      createdByUserId: context.actor.userId,
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_CAMPAIGN_CREATED',
    entityType: 'ProductCampaign',
    entityId: created.id,
    classification: 'FINANCIAL',
    after: { slug, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
  });
  return present(context, created.id);
}

export async function editCampaign(
  context: AdminContext,
  id: string,
  request: CampaignEditRequest,
): Promise<CampaignDetailResponse> {
  requirePrices(context);
  const body = bounded.record(request, 'body', [
    'expectedVersion',
    ...CREATE_KEYS,
    ...PRESENTATION_KEYS,
  ]);
  const expected = bounded.rowVersion(body['expectedVersion']);
  const { tx, now } = context;
  const row = await lockCampaign(tx, campaignId(id));
  if (row.rowVersion !== expected) throw new AuthError('CONFLICT');
  const state = campaignState(row, now);
  if (state === 'ENDED') throw new AuthError('CAMPAIGN_ENDED');
  const data: Prisma.ProductCampaignUncheckedUpdateInput = {
    ...presentationData(body),
    ...(await bannerData(tx, body)),
  };
  const touchesPrice = DRAFT_ONLY_FIELDS.some((key) => body[key] !== undefined);
  if (touchesPrice && state !== 'DRAFT') throw new AuthError('CAMPAIGN_NOT_EDITABLE');
  if (body['slug'] !== undefined) {
    const slug = parse.slug(body['slug']);
    if (
      slug !== row.slug &&
      (await tx.productCampaign.findUnique({ where: { slug }, select: { id: true } }))
    ) {
      throw new AuthError('CAMPAIGN_SLUG_TAKEN', 'slug');
    }
    data.slug = slug;
  }
  if (body['nameVi'] !== undefined) data.nameVi = product.name(body['nameVi'], 'nameVi');
  if (body['nameEn'] !== undefined) data.nameEn = product.name(body['nameEn'], 'nameEn');
  if (body['internalNote'] !== undefined)
    data.internalNote = product.optionalText(body['internalNote'], 'internalNote', 2000);
  const startsAt =
    body['startsAt'] === undefined ? row.startsAt : product.instant(body['startsAt'], 'startsAt');
  const endsAt =
    body['endsAt'] === undefined ? row.endsAt : product.instant(body['endsAt'], 'endsAt');
  if (endsAt <= startsAt || (body['endsAt'] !== undefined && endsAt <= now)) {
    throw new AuthError('VALIDATION_FAILED', 'endsAt');
  }
  if (body['startsAt'] !== undefined) data.startsAt = startsAt;
  if (body['endsAt'] !== undefined) data.endsAt = endsAt;
  if (Object.keys(data).length === 0) throw new AuthError('VALIDATION_FAILED', 'body');
  await tx.productCampaign.update({
    where: { id: row.id },
    data: { ...data, rowVersion: { increment: 1 } },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_CAMPAIGN_EDITED',
    entityType: 'ProductCampaign',
    entityId: row.id,
    classification: touchesPrice ? 'FINANCIAL' : 'STANDARD',
    after: { fields: Object.keys(data).sort() },
  });
  return present(context, row.id);
}

async function requireDraft(context: AdminContext, id: string, expectedVersion: unknown) {
  requirePrices(context);
  const expected = bounded.rowVersion(expectedVersion);
  const row = await lockCampaign(context.tx, campaignId(id));
  if (row.rowVersion !== expected) throw new AuthError('CONFLICT');
  if (campaignState(row, context.now) !== 'DRAFT') throw new AuthError('CAMPAIGN_NOT_EDITABLE');
  return row;
}

async function bump(tx: Tx, id: string): Promise<void> {
  await tx.productCampaign.update({
    where: { id },
    data: { rowVersion: { increment: 1 } },
    select: { id: true },
  });
}

export async function addGroup(
  context: AdminContext,
  id: string,
  request: CampaignGroupRequest,
): Promise<CampaignDetailResponse> {
  const body = bounded.record(request, 'body', ['expectedVersion', 'rule']);
  const row = await requireDraft(context, id, body['expectedVersion']);
  const rule = parse.rule(body['rule']);
  const { tx } = context;
  const groups = await tx.productCampaignGroup.findMany({
    where: { campaignId: row.id },
    select: { position: true },
  });
  if (groups.length >= CAMPAIGN_MAX_GROUPS) throw new AuthError('CAMPAIGN_GROUP_LIMIT');
  const created = await tx.productCampaignGroup.create({
    data: {
      campaignId: row.id,
      position: groups.reduce((max, group) => Math.max(max, group.position), 0) + 1,
      ruleKind: rule.kind,
      ruleValue: BigInt(rule.value),
    },
    select: { id: true },
  });
  await bump(tx, row.id);
  await appendAdminAudit(context, {
    action: 'PRODUCT_CAMPAIGN_GROUP_ADDED',
    entityType: 'ProductCampaign',
    entityId: row.id,
    classification: 'FINANCIAL',
    after: { groupId: created.id, kind: rule.kind, value: rule.value },
  });
  return present(context, row.id);
}

export async function editGroup(
  context: AdminContext,
  id: string,
  groupId: string,
  request: CampaignGroupRequest,
): Promise<CampaignDetailResponse> {
  const body = bounded.record(request, 'body', ['expectedVersion', 'rule']);
  const row = await requireDraft(context, id, body['expectedVersion']);
  const rule = parse.rule(body['rule']);
  const { tx } = context;
  const group = await tx.productCampaignGroup.findFirst({
    where: { id: product.uuid(groupId, 'groupId'), campaignId: row.id },
    select: { id: true },
  });
  if (!group) throw new AuthError('NOT_FOUND');
  await tx.productCampaignGroup.update({
    where: { id: group.id },
    data: { ruleKind: rule.kind, ruleValue: BigInt(rule.value) },
    select: { id: true },
  });
  await bump(tx, row.id);
  await appendAdminAudit(context, {
    action: 'PRODUCT_CAMPAIGN_GROUP_CHANGED',
    entityType: 'ProductCampaign',
    entityId: row.id,
    classification: 'FINANCIAL',
    after: { groupId: group.id, kind: rule.kind, value: rule.value },
  });
  return present(context, row.id);
}

export async function removeGroup(
  context: AdminContext,
  id: string,
  groupId: string,
  request: CampaignPublishRequest,
): Promise<CampaignDetailResponse> {
  const body = bounded.record(request, 'body', ['expectedVersion']);
  const row = await requireDraft(context, id, body['expectedVersion']);
  const { tx } = context;
  const group = await tx.productCampaignGroup.findFirst({
    where: { id: product.uuid(groupId, 'groupId'), campaignId: row.id },
    select: { id: true },
  });
  if (!group) throw new AuthError('NOT_FOUND');
  // The products of the group leave with it (a draft has no history).
  const removed = await tx.productCampaignItem.deleteMany({ where: { groupId: group.id } });
  await tx.productCampaignGroup.delete({ where: { id: group.id } });
  await bump(tx, row.id);
  await appendAdminAudit(context, {
    action: 'PRODUCT_CAMPAIGN_GROUP_REMOVED',
    entityType: 'ProductCampaign',
    entityId: row.id,
    classification: 'FINANCIAL',
    after: { groupId: group.id, items: removed.count },
  });
  return present(context, row.id);
}

/** Puts variants into a group: the ones already in the campaign move to it. Only published products with a price can be chosen. */
async function placeVariants(
  context: AdminContext,
  campaign: { id: string },
  groupId: string,
  ids: readonly string[],
): Promise<{ added: number; moved: number }> {
  const { tx } = context;
  const group = await tx.productCampaignGroup.findFirst({
    where: { id: groupId, campaignId: campaign.id },
    select: { id: true },
  });
  if (!group) throw new AuthError('NOT_FOUND');
  const sellable = await tx.$queryRaw<{ id: string }[]>`
    SELECT v.id FROM product_variants v
    JOIN products p ON p.id = v.product_id AND p.status = 'PUBLISHED'
    WHERE v.id = ANY(${[...ids]}::uuid[]) AND v.is_active
      AND EXISTS (SELECT 1 FROM product_price_versions pv WHERE pv.variant_id = v.id)`;
  if (sellable.length !== ids.length)
    throw new AuthError('CAMPAIGN_VARIANT_NOT_SELLABLE', 'variantIds');
  const existing = await tx.productCampaignItem.findMany({
    where: { campaignId: campaign.id, variantId: { in: [...ids] } },
    select: { id: true, variantId: true, groupId: true },
  });
  const have = new Map(existing.map((item) => [item.variantId, item]));
  let moved = 0;
  const fresh: string[] = [];
  for (const variantId of ids) {
    const item = have.get(variantId);
    if (!item) fresh.push(variantId);
    else if (item.groupId !== groupId) {
      await tx.productCampaignItem.update({
        where: { id: item.id },
        data: { groupId },
        select: { id: true },
      });
      moved += 1;
    }
  }
  if (fresh.length) {
    await tx.productCampaignItem.createMany({
      data: fresh.map((variantId) => ({ campaignId: campaign.id, groupId, variantId })),
    });
  }
  return { added: fresh.length, moved };
}

export async function addItems(
  context: AdminContext,
  id: string,
  request: CampaignItemsAddRequest,
): Promise<CampaignDetailResponse> {
  const body = bounded.record(request, 'body', ['expectedVersion', 'groupId', 'variantIds']);
  const row = await requireDraft(context, id, body['expectedVersion']);
  const groupId = product.uuid(body['groupId'], 'groupId');
  const ids = parse.variantIds(body['variantIds']);
  const result = await placeVariants(context, row, groupId, ids);
  await bump(context.tx, row.id);
  await appendAdminAudit(context, {
    action: 'PRODUCT_CAMPAIGN_ITEMS_ADDED',
    entityType: 'ProductCampaign',
    entityId: row.id,
    classification: 'FINANCIAL',
    after: { groupId, ...result },
  });
  return present(context, row.id);
}

export async function addFilteredItems(
  context: AdminContext,
  id: string,
  request: CampaignItemsAddFilteredRequest,
): Promise<CampaignDetailResponse> {
  const body = bounded.record(request, 'body', ['expectedVersion', 'groupId', 'filter']);
  const row = await requireDraft(context, id, body['expectedVersion']);
  const groupId = product.uuid(body['groupId'], 'groupId');
  const filter = parse.filter(body['filter']);
  const picked = await pickVariants(context.tx, row.id, filter, {
    limit: CAMPAIGN_MAX_ITEMS_PER_ADD + 1,
    offset: 0,
  });
  if (picked.length === 0) throw new AuthError('VALIDATION_FAILED', 'filter');
  // "Select all" of a result bigger than one add can take is refused rather than cut short: the Owner narrows the filter.
  if (picked.length > CAMPAIGN_MAX_ITEMS_PER_ADD)
    throw new AuthError('VALIDATION_FAILED', 'filter');
  const result = await placeVariants(
    context,
    row,
    groupId,
    picked.map((entry) => entry.variant_id),
  );
  await bump(context.tx, row.id);
  await appendAdminAudit(context, {
    action: 'PRODUCT_CAMPAIGN_ITEMS_ADDED',
    entityType: 'ProductCampaign',
    entityId: row.id,
    classification: 'FINANCIAL',
    after: { groupId, filtered: true, ...result },
  });
  return present(context, row.id);
}

export async function removeItems(
  context: AdminContext,
  id: string,
  request: CampaignItemsRemoveRequest,
): Promise<CampaignDetailResponse> {
  const body = bounded.record(request, 'body', ['expectedVersion', 'variantIds']);
  const row = await requireDraft(context, id, body['expectedVersion']);
  const ids = parse.variantIds(body['variantIds']);
  const removed = await context.tx.productCampaignItem.deleteMany({
    where: { campaignId: row.id, variantId: { in: ids } },
  });
  await bump(context.tx, row.id);
  await appendAdminAudit(context, {
    action: 'PRODUCT_CAMPAIGN_ITEMS_REMOVED',
    entityType: 'ProductCampaign',
    entityId: row.id,
    classification: 'FINANCIAL',
    after: { items: removed.count },
  });
  return present(context, row.id);
}

export async function publishCampaign(
  context: AdminContext,
  id: string,
  request: CampaignPublishRequest,
): Promise<CampaignDetailResponse> {
  const body = bounded.record(request, 'body', ['expectedVersion']);
  const row = await requireDraft(context, id, body['expectedVersion']);
  const { tx, now } = context;
  if (row.startsAt < now) throw new AuthError('CAMPAIGN_START_PASSED', 'startsAt');
  const facts = await itemFacts(tx, row);
  if (facts.length === 0) throw new AuthError('CAMPAIGN_EMPTY');
  const summary = review(facts);
  if (summary.noDiscountCount === summary.itemCount) throw new AuthError('CAMPAIGN_NO_DISCOUNT');
  await tx.productCampaign.update({
    where: { id: row.id },
    data: {
      publishedAt: now,
      publishedByUserId: context.actor.userId,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_CAMPAIGN_PUBLISHED',
    entityType: 'ProductCampaign',
    entityId: row.id,
    classification: 'FINANCIAL',
    after: {
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      items: summary.itemCount,
      noDiscount: summary.noDiscountCount,
      overlaps: summary.overlapCount,
      ownPromotions: summary.ownPromotionCount,
    },
  });
  return present(context, row.id);
}

export async function endCampaign(
  context: AdminContext,
  id: string,
  request: CampaignEndRequest,
): Promise<CampaignDetailResponse> {
  requirePrices(context);
  const body = bounded.record(request, 'body', ['expectedVersion', 'reason']);
  const expected = bounded.rowVersion(body['expectedVersion']);
  const reason = bounded.line(body['reason'], 'reason', 2000);
  const { tx, now } = context;
  const row = await lockCampaign(tx, campaignId(id));
  if (row.rowVersion !== expected) throw new AuthError('CONFLICT');
  const state = campaignState(row, now);
  if (state === 'ENDED') throw new AuthError('CAMPAIGN_ENDED');
  if (state === 'DRAFT') throw new AuthError('CAMPAIGN_NOT_EDITABLE');
  await tx.productCampaign.update({
    where: { id: row.id },
    data: {
      endedEarlyAt: now,
      endedEarlyByUserId: context.actor.userId,
      endedEarlyReason: reason,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_CAMPAIGN_ENDED',
    entityType: 'ProductCampaign',
    entityId: row.id,
    classification: 'FINANCIAL',
    reason,
    before: { state },
  });
  return present(context, row.id);
}

/** Deletes a draft that was never published (it affected no price and has no history). */
export async function deleteCampaign(
  context: AdminContext,
  id: string,
  request: CampaignPublishRequest,
): Promise<{ deleted: true }> {
  const body = bounded.record(request, 'body', ['expectedVersion']);
  const row = await requireDraft(context, id, body['expectedVersion']);
  const { tx } = context;
  await tx.productCampaignItem.deleteMany({ where: { campaignId: row.id } });
  await tx.productCampaignGroup.deleteMany({ where: { campaignId: row.id } });
  await tx.productCampaign.delete({ where: { id: row.id } });
  await appendAdminAudit(context, {
    action: 'PRODUCT_CAMPAIGN_DELETED',
    entityType: 'ProductCampaign',
    entityId: row.id,
    classification: 'FINANCIAL',
    before: { slug: row.slug },
  });
  return { deleted: true };
}
