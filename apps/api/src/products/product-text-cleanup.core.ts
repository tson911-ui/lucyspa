import {
  PRODUCT_TEXT_CLEANUP_BATCH_MAX,
  PRODUCT_TEXT_CLEANUP_PREVIEW_MAX,
  type ProductTextCleanupApplyRequest,
  type ProductTextCleanupApplyResponse,
  type ProductTextCleanupDetailResponse,
  type ProductTextCleanupItem,
  type ProductTextCleanupPreviewResponse,
  type ProductTextCleanupSkipReason,
} from '@lucy-spa/contracts';
import { sha256Text, stripSupplierReviewText } from '@lucy-spa/server';
import { randomUUID } from 'node:crypto';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import * as input from './product-catalog.input.js';
import { requireManage } from './product-catalog.present.js';

/**
 * Claude integration CI-0b (`docs/PHASE_CLAUDE_INTEGRATION.md` section 3.3): removes the supplier's customer comments that earlier
 * imports copied into `products.description_vi`. Authority: `MANAGE_PRODUCTS`, GLOBAL (the catalog rule). A preview (read only) lists
 * the products the cleaning rule would change; the apply recomputes the same cleaning under a row lock and writes only
 * `description_vi` of a product that has NOT changed since the preview (same row version and same text hash). Every changed product
 * gets its own audit event with the full before and after text (the removed text stays recoverable; nothing is deleted from history),
 * and one summary event per call. Cleaning an already clean product writes nothing, so a second click finds nothing to do.
 */

/** Products read for one preview; the catalog is a few hundred rows, this is a sanity limit on the scan. */
const SCAN_LIMIT = 5_000;

interface Cleaned {
  text: string;
  removedEntries: number;
  removedChars: number;
  removedLines: string[];
}

/** The lines of `before` that are not in `after`, in order (the cleaning only ever removes whole lines). */
function removedLinesOf(before: string, after: string): string[] {
  const kept = after.split('\n');
  const removed: string[] = [];
  let at = 0;
  for (const line of before.split('\n')) {
    if (at < kept.length && kept[at] === line) at += 1;
    else removed.push(line);
  }
  return removed;
}

function clean(before: string): Cleaned | null {
  const result = stripSupplierReviewText(before);
  if (result.removed === 0) return null;
  return {
    text: result.text,
    removedEntries: result.removed,
    removedChars: before.length - result.text.length,
    removedLines: removedLinesOf(before, result.text),
  };
}

export async function previewCleanup(
  context: AdminContext,
): Promise<ProductTextCleanupPreviewResponse> {
  requireManage(context);
  const rows = await context.tx.product.findMany({
    where: { descriptionVi: { not: null } },
    orderBy: [{ nameVi: 'asc' }, { id: 'asc' }],
    take: SCAN_LIMIT,
    select: { id: true, code: true, nameVi: true, descriptionVi: true, rowVersion: true },
  });
  const items: ProductTextCleanupItem[] = [];
  let matched = 0;
  for (const row of rows) {
    const before = row.descriptionVi ?? '';
    const cleaned = clean(before);
    if (cleaned === null) continue;
    matched += 1;
    if (items.length >= PRODUCT_TEXT_CLEANUP_PREVIEW_MAX) continue;
    items.push({
      id: row.id,
      code: row.code,
      nameVi: row.nameVi,
      rowVersion: row.rowVersion,
      textHash: sha256Text(before),
      removedEntries: cleaned.removedEntries,
      removedChars: cleaned.removedChars,
    });
  }
  return { items, truncated: matched > items.length };
}

export async function previewOne(
  context: AdminContext,
  id: string,
): Promise<ProductTextCleanupDetailResponse> {
  requireManage(context);
  const row = await context.tx.product.findUnique({
    where: { id: input.uuid(id, 'id') },
    select: { id: true, code: true, nameVi: true, descriptionVi: true, rowVersion: true },
  });
  if (!row) throw new AuthError('NOT_FOUND');
  const before = row.descriptionVi ?? '';
  const cleaned = clean(before);
  return {
    id: row.id,
    code: row.code,
    nameVi: row.nameVi,
    rowVersion: row.rowVersion,
    textHash: sha256Text(before),
    before,
    after: cleaned === null ? before : cleaned.text,
    removedLines: cleaned === null ? [] : cleaned.removedLines,
  };
}

export async function applyCleanup(
  context: AdminContext,
  request: ProductTextCleanupApplyRequest,
): Promise<ProductTextCleanupApplyResponse> {
  requireManage(context);
  const entries = request.items;
  if (
    !Array.isArray(entries) ||
    entries.length === 0 ||
    entries.length > PRODUCT_TEXT_CLEANUP_BATCH_MAX
  ) {
    throw new AuthError('VALIDATION_FAILED', 'items');
  }
  const seen = new Set<string>();
  const checked = entries.map((entry) => {
    const id = input.uuid(entry.id, 'items.id');
    if (seen.has(id)) throw new AuthError('VALIDATION_FAILED', 'items.id');
    seen.add(id);
    const textHash = typeof entry.textHash === 'string' ? entry.textHash : '';
    if (!/^[0-9a-f]{64}$/.test(textHash))
      throw new AuthError('VALIDATION_FAILED', 'items.textHash');
    return { id, rowVersion: input.rowVersion(entry.rowVersion, 'items.rowVersion'), textHash };
  });
  // Lock in id order so two clicks at once cannot deadlock.
  checked.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const { tx } = context;
  const skipped: { id: string; reason: ProductTextCleanupSkipReason }[] = [];
  const done: { id: string; code: string; removedEntries: number; removedChars: number }[] = [];
  for (const entry of checked) {
    const locked = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM products WHERE id = ${entry.id}::uuid FOR UPDATE`;
    if (locked.length === 0) {
      skipped.push({ id: entry.id, reason: 'NOT_FOUND' });
      continue;
    }
    const current = await tx.product.findUniqueOrThrow({
      where: { id: entry.id },
      select: { code: true, descriptionVi: true, rowVersion: true },
    });
    const before = current.descriptionVi ?? '';
    if (current.rowVersion !== entry.rowVersion || sha256Text(before) !== entry.textHash) {
      skipped.push({ id: entry.id, reason: 'CHANGED' });
      continue;
    }
    const cleaned = clean(before);
    if (cleaned === null) {
      skipped.push({ id: entry.id, reason: 'NOTHING_TO_REMOVE' });
      continue;
    }
    await tx.product.update({
      where: { id: entry.id },
      data: { descriptionVi: cleaned.text, rowVersion: current.rowVersion + 1 },
    });
    await appendAdminAudit(context, {
      action: 'PRODUCT_SUPPLIER_REVIEW_TEXT_REMOVED',
      entityType: 'Product',
      entityId: entry.id,
      reason: 'Supplier customer comments removed from the description',
      before: { descriptionVi: before },
      after: {
        descriptionVi: cleaned.text,
        removedEntries: cleaned.removedEntries,
        removedLines: cleaned.removedLines,
      },
    });
    done.push({
      id: entry.id,
      code: current.code,
      removedEntries: cleaned.removedEntries,
      removedChars: cleaned.removedChars,
    });
  }
  await appendAdminAudit(context, {
    action: 'PRODUCT_SUPPLIER_REVIEW_TEXT_CLEANUP_RUN',
    entityType: 'ProductTextCleanup',
    entityId: randomUUID(),
    after: {
      cleaned: done.length,
      skipped: skipped.length,
      products: done.map((item) => item.code),
    },
  });
  return { cleaned: done.length, skipped };
}
