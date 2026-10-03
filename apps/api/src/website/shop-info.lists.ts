import {
  SHOP_FACT_ICONS,
  WHY_ICONS,
  type PublicFact,
  type PublicFeaturedGroup,
  type PublicWhy,
  type WebsiteWhyCard,
  type WhyIcon,
  type ShopFactIcon,
  type ShopFactKind,
  type WebsiteFeaturedGroup,
  type WebsiteShopFact,
} from '@lucy-spa/contracts';
import { AuthError } from '../auth/auth.error.js';
import { pick, textField, UUID, type PublicLocale } from './popup.core.js';

/**
 * The two small ordered lists the Owner edits with the shop profile (Owner review 2026-10-04): the facts strip of the
 * home page and the featured service groups. They live as JSON on the one-row profile table, so one versioned save
 * covers them. Requests are checked strictly (the first problem is named `facts` / `featuredGroups`); what is stored
 * is read back tolerantly, so a bad row can never break the public page.
 */
export const LIST_LIMITS = Object.freeze({
  facts: 16,
  factText: 80,
  groups: 12,
  groupDescription: 120,
  whyCards: 12,
  whyTitle: 80,
  whyHeading: 60,
  whyDescription: 200,
});

const BUILT_INS: ReadonlyArray<{ id: string; kind: ShopFactKind; icon: ShopFactIcon }> = [
  { id: 'hours', kind: 'HOURS', icon: 'clock' },
  { id: 'address', kind: 'ADDRESS', icon: 'map-pin' },
  { id: 'hotline', kind: 'HOTLINE', icon: 'phone' },
];
const KINDS: ReadonlySet<string> = new Set(['HOURS', 'ADDRESS', 'HOTLINE', 'CUSTOM']);
const ICONS: ReadonlySet<string> = new Set(SHOP_FACT_ICONS);
const GROUP_CODE = /^[A-Za-z0-9_-]{1,64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `strict` throws on the first problem; otherwise a bad entry is simply left out. */
function factsOf(input: unknown, strict: boolean): WebsiteShopFact[] {
  const fail = (): never => {
    throw new AuthError('VALIDATION_FAILED', 'facts');
  };
  if (!Array.isArray(input) && strict) fail();
  if (Array.isArray(input) && input.length > LIST_LIMITS.facts && strict) fail();
  // Stored data that is not a list (or too long) still leaves the three built-in items.
  const raw: unknown[] = Array.isArray(input) ? input.slice(0, LIST_LIMITS.facts) : [];
  const seen = new Set<string>();
  const facts: WebsiteShopFact[] = [];
  for (const item of raw) {
    try {
      if (!isRecord(item) || typeof item['visible'] !== 'boolean') throw fail();
      const kind = item['kind'];
      if (typeof kind !== 'string' || !KINDS.has(kind)) throw fail();
      const builtIn = BUILT_INS.find((entry) => entry.kind === kind);
      if (builtIn) {
        if (item['id'] !== builtIn.id || seen.has(builtIn.id)) throw fail();
        seen.add(builtIn.id);
        facts.push({
          id: builtIn.id,
          kind: builtIn.kind,
          visible: item['visible'],
          icon: null,
          textVi: null,
          textEn: null,
        });
        continue;
      }
      const id = typeof item['id'] === 'string' ? item['id'].toLowerCase() : '';
      if (!UUID.test(id) || seen.has(id)) throw fail();
      const icon = item['icon'];
      if (typeof icon !== 'string' || !ICONS.has(icon)) throw fail();
      const textVi = textField(item['textVi'], 'facts', LIST_LIMITS.factText);
      const textEn = textField(item['textEn'], 'facts', LIST_LIMITS.factText);
      if (textVi === null || textEn === null) throw fail();
      seen.add(id);
      facts.push({
        id,
        kind: 'CUSTOM',
        visible: item['visible'],
        icon: icon as ShopFactIcon,
        textVi,
        textEn,
      });
    } catch (error) {
      if (strict) throw error;
    }
  }
  // The built-in items cannot be deleted: one that is missing comes back, visible, at the end.
  for (const builtIn of BUILT_INS) {
    if (!seen.has(builtIn.id)) {
      facts.push({
        id: builtIn.id,
        kind: builtIn.kind,
        visible: true,
        icon: null,
        textVi: null,
        textEn: null,
      });
    }
  }
  return facts;
}

/** A request's list: strict. */
export const parseFacts = (raw: unknown): WebsiteShopFact[] => factsOf(raw, true);
/** The stored list: tolerant, and the three built-in items are always there (an empty list is the default). */
export const readFacts = (stored: unknown): WebsiteShopFact[] => factsOf(stored, false);

function groupsOf(raw: unknown, strict: boolean): WebsiteFeaturedGroup[] {
  const fail = (): never => {
    throw new AuthError('VALIDATION_FAILED', 'featuredGroups');
  };
  if (!Array.isArray(raw)) return strict ? fail() : [];
  if (raw.length > LIST_LIMITS.groups) return strict ? fail() : [];
  const seen = new Set<string>();
  const groups: WebsiteFeaturedGroup[] = [];
  for (const item of raw) {
    try {
      if (!isRecord(item) || typeof item['code'] !== 'string' || !GROUP_CODE.test(item['code'])) {
        throw fail();
      }
      if (seen.has(item['code'])) throw fail();
      const descriptionVi = textField(
        item['descriptionVi'],
        'featuredGroups',
        LIST_LIMITS.groupDescription,
      );
      const descriptionEn = textField(
        item['descriptionEn'],
        'featuredGroups',
        LIST_LIMITS.groupDescription,
      );
      seen.add(item['code']);
      groups.push({ code: item['code'], descriptionVi, descriptionEn });
    } catch (error) {
      if (strict) throw error;
    }
  }
  return groups;
}

export const parseFeaturedGroups = (raw: unknown): WebsiteFeaturedGroup[] => groupsOf(raw, true);
export const readFeaturedGroups = (stored: unknown): WebsiteFeaturedGroup[] =>
  groupsOf(stored, false);

/** What a visitor gets: nothing at all when the strip is off, hidden items left out, text only in their language. */
export function publicFacts(
  visible: boolean,
  facts: readonly WebsiteShopFact[],
  locale: PublicLocale,
): PublicFact[] {
  if (!visible) return [];
  const result: PublicFact[] = [];
  for (const fact of facts) {
    if (!fact.visible) continue;
    if (fact.kind === 'CUSTOM') {
      const text = pick(fact.textVi, fact.textEn, locale);
      if (text !== null && fact.icon !== null)
        result.push({ kind: 'CUSTOM', icon: fact.icon, text });
      continue;
    }
    const builtIn = BUILT_INS.find((entry) => entry.kind === fact.kind);
    if (builtIn) result.push({ kind: fact.kind, icon: builtIn.icon, text: null });
  }
  return result;
}

/** The chosen groups that still exist (`existing` = codes of the live catalogue groups), in the Owner's order. */
export function publicFeaturedGroups(
  groups: readonly WebsiteFeaturedGroup[],
  existing: ReadonlySet<string>,
  locale: PublicLocale,
): PublicFeaturedGroup[] {
  return groups
    .filter((group) => existing.has(group.code))
    .map((group) => ({
      code: group.code,
      // Never the other language's description: null lets the site show none.
      description: locale === 'vi' ? group.descriptionVi : group.descriptionEn,
    }));
}

const WHY_ICON_SET: ReadonlySet<string> = new Set(WHY_ICONS);

function whyCardsOf(input: unknown, strict: boolean): WebsiteWhyCard[] {
  const fail = (): never => {
    throw new AuthError('VALIDATION_FAILED', 'whyCards');
  };
  if (!Array.isArray(input) && strict) fail();
  if (Array.isArray(input) && input.length > LIST_LIMITS.whyCards && strict) fail();
  const raw: unknown[] = Array.isArray(input) ? input.slice(0, LIST_LIMITS.whyCards) : [];
  const seen = new Set<string>();
  const cards: WebsiteWhyCard[] = [];
  for (const item of raw) {
    try {
      if (!isRecord(item)) throw fail();
      const id = typeof item['id'] === 'string' ? item['id'].toLowerCase() : '';
      if (!UUID.test(id) || seen.has(id)) throw fail();
      const icon = item['icon'];
      if (typeof icon !== 'string' || !WHY_ICON_SET.has(icon)) throw fail();
      const headingVi = textField(item['headingVi'], 'whyCards', LIST_LIMITS.whyHeading);
      const headingEn = textField(item['headingEn'], 'whyCards', LIST_LIMITS.whyHeading);
      const descriptionVi = textField(
        item['descriptionVi'],
        'whyCards',
        LIST_LIMITS.whyDescription,
      );
      const descriptionEn = textField(
        item['descriptionEn'],
        'whyCards',
        LIST_LIMITS.whyDescription,
      );
      if (
        headingVi === null ||
        headingEn === null ||
        descriptionVi === null ||
        descriptionEn === null
      ) {
        throw fail();
      }
      seen.add(id);
      cards.push({
        id,
        icon: icon as WhyIcon,
        headingVi,
        headingEn,
        descriptionVi,
        descriptionEn,
      });
    } catch (error) {
      if (strict) throw error;
    }
  }
  return cards;
}

/** A request's cards: strict, every text in both languages. */
export const parseWhyCards = (raw: unknown): WebsiteWhyCard[] => whyCardsOf(raw, true);
export const readWhyCards = (stored: unknown): WebsiteWhyCard[] => whyCardsOf(stored, false);

/** The section's title in the request: optional text, 1-80 characters. */
export const parseWhyTitle = (value: unknown, field: string): string | null =>
  textField(value, field, LIST_LIMITS.whyTitle);

/**
 * What a visitor gets: the section only while it is on, has a title and at least one card (nothing is shown half-filled).
 * Each text is in the visitor's language; both languages are required on save, so nothing is ever borrowed.
 */
export function publicWhy(
  visible: boolean,
  titleVi: string | null,
  titleEn: string | null,
  cards: readonly WebsiteWhyCard[],
  locale: PublicLocale,
): PublicWhy | null {
  const title = locale === 'vi' ? titleVi : titleEn;
  if (!visible || title === null || cards.length === 0) return null;
  return {
    title,
    cards: cards.map((card) => ({
      icon: card.icon,
      heading: locale === 'vi' ? card.headingVi : card.headingEn,
      description: locale === 'vi' ? card.descriptionVi : card.descriptionEn,
    })),
  };
}
