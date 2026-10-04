import type {
  ComboCreateRequest,
  ComboListResponse,
  ComboResponse,
  ComboValuesRequest,
  ComboVersionRequest,
  ComboVersionResponse,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { parseVnd } from '../pos/invoice.calc.js';

/**
 * Phase 5 P5-7: combo definitions (design 9.1, PRD 17.1-17.3). `MANAGE_COMBOS` is GLOBAL_ONLY: an Owner or a manager who holds it
 * defines combos for the whole spa. A combo has one service that never changes; everything else (name, sessions, price, active)
 * lives in append-only versions, so saving never edits history and a combo already sold keeps the copy it was sold with.
 * Lucy Spa combos do not expire (the expiry mode is stored for a future package and always `NONE` here). Not hard-coded to
 * 5+1 or 10+2: any number of paid and bonus sessions. Everything is explicit; nothing is preset (the module ships empty).
 */

const GLOBAL = { kind: 'GLOBAL' } as const;
const MAX_SESSIONS = 200;
const MAX_NAME = 120;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function requireManageCombos(context: AdminContext): void {
  if (!decide(context.actor.graph, 'MANAGE_COMBOS', GLOBAL)) throw new AuthError('FORBIDDEN');
}

const versionSelect = {
  id: true,
  version: true,
  nameVi: true,
  nameEn: true,
  paidSessions: true,
  bonusSessions: true,
  priceVnd: true,
  active: true,
  createdAt: true,
  createdBy: { select: { fullName: true } },
} satisfies Prisma.ComboVersionSelect;

type VersionRow = Prisma.ComboVersionGetPayload<{ select: typeof versionSelect }>;

const comboSelect = {
  id: true,
  code: true,
  createdAt: true,
  service: { select: { id: true, code: true, nameVi: true, nameEn: true } },
  versions: { orderBy: { version: 'desc' }, select: versionSelect },
} satisfies Prisma.ComboSelect;

type ComboRow = Prisma.ComboGetPayload<{ select: typeof comboSelect }>;

function presentVersion(row: VersionRow): ComboVersionResponse {
  return {
    id: row.id,
    versionNo: row.version,
    nameVi: row.nameVi,
    nameEn: row.nameEn,
    paidSessions: row.paidSessions,
    bonusSessions: row.bonusSessions,
    totalSessions: row.paidSessions + row.bonusSessions,
    priceVnd: row.priceVnd.toString(),
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdBy.fullName,
  };
}

function presentCombo(row: ComboRow): ComboResponse {
  const versions = row.versions.map(presentVersion);
  const current = versions[0];
  if (!current) throw new Error('A combo always has a first version.');
  return {
    id: row.id,
    code: row.code,
    service: row.service,
    current,
    versions,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Every combo, newest first, with its history. Only for `MANAGE_COMBOS`. */
export async function listCombos(context: AdminContext): Promise<ComboListResponse> {
  requireManageCombos(context);
  const { tx } = context;
  const rows = await tx.combo.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    select: comboSelect,
  });
  const services = await tx.service.findMany({
    where: { isActive: true },
    orderBy: [{ nameVi: 'asc' }, { id: 'asc' }],
    select: { id: true, code: true, nameVi: true, nameEn: true },
  });
  return {
    combos: rows.map(presentCombo),
    serviceOptions: services,
    loyaltyLive: (await tx.loyaltyGoLive.count()) > 0,
  };
}

function textField(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new AuthError('VALIDATION_FAILED', field);
  const text = value.normalize('NFC').trim();
  if (text.length === 0 || text.length > MAX_NAME) throw new AuthError('VALIDATION_FAILED', field);
  return text;
}

function intField(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return value;
}

function parseValues(input: ComboValuesRequest) {
  const priceVnd = parseVnd(input.priceVnd, 'priceVnd');
  if (priceVnd <= 0n) throw new AuthError('VALIDATION_FAILED', 'priceVnd');
  if (typeof input.active !== 'boolean') throw new AuthError('VALIDATION_FAILED', 'active');
  return {
    nameVi: textField(input.nameVi, 'nameVi'),
    nameEn: textField(input.nameEn, 'nameEn'),
    paidSessions: intField(input.paidSessions, 'paidSessions', 1, MAX_SESSIONS),
    bonusSessions: intField(input.bonusSessions, 'bonusSessions', 0, MAX_SESSIONS),
    priceVnd,
    active: input.active,
  };
}

function sameValues(current: VersionRow, next: ReturnType<typeof parseValues>): boolean {
  return (
    current.nameVi === next.nameVi &&
    current.nameEn === next.nameEn &&
    current.paidSessions === next.paidSessions &&
    current.bonusSessions === next.bonusSessions &&
    current.priceVnd === next.priceVnd &&
    current.active === next.active
  );
}

function newCode(): string {
  let suffix = '';
  for (let index = 0; index < 6; index += 1) {
    suffix += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `COMBO-${suffix}`;
}

async function loadCombo(tx: Prisma.TransactionClient, id: string): Promise<ComboResponse> {
  const row = await tx.combo.findUniqueOrThrow({ where: { id }, select: comboSelect });
  return presentCombo(row);
}

/**
 * Creates a combo with its first version. The service must exist and be active; the code is generated (the Owner never types
 * one). Appears in the sale list only when its current version is active.
 */
export async function createCombo(
  context: AdminContext,
  input: ComboCreateRequest,
): Promise<ComboResponse> {
  requireManageCombos(context);
  const values = parseValues(input);
  const { tx } = context;
  if (typeof input.serviceId !== 'string') throw new AuthError('VALIDATION_FAILED', 'serviceId');
  const service = await tx.service.findFirst({
    where: { id: input.serviceId, isActive: true },
    select: { id: true, code: true },
  });
  if (!service) throw new AuthError('COMBO_SERVICE_INVALID');
  let code = '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = newCode();
    if (!(await tx.combo.findUnique({ where: { code: candidate }, select: { id: true } }))) {
      code = candidate;
      break;
    }
  }
  if (!code) throw new AuthError('SERVICE_UNAVAILABLE');
  const created = await tx.combo.create({
    data: {
      code,
      serviceId: service.id,
      createdByUserId: context.actor.userId,
      versions: { create: { version: 1, ...values, createdByUserId: context.actor.userId } },
    },
    select: { id: true },
  });
  const response = await loadCombo(tx, created.id);
  await appendAdminAudit(context, {
    action: 'COMBO_CREATED',
    entityType: 'Combo',
    entityId: created.id,
    classification: 'FINANCIAL',
    after: {
      code,
      serviceId: service.id,
      version: response.current as unknown as Prisma.InputJsonObject,
    },
  });
  return response;
}

/**
 * Appends the next version (an edit, switching the combo off and on again are all versions). The combo row is locked first, so
 * two saves and a sale starting at the same moment are serialized; `expectedVersionNo` must be the version the editor started
 * from, else 409 CONFLICT. Saving the very same values returns the current state quietly. Invoices and combos already sold keep
 * the copy they were created with.
 */
export async function addComboVersion(
  context: AdminContext,
  comboId: string,
  input: ComboVersionRequest,
): Promise<ComboResponse> {
  requireManageCombos(context);
  const values = parseValues(input);
  const expected = input.expectedVersionNo;
  if (!Number.isSafeInteger(expected) || expected < 1) {
    throw new AuthError('VALIDATION_FAILED', 'expectedVersionNo');
  }
  const { tx } = context;
  const exists = await tx.combo.findUnique({ where: { id: comboId }, select: { id: true } });
  if (!exists) throw new AuthError('NOT_FOUND');
  await tx.$queryRaw`SELECT id FROM combos WHERE id = ${comboId}::uuid FOR UPDATE`;
  const current = await tx.comboVersion.findFirst({
    where: { comboId },
    orderBy: { version: 'desc' },
    select: versionSelect,
  });
  if (!current || current.version !== expected) throw new AuthError('CONFLICT');
  if (sameValues(current, values)) return loadCombo(tx, comboId);
  const created = await tx.comboVersion.create({
    data: {
      comboId,
      version: current.version + 1,
      ...values,
      createdByUserId: context.actor.userId,
    },
    select: versionSelect,
  });
  await appendAdminAudit(context, {
    action: 'COMBO_VERSION_SAVED',
    entityType: 'Combo',
    entityId: comboId,
    classification: 'FINANCIAL',
    before: presentVersion(current) as unknown as Prisma.InputJsonObject,
    after: presentVersion(created) as unknown as Prisma.InputJsonObject,
  });
  return loadCombo(tx, comboId);
}
