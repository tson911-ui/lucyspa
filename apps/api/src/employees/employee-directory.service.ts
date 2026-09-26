import type {
  EmployeeDirectoryEntry,
  EmployeeDirectoryGroup,
  EmployeeDirectoryResponse,
  EmployeeStatus,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable } from '@nestjs/common';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand } from '../authorization/admin-command.js';
import { decide, GLOBAL, type AuthorityGraph } from '../authorization/authorization.js';
import { isUuid } from './employee.input.js';
import { businessToday, day } from './employment.js';
import { directoryGroupIds, MANAGER_ASSIGNMENT, workforceTitle } from './workforce-title.js';

export const EMPLOYEE_DIRECTORY_PAGE = Object.freeze({
  defaultLimit: 50,
  maxLimit: 100,
  maxQueryCodePoints: 100,
} as const);

const STATUSES: readonly EmployeeStatus[] = ['PENDING_SETUP', 'ACTIVE', 'INACTIVE'];

/** Query as received from the controller (limit still a decimal string). */
export interface EmployeeDirectoryInput {
  q?: string;
  branchId?: string;
  status?: string;
  cursor?: string;
  limit?: string;
  /** MANAGERS | EMPLOYEES | COLLABORATORS | TRAINEES; omitted = everyone. */
  group?: string;
  /** 1-based page number: numbered pages with a total instead of a keyset cursor. */
  page?: string;
}

const GROUPS: readonly EmployeeDirectoryGroup[] = [
  'MANAGERS',
  'EMPLOYEES',
  'COLLABORATORS',
  'TRAINEES',
];

const directorySelect = {
  id: true,
  status: true,
  fullName: true,
  rowVersion: true,
  roleAssignments: { where: MANAGER_ASSIGNMENT, select: { id: true }, take: 1 },
  employeeProfile: {
    select: {
      employeeCodeCanonical: true,
      // Classification history (newest first): the latest recorded entry and the one in
      // effect today (the display title).
      classificationChanges: {
        select: { classification: true, effectiveDate: true },
        orderBy: { effectiveDate: 'desc' },
      },
      branchAssignments: {
        where: { revokedAt: null },
        select: { branchId: true },
        orderBy: { branchId: 'asc' },
      },
    },
  },
} satisfies Prisma.UserSelect;

type DirectoryRow = Prisma.UserGetPayload<{ select: typeof directorySelect }>;

function invalid(field: string): never {
  throw new AuthError('VALIDATION_FAILED', field);
}

/** Opaque keyset cursor over the unique canonical employee code, ascending. */
function encodeCursor(code: string): string {
  return Buffer.from(code, 'utf8').toString('base64url');
}

function decodeCursor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const code = Buffer.from(value, 'base64url').toString('utf8');
  if (code.length === 0 || code.length > 64 || encodeCursor(code) !== value) invalid('cursor');
  return code;
}

/**
 * Directory visibility as a query predicate, identical to `GET /employees/:id`
 * (`decideAcross(VIEW_EMPLOYEES, activeBranches)`): an employee with active branches is
 * visible when VIEW_EMPLOYEES passes at every one of them; an employee without any
 * active branch needs GLOBAL VIEW_EMPLOYEES. Branch decisions reuse the Step 7 engine for
 * every existing branch, so denies and overrides apply exactly as for the single read.
 */
export function directoryVisibility(
  graph: AuthorityGraph,
  branchIds: readonly string[],
): Prisma.UserWhereInput[] {
  const allowed = branchIds.filter((branchId) =>
    decide(graph, 'VIEW_EMPLOYEES', { kind: 'BRANCH', branchId }),
  );
  const visible: Prisma.UserWhereInput[] = [];
  if (allowed.length > 0) {
    visible.push({
      employeeProfile: {
        branchAssignments: {
          some: { revokedAt: null },
          none: { revokedAt: null, branchId: { notIn: allowed } },
        },
      },
    });
  }
  if (decide(graph, 'VIEW_EMPLOYEES', GLOBAL)) {
    visible.push({ employeeProfile: { branchAssignments: { none: { revokedAt: null } } } });
  }
  return visible;
}

/**
 * Read-only employee directory for workforce UIs (Phase 2 Step 9): minimal operational
 * identity and the latest employment classification only. Scope is applied before filters, ordering and paging, so hidden
 * employees never appear in pages, cursors or search results.
 */
