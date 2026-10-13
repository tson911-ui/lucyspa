import type { Prisma } from '@lucy-spa/database';
import type { AiDatabase } from './spend.js';

/**
 * Claude integration (Owner decision 2026-10-13, item 6): the data fix for products whose applied draft left a field empty. Until the
 * fix of the same day, the free fixes could blank a field that held the product's official name, so a draft applied before the Owner
 * heard of it may have written an empty description or an empty "who it suits". This restores such a field with no model and no cost:
 * from the product's own value before the apply (the before-values kept in the audit trail of that apply), or, for a description, from the
 * official name. Search texts are optional, so one is restored only when the audit shows it had a value before. Of the sections only "who it suits" is restored (the others may legitimately be empty).
 *
 * Dry run by default: it only counts. With `apply` each product is changed in its own transaction, under a lock, with one audit event that
 * keeps the old and the new values. It never touches: a draft a person edited, a product whose text is not marked as written by the AI, or a
 * product changed by anyone after the apply (its row version moved). Safe to run again.
 */

export interface BlankFixOptions {
  apply: boolean;
  limit?: number;
  now?: () => Date;
}

export interface BlankFixReport {
  /** Applied product drafts looked at. */
  appliedItems: number;
  /** Products with at least one field this fix could restore or that stays empty. */
  productsWithBlank: number;
  /** Fields per name (`descriptionVi`, `sectionsVi.suitableFor`, ...). */
  blankByField: Record<string, number>;
  /** Fields this run restores (or would, in a dry run) from the value before the apply and from the official name; and fields nothing can restore (reported, left empty). */
  fromBefore: number;
  fromName: number;
  unrestorable: number;
  /** Blank, but not touched, and why. */
  skippedEdited: number;
  skippedManual: number;
  skippedChanged: number;
  /** With `apply`: products and fields written. */
  restoredProducts: number;
  restoredFields: number;
}

type TextField =
  | 'descriptionVi'
  | 'descriptionEn'
  | 'seoTitleVi'
  | 'seoTitleEn'
  | 'seoDescriptionVi'
  | 'seoDescriptionEn';
const COLUMN = {
  descriptionVi: 'description_vi',
  descriptionEn: 'description_en',
  seoTitleVi: 'seo_title_vi',
  seoTitleEn: 'seo_title_en',
  seoDescriptionVi: 'seo_description_vi',
  seoDescriptionEn: 'seo_description_en',
} as const satisfies Record<TextField, keyof BlankFixRow>;
const SECTION_KEYS = ['benefits', 'ingredients', 'usage', 'suitableFor'] as const;
type SectionKey = (typeof SECTION_KEYS)[number];
type Language = 'Vi' | 'En';

