import {
  PRODUCT_TEXT_CLEANUP_BATCH_MAX,
  type ProductTextCleanupApplyEntry,
  type ProductTextCleanupApplyResponse,
  type ProductTextCleanupItem,
} from '@lucy-spa/contracts';

/** The apply entries for the products that are still included, in the preview's order. */
export function applyEntries(
  items: readonly ProductTextCleanupItem[],
  skipped: ReadonlySet<string>,
): ProductTextCleanupApplyEntry[] {
  return items
    .filter((item) => !skipped.has(item.id))
    .map((item) => ({ id: item.id, rowVersion: item.rowVersion, textHash: item.textHash }));
}

/** Calls of at most `PRODUCT_TEXT_CLEANUP_BATCH_MAX` entries (the server's limit per request). */
export function batches<T>(entries: readonly T[], size = PRODUCT_TEXT_CLEANUP_BATCH_MAX): T[][] {
  const out: T[][] = [];
  for (let from = 0; from < entries.length; from += size)
    out.push(entries.slice(from, from + size));
  return out;
}

export function sumResults(results: readonly ProductTextCleanupApplyResponse[]): {
  cleaned: number;
  skipped: number;
} {
  return {
    cleaned: results.reduce((total, result) => total + result.cleaned, 0),
    skipped: results.reduce((total, result) => total + result.skipped.length, 0),
  };
}
