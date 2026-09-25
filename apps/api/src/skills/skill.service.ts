import type {
  CatalogStatusRequest,
  EmployeeSkillGrantRequest,
  EmployeeSkillRevokeRequest,
  EmployeeSkillsResponse,
  SkillCreateRequest,
  SkillListResponse,
  SkillResponse,
  SkillUpdateRequest,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable } from '@nestjs/common';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { SessionService } from '../auth/session.service.js';
import {
  appendAdminAudit,
  requireAcross,
  runAdminCommand,
  type AdminActor,
  type AdminContext,
} from '../authorization/admin-command.js';
import { decide, decideAcross, GLOBAL } from '../authorization/authorization.js';
import {
  catalogName,
  normalizeCatalogCode,
  optionalReason,
  requiredReason,
} from '../catalog/catalog.input.js';
import { isUuid } from '../employees/employee.input.js';
import { businessToday, classificationOn } from '../employees/employment.js';

const skillSelect = {
  id: true,
  code: true,
  nameVi: true,
  nameEn: true,
  isActive: true,
  rowVersion: true,
} satisfies Prisma.SkillSelect;

type SkillRow = Prisma.SkillGetPayload<{ select: typeof skillSelect }>;

function presentSkill(row: SkillRow): SkillResponse {
  return {
    id: row.id,
    code: row.code,
    nameVi: row.nameVi,
    nameEn: row.nameEn,
    isActive: row.isActive,
    version: row.rowVersion,
  };
}

interface EmployeeTarget {
  readonly id: string;
  readonly status: 'PENDING_SETUP' | 'ACTIVE' | 'INACTIVE';
  /** Every unrevoked membership (EmployeeBranchAssignment), the source of branch scope. */
  readonly branchIds: string[];
}

/**
 * Skill catalog and employee skills (Phase 2 Step 5).
 *
 * - **Skill catalog:** a shared resource, so only GLOBAL `MANAGE_SKILLS` may change it.
 *   Codes are immutable and skills are never deleted.
 * - **Employee skills:** capabilities of the employee, one per (employee, skill), not
 *   per-branch copies. Changes need `MANAGE_SKILLS` for **every** branch the employee
 *   belongs to (GLOBAL when none), so a branch manager can't change a multi-branch
 *   employee they don't fully administer.
 * - **History:** rows are kept; revocation is one-way, enforced by the Step 2 triggers.
 */