export interface BlankFixRow {
  item_id: string;
  product_id: string;
  base_row_version: number;
  edited: boolean;
  row_version: number;
  content_origin: string;
  name_vi: string;
  name_en: string;
  description_vi: string | null;
  description_en: string | null;
  description_sections_vi: unknown;
  description_sections_en: unknown;
  seo_title_vi: string | null;
  seo_title_en: string | null;
  seo_description_vi: string | null;
  seo_description_en: string | null;
  before: unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const blank = (value: unknown): boolean => typeof value !== 'string' || value.trim() === '';
const text = (value: unknown): string | null => (blank(value) ? null : (value as string));

interface Plan {
  text: Partial<Record<TextField, { value: string; from: 'BEFORE' | 'NAME' }>>;
  sections: Record<Language, Partial<Record<SectionKey, string>>>;
  unrestorable: string[];
}

/** What is empty now and what could fill it. Pure: reads the row and the before-values of the apply. */
export function planBlankFix(row: BlankFixRow): Plan {
  const before = isObject(row.before) ? row.before : {};
  const plan: Plan = { text: {}, sections: { Vi: {}, En: {} }, unrestorable: [] };
  const current: Record<TextField, string | null> = {
    descriptionVi: row.description_vi,
    descriptionEn: row.description_en,
    seoTitleVi: row.seo_title_vi,
    seoTitleEn: row.seo_title_en,
    seoDescriptionVi: row.seo_description_vi,
    seoDescriptionEn: row.seo_description_en,
  };
  for (const field of Object.keys(current) as TextField[]) {
    if (!blank(current[field])) continue;
    const earlier = text(before[field]);
    if (earlier !== null) {
      plan.text[field] = { value: earlier, from: 'BEFORE' };
    } else if (field === 'descriptionVi') {
      plan.text[field] = { value: row.name_vi, from: 'NAME' };
    } else if (field === 'descriptionEn') {
      plan.text[field] = { value: row.name_en, from: 'NAME' };
    }
    // A search text with no earlier value stays empty on purpose: the page falls back to its own default.
  }
  for (const language of ['Vi', 'En'] as const) {
    const now = isObject(
      language === 'Vi' ? row.description_sections_vi : row.description_sections_en,
    )
      ? ((language === 'Vi' ? row.description_sections_vi : row.description_sections_en) as Record<
          string,
          unknown
        >)
      : {};
    const earlier = isObject(before[`sections${language}`])
      ? (before[`sections${language}`] as Record<string, unknown>)
      : {};
    for (const key of SECTION_KEYS) {
      // Only "who it suits" is always written. An empty benefits, ingredients or usage section is a valid result (the supplier text may have
      // nothing for it), and an older value may be supplier copy that the review cleanup removed, so those are never restored.
      if (key !== 'suitableFor' || !blank(now[key])) continue;
      const value = text(earlier[key]);
      if (value !== null) plan.sections[language][key] = value;
      else if (key === 'suitableFor') plan.unrestorable.push(`sections${language}.suitableFor`);
    }
  }
  return plan;
}

const planFields = (plan: Plan): string[] => [
  ...Object.keys(plan.text),
  ...(['Vi', 'En'] as const).flatMap((language) =>
    Object.keys(plan.sections[language]).map((key) => `sections${language}.${key}`),
  ),
];

function inTransaction<T>(
  database: AiDatabase,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return '$transaction' in database ? database.$transaction(work) : work(database);
}

export async function fixBlankedFields(
  database: AiDatabase,
  options: BlankFixOptions,
): Promise<BlankFixReport> {
  const rows = await database.$queryRaw<BlankFixRow[]>`
    SELECT i.id::text AS item_id, i.target_id::text AS product_id, i.base_row_version, (i.edited IS NOT NULL) AS edited,
           p.row_version, p.content_origin::text AS content_origin, p.name_vi, p.name_en,
           p.description_vi, p.description_en, p.description_sections_vi, p.description_sections_en,
           p.seo_title_vi, p.seo_title_en, p.seo_description_vi, p.seo_description_en, a.before
      FROM ai_items i
      JOIN products p ON p.id = i.target_id
      LEFT JOIN LATERAL (
        SELECT e.before FROM audit_events e
         WHERE e.action = 'AI_DRAFT_APPLIED' AND e.entity_id = i.target_id::text AND e.after ->> 'aiItemId' = i.id::text
         ORDER BY e.occurred_at DESC LIMIT 1
      ) a ON true
     WHERE i.kind = 'PRODUCT_TEXT' AND i.status = 'APPLIED'
     ORDER BY i.applied_at, i.id`;
  const report: BlankFixReport = {
    appliedItems: rows.length,
    productsWithBlank: 0,
    blankByField: {},
    fromBefore: 0,
    fromName: 0,
    unrestorable: 0,
    skippedEdited: 0,
    skippedManual: 0,
    skippedChanged: 0,
    restoredProducts: 0,
    restoredFields: 0,
  };
  const clock = options.now ?? (() => new Date());
  let seen = 0;
  for (const row of rows) {
    const plan = planBlankFix(row);
    const fields = planFields(plan);
    if (fields.length === 0 && plan.unrestorable.length === 0) continue;
    report.productsWithBlank += 1;
    for (const field of [...fields, ...plan.unrestorable]) {
      report.blankByField[field] = (report.blankByField[field] ?? 0) + 1;
    }
    report.unrestorable += plan.unrestorable.length;
    if (fields.length === 0) continue;
    if (row.edited) {
      report.skippedEdited += 1;
      continue;
    }
    if (row.content_origin !== 'LUCY_AI') {
      report.skippedManual += 1;
      continue;
    }
    // An apply moves the row version by exactly one; anything else means a person or a pass changed the product since.
    if (row.row_version !== row.base_row_version + 1) {
      report.skippedChanged += 1;
      continue;
    }
    // What this run would write (products left alone for a reason above are not counted here).
    for (const entry of Object.values(plan.text)) {
      if (entry.from === 'BEFORE') report.fromBefore += 1;
      else report.fromName += 1;
    }
    report.fromBefore += (['Vi', 'En'] as const).reduce(
      (sum, language) => sum + Object.keys(plan.sections[language]).length,
      0,
    );
    if (!options.apply) continue;
    if (options.limit !== undefined && seen >= options.limit) continue;
    seen += 1;
    const written = await inTransaction(database, async (tx) => {
      const locked = await tx.$queryRaw<{ row_version: number }[]>`
        SELECT row_version FROM products WHERE id = ${row.product_id}::uuid FOR UPDATE`;
      if (locked[0]?.row_version !== row.row_version) return 0;
      const data: Prisma.ProductUncheckedUpdateInput = { rowVersion: row.row_version + 1 };
      const old: Record<string, unknown> = {};
      const next: Record<string, unknown> = {};
      for (const [field, entry] of Object.entries(plan.text) as [
        TextField,
        { value: string; from: string },
      ][]) {
        old[field] = row[COLUMN[field]];
        next[field] = { value: entry.value, from: entry.from };
        data[field] = entry.value;
      }
      for (const language of ['Vi', 'En'] as const) {
        const restore = plan.sections[language];
        if (Object.keys(restore).length === 0) continue;
        const now = isObject(
          language === 'Vi' ? row.description_sections_vi : row.description_sections_en,
        )
          ? ((language === 'Vi'
              ? row.description_sections_vi
              : row.description_sections_en) as Record<string, unknown>)
          : {};
        const merged: Record<string, string | null> = {};
        for (const key of SECTION_KEYS) merged[key] = text(now[key]) ?? null;
        for (const [key, value] of Object.entries(restore)) merged[key] = value;
        old[`sections${language}`] = now;
        next[`sections${language}`] = merged;
        data[language === 'Vi' ? 'descriptionSectionsVi' : 'descriptionSectionsEn'] =
          merged as Prisma.InputJsonObject;
      }
      await tx.product.update({ where: { id: row.product_id }, data });
      await tx.auditEvent.create({
        data: {
          action: 'AI_BLANK_FIELDS_RESTORED',
          actorKind: 'SYSTEM',
          entityType: 'Product',
          entityId: row.product_id,
          occurredAt: clock(),
          reason:
            'Fields left empty by an applied draft restored from the value before the apply or the official name (Owner decision 2026-10-13); no model used.',
          before: old as Prisma.InputJsonObject,
          after: { ...next, aiItemId: row.item_id } as Prisma.InputJsonObject,
          dataClassification: 'STANDARD',
        },
        select: { id: true },
      });
      return fields.length;
    });
    if (written === 0) {
      report.skippedChanged += 1;
    } else {
      report.restoredProducts += 1;
      report.restoredFields += written;
    }
  }
  return report;
}
