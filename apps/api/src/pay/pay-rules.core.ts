import {
  COMMISSION_KINDS,
  COMMISSION_PERCENT_MAX_BP,
  COMMISSION_SCOPES,
  PAY_REASON_MAX,
  type CommissionKindNameValue,
  type CommissionProductOption,
  type CommissionRuleItem,
  type CommissionRuleRequest,
  type CommissionRuleResponse,
  type CommissionRuleState,
  type CommissionRulesResponse,
  type CommissionScopeNameValue,
  type CommissionTargetsResponse,
  type TourRuleHistoryResponse,
  type TourRuleRequest,
  type TourRuleResponse,
  type TourRuleServiceItem,
  type TourRulesResponse,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { exactKeys, money, reason, uuid } from '../finance/finance.input.js';
import { effectiveDate, requireManage, requireRead, shopToday } from './pay.access.js';

/**
 * Phase 7 P7-8 (design 4.2; P7-T2, P7-T5, P7-T6): tour amounts and product commission rules. Both are Owner-entered, effective-dated,
 * append-only rows that ship empty: a change is a NEW row with a later start date (the database refuses an edit or a delete), and a
 * value of 0 is an explicit "pays nothing". With no rule in force nothing is earned and the service or product is listed as having
 * no rule. Reading needs MANAGE_PAY_RULES, MANAGE_PAYROLL or APPROVE_PAYROLL; changing needs MANAGE_PAY_RULES (all GLOBAL).
 */
type Tx = Prisma.TransactionClient;
const day = (value: Date): string => value.toISOString().slice(0, 10);
const asDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

// ------------------------------------------------------------------------------------------------- tour rules
const SERVICE_SELECT = {
  id: true,
  code: true,
  nameVi: true,
  nameEn: true,
  isActive: true,
} satisfies Prisma.ServiceSelect;

function tourItem(
  service: TourRuleServiceItem['service'],
  versions: { amountVnd: bigint; effectiveFrom: Date }[],
  today: string,
): TourRuleServiceItem {
  const sorted = [...versions].sort(
    (a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime(),
  );
  const current = [...sorted].reverse().find((version) => day(version.effectiveFrom) <= today);
  const upcoming = sorted.find((version) => day(version.effectiveFrom) > today);
  const ref = (version: { amountVnd: bigint; effectiveFrom: Date }) => ({
    amountVnd: version.amountVnd.toString(),
    effectiveFrom: day(version.effectiveFrom),
  });
  return {
    service,
    current: current ? ref(current) : null,
    upcoming: upcoming ? ref(upcoming) : null,
    versions: versions.length,
  };
}

export async function listTourRules(context: AdminContext): Promise<TourRulesResponse> {
  const { tx } = context;
  const canManage = requireRead(context);
  const today = shopToday(context.now);
  const [services, rules] = await Promise.all([
    tx.service.findMany({
      where: { isActive: true },
      orderBy: [{ nameVi: 'asc' }, { id: 'asc' }],
      select: SERVICE_SELECT,
    }),
    tx.tourRule.findMany({ select: { serviceId: true, amountVnd: true, effectiveFrom: true } }),
  ]);
  const byService = new Map<string, { amountVnd: bigint; effectiveFrom: Date }[]>();
  for (const rule of rules) {
    byService.set(rule.serviceId, [...(byService.get(rule.serviceId) ?? []), rule]);
  }
  return {
    today,
    canManage,
    items: services.map((service) => tourItem(service, byService.get(service.id) ?? [], today)),
  };
}

export async function tourHistory(
  context: AdminContext,
  serviceIdRaw: string,
): Promise<TourRuleHistoryResponse> {
  const { tx } = context;
  requireRead(context);
  const serviceId = uuid(serviceIdRaw, 'id');
  const service = await tx.service.findUnique({ where: { id: serviceId }, select: SERVICE_SELECT });
  if (!service) throw new AuthError('NOT_FOUND');
  const rows = await tx.tourRule.findMany({
    where: { serviceId },
    orderBy: { effectiveFrom: 'desc' },
    select: {
      id: true,
      amountVnd: true,
      effectiveFrom: true,
      reason: true,
      createdAt: true,
      createdBy: { select: { id: true, fullName: true } },
    },
  });
  return {
    service,
    items: rows.map((row) => ({
      id: row.id,
      amountVnd: row.amountVnd.toString(),
      effectiveFrom: day(row.effectiveFrom),
      reason: row.reason,
      createdBy: { id: row.createdBy.id, name: row.createdBy.fullName },
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

const TOUR_KEYS = ['serviceId', 'amountVnd', 'effectiveFrom', 'reason'] as const;

export async function addTourRule(
  context: AdminContext,
  request: TourRuleRequest,
): Promise<TourRuleResponse> {
  const { tx } = context;
  requireManage(context);
  const body = exactKeys(request, TOUR_KEYS, 'body');
  const serviceId = uuid(body['serviceId'], 'serviceId');
  const amount = money(body['amountVnd'], 'amountVnd');
  const today = shopToday(context.now);
  const from = effectiveDate(body['effectiveFrom'], 'effectiveFrom', today);
  const why = reason(body['reason'], 'reason', PAY_REASON_MAX, false);
  const service = await tx.service.findFirst({
    where: { id: serviceId, isActive: true },
    select: SERVICE_SELECT,
  });
  if (!service) throw new AuthError('NOT_FOUND');
  const existing = await tx.tourRule.findUnique({
    where: { serviceId_effectiveFrom: { serviceId, effectiveFrom: asDate(from) } },
    select: { id: true },
  });
  if (existing) throw new AuthError('PAY_VERSION_EXISTS');
  const created = await tx.tourRule.create({
    data: {
      serviceId,
      amountVnd: amount,
      effectiveFrom: asDate(from),
      reason: why,
      createdByUserId: context.actor.userId,
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'TOUR_RULE_ADDED',
    entityType: 'TourRule',
    entityId: created.id,
    reason: why,
    classification: 'EMPLOYEE_PAY',
    after: { serviceId, amountVnd: amount.toString(), effectiveFrom: from },
  });
  const versions = await tx.tourRule.findMany({
    where: { serviceId },
    select: { amountVnd: true, effectiveFrom: true },
  });
  return { item: tourItem(service, versions, today) };
}

// ------------------------------------------------------------------------------------------ commission rules
const SCOPES = new Set<string>(COMMISSION_SCOPES);
const KINDS = new Set<string>(COMMISSION_KINDS);

const RULE_SELECT = {
  id: true,
  scope: true,
  brandId: true,
  categoryId: true,
  productId: true,
  employeeUserId: true,
  kind: true,
  value: true,
  effectiveFrom: true,
  reason: true,
  createdAt: true,
  brand: { select: { nameVi: true } },
  category: { select: { nameVi: true } },
  product: { select: { nameVi: true } },
  employee: { select: { userId: true, user: { select: { fullName: true } } } },
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.CommissionRuleSelect;
type RuleRow = Prisma.CommissionRuleGetPayload<{ select: typeof RULE_SELECT }>;

const keyOf = (row: RuleRow): string =>
  [row.scope, row.brandId, row.categoryId, row.productId, row.employeeUserId].join('|');

function presentRules(rows: readonly RuleRow[], today: string): CommissionRuleItem[] {
  // Per scope + target + employee: the latest rule starting on or before today is CURRENT, earlier ones REPLACED, later ones UPCOMING.
  const currentOf = new Map<string, string>();
  for (const row of rows) {
    const from = day(row.effectiveFrom);
    if (from > today) continue;
    const key = keyOf(row);
    const held = rows.find((other) => other.id === currentOf.get(key));
    if (!held || from > day(held.effectiveFrom)) currentOf.set(key, row.id);
  }
  return rows.map((row) => {
    const from = day(row.effectiveFrom);
    const state: CommissionRuleState =
      from > today ? 'UPCOMING' : currentOf.get(keyOf(row)) === row.id ? 'CURRENT' : 'REPLACED';
    const target =
      row.scope === 'BRAND' && row.brandId
        ? { id: row.brandId, name: row.brand?.nameVi ?? '' }
        : row.scope === 'CATEGORY' && row.categoryId
          ? { id: row.categoryId, name: row.category?.nameVi ?? '' }
          : row.scope === 'PRODUCT' && row.productId
            ? { id: row.productId, name: row.product?.nameVi ?? '' }
            : null;
    return {
      id: row.id,
      scope: row.scope,
      target,
      employee: row.employee ? { id: row.employee.userId, name: row.employee.user.fullName } : null,
      kind: row.kind,
      value: row.value.toString(),
      effectiveFrom: from,
      reason: row.reason,
      createdBy: { id: row.createdBy.id, name: row.createdBy.fullName },
      createdAt: row.createdAt.toISOString(),
      state,
    };
  });
}

/** Official employees on a date: the people commission is paid to (design 4.1, OQ-107). */
export async function officialEmployees(tx: Tx, date: string) {
  const people = await tx.employeeProfile.findMany({
    where: { user: { status: 'ACTIVE' } },
    select: {
      userId: true,
      user: { select: { fullName: true } },
      classificationChanges: {
        where: { effectiveDate: { lte: asDate(date) } },
        orderBy: { effectiveDate: 'desc' },
        take: 1,
        select: { classification: true },
      },
    },
  });
  return people
    .filter((person) => person.classificationChanges[0]?.classification === 'OFFICIAL_EMPLOYEE')
    .map((person) => ({ id: person.userId, name: person.user.fullName }))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi') || a.id.localeCompare(b.id));
}

export async function listCommissionRules(context: AdminContext): Promise<CommissionRulesResponse> {
  const { tx } = context;
  const canManage = requireRead(context);
  const today = shopToday(context.now);
  const [rows, brands, categories, employees] = await Promise.all([
    tx.commissionRule.findMany({
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      take: 500,
      select: RULE_SELECT,
    }),
    tx.brand.findMany({
      where: { isActive: true },
      orderBy: [{ nameVi: 'asc' }, { id: 'asc' }],
      select: { id: true, nameVi: true },
    }),
    tx.productCategory.findMany({
      orderBy: [{ nameVi: 'asc' }, { id: 'asc' }],
      select: { id: true, nameVi: true },
    }),
    officialEmployees(tx, today),
  ]);
  return {
    today,
    canManage,
    items: presentRules(rows, today),
    brands: brands.map((brand) => ({ id: brand.id, name: brand.nameVi })),
    categories: categories.map((category) => ({ id: category.id, name: category.nameVi })),
    employees,
  };
}

/** Product search for a product-scoped rule (at least two characters, 20 results). */
export async function searchProducts(
  context: AdminContext,
  queryRaw: unknown,
): Promise<CommissionTargetsResponse> {
  const { tx } = context;
  requireRead(context);
  const query = typeof queryRaw === 'string' ? queryRaw.trim() : '';
  if (query.length < 2 || query.length > 80) return { items: [] };
  const rows = await tx.product.findMany({
    where: {
      OR: [
        { nameVi: { contains: query, mode: 'insensitive' } },
        { code: { contains: query, mode: 'insensitive' } },
      ],
    },
    orderBy: [{ nameVi: 'asc' }, { id: 'asc' }],
    take: 20,
    select: { id: true, nameVi: true, code: true },
  });
  const items: CommissionProductOption[] = rows.map((row) => ({
    id: row.id,
    name: row.nameVi,
    sku: row.code,
  }));
  return { items };
}

const COMMISSION_KEYS = [
  'scope',
  'targetId',
  'employeeUserId',
  'kind',
  'value',
  'effectiveFrom',
  'reason',
] as const;

export async function addCommissionRule(
  context: AdminContext,
  request: CommissionRuleRequest,
): Promise<CommissionRuleResponse> {
  const { tx } = context;
  requireManage(context);
  const body = exactKeys(request, COMMISSION_KEYS, 'body');
  const scope = body['scope'];
  if (typeof scope !== 'string' || !SCOPES.has(scope))
    throw new AuthError('VALIDATION_FAILED', 'scope');
  const scopeName = scope as CommissionScopeNameValue;
  const kind = body['kind'];
  if (typeof kind !== 'string' || !KINDS.has(kind))
    throw new AuthError('VALIDATION_FAILED', 'kind');
  const kindName = kind as CommissionKindNameValue;
  const value = money(body['value'], 'value');
  if (kindName === 'PERCENT' && value > BigInt(COMMISSION_PERCENT_MAX_BP)) {
    throw new AuthError('VALIDATION_FAILED', 'value');
  }
  const today = shopToday(context.now);
  const from = effectiveDate(body['effectiveFrom'], 'effectiveFrom', today);
  const why = reason(body['reason'], 'reason', PAY_REASON_MAX, false);
  const targetId = body['targetId'] === null ? null : uuid(body['targetId'], 'targetId');
  if ((scopeName === 'SHOP') !== (targetId === null))
    throw new AuthError('VALIDATION_FAILED', 'targetId');
  const employeeUserId =
    body['employeeUserId'] === null ? null : uuid(body['employeeUserId'], 'employeeUserId');
  if (employeeUserId !== null) {
    const official = await officialEmployees(tx, from > today ? from : today);
    if (!official.some((person) => person.id === employeeUserId)) {
      throw new AuthError('VALIDATION_FAILED', 'employeeUserId');
    }
  }
  if (targetId !== null) {
    const found =
      scopeName === 'BRAND'
        ? await tx.brand.findUnique({ where: { id: targetId }, select: { id: true } })
        : scopeName === 'CATEGORY'
          ? await tx.productCategory.findUnique({ where: { id: targetId }, select: { id: true } })
          : await tx.product.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!found) throw new AuthError('VALIDATION_FAILED', 'targetId');
  }
  const duplicate = await tx.commissionRule.findFirst({
    where: {
      scope: scopeName,
      brandId: scopeName === 'BRAND' ? targetId : null,
      categoryId: scopeName === 'CATEGORY' ? targetId : null,
      productId: scopeName === 'PRODUCT' ? targetId : null,
      employeeUserId,
      effectiveFrom: asDate(from),
    },
    select: { id: true },
  });
  if (duplicate) throw new AuthError('PAY_VERSION_EXISTS');
  const created = await tx.commissionRule.create({
    data: {
      scope: scopeName,
      brandId: scopeName === 'BRAND' ? targetId : null,
      categoryId: scopeName === 'CATEGORY' ? targetId : null,
      productId: scopeName === 'PRODUCT' ? targetId : null,
      employeeUserId,
      kind: kindName,
      value,
      effectiveFrom: asDate(from),
      reason: why,
      createdByUserId: context.actor.userId,
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'COMMISSION_RULE_ADDED',
    entityType: 'CommissionRule',
    entityId: created.id,
    reason: why,
    classification: 'EMPLOYEE_PAY',
    after: {
      scope: scopeName,
      targetId,
      employeeUserId,
      kind: kindName,
      value: value.toString(),
      effectiveFrom: from,
    },
  });
  const row = await tx.commissionRule.findUniqueOrThrow({
    where: { id: created.id },
    select: RULE_SELECT,
  });
  const siblings = await tx.commissionRule.findMany({
    where: {
      scope: scopeName,
      brandId: row.brandId,
      categoryId: row.categoryId,
      productId: row.productId,
      employeeUserId: row.employeeUserId,
    },
    select: RULE_SELECT,
  });
  const item = presentRules(siblings, today).find((candidate) => candidate.id === created.id)!;
  return { item };
}
