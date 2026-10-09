import {
  onlinePolicyDefault,
  VIETNAM_PROVINCES,
  type OnlineSalesPublicResponse,
  type OnlineSalesSettingsResponse,
  type OnlineSalesSettingsUpdateRequest,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import * as input from '../inventory/inventory.input.js';
import { requireManage } from '../products/product-catalog.present.js';
import { money, policyText, smallInt } from './online.input.js';

/**
 * Phase 6 Wave 4 (P6-19; T40, OQ-89, OQ-92, OQ-94, OQ-103; the master switch of the Owner, 2026-10-09): the ONE settings row of online
 * sales. Reading and changing need `MANAGE_PRODUCTS` (T39: no new permission). The switch "Bán online" is OFF until the Owner turns it on;
 * it cannot be turned on without a fulfilment branch (active) or while PayOS is not configured. A changed policy text is a new policy
 * version that customers accept again. Every change is audited with before and after; a stale version is a conflict.
 */
const SETTINGS_ID = 1;

const select = {
  enabled: true,
  fulfilmentBranchId: true,
  fulfilmentBranch: { select: { name: true } },
  unpaidTimeoutMinutes: true,
  maxUnpaidOrders: true,
  maxCartLines: true,
  maxLineQuantity: true,
  shipWithinWorkingDays: true,
  transitDaysMin: true,
  transitDaysMax: true,
  shippingFeeEnabled: true,
  shippingFeeVnd: true,
  freeShippingThresholdVnd: true,
  policyVersion: true,
  policyVi: true,
  policyEn: true,
  rowVersion: true,
  updatedAt: true,
} as const;

export type OnlineSettingsRow = Prisma.OnlineSalesSettingsGetPayload<{ select: typeof select }>;

export async function readOnlineSettings(tx: Prisma.TransactionClient): Promise<OnlineSettingsRow> {
  return tx.onlineSalesSettings.findUniqueOrThrow({ where: { id: SETTINGS_ID }, select });
}

/** The shipping fee a customer is charged: 0 unless the fee setting is ON, and then 0 again from the free-shipping threshold (T40). */
export function shippingFeeFor(
  settings: OnlineSettingsRow,
  subtotalAfterDiscountVnd: bigint,
): bigint {
  if (!settings.shippingFeeEnabled) return 0n;
  if (
    settings.freeShippingThresholdVnd !== null &&
    subtotalAfterDiscountVnd >= settings.freeShippingThresholdVnd
  ) {
    return 0n;
  }
  return settings.shippingFeeVnd;
}

function present(
  row: OnlineSettingsRow,
  branches: { id: string; name: string }[],
  paymentConfigured: boolean,
): OnlineSalesSettingsResponse {
  return {
    enabled: row.enabled,
    fulfilmentBranchId: row.fulfilmentBranchId,
    fulfilmentBranchName: row.fulfilmentBranch?.name ?? null,
    unpaidTimeoutMinutes: row.unpaidTimeoutMinutes,
    maxUnpaidOrders: row.maxUnpaidOrders,
    maxCartLines: row.maxCartLines,
    maxLineQuantity: row.maxLineQuantity,
    shipWithinWorkingDays: row.shipWithinWorkingDays,
    transitDaysMin: row.transitDaysMin,
    transitDaysMax: row.transitDaysMax,
    shippingFeeEnabled: row.shippingFeeEnabled,
    shippingFeeVnd: row.shippingFeeVnd.toString(),
    freeShippingThresholdVnd: row.freeShippingThresholdVnd?.toString() ?? null,
    policyVersion: row.policyVersion,
    policyVi: row.policyVi,
    policyEn: row.policyEn,
    rowVersion: row.rowVersion,
    updatedAt: row.updatedAt.toISOString(),
    branches,
    paymentConfigured,
  };
}

async function activeBranches(tx: Prisma.TransactionClient) {
  return tx.branch.findMany({
    where: { isActive: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true },
  });
}

export async function getOnlineSettings(
  context: AdminContext,
  paymentConfigured: boolean,
): Promise<OnlineSalesSettingsResponse> {
  requireManage(context);
  const row = await readOnlineSettings(context.tx);
  return present(row, await activeBranches(context.tx), paymentConfigured);
}

const KEYS = [
  'expectedVersion',
  'enabled',
  'fulfilmentBranchId',
  'unpaidTimeoutMinutes',
  'maxUnpaidOrders',
  'maxCartLines',
  'maxLineQuantity',
  'shipWithinWorkingDays',
  'transitDaysMin',
  'transitDaysMax',
  'shippingFeeEnabled',
  'shippingFeeVnd',
  'freeShippingThresholdVnd',
  'policyVi',
  'policyEn',
] as const;

export async function editOnlineSettings(
  context: AdminContext,
  request: OnlineSalesSettingsUpdateRequest,
  paymentConfigured: boolean,
): Promise<OnlineSalesSettingsResponse> {
  requireManage(context);
  const raw = input.record(request, 'settings', KEYS);
  const expected = input.rowVersion(raw['expectedVersion']);
  const { tx } = context;
  const locked = await tx.$queryRaw<
    { id: number }[]
  >`SELECT id FROM online_sales_settings WHERE id = ${SETTINGS_ID} FOR UPDATE`;
  if (locked.length === 0) throw new AuthError('NOT_FOUND');
  const current = await readOnlineSettings(tx);
  if (current.rowVersion !== expected) throw new AuthError('CONFLICT');

  const has = (key: (typeof KEYS)[number]) => raw[key] !== undefined;
  const branchId = has('fulfilmentBranchId')
    ? input.optionalUuid(raw['fulfilmentBranchId'], 'fulfilmentBranchId')
    : current.fulfilmentBranchId;
  if (branchId !== null && branchId !== current.fulfilmentBranchId) {
    const branch = await tx.branch.findFirst({
      where: { id: branchId, isActive: true },
      select: { id: true },
    });
    if (!branch) throw new AuthError('VALIDATION_FAILED', 'fulfilmentBranchId');
  }
  const transitDaysMin = has('transitDaysMin')
    ? smallInt(raw['transitDaysMin'], 'transitDaysMin', 0, 60)
    : current.transitDaysMin;
  const transitDaysMax = has('transitDaysMax')
    ? smallInt(raw['transitDaysMax'], 'transitDaysMax', 0, 60)
    : current.transitDaysMax;
  if (transitDaysMax < transitDaysMin) throw new AuthError('VALIDATION_FAILED', 'transitDaysMax');
  const threshold = has('freeShippingThresholdVnd')
    ? raw['freeShippingThresholdVnd'] === null
      ? null
      : money(raw['freeShippingThresholdVnd'], 'freeShippingThresholdVnd')
    : current.freeShippingThresholdVnd;
  if (threshold !== null && threshold <= 0n) {
    throw new AuthError('VALIDATION_FAILED', 'freeShippingThresholdVnd');
  }
  const policyVi = has('policyVi') ? policyText(raw['policyVi'], 'policyVi') : current.policyVi;
  const policyEn = has('policyEn') ? policyText(raw['policyEn'], 'policyEn') : current.policyEn;
  const enabled = has('enabled') ? input.boolean(raw['enabled'], 'enabled') : current.enabled;
  if (enabled && branchId === null) {
    throw new AuthError('ONLINE_SALES_NEEDS_BRANCH', 'fulfilmentBranchId');
  }
  if (enabled && !current.enabled && !paymentConfigured) {
    throw new AuthError('PAYMENT_METHOD_UNAVAILABLE', 'enabled');
  }
  const next = {
    enabled,
    fulfilmentBranchId: branchId,
    unpaidTimeoutMinutes: has('unpaidTimeoutMinutes')
      ? smallInt(raw['unpaidTimeoutMinutes'], 'unpaidTimeoutMinutes', 5, 120)
      : current.unpaidTimeoutMinutes,
    maxUnpaidOrders: has('maxUnpaidOrders')
      ? smallInt(raw['maxUnpaidOrders'], 'maxUnpaidOrders', 1, 20)
      : current.maxUnpaidOrders,
    maxCartLines: has('maxCartLines')
      ? smallInt(raw['maxCartLines'], 'maxCartLines', 1, 100)
      : current.maxCartLines,
    maxLineQuantity: has('maxLineQuantity')
      ? smallInt(raw['maxLineQuantity'], 'maxLineQuantity', 1, 100)
      : current.maxLineQuantity,
    shipWithinWorkingDays: has('shipWithinWorkingDays')
      ? smallInt(raw['shipWithinWorkingDays'], 'shipWithinWorkingDays', 1, 30)
      : current.shipWithinWorkingDays,
    transitDaysMin,
    transitDaysMax,
    shippingFeeEnabled: has('shippingFeeEnabled')
      ? input.boolean(raw['shippingFeeEnabled'], 'shippingFeeEnabled')
      : current.shippingFeeEnabled,
    shippingFeeVnd: has('shippingFeeVnd')
      ? money(raw['shippingFeeVnd'], 'shippingFeeVnd')
      : current.shippingFeeVnd,
    freeShippingThresholdVnd: threshold,
    policyVi,
    policyEn,
  };
  const policyChanged = policyVi !== current.policyVi || policyEn !== current.policyEn;
  const changed =
    policyChanged ||
    (Object.keys(next) as (keyof typeof next)[]).some((key) => next[key] !== current[key]);
  if (!changed) {
    return present(current, await activeBranches(tx), paymentConfigured);
  }
  const saved = await tx.onlineSalesSettings.update({
    where: { id: SETTINGS_ID },
    data: {
      ...next,
      policyVersion: policyChanged ? current.policyVersion + 1 : current.policyVersion,
      updatedByUserId: context.actor.userId,
      rowVersion: current.rowVersion + 1,
    },
    select,
  });
  const snapshot = (row: OnlineSettingsRow | typeof next) => ({
    enabled: row.enabled,
    fulfilmentBranchId: row.fulfilmentBranchId,
    unpaidTimeoutMinutes: row.unpaidTimeoutMinutes,
    maxUnpaidOrders: row.maxUnpaidOrders,
    maxCartLines: row.maxCartLines,
    maxLineQuantity: row.maxLineQuantity,
    shipWithinWorkingDays: row.shipWithinWorkingDays,
    transitDaysMin: row.transitDaysMin,
    transitDaysMax: row.transitDaysMax,
    shippingFeeEnabled: row.shippingFeeEnabled,
    shippingFeeVnd: row.shippingFeeVnd.toString(),
    freeShippingThresholdVnd: row.freeShippingThresholdVnd?.toString() ?? null,
  });
  await appendAdminAudit(context, {
    action: enabled !== current.enabled ? 'ONLINE_SALES_SWITCHED' : 'ONLINE_SALES_SETTINGS_UPDATED',
    entityType: 'OnlineSalesSettings',
    entityId: String(SETTINGS_ID),
    classification: 'FINANCIAL',
    before: { ...snapshot(current), policyVersion: current.policyVersion },
    after: { ...snapshot(saved), policyVersion: saved.policyVersion, policyChanged },
  });
  return present(saved, await activeBranches(tx), paymentConfigured);
}

/** What the public site and a signed-in customer may read. The text is the Owner's, or the draft built from the decisions the Owner approved. */
export function presentPublic(row: OnlineSettingsRow): OnlineSalesPublicResponse {
  const fee = row.shippingFeeEnabled ? row.shippingFeeVnd : 0n;
  return {
    enabled: row.enabled && row.fulfilmentBranchId !== null,
    unpaidTimeoutMinutes: row.unpaidTimeoutMinutes,
    maxCartLines: row.maxCartLines,
    maxLineQuantity: row.maxLineQuantity,
    maxUnpaidOrders: row.maxUnpaidOrders,
    shipWithinWorkingDays: row.shipWithinWorkingDays,
    transitDaysMin: row.transitDaysMin,
    transitDaysMax: row.transitDaysMax,
    shippingFeeVnd: fee.toString(),
    freeShipping: !row.shippingFeeEnabled || fee === 0n,
    policyVersion: row.policyVersion,
    policyVi: row.policyVi ?? onlinePolicyDefault('vi', row),
    policyEn: row.policyEn ?? onlinePolicyDefault('en', row),
    provinces: VIETNAM_PROVINCES.map((province) => ({ ...province })),
  };
}
