import type { AuditEventPageResponse, AuditEventResponse } from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable } from '@nestjs/common';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { SessionService } from '../auth/session.service.js';
import { isUuid } from '../employees/employee.input.js';
import { runAdminCommand } from './admin-command.js';
import { decide, GLOBAL, type AuthorityGraph } from './authorization.js';

export const AUDIT_PAGE = Object.freeze({ defaultLimit: 50, maxLimit: 100 } as const);

export interface AuditQuery {
  limit?: number;
  cursor?: string;
  branchId?: string;
  action?: string;
  subjectUserId?: string;
  actorUserId?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
}

const auditSelect = {
  id: true,
  action: true,
  occurredAt: true,
  actorKind: true,
  actorUserId: true,
  subjectUserId: true,
  entityType: true,
  entityId: true,
  branchId: true,
  requestId: true,
  reason: true,
  before: true,
  after: true,
  dataClassification: true,
} satisfies Prisma.AuditEventSelect;

type AuditRow = Prisma.AuditEventGetPayload<{ select: typeof auditSelect }>;

function invalid(field: string): never {
  throw new AuthError('VALIDATION_FAILED', field);
}

function uuid(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  const id = value.toLowerCase();
  return isUuid(id) ? id : invalid(field);
}

function timestamp(value: string | undefined, field: string): Date | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(date.getTime()) ? date : invalid(field);
}

/** Opaque keyset cursor over (occurredAt, id), newest first. */
function encodeCursor(row: AuditRow): string {
  return Buffer.from(`${row.occurredAt.toISOString()}|${row.id}`).toString('base64url');
}

function decodeCursor(value: string | undefined): { occurredAt: Date; id: string } | undefined {
  if (value === undefined) return undefined;
  const [at, id] = Buffer.from(value, 'base64url').toString('utf8').split('|');
  const occurredAt = at ? new Date(at) : new Date(Number.NaN);
  if (!id || !isUuid(id) || Number.isNaN(occurredAt.getTime())) return invalid('cursor');
  return { occurredAt, id };
}

function snapshot(value: Prisma.JsonValue): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Where the actor may read audit events (design section 9), as a query predicate:
 * - a single-branch event needs VIEW_AUDIT_LOG at that branch;
 * - a null-branch (global or multi-branch) event needs unrestricted GLOBAL VIEW_AUDIT_LOG;
 * - EMPLOYEE_PAY events additionally need VIEW_EMPLOYEE_PAY at that branch, or
 *   unrestricted GLOBAL VIEW_EMPLOYEE_PAY for null-branch events.
 * Branch decisions reuse the Step 7 engine for every existing branch.
 */
export function auditVisibility(
  graph: AuthorityGraph,
  branchIds: readonly string[],
): Prisma.AuditEventWhereInput[] {
  const standard = branchIds.filter((branchId) =>
    decide(graph, 'VIEW_AUDIT_LOG', { kind: 'BRANCH', branchId }),
  );
  const pay = standard.filter((branchId) =>
    decide(graph, 'VIEW_EMPLOYEE_PAY', { kind: 'BRANCH', branchId }),
  );
  const globalStandard = decide(graph, 'VIEW_AUDIT_LOG', GLOBAL, { unrestricted: true });
  const globalPay =
    globalStandard && decide(graph, 'VIEW_EMPLOYEE_PAY', GLOBAL, { unrestricted: true });
  const visible: Prisma.AuditEventWhereInput[] = [];
  if (standard.length > 0) {
    visible.push({ dataClassification: 'STANDARD', branchId: { in: standard } });
  }
  if (pay.length > 0) visible.push({ dataClassification: 'EMPLOYEE_PAY', branchId: { in: pay } });
  if (globalStandard) visible.push({ dataClassification: 'STANDARD', branchId: null });
  if (globalPay) visible.push({ dataClassification: 'EMPLOYEE_PAY', branchId: null });
  return visible;
}

/** Filtered, keyset-paginated audit reading; scope is applied before paging. */
@Injectable()
export class AuditReadService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  async list(sessionToken: string | undefined, query: AuditQuery): Promise<AuditEventPageResponse> {
    const limit = query.limit ?? AUDIT_PAGE.defaultLimit;
    if (!Number.isInteger(limit) || limit < 1 || limit > AUDIT_PAGE.maxLimit) invalid('limit');
    const cursor = decodeCursor(query.cursor);
    const branchId = uuid(query.branchId, 'branchId');
    const subjectUserId = uuid(query.subjectUserId, 'subjectUserId');
    const actorUserId = uuid(query.actorUserId, 'actorUserId');
    const from = timestamp(query.from, 'from');
    const to = timestamp(query.to, 'to');
    if (query.action !== undefined && !/^[A-Z][A-Z0-9_]{0,63}$/.test(query.action)) {
      invalid('action');
    }
    if (query.entityType !== undefined && !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(query.entityType)) {
      invalid('entityType');
    }
    if (
      query.entityId !== undefined &&
      (query.entityId.length === 0 || query.entityId.length > 128)
    ) {
      invalid('entityId');
    }
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      sessionToken,
      { exclusive: false },
      async ({ tx, actor }) => {
        const branches = await tx.branch.findMany({ select: { id: true } });
        const visible = auditVisibility(
          actor.graph,
          branches.map((row) => row.id),
        );
        if (visible.length === 0) throw new AuthError('FORBIDDEN');
        const filters: Prisma.AuditEventWhereInput[] = [
          { OR: visible },
          ...(branchId ? [{ branchId }] : []),
          ...(query.action ? [{ action: query.action }] : []),
          ...(subjectUserId ? [{ subjectUserId }] : []),
          ...(actorUserId ? [{ actorUserId }] : []),
          ...(query.entityType ? [{ entityType: query.entityType }] : []),
          ...(query.entityId ? [{ entityId: query.entityId }] : []),
          ...(from ? [{ occurredAt: { gte: from } }] : []),
          ...(to ? [{ occurredAt: { lt: to } }] : []),
          ...(cursor
            ? [
                {
                  OR: [
                    { occurredAt: { lt: cursor.occurredAt } },
                    { occurredAt: cursor.occurredAt, id: { lt: cursor.id } },
                  ],
                },
              ]
            : []),
        ];
        const rows = await tx.auditEvent.findMany({
          where: { AND: filters },
          select: auditSelect,
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
        });
        const page = rows.slice(0, limit);
        const last = page.at(-1);
        return {
          items: page.map((row): AuditEventResponse => ({
            id: row.id,
            action: row.action,
            occurredAt: row.occurredAt.toISOString(),
            actorKind: row.actorKind,
            actorUserId: row.actorUserId,
            subjectUserId: row.subjectUserId,
            entityType: row.entityType,
            entityId: row.entityId,
            branchId: row.branchId,
            requestId: row.requestId,
            reason: row.reason,
            before: snapshot(row.before),
            after: snapshot(row.after),
            dataClassification: row.dataClassification,
          })),
          nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
        };
      },
    );
  }
}
