import {
  AUTHENTICITY,
  CLINIC_PATTERN,
  DEFAULT_BANNED_PHRASES,
  DESCRIPTORS,
  EMOJI,
  INJECTION_SIGNS,
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
  SKIN_CONDITIONS,
  TESTIMONIAL,
  checkProductRewrite,
  known,
  norm,
  tokens,
  type AutoFix,
  type CheckOptions,
  type DraftWarning,
  type ProductRewriteDraft,
  type Sections,
  type WarningCode,
} from './product-rewrite.js';

/**
 * Claude integration CI-F1 (Owner decision of 2026-10-13, design section 15): a draft is delivered complete, so the worker fixes what the
 * checks find before the draft is saved. This file is the free half: pure code, no model, no cost. It strips what must never be there
 * (customer comments, ratings, emoji, links, markup, medical or absolute claims, the clinic word, authenticity words while they are off,
 * skin conditions in "who it suits"), enforces the length limits (the title keeps the brand and "Lucy Spa", the description ends at a
 * sentence), and brings the ingredient list back to what the supplier text lists.
 *
 * Every change is checked: the whole draft is checked again and a change that adds a warning anywhere else is undone. What the code cannot
 * repair (a field that ends up empty, a title that cannot be shortened, a wrong language) is returned as a repair target for one
 * targeted model call (`rewrite-repair.ts`). A section the supplier text has nothing for stays empty: nothing is invented to fill it.
 */

export type FieldName =
  | 'descriptionVi'
  | 'descriptionEn'
  | 'nameEn'
  | 'seoTitleVi'
  | 'seoTitleEn'
  | 'seoDescriptionVi'
  | 'seoDescriptionEn'
  | 'sectionsVi.benefits'
  | 'sectionsVi.ingredients'
  | 'sectionsVi.usage'
  | 'sectionsVi.suitableFor'
  | 'sectionsEn.benefits'
  | 'sectionsEn.ingredients'
  | 'sectionsEn.usage'
  | 'sectionsEn.suitableFor';

export const FIELD_NAMES: readonly FieldName[] = [
  'descriptionVi',
  'descriptionEn',
  'nameEn',
  'seoTitleVi',
  'seoTitleEn',
  'seoDescriptionVi',
  'seoDescriptionEn',
  'sectionsVi.benefits',
  'sectionsVi.ingredients',
  'sectionsVi.usage',
  'sectionsVi.suitableFor',
  'sectionsEn.benefits',
  'sectionsEn.ingredients',
  'sectionsEn.usage',
  'sectionsEn.suitableFor',
];

/** The fields that may be empty (the supplier text may have nothing for them); every other field is always written. */
const NULLABLE: ReadonlySet<FieldName> = new Set<FieldName>([
  'sectionsVi.benefits',
  'sectionsVi.ingredients',
  'sectionsVi.usage',
  'sectionsEn.benefits',
  'sectionsEn.ingredients',
  'sectionsEn.usage',
]);

export const isFieldName = (value: string): value is FieldName =>
  (FIELD_NAMES as readonly string[]).includes(value);

type SectionKey = keyof Sections;

export function readField(draft: ProductRewriteDraft, field: FieldName): string | null {
  if (field.startsWith('sectionsVi.')) return draft.sectionsVi[field.slice(11) as SectionKey];
  if (field.startsWith('sectionsEn.')) return draft.sectionsEn[field.slice(11) as SectionKey];
  return draft[field as Exclude<FieldName, `sections${string}`>];
}

export function withField(
  draft: ProductRewriteDraft,
  field: FieldName,
  value: string | null,
): ProductRewriteDraft {
  if (field.startsWith('sectionsVi.')) {
    return { ...draft, sectionsVi: { ...draft.sectionsVi, [field.slice(11)]: value } };
  }
  if (field.startsWith('sectionsEn.')) {
    return { ...draft, sectionsEn: { ...draft.sectionsEn, [field.slice(11)]: value } };
  }
  return { ...draft, [field]: value ?? '' };
}

export type { AutoFix };

export interface FixOptions extends CheckOptions {
  /** The raw ingredient text of the supplier (attribute or "Thành phần:" line), found by `sourceIngredients`; null when it has none. */
  ingredientList?: string | null;
}

export interface FixResult {
  draft: ProductRewriteDraft;
  fixes: AutoFix[];
  /** What the checks still find after the fixes (shown as notes). */
  warnings: DraftWarning[];
  /** The part of `warnings` a model call could still fix (see `repairTargets`). */
  targets: RepairTarget[];
}

export interface RepairTarget {
  field: FieldName;
  codes: WarningCode[];
  /** The offending phrase or fact of a warning, when the checker named one (never shown to customers). */
  details: string[];
}

// ------------------------------------------------------------------------------------------------------------------ text cleaning

