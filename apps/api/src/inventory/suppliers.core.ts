import type {
  SupplierCreateRequest,
  SupplierEditRequest,
  SupplierListResponse,
  SupplierResponse,
} from '@lucy-spa/contracts';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { canManageProducts, holdsAnywhere } from './inventory.access.js';
import * as input from './inventory.input.js';

/**
 * Phase 6 P6-4: suppliers are global records (design 4.1). Reading needs `MANAGE_PRODUCTS` or `MANAGE_STOCK_RECEIPTS` at some branch
 * (a receipt names a supplier); changing needs `MANAGE_PRODUCTS`. A supplier is never deleted: it is switched off. Names are unique
 * regardless of case (a database rule), so a clash is a precise conflict.
 */
const select = {
  id: true,
  name: true,
  contactName: true,
  phone: true,
  email: true,
  address: true,
  notes: true,
  isActive: true,
  rowVersion: true,
  _count: { select: { receipts: true } },
} as const;

type Row = {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  rowVersion: number;
  _count: { receipts: number };
};

const present = (row: Row): SupplierResponse => ({
  id: row.id,
  name: row.name,
  contactName: row.contactName,
  phone: row.phone,
  email: row.email,
  address: row.address,
  notes: row.notes,
  isActive: row.isActive,
  rowVersion: row.rowVersion,
  receiptCount: row._count.receipts,
});

function fields(request: SupplierCreateRequest) {
  const limits = input.INVENTORY_LIMITS;
  return {
    name: input.line(request.name, 'name', limits.nameMax),
    contactName: input.optionalLine(request.contactName, 'contactName', limits.nameMax),
    phone: input.optionalLine(request.phone, 'phone', limits.phoneMax),
    email: input.email(request.email, 'email'),
    address: input.optionalLine(request.address, 'address', limits.textMax),
    notes: input.optionalNote(request.notes, 'notes'),
  };
}

async function nameTaken(context: AdminContext, name: string, exceptId: string | null) {
  const rows = await context.tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM suppliers WHERE lower(name) = lower(${name})`;
  return rows.some((row) => row.id !== exceptId);
}

export async function listSuppliers(context: AdminContext): Promise<SupplierListResponse> {
  const manage = canManageProducts(context);
  if (!manage && !(await holdsAnywhere(context, 'MANAGE_STOCK_RECEIPTS'))) {
    throw new AuthError('FORBIDDEN');
  }
  const rows = await context.tx.supplier.findMany({
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select,
  });
  return { suppliers: rows.map(present), manage };
}

export async function createSupplier(
  context: AdminContext,
  request: SupplierCreateRequest,
): Promise<SupplierResponse> {
  if (!canManageProducts(context)) throw new AuthError('FORBIDDEN');
  const values = fields(request);
  if (await nameTaken(context, values.name, null)) throw new AuthError('CONFLICT', 'name');
  const created = await context.tx.supplier.create({ data: values, select });
  await appendAdminAudit(context, {
    action: 'SUPPLIER_CREATED',
    entityType: 'Supplier',
    entityId: created.id,
    after: { name: values.name },
  });
  return present(created);
}

export async function editSupplier(
  context: AdminContext,
  id: string,
  request: SupplierEditRequest,
): Promise<SupplierResponse> {
  if (!canManageProducts(context)) throw new AuthError('FORBIDDEN');
  const values = { ...fields(request), isActive: input.boolean(request.isActive, 'isActive') };
  const expected = input.rowVersion(request.expectedRowVersion);
  const { tx } = context;
  const locked = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM suppliers WHERE id = ${id}::uuid FOR UPDATE`;
  if (locked.length === 0) throw new AuthError('NOT_FOUND');
  const current = await tx.supplier.findUniqueOrThrow({ where: { id }, select });
  if (current.rowVersion !== expected) throw new AuthError('CONFLICT');
  const same = (Object.keys(values) as (keyof typeof values)[]).every(
    (key) => current[key] === values[key],
  );
  if (same) return present(current);
  if (await nameTaken(context, values.name, id)) throw new AuthError('CONFLICT', 'name');
  const saved = await tx.supplier.update({
    where: { id },
    data: { ...values, rowVersion: current.rowVersion + 1 },
    select,
  });
  await appendAdminAudit(context, {
    action: 'SUPPLIER_UPDATED',
    entityType: 'Supplier',
    entityId: id,
    before: { name: current.name, isActive: current.isActive },
    after: { name: values.name, isActive: values.isActive },
  });
  return present(saved);
}
