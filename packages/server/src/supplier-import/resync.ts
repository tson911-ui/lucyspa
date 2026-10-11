import { canonicalJson } from './text.js';
import type { SourceProductRecord } from './woocommerce-store.js';

/**
 * Phase 9 P9-7: the pure rules of a re-sync (docs/PHASE9_PRODUCT_IMPORT.md section 10). No database, no network.
 *
 * - A scan is HEALTHY unless it failed or found fewer than 70% of the products the last healthy scan found (then it is SUSPECT:
 *   nothing is written but the scan row, so a broken adapter or an outage can never overwrite good records or mark anything removed).
 * - A product counts as missing only in a healthy scan that read the list fine and did not return it. It is raised as removed after
 *   `REMOVAL_AFTER_SCANS` such scans in a row; seeing it again resets the count. Removed only ever means "not found on this source":
 *   nothing is deleted, hidden or unpublished because of it.
 * - A change is a note for a person with the before and after of what differs (small and structured).
 */
export const HEALTHY_RATIO_PERCENT = 70;
export const REMOVAL_AFTER_SCANS = 3;
const TEXT_CLIP = 300;
const LIST_CLIP = 10;

/** Fewer than 70% of the baseline is suspect. A first scan (no baseline) and a baseline of 0 products are never suspect. */
export function isSuspectCount(found: number, baseline: number | null): boolean {
  if (baseline === null || baseline <= 0) return false;
  return found * 100 < baseline * HEALTHY_RATIO_PERCENT;
}

export interface MissingStep {
  missingScans: number;
  /** True exactly when this scan is the one that reaches the threshold (raised once, not on every later scan). */
  removed: boolean;
}

/** One more healthy scan without the product. */
export function nextMissing(previousMissingScans: number): MissingStep {
  const missingScans = previousMissingScans + 1;
  return { missingScans, removed: missingScans === REMOVAL_AFTER_SCANS };
}

/** The product is back: true when it had already been raised as removed, so the return is worth a note. */
export function returnedAfterRemoval(previousMissingScans: number): boolean {
  return previousMissingScans >= REMOVAL_AFTER_SCANS;
}

const clip = (value: string | null | undefined, max = TEXT_CLIP): string | null => {
  if (value === null || value === undefined) return null;
  return value.length > max ? `${value.slice(0, max)}…` : value;
};

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/** What the database remembers of a record before this scan. */
export interface StoredRecordView {
  name: string;
  sku: string | null;
  brandText: string | null;
  categoryPath: unknown;
  descriptionText: string | null;
  attributes: unknown;
  imageUrls: unknown;
}

export interface ContentChangeDetail {
  /** The stored fields that differ (a change in a field this source does not store, such as text without permission, lists none). */
  fields: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

/** Compares what is stored with the new read. Text beyond the name and the SKU counts only when the permission covers text. */
export function contentDiff(
  previous: StoredRecordView,
  next: SourceProductRecord,
  permitsText: boolean,
): ContentChangeDetail {
  const detail: ContentChangeDetail = { fields: [], before: {}, after: {} };
  const note = (field: string, before: unknown, after: unknown) => {
    detail.fields.push(field);
    detail.before[field] = before;
    detail.after[field] = after;
  };
  if (previous.name !== next.name) note('name', clip(previous.name), clip(next.name));
  if (previous.sku !== next.sku) note('sku', previous.sku, next.sku);
  if (!permitsText) return detail;
  if (previous.brandText !== next.brandText) {
    note('brand', clip(previous.brandText), clip(next.brandText));
  }
  const oldCategories = stringList(previous.categoryPath);
  if (canonicalJson(oldCategories) !== canonicalJson(next.categoryNames)) {
    note(
      'categories',
      oldCategories.slice(0, LIST_CLIP).map((entry) => clip(entry, 80)),
      next.categoryNames.slice(0, LIST_CLIP).map((entry) => clip(entry, 80)),
    );
  }
  if (previous.descriptionText !== next.descriptionText) {
    note('description', clip(previous.descriptionText), clip(next.descriptionText));
  }
  const newAttributes = Object.fromEntries(next.attributes.map((a) => [a.name, a.values]));
  if (canonicalJson(previous.attributes ?? {}) !== canonicalJson(newAttributes)) {
    note(
      'attributes',
      Object.keys((previous.attributes as object | null) ?? {}).length,
      next.attributes.length,
    );
  }
  return detail;
}

export interface ImageChangeDetail {
  before: number;
  after: number;
  added: string[];
  removed: string[];
}

export function imageDiff(previous: unknown, next: readonly string[]): ImageChangeDetail {
  const old = stringList(previous);
  return {
    before: old.length,
    after: next.length,
    added: next.filter((url) => !old.includes(url)).slice(0, LIST_CLIP),
    removed: old.filter((url) => !next.includes(url)).slice(0, LIST_CLIP),
  };
}

export interface PriceChangeDetail {
  before: { priceVnd: number | null; promoPriceVnd: number | null };
  after: { priceVnd: number | null; promoPriceVnd: number | null };
}

/** Counts of one scan that matter to a person (what the notice reports). */
export interface ScanChangeCounts {
  created: number;
  priceChanged: number;
  contentChanged: number;
  imageChanged: number;
  removed: number;
}

export const hasChanges = (counts: ScanChangeCounts): boolean =>
  counts.created +
    counts.priceChanged +
    counts.contentChanged +
    counts.imageChanged +
    counts.removed >
  0;

/** True when `now` is inside the off-hours window (01:00-05:00) of Vietnam (UTC+7, no daylight saving). */
export const OFF_HOURS_START = 1;
export const OFF_HOURS_END = 5;
const VIETNAM_OFFSET_HOURS = 7;

export function inOffHours(now: Date): boolean {
  const hour = (now.getUTCHours() + VIETNAM_OFFSET_HOURS) % 24;
  return hour >= OFF_HOURS_START && hour < OFF_HOURS_END;
}

export type ScheduleCadence = 'MANUAL' | 'DAILY' | 'WEEKLY';

/** Minimum time between two scans started by the schedule. Manual sources are never scheduled. */
export const CADENCE_HOURS: Record<Exclude<ScheduleCadence, 'MANUAL'>, number> = {
  DAILY: 20,
  WEEKLY: 24 * 7 - 4,
};

/**
 * Whether a source is due for a scheduled scan. `lastStartedAt` is the start of its latest scan of any kind (a failed one counts, so
 * a site that blocks us is not hit again before the next period). Only inside the off-hours window.
 */
export function isScanDue(
  cadence: ScheduleCadence,
  lastStartedAt: Date | null,
  now: Date,
): boolean {
  if (cadence === 'MANUAL') return false;
  if (!inOffHours(now)) return false;
  if (lastStartedAt === null) return true;
  return now.getTime() - lastStartedAt.getTime() >= CADENCE_HOURS[cadence] * 3_600_000;
}
