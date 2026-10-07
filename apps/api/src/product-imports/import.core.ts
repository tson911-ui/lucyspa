import type {
  ProductImportApplyRequest,
  ProductImportCancelRequest,
  ProductImportDetailResponse,
  ProductImportJobResponse,
  ProductImportKindName,
  ProductImportListResponse,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { IMPORT_LIMITS, rowByColumn, type ColumnMap, type ParsedSheet } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import * as input from '../products/product-catalog.input.js';
import {
  applyCatalog,
  applyOpeningStock,
  lockAndPlanCatalog,
  lockAndPlanOpening,
} from './import.apply.js';
import type { Access, Issues } from './import.parse.js';
import {
  planCatalog,
  planOpeningStock,
  toResponse,
  toStored,
  type PlannedRow,
  type SourceRow,
  type StoredRaw,
} from './import.plan.js';

type Tx = Prisma.TransactionClient;
const GLOBAL = { kind: 'GLOBAL' } as const;

/**
 * Phase 6 P6-5: the Excel/CSV import (design 11.2, PRD 31). `IMPORT_PRODUCT_DATA` (GLOBAL) opens every command; a price column needs
 * `MANAGE_PRODUCT_PRICES` and a cost column `VIEW_PRODUCT_COST`, decided from the actor's own authority inside the transaction.
 *
 * - Upload parses, plans and stores the PREVIEW in one transaction; nothing of the catalog or the stock is written.
 * - Apply locks, plans AGAIN with the applier's own authority and refuses (writing nothing) if any row differs from the preview.
 * - Rows that are invalid are never applied; the person must say so explicitly (`skipInvalid`).
 * - Prices, costs and stock go through the same tables and audit as the admin screens; a job is history and is never deleted.
 */

export function importAccess(context: AdminContext): Access & { import: boolean } {
  const graph = context.actor.graph;
  return {
    import: decide(graph, 'IMPORT_PRODUCT_DATA', GLOBAL),
    prices: decide(graph, 'MANAGE_PRODUCT_PRICES', GLOBAL),
    cost: decide(graph, 'VIEW_PRODUCT_COST', GLOBAL),
  };
}

export function requireImport(context: AdminContext): Access {
  const { import: allowed, ...access } = importAccess(context);
  if (!allowed) throw new AuthError('FORBIDDEN');
  return access;
}

// ------------------------------------------------------------------------------------------------------- reading

const jobSelect = {
  id: true,
  kind: true,
  status: true,
  originalFilename: true,
  branchId: true,
  branch: { select: { name: true } },
  rowCount: true,
  validCount: true,
  invalidCount: true,
  createCount: true,
  updateCount: true,
  summary: true,
  failureMessage: true,
  createdBy: { select: { fullName: true } },
  createdAt: true,
  previewedAt: true,
  appliedBy: { select: { fullName: true } },
  appliedAt: true,
  rowVersion: true,
} satisfies Prisma.ProductImportJobSelect;

type JobRecord = Prisma.ProductImportJobGetPayload<{ select: typeof jobSelect }>;

interface Summary {
  columns: string[];
  warnings: Issues;
  unchangedCount: number;
}

function summaryOf(job: JobRecord): Summary {
  const value = job.summary;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return {
      columns: Array.isArray(record['columns']) ? (record['columns'] as string[]) : [],
      warnings: Array.isArray(record['warnings']) ? (record['warnings'] as Issues) : [],
      unchangedCount: typeof record['unchangedCount'] === 'number' ? record['unchangedCount'] : 0,
    };
  }
  return { columns: [], warnings: [], unchangedCount: 0 };
}

function presentJob(job: JobRecord, access: Access): ProductImportJobResponse {
  const summary = summaryOf(job);
  return {
    id: job.id,
    kind: job.kind as ProductImportKindName,
    status: job.status,
    filename: job.originalFilename,
    branchId: job.branchId,
    branchName: job.branch?.name ?? null,
    rowCount: job.rowCount,
    validCount: job.validCount,
    invalidCount: job.invalidCount,
    createCount: job.createCount,
    updateCount: job.updateCount,
    unchangedCount: summary.unchangedCount,
    warnings: summary.warnings,
    columns: summary.columns.filter(
      (key) => (key !== 'price' || access.prices) && (key !== 'cost' || access.cost),
    ),
    failureMessage: job.failureMessage,
    createdByName: job.createdBy.fullName,
    createdAt: job.createdAt.toISOString(),
    previewedAt: job.previewedAt?.toISOString() ?? null,
    appliedByName: job.appliedBy?.fullName ?? null,
    appliedAt: job.appliedAt?.toISOString() ?? null,
    rowVersion: job.rowVersion,
  };
}

export async function listJobs(context: AdminContext): Promise<ProductImportListResponse> {
  const access = requireImport(context);
  const { tx } = context;
  const jobs = await tx.productImportJob.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 100,
    select: jobSelect,
  });
  const branches = await tx.branch.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
  return {
    jobs: jobs.map((job) => presentJob(job, access)),
    branches,
    access,
    limits: { maxBytes: IMPORT_LIMITS.maxBytes, maxRows: IMPORT_LIMITS.maxRows },
  };
}