@Injectable()
export class EmployeeDirectoryService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  async list(
    sessionToken: string | undefined,
    query: EmployeeDirectoryInput,
  ): Promise<EmployeeDirectoryResponse> {
    const limit =
      query.limit === undefined ? EMPLOYEE_DIRECTORY_PAGE.defaultLimit : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > EMPLOYEE_DIRECTORY_PAGE.maxLimit) {
      invalid('limit');
    }
    const cursor = decodeCursor(query.cursor);
    const branchId = query.branchId?.toLowerCase();
    if (branchId !== undefined && !isUuid(branchId)) invalid('branchId');
    const status = query.status as EmployeeStatus | undefined;
    if (status !== undefined && !STATUSES.includes(status)) invalid('status');
    const group = query.group as EmployeeDirectoryGroup | undefined;
    if (group !== undefined && !GROUPS.includes(group)) invalid('group');
    const pageNumber = query.page === undefined ? undefined : Number(query.page);
    if (pageNumber !== undefined && (!Number.isInteger(pageNumber) || pageNumber < 1)) {
      invalid('page');
    }
    if (pageNumber !== undefined && cursor !== undefined) invalid('cursor');
    const q = query.q?.normalize('NFC').trim();
    if (
      q !== undefined &&
      (q.length === 0 ||
        [...q].length > EMPLOYEE_DIRECTORY_PAGE.maxQueryCodePoints ||
        /\p{Cc}/u.test(q))
    ) {
      invalid('q');
    }
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      sessionToken,
      { exclusive: false },
      async ({ tx, actor }) => {
        const branches = await tx.branch.findMany({ select: { id: true } });
        // One business date for the whole directory: the latest local date among branches.
        const today = day(
          await businessToday(
            tx,
            branches.map((row) => row.id),
          ),
        );
        const groupIds = group === undefined ? null : await directoryGroupIds(tx, group, today);
        const visible = directoryVisibility(
          actor.graph,
          branches.map((row) => row.id),
        );
        if (visible.length === 0) throw new AuthError('FORBIDDEN');
        const filters: Prisma.UserWhereInput[] = [
          { kind: 'EMPLOYEE', employeeProfile: { isNot: null } },
          { OR: visible },
          ...(status ? [{ status }] : []),
          ...(groupIds === null ? [] : [{ id: { in: groupIds } }]),
          ...(branchId
            ? [{ employeeProfile: { branchAssignments: { some: { revokedAt: null, branchId } } } }]
            : []),
          ...(q
            ? [
                {
                  OR: [
                    { fullName: { contains: q, mode: 'insensitive' as const } },
                    {
                      employeeProfile: {
                        employeeCodeCanonical: { contains: q, mode: 'insensitive' as const },
                      },
                    },
                  ],
                },
              ]
            : []),
          ...(cursor ? [{ employeeProfile: { employeeCodeCanonical: { gt: cursor } } }] : []),
        ];
        const present = (row: DirectoryRow): EmployeeDirectoryEntry => {
          const profile = row.employeeProfile!;
          const latest = profile.classificationChanges[0];
          const current =
            profile.classificationChanges.find((entry) => day(entry.effectiveDate) <= today)
              ?.classification ?? null;
          return {
            id: row.id,
            employeeId: profile.employeeCodeCanonical,
            fullName: row.fullName,
            status: row.status as EmployeeStatus,
            branchIds: profile.branchAssignments.map((entry) => entry.branchId),
            version: row.rowVersion,
            classification: latest?.classification ?? null,
            classificationEffectiveDate: latest ? day(latest.effectiveDate) : null,
            title: workforceTitle({
              owner: false,
              current,
              manager: current === 'OFFICIAL_EMPLOYEE' && row.roleAssignments.length > 0,
            }),
          };
        };
        const orderBy = { employeeProfile: { employeeCodeCanonical: 'asc' } } as const;
        if (pageNumber !== undefined) {
          // Numbered pages: offset over the same scoped, filtered and ordered set, plus the
          // total, so each directory group paginates on the server independently.
          const total = await tx.user.count({ where: { AND: filters } });
          const rows = await tx.user.findMany({
            where: { AND: filters },
            select: directorySelect,
            orderBy,
            skip: (pageNumber - 1) * limit,
            take: limit,
          });
          return {
            items: rows.map(present),
            nextCursor: null,
            page: { number: pageNumber, size: limit, total },
          };
        }
        const rows = await tx.user.findMany({
          where: { AND: filters },
          select: directorySelect,
          orderBy,
          take: limit + 1,
        });
        const items = rows.slice(0, limit).map(present);
        const last = items.at(-1);
        return {
          items,
          nextCursor: rows.length > limit && last ? encodeCursor(last.employeeId) : null,
        };
      },
    );
  }
}
