import type { Prisma } from '@lucy-spa/database';
import type { ClaudeClient } from './claude-client.js';
import { isAiModel, vndToMicroUsd } from './prices.js';
import {
  parseProductRewrite,
  type DraftWarning,
  type ProductRewriteDraft,
} from './product-rewrite.js';
import {
  fixOptionsOf,
  repairMaxCost,
  repairOnce,
  rewriteInputOf,
  shopCity,
  snapshotOf,
} from './rewrite-engine.js';
import { fixDraft, readField, type FieldName } from './rewrite-fix.js';
import { loadAiSettings, type AiDatabase } from './spend.js';

/**
 * Claude integration CI-F1 (Owner decision of 2026-10-13, item 5): the drafts that already wait for the Owner get the same treatment as new
 * ones. Free fixes first for every pending draft (no model, no cost), then, only when asked and only where a real problem is left, the one
 * targeted repair call of that draft, through the same spending rules (switches, caps, reservation, ledger) as a new draft.
 *
 * Safe to run again and again (a second run changes nothing), safe beside the worker and the API: a draft is locked while it is read and
 * written (`FOR UPDATE SKIP LOCKED`), its row version advances by one, and a draft a person has edited is never touched (that text is the
 * Owner's own). Nothing is published: a draft stays a draft.
 *
 * Owner decision 2026-10-13 (after the first production run): the stored notes of every draft are refreshed to what the checks find now
 * (a refresh does not change the draft text), the report counts what is left per error code after the repair, and the repair
 * can be capped in VND (`maxSpendVnd`): a call whose worst-case cost does not fit in what is left of the cap is not made.
 */

/** The fields a draft must have to be applied (the catalogue refuses an empty name or search text, and an empty description would wipe the page). */
export const REQUIRED_DRAFT_FIELDS: readonly FieldName[] = [
  'descriptionVi',
  'descriptionEn',
  'nameEn',
  'seoTitleVi',
  'seoTitleEn',
  'seoDescriptionVi',
  'seoDescriptionEn',
];

