import type {
  SupplierSourceScanError,
  SupplierSourceScanItem,
  SupplierSourceScanListResponse,
  SupplierSourceScanRequest,
  SupplierSourceScanResponse,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import * as input from '../inventory/inventory.input.js';
import { sourceGaps } from './supplier-source.rules.js';

/**
 * Phase 9 P9-4: the sample scan. The API only QUEUES a manual scan (MANAGE_SUPPLIER_SOURCES) and reports what the worker found; the
 * worker is the only place that talks to a supplier's site. A scan needs a source that is enabled, READY and still has a confirmed
 * permission. Live fetching is limited to a 20-product sample (the database also refuses a 21st product of one source).
 */
type Tx = Prisma.TransactionClient;
const GLOBAL = { kind: 'GLOBAL' } as const;
const SCAN_LIST_LIMIT = 10;
const ERRORS_SHOWN = 20;

const SELECT = {
  id: true,
  status: true,
  trigger: true,
  actor: { select: { id: true, fullName: true } },
  claimedAt: true,
  startedAt: true,
  finishedAt: true,
  sampleLimit: true,
  requestCount: true,
  discoveredCount: true,
  newCount: true,
  unchangedCount: true,
  priceChangedCount: true,
  contentChangedCount: true,
  imageChangedCount: true,
  imageCount: true,
  imageFlagCount: true,
  errorCount: true,
  errors: true,
} satisfies Prisma.ImportScanSelect;

type Row = Prisma.ImportScanGetPayload<{ select: typeof SELECT }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function presentScan(row: Row): SupplierSourceScanItem {
  const errors = (Array.isArray(row.errors) ? (row.errors as unknown[]) : [])
    .filter(isRecord)
    .slice(0, ERRORS_SHOWN)
    .map((entry): SupplierSourceScanError => {
      const text = (key: string) =>
        typeof entry[key] === 'string' ? (entry[key] as string) : undefined;
      const [key, url, detail] = [text('key'), text('url'), text('detail')];
      return {
        code: text('code') ?? 'UNKNOWN',
        ...(key ? { key } : {}),
        ...(url ? { url } : {}),
        ...(detail ? { detail } : {}),
      };
    });
  return {
    id: row.id,
    status: row.status,
    queued: row.status === 'RUNNING' && row.claimedAt === null,
    trigger: row.trigger,
    requestedBy: row.actor ? { id: row.actor.id, name: row.actor.fullName } : null,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    sampleLimit: row.sampleLimit,
    requestCount: row.requestCount,
    counts: {
      discovered: row.discoveredCount,
      created: row.newCount,
      unchanged: row.unchangedCount,
      priceChanged: row.priceChangedCount,
      contentChanged: row.contentChangedCount,
      imageChanged: row.imageChangedCount,
      images: row.imageCount,
      imageFlags: row.imageFlagCount,
      errors: row.errorCount,
    },
    errors,
  };
}

function canManage(context: AdminContext): boolean {
  return decide(context.actor.graph, 'MANAGE_SUPPLIER_SOURCES', GLOBAL);
}

async function lockSource(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM supplier_sources WHERE id = ${id}::uuid FOR UPDATE`;
  if (rows.length === 0) throw new AuthError('NOT_FOUND');
  return tx.supplierSource.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      kind: true,
      baseUrl: true,
      status: true,
      isEnabled: true,
      permissionGivenBy: true,
      permissionMethod: true,
      permissionDate: true,
      permitsText: true,
      permitsImages: true,
      permissionConfirmedAt: true,
      rowVersion: true,
    },
  });
}

export async function listScans(
  context: AdminContext,
  id: string,
): Promise<SupplierSourceScanListResponse> {
  if (!canManage(context) && !decide(context.actor.graph, 'REVIEW_SUPPLIER_IMPORTS', GLOBAL)) {
    throw new AuthError('FORBIDDEN');
  }
  const { tx } = context;
  const sourceId = input.uuid(id, 'id');
  if (!(await tx.supplierSource.findUnique({ where: { id: sourceId }, select: { id: true } }))) {
    throw new AuthError('NOT_FOUND');
  }
  const rows = await tx.importScan.findMany({
    where: { sourceId },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: SCAN_LIST_LIMIT,
    select: SELECT,
  });
  return { items: rows.map(presentScan) };
}

/** Queues a manual sample scan. The worker picks it up; nothing is fetched here. */
export async function requestScan(
  context: AdminContext,
  id: string,
  request: SupplierSourceScanRequest,
): Promise<SupplierSourceScanResponse> {
  if (!canManage(context)) throw new AuthError('FORBIDDEN');
  const body = input.record(request, 'body', ['expectedVersion']);
  const expected = input.rowVersion(body['expectedVersion']);
  const { tx } = context;
  const source = await lockSource(tx, input.uuid(id, 'id'));
  if (source.rowVersion !== expected) throw new AuthError('CONFLICT');
  if (source.kind === 'FILE' || source.baseUrl === null) {
    throw new AuthError('SUPPLIER_SOURCE_TEST_UNSUPPORTED');
  }
  // Nothing is requested from a supplier's site unless the source is enabled, READY and has a confirmed permission.
  const gap = sourceGaps({ ...source, isEnabled: false })[0];
  if (gap === 'PERMISSION_RECORD') throw new AuthError('SUPPLIER_SOURCE_PERMISSION_INCOMPLETE');
  if (gap === 'PERMISSION_COVERAGE') throw new AuthError('SUPPLIER_SOURCE_NOT_COVERED');
  if (gap === 'PERMISSION_CONFIRMATION')
    throw new AuthError('SUPPLIER_SOURCE_PERMISSION_UNCONFIRMED');
  if (gap === 'TEST_REQUIRED') throw new AuthError('SUPPLIER_SOURCE_NOT_READY');
  if (!source.isEnabled) throw new AuthError('SUPPLIER_SOURCE_NOT_ENABLED');
  const running = await tx.importScan.findFirst({
    where: { sourceId: source.id, status: 'RUNNING' },
    select: { id: true },
  });
  if (running) throw new AuthError('SUPPLIER_SOURCE_SCAN_ACTIVE');
  const created = await tx.importScan.create({
    data: { sourceId: source.id, trigger: 'MANUAL', actorUserId: context.actor.userId },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'SUPPLIER_SOURCE_SCAN_REQUESTED',
    entityType: 'SupplierSource',
    entityId: source.id,
    after: { scanId: created.id },
  });
  const row = await tx.importScan.findUniqueOrThrow({ where: { id: created.id }, select: SELECT });
  return { item: presentScan(row) };
}
