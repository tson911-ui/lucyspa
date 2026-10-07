import type { ProductSettingsEditRequest, ProductSettingsResponse } from '@lucy-spa/contracts';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import * as input from './product-catalog.input.js';
import { requireManage, requireRead } from './product-catalog.present.js';

/**
 * Phase 6 (P6-3b and P6-4): the one settings row of the product module (`product_settings`, id 1). Reading needs
 * `MANAGE_PRODUCTS` or `MANAGE_PRODUCT_PRICES` (the catalog screens); changing needs `MANAGE_PRODUCTS`. Only the keys present change
 * (the waiting-time pair together); a stale `expectedRowVersion` is a conflict; every change is audited with before and after.
 */

const SETTINGS_ID = 1;

const select = {
  leadTimeDaysMin: true,
  leadTimeDaysMax: true,
  expiryWarningDays: true,
  rowVersion: true,
} as const;

function expiryDays(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 730) {
    throw new AuthError('VALIDATION_FAILED', 'expiryWarningDays');
  }
  return value;
}

export async function getSettings(context: AdminContext): Promise<ProductSettingsResponse> {
  const access = requireRead(context);
  const row = await context.tx.productSettings.findUniqueOrThrow({
    where: { id: SETTINGS_ID },
    select,
  });
  return { ...row, access };
}

export async function editSettings(
  context: AdminContext,
  request: ProductSettingsEditRequest,
): Promise<ProductSettingsResponse> {
  const access = requireManage(context);
  const expected = input.rowVersion(request.expectedRowVersion);
  const lead = input.leadTime(request.leadTimeDaysMin, request.leadTimeDaysMax);
  if (lead && (lead.min === null || lead.max === null)) {
    // The settings default always has a value: it cannot be cleared.
    throw new AuthError('VALIDATION_FAILED', 'leadTimeDays');
  }
  const expiry =
    request.expiryWarningDays === undefined ? undefined : expiryDays(request.expiryWarningDays);
  const { tx } = context;
  const locked = await tx.$queryRaw<
    { id: number }[]
  >`SELECT id FROM product_settings WHERE id = ${SETTINGS_ID} FOR UPDATE`;
  if (locked.length === 0) throw new AuthError('NOT_FOUND');
  const current = await tx.productSettings.findUniqueOrThrow({
    where: { id: SETTINGS_ID },
    select,
  });
  if (current.rowVersion !== expected) throw new AuthError('CONFLICT');
  const next = {
    leadTimeDaysMin: lead?.min ?? current.leadTimeDaysMin,
    leadTimeDaysMax: lead?.max ?? current.leadTimeDaysMax,
    expiryWarningDays: expiry ?? current.expiryWarningDays,
  };
  const changed =
    next.leadTimeDaysMin !== current.leadTimeDaysMin ||
    next.leadTimeDaysMax !== current.leadTimeDaysMax ||
    next.expiryWarningDays !== current.expiryWarningDays;
  if (!changed) return { ...current, access };
  const saved = await tx.productSettings.update({
    where: { id: SETTINGS_ID },
    data: {
      ...next,
      updatedByUserId: context.actor.userId,
      rowVersion: current.rowVersion + 1,
    },
    select,
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_SETTINGS_UPDATED',
    entityType: 'ProductSettings',
    entityId: String(SETTINGS_ID),
    before: {
      leadTimeDaysMin: current.leadTimeDaysMin,
      leadTimeDaysMax: current.leadTimeDaysMax,
      expiryWarningDays: current.expiryWarningDays,
    },
    after: next,
  });
  return { ...saved, access };
}
