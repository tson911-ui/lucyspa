/**
 * Phase 9 P9-5: the pure rules that turn what a source says about a product into the review facts of its candidate: the proposed SKU, the
 * brand and category from the remembered mappings, the duplicate suspicions and the warnings that decide whether a person must look.
 *
 * Owner decisions this file keeps (2026-10-10):
 * - The Lucy SKU is the supplier's SKU EXACTLY as shown. A SKU that does not fit Lucy's format (`product_variants_sku`:
 *   `^[A-Z0-9][A-Z0-9._-]{0,63}$`) is a review item (`SKU_FORMAT`), never changed silently: the normal product form would upper-case it,
 *   so it is never "fixed" here. No SKU: `HARU-<WooCommerce id>` for haruohui.com ONLY (the Owner gave that prefix for that source); any
 *   other source keeps `SKU_MISSING` until the Owner decides its prefix. A SKU that already belongs to another Lucy product, or to
 *   another candidate, is a review item (`SKU_COLLISION`, `SKU_DUPLICATE_CANDIDATE`) with the other product only as a suggestion.
 * - A brand or a category is never created here; it comes from a remembered mapping or stays a review item with suggestions.
 * - Sets are standalone products (nothing special is done for them).
 * - Nothing here touches Lucy-owned text, prices or costs.
 */

/** `product_variants_sku` CHECK: the exact shape a Lucy SKU must have (no upper-casing, no trimming, no repair). */
export const LUCY_SKU = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;

/** SKU prefixes the Owner approved for a source that sells products without a SKU, by host (without `www.`). Haruohui only. */
export const GENERATED_SKU_PREFIX_BY_HOST: Readonly<Record<string, string>> = Object.freeze({
  'haruohui.com': 'HARU-',
});

export type CandidateWarning = { code: string } & Record<string, unknown>;

/** Warning codes this module owns: it removes and recomputes all of them on every evaluation. */
export const EVALUATION_CODES = [
  'NAME_MISSING',
  'DESCRIPTION_EMPTY',
  'PRICE_MISSING',
  'SKU_MISSING',
  'SKU_FORMAT',
  'SKU_COLLISION',
  'SKU_DUPLICATE_CANDIDATE',
  'BRAND_UNMAPPED',
  'BRAND_AMBIGUOUS',
  'CATEGORY_UNMAPPED',
  'CATEGORY_AMBIGUOUS',
  'POSSIBLE_DUPLICATE',
  'IMAGE_MISSING',
] as const;

/** The states a person has already decided; evaluation never moves them. */
export const DECIDED_STATES = ['APPROVED', 'REJECTED', 'IGNORED', 'IMPORTED'] as const;

