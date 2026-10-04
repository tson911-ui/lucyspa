import {
  BIRTHDAY_WINDOW_MAX_TOTAL_DAYS,
  type BirthdayRewardConfigResponse,
  type BirthdayRewardSaveRequest,
  type BirthdayRewardVersionResponse,
  type BirthdayUsageLimit,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { parseVnd } from '../pos/invoice.calc.js';

/**
 * Phase 5 P5-6: the Owner's birthday gift configuration (design 8; Owner decisions of 2026-10-04, OQ-8). One configuration,
 * versioned append-only; it ships EMPTY (no row until the Owner saves a first version). `MANAGE_BIRTHDAY_REWARDS` is
 * Owner only (no role or override can hold it). Money gifts only. Every field is explicit, the usage limit included.
 * Saving never edits a version: it appends the next one, under the configuration row lock the finalizations also take.
 */

const GLOBAL = { kind: 'GLOBAL' } as const;
const MAX_INT = 2_147_483_647;

function requireOwner(context: AdminContext): void {
  if (!decide(context.actor.graph, 'MANAGE_BIRTHDAY_REWARDS', GLOBAL)) {
    throw new AuthError('FORBIDDEN');
  }
}

const versionSelect = {
  id: true,
  versionNo: true,
  isActive: true,
  kind: true,
  percentBp: true,
  fixedAmountVnd: true,
  minSpendVnd: true,
  windowDaysBefore: true,
  windowDaysAfter: true,
  combineMember: true,
  combinePromotion: true,
  combineVoucher: true,
  usageLimitUnlimited: true,
  usageLimitPerYear: true,
  createdAt: true,
  createdBy: { select: { fullName: true } },
} satisfies Prisma.BirthdayRewardVersionSelect;

type VersionRow = Prisma.BirthdayRewardVersionGetPayload<{ select: typeof versionSelect }>;

function present(row: VersionRow): BirthdayRewardVersionResponse {
  return {
    id: row.id,
    versionNo: row.versionNo,
    isActive: row.isActive,
    kind: row.kind,
    percentBp: row.percentBp,
    fixedAmountVnd: row.fixedAmountVnd === null ? null : row.fixedAmountVnd.toString(),
    minSpendVnd: row.minSpendVnd.toString(),
    windowDaysBefore: row.windowDaysBefore,
    windowDaysAfter: row.windowDaysAfter,
    combineMember: row.combineMember,
    combinePromotion: row.combinePromotion,
    combineVoucher: row.combineVoucher,
    usageLimit: row.usageLimitUnlimited
      ? { mode: 'UNLIMITED' }
      : { mode: 'PER_YEAR', perYear: row.usageLimitPerYear ?? 1 },
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdBy.fullName,
  };
}

/** The Owner's screen: the current version and the full history, newest first. Empty until a first save. */
export async function getBirthdayConfig(
  context: AdminContext,
): Promise<BirthdayRewardConfigResponse> {
  requireOwner(context);
  const { tx } = context;
  const rows = await tx.birthdayRewardVersion.findMany({
    orderBy: { versionNo: 'desc' },
    select: versionSelect,
  });
  const versions = rows.map(present);
  return {
    configured: versions.length > 0,
    current: versions[0] ?? null,
    versions,
    loyaltyLive: (await tx.loyaltyGoLive.count()) > 0,
  };
}

function boolField(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new AuthError('VALIDATION_FAILED', field);
  return value;
}

function intField(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return value;
}

/** The usage limit must be chosen explicitly: a number per birthday year, or the explicit "unlimited". */
function usageLimitField(value: unknown): BirthdayUsageLimit {
  if (typeof value !== 'object' || value === null) {
    throw new AuthError('VALIDATION_FAILED', 'usageLimit');
  }
  const mode = Reflect.get(value, 'mode');
  if (mode === 'UNLIMITED') return { mode: 'UNLIMITED' };
  if (mode === 'PER_YEAR') {
    return {
      mode: 'PER_YEAR',
      perYear: intField(Reflect.get(value, 'perYear'), 'usageLimit', 1, MAX_INT),
    };
  }
  throw new AuthError('VALIDATION_FAILED', 'usageLimit');
}

function parseInput(input: BirthdayRewardSaveRequest) {
  const expected = input.expectedVersionNo;
  if (expected !== null && (!Number.isSafeInteger(expected) || expected < 1)) {
    throw new AuthError('VALIDATION_FAILED', 'expectedVersionNo');
  }
  const kind = input.kind;
  if (kind !== 'PERCENT' && kind !== 'FIXED_AMOUNT') {
    throw new AuthError('VALIDATION_FAILED', 'kind');
  }
  let percentBp: number | null = null;
  let fixedAmountVnd: bigint | null = null;
  if (kind === 'PERCENT') {
    percentBp = intField(input.percentBp, 'percentBp', 1, 10_000);
    if (input.fixedAmountVnd !== null) throw new AuthError('VALIDATION_FAILED', 'fixedAmountVnd');
  } else {
    fixedAmountVnd = parseVnd(input.fixedAmountVnd, 'fixedAmountVnd');
    if (fixedAmountVnd <= 0n) throw new AuthError('VALIDATION_FAILED', 'fixedAmountVnd');
    if (input.percentBp !== null) throw new AuthError('VALIDATION_FAILED', 'percentBp');
  }
  const windowDaysBefore = intField(
    input.windowDaysBefore,
    'windowDaysBefore',
    0,
    BIRTHDAY_WINDOW_MAX_TOTAL_DAYS,
  );
  const windowDaysAfter = intField(
    input.windowDaysAfter,
    'windowDaysAfter',
    0,
    BIRTHDAY_WINDOW_MAX_TOTAL_DAYS,
  );
  if (windowDaysBefore + windowDaysAfter > BIRTHDAY_WINDOW_MAX_TOTAL_DAYS) {
    throw new AuthError('VALIDATION_FAILED', 'windowDaysAfter');
  }
  return {
    expected,
    isActive: boolField(input.isActive, 'isActive'),
    kind,
    percentBp,
    fixedAmountVnd,
    minSpendVnd: parseVnd(input.minSpendVnd, 'minSpendVnd'),
    windowDaysBefore,
    windowDaysAfter,
    combineMember: boolField(input.combineMember, 'combineMember'),
    combinePromotion: boolField(input.combinePromotion, 'combinePromotion'),
    combineVoucher: boolField(input.combineVoucher, 'combineVoucher'),
    usageLimit: usageLimitField(input.usageLimit),
  };
}

function sameAsCurrent(current: VersionRow, next: ReturnType<typeof parseInput>): boolean {
  return (
    current.isActive === next.isActive &&
    current.kind === next.kind &&
    current.percentBp === next.percentBp &&
    current.fixedAmountVnd === next.fixedAmountVnd &&
    current.minSpendVnd === next.minSpendVnd &&
    current.windowDaysBefore === next.windowDaysBefore &&
    current.windowDaysAfter === next.windowDaysAfter &&
    current.combineMember === next.combineMember &&
    current.combinePromotion === next.combinePromotion &&
    current.combineVoucher === next.combineVoucher &&
    current.usageLimitUnlimited === (next.usageLimit.mode === 'UNLIMITED') &&
    current.usageLimitPerYear ===
      (next.usageLimit.mode === 'PER_YEAR' ? next.usageLimit.perYear : null)
  );
}

/**
 * Appends the next version (an edit, an activation and a deactivation are all versions). The first save creates the single
 * configuration row. `expectedVersionNo` must be the version the Owner edited from, else 409 CONFLICT; saving the very same
 * values again returns the current state quietly (no second version). Finalized invoices keep the version they were computed
 * under: nothing already issued changes.
 */
export async function saveBirthdayConfig(
  context: AdminContext,
  input: BirthdayRewardSaveRequest,
): Promise<BirthdayRewardConfigResponse> {
  requireOwner(context);
  const next = parseInput(input);
  const { tx } = context;
  const config =
    (await tx.birthdayRewardConfig.findFirst({ select: { id: true } })) ??
    (await tx.birthdayRewardConfig.create({
      data: { createdByUserId: context.actor.userId },
      select: { id: true },
    }));
  // The same row every finalization of a birthday invoice locks: a save and a finalization are serialized.
  await tx.$queryRaw`SELECT id FROM birthday_reward_configs WHERE id = ${config.id}::uuid FOR UPDATE`;
  const current = await tx.birthdayRewardVersion.findFirst({
    where: { configId: config.id },
    orderBy: { versionNo: 'desc' },
    select: versionSelect,
  });
  if ((current?.versionNo ?? null) !== next.expected) throw new AuthError('CONFLICT');
  if (current && sameAsCurrent(current, next)) return getBirthdayConfig(context);
  const created = await tx.birthdayRewardVersion.create({
    data: {
      configId: config.id,
      versionNo: (current?.versionNo ?? 0) + 1,
      isActive: next.isActive,
      kind: next.kind,
      percentBp: next.percentBp,
      fixedAmountVnd: next.fixedAmountVnd,
      minSpendVnd: next.minSpendVnd,
      windowDaysBefore: next.windowDaysBefore,
      windowDaysAfter: next.windowDaysAfter,
      combineMember: next.combineMember,
      combinePromotion: next.combinePromotion,
      combineVoucher: next.combineVoucher,
      usageLimitUnlimited: next.usageLimit.mode === 'UNLIMITED',
      usageLimitPerYear: next.usageLimit.mode === 'PER_YEAR' ? next.usageLimit.perYear : null,
      createdByUserId: context.actor.userId,
    },
    select: versionSelect,
  });
  await appendAdminAudit(context, {
    action: 'BIRTHDAY_REWARD_SAVED',
    entityType: 'BirthdayRewardConfig',
    entityId: config.id,
    classification: 'FINANCIAL',
    ...(current ? { before: present(current) as unknown as Prisma.InputJsonObject } : {}),
    after: present(created) as unknown as Prisma.InputJsonObject,
  });
  return getBirthdayConfig(context);
}
