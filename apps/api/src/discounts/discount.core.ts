import type {
  DiscountDetailResponse,
  DiscountListResponse,
  DiscountScopeName,
  DiscountStatusName,
  DiscountSummaryResponse,
  DiscountVersionInput,
  DiscountVersionResponse,
  VoucherResponse,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { randomInt } from 'node:crypto';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { canonicalVoucherCode } from '../pos/invoice.core.js';
import { parseVnd } from '../pos/invoice.calc.js';

/**
 * Phase 4 Step 6 — Owner-configured discount programs, versions and voucher codes (design 4.4, 8.2, Q4).
 * `MANAGE_DISCOUNTS` and `CREATE_VOUCHERS` are GLOBAL_ONLY: a branch grant never authorizes any command here
 * (the engine and the catalog both refuse it). Programs and versions are never deleted or edited in place:
 * "editing" appends an immutable version; early termination is permanent. Staff can never type a percentage or
 * an amount at the POS; they can only choose among what is configured here.
 */

const GLOBAL = { kind: 'GLOBAL' } as const;
const PROGRAM_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const MAX_NAME = 200;
const MAX_LIMIT = 2_147_483_647;
const MAX_SCOPE = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Code alphabet without look-alikes (no 0/1/I/O) for generated voucher codes. */
const GENERATED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function requireGlobal(context: AdminContext, ...permissions: string[]): void {
  if (!permissions.some((permission) => decide(context.actor.graph, permission, GLOBAL))) {
    throw new AuthError('FORBIDDEN');
  }
}

const canManage = (context: AdminContext) =>
  decide(context.actor.graph, 'MANAGE_DISCOUNTS', GLOBAL);
const canVouch = (context: AdminContext) => decide(context.actor.graph, 'CREATE_VOUCHERS', GLOBAL);

async function databaseClock(tx: Prisma.TransactionClient): Promise<Date> {
  const [clock] = await tx.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp()::timestamptz(3) AS now`;
  if (!clock) throw new AuthError('SERVICE_UNAVAILABLE');
  return clock.now;
}

const versionSelect = {
  id: true,
  versionNo: true,
  kind: true,
  percentBp: true,
  fixedAmountVnd: true,
  validFrom: true,
  validUntil: true,
  minSpendVnd: true,
  scopeMode: true,
  scope: true,
  usageLimitTotal: true,
  usageLimitPerCustomer: true,
  createdAt: true,
  services: { select: { serviceId: true }, orderBy: { serviceId: 'asc' } },
  categories: { select: { categoryId: true }, orderBy: { categoryId: 'asc' } },
  brands: { select: { brandId: true }, orderBy: { brandId: 'asc' } },
  productCategories: { select: { categoryId: true }, orderBy: { categoryId: 'asc' } },
  products: { select: { productId: true }, orderBy: { productId: 'asc' } },
} satisfies Prisma.DiscountVersionSelect;

type VersionRow = Prisma.DiscountVersionGetPayload<{ select: typeof versionSelect }>;

const programSelect = {
  id: true,
  code: true,
  nameVi: true,
  nameEn: true,
  requiresCode: true,
  isActive: true,
  terminatedAt: true,
  terminatedReason: true,
  rowVersion: true,
  versions: { orderBy: { versionNo: 'desc' }, select: versionSelect },
  _count: { select: { vouchers: true } },
} satisfies Prisma.DiscountSelect;

type ProgramRow = Prisma.DiscountGetPayload<{ select: typeof programSelect }>;

function versionResponse(row: VersionRow): DiscountVersionResponse {
  return {
    id: row.id,
    versionNo: row.versionNo,
    kind: row.kind,
    percentBp: row.percentBp,
    fixedAmountVnd: row.fixedAmountVnd === null ? null : row.fixedAmountVnd.toString(),
    validFrom: row.validFrom.toISOString(),
    validUntil: row.validUntil.toISOString(),
    minSpendVnd: row.minSpendVnd.toString(),
    scopeMode: row.scopeMode,
    serviceIds: row.services.map((scope) => scope.serviceId),
    categoryIds: row.categories.map((scope) => scope.categoryId),
    scope: row.scope,
    brandIds: row.brands.map((target) => target.brandId),
    productCategoryIds: row.productCategories.map((target) => target.categoryId),
    productIds: row.products.map((target) => target.productId),
    usageLimitTotal: row.usageLimitTotal,
    usageLimitPerCustomer: row.usageLimitPerCustomer,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The derived state of a program right now (never stored). */
export function programStatus(
  program: { isActive: boolean; terminatedAt: Date | null },
  current: { validFrom: Date; validUntil: Date },
  now: Date,
): DiscountStatusName {
  if (program.terminatedAt) return 'TERMINATED';
  if (!program.isActive) return 'PAUSED';
  if (now < current.validFrom) return 'SCHEDULED';
  if (now >= current.validUntil) return 'EXPIRED';
  return 'ACTIVE';
}

async function redemptionCounts(
  tx: Prisma.TransactionClient,
  programIds: readonly string[],
): Promise<{ programs: Map<string, number>; vouchers: Map<string, number> }> {
  const programs = new Map<string, number>();
  const vouchers = new Map<string, number>();
  if (programIds.length === 0) return { programs, vouchers };
  const rows = await tx.$queryRaw<{ discount_id: string; voucher_id: string | null; n: bigint }[]>`
    SELECT r.discount_id, r.voucher_id, count(*) AS n
    FROM discount_redemptions r
    LEFT JOIN discount_redemption_releases l ON l.redemption_id = r.id
    WHERE l.id IS NULL AND r.discount_id = ANY(${[...programIds]}::uuid[])
    GROUP BY r.discount_id, r.voucher_id`;
  for (const row of rows) {
    programs.set(row.discount_id, (programs.get(row.discount_id) ?? 0) + Number(row.n));
    if (row.voucher_id) vouchers.set(row.voucher_id, Number(row.n));
  }
  return { programs, vouchers };
}

function summary(row: ProgramRow, redemptions: number, now: Date): DiscountSummaryResponse {
  const current = row.versions[0];
  if (!current) throw new Error('Every discount program has at least one version.');
  return {
    id: row.id,
    code: row.code,
    nameVi: row.nameVi,
    nameEn: row.nameEn,
    requiresCode: row.requiresCode,
    isActive: row.isActive,
    terminatedAt: row.terminatedAt ? row.terminatedAt.toISOString() : null,
    status: programStatus(row, current, now),
    current: versionResponse(current),
    redemptions,
    voucherCount: row._count.vouchers,
    version: row.rowVersion,
  };
}

// ------------------------------------------------------------------------------------- input

function name(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new AuthError('VALIDATION_FAILED', field);
  const text = value.normalize('NFC').trim();
  if (!text || [...text].length > MAX_NAME) throw new AuthError('VALIDATION_FAILED', field);
  return text;
}

function instant(value: unknown, field: string): Date {
  if (typeof value !== 'string' || !INSTANT.test(value)) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AuthError('VALIDATION_FAILED', field);
  return date;
}

function limit(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return value;
}

function ids(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_SCOPE) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  const result = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || !UUID.test(entry)) {
      throw new AuthError('VALIDATION_FAILED', field);
    }
    result.add(entry.toLowerCase());
  }
  return [...result].sort();
}

interface ParsedVersion {
  kind: 'PERCENT' | 'FIXED_AMOUNT';
  percentBp: number | null;
  fixedAmountVnd: bigint | null;
  validFrom: Date;
  validUntil: Date;
  minSpendVnd: bigint;
  scopeMode: 'ALL_SERVICES' | 'SELECTED';
  serviceIds: string[];
  categoryIds: string[];
  /** Phase 6 P6-9 (Q7, OQ-P6-21): what the program may discount and, for a selection, its product targets. */
  scope: DiscountScopeName;
  brandIds: string[];
  productCategoryIds: string[];
  productIds: string[];
  usageLimitTotal: number | null;
  usageLimitPerCustomer: number | null;
}

/** An optional id list of the version input: absent is empty (a program written before Phase 6 names no product target). */
function optionalIds(value: unknown, field: string): string[] {
  return value === undefined ? [] : ids(value, field);
}

/** Validates one version's configuration (the Step 4 CHECKs are the database backstop). */
async function parseVersion(
  tx: Prisma.TransactionClient,
  input: DiscountVersionInput,
): Promise<ParsedVersion> {
  if (typeof input !== 'object' || input === null) {
    throw new AuthError('VALIDATION_FAILED', 'version');
  }
  const kind = input.kind;
  if (kind !== 'PERCENT' && kind !== 'FIXED_AMOUNT') {
    throw new AuthError('VALIDATION_FAILED', 'kind');
  }
  let percentBp: number | null = null;
  let fixedAmountVnd: bigint | null = null;
  if (kind === 'PERCENT') {
    if (input.fixedAmountVnd !== undefined)
      throw new AuthError('VALIDATION_FAILED', 'fixedAmountVnd');
    const value = input.percentBp;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 10_000) {
      throw new AuthError('VALIDATION_FAILED', 'percentBp');
    }
    percentBp = value;
  } else {
    if (input.percentBp !== undefined) throw new AuthError('VALIDATION_FAILED', 'percentBp');
    fixedAmountVnd = parseVnd(input.fixedAmountVnd, 'fixedAmountVnd');
    if (fixedAmountVnd <= 0n) throw new AuthError('VALIDATION_FAILED', 'fixedAmountVnd');
  }
  const validFrom = instant(input.validFrom, 'validFrom');
  const validUntil = instant(input.validUntil, 'validUntil');
  if (validUntil <= validFrom) throw new AuthError('VALIDATION_FAILED', 'validUntil');
  const minSpendVnd = parseVnd(input.minSpendVnd, 'minSpendVnd');
  const scopeMode = input.scopeMode;
  if (scopeMode !== 'ALL_SERVICES' && scopeMode !== 'SELECTED') {
    throw new AuthError('VALIDATION_FAILED', 'scopeMode');
  }
  const serviceIds = ids(input.serviceIds, 'serviceIds');
  const categoryIds = ids(input.categoryIds, 'categoryIds');
  // Phase 6 P6-9 (Q7): a program may discount services (the default, every program before Phase 6), products, or both. A product
  // selection (OQ-P6-21) names brands, product categories (that exact category) or products; targets must fit the scope.
  const scope = input.scope ?? 'SERVICES';
  if (scope !== 'SERVICES' && scope !== 'PRODUCTS' && scope !== 'BOTH') {
    throw new AuthError('VALIDATION_FAILED', 'scope');
  }
  const brandIds = optionalIds(input.brandIds, 'brandIds');
  const productCategoryIds = optionalIds(input.productCategoryIds, 'productCategoryIds');
  const productIds = optionalIds(input.productIds, 'productIds');
  const productTargets = brandIds.length + productCategoryIds.length + productIds.length;
  if (scope === 'SERVICES' && productTargets > 0) {
    throw new AuthError('VALIDATION_FAILED', 'brandIds');
  }
  if (scope === 'PRODUCTS' && serviceIds.length + categoryIds.length > 0) {
    throw new AuthError('VALIDATION_FAILED', 'serviceIds');
  }
  if (scopeMode === 'ALL_SERVICES' && serviceIds.length + categoryIds.length + productTargets > 0) {
    throw new AuthError('VALIDATION_FAILED', 'serviceIds');
  }
  if (scopeMode === 'SELECTED' && serviceIds.length + categoryIds.length + productTargets === 0) {
    throw new AuthError('VALIDATION_FAILED', 'serviceIds');
  }
  if (brandIds.length > 0) {
    const found = await tx.brand.count({ where: { id: { in: brandIds } } });
    if (found !== brandIds.length) throw new AuthError('VALIDATION_FAILED', 'brandIds');
  }
  if (productCategoryIds.length > 0) {
    const found = await tx.productCategory.count({ where: { id: { in: productCategoryIds } } });
    if (found !== productCategoryIds.length) {
      throw new AuthError('VALIDATION_FAILED', 'productCategoryIds');
    }
  }
  if (productIds.length > 0) {
    const found = await tx.product.count({ where: { id: { in: productIds } } });
    if (found !== productIds.length) throw new AuthError('VALIDATION_FAILED', 'productIds');
  }
  if (serviceIds.length > 0) {
    const found = await tx.service.count({ where: { id: { in: serviceIds } } });
    if (found !== serviceIds.length) throw new AuthError('VALIDATION_FAILED', 'serviceIds');
  }
  if (categoryIds.length > 0) {
    const found = await tx.serviceCategory.count({ where: { id: { in: categoryIds } } });
    if (found !== categoryIds.length) throw new AuthError('VALIDATION_FAILED', 'categoryIds');
  }
  return {
    kind,
    percentBp,
    fixedAmountVnd,
    validFrom,
    validUntil,
    minSpendVnd,
    scopeMode,
    serviceIds,
    categoryIds,
    scope,
    brandIds,
    productCategoryIds,
    productIds,
    usageLimitTotal: limit(input.usageLimitTotal, 'usageLimitTotal'),
    usageLimitPerCustomer: limit(input.usageLimitPerCustomer, 'usageLimitPerCustomer'),
  };
}

async function insertVersion(
  tx: Prisma.TransactionClient,
  discountId: string,
  versionNo: number,
  version: ParsedVersion,
  actorUserId: string,
  now: Date,
): Promise<string> {
  const created = await tx.discountVersion.create({
    data: {
      discountId,
      versionNo,
      kind: version.kind,
      percentBp: version.percentBp,
      fixedAmountVnd: version.fixedAmountVnd,
      validFrom: version.validFrom,
      validUntil: version.validUntil,
      minSpendVnd: version.minSpendVnd,
      scopeMode: version.scopeMode,
      scope: version.scope,
      usageLimitTotal: version.usageLimitTotal,
      usageLimitPerCustomer: version.usageLimitPerCustomer,
      createdByUserId: actorUserId,
      createdAt: now,
    },
    select: { id: true },
  });
  if (version.serviceIds.length > 0) {
    await tx.discountVersionService.createMany({
      data: version.serviceIds.map((serviceId) => ({ versionId: created.id, serviceId })),
    });
  }
  if (version.categoryIds.length > 0) {
    await tx.discountVersionCategory.createMany({
      data: version.categoryIds.map((categoryId) => ({ versionId: created.id, categoryId })),
    });
  }
  if (version.brandIds.length > 0) {
    await tx.discountVersionBrand.createMany({
      data: version.brandIds.map((brandId) => ({ versionId: created.id, brandId })),
    });
  }
  if (version.productCategoryIds.length > 0) {
    await tx.discountVersionProductCategory.createMany({
      data: version.productCategoryIds.map((categoryId) => ({ versionId: created.id, categoryId })),
    });
  }
  if (version.productIds.length > 0) {
    await tx.discountVersionProduct.createMany({
      data: version.productIds.map((productId) => ({ versionId: created.id, productId })),
    });
  }
  return created.id;
}

const versionFacts = (version: ParsedVersion) => ({
  kind: version.kind,
  percentBp: version.percentBp,
  fixedAmountVnd: version.fixedAmountVnd === null ? null : version.fixedAmountVnd.toString(),
  validFrom: version.validFrom.toISOString(),
  validUntil: version.validUntil.toISOString(),
  minSpendVnd: version.minSpendVnd.toString(),
  scopeMode: version.scopeMode,
  serviceIds: version.serviceIds,
  categoryIds: version.categoryIds,
  // A SERVICES program's audit facts are exactly what they were before Phase 6 (no scope noise); the others record theirs.
  ...(version.scope === 'SERVICES'
    ? {}
    : {
        scope: version.scope,
        brandIds: version.brandIds,
        productCategoryIds: version.productCategoryIds,
        productIds: version.productIds,
      }),
  usageLimitTotal: version.usageLimitTotal,
  usageLimitPerCustomer: version.usageLimitPerCustomer,
});

// ------------------------------------------------------------------------------------ reading

/** GET /discounts: `MANAGE_DISCOUNTS` or `CREATE_VOUCHERS` (GLOBAL). */
export async function listDiscounts(context: AdminContext): Promise<DiscountListResponse> {
  requireGlobal(context, 'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS');
  const rows = await context.tx.discount.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    select: programSelect,
  });
  const counts = await redemptionCounts(
    context.tx,
    rows.map((row) => row.id),
  );
  return {
    discounts: rows.map((row) => summary(row, counts.programs.get(row.id) ?? 0, context.now)),
    permissions: { manage: canManage(context), createVouchers: canVouch(context) },
  };
}

async function detail(context: AdminContext, id: string): Promise<DiscountDetailResponse> {
  const row = await context.tx.discount.findUnique({ where: { id }, select: programSelect });
  if (!row) throw new AuthError('NOT_FOUND');
  const counts = await redemptionCounts(context.tx, [id]);
  const vouchers = await context.tx.voucher.findMany({
    where: { discountId: id },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    select: { id: true, code: true, isActive: true, createdAt: true, rowVersion: true },
  });
  return {
    ...summary(row, counts.programs.get(id) ?? 0, context.now),
    terminatedReason: row.terminatedReason,
    versions: row.versions.map(versionResponse),
    vouchers: vouchers.map((voucher): VoucherResponse => ({
      id: voucher.id,
      code: voucher.code,
      isActive: voucher.isActive,
      createdAt: voucher.createdAt.toISOString(),
      version: voucher.rowVersion,
      redemptions: counts.vouchers.get(voucher.id) ?? 0,
    })),
    permissions: { manage: canManage(context), createVouchers: canVouch(context) },
  };
}

export async function getDiscount(
  context: AdminContext,
  id: string,
): Promise<DiscountDetailResponse> {
  requireGlobal(context, 'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS');
  return detail(context, id);
}

// ------------------------------------------------------------------------------------ commands

/** Creates a program with its first version (`MANAGE_DISCOUNTS`, GLOBAL only). */
export async function createDiscount(
  context: AdminContext,
  input: {
    code: unknown;
    nameVi: unknown;
    nameEn: unknown;
    requiresCode: unknown;
    version: DiscountVersionInput;
  },
): Promise<DiscountDetailResponse> {
  requireGlobal(context, 'MANAGE_DISCOUNTS');
  const { tx } = context;
  const code =
    typeof input.code === 'string' ? input.code.normalize('NFC').trim().toUpperCase() : '';
  if (!PROGRAM_CODE.test(code)) throw new AuthError('VALIDATION_FAILED', 'code');
  const nameVi = name(input.nameVi, 'nameVi');
  const nameEn = name(input.nameEn, 'nameEn');
  if (typeof input.requiresCode !== 'boolean') {
    throw new AuthError('VALIDATION_FAILED', 'requiresCode');
  }
  const version = await parseVersion(tx, input.version);
  if (await tx.discount.findUnique({ where: { code }, select: { id: true } })) {
    throw new AuthError('DISCOUNT_CODE_TAKEN');
  }
  const now = await databaseClock(tx);
  const program = await tx.discount.create({
    data: {
      code,
      nameVi,
      nameEn,
      requiresCode: input.requiresCode,
      createdAt: now,
      updatedAt: now,
    },
    select: { id: true },
  });
  await insertVersion(tx, program.id, 1, version, context.actor.userId, now);
  await appendAdminAudit(
    { ...context, now },
    {
      action: 'DISCOUNT_CREATED',
      entityType: 'Discount',
      entityId: program.id,
      classification: 'FINANCIAL',
      after: {
        code,
        nameVi,
        nameEn,
        requiresCode: input.requiresCode,
        versionNo: 1,
        ...versionFacts(version),
      },
    },
  );
  return detail(context, program.id);
}

async function lockedProgram(context: AdminContext, id: string, expectedVersion: number) {
  const { tx } = context;
  const exists = await tx.discount.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new AuthError('NOT_FOUND');
  await tx.$queryRaw`SELECT id FROM discounts WHERE id = ${id}::uuid FOR UPDATE`;
  const row = await tx.discount.findUniqueOrThrow({ where: { id }, select: programSelect });
  if (row.rowVersion !== expectedVersion) throw new AuthError('CONFLICT');
  return row;
}

/**
 * Appends a NEW immutable version (existing versions are never edited) and optionally corrects the names.
 * Finalized invoices keep the version they were redeemed under; open drafts and future finalizations use the
 * new current version. Not allowed after termination.
 */
export async function addVersion(
  context: AdminContext,
  id: string,
  input: {
    expectedVersion: number;
    nameVi?: unknown;
    nameEn?: unknown;
    version: DiscountVersionInput;
  },
): Promise<DiscountDetailResponse> {
  requireGlobal(context, 'MANAGE_DISCOUNTS');
  const { tx } = context;
  const version = await parseVersion(tx, input.version);
  const nameVi = input.nameVi === undefined ? undefined : name(input.nameVi, 'nameVi');
  const nameEn = input.nameEn === undefined ? undefined : name(input.nameEn, 'nameEn');
  const program = await lockedProgram(context, id, input.expectedVersion);
  if (program.terminatedAt) throw new AuthError('DISCOUNT_STATE_INVALID');
  const now = await databaseClock(tx);
  const previous = program.versions[0];
  // P6-9: a program that discounts products is edited by stating its scope explicitly. Leaving the scope out would silently turn it
  // back into a services-only program (the existing screens do not know the scope yet, P6-11), so it is refused instead.
  if (input.version.scope === undefined && previous && previous.scope !== 'SERVICES') {
    throw new AuthError('VALIDATION_FAILED', 'scope');
  }
  const versionNo = (previous?.versionNo ?? 0) + 1;
  await insertVersion(tx, id, versionNo, version, context.actor.userId, now);
  await tx.discount.update({
    where: { id },
    data: {
      ...(nameVi === undefined ? {} : { nameVi }),
      ...(nameEn === undefined ? {} : { nameEn }),
      rowVersion: { increment: 1 },
      updatedAt: now,
    },
    select: { id: true },
  });
  await appendAdminAudit(
    { ...context, now },
    {
      action: 'DISCOUNT_VERSIONED',
      entityType: 'Discount',
      entityId: id,
      classification: 'FINANCIAL',
      before: previous ? { versionNo: previous.versionNo } : {},
      after: { code: program.code, versionNo, ...versionFacts(version) },
    },
  );
  return detail(context, id);
}

/** Pauses or resumes a program (a reversible switch; early termination is separate and permanent). */
export async function setDiscountActive(
  context: AdminContext,
  id: string,
  input: { expectedVersion: number; isActive: boolean },
): Promise<DiscountDetailResponse> {
  requireGlobal(context, 'MANAGE_DISCOUNTS');
  const { tx } = context;
  const program = await lockedProgram(context, id, input.expectedVersion);
  if (program.terminatedAt) throw new AuthError('DISCOUNT_STATE_INVALID');
  if (program.isActive === input.isActive) return detail(context, id);
  const now = await databaseClock(tx);
  await tx.discount.update({
    where: { id },
    data: { isActive: input.isActive, rowVersion: { increment: 1 }, updatedAt: now },
    select: { id: true },
  });
  await appendAdminAudit(
    { ...context, now },
    {
      action: 'DISCOUNT_ACTIVE_CHANGED',
      entityType: 'Discount',
      entityId: id,
      classification: 'FINANCIAL',
      before: { code: program.code, isActive: program.isActive },
      after: { code: program.code, isActive: input.isActive },
    },
  );
  return detail(context, id);
}

/** Early termination: permanent, with a required reason. Existing redemptions and releases are untouched. */
export async function terminateDiscount(
  context: AdminContext,
  id: string,
  input: { expectedVersion: number; reason: string },
): Promise<DiscountDetailResponse> {
  requireGlobal(context, 'MANAGE_DISCOUNTS');
  const { tx } = context;
  const program = await lockedProgram(context, id, input.expectedVersion);
  if (program.terminatedAt) {
    // Repeating the termination is a quiet no-op.
    return detail(context, id);
  }
  const now = await databaseClock(tx);
  await tx.discount.update({
    where: { id },
    data: {
      terminatedAt: now,
      terminatedByUserId: context.actor.userId,
      terminatedReason: input.reason,
      rowVersion: { increment: 1 },
      updatedAt: now,
    },
    select: { id: true },
  });
  await appendAdminAudit(
    { ...context, now },
    {
      action: 'DISCOUNT_TERMINATED',
      entityType: 'Discount',
      entityId: id,
      classification: 'FINANCIAL',
      reason: input.reason,
      before: { code: program.code, status: programStatus(program, program.versions[0]!, now) },
      after: { code: program.code, terminatedAt: now.toISOString() },
    },
  );
  return detail(context, id);
}

function generatedCode(): string {
  let code = '';
  for (let index = 0; index < 10; index += 1) {
    code += GENERATED_ALPHABET[randomInt(GENERATED_ALPHABET.length)];
  }
  return code;
}

/** Creates a voucher code under a code-requiring program (`CREATE_VOUCHERS`, GLOBAL only). */
export async function createVoucher(
  context: AdminContext,
  id: string,
  input: { code: unknown },
): Promise<DiscountDetailResponse> {
  requireGlobal(context, 'CREATE_VOUCHERS');
  const { tx } = context;
  const exists = await tx.discount.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new AuthError('NOT_FOUND');
  await tx.$queryRaw`SELECT id FROM discounts WHERE id = ${id}::uuid FOR UPDATE`;
  const program = await tx.discount.findUniqueOrThrow({
    where: { id },
    select: { id: true, code: true, requiresCode: true, terminatedAt: true },
  });
  if (!program.requiresCode || program.terminatedAt) throw new AuthError('DISCOUNT_STATE_INVALID');
  const supplied = input.code !== undefined;
  let code = '';
  if (supplied) {
    code = canonicalVoucherCode(input.code);
    if (await tx.voucher.findUnique({ where: { code }, select: { id: true } })) {
      throw new AuthError('DISCOUNT_CODE_TAKEN');
    }
  } else {
    for (let attempt = 0; attempt < 5 && !code; attempt += 1) {
      const candidate = generatedCode();
      if (!(await tx.voucher.findUnique({ where: { code: candidate }, select: { id: true } }))) {
        code = candidate;
      }
    }
    if (!code) throw new AuthError('SERVICE_UNAVAILABLE');
  }
  const now = await databaseClock(tx);
  const voucher = await tx.voucher.create({
    data: {
      discountId: id,
      code,
      createdByUserId: context.actor.userId,
      createdAt: now,
      updatedAt: now,
    },
    select: { id: true },
  });
  await appendAdminAudit(
    { ...context, now },
    {
      action: 'VOUCHER_CREATED',
      entityType: 'Voucher',
      entityId: voucher.id,
      classification: 'FINANCIAL',
      after: {
        voucherCode: code,
        discountId: id,
        discountCode: program.code,
        generated: !supplied,
      },
    },
  );
  return detail(context, id);
}

/** Deactivates/reactivates one voucher code (`CREATE_VOUCHERS`); an inactive code can no longer be supplied. */
export async function setVoucherActive(
  context: AdminContext,
  id: string,
  voucherId: string,
  input: { expectedVersion: number; isActive: boolean },
): Promise<DiscountDetailResponse> {
  requireGlobal(context, 'CREATE_VOUCHERS');
  const { tx } = context;
  const exists = await tx.discount.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new AuthError('NOT_FOUND');
  await tx.$queryRaw`SELECT id FROM discounts WHERE id = ${id}::uuid FOR UPDATE`;
  const voucher = await tx.voucher.findFirst({
    where: { id: voucherId, discountId: id },
    select: { id: true, code: true, isActive: true, rowVersion: true },
  });
  if (!voucher) throw new AuthError('NOT_FOUND');
  if (voucher.rowVersion !== input.expectedVersion) throw new AuthError('CONFLICT');
  if (voucher.isActive === input.isActive) return detail(context, id);
  const now = await databaseClock(tx);
  await tx.voucher.update({
    where: { id: voucherId },
    data: { isActive: input.isActive, rowVersion: { increment: 1 }, updatedAt: now },
    select: { id: true },
  });
  await appendAdminAudit(
    { ...context, now },
    {
      action: 'VOUCHER_ACTIVE_CHANGED',
      entityType: 'Voucher',
      entityId: voucherId,
      classification: 'FINANCIAL',
      before: { voucherCode: voucher.code, isActive: voucher.isActive },
      after: { voucherCode: voucher.code, isActive: input.isActive },
    },
  );
  return detail(context, id);
}
