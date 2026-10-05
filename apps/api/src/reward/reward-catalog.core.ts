import type {
  RewardCatalogCreateRequest,
  RewardCatalogEditRequest,
  RewardCatalogItemResponse,
  RewardCatalogListResponse,
  RewardCatalogValuesRequest,
  RewardKindName,
} from '@lucy-spa/contracts';
import { REWARD_MAX_EXPIRY_DAYS } from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';

/**
 * Phase 5 P5-9: the reward catalog definitions (design 10, PRD 21). `MANAGE_REWARD_CATALOG` is GLOBAL_ONLY: an Owner or a manager
 * who holds it defines items for the whole spa. The catalog SHIPS EMPTY; nothing is preset. An item's code, kind and service never
 * change; its names, active flag and expiry rule are edited in place under an optimistic `rowVersion` and audited with before and
 * after. An item is never deleted (switch it off). A change of the expiry rule applies to FUTURE grants only: an entitlement fixes
 * its own expiry when it is issued. Definitions may be saved while go-live is OFF (like combos); granting needs go-live.
 */

const GLOBAL = { kind: 'GLOBAL' } as const;
const MAX_NAME = 120;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const KINDS: readonly RewardKindName[] = ['FREE_SERVICE', 'VOUCHER', 'PRODUCT_GIFT'];

export function requireManageCatalog(context: AdminContext): void {
  if (!decide(context.actor.graph, 'MANAGE_REWARD_CATALOG', GLOBAL)) {
    throw new AuthError('FORBIDDEN');
  }
}

const itemSelect = {
  id: true,
  code: true,
  kind: true,
  nameVi: true,
  nameEn: true,
  active: true,
  expiryMode: true,
  expiryDays: true,
  rowVersion: true,
  createdAt: true,
  updatedAt: true,
  service: { select: { id: true, nameVi: true, nameEn: true } },
  createdBy: { select: { fullName: true } },
} satisfies Prisma.RewardCatalogItemSelect;

type ItemRow = Prisma.RewardCatalogItemGetPayload<{ select: typeof itemSelect }>;

export function presentItem(row: ItemRow): RewardCatalogItemResponse {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    service: row.service,
    nameVi: row.nameVi,
    nameEn: row.nameEn,
    active: row.active,
    expiryDays: row.expiryMode === 'DAYS_AFTER_ISSUE' ? row.expiryDays : null,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdByName: row.createdBy.fullName,
  };
}

/** Every item, newest first. Only for `MANAGE_REWARD_CATALOG`. */
export async function listCatalog(context: AdminContext): Promise<RewardCatalogListResponse> {
  requireManageCatalog(context);
  const { tx } = context;
  const [rows, services, live] = await Promise.all([
    tx.rewardCatalogItem.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: itemSelect,
    }),
    tx.service.findMany({
      where: { isActive: true },
      orderBy: [{ nameVi: 'asc' }, { id: 'asc' }],
      select: { id: true, code: true, nameVi: true, nameEn: true },
    }),
    tx.loyaltyGoLive.count(),
  ]);
  return { items: rows.map(presentItem), serviceOptions: services, loyaltyLive: live > 0 };
}

function textField(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new AuthError('VALIDATION_FAILED', field);
  const text = value.normalize('NFC').trim();
  if (text.length === 0 || text.length > MAX_NAME) throw new AuthError('VALIDATION_FAILED', field);
  return text;
}

function parseValues(input: RewardCatalogValuesRequest) {
  if (typeof input.active !== 'boolean') throw new AuthError('VALIDATION_FAILED', 'active');
  const days = input.expiryDays;
  if (
    days !== null &&
    (typeof days !== 'number' ||
      !Number.isSafeInteger(days) ||
      days < 1 ||
      days > REWARD_MAX_EXPIRY_DAYS)
  ) {
    throw new AuthError('VALIDATION_FAILED', 'expiryDays');
  }
  return {
    nameVi: textField(input.nameVi, 'nameVi'),
    nameEn: textField(input.nameEn, 'nameEn'),
    active: input.active,
    expiryMode: days === null ? ('NONE' as const) : ('DAYS_AFTER_ISSUE' as const),
    expiryDays: days,
  };
}