export interface PendingFixOptions {
  /** Also run the targeted model call for drafts that still have a real problem after the free fixes. */
  repair: boolean;
  now?: () => Date;
  timeoutMs?: number;
  /** Stop after this many drafts (for a rehearsal). */
  limit?: number;
  /** Stop making repair calls when the next one could take the repair spending of this run past this many VND (needs the exchange rate). */
  maxSpendVnd?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface PendingFixReport {
  /** Pending drafts (ready for review) at the start. */
  pending: number;
  /** A person edited these; they are never touched. */
  skippedEdited: number;
  /** Locked by another process at that moment; run again to include them. */
  skippedBusy: number;
  /** Looked at and found nothing to fix. */
  alreadyClean: number;
  /** Changed by the free fixes (no cost). */
  fixedFree: number;
  /** Still had a real problem the code cannot fix after the free fixes. */
  needRepair: number;
  /** Repair calls made, and how many of them rewrote a field. */
  repairCalls: number;
  repaired: number;
  /** Repair wanted but nothing was spent (not asked, switches off, cap, request failed). */
  repairSkipped: number;
  /** Spent on the repair calls of this run, in micro USD (what the ledger rows `REPAIRED` and `REPAIR_FAILED` add up to). */
  repairCostMicroUsd: string;
  /** Drafts that still carry notes (informational) after the run. */
  withNotes: number;
  /** Drafts whose stored notes were brought up to date without a change to the draft. */
  notesRefreshed: number;
  /** Drafts that have an empty required field (they cannot be applied until a repair writes it). */
  blankedDrafts: number;
  /** Drafts per error code that the free fixes left for the repair (a draft counts once per code). */
  needRepairByCode: Record<string, number>;
  /** Drafts still having a real problem at the end of the run (after the repair when it ran), and their codes. */
  needRepairAfter: number;
  remainingByCode: Record<string, number>;
  /** The repair stopped because the next call did not fit in `maxSpendVnd`. */
  stoppedByBudget: boolean;
}

const noteKey = (value: unknown): string =>
  (Array.isArray(value) ? (value as unknown[]) : [])
    .flatMap((entry) =>
      isObject(entry) && typeof entry['code'] === 'string'
        ? [`${entry['code']}|${typeof entry['field'] === 'string' ? entry['field'] : ''}`]
        : [],
    )
    .sort()
    .join(';');

const tally = (into: Record<string, number>, targets: readonly { codes: readonly string[] }[]) => {
  for (const code of new Set(targets.flatMap((target) => target.codes))) {
    into[code] = (into[code] ?? 0) + 1;
  }
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A stored draft (camelCase JSON, as the engine saves it) read back into a draft, or null when it is not usable. */
export function storedDraftOf(value: unknown): ProductRewriteDraft | null {
  if (!isObject(value)) return null;
  const sections = (entry: unknown) => {
    const source = isObject(entry) ? entry : {};
    return {
      benefits: source['benefits'] ?? null,
      ingredients: source['ingredients'] ?? null,
      usage: source['usage'] ?? null,
      suitable_for: source['suitableFor'] ?? null,
    };
  };
  return parseProductRewrite({
    description_vi: value['descriptionVi'],
    sections_vi: sections(value['sectionsVi']),
    description_en: value['descriptionEn'],
    sections_en: sections(value['sectionsEn']),
    name_en: value['nameEn'],
    name_vi_suggestion: value['nameViSuggestion'] ?? null,
    seo_title_vi: value['seoTitleVi'],
    seo_title_en: value['seoTitleEn'],
    seo_description_vi: value['seoDescriptionVi'],
    seo_description_en: value['seoDescriptionEn'],
    suitable_for_inferred: value['suitableForInferred'] === true,
    facts_kept: value['factsKept'] ?? [],
    uncertain: value['uncertain'] ?? [],
    auto_fixes: value['autoFixes'] ?? [],
  });
}

/** The notes found now, plus the notes only the first write could know (a title shared with another product). */
function mergeNotes(found: DraftWarning[], stored: unknown): DraftWarning[] {
  const kept: DraftWarning[] = Array.isArray(stored)
    ? (stored as unknown[]).flatMap((entry) =>
        isObject(entry) && entry['code'] === 'SEO_DUPLICATE'
          ? [
              {
                code: 'SEO_DUPLICATE' as const,
                ...(typeof entry['field'] === 'string' ? { field: entry['field'] } : {}),
              },
            ]
          : [],
      )
    : [];
  const out = [...found];
  for (const note of kept) {
    if (!out.some((entry) => entry.code === note.code && entry.field === note.field))
      out.push(note);
  }
  return out;
}

interface PendingRow {
  id: string;
  run_id: string;
  base_snapshot: unknown;
  draft: unknown;
  warnings: unknown;
  row_version: number;
  model: string | null;
}

function inTransaction<T>(
  database: AiDatabase,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return '$transaction' in database ? database.$transaction(work) : work(database);
}

export async function fixPendingDrafts(
  database: AiDatabase,
  client: ClaudeClient | null,
  options: PendingFixOptions,
): Promise<PendingFixReport> {
  const clock = options.now ?? (() => new Date());
  const counts = await database.$queryRaw<{ edited: bigint; plain: bigint }[]>`
    SELECT count(*) FILTER (WHERE edited IS NOT NULL) AS edited, count(*) FILTER (WHERE edited IS NULL) AS plain
      FROM ai_items WHERE kind = 'PRODUCT_TEXT' AND status = 'DRAFT_READY'`;
  const ids = await database.$queryRaw<{ id: string }[]>`
    SELECT id FROM ai_items
     WHERE kind = 'PRODUCT_TEXT' AND status = 'DRAFT_READY' AND edited IS NULL
     ORDER BY created_at, id`;
  const report: PendingFixReport = {
    pending: Number(counts[0]?.edited ?? 0n) + Number(counts[0]?.plain ?? 0n),
    skippedEdited: Number(counts[0]?.edited ?? 0n),
    skippedBusy: 0,
    alreadyClean: 0,
    fixedFree: 0,
    needRepair: 0,
    repairCalls: 0,
    repaired: 0,
    repairSkipped: 0,
    repairCostMicroUsd: '0',
    withNotes: 0,
    notesRefreshed: 0,
    blankedDrafts: 0,
    needRepairByCode: {},
    needRepairAfter: 0,
    remainingByCode: {},
    stoppedByBudget: false,
  };
  let spent = 0n;
  const city = await shopCity(database);
  const todo = options.limit === undefined ? ids : ids.slice(0, options.limit);
  let done = 0;
  for (const { id } of todo) {
    done += 1;
    options.onProgress?.(done, todo.length);
    const settings = await loadAiSettings(database);
    // Free fixes: read under a lock, write under the same lock.
    const outcome = await inTransaction(database, async (tx) => {
      const rows = await tx.$queryRaw<PendingRow[]>`
        SELECT i.id, i.run_id, i.base_snapshot, i.draft, i.warnings, i.row_version, r.model
          FROM ai_items i LEFT JOIN ai_runs r ON r.id = i.run_id
         WHERE i.id = ${id}::uuid AND i.kind = 'PRODUCT_TEXT' AND i.status = 'DRAFT_READY' AND i.edited IS NULL
           FOR UPDATE OF i SKIP LOCKED`;
      const row = rows[0];
      if (row === undefined) return { kind: 'BUSY' as const };
      const snapshot = snapshotOf(row.base_snapshot);
      const draft = storedDraftOf(row.draft);
      if (snapshot === null || draft === null) return { kind: 'CLEAN' as const, notes: 0 };
      const fixOptions = fixOptionsOf(snapshot, settings);
      const fixed = fixDraft(draft, fixOptions);
      const warnings = mergeNotes(fixed.warnings, row.warnings);
      const changed = fixed.fixes.length > 0;
      const blanked = REQUIRED_DRAFT_FIELDS.some(
        (field) => (readField(fixed.draft, field) ?? '').trim() === '',
      );
      let refreshed = false;
      let version = row.row_version;
      if (changed) {
        const next = {
          ...fixed.draft,
          autoFixes: [...(draft.autoFixes ?? []), ...fixed.fixes],
        };
        await tx.$executeRaw`
          UPDATE ai_items
             SET draft = ${JSON.stringify(next)}::jsonb, warnings = ${JSON.stringify(warnings)}::jsonb,
                 row_version = row_version + 1, updated_at = clock_timestamp()
           WHERE id = ${id}::uuid`;
        version += 1;
      } else if (noteKey(row.warnings) !== noteKey(warnings)) {
        // Only the notes differ from what the checks find now: bring them up to date, the draft itself is left as it is.
        await tx.$executeRaw`
          UPDATE ai_items SET warnings = ${JSON.stringify(warnings)}::jsonb, row_version = row_version + 1, updated_at = clock_timestamp()
           WHERE id = ${id}::uuid`;
        refreshed = true;
        version += 1;
      }
      return {
        kind: 'READ' as const,
        changed,
        refreshed,
        blanked,
        version,
        runId: row.run_id,
        model: row.model,
        draft: changed
          ? { ...fixed.draft, autoFixes: [...(draft.autoFixes ?? []), ...fixed.fixes] }
          : fixed.draft,
        targets: fixed.targets,
        fixOptions,
        snapshot,
        notes: warnings.length,
      };
    });
    if (outcome.kind === 'BUSY') {
      report.skippedBusy += 1;
      continue;
    }
    if (outcome.kind === 'CLEAN') continue;
    if (outcome.changed) report.fixedFree += 1;
    else if (outcome.targets.length === 0) report.alreadyClean += 1;
    if (outcome.refreshed) report.notesRefreshed += 1;
    if (outcome.blanked) report.blankedDrafts += 1;
    let notes = outcome.notes;
    let finalTargets = outcome.targets;
    if (outcome.targets.length > 0) {
      report.needRepair += 1;
      tally(report.needRepairByCode, outcome.targets);
      const model = outcome.model;
      const input = rewriteInputOf(outcome.snapshot, settings, city, null);
      const left =
        options.maxSpendVnd === undefined
          ? null
          : (settings.vndPerUsd === null
              ? 0n
              : vndToMicroUsd(BigInt(Math.floor(options.maxSpendVnd)), settings.vndPerUsd)) - spent;
      if (!options.repair || client === null || model === null || !isAiModel(model)) {
        report.repairSkipped += 1;
      } else if (
        left !== null &&
        repairMaxCost({ input, draft: outcome.draft, targets: outcome.targets, model }) > left
      ) {
        report.stoppedByBudget = true;
        report.repairSkipped += 1;
      } else {
        const repaired = await repairOnce(database, client, {
          item: { id, runId: outcome.runId },
          model,
          settings,
          input,
          draft: outcome.draft,
          targets: outcome.targets,
          fixOptions: outcome.fixOptions,
          now: clock,
          timeoutMs: options.timeoutMs ?? 180_000,
          persist: async (tx, result) => {
            await tx.$executeRaw`
              UPDATE ai_items
                 SET draft = ${JSON.stringify(result.draft)}::jsonb, warnings = ${JSON.stringify(result.warnings)}::jsonb,
                     input_tokens = input_tokens + ${result.usage.inputTokens},
                     cache_read_tokens = cache_read_tokens + ${result.usage.cacheReadTokens},
                     cache_write_tokens = cache_write_tokens + ${result.usage.cacheWriteTokens},
                     output_tokens = output_tokens + ${result.usage.outputTokens},
                     cost_micro_usd = cost_micro_usd + ${result.cost},
                     row_version = row_version + 1, updated_at = clock_timestamp()
               WHERE id = ${id}::uuid AND status = 'DRAFT_READY' AND row_version = ${outcome.version}`;
          },
        }).catch(() => null);
        if (repaired === null) {
          report.repairSkipped += 1;
        } else {
          report.repairCalls += 1;
          spent += repaired.cost;
          if (repaired.changed) report.repaired += 1;
          notes = repaired.warnings.length;
          finalTargets = repaired.targets;
        }
      }
    }
    if (finalTargets.length > 0) {
      report.needRepairAfter += 1;
      tally(report.remainingByCode, finalTargets);
    }
    if (notes > 0) report.withNotes += 1;
  }
  report.repairCostMicroUsd = spent.toString();
  return report;
}
