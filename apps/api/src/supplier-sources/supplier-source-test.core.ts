import type {
  SourceTestProblemGroup,
  SourceTestSampleEntry,
  SourceTestSummary,
  SupplierSourceTestConfirmResponse,
  SupplierSourceTestItem,
  SupplierSourceTestListResponse,
  SupplierSourceTestRequest,
  SupplierSourceTestResponse,
  SupplierSourceVersionRequest,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { STORE_API_ADAPTER_KEY } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import * as input from '../inventory/inventory.input.js';
import { SOURCE_ITEM_SELECT, presentSource } from './supplier-source.core.js';
import { sourceGaps } from './supplier-source.rules.js';

/**
 * Phase 9 P9-3: Test Source. The API only QUEUES a test and records a person's confirmation; the worker is the only place that talks to
 * the supplier's site. A test needs a recorded and confirmed permission first (nothing is requested from a site before that). A person
 * confirms a passed sample, and only then does the source become READY (the database refuses READY without a confirmed, passed test of
 * the current address). Supplier prices in a sample are reference data: callers without MANAGE_PRODUCT_PRICES never receive them.
 */
type Tx = Prisma.TransactionClient;
const GLOBAL = { kind: 'GLOBAL' } as const;
const TEST_LIST_LIMIT = 10;

const TEST_SELECT = {
  id: true,
  sourceId: true,
  baseUrl: true,
  status: true,
  requestedAt: true,
  requestedBy: { select: { id: true, fullName: true } },
  startedAt: true,
  finishedAt: true,
  failureCode: true,
  failureDetail: true,
  failureSourceStatus: true,
  summary: true,
  sample: true,
  problems: true,
  requestCount: true,
  confirmedAt: true,
  confirmedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.SupplierSourceTestSelect;

type TestRow = Prisma.SupplierSourceTestGetPayload<{ select: typeof TEST_SELECT }>;

const SOURCE_SELECT = {
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
} satisfies Prisma.SupplierSourceSelect;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function present(
  row: TestRow,
  pricesVisible: boolean,
  latestTestId: string | null,
  sourceBaseUrl: string | null,
): SupplierSourceTestItem {
  const summary =
    isRecord(row.summary) && 'sampled' in row.summary
      ? (row.summary as unknown as SourceTestSummary)
      : null;
  const sample = (Array.isArray(row.sample) ? row.sample : []).filter(isRecord).map((entry) => {
    const { priceVnd, promoPriceVnd, ...rest } = entry as unknown as SourceTestSampleEntry;
    return pricesVisible ? { ...rest, priceVnd, promoPriceVnd } : rest;
  }) as SourceTestSampleEntry[];
  return {
    id: row.id,
    status: row.status,
    baseUrl: row.baseUrl,
    requestedAt: row.requestedAt.toISOString(),
    requestedBy: { id: row.requestedBy.id, name: row.requestedBy.fullName },
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    failure: row.failureCode
      ? { code: row.failureCode, detail: row.failureDetail, sourceStatus: row.failureSourceStatus }
      : null,
    summary,
    sample,
    problems: (Array.isArray(row.problems) ? row.problems : []).filter(
      isRecord,
    ) as unknown as SourceTestProblemGroup[],
    requestCount: row.requestCount,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    confirmedBy: row.confirmedBy
      ? { id: row.confirmedBy.id, name: row.confirmedBy.fullName }
      : null,
    canConfirm:
      row.status === 'PASSED' &&
      row.confirmedAt === null &&
      row.id === latestTestId &&
      row.baseUrl === sourceBaseUrl,
  };
}

function canManage(context: AdminContext): boolean {
  return decide(context.actor.graph, 'MANAGE_SUPPLIER_SOURCES', GLOBAL);
}

function requireManage(context: AdminContext): void {
  if (!canManage(context)) throw new AuthError('FORBIDDEN');
}

function pricesVisible(context: AdminContext): boolean {
  return decide(context.actor.graph, 'MANAGE_PRODUCT_PRICES', GLOBAL);
}

async function lockSource(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM supplier_sources WHERE id = ${id}::uuid FOR UPDATE`;
  if (rows.length === 0) throw new AuthError('NOT_FOUND');
  return tx.supplierSource.findUniqueOrThrow({ where: { id }, select: SOURCE_SELECT });
}

async function latestFinishedTestId(tx: Tx, sourceId: string): Promise<string | null> {
  const latest = await tx.supplierSourceTest.findFirst({
    where: { sourceId },
    orderBy: { seq: 'desc' },
    select: { id: true },
  });
  return latest?.id ?? null;
}

// ------------------------------------------------------------------------------------------------------------------ reads

export async function listTests(
  context: AdminContext,
  id: string,
): Promise<SupplierSourceTestListResponse> {
  if (!canManage(context) && !decide(context.actor.graph, 'REVIEW_SUPPLIER_IMPORTS', GLOBAL)) {
    throw new AuthError('FORBIDDEN');
  }
  const { tx } = context;
  const sourceId = input.uuid(id, 'id');
  const source = await tx.supplierSource.findUnique({
    where: { id: sourceId },
    select: { id: true, baseUrl: true },
  });
  if (!source) throw new AuthError('NOT_FOUND');
  const [rows, latest] = await Promise.all([
    tx.supplierSourceTest.findMany({
      where: { sourceId },
      orderBy: { seq: 'desc' },
      take: TEST_LIST_LIMIT,
      select: TEST_SELECT,
    }),
    latestFinishedTestId(tx, sourceId),
  ]);
  const visible = pricesVisible(context);
  return {
    items: rows.map((row) => present(row, visible, latest, source.baseUrl)),
    pricesVisible: visible,
  };
}

// --------------------------------------------------------------------------------------------------------------- commands

/** Queues a Test Source. The worker picks it up; nothing is fetched here. */
export async function requestTest(
  context: AdminContext,
  id: string,
  request: SupplierSourceTestRequest,
): Promise<SupplierSourceTestResponse> {
  requireManage(context);
  const body = input.record(request, 'body', ['expectedVersion']);
  const expected = input.rowVersion(body['expectedVersion']);
  const { tx } = context;
  const source = await lockSource(tx, input.uuid(id, 'id'));
  if (source.rowVersion !== expected) throw new AuthError('CONFLICT');
  if (source.kind === 'FILE' || source.baseUrl === null) {
    throw new AuthError('SUPPLIER_SOURCE_TEST_UNSUPPORTED');
  }
  // Nothing is requested from a supplier's site before the permission is recorded, covers text or images, and is confirmed.
  const gap = sourceGaps({ ...source, isEnabled: false, status: 'READY' })[0];
  if (gap === 'PERMISSION_RECORD') throw new AuthError('SUPPLIER_SOURCE_PERMISSION_INCOMPLETE');
  if (gap === 'PERMISSION_COVERAGE') throw new AuthError('SUPPLIER_SOURCE_NOT_COVERED');
  if (gap === 'PERMISSION_CONFIRMATION')
    throw new AuthError('SUPPLIER_SOURCE_PERMISSION_UNCONFIRMED');
  const active = await tx.supplierSourceTest.findFirst({
    where: { sourceId: source.id, status: { in: ['QUEUED', 'RUNNING'] } },
    select: { id: true },
  });
  if (active) throw new AuthError('SUPPLIER_SOURCE_TEST_ACTIVE');
  const created = await tx.supplierSourceTest.create({
    data: {
      sourceId: source.id,
      baseUrl: source.baseUrl,
      requestedByUserId: context.actor.userId,
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'SUPPLIER_SOURCE_TEST_REQUESTED',
    entityType: 'SupplierSource',
    entityId: source.id,
    after: { testId: created.id, baseUrl: source.baseUrl },
  });
  const row = await tx.supplierSourceTest.findUniqueOrThrow({
    where: { id: created.id },
    select: TEST_SELECT,
  });
  return { item: present(row, pricesVisible(context), created.id, source.baseUrl) };
}

/** A person confirms that the passed sample is right: the test is stamped and the source becomes READY. */
export async function confirmTest(
  context: AdminContext,
  id: string,
  testId: string,
  request: SupplierSourceVersionRequest,
): Promise<SupplierSourceTestConfirmResponse> {
  requireManage(context);
  const body = input.record(request, 'body', ['expectedVersion']);
  const expected = input.rowVersion(body['expectedVersion']);
  const { tx } = context;
  const source = await lockSource(tx, input.uuid(id, 'id'));
  if (source.rowVersion !== expected) throw new AuthError('CONFLICT');
  const wantedId = input.uuid(testId, 'testId');
  const test = await tx.supplierSourceTest.findFirst({
    where: { id: wantedId, sourceId: source.id },
    select: { id: true, status: true, confirmedAt: true, baseUrl: true },
  });
  if (!test) throw new AuthError('NOT_FOUND');
  if (test.status !== 'PASSED') throw new AuthError('SUPPLIER_SOURCE_TEST_NOT_PASSED');
  if (test.confirmedAt !== null) throw new AuthError('SUPPLIER_SOURCE_TEST_ALREADY_CONFIRMED');
  // The sample must be the latest one and still be of the address the source has now.
  if (test.baseUrl !== source.baseUrl || test.id !== (await latestFinishedTestId(tx, source.id))) {
    throw new AuthError('SUPPLIER_SOURCE_TEST_OUTDATED');
  }
  const gap = sourceGaps({ ...source, isEnabled: false, status: 'READY' })[0];
  if (gap === 'PERMISSION_RECORD') throw new AuthError('SUPPLIER_SOURCE_PERMISSION_INCOMPLETE');
  if (gap === 'PERMISSION_COVERAGE') throw new AuthError('SUPPLIER_SOURCE_NOT_COVERED');
  if (gap === 'PERMISSION_CONFIRMATION')
    throw new AuthError('SUPPLIER_SOURCE_PERMISSION_UNCONFIRMED');
  await tx.supplierSourceTest.update({
    where: { id: test.id },
    data: { confirmedAt: context.now, confirmedByUserId: context.actor.userId },
    select: { id: true },
  });
  await tx.supplierSource.update({
    where: { id: source.id },
    data: { status: 'READY', adapterKey: STORE_API_ADAPTER_KEY, rowVersion: source.rowVersion + 1 },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'SUPPLIER_SOURCE_TEST_CONFIRMED',
    entityType: 'SupplierSource',
    entityId: source.id,
    before: { status: source.status },
    after: { status: 'READY', testId: test.id, baseUrl: test.baseUrl },
  });
  const [itemRow, testRow] = await Promise.all([
    tx.supplierSource.findUniqueOrThrow({ where: { id: source.id }, select: SOURCE_ITEM_SELECT }),
    tx.supplierSourceTest.findUniqueOrThrow({ where: { id: test.id }, select: TEST_SELECT }),
  ]);
  return {
    item: presentSource(itemRow),
    test: present(testRow, pricesVisible(context), test.id, source.baseUrl),
  };
}
