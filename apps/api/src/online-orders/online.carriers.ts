import type {
  ShippingCarrierCreateRequest,
  ShippingCarrierEditRequest,
  ShippingCarrierListResponse,
  ShippingCarrierResponse,
} from '@lucy-spa/contracts';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import * as input from '../inventory/inventory.input.js';
import { requireManage } from '../products/product-catalog.present.js';

/**
 * Phase 6 Wave 4 (P6-20; OQ-95, the Owner's approval of 2026-10-09): the carriers the shop ships with. The list is empty until the
 * Owner enters the carriers: no carrier name is invented. A name is unique ignoring case; the tracking link is an https address with exactly one
 * `{code}` place, or none. A carrier that was used is switched off, never deleted. `MANAGE_PRODUCTS`.
 */
const select = {
  id: true,
  name: true,
  trackingUrlTemplate: true,
  isActive: true,
  rowVersion: true,
} as const;

const present = (row: {
  id: string;
  name: string;
  trackingUrlTemplate: string | null;
  isActive: boolean;
  rowVersion: number;
}): ShippingCarrierResponse => ({ ...row });

const TEMPLATE = /^https:\/\/[^\s]+$/;

function template(value: unknown): string | null {
  const text = input.optionalLine(value, 'trackingUrlTemplate', 300);
  if (text === null) return null;
  if (!TEMPLATE.test(text) || text.split('{code}').length !== 2) {
    throw new AuthError('VALIDATION_FAILED', 'trackingUrlTemplate');
  }
  return text;
}

export async function listCarriers(context: AdminContext): Promise<ShippingCarrierListResponse> {
  requireManage(context);
  const rows = await context.tx.shippingCarrier.findMany({
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select,
  });
  return { carriers: rows.map(present) };
}

async function nameFree(context: AdminContext, name: string, exceptId: string | null) {
  const clash = await context.tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM shipping_carriers WHERE lower(name) = lower(${name})
      AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid) LIMIT 1`;
  if (clash.length > 0) throw new AuthError('CONFLICT', 'name');
}

export async function createCarrier(
  context: AdminContext,
  request: ShippingCarrierCreateRequest,
): Promise<ShippingCarrierListResponse> {
  requireManage(context);
  const body = input.record(request, 'carrier', ['name', 'trackingUrlTemplate']);
  const name = input.line(body['name'], 'name', 80);
  const link = template(body['trackingUrlTemplate']);
  await nameFree(context, name, null);
  const created = await context.tx.shippingCarrier.create({
    data: { name, trackingUrlTemplate: link, createdByUserId: context.actor.userId },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'SHIPPING_CARRIER_CREATED',
    entityType: 'ShippingCarrier',
    entityId: created.id,
    after: { name, trackingUrlTemplate: link },
  });
  return listCarriers(context);
}

export async function editCarrier(
  context: AdminContext,
  carrierId: string,
  request: ShippingCarrierEditRequest,
): Promise<ShippingCarrierListResponse> {
  requireManage(context);
  const body = input.record(request, 'carrier', [
    'expectedRowVersion',
    'name',
    'trackingUrlTemplate',
    'isActive',
  ]);
  const expected = input.rowVersion(body['expectedRowVersion']);
  const { tx } = context;
  await tx.$queryRaw`SELECT id FROM shipping_carriers WHERE id = ${carrierId}::uuid FOR UPDATE`;
  const current = await tx.shippingCarrier.findUnique({ where: { id: carrierId }, select });
  if (!current) throw new AuthError('NOT_FOUND');
  if (current.rowVersion !== expected) throw new AuthError('CONFLICT');
  const name = body['name'] === undefined ? current.name : input.line(body['name'], 'name', 80);
  const link =
    body['trackingUrlTemplate'] === undefined
      ? current.trackingUrlTemplate
      : template(body['trackingUrlTemplate']);
  const isActive =
    body['isActive'] === undefined ? current.isActive : input.boolean(body['isActive'], 'isActive');
  if (
    name === current.name &&
    link === current.trackingUrlTemplate &&
    isActive === current.isActive
  ) {
    return listCarriers(context);
  }
  if (name !== current.name) await nameFree(context, name, carrierId);
  await tx.shippingCarrier.update({
    where: { id: carrierId },
    data: { name, trackingUrlTemplate: link, isActive, rowVersion: { increment: 1 } },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'SHIPPING_CARRIER_UPDATED',
    entityType: 'ShippingCarrier',
    entityId: carrierId,
    before: {
      name: current.name,
      trackingUrlTemplate: current.trackingUrlTemplate,
      isActive: current.isActive,
    },
    after: { name, trackingUrlTemplate: link, isActive },
  });
  return listCarriers(context);
}