export function hostOf(baseUrl: string | null): string | null {
  if (baseUrl === null) return null;
  try {
    return new URL(baseUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------------------------------------- text keys

/** Diacritics folded (Vietnamese included), lower case, punctuation gone, white space collapsed: a key to compare names and mappings. */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Sizes in a text as canonical tokens (`150ml`, `50g`): the number without a trailing zero decimal plus the unit. */
export function extractVolumes(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/(\d+(?:[.,]\d+)?)\s*(ml|gr|g|kg|l|oz)\b/g)) {
    const number = String(Number(String(match[1]).replace(',', '.')));
    const unit = match[2] === 'gr' ? 'g' : match[2];
    found.add(`${number}${unit}`);
  }
  return [...found].sort();
}

/** Name plus sizes, the key two products must share to be a possible duplicate (design 8, layer 4). */
export function nameKey(name: string, extraTexts: readonly string[] = []): string {
  // "50 ML" and "50ml" are the same size: sizes are written the same way before the text is folded.
  const canonical = name.replace(
    /(\d+(?:[.,]\d+)?)\s*(ml|gr|g|kg|l|oz)\b/gi,
    (_, number: string, unit: string) => {
      const lower = unit.toLowerCase();
      return `${Number(number.replace(',', '.'))}${lower === 'gr' ? 'g' : lower}`;
    },
  );
  return `${foldText(canonical)}|${extractVolumes([name, ...extraTexts].join(' ')).join(',')}`;
}

// ------------------------------------------------------------------------------------------------------------------ SKU

export interface SkuProposal {
  sku: string | null;
  origin: 'SOURCE' | 'GENERATED' | 'NONE';
}

/** The SKU a candidate starts with: the supplier's exactly as shown, else the approved generated one, else none. */
export function proposeSku(
  record: { sku: string | null; sourceKey: string },
  host: string | null,
  prefixes: Readonly<Record<string, string>> = GENERATED_SKU_PREFIX_BY_HOST,
): SkuProposal {
  if (record.sku !== null && record.sku !== '') return { sku: record.sku, origin: 'SOURCE' };
  const prefix = host === null ? undefined : prefixes[host];
  if (prefix !== undefined) return { sku: `${prefix}${record.sourceKey}`, origin: 'GENERATED' };
  return { sku: null, origin: 'NONE' };
}

export interface VariantOwner {
  variantId: string;
  productId: string;
  productName: string;
}

export function skuWarnings(input: {
  sku: string | null;
  origin: SkuProposal['origin'] | 'CURRENT';
  variants: ReadonlyMap<string, VariantOwner>;
  otherCandidates: readonly { id: string; proposedSku: string | null }[];
  selfId: string;
}): CandidateWarning[] {
  const { sku } = input;
  if (sku === null) return [{ code: 'SKU_MISSING' }];
  const warnings: CandidateWarning[] = [];
  if (!LUCY_SKU.test(sku)) {
    const upper = sku.toUpperCase();
    const clash = input.variants.get(upper);
    warnings.push({
      code: 'SKU_FORMAT',
      sku,
      origin: input.origin,
      // What the normal product form would turn it into, and whether that already belongs to a Lucy product: shown, never applied.
      ...(LUCY_SKU.test(upper) ? { upperCaseWouldBe: upper } : {}),
      ...(clash
        ? { upperCaseCollidesWith: { productId: clash.productId, variantId: clash.variantId } }
        : {}),
    });
  }
  const owner = input.variants.get(sku);
  if (owner) {
    warnings.push({
      code: 'SKU_COLLISION',
      sku,
      productId: owner.productId,
      variantId: owner.variantId,
      productName: owner.productName,
    });
  }
  const twin = input.otherCandidates.find(
    (other) => other.id !== input.selfId && other.proposedSku === sku,
  );
  if (twin) warnings.push({ code: 'SKU_DUPLICATE_CANDIDATE', sku, candidateId: twin.id });
  return warnings;
}

// ----------------------------------------------------------------------------------- brand and category from the mappings

export interface NamedTarget {
  id: string;
  names: readonly string[];
}

/** Maps are keyed by `foldText(sourceText)`. */
export type MappingMap = ReadonlyMap<string, string>;

export interface Resolution {
  targetId: string | null;
  /** The source text that matched a mapping. */
  matchedText: string | null;
  warnings: CandidateWarning[];
}

function resolveText(
  kind: 'BRAND' | 'CATEGORY',
  texts: readonly string[],
  mappings: MappingMap,
  targets: readonly NamedTarget[],
): Resolution {
  const hits = texts
    .map((text) => ({ text, target: mappings.get(foldText(text)) }))
    .filter((hit): hit is { text: string; target: string } => hit.target !== undefined);
  const distinct = [...new Set(hits.map((hit) => hit.target))];
  if (distinct.length === 1) {
    return {
      targetId: distinct[0] as string,
      matchedText: (hits[0] as { text: string }).text,
      warnings: [],
    };
  }
  if (distinct.length > 1) {
    return {
      targetId: null,
      matchedText: null,
      warnings: [{ code: `${kind}_AMBIGUOUS`, texts: hits.map((hit) => hit.text).slice(0, 12) }],
    };
  }
  const suggestions = targets
    .filter((target) =>
      target.names.some((name) => texts.some((text) => foldText(text) === foldText(name))),
    )
    .slice(0, 5)
    .map((target) => ({ id: target.id, name: target.names[0] }));
  return {
    targetId: null,
    matchedText: null,
    warnings: [{ code: `${kind}_UNMAPPED`, texts: [...new Set(texts)].slice(0, 12), suggestions }],
  };
}

export const resolveBrand = (
  texts: readonly string[],
  mappings: MappingMap,
  brands: readonly NamedTarget[],
) => resolveText('BRAND', texts, mappings, brands);

export const resolveCategory = (
  texts: readonly string[],
  mappings: MappingMap,
  categories: readonly NamedTarget[],
) => resolveText('CATEGORY', texts, mappings, categories);

// -------------------------------------------------------------------------------------------------------- the evaluation

export interface EvaluationInput {
  candidate: {
    id: string;
    state: string;
    nameVi: string;
    nameEn: string;
    descriptionVi: string | null;
    descriptionEn: string | null;
    brandId: string | null;
    brandText: string | null;
    categoryId: string | null;
    proposedSku: string | null;
    warnings: readonly CandidateWarning[];
  };
  record: {
    sourceKey: string;
    sku: string | null;
    brandText: string | null;
    categoryNames: readonly string[];
    descriptionText: string | null;
    attributeTexts: readonly string[];
    priceVnd: number | null;
    imageUrls: readonly string[];
  };
  host: string | null;
  /** The candidate's active pictures. */
  images: readonly { id: string; sourceUrl: string; flag: string | null }[];
  /** What the reviewer already decided: the latest decision of each picture, and the look-alikes kept separate (`PRODUCT:<id>`). */
  decisions?: {
    images: ReadonlyMap<string, 'KEEP' | 'DROP'>;
    keptSeparate: ReadonlySet<string>;
  };
}

export interface OtherCandidate {
  id: string;
  nameVi: string;
  proposedSku: string | null;
  brandId: string | null;
  state: string;
}

export interface EvaluationContext {
  skuPrefixes?: Readonly<Record<string, string>>;
  brandMappings: MappingMap;
  categoryMappings: MappingMap;
  brands: readonly NamedTarget[];
  categories: readonly NamedTarget[];
  variants: ReadonlyMap<string, VariantOwner>;
  products: readonly { id: string; nameVi: string; nameEn: string; brandId: string | null }[];
  /** Every candidate of the database as it is now; a run updates its entries so later candidates see earlier results. */
  otherCandidates: OtherCandidate[];
}

export interface EvaluationResult {
  brandId: string | null;
  brandText: string | null;
  categoryId: string | null;
  proposedSku: string | null;
  warnings: CandidateWarning[];
  state: string;
}

/**
 * Everything a candidate shows a reviewer, recomputed from the source record, the remembered mappings and Lucy's catalog. Lucy-owned
 * choices are kept: a brand, a category or a SKU already on the candidate (a person's decision or an earlier evaluation) is never
 * replaced. Warnings written by the picture import (`IMAGE_FAILED`, `IMAGE_SHARED`) stay while they are still true; the ones this
 * module owns are recomputed.
 */
export function evaluateCandidate(
  input: EvaluationInput,
  context: EvaluationContext,
): EvaluationResult {
  const { candidate, record } = input;
  const warnings: CandidateWarning[] = [];

  if (candidate.nameVi.trim() === '') warnings.push({ code: 'NAME_MISSING' });
  if (
    (candidate.descriptionVi ?? '').trim() === '' &&
    (candidate.descriptionEn ?? '').trim() === '' &&
    (record.descriptionText ?? '').trim() === ''
  ) {
    warnings.push({ code: 'DESCRIPTION_EMPTY' });
  }
  if (record.priceVnd === null || record.priceVnd <= 0) warnings.push({ code: 'PRICE_MISSING' });

  // SKU: a value already on the candidate wins; otherwise the proposal from the source.
  const proposed = proposeSku(record, input.host, context.skuPrefixes);
  const proposal: { sku: string | null; origin: SkuProposal['origin'] | 'CURRENT' } =
    candidate.proposedSku === null
      ? proposed
      : {
          sku: candidate.proposedSku,
          origin: candidate.proposedSku === proposed.sku ? proposed.origin : 'CURRENT',
        };
  const sku = proposal.sku !== null && proposal.sku.length <= 64 ? proposal.sku : null;
  if (proposal.sku !== null && sku === null) {
    warnings.push({
      code: 'SKU_FORMAT',
      sku: proposal.sku.slice(0, 100),
      origin: proposal.origin,
      tooLong: true,
    });
  } else {
    warnings.push(
      ...skuWarnings({
        sku,
        origin: proposal.origin,
        variants: context.variants,
        otherCandidates: context.otherCandidates,
        selfId: candidate.id,
      }),
    );
  }

  // Brand and category: a value on the candidate stays; otherwise the remembered mappings decide.
  const brandTexts = [record.brandText, candidate.brandText, ...record.categoryNames].filter(
    (text): text is string => text !== null && text.trim() !== '',
  );
  let brandId = candidate.brandId;
  let brandText = candidate.brandText;
  if (brandId === null) {
    const brand = resolveBrand(brandTexts, context.brandMappings, context.brands);
    brandId = brand.targetId;
    brandText = brand.matchedText ?? candidate.brandText ?? record.brandText;
    warnings.push(...brand.warnings);
  }
  // A text that is a brand is not offered as a category.
  const categoryTexts = record.categoryNames.filter(
    (text) => !context.brandMappings.has(foldText(text)),
  );
  let categoryId = candidate.categoryId;
  if (categoryId === null) {
    const category = resolveCategory(categoryTexts, context.categoryMappings, context.categories);
    categoryId = category.targetId;
    warnings.push(...category.warnings);
  }

  // Possible duplicates: same name and sizes as a Lucy product or another candidate (brands compared only when both are known).
  const key = nameKey(candidate.nameVi, record.attributeTexts);
  const compatible = (other: string | null) =>
    brandId === null || other === null || other === brandId;
  // Two products the reviewer already said are different are not raised again.
  const keptSeparate = input.decisions?.keptSeparate ?? new Set<string>();
  const sameProducts = context.products
    .filter((product) => compatible(product.brandId) && !keptSeparate.has(`PRODUCT:${product.id}`))
    .filter(
      (product) =>
        nameKey(product.nameVi) === key ||
        (product.nameEn !== '' && nameKey(product.nameEn) === key),
    )
    .slice(0, 5)
    .map((product) => ({ kind: 'PRODUCT', productId: product.id, name: product.nameVi }));
  const sameCandidates = context.otherCandidates
    .filter((other) => other.id !== candidate.id && !['REJECTED', 'IGNORED'].includes(other.state))
    .filter(
      (other) =>
        compatible(other.brandId) &&
        !keptSeparate.has(`CANDIDATE:${other.id}`) &&
        nameKey(other.nameVi) === key,
    )
    .slice(0, 5)
    .map((other) => ({ kind: 'CANDIDATE', candidateId: other.id, name: other.nameVi }));
  if (sameProducts.length + sameCandidates.length > 0) {
    warnings.push({ code: 'POSSIBLE_DUPLICATE', matches: [...sameProducts, ...sameCandidates] });
  }

  // Pictures: missing while none is active (a picture the reviewer dropped does not count); the picture import's own warnings stay
  // only while they are still true. A flagged picture the reviewer decided about (keep or drop) raises no warning any more.
  const decidedImages = input.decisions?.images ?? new Map<string, 'KEEP' | 'DROP'>();
  if (input.images.filter((image) => decidedImages.get(image.id) !== 'DROP').length === 0) {
    warnings.push({ code: 'IMAGE_MISSING' });
  }
  const activeUrls = new Set(input.images.map((image) => image.sourceUrl));
  const flagged = new Set(
    input.images
      .filter((image) => image.flag !== null && !decidedImages.has(image.id))
      .map((image) => image.id),
  );
  for (const old of candidate.warnings) {
    if (old.code === 'IMAGE_FAILED') {
      const url = typeof old['url'] === 'string' ? old['url'] : '';
      if (record.imageUrls.includes(url) && !activeUrls.has(url)) warnings.push(old);
    } else if (old.code === 'IMAGE_SHARED') {
      if (typeof old['imageId'] === 'string' && flagged.has(old['imageId'])) warnings.push(old);
    } else if (!(EVALUATION_CODES as readonly string[]).includes(old.code)) {
      // A warning of an unknown owner is never thrown away.
      warnings.push(old);
    }
  }

  const decided = (DECIDED_STATES as readonly string[]).includes(candidate.state);
  return {
    brandId,
    brandText,
    categoryId,
    proposedSku: candidate.proposedSku ?? sku,
    warnings,
    // Translation does not hold a candidate back (the English name starts equal to the Vietnamese one and stays flagged).
    state: decided ? candidate.state : warnings.length === 0 ? 'READY_FOR_REVIEW' : 'NEEDS_REVIEW',
  };
}