@Injectable()
export class SkillService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  // -------------------------------------------------------------- skill catalog

  async listSkills(sessionToken: string | undefined): Promise<SkillListResponse> {
    return this.frame(sessionToken, undefined, [], async ({ tx, actor }) => {
      const rows = await tx.skill.findMany({
        where: this.managesCatalog(actor) ? {} : { isActive: true },
        select: skillSelect,
        orderBy: { code: 'asc' },
      });
      return { skills: rows.map(presentSkill) };
    });
  }

  async createSkill(
    sessionToken: string | undefined,
    input: SkillCreateRequest,
    requestId?: string,
  ): Promise<SkillResponse> {
    const code = normalizeCatalogCode(input.code);
    const nameVi = catalogName(input.nameVi, 'nameVi');
    const nameEn = catalogName(input.nameEn, 'nameEn');
    const reason = optionalReason(input.reason);
    return this.frame(sessionToken, requestId, [], async (context) => {
      const { tx } = context;
      requireAcross(context.actor, 'MANAGE_SKILLS', []);
      if (await tx.skill.findUnique({ where: { code }, select: { id: true } })) {
        throw new AuthError('CONFLICT', 'code');
      }
      const row = await tx.skill.create({ data: { code, nameVi, nameEn }, select: skillSelect });
      await this.audit(context, 'SKILL_CREATED', 'Skill', row.id, {
        reason,
        after: { code, nameVi, nameEn, isActive: true },
      });
      return presentSkill(row);
    });
  }

  async updateSkill(
    sessionToken: string | undefined,
    skillId: string,
    input: SkillUpdateRequest,
    requestId?: string,
  ): Promise<SkillResponse> {
    const id = this.id(skillId);
    const patch: { nameVi?: string; nameEn?: string } = {};
    if (input.nameVi !== undefined) patch.nameVi = catalogName(input.nameVi, 'nameVi');
    if (input.nameEn !== undefined) patch.nameEn = catalogName(input.nameEn, 'nameEn');
    if (Object.keys(patch).length === 0) throw new AuthError('VALIDATION_FAILED');
    const reason = optionalReason(input.reason);
    return this.frame(sessionToken, requestId, [], async (context) => {
      const { tx } = context;
      requireAcross(context.actor, 'MANAGE_SKILLS', []);
      const current = await this.lockSkill(tx, id, input.expectedVersion);
      const changes = Object.fromEntries(
        Object.entries(patch).filter(
          ([key, value]) => current[key as keyof typeof patch] !== value,
        ),
      ) as typeof patch;
      if (Object.keys(changes).length === 0) throw new AuthError('VALIDATION_FAILED');
      const row = await tx.skill.update({
        where: { id },
        data: { ...changes, rowVersion: { increment: 1 } },
        select: skillSelect,
      });
      await this.audit(context, 'SKILL_UPDATED', 'Skill', id, {
        reason,
        before: Object.fromEntries(
          Object.keys(changes).map((key) => [key, current[key as keyof typeof patch]]),
        ),
        after: changes,
      });
      return presentSkill(row);
    });
  }

  /**
   * Deactivation blocks new service and employee assignments. It doesn't cascade:
   * existing assignments stay as history for later review, as with categories.
   */
  async setSkillStatus(
    sessionToken: string | undefined,
    skillId: string,
    input: CatalogStatusRequest,
    requestId?: string,
  ): Promise<SkillResponse> {
    const id = this.id(skillId);
    const reason = requiredReason(input.reason);
    return this.frame(sessionToken, requestId, [], async (context) => {
      const { tx } = context;
      requireAcross(context.actor, 'MANAGE_SKILLS', []);
      const current = await this.lockSkill(tx, id, input.expectedVersion);
      if (current.isActive === input.isActive) throw new AuthError('CONFLICT', 'isActive');
      const row = await tx.skill.update({
        where: { id },
        data: { isActive: input.isActive, rowVersion: { increment: 1 } },
        select: skillSelect,
      });
      await this.audit(context, 'SKILL_STATUS_CHANGED', 'Skill', id, {
        reason,
        before: { isActive: current.isActive },
        after: { isActive: input.isActive },
      });
      return presentSkill(row);
    });
  }

  // ------------------------------------------------------------ employee skills

  /**
   * Visible to the employee themself, and to callers holding `VIEW_EMPLOYEES` or
   * `MANAGE_SKILLS` over every branch of the employee. Otherwise 404.
   */
  async employeeSkills(
    sessionToken: string | undefined,
    employeeId: string,
  ): Promise<EmployeeSkillsResponse> {
    const id = this.id(employeeId);
    return this.frame(sessionToken, undefined, [id], async ({ tx, actor }) => {
      const target = await this.loadEmployee(tx, id);
      const allowed =
        actor.userId === id ||
        decideAcross(actor.graph, 'VIEW_EMPLOYEES', target.branchIds) ||
        decideAcross(actor.graph, 'MANAGE_SKILLS', target.branchIds);
      if (!allowed) throw new AuthError('NOT_FOUND');
      return this.presentEmployee(tx, id);
    });
  }

  async grantEmployeeSkill(
    sessionToken: string | undefined,
    employeeId: string,
    input: EmployeeSkillGrantRequest,
    requestId?: string,
  ): Promise<EmployeeSkillsResponse> {
    const id = this.id(employeeId);
    const skillId = this.id(input.skillId, 'skillId');
    const reason = optionalReason(input.reason);
    return this.frame(sessionToken, requestId, [id], async (context) => {
      const { tx, actor, now } = context;
      const target = await this.authorizeEmployee(context, id);
      // Existing workforce convention (setup issuance): no new capability for INACTIVE.
      if (target.status === 'INACTIVE') throw new AuthError('CONFLICT', 'status');
      // Ended employment receives no new qualifications (no rehire); revoking stays possible.
      const today = await businessToday(tx, target.branchIds);
      if ((await classificationOn(tx, id, today))?.classification === 'ENDED') {
        throw new AuthError('CONFLICT', 'employment');
      }
      await tx.$queryRaw`SELECT id FROM skills WHERE id = ${skillId}::uuid FOR SHARE`;
      const skill = await tx.skill.findUnique({ where: { id: skillId }, select: skillSelect });
      if (!skill || !skill.isActive) throw new AuthError('VALIDATION_FAILED', 'skillId');
      const active = await tx.employeeSkill.findFirst({
        where: { employeeUserId: id, skillId, revokedAt: null },
        select: { id: true },
      });
      if (active) throw new AuthError('CONFLICT', 'skillId');
      const grant = await tx.employeeSkill.create({
        data: { employeeUserId: id, skillId, grantedAt: now, grantedByUserId: actor.userId },
        select: { id: true },
      });
      await this.audit(context, 'EMPLOYEE_SKILL_GRANTED', 'User', id, {
        subjectUserId: id,
        branchId: target.branchIds.length === 1 ? target.branchIds[0] : undefined,
        reason,
        after: { employeeSkillId: grant.id, skillId, skillCode: skill.code },
      });
      return this.presentEmployee(tx, id);
    });
  }

  async revokeEmployeeSkill(
    sessionToken: string | undefined,
    employeeId: string,
    skillId: string,
    input: EmployeeSkillRevokeRequest,
    requestId?: string,
  ): Promise<EmployeeSkillsResponse> {
    const id = this.id(employeeId);
    const skill = this.id(skillId);
    const reason = optionalReason(input.reason);
    return this.frame(sessionToken, requestId, [id], async (context) => {
      const { tx, now } = context;
      const target = await this.authorizeEmployee(context, id);
      const active = await tx.employeeSkill.findFirst({
        where: { employeeUserId: id, skillId: skill, revokedAt: null },
        select: { id: true, skill: { select: { code: true } } },
      });
      if (!active) throw new AuthError('NOT_FOUND');
      await tx.employeeSkill.update({
        where: { id: active.id },
        data: { revokedAt: now },
        select: { id: true },
      });
      await this.audit(context, 'EMPLOYEE_SKILL_REVOKED', 'User', id, {
        subjectUserId: id,
        branchId: target.branchIds.length === 1 ? target.branchIds[0] : undefined,
        reason,
        before: { employeeSkillId: active.id, skillId: skill, skillCode: active.skill.code },
        after: { employeeSkillId: active.id, revoked: true },
      });
      return this.presentEmployee(tx, id);
    });
  }

  // -------------------------------------------------------------------- helpers

  private frame<T>(
    sessionToken: string | undefined,
    requestId: string | undefined,
    users: readonly string[],
    work: (context: AdminContext) => Promise<T>,
  ): Promise<T> {
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      sessionToken,
      { exclusive: false, requestId, lockUsers: () => Promise.resolve(users) },
      work,
    );
  }

  private id(value: string, field?: string): string {
    const id = value.toLowerCase();
    if (!isUuid(id)) {
      throw field ? new AuthError('VALIDATION_FAILED', field) : new AuthError('NOT_FOUND');
    }
    return id;
  }

  private managesCatalog(actor: AdminActor): boolean {
    return decide(actor.graph, 'MANAGE_SKILLS', GLOBAL);
  }

  private async lockSkill(tx: Prisma.TransactionClient, id: string, expectedVersion: number) {
    await tx.$queryRaw`SELECT id FROM skills WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.skill.findUnique({ where: { id }, select: skillSelect });
    if (!row) throw new AuthError('NOT_FOUND');
    if (row.rowVersion !== expectedVersion) throw new AuthError('CONFLICT');
    return row;
  }

  /** Owner and customers are never employee-skill targets (404, like Step 10). */
  private async loadEmployee(tx: Prisma.TransactionClient, id: string): Promise<EmployeeTarget> {
    const user = await tx.user.findUnique({
      where: { id },
      select: {
        kind: true,
        status: true,
        employeeProfile: {
          select: {
            branchAssignments: {
              where: { revokedAt: null },
              select: { branchId: true },
              orderBy: { branchId: 'asc' },
            },
          },
        },
      },
    });
    if (!user || user.kind !== 'EMPLOYEE' || !user.employeeProfile) {
      throw new AuthError('NOT_FOUND');
    }
    return {
      id,
      status: user.status,
      branchIds: user.employeeProfile.branchAssignments.map((row) => row.branchId),
    };
  }

  /**
   * `MANAGE_SKILLS` over every branch of the employee (multi-branch all-or-nothing; no
   * branch requires GLOBAL). Non-Owners can't grant or revoke their own skills.
   */
  private async authorizeEmployee(context: AdminContext, id: string): Promise<EmployeeTarget> {
    const target = await this.loadEmployee(context.tx, id);
    if (!context.actor.owner && context.actor.userId === id) throw new AuthError('FORBIDDEN');
    requireAcross(context.actor, 'MANAGE_SKILLS', target.branchIds);
    return target;
  }

  private async presentEmployee(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<EmployeeSkillsResponse> {
    const rows = await tx.employeeSkill.findMany({
      where: { employeeUserId: id, revokedAt: null },
      select: {
        grantedAt: true,
        grantedByUserId: true,
        skill: { select: { id: true, code: true, nameVi: true, nameEn: true, isActive: true } },
      },
    });
    // Revoked grants are kept as history and returned as such (Employee management Step 5).
    const revoked = await tx.employeeSkill.findMany({
      where: { employeeUserId: id, revokedAt: { not: null } },
      orderBy: [{ revokedAt: 'desc' }, { id: 'asc' }],
      select: {
        grantedAt: true,
        revokedAt: true,
        grantedByUserId: true,
        skill: { select: { id: true, code: true, nameVi: true, nameEn: true, isActive: true } },
      },
    });
    return {
      employeeId: id,
      history: revoked.map((row) => ({
        skill: row.skill,
        grantedAt: row.grantedAt.toISOString(),
        revokedAt: row.revokedAt!.toISOString(),
        grantedByUserId: row.grantedByUserId,
      })),
      skills: rows
        .map((row) => ({
          skill: row.skill,
          grantedAt: row.grantedAt.toISOString(),
          grantedByUserId: row.grantedByUserId,
        }))
        .sort((a, b) => (a.skill.code < b.skill.code ? -1 : 1)),
    };
  }

  private audit(
    context: AdminContext,
    action: string,
    entityType: string,
    entityId: string,
    detail: {
      subjectUserId?: string;
      branchId?: string | undefined;
      reason: string | null;
      before?: Prisma.InputJsonObject;
      after: Prisma.InputJsonObject;
    },
  ): Promise<void> {
    return appendAdminAudit(context, {
      action,
      entityType,
      entityId,
      subjectUserId: detail.subjectUserId ?? null,
      branchId: detail.branchId ?? null,
      reason: detail.reason,
      ...(detail.before ? { before: detail.before } : {}),
      after: detail.after,
    });
  }
}
