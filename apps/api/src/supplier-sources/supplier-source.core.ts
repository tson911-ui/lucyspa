import {
  SUPPLIER_NAME_MAX,
  SUPPLIER_SOURCE_CADENCES,
  SUPPLIER_SOURCE_KINDS,
  SUPPLIER_SOURCE_NAME_MAX,
  SUPPLIER_SOURCE_PERMISSION_FIELD_MAX,
  type SupplierSourceCadence,
  type SupplierSourceCreateRequest,
  type SupplierSourceEditRequest,
  type SupplierSourceItem,
  type SupplierSourceKind,
  type SupplierSourceListResponse,
  type SupplierSourcePermissionRequest,
  type SupplierSourceResponse,
  type SupplierSourceVersionRequest,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import * as input from '../inventory/inventory.input.js';
import { normalizeSourceUrl, shopToday, sourceGaps } from './supplier-source.rules.js';

/**
 * Phase 9 P9-2 (P9-T8, P9-T9): the commands and reads of supplier sources.
 *
 * - Reading needs `MANAGE_SUPPLIER_SOURCES` or `REVIEW_SUPPLIER_IMPORTS`; every change needs `MANAGE_SUPPLIER_SOURCES`. Both are GLOBAL
 *   permissions, decided inside every command before anything is read.
 * - A new source starts disabled with no permission recorded. The permission record (who, how, when, which content) must be complete,
 *   cover text or images, and be confirmed by a person before the source can be enabled. Recording a permission always clears an earlier
 *   confirmation and disables the source; changing the address does the same (the permission was for that address). The database
 *   repeats all of this as constraints and guards.
 * - Nothing here fetches anything. Enabling only says the source MAY be scanned; a scan (P9-3) also needs the status READY.
 * - A source is history and is never deleted; it is switched off.
 */
type Tx = Prisma.TransactionClient;
const GLOBAL = { kind: 'GLOBAL' } as const;

const SELECT = {
  id: true,
  name: true,
  kind: true,
  baseUrl: true,
  adapterKey: true,
  status: true,
  isEnabled: true,
  scanCadence: true,
  permissionGivenBy: true,
  permissionMethod: true,
  permissionDate: true,
  permissionNote: true,
  permitsText: true,
  permitsImages: true,
  permitsPrices: true,
  permissionConfirmedAt: true,
  lastSuccessAt: true,
  rowVersion: true,
  createdAt: true,
  supplier: { select: { id: true, name: true } },
  permissionConfirmedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.SupplierSourceSelect;

type Row = Prisma.SupplierSourceGetPayload<{ select: typeof SELECT }>;

const day = (value: Date | null): string | null =>
  value ? value.toISOString().slice(0, 10) : null;

export function presentSource(row: Row): SupplierSourceItem {
  return {
    id: row.id,
    supplier: { id: row.supplier.id, name: row.supplier.name },
    name: row.name,
    kind: row.kind,
    baseUrl: row.baseUrl,
    adapterKey: row.adapterKey,
    status: row.status,
    isEnabled: row.isEnabled,
    scanCadence: row.scanCadence,
    permission: {
      givenBy: row.permissionGivenBy,
      method: row.permissionMethod,
      date: day(row.permissionDate),
      note: row.permissionNote,
      permitsText: row.permitsText,
      permitsImages: row.permitsImages,
      permitsPrices: row.permitsPrices,
      confirmedAt: row.permissionConfirmedAt?.toISOString() ?? null,
      confirmedBy: row.permissionConfirmedBy
        ? { id: row.permissionConfirmedBy.id, name: row.permissionConfirmedBy.fullName }
        : null,
    },
    gaps: sourceGaps(row),
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

function canManage(context: AdminContext): boolean {
  return decide(context.actor.graph, 'MANAGE_SUPPLIER_SOURCES', GLOBAL);
}

function requireRead(context: AdminContext): boolean {
  const manage = canManage(context);
  if (!manage && !decide(context.actor.graph, 'REVIEW_SUPPLIER_IMPORTS', GLOBAL)) {
    throw new AuthError('FORBIDDEN');
  }
  return manage;
}

function requireManage(context: AdminContext): void {
  if (!canManage(context)) throw new AuthError('FORBIDDEN');
}

async function lockSource(tx: Tx, id: string): Promise<Row> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM supplier_sources WHERE id = ${id}::uuid FOR UPDATE`;
  if (rows.length === 0) throw new AuthError('NOT_FOUND');
  return tx.supplierSource.findUniqueOrThrow({ where: { id }, select: SELECT });
}

async function reload(tx: Tx, id: string): Promise<SupplierSourceResponse> {
  const row = await tx.supplierSource.findUniqueOrThrow({ where: { id }, select: SELECT });
  return { item: presentSource(row) };
}

function sourceId(value: string): string {
  return input.uuid(value, 'id');
}

function pickOne<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return value as T;
}

// ----------------------------------------------------------------------------------------------------- reads

export async function listSources(context: AdminContext): Promise<SupplierSourceListResponse> {
  const manage = requireRead(context);
  const { tx } = context;
  const [rows, suppliers] = await Promise.all([
    tx.supplierSource.findMany({
      select: SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    }),
    tx.supplier.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 500,
    }),
  ]);
  return { items: rows.map(presentSource), suppliers, canManage: manage };
}

// -------------------------------------------------------------------------------------------------- commands

const CREATE_KEYS = ['supplierId', 'supplierName', 'name', 'kind', 'baseUrl'] as const;

export async function createSource(
  context: AdminContext,
  request: SupplierSourceCreateRequest,
): Promise<SupplierSourceResponse> {
  requireManage(context);
  const body = input.record(request, 'body', CREATE_KEYS);
  const name = input.line(body['name'], 'name', SUPPLIER_SOURCE_NAME_MAX);
  const kind: SupplierSourceKind = pickOne(body['kind'], SUPPLIER_SOURCE_KINDS, 'kind');
  const rawUrl = body['baseUrl'];
  const baseUrl =
    rawUrl === null || rawUrl === undefined || rawUrl === ''
      ? null
      : normalizeSourceUrl(rawUrl, 'baseUrl');
  if (kind === 'FILE' ? baseUrl !== null : baseUrl === null) {
    throw new AuthError('VALIDATION_FAILED', 'baseUrl');
  }
  const { tx } = context;
  const supplierId = await resolveSupplier(context, body);
  if (await tx.supplierSource.findFirst({ where: { supplierId, name }, select: { id: true } })) {
    throw new AuthError('SUPPLIER_SOURCE_NAME_TAKEN', 'name');
  }
  if (
    baseUrl !== null &&
    (await tx.supplierSource.findFirst({ where: { supplierId, baseUrl }, select: { id: true } }))
  ) {
    throw new AuthError('SUPPLIER_SOURCE_URL_TAKEN', 'baseUrl');
  }
  const created = await tx.supplierSource.create({
    data: { supplierId, name, kind, baseUrl, createdByUserId: context.actor.userId },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'SUPPLIER_SOURCE_CREATED',
    entityType: 'SupplierSource',
    entityId: created.id,
    after: { supplierId, name, kind, baseUrl },
  });
  return reload(tx, created.id);
}

/** The supplier a new source belongs to: an existing active one by id, or one found or created by name. */
async function resolveSupplier(
  context: AdminContext,
  body: Record<string, unknown>,
): Promise<string> {
  const { tx } = context;
  const byId = input.optionalUuid(body['supplierId'], 'supplierId');
  const hasName = body['supplierName'] !== undefined && body['supplierName'] !== null;
  if ((byId === null) === !hasName) throw new AuthError('VALIDATION_FAILED', 'supplierId');
  if (byId !== null) {
    const supplier = await tx.supplier.findUnique({
      where: { id: byId },
      select: { id: true, isActive: true },
    });
    if (!supplier) throw new AuthError('VALIDATION_FAILED', 'supplierId');
    if (!supplier.isActive) throw new AuthError('VALIDATION_FAILED', 'supplierId');
    return supplier.id;
  }
  const name = input.line(body['supplierName'], 'supplierName', SUPPLIER_NAME_MAX);
  const found = await tx.$queryRaw<{ id: string; is_active: boolean }[]>`
    SELECT id, is_active FROM suppliers WHERE lower(name) = lower(${name})`;
  const existing = found[0];
  if (existing) {
    if (!existing.is_active) throw new AuthError('VALIDATION_FAILED', 'supplierName');
    return existing.id;
  }
  const created = await tx.supplier.create({ data: { name }, select: { id: true } });
  await appendAdminAudit(context, {
    action: 'SUPPLIER_CREATED',
    entityType: 'Supplier',
    entityId: created.id,
    after: { name, via: 'SUPPLIER_SOURCE' },
  });
  return created.id;
}

const EDIT_KEYS = ['expectedVersion', 'name', 'baseUrl', 'scanCadence'] as const;

export async function editSource(
  context: AdminContext,
  id: string,
  request: SupplierSourceEditRequest,
): Promise<SupplierSourceResponse> {
  requireManage(context);
  const body = input.record(request, 'body', EDIT_KEYS);
  const expected = input.rowVersion(body['expectedVersion']);
  const { tx } = context;
  const row = await lockSource(tx, sourceId(id));
  if (row.rowVersion !== expected) throw new AuthError('CONFLICT');
  const data: Prisma.SupplierSourceUncheckedUpdateInput = { rowVersion: row.rowVersion + 1 };
  const before: Record<string, string | null> = {};
  const after: Record<string, string | null> = {};
  if (body['name'] !== undefined) {
    const name = input.line(body['name'], 'name', SUPPLIER_SOURCE_NAME_MAX);
    if (name !== row.name) {
      const clash = await tx.supplierSource.findFirst({
        where: { supplierId: row.supplier.id, name, NOT: { id: row.id } },
        select: { id: true },
      });
      if (clash) throw new AuthError('SUPPLIER_SOURCE_NAME_TAKEN', 'name');
      data.name = name;
      before['name'] = row.name;
      after['name'] = name;
    }
  }
  if (body['scanCadence'] !== undefined) {
    const cadence: SupplierSourceCadence = pickOne(
      body['scanCadence'],
      SUPPLIER_SOURCE_CADENCES,
      'scanCadence',
    );
    if (cadence !== row.scanCadence) {
      data.scanCadence = cadence;
      before['scanCadence'] = row.scanCadence;
      after['scanCadence'] = cadence;
    }
  }
  let clearedPermission = false;
  if (body['baseUrl'] !== undefined) {
    if (row.kind === 'FILE') throw new AuthError('VALIDATION_FAILED', 'baseUrl');
    const baseUrl = normalizeSourceUrl(body['baseUrl'], 'baseUrl');
    if (baseUrl !== row.baseUrl) {
      if (row.isEnabled) throw new AuthError('SUPPLIER_SOURCE_ENABLED', 'baseUrl');
      const clash = await tx.supplierSource.findFirst({
        where: { supplierId: row.supplier.id, baseUrl, NOT: { id: row.id } },
        select: { id: true },
      });
      if (clash) throw new AuthError('SUPPLIER_SOURCE_URL_TAKEN', 'baseUrl');
      data.baseUrl = baseUrl;
      // The permission was given for the old address and the adapter was validated against it.
      data.status = 'PENDING_VALIDATION';
      if (row.permissionConfirmedAt !== null) {
        data.permissionConfirmedAt = null;
        data.permissionConfirmedByUserId = null;
        clearedPermission = true;
      }
      before['baseUrl'] = row.baseUrl;
      after['baseUrl'] = baseUrl;
    }
  }
  if (Object.keys(after).length === 0) return { item: presentSource(row) };
  await tx.supplierSource.update({ where: { id: row.id }, data, select: { id: true } });
  await appendAdminAudit(context, {
    action: 'SUPPLIER_SOURCE_EDITED',
    entityType: 'SupplierSource',
    entityId: row.id,
    before,
    after: { ...after, permissionConfirmationCleared: clearedPermission },
  });
  return reload(tx, row.id);
}

const PERMISSION_KEYS = [
  'expectedVersion',
  'givenBy',
  'method',
  'date',
  'note',
  'permitsText',
  'permitsImages',
  'permitsPrices',
] as const;

export async function recordPermission(
  context: AdminContext,
  id: string,
  request: SupplierSourcePermissionRequest,
): Promise<SupplierSourceResponse> {
  requireManage(context);
  const body = input.record(request, 'body', PERMISSION_KEYS);
  const expected = input.rowVersion(body['expectedVersion']);
  const givenBy = input.line(body['givenBy'], 'givenBy', SUPPLIER_SOURCE_PERMISSION_FIELD_MAX);
  const method = input.line(body['method'], 'method', SUPPLIER_SOURCE_PERMISSION_FIELD_MAX);
  const date = input.date(body['date'], 'date');
  if (date > shopToday(context.now)) throw new AuthError('VALIDATION_FAILED', 'date');
  const note = input.optionalNote(body['note'], 'note');
  const permitsText = input.boolean(body['permitsText'], 'permitsText');
  const permitsImages = input.boolean(body['permitsImages'], 'permitsImages');
  const permitsPrices = input.boolean(body['permitsPrices'], 'permitsPrices');
  const { tx } = context;
  const row = await lockSource(tx, sourceId(id));
  if (row.rowVersion !== expected) throw new AuthError('CONFLICT');
  const same =
    row.permissionGivenBy === givenBy &&
    row.permissionMethod === method &&
    day(row.permissionDate) === date &&
    row.permissionNote === note &&
    row.permitsText === permitsText &&
    row.permitsImages === permitsImages &&
    row.permitsPrices === permitsPrices;
  // The same record again changes nothing, so a confirmation is not thrown away for nothing.
  if (same) return { item: presentSource(row) };
  await tx.supplierSource.update({
    where: { id: row.id },
    data: {
      permissionGivenBy: givenBy,
      permissionMethod: method,
      permissionDate: new Date(`${date}T00:00:00.000Z`),
      permissionNote: note,
      permitsText,
      permitsImages,
      permitsPrices,
      permissionConfirmedAt: null,
      permissionConfirmedByUserId: null,
      isEnabled: false,
      rowVersion: row.rowVersion + 1,
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'SUPPLIER_SOURCE_PERMISSION_RECORDED',
    entityType: 'SupplierSource',
    entityId: row.id,
    before: {
      givenBy: row.permissionGivenBy,
      method: row.permissionMethod,
      date: day(row.permissionDate),
      permitsText: row.permitsText,
      permitsImages: row.permitsImages,
      permitsPrices: row.permitsPrices,
      confirmed: row.permissionConfirmedAt !== null,
      enabled: row.isEnabled,
    },
    after: { givenBy, method, date, permitsText, permitsImages, permitsPrices },
  });
  return reload(tx, row.id);
}

export async function confirmPermission(
  context: AdminContext,
  id: string,
  request: SupplierSourceVersionRequest,
): Promise<SupplierSourceResponse> {
  requireManage(context);
  const body = input.record(request, 'body', ['expectedVersion']);
  const expected = input.rowVersion(body['expectedVersion']);
  const { tx } = context;
  const row = await lockSource(tx, sourceId(id));
  if (row.rowVersion !== expected) throw new AuthError('CONFLICT');
  if (!row.permissionGivenBy || !row.permissionMethod || !row.permissionDate) {
    throw new AuthError('SUPPLIER_SOURCE_PERMISSION_INCOMPLETE');
  }
  if (row.permissionConfirmedAt !== null) return { item: presentSource(row) };
  await tx.supplierSource.update({
    where: { id: row.id },
    data: {
      permissionConfirmedAt: context.now,
      permissionConfirmedByUserId: context.actor.userId,
      rowVersion: row.rowVersion + 1,
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'SUPPLIER_SOURCE_PERMISSION_CONFIRMED',
    entityType: 'SupplierSource',
    entityId: row.id,
    after: {
      givenBy: row.permissionGivenBy,
      method: row.permissionMethod,
      date: day(row.permissionDate),
      permitsText: row.permitsText,
      permitsImages: row.permitsImages,
      permitsPrices: row.permitsPrices,
    },
  });
  return reload(tx, row.id);
}

export async function enableSource(
  context: AdminContext,
  id: string,
  request: SupplierSourceVersionRequest,
): Promise<SupplierSourceResponse> {
  requireManage(context);
  const body = input.record(request, 'body', ['expectedVersion']);
  const expected = input.rowVersion(body['expectedVersion']);
  const { tx } = context;
  const row = await lockSource(tx, sourceId(id));
  if (row.rowVersion !== expected) throw new AuthError('CONFLICT');
  if (row.isEnabled) return { item: presentSource(row) };
  const [gap] = sourceGaps(row);
  if (gap === 'PERMISSION_RECORD') throw new AuthError('SUPPLIER_SOURCE_PERMISSION_INCOMPLETE');
  if (gap === 'PERMISSION_COVERAGE') throw new AuthError('SUPPLIER_SOURCE_NOT_COVERED');
  if (gap === 'PERMISSION_CONFIRMATION') {
    throw new AuthError('SUPPLIER_SOURCE_PERMISSION_UNCONFIRMED');
  }
  await tx.supplierSource.update({
    where: { id: row.id },
    data: { isEnabled: true, rowVersion: row.rowVersion + 1 },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'SUPPLIER_SOURCE_ENABLED',
    entityType: 'SupplierSource',
    entityId: row.id,
  });
  return reload(tx, row.id);
}

export async function disableSource(
  context: AdminContext,
  id: string,
  request: SupplierSourceVersionRequest,
): Promise<SupplierSourceResponse> {
  requireManage(context);
  const body = input.record(request, 'body', ['expectedVersion']);
  const expected = input.rowVersion(body['expectedVersion']);
  const { tx } = context;
  const row = await lockSource(tx, sourceId(id));
  if (row.rowVersion !== expected) throw new AuthError('CONFLICT');
  if (!row.isEnabled) return { item: presentSource(row) };
  await tx.supplierSource.update({
    where: { id: row.id },
    data: { isEnabled: false, rowVersion: row.rowVersion + 1 },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'SUPPLIER_SOURCE_DISABLED',
    entityType: 'SupplierSource',
    entityId: row.id,
  });
  return reload(tx, row.id);
}