async function detail(
  context: AdminContext,
  id: string,
  access: Access,
): Promise<ProductImportDetailResponse> {
  const { tx } = context;
  const job = await tx.productImportJob.findUnique({ where: { id }, select: jobSelect });
  if (!job) throw new AuthError('NOT_FOUND');
  const rows = await tx.productImportRow.findMany({
    where: { jobId: id },
    orderBy: { rowNo: 'asc' },
    select: { rowNo: true, raw: true, status: true, action: true, errors: true },
  });
  const base = presentJob(job, access);
  return {
    ...base,
    rows: rows.map((row) =>
      toResponse(
        {
          rowNo: row.rowNo,
          raw: row.raw as unknown as StoredRaw,
          status: row.status,
          action: row.action,
          errors: row.errors as unknown as Issues,
        },
        access,
      ),
    ),
    canApply: job.status === 'PREVIEWED' && job.createCount + job.updateCount > 0,
  };
}

export async function getJob(
  context: AdminContext,
  id: string,
): Promise<ProductImportDetailResponse> {
  const access = requireImport(context);
  return detail(context, id, access);
}

// ------------------------------------------------------------------------------------------------------- upload

export interface UploadInput {
  kind: ProductImportKindName;
  branchId: string | null;
  filename: string;
  sha256: string;
  sheet: ParsedSheet;
  map: ColumnMap;
}

function sourceRows(sheet: ParsedSheet, map: ColumnMap): SourceRow[] {
  return sheet.rows
    .map((row) => ({ rowNo: row.rowNo, cells: rowByColumn(map, row.cells) }))
    .filter((row) => Object.values(row.cells).some((cell) => cell !== ''));
}

async function branchOf(tx: Tx, id: string): Promise<{ id: string; timezone: string }> {
  const branch = await tx.branch.findFirst({
    where: { id, isActive: true },
    select: { id: true, timezone: true },
  });
  if (!branch) throw new AuthError('NOT_FOUND');
  return branch;
}

export async function uploadJob(
  context: AdminContext,
  upload: UploadInput,
): Promise<ProductImportDetailResponse> {
  const access = requireImport(context);
  const { tx } = context;
  if ((upload.kind === 'OPENING_STOCK') !== (upload.branchId !== null)) {
    throw new AuthError('VALIDATION_FAILED', 'branchId');
  }
  const branch = upload.branchId === null ? null : await branchOf(tx, upload.branchId);
  const sources = sourceRows(upload.sheet, upload.map);
  if (sources.length === 0) throw new AuthError('IMPORT_FILE_INVALID', 'empty');

  const plan =
    upload.kind === 'CATALOG'
      ? await planCatalog(context, sources, access)
      : await planOpeningStock(context, branch!, sources, access);
  const rows = plan.rows;

  const warnings: Issues = upload.map.unknown.slice(0, 20).map((header) => ({
    code: 'UNKNOWN_COLUMN' as const,
    params: { header: header.slice(0, 80) },
  }));
  const again = await tx.productImportJob.findFirst({
    where: {
      fileSha256: upload.sha256,
      kind: upload.kind,
      branchId: upload.branchId,
      status: 'APPLIED',
    },
    orderBy: { appliedAt: 'desc' },
    select: { appliedAt: true },
  });
  if (again?.appliedAt) {
    warnings.push({
      code: 'SAME_FILE_APPLIED',
      params: { date: again.appliedAt.toISOString().slice(0, 10) },
    });
  }

  const created = await tx.productImportJob.create({
    data: {
      kind: upload.kind,
      originalFilename: upload.filename,
      fileSha256: upload.sha256,
      branchId: upload.branchId,
      createdByUserId: context.actor.userId,
    },
    select: { id: true, rowVersion: true },
  });
  await tx.productImportRow.createMany({
    data: rows.map((row) => ({
      jobId: created.id,
      rowNo: row.rowNo,
      raw: toStored(row) as unknown as Prisma.InputJsonObject,
      status: row.status,
      action: row.action,
      errors: row.errors as unknown as Prisma.InputJsonArray,
    })),
  });
  const valid = rows.filter((row) => row.status === 'VALID');
  const counts = {
    rowCount: rows.length,
    validCount: valid.length,
    invalidCount: rows.length - valid.length,
    createCount: valid.filter((row) => row.action === 'CREATE').length,
    updateCount: valid.filter((row) => row.action === 'UPDATE').length,
  };
  await tx.productImportJob.update({
    where: { id: created.id },
    data: {
      status: 'PREVIEWED',
      ...counts,
      summary: {
        columns: Object.keys(upload.map.index),
        warnings,
        unchangedCount: valid.filter((row) => row.action === 'NONE').length,
      } as unknown as Prisma.InputJsonObject,
      rowVersion: created.rowVersion + 1,
    },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_IMPORT_PREVIEWED',
    entityType: 'ProductImportJob',
    entityId: created.id,
    branchId: upload.branchId,
    classification: 'FINANCIAL',
    after: { kind: upload.kind, filename: upload.filename, ...counts },
  });
  return detail(context, created.id, access);
}