const URLS = [
  /\bhttps?:\/\/\S+/gi,
  /\bwww\.\S+/gi,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  /(?:\+?84|0)(?:[\s.-]?\d){8,10}\b/g,
];
const EMOJI_ALL = new RegExp(EMOJI.source, 'gu');
const words = (text: string): number => text.split(/\s+/).filter((word) => word !== '').length;

/** One paragraph of plain text: markup, list markers, emoji, links, e-mails and phone numbers removed; lines joined into sentences. */
export function plainText(value: string): string {
  let text = value.replace(/\r\n?/g, '\n').normalize('NFC');
  text = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\*\*|__|`/g, '')
    .replace(EMOJI_ALL, '');
  for (const pattern of URLS) text = text.replace(pattern, ' ');
  text = text.replace(/\bBEGIN-DATA\b|\bEND-DATA\b/g, ' ');
  const lines = text
    .split('\n')
    .map((line) => line.replace(/^\s{0,3}(?:#{1,6}\s+|[*•-]\s+|\d+[.)]\s+)/u, '').trim())
    .filter((line) => line !== '');
  const joined = lines
    .map((line, at) => (at < lines.length - 1 && !/[.!?:;,]$/u.test(line) ? `${line}.` : line))
    .join(' ');
  return joined
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

interface Rules {
  banned: string[];
  authenticityAllowed: boolean;
  suitability: boolean;
}

/** A sentence or clause that must not stay (checked the way the checks look at it, with a space after so "treat " matches at the end). */
function offends(piece: string, rules: Rules): boolean {
  const text = `${norm(piece)} `;
  return (
    CLINIC_PATTERN.test(text) ||
    rules.banned.some((phrase) => phrase !== '' && text.includes(phrase)) ||
    (!rules.authenticityAllowed && AUTHENTICITY.some((pattern) => pattern.test(piece))) ||
    TESTIMONIAL.some((pattern) => pattern.test(piece)) ||
    INJECTION_SIGNS.some((pattern) => pattern.test(piece)) ||
    (rules.suitability && SKIN_CONDITIONS.some((pattern) => pattern.test(piece)))
  );
}

const capitalize = (text: string): string =>
  text === '' ? text : text.charAt(0).toLocaleUpperCase('vi') + text.slice(1);

/** Drops the sentences, or only the clauses of a sentence, that carry a claim or a comment; what is left reads as a sentence. */
function dropOffending(value: string, rules: Rules): string {
  const sentences = value.split(/(?<=[.!?])\s+/u).filter((sentence) => sentence !== '');
  const kept: string[] = [];
  for (const sentence of sentences) {
    if (!offends(sentence, rules)) {
      kept.push(sentence);
      continue;
    }
    const clauses = sentence
      .replace(/[.!?]+$/u, '')
      .split(/\s*[,;–—]\s*/u)
      .filter((clause) => !offends(clause, rules));
    const rest = clauses
      .join(', ')
      .replace(/^(?:và|and|nhưng|but|còn|also|đồng thời)\s+/iu, '')
      .trim();
    if (words(rest) >= 4) kept.push(`${capitalize(rest)}.`);
  }
  return kept.join(' ');
}

/** The title shortened at a word, the brand and the "Lucy Spa" ending kept; null when that cannot be done within the limit. */
export function shortenTitle(value: string, brand: string | null): string | null {
  const text = value.normalize('NFC').trim();
  if ([...text].length <= SEO_TITLE_MAX) return text;
  const match = /^(.*?)(\s*[|–—-]\s*Lucy Spa)\s*$/iu.exec(text);
  const head = match?.[1] ?? text;
  const tail = match?.[2] ?? '';
  if (brand !== null && !norm(head).includes(norm(brand))) return null;
  const parts = head.split(/\s+/u);
  // The brand's words and the words with a digit (the size) stay; the others go from the end of the name towards its start.
  const brandWords = new Set(brand === null ? [] : norm(brand).split(/\s+/u));
  const keeps = (word: string) =>
    /\d/u.test(word) || brandWords.has(norm(word).replace(/[^\p{L}\p{N}]/gu, ''));
  for (;;) {
    let at = parts.length - 1;
    while (at >= 0 && keeps(parts[at] ?? '')) at -= 1;
    if (at < 0) return null;
    parts.splice(at, 1);
    const candidate = parts.join(' ').replace(/[\s,;:|–—-]+$/u, '');
    const title = `${candidate}${tail}`;
    if ([...title].length <= SEO_TITLE_MAX) return title;
  }
}

/** The description cut at the last whole sentence, else the last clause, else the last word that fits, and closed with a full stop. */
export function shortenDescription(value: string): string {
  const text = value.normalize('NFC').trim();
  const chars = [...text];
  if (chars.length <= SEO_DESCRIPTION_MAX) return text;
  const fit = (limit: number) => chars.slice(0, limit).join('');
  const room = fit(SEO_DESCRIPTION_MAX);
  const sentenceEnd = Math.max(
    room.lastIndexOf('. '),
    room.lastIndexOf('! '),
    room.lastIndexOf('? '),
  );
  if (sentenceEnd >= 60) return room.slice(0, sentenceEnd + 1);
  const closed = fit(SEO_DESCRIPTION_MAX - 1);
  const clauseEnd = Math.max(closed.lastIndexOf(', '), closed.lastIndexOf('; '));
  if (clauseEnd >= 60) return `${closed.slice(0, clauseEnd)}.`;
  const wordEnd = closed.lastIndexOf(' ');
  return `${closed.slice(0, wordEnd > 0 ? wordEnd : closed.length).replace(/[\s,;:]+$/u, '')}.`;
}

// ------------------------------------------------------------------------------------------------------------------ ingredients

/** The supplier's own ingredient list, as one line: an attribute named "Thành phần"/"Ingredients", else a line "Thành phần: ...". */
export function sourceIngredients(
  supplierText: string,
  attributes: readonly { name: string; values: readonly string[] }[],
): string | null {
  const fold = (text: string) =>
    text.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();
  const attribute = attributes.find((entry) => /thanh phan|ingredient/.test(fold(entry.name)));
  const raw =
    attribute !== undefined && attribute.values.length > 0
      ? attribute.values.join(', ')
      : (/(?:thành phần(?: chính)?|ingredients?)\s*[:：]\s*([^\n]+)/iu.exec(supplierText)?.[1] ??
        '');
  const cleaned = plainText(raw)
    .replace(/[™®©]/gu, '')
    .replace(/[.\s]+$/u, '')
    .trim();
  return cleaned.length >= 4 ? cleaned : null;
}

const listItems = (list: string): string[] =>
  list
    .split(/[,;]| và | and /u)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');

/** Keeps the draft's ingredient items that the source knows (by name, in either language); falls back to the source's own list. */
function fixIngredients(
  list: string,
  options: FixOptions,
  sourceTokens: readonly string[],
): string | null {
  const keep = listItems(list).filter((item) => {
    const itemWords = tokens(item).filter((word) => word.length >= 3 && !DESCRIPTORS.has(word));
    return itemWords.every((word) => known(word, sourceTokens));
  });
  if (keep.length > 0) return `${keep.join(', ')}.`;
  const own = options.ingredientList ?? null;
  return own === null ? null : `${own}.`;
}

// ------------------------------------------------------------------------------------------------------------------ the pass

const key = (warning: DraftWarning): string => `${warning.code}|${warning.field ?? ''}`;

/**
 * A change is kept when it leaves the other fields no worse and the changed field with no more warnings than before. A field that ends up
 * empty swaps its old warning for EMPTY_FIELD (a repair target), which is not worse.
 */
function acceptable(before: DraftWarning[], after: DraftWarning[], field: string): boolean {
  // Notes that stay notes (like a title shared with another product) never stop a fix.
  const real = (list: DraftWarning[]) => list.filter((warning) => !isInformational(warning.code));
  const others = (list: DraftWarning[]) =>
    new Set(
      real(list)
        .filter((warning) => warning.field !== field)
        .map(key),
    );
  const had = others(before);
  if ([...others(after)].some((entry) => !had.has(entry))) return false;
  return (
    real(after).filter((warning) => warning.field === field).length <=
    real(before).filter((warning) => warning.field === field).length
  );
}

const REPAIRABLE: ReadonlySet<WarningCode> = new Set<WarningCode>([
  'CLINIC_WORD',
  'FORBIDDEN_PHRASE',
  'AUTHENTICITY_CLAIM',
  'TESTIMONIAL',
  'URL_OR_CONTACT',
  'MARKUP_OR_EMOJI',
  'INJECTION_SIGN',
  'SEO_TITLE_LONG',
  'SEO_DESCRIPTION_LONG',
  'WRONG_LANGUAGE',
  'EMPTY_FIELD',
  'BRAND_CHANGED',
  'SUITABILITY_CONDITION',
  'INGREDIENT_ADDED',
]);

/** Notes that stay notes: how like the supplier text it is, a title shared with another product, a fact of the source not repeated. */
export const isInformational = (code: WarningCode): boolean => !REPAIRABLE.has(code);

/** The failing fields a model call may rewrite: warnings of a repairable kind, by field. */
export function repairTargets(warnings: readonly DraftWarning[]): RepairTarget[] {
  const byField = new Map<FieldName, RepairTarget>();
  for (const warning of warnings) {
    if (!REPAIRABLE.has(warning.code)) continue;
    const field: FieldName | null =
      warning.field !== undefined && isFieldName(warning.field)
        ? warning.field
        : warning.code === 'INGREDIENT_ADDED'
          ? 'sectionsVi.ingredients'
          : null;
    if (field === null) continue;
    const target = byField.get(field) ?? { field, codes: [], details: [] };
    if (!target.codes.includes(warning.code)) target.codes.push(warning.code);
    if (warning.detail !== undefined) target.details.push(warning.detail);
    byField.set(field, target);
  }
  return [...byField.values()];
}

/** Applies every free fix to a draft. Never changes the official name or a number; never adds words the supplier did not write. */
export function fixDraft(input: ProductRewriteDraft, options: FixOptions): FixResult {
  let draft = input;
  const fixes: AutoFix[] = [];
  const rules = (suitability: boolean): Rules => ({
    banned: [...DEFAULT_BANNED_PHRASES, ...options.bannedPhrases].map((phrase) => norm(phrase)),
    authenticityAllowed: options.authenticityClaimsAllowed,
    suitability,
  });
  let warnings = checkProductRewrite(draft, options);

  const attempt = (
    field: FieldName,
    value: string | null,
    code: AutoFix['code'] | null,
  ): boolean => {
    const before = readField(draft, field);
    if (value === before) return false;
    const candidate = withField(draft, field, value);
    const after = checkProductRewrite(candidate, options);
    if (!acceptable(warnings, after, field)) return false;
    const gone = warnings.filter(
      (warning) => warning.field === field && !after.some((entry) => key(entry) === key(warning)),
    );
    draft = candidate;
    warnings = after;
    const codes: AutoFix['code'][] =
      code !== null ? [code] : gone.length > 0 ? gone.map((warning) => warning.code) : ['LENGTH'];
    for (const entry of codes) fixes.push({ code: entry, field, how: 'CODE' });
    return true;
  };

  // 1. Text hygiene and claims, field by field.
  for (const field of FIELD_NAMES) {
    const value = readField(draft, field);
    if (value === null || value === '') continue;
    let text = plainText(value);
    text = dropOffending(text, rules(field.endsWith('.suitableFor')));
    if (text === value) continue;
    if (text === '' && NULLABLE.has(field)) {
      attempt(field, null, null);
    } else {
      attempt(field, text, null);
    }
  }

  // 2. Ingredients: only what the supplier text lists.
  const sourceTokens = tokens(
    `${options.supplierText} ${options.attributes.map((a) => `${a.name} ${a.values.join(' ')}`).join(' ')}`,
  );
  for (const field of ['sectionsVi.ingredients', 'sectionsEn.ingredients'] as const) {
    const value = readField(draft, field);
    const flagged = warnings.some(
      (warning) =>
        warning.code === 'INGREDIENT_ADDED' &&
        (warning.field === field ||
          (warning.field === undefined && field === 'sectionsVi.ingredients')),
    );
    if (value === null || !flagged) continue;
    if (field === 'sectionsEn.ingredients') {
      // The English list is never longer than the Vietnamese one: cut it to the same number of items.
      const vi = readField(draft, 'sectionsVi.ingredients');
      const count = vi === null ? 0 : listItems(vi).length;
      attempt(
        field,
        count === 0 ? null : `${listItems(value).slice(0, count).join(', ')}.`,
        'INGREDIENTS',
      );
    } else {
      attempt(field, fixIngredients(value, options, sourceTokens), 'INGREDIENTS');
    }
  }

  // 3. Lengths.
  for (const field of ['seoTitleVi', 'seoTitleEn'] as const) {
    const value = readField(draft, field);
    if (value === null || [...value].length <= SEO_TITLE_MAX) continue;
    const shorter = shortenTitle(value, options.brand);
    if (shorter !== null) attempt(field, shorter, 'SEO_TITLE_LONG');
  }
  for (const field of ['seoDescriptionVi', 'seoDescriptionEn'] as const) {
    const value = readField(draft, field);
    if (value === null || [...value].length <= SEO_DESCRIPTION_MAX) continue;
    attempt(field, shortenDescription(value), 'SEO_DESCRIPTION_LONG');
  }

  // 4. The brand in the English name, and the suggested Vietnamese name (only a light clean-up; dropped when it lost the brand).
  const brand = options.brand;
  if (
    brand !== null &&
    warnings.some((warning) => warning.code === 'BRAND_CHANGED' && warning.field === 'nameEn')
  ) {
    attempt('nameEn', `${brand} ${draft.nameEn}`.trim(), 'BRAND_CHANGED');
  }
  if (
    draft.nameViSuggestion !== null &&
    warnings.some((warning) => warning.field === 'nameViSuggestion')
  ) {
    draft = { ...draft, nameViSuggestion: null };
    warnings = checkProductRewrite(draft, options);
    fixes.push({ code: 'NAME', field: 'nameViSuggestion', how: 'CODE' });
  }
  return { draft, fixes, warnings, targets: repairTargets(warnings) };
}
