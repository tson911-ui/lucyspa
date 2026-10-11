import {
  PAY_REASON_MAX,
  type SalariesResponse,
  type SalaryHistoryResponse,
  type SalaryItem,
  type SalaryVersionRequest,
  type SalaryVersionResponse,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decideAcross } from '../authorization/authorization.js';
import { exactKeys, money, reason, uuid } from '../finance/finance.input.js';
import { effectiveDate, holdsPayrollShopWide, shopToday } from './pay.access.js';

/**
 * Phase 7 P7-8 (design 4.1; P7-T1): the base salary as an effective-dated, append-only history, so a raise on the 1st never changes
 * the month before it. A version is entered by a person with `MANAGE_EMPLOYEE_PAY` at every branch of the employee and is dated up to
 * 62 days back and never ahead (the profile's single "current" number follows it). No version is created automatically from the old
 * number: until the Owner enters the first one, the payroll draft shows the profile salary as "not confirmed". A null amount means "no
 * salary from that date"; an amount needs OFFICIAL employment on that date (Owner decision Q16).
 */
type Tx = Prisma.TransactionClient;
const day = (value: Date): string => value.toISOString().slice(0, 10);
const asDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const PROFILE_SELECT = {
  userId: true,
  employeeCodeCanonical: true,
  baseSalaryVnd: true,
  user: { select: { fullName: true, status: true } },
  branchAssignments: { where: { revokedAt: null }, select: { branchId: true } },
  classificationChanges: {
    orderBy: { effectiveDate: 'desc' },
    select: { classification: true, effectiveDate: true },
  },
} satisfies Prisma.EmployeeProfileSelect;
type Profile = Prisma.EmployeeProfileGetPayload<{ select: typeof PROFILE_SELECT }>;

/** The classification in force on a date (the latest change with an effective date on or before it). */
function classificationOn(profile: Profile, date: string) {
  return profile.classificationChanges.find((change) => day(change.effectiveDate) <= date)
    ?.classification;
}

function canRead(context: AdminContext, profile: Profile): boolean {
  if (holdsPayrollShopWide(context)) return true;
  const branches = profile.branchAssignments.map((assignment) => assignment.branchId);
  return (
    decideAcross(context.actor.graph, 'VIEW_EMPLOYEE_PAY', branches) ||
    decideAcross(context.actor.graph, 'MANAGE_EMPLOYEE_PAY', branches)
  );
}

function canManage(context: AdminContext, profile: Profile): boolean {
  const branches = profile.branchAssignments.map((assignment) => assignment.branchId);
  return decideAcross(context.actor.graph, 'MANAGE_EMPLOYEE_PAY', branches);
}