// ------------------------------------------------------------------------------------------------------- cancel

async function lockJob(tx: Tx, id: string, expected: number) {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM product_import_jobs WHERE id = ${id}::uuid FOR UPDATE`;
  if (locked.length === 0) throw new AuthError('NOT_FOUND');
  const job = await tx.productImportJob.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      kind: true,
      status: true,
      branchId: true,
      rowVersion: true,
      invalidCount: true,
    },
  });
  if (job.rowVersion !== expected) throw new AuthError('CONFLICT');
  if (job.status !== 'PREVIEWED') throw new AuthError('IMPORT_JOB_NOT_PREVIEWED');
  return job;
}

export async function cancelJob(
  context: AdminContext,
  id: string,
  request: ProductImportCancelRequest,
): Promise<ProductImportDetailResponse> {
  const access = requireImport(context);
  const expected = input.rowVersion(request.expectedRowVersion);
  const job = await lockJob(context.tx, id, expected);
  await context.tx.productImportJob.update({
    where: { id },
    data: { status: 'CANCELLED', rowVersion: job.rowVersion + 1 },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_IMPORT_CANCELLED',
    entityType: 'ProductImportJob',
    entityId: id,
    branchId: job.branchId,
    classification: 'FINANCIAL',
  });
  return detail(context, id, access);
}

// -------------------------------------------------------------------------------------------------------- apply

/** Two plans agree when every row has the same validity, action and changed columns. */
function sameOutcome(
  stored: { rowNo: number; status: string; action: string; raw: StoredRaw }[],
  fresh: PlannedRow[],
): boolean {
  if (stored.length !== fresh.length) return false;
  return stored.every((row, index) => {
    const now = fresh[index]!;
    return (
      row.rowNo === now.rowNo &&
      row.status === now.status &&
      row.action === now.action &&
      row.raw.changes.join(',') === now.changes.join(',')
    );
  });
}

export async function applyJob(
  context: AdminContext,
  id: string,
  request: ProductImportApplyRequest,
): Promise<ProductImportDetailResponse> {
  const access = requireImport(context);
  const expected = input.rowVersion(request.expectedRowVersion);
  if (typeof request.skipInvalid !== 'boolean')
    throw new AuthError('VALIDATION_FAILED', 'skipInvalid');
  const { tx } = context;
  const job = await lockJob(tx, id, expected);
  if (job.invalidCount > 0 && !request.skipInvalid)
    throw new AuthError('VALIDATION_FAILED', 'skipInvalid');

  const stored = await tx.productImportRow.findMany({
    where: { jobId: id },
    orderBy: { rowNo: 'asc' },
    select: { rowNo: true, raw: true, status: true, action: true },
  });
  const rows = stored.map((row) => ({ ...row, raw: row.raw as unknown as StoredRaw }));
  const sources: SourceRow[] = rows.map((row) => ({ rowNo: row.rowNo, cells: row.raw.cells }));

  let done: { applied: number };
  if (job.kind === 'CATALOG') {
    const plan = await lockAndPlanCatalog(context, sources, access);
    if (!sameOutcome(rows, plan.rows)) throw new AuthError('IMPORT_PREVIEW_STALE');
    if (plan.variants.length === 0) throw new AuthError('IMPORT_NOTHING_TO_APPLY');
    done = await applyCatalog(context, id, plan);
  } else if (job.kind === 'OPENING_STOCK' && job.branchId !== null) {
    const branch = await branchOf(tx, job.branchId);
    const plan = await lockAndPlanOpening(context, branch, sources, access);
    if (!sameOutcome(rows, plan.rows)) throw new AuthError('IMPORT_PREVIEW_STALE');
    if (plan.lots.length === 0) throw new AuthError('IMPORT_NOTHING_TO_APPLY');
    done = await applyOpeningStock(context, id, branch.id, plan);
  } else {
    throw new AuthError('VALIDATION_FAILED', 'kind');
  }

  // Every valid row has been processed (an unchanged one too); an invalid one stays as the preview left it.
  await tx.productImportRow.updateMany({
    where: { jobId: id, status: 'VALID' },
    data: { appliedAt: new Date() },
  });
  await tx.productImportJob.update({
    where: { id },
    data: {
      status: 'APPLIED',
      appliedByUserId: context.actor.userId,
      rowVersion: job.rowVersion + 1,
    },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_IMPORT_APPLIED',
    entityType: 'ProductImportJob',
    entityId: id,
    branchId: job.branchId,
    classification: 'FINANCIAL',
    after: { kind: job.kind, applied: done.applied, skippedInvalid: job.invalidCount },
  });
  return detail(context, id, access);
}
