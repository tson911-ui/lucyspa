import {
  PAY_REASON_MAX,
  type StaffCodeCreateRequest,
  type StaffCodeItem,
  type StaffCodeResetRequest,
  type StaffCodesResponse,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { generateStaffCode } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { exactKeys, reason, uuid } from '../finance/finance.input.js';
import { officialEmployees } from './pay-rules.core.js';
import { requireManage, requireRead, shopToday } from './pay.access.js';

/**
 * Phase 7 P7-10b (design section 14, P7-T16; Owner answer 3): the staff referral codes for online orders. Only OFFICIAL employees get a code,
 * and only by the Owner's click (`MANAGE_PAY_RULES`): no code is ever created automatically. A reset switches the old code off (kept as
 * history, never given again) and issues a new one in the same transaction. Reading needs a rules or payroll permission.
 */
type Tx = Prisma.TransactionClient;
const iso = (value: Date): string => value.toISOString();

async function newCode(tx: Tx): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = generateStaffCode();
    if (!(await tx.employeeReferralCode.findUnique({ where: { code }, select: { id: true } }))) {
      return code;
    }
  }
  throw new AuthError('SERVICE_UNAVAILABLE');
}

export async function listStaffCodes(context: AdminContext): Promise<StaffCodesResponse> {
  const { tx } = context;
  const canManage = requireRead(context);
  const today = shopToday(context.now);
  const [official, rows] = await Promise.all([
    officialEmployees(tx, today),
    tx.employeeReferralCode.findMany({
      orderBy: [{ seq: 'desc' }],
      select: {
        id: true,
        employeeUserId: true,
        code: true,
        isActive: true,
        createdAt: true,
        deactivatedAt: true,
        deactivationReason: true,
        employee: { select: { user: { select: { fullName: true } } } },
        _count: { select: { orders: true } },
      },
    }),
  ]);
  const byEmployee = new Map<string, typeof rows>();
  for (const row of rows)
    byEmployee.set(row.employeeUserId, [...(byEmployee.get(row.employeeUserId) ?? []), row]);
  const items: StaffCodeItem[] = official.map((person) => {
    const mine = byEmployee.get(person.id) ?? [];
    const active = mine.find((row) => row.isActive) ?? null;
    return {
      employee: person,
      code: active?.code ?? null,
      createdAt: active ? iso(active.createdAt) : null,
      history: mine
        .filter((row) => !row.isActive)
        .map((row) => ({
          code: row.code,
          active: false,
          createdAt: iso(row.createdAt),
          deactivatedAt: row.deactivatedAt ? iso(row.deactivatedAt) : null,
          deactivationReason: row.deactivationReason,
        })),
      orders: active?._count.orders ?? 0,
    };
  });
  const officialIds = new Set(official.map((person) => person.id));
  const retired = rows
    .filter((row) => row.isActive && !officialIds.has(row.employeeUserId))
    .map((row) => ({
      employee: { id: row.employeeUserId, name: row.employee.user.fullName },
      code: row.code,
    }));
  return { today, canManage, items, retired };
}

export async function createStaffCode(
  context: AdminContext,
  request: StaffCodeCreateRequest,
): Promise<StaffCodesResponse> {
  const { tx } = context;
  requireManage(context);
  const body = exactKeys(request, ['employeeUserId'], 'body');
  const employeeUserId = uuid(body['employeeUserId'], 'employeeUserId');
  const today = shopToday(context.now);
  if (!(await officialEmployees(tx, today)).some((person) => person.id === employeeUserId)) {
    throw new AuthError('VALIDATION_FAILED', 'employeeUserId');
  }
  await tx.$queryRaw`SELECT user_id FROM employee_profiles WHERE user_id = ${employeeUserId}::uuid FOR UPDATE`;
  if (
    await tx.employeeReferralCode.findFirst({
      where: { employeeUserId, isActive: true },
      select: { id: true },
    })
  ) {
    throw new AuthError('CONFLICT');
  }
  const created = await tx.employeeReferralCode.create({
    data: { employeeUserId, code: await newCode(tx), createdByUserId: context.actor.userId },
    select: { id: true, code: true },
  });
  await appendAdminAudit(context, {
    action: 'STAFF_CODE_CREATED',
    entityType: 'EmployeeReferralCode',
    entityId: created.id,
    subjectUserId: employeeUserId,
    classification: 'EMPLOYEE_PAY',
    after: { code: created.code },
  });
  return listStaffCodes(context);
}

export async function resetStaffCode(
  context: AdminContext,
  employeeIdRaw: string,
  request: StaffCodeResetRequest,
): Promise<StaffCodesResponse> {
  const { tx } = context;
  requireManage(context);
  const employeeUserId = uuid(employeeIdRaw, 'id');
  const body = exactKeys(request, ['reason'], 'body');
  const why = reason(body['reason'], 'reason', PAY_REASON_MAX)!;
  const today = shopToday(context.now);
  if (!(await officialEmployees(tx, today)).some((person) => person.id === employeeUserId)) {
    throw new AuthError('VALIDATION_FAILED', 'id');
  }
  await tx.$queryRaw`SELECT user_id FROM employee_profiles WHERE user_id = ${employeeUserId}::uuid FOR UPDATE`;
  const active = await tx.employeeReferralCode.findFirst({
    where: { employeeUserId, isActive: true },
    select: { id: true, code: true },
  });
  if (!active) throw new AuthError('NOT_FOUND');
  await tx.employeeReferralCode.update({
    where: { id: active.id },
    data: {
      isActive: false,
      deactivatedAt: context.now,
      deactivatedByUserId: context.actor.userId,
      deactivationReason: why,
    },
    select: { id: true },
  });
  const created = await tx.employeeReferralCode.create({
    data: { employeeUserId, code: await newCode(tx), createdByUserId: context.actor.userId },
    select: { id: true, code: true },
  });
  await appendAdminAudit(context, {
    action: 'STAFF_CODE_RESET',
    entityType: 'EmployeeReferralCode',
    entityId: created.id,
    subjectUserId: employeeUserId,
    reason: why,
    classification: 'EMPLOYEE_PAY',
    before: { code: active.code },
    after: { code: created.code },
  });
  return listStaffCodes(context);
}