function present(
  profile: Profile,
  versions: readonly { amountVnd: bigint | null; effectiveFrom: Date }[],
  today: string,
): SalaryItem {
  const sorted = [...versions].sort(
    (a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime(),
  );
  const current = sorted.find((version) => day(version.effectiveFrom) <= today);
  return {
    employee: {
      id: profile.userId,
      name: profile.user.fullName,
      code: profile.employeeCodeCanonical,
    },
    current: current
      ? {
          amountVnd: current.amountVnd?.toString() ?? null,
          effectiveFrom: day(current.effectiveFrom),
        }
      : null,
    profileSalaryVnd: profile.baseSalaryVnd?.toString() ?? null,
    confirmed: current !== undefined,
    versions: versions.length,
  };
}

export async function listSalaries(context: AdminContext): Promise<SalariesResponse> {
  const { tx } = context;
  const today = shopToday(context.now);
  const profiles = await tx.employeeProfile.findMany({
    where: { user: { status: 'ACTIVE' } },
    select: PROFILE_SELECT,
  });
  const visible = profiles.filter(
    (profile) =>
      classificationOn(profile, today) === 'OFFICIAL_EMPLOYEE' && canRead(context, profile),
  );
  if (visible.length === 0 && !holdsPayrollShopWide(context)) {
    const anyPay = profiles.some((profile) => canRead(context, profile));
    if (!anyPay) throw new AuthError('FORBIDDEN');
  }
  const versions = await tx.employeeSalaryVersion.findMany({
    where: { employeeUserId: { in: visible.map((profile) => profile.userId) } },
    select: { employeeUserId: true, amountVnd: true, effectiveFrom: true },
  });
  const byEmployee = new Map<string, { amountVnd: bigint | null; effectiveFrom: Date }[]>();
  for (const version of versions) {
    byEmployee.set(version.employeeUserId, [
      ...(byEmployee.get(version.employeeUserId) ?? []),
      version,
    ]);
  }
  const items = visible
    .map((profile) => present(profile, byEmployee.get(profile.userId) ?? [], today))
    .sort(
      (a, b) =>
        a.employee.name.localeCompare(b.employee.name, 'vi') ||
        a.employee.id.localeCompare(b.employee.id),
    );
  return {
    today,
    items,
    canManage: visible.some((profile) => canManage(context, profile)),
  };
}

async function loadProfile(tx: Tx, userId: string): Promise<Profile> {
  const profile = await tx.employeeProfile.findUnique({
    where: { userId },
    select: PROFILE_SELECT,
  });
  if (!profile) throw new AuthError('NOT_FOUND');
  return profile;
}

export async function salaryHistory(
  context: AdminContext,
  employeeIdRaw: string,
): Promise<SalaryHistoryResponse> {
  const { tx } = context;
  const profile = await loadProfile(tx, uuid(employeeIdRaw, 'id'));
  if (!canRead(context, profile)) throw new AuthError('FORBIDDEN');
  const today = shopToday(context.now);
  const rows = await tx.employeeSalaryVersion.findMany({
    where: { employeeUserId: profile.userId },
    orderBy: { effectiveFrom: 'desc' },
    select: {
      id: true,
      amountVnd: true,
      effectiveFrom: true,
      reason: true,
      recordedAt: true,
      recordedBy: { select: { id: true, fullName: true } },
    },
  });
  return {
    employee: present(profile, [], today).employee,
    items: rows.map((row) => ({
      id: row.id,
      amountVnd: row.amountVnd?.toString() ?? null,
      effectiveFrom: day(row.effectiveFrom),
      reason: row.reason,
      recordedBy: { id: row.recordedBy.id, name: row.recordedBy.fullName },
      recordedAt: row.recordedAt.toISOString(),
    })),
  };
}

/**
 * Appends one version and, when it is now the version in force, makes it the profile's current number (the row version of the
 * employee's account moves too, like every other change of that account). Shared by the pay screen and by the employee screens'
 * "set base salary", so the two can never disagree.
 */
/** Appends the version row only (no profile update, no audit): used by the legacy employee screens that do those themselves. */
export async function appendSalaryVersionRow(
  tx: Tx,
  input: {
    employeeUserId: string;
    amountVnd: bigint | null;
    effectiveFrom: string;
    reason: string | null;
    recordedByUserId: string;
  },
): Promise<string> {
  const clash = await tx.employeeSalaryVersion.findUnique({
    where: {
      employeeUserId_effectiveFrom: {
        employeeUserId: input.employeeUserId,
        effectiveFrom: asDate(input.effectiveFrom),
      },
    },
    select: { id: true },
  });
  if (clash) throw new AuthError('PAY_VERSION_EXISTS');
  const created = await tx.employeeSalaryVersion.create({
    data: {
      employeeUserId: input.employeeUserId,
      amountVnd: input.amountVnd,
      effectiveFrom: asDate(input.effectiveFrom),
      reason: input.reason,
      recordedByUserId: input.recordedByUserId,
    },
    select: { id: true },
  });
  return created.id;
}

export async function recordSalaryVersion(
  context: AdminContext,
  input: {
    employeeUserId: string;
    amountVnd: bigint | null;
    effectiveFrom: string;
    reason: string | null;
  },
): Promise<void> {
  const { tx } = context;
  const today = shopToday(context.now);
  const createdId = await appendSalaryVersionRow(tx, {
    ...input,
    recordedByUserId: context.actor.userId,
  });
  // The version in force today decides what the profile shows.
  const inForce = await tx.employeeSalaryVersion.findFirst({
    where: { employeeUserId: input.employeeUserId, effectiveFrom: { lte: asDate(today) } },
    orderBy: { effectiveFrom: 'desc' },
    select: { amountVnd: true },
  });
  await tx.user.update({
    where: { id: input.employeeUserId },
    data: {
      rowVersion: { increment: 1 },
      employeeProfile: { update: { baseSalaryVnd: inForce?.amountVnd ?? null } },
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'SALARY_VERSION_ADDED',
    entityType: 'EmployeeSalaryVersion',
    entityId: createdId,
    subjectUserId: input.employeeUserId,
    reason: input.reason,
    classification: 'EMPLOYEE_PAY',
    after: {
      amountVnd: input.amountVnd?.toString() ?? null,
      effectiveFrom: input.effectiveFrom,
    },
  });
}

const SALARY_KEYS = ['employeeUserId', 'amountVnd', 'effectiveFrom', 'reason'] as const;

export async function addSalaryVersion(
  context: AdminContext,
  request: SalaryVersionRequest,
): Promise<SalaryVersionResponse> {
  const { tx } = context;
  const body = exactKeys(request, SALARY_KEYS, 'body');
  const employeeUserId = uuid(body['employeeUserId'], 'employeeUserId');
  const amount = body['amountVnd'] === null ? null : money(body['amountVnd'], 'amountVnd');
  const today = shopToday(context.now);
  const from = effectiveDate(body['effectiveFrom'], 'effectiveFrom', today, { future: false });
  const why = reason(body['reason'], 'reason', PAY_REASON_MAX, false);
  const profile = await loadProfile(tx, employeeUserId);
  if (!canManage(context, profile)) throw new AuthError('FORBIDDEN');
  if (context.actor.userId === employeeUserId) throw new AuthError('FORBIDDEN');
  if (amount !== null && classificationOn(profile, from) !== 'OFFICIAL_EMPLOYEE') {
    throw new AuthError('CONFLICT', 'classification');
  }
  await recordSalaryVersion(context, {
    employeeUserId,
    amountVnd: amount,
    effectiveFrom: from,
    reason: why,
  });
  const versions = await tx.employeeSalaryVersion.findMany({
    where: { employeeUserId },
    select: { amountVnd: true, effectiveFrom: true },
  });
  return { item: present(await loadProfile(tx, employeeUserId), versions, today) };
}