function newCode(): string {
  let suffix = '';
  for (let index = 0; index < 6; index += 1) {
    suffix += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `REWARD-${suffix}`;
}

async function loadItem(tx: Prisma.TransactionClient, id: string) {
  return tx.rewardCatalogItem.findUniqueOrThrow({ where: { id }, select: itemSelect });
}

/**
 * Creates an item. A `FREE_SERVICE` item must name an active service (so the service it grants is never vague); the other kinds
 * must not. The code is generated (the Owner never types one).
 */
export async function createItem(
  context: AdminContext,
  input: RewardCatalogCreateRequest,
): Promise<RewardCatalogItemResponse> {
  requireManageCatalog(context);
  if (!KINDS.includes(input.kind)) throw new AuthError('VALIDATION_FAILED', 'kind');
  const values = parseValues(input);
  const { tx } = context;
  let serviceId: string | null = null;
  if (input.kind === 'FREE_SERVICE') {
    if (typeof input.serviceId !== 'string') throw new AuthError('VALIDATION_FAILED', 'serviceId');
    const service = await tx.service.findFirst({
      where: { id: input.serviceId, isActive: true },
      select: { id: true },
    });
    if (!service) throw new AuthError('REWARD_SERVICE_INVALID');
    serviceId = service.id;
  } else if (input.serviceId !== null && input.serviceId !== undefined) {
    throw new AuthError('VALIDATION_FAILED', 'serviceId');
  }
  let code = '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = newCode();
    if (
      !(await tx.rewardCatalogItem.findUnique({ where: { code: candidate }, select: { id: true } }))
    ) {
      code = candidate;
      break;
    }
  }
  if (!code) throw new AuthError('SERVICE_UNAVAILABLE');
  const created = await tx.rewardCatalogItem.create({
    data: { code, kind: input.kind, serviceId, createdByUserId: context.actor.userId, ...values },
    select: itemSelect,
  });
  const response = presentItem(created);
  await appendAdminAudit(context, {
    action: 'REWARD_ITEM_CREATED',
    entityType: 'RewardCatalogItem',
    entityId: created.id,
    after: response as unknown as Prisma.InputJsonObject,
  });
  return response;
}

/**
 * Edits the names, the active flag and the expiry rule. The item row is locked first and `expectedRowVersion` must be the version
 * the editor started from, else 409 CONFLICT. Saving the same values returns the current state quietly (no audit, no new
 * version). Entitlements already granted keep their own expiry.
 */
export async function editItem(
  context: AdminContext,
  itemId: string,
  input: RewardCatalogEditRequest,
): Promise<RewardCatalogItemResponse> {
  requireManageCatalog(context);
  const values = parseValues(input);
  const expected = input.expectedRowVersion;
  if (!Number.isSafeInteger(expected) || expected < 1) {
    throw new AuthError('VALIDATION_FAILED', 'expectedRowVersion');
  }
  const { tx } = context;
  if (!(await tx.rewardCatalogItem.findUnique({ where: { id: itemId }, select: { id: true } }))) {
    throw new AuthError('NOT_FOUND');
  }
  await tx.$queryRaw`SELECT id FROM reward_catalog_items WHERE id = ${itemId}::uuid FOR UPDATE`;
  const current = await loadItem(tx, itemId);
  if (current.rowVersion !== expected) throw new AuthError('CONFLICT');
  if (
    current.nameVi === values.nameVi &&
    current.nameEn === values.nameEn &&
    current.active === values.active &&
    current.expiryMode === values.expiryMode &&
    current.expiryDays === values.expiryDays
  ) {
    return presentItem(current);
  }
  const saved = await tx.rewardCatalogItem.update({
    where: { id: itemId },
    data: { ...values, rowVersion: current.rowVersion + 1 },
    select: itemSelect,
  });
  const response = presentItem(saved);
  await appendAdminAudit(context, {
    action: 'REWARD_ITEM_UPDATED',
    entityType: 'RewardCatalogItem',
    entityId: itemId,
    before: presentItem(current) as unknown as Prisma.InputJsonObject,
    after: response as unknown as Prisma.InputJsonObject,
  });
  return response;
}
