import {
  CHANGE_ACKNOWLEDGE_MAX,
  CHANGE_PAGE_SIZE,
  SOURCE_CHANGE_KINDS,
  type CandidateState,
  type SourceChangeKind,
  type SupplierChangeAcknowledgeRequest,
  type SupplierChangeAcknowledgeResponse,
  type SupplierChangeDetail,
  type SupplierChangeListResponse,
  type SupplierChangeRow,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import * as input from '../inventory/inventory.input.js';
import { canSeePrices, requireReview } from './supplier-import.core.js';

/**
 * Phase 9 P9-7: the "Thay đổi" queue of the review screen (REVIEW_SUPPLIER_IMPORTS, GLOBAL). A note is what a scan found different on
 * a supplier product. Reading the queue and acknowledging a note change nothing else: no candidate, product, price or picture. The
 * source price inside a price note is cut here, on the server, for anyone without MANAGE_PRODUCT_PRICES.
 */
const SELECT = {
  id: true,
  kind: true,
  detail: true,
  detectedAt: true,
  acknowledgedAt: true,
  acknowledgedBy: { select: { fullName: true } },
  scanId: true,
  sourceRecord: {
    select: {
      name: true,
      sku: true,
      url: true,
      source: { select: { id: true, name: true } },
      candidateLink: {
        select: { candidate: { select: { id: true, nameVi: true, state: true } } },
      },
    },
  },
} satisfies Prisma.SourceChangeSelect;

type Row = Prisma.SourceChangeGetPayload<{ select: typeof SELECT }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;
const money = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Only the fields a screen shows, in the shape the contract promises; the stored detail is never passed through as it is. */
function presentDetail(
  kind: SourceChangeKind,
  raw: unknown,
  prices: boolean,
): SupplierChangeDetail {
  const detail = isRecord(raw) ? raw : {};
  if (kind === 'CONTENT_CHANGED') {
    return {
      fields: Array.isArray(detail['fields'])
        ? detail['fields'].filter((entry): entry is string => typeof entry === 'string')
        : [],
      before: isRecord(detail['before']) ? detail['before'] : {},
      after: isRecord(detail['after']) ? detail['after'] : {},
    };
  }
  if (kind === 'IMAGE_CHANGED') {
    return {
      images: {
        before: count(detail['before']),
        after: count(detail['after']),
        added: Array.isArray(detail['added']) ? detail['added'].length : 0,
        removed: Array.isArray(detail['removed']) ? detail['removed'].length : 0,
      },
    };
  }
  if (kind === 'PRICE_CHANGED') {
    if (!prices) return {};
    const side = (value: unknown) => {
      const entry = isRecord(value) ? value : {};
      return { priceVnd: money(entry['priceVnd']), promoPriceVnd: money(entry['promoPriceVnd']) };
    };
    return { price: { before: side(detail['before']), after: side(detail['after']) } };
  }
  return { missingScans: count(detail['missingScans']) };
}

function present(row: Row, prices: boolean): SupplierChangeRow {
  const candidate = row.sourceRecord.candidateLink?.candidate ?? null;
  return {
    id: row.id,
    kind: row.kind,
    detectedAt: row.detectedAt.toISOString(),
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    acknowledgedBy: row.acknowledgedBy?.fullName ?? null,
    scanId: row.scanId,
    source: row.sourceRecord.source,
    productName: row.sourceRecord.name,
    productSku: row.sourceRecord.sku,
    productUrl: row.sourceRecord.url,
    candidate: candidate
      ? { id: candidate.id, nameVi: candidate.nameVi, state: candidate.state as CandidateState }
      : null,
    detail: presentDetail(row.kind, row.detail, prices),
  };
}

export async function listChanges(
  context: AdminContext,
  query: { status?: string | undefined; kind?: string | undefined; page?: number | undefined },
): Promise<SupplierChangeListResponse> {
  requireReview(context);
  const status = query.status ?? 'OPEN';
  if (status !== 'OPEN' && status !== 'DONE') throw new AuthError('VALIDATION_FAILED', 'status');
  if (
    query.kind !== undefined &&
    !(SOURCE_CHANGE_KINDS as readonly string[]).includes(query.kind)
  ) {
    throw new AuthError('VALIDATION_FAILED', 'kind');
  }
  const page = query.page ?? 1;
  if (!Number.isSafeInteger(page) || page < 1 || page > 100_000) {
    throw new AuthError('VALIDATION_FAILED', 'page');
  }
  const { tx } = context;
  const where: Prisma.SourceChangeWhereInput = {
    acknowledgedAt: status === 'OPEN' ? null : { not: null },
    ...(query.kind ? { kind: query.kind as SourceChangeKind } : {}),
  };
  const [total, rows, open] = await Promise.all([
    tx.sourceChange.count({ where }),
    tx.sourceChange.findMany({
      where,
      select: SELECT,
      orderBy: [{ seq: 'desc' }],
      skip: (page - 1) * CHANGE_PAGE_SIZE,
      take: CHANGE_PAGE_SIZE,
    }),
    tx.sourceChange.groupBy({
      by: ['kind'],
      where: { acknowledgedAt: null },
      _count: { _all: true },
    }),
  ]);
  const kindCounts: SupplierChangeListResponse['kindCounts'] = {};
  let openCount = 0;
  for (const entry of open) {
    kindCounts[entry.kind] = entry._count._all;
    openCount += entry._count._all;
  }
  const prices = canSeePrices(context);
  return {
    items: rows.map((row) => present(row, prices)),
    total,
    page,
    pageSize: CHANGE_PAGE_SIZE,
    openCount,
    kindCounts,
    canSeePrices: prices,
  };
}

/** Says the listed notes were seen. Notes already acknowledged are left alone and counted; an unknown id is refused. */
export async function acknowledgeChanges(
  context: AdminContext,
  request: SupplierChangeAcknowledgeRequest,
): Promise<SupplierChangeAcknowledgeResponse> {
  requireReview(context);
  const body = input.record(request, 'body', ['ids']);
  const raw = body['ids'];
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > CHANGE_ACKNOWLEDGE_MAX) {
    throw new AuthError('VALIDATION_FAILED', 'ids');
  }
  const ids = [...new Set(raw.map((entry, index) => input.uuid(entry, `ids.${index}`)))];
  const { tx } = context;
  const found = await tx.$queryRaw<{ id: string; acknowledged: boolean }[]>`
    SELECT id, acknowledged_at IS NOT NULL AS acknowledged
      FROM source_changes WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
  if (found.length !== ids.length) throw new AuthError('NOT_FOUND');
  const open = found.filter((entry) => !entry.acknowledged).map((entry) => entry.id);
  if (open.length > 0) {
    await tx.$executeRaw`
      UPDATE source_changes
         SET acknowledged_by_user_id = ${context.actor.userId}::uuid, acknowledged_at = clock_timestamp()
       WHERE id = ANY(${open}::uuid[]) AND acknowledged_at IS NULL`;
    await appendAdminAudit(context, {
      action: 'SUPPLIER_CHANGES_ACKNOWLEDGED',
      entityType: 'SourceChange',
      entityId: open[0]!,
      after: { count: open.length },
    });
  }
  return { acknowledged: open.length, alreadyDone: found.length - open.length };
}
