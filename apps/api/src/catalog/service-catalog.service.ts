import { randomUUID } from 'node:crypto';
import type {
  CatalogStatusRequest,
  ServiceAvailabilityRequest,
  ServiceCategoryCreateRequest,
  ServiceCategoryListResponse,
  ServiceCategoryResponse,
  ServiceCategoryUpdateRequest,
  ServiceCreateRequest,
  ServiceListResponse,
  ServicePriceRequest,
  ServiceResponse,
  ServiceSkillsRequest,
  ServiceUpdateRequest,
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
import { decide, GLOBAL } from '../authorization/authorization.js';
import { isUuid } from '../employees/employee.input.js';
import {
  catalogDescription,
  catalogName,
  durationMinutes,
  normalizeCatalogCode,
  optionalReason,
  priceVnd,
  requiredReason,
  sortOrder,
} from './catalog.input.js';

const categorySelect = {
  id: true,
  code: true,
  nameVi: true,
  nameEn: true,
  sortOrder: true,
  isActive: true,
  rowVersion: true,
} satisfies Prisma.ServiceCategorySelect;

const serviceSelect = {
  id: true,
  code: true,
  categoryId: true,
  nameVi: true,
  nameEn: true,
  descriptionVi: true,
  descriptionEn: true,
  priceVnd: true,
  durationMinutes: true,
  isActive: true,
  rowVersion: true,
  branches: { select: { branchId: true, isActive: true, rowVersion: true } },
  eligibleSkills: {
    select: {
      skill: { select: { id: true, code: true, nameVi: true, nameEn: true, isActive: true } },
    },
  },
} satisfies Prisma.ServiceSelect;

/** A bounded configuration set; the catalog is small and codes are human-managed. */
const MAX_ELIGIBLE_SKILLS = 50;

type CategoryRow = Prisma.ServiceCategoryGetPayload<{ select: typeof categorySelect }>;
type ServiceRow = Prisma.ServiceGetPayload<{ select: typeof serviceSelect }>;

function presentCategory(row: CategoryRow): ServiceCategoryResponse {
  return {
    id: row.id,
    code: row.code,
    nameVi: row.nameVi,
    nameEn: row.nameEn,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    version: row.rowVersion,
  };
}

/**
 * Service catalog (Phase 2 Step 4). Master data (categories, services, duration, active
 * state) is a global resource: GLOBAL `MANAGE_SERVICES`. Price is separate and needs
 * GLOBAL_ONLY `MANAGE_SERVICE_PRICES`. Branch availability is the only thing a
 * branch-scoped `MANAGE_SERVICES` grant can change, and only for that branch. Nothing is
 * ever deleted; every change is audited in its own transaction.
 */
@Injectable()
export class ServiceCatalogService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  // ----------------------------------------------------------------- categories

  async listCategories(sessionToken: string | undefined): Promise<ServiceCategoryListResponse> {
    return this.frame(sessionToken, undefined, async ({ tx, actor }) => {
      const rows = await tx.serviceCategory.findMany({
        where: this.managesCatalog(actor) ? {} : { isActive: true },
        select: categorySelect,
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      });
      return { categories: rows.map(presentCategory) };
    });
  }

  async createCategory(
    sessionToken: string | undefined,
    input: ServiceCategoryCreateRequest,
    requestId?: string,
  ): Promise<ServiceCategoryResponse> {
    const code = normalizeCatalogCode(input.code);
    const nameVi = catalogName(input.nameVi, 'nameVi');
    const nameEn = catalogName(input.nameEn, 'nameEn');
    const order = sortOrder(input.sortOrder ?? 0);
    const reason = optionalReason(input.reason);
    return this.frame(sessionToken, requestId, async (context) => {
      const { tx } = context;
      requireAcross(context.actor, 'MANAGE_SERVICES', []);
      if (await tx.serviceCategory.findUnique({ where: { code }, select: { id: true } })) {
        throw new AuthError('CONFLICT', 'code');
      }
      const row = await tx.serviceCategory.create({
        data: { code, nameVi, nameEn, sortOrder: order },
        select: categorySelect,
      });
      await this.audit(context, 'SERVICE_CATEGORY_CREATED', 'ServiceCategory', row.id, {
        reason,
        after: { code, nameVi, nameEn, sortOrder: order, isActive: true },
      });
      return presentCategory(row);
    });
  }

  async updateCategory(
    sessionToken: string | undefined,
    categoryId: string,
    input: ServiceCategoryUpdateRequest,
    requestId?: string,
  ): Promise<ServiceCategoryResponse> {
    const id = this.id(categoryId);
    const patch: Partial<Pick<CategoryRow, 'nameVi' | 'nameEn' | 'sortOrder'>> = {};
    if (input.nameVi !== undefined) patch.nameVi = catalogName(input.nameVi, 'nameVi');
    if (input.nameEn !== undefined) patch.nameEn = catalogName(input.nameEn, 'nameEn');
    if (input.sortOrder !== undefined) patch.sortOrder = sortOrder(input.sortOrder);
    if (Object.keys(patch).length === 0) throw new AuthError('VALIDATION_FAILED');
    const reason = optionalReason(input.reason);
    return this.frame(sessionToken, requestId, async (context) => {
      const { tx } = context;
      requireAcross(context.actor, 'MANAGE_SERVICES', []);
      const current = await this.lockCategory(tx, id, input.expectedVersion);
      const changes = this.changed(current, patch);
      const row = await tx.serviceCategory.update({
        where: { id },
        data: { ...changes, rowVersion: { increment: 1 } },
        select: categorySelect,
      });
      await this.audit(context, 'SERVICE_CATEGORY_UPDATED', 'ServiceCategory', id, {
        reason,
        before: this.pick(current, changes),
        after: changes,
      });
      return presentCategory(row);
    });
  }

  async setCategoryStatus(
    sessionToken: string | undefined,
    categoryId: string,
    input: CatalogStatusRequest,
    requestId?: string,
  ): Promise<ServiceCategoryResponse> {
    const id = this.id(categoryId);
    const reason = requiredReason(input.reason);
    return this.frame(sessionToken, requestId, async (context) => {
      const { tx } = context;
      requireAcross(context.actor, 'MANAGE_SERVICES', []);
      const current = await this.lockCategory(tx, id, input.expectedVersion);
      if (current.isActive === input.isActive) throw new AuthError('CONFLICT', 'isActive');
      const row = await tx.serviceCategory.update({
        where: { id },
        data: { isActive: input.isActive, rowVersion: { increment: 1 } },
        select: categorySelect,
      });
      await this.audit(context, 'SERVICE_CATEGORY_STATUS_CHANGED', 'ServiceCategory', id, {
        reason,
        before: { isActive: current.isActive },
        after: { isActive: input.isActive },
      });
      return presentCategory(row);
    });
  }

  // ------------------------------------------------------------------- services

  /**
   * Services visible to a workforce actor. GLOBAL `MANAGE_SERVICES` holders also see
   * inactive services. Availability is limited to branches the caller may see; with
   * `branchId`, only services actively offered at that (visible) branch are returned.
   */
  async listServices(
    sessionToken: string | undefined,
    filter: { categoryId?: string; branchId?: string },
  ): Promise<ServiceListResponse> {
    const categoryId = filter.categoryId === undefined ? undefined : this.id(filter.categoryId);
    const branchId = filter.branchId === undefined ? undefined : this.id(filter.branchId);
    return this.frame(sessionToken, undefined, async ({ tx, actor }) => {
      if (branchId !== undefined && !this.seesBranch(actor, branchId)) {
        throw new AuthError('NOT_FOUND');
      }
      const rows = await tx.service.findMany({
        where: {
          ...(this.managesCatalog(actor) ? {} : { isActive: true }),
          ...(categoryId ? { categoryId } : {}),
          ...(branchId ? { branches: { some: { branchId, isActive: true } } } : {}),
        },
        select: serviceSelect,
        orderBy: { code: 'asc' },
      });
      return { services: rows.map((row) => this.present(actor, row)) };
    });
  }

  async getService(sessionToken: string | undefined, serviceId: string): Promise<ServiceResponse> {
    const id = this.id(serviceId);
    return this.frame(sessionToken, undefined, async ({ tx, actor }) => {
      const row = await tx.service.findUnique({ where: { id }, select: serviceSelect });
      if (!row || (!row.isActive && !this.managesCatalog(actor))) throw new AuthError('NOT_FOUND');
      return this.present(actor, row);
    });
  }

  /** Master data plus the initial price, so the price authority is required too. */
  async createService(
    sessionToken: string | undefined,
    input: ServiceCreateRequest,
    requestId?: string,
  ): Promise<ServiceResponse> {
    const code = normalizeCatalogCode(input.code);
    const categoryId = this.id(input.categoryId, 'categoryId');
    const nameVi = catalogName(input.nameVi, 'nameVi');
    const nameEn = catalogName(input.nameEn, 'nameEn');
    const descriptionVi = catalogDescription(input.descriptionVi ?? null, 'descriptionVi');
    const descriptionEn = catalogDescription(input.descriptionEn ?? null, 'descriptionEn');
    const price = priceVnd(input.priceVnd);
    const duration = durationMinutes(input.durationMinutes);
    const reason = optionalReason(input.reason);
    return this.frame(sessionToken, requestId, async (context) => {
      const { tx, actor } = context;
      requireAcross(actor, 'MANAGE_SERVICES', []);
      requireAcross(actor, 'MANAGE_SERVICE_PRICES', []);
      await this.requireCategory(tx, categoryId);
      if (await tx.service.findUnique({ where: { code }, select: { id: true } })) {
        throw new AuthError('CONFLICT', 'code');
      }
      const row = await tx.service.create({
        data: {
          id: randomUUID(),
          code,
          categoryId,
          nameVi,
          nameEn,
          descriptionVi,
          descriptionEn,
          priceVnd: price,
          durationMinutes: duration,
        },
        select: serviceSelect,
      });
      await this.audit(context, 'SERVICE_CREATED', 'Service', row.id, {
        reason,
        after: {
          code,
          categoryId,
          nameVi,
          nameEn,
          priceVnd: price.toString(),
          durationMinutes: duration,
          isActive: true,
        },
      });
      return this.present(actor, row);
    });
  }

  /** Master data only: names, descriptions, category, duration. Never code or price. */
  async updateService(
    sessionToken: string | undefined,
    serviceId: string,
    input: ServiceUpdateRequest,
    requestId?: string,
  ): Promise<ServiceResponse> {
    const id = this.id(serviceId);
    const patch: Partial<
      Pick<
        ServiceRow,
        'categoryId' | 'nameVi' | 'nameEn' | 'descriptionVi' | 'descriptionEn' | 'durationMinutes'
      >
    > = {};
    if (input.categoryId !== undefined) patch.categoryId = this.id(input.categoryId, 'categoryId');
    if (input.nameVi !== undefined) patch.nameVi = catalogName(input.nameVi, 'nameVi');
    if (input.nameEn !== undefined) patch.nameEn = catalogName(input.nameEn, 'nameEn');
    if (input.descriptionVi !== undefined) {
      patch.descriptionVi = catalogDescription(input.descriptionVi, 'descriptionVi');
    }
    if (input.descriptionEn !== undefined) {
      patch.descriptionEn = catalogDescription(input.descriptionEn, 'descriptionEn');
    }
    if (input.durationMinutes !== undefined) {
      patch.durationMinutes = durationMinutes(input.durationMinutes);
    }
    if (Object.keys(patch).length === 0) throw new AuthError('VALIDATION_FAILED');
    const reason = optionalReason(input.reason);
    return this.frame(sessionToken, requestId, async (context) => {
      const { tx, actor } = context;
      requireAcross(actor, 'MANAGE_SERVICES', []);
      const current = await this.lockService(tx, id, input.expectedVersion);
      const changes = this.changed(current, patch);
      if (changes.categoryId !== undefined) await this.requireCategory(tx, changes.categoryId);
      const row = await tx.service.update({
        where: { id },
        data: { ...changes, rowVersion: { increment: 1 } },
        select: serviceSelect,
      });
      await this.audit(context, 'SERVICE_UPDATED', 'Service', id, {
        reason,
        before: this.pick(current, changes),
        after: changes,
      });
      return this.present(actor, row);
    });
  }

  async setServiceStatus(
    sessionToken: string | undefined,
    serviceId: string,
    input: CatalogStatusRequest,
    requestId?: string,
  ): Promise<ServiceResponse> {
    const id = this.id(serviceId);
    const reason = requiredReason(input.reason);
    return this.frame(sessionToken, requestId, async (context) => {
      const { tx, actor } = context;
      requireAcross(actor, 'MANAGE_SERVICES', []);
      const current = await this.lockService(tx, id, input.expectedVersion);
      if (current.isActive === input.isActive) throw new AuthError('CONFLICT', 'isActive');
      const row = await tx.service.update({
        where: { id },
        data: { isActive: input.isActive, rowVersion: { increment: 1 } },
        select: serviceSelect,
      });
      await this.audit(context, 'SERVICE_STATUS_CHANGED', 'Service', id, {
        reason,
        before: { isActive: current.isActive },
        after: { isActive: input.isActive },
      });
      return this.present(actor, row);
    });
  }

  /**
   * The configured price (PRD 8.3): GLOBAL_ONLY `MANAGE_SERVICE_PRICES` only; ordinary
   * `MANAGE_SERVICES` never suffices. Future invoices snapshot the price, so changing it
   * never alters historical transactions.
   */
  async setPrice(
    sessionToken: string | undefined,
    serviceId: string,
    input: ServicePriceRequest,
    requestId?: string,
  ): Promise<ServiceResponse> {
    const id = this.id(serviceId);
    const price = priceVnd(input.priceVnd);
    const reason = requiredReason(input.reason);
    return this.frame(sessionToken, requestId, async (context) => {
      const { tx, actor } = context;
      requireAcross(actor, 'MANAGE_SERVICE_PRICES', []);
      const current = await this.lockService(tx, id, input.expectedVersion);
      if (current.priceVnd === price) throw new AuthError('VALIDATION_FAILED', 'priceVnd');
      const row = await tx.service.update({
        where: { id },
        data: { priceVnd: price, rowVersion: { increment: 1 } },
        select: serviceSelect,
      });
      await this.audit(context, 'SERVICE_PRICE_CHANGED', 'Service', id, {
        reason,
        before: { priceVnd: current.priceVnd.toString() },
        after: { priceVnd: price.toString() },
      });
      return this.present(actor, row);
    });
  }

  /**
   * Whether one branch offers the service. `MANAGE_SERVICES` for that branch suffices
   * (branch or GLOBAL grant). The availability row has its own version, so branch
   * managers never conflict with master-data edits.
   */
  async setAvailability(
    sessionToken: string | undefined,
    serviceId: string,
    branchId: string,
    input: ServiceAvailabilityRequest,
    requestId?: string,
  ): Promise<ServiceResponse> {
    const id = this.id(serviceId);
    const branch = this.id(branchId);
    const reason = optionalReason(input.reason);
    return this.frame(sessionToken, requestId, async (context) => {
      const { tx, actor } = context;
      if (!this.seesBranch(actor, branch)) throw new AuthError('NOT_FOUND');
      requireAcross(actor, 'MANAGE_SERVICES', [branch]);
      await tx.$queryRaw`SELECT id FROM services WHERE id = ${id}::uuid FOR SHARE`;
      if (!(await tx.service.findUnique({ where: { id }, select: { id: true } }))) {
        throw new AuthError('NOT_FOUND');
      }
      if (!(await tx.branch.findUnique({ where: { id: branch }, select: { id: true } }))) {
        throw new AuthError('NOT_FOUND');
      }
      await tx.$queryRaw`
        SELECT service_id FROM service_branch_availability
        WHERE service_id = ${id}::uuid AND branch_id = ${branch}::uuid FOR UPDATE`;
      const current = await tx.serviceBranchAvailability.findUnique({
        where: { serviceId_branchId: { serviceId: id, branchId: branch } },
        select: { isActive: true, rowVersion: true },
      });
      if ((current?.rowVersion ?? null) !== input.expectedVersion) {
        throw new AuthError('CONFLICT');
      }
      if (current?.isActive === input.isActive || (!current && !input.isActive)) {
        throw new AuthError('CONFLICT', 'isActive');
      }
      if (current) {
        await tx.serviceBranchAvailability.update({
          where: { serviceId_branchId: { serviceId: id, branchId: branch } },
          data: { isActive: input.isActive, rowVersion: { increment: 1 } },
          select: { serviceId: true },
        });
      } else {
        await tx.serviceBranchAvailability.create({
          data: { serviceId: id, branchId: branch, isActive: true },
          select: { serviceId: true },
        });
      }
      await this.audit(context, 'SERVICE_AVAILABILITY_CHANGED', 'Service', id, {
        branchId: branch,
        reason,
        before: { branchId: branch, isActive: current?.isActive ?? null },
        after: { branchId: branch, isActive: input.isActive },
      });
      const row = await tx.service.findUniqueOrThrow({ where: { id }, select: serviceSelect });
      return this.present(actor, row);
    });
  }

  /**
   * Replaces the service's eligible skills (service configuration, not skill
   * administration): GLOBAL `MANAGE_SERVICES` only; `MANAGE_SKILLS` never suffices. The
   * set may be empty. Newly added skills must exist and be active; a kept skill that was
   * deactivated since stays until removed. Skills themselves are never deleted. The
   * service's `expectedVersion` protects the whole set.
   */
  async setEligibleSkills(
    sessionToken: string | undefined,
    serviceId: string,
    input: ServiceSkillsRequest,
    requestId?: string,
  ): Promise<ServiceResponse> {
    const id = this.id(serviceId);
    const skillIds = [...new Set(input.skillIds.map((value) => this.id(value, 'skillIds')))].sort();
    if (skillIds.length > MAX_ELIGIBLE_SKILLS) throw new AuthError('VALIDATION_FAILED', 'skillIds');
    const reason = optionalReason(input.reason);
    return this.frame(sessionToken, requestId, async (context) => {
      const { tx, actor } = context;
      requireAcross(actor, 'MANAGE_SERVICES', []);
      const current = await this.lockService(tx, id, input.expectedVersion);
      const previous = current.eligibleSkills.map((entry) => entry.skill.id).sort();
      const added = skillIds.filter((skillId) => !previous.includes(skillId));
      const removed = previous.filter((skillId) => !skillIds.includes(skillId));
      if (added.length === 0 && removed.length === 0) {
        throw new AuthError('VALIDATION_FAILED', 'skillIds');
      }
      if (added.length > 0) {
        // Skills are locked so a concurrent deactivation cannot slip in.
        await tx.$queryRaw`SELECT id FROM skills WHERE id = ANY(${added}::uuid[]) FOR SHARE`;
        const usable = await tx.skill.count({ where: { id: { in: added }, isActive: true } });
        if (usable !== added.length) throw new AuthError('VALIDATION_FAILED', 'skillIds');
        await tx.serviceSkill.createMany({
          data: added.map((skillId) => ({ serviceId: id, skillId })),
        });
      }
      if (removed.length > 0) {
        await tx.serviceSkill.deleteMany({ where: { serviceId: id, skillId: { in: removed } } });
      }
      const row = await tx.service.update({
        where: { id },
        data: { rowVersion: { increment: 1 } },
        select: serviceSelect,
      });
      const codes = new Map(
        [
          ...current.eligibleSkills.map((entry) => entry.skill),
          ...row.eligibleSkills.map((e) => e.skill),
        ].map((skill) => [skill.id, skill.code]),
      );
      const describe = (ids: string[]) =>
        ids.map((skillId) => ({ id: skillId, code: codes.get(skillId) ?? null }));
      await this.audit(context, 'SERVICE_SKILLS_CHANGED', 'Service', id, {
        reason,
        before: { skills: describe(previous) },
        after: { skills: describe(skillIds), added: describe(added), removed: describe(removed) },
      });
      return this.present(actor, row);
    });
  }

  // -------------------------------------------------------------------- helpers

  private frame<T>(
    sessionToken: string | undefined,
    requestId: string | undefined,
    work: (context: AdminContext) => Promise<T>,
  ): Promise<T> {
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      sessionToken,
      { exclusive: false, requestId },
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

  /** GLOBAL `MANAGE_SERVICES` (Owner included): master data and inactive entries. */
  private managesCatalog(actor: AdminActor): boolean {
    return decide(actor.graph, 'MANAGE_SERVICES', GLOBAL);
  }

  /**
   * Branch configuration visible to the caller: every branch for GLOBAL
   * `MANAGE_SERVICES` or `MANAGE_BRANCHES`, otherwise the caller's active branches.
   */
  private seesBranch(actor: AdminActor, branchId: string): boolean {
    return (
      this.managesCatalog(actor) ||
      decide(actor.graph, 'MANAGE_BRANCHES', GLOBAL) ||
      actor.graph.activeBranchIds.has(branchId)
    );
  }

  private present(actor: AdminActor, row: ServiceRow): ServiceResponse {
    return {
      id: row.id,
      code: row.code,
      categoryId: row.categoryId,
      nameVi: row.nameVi,
      nameEn: row.nameEn,
      descriptionVi: row.descriptionVi,
      descriptionEn: row.descriptionEn,
      priceVnd: row.priceVnd.toString(),
      durationMinutes: row.durationMinutes,
      isActive: row.isActive,
      version: row.rowVersion,
      availability: row.branches
        .filter((entry) => this.seesBranch(actor, entry.branchId))
        .map((entry) => ({
          branchId: entry.branchId,
          isActive: entry.isActive,
          version: entry.rowVersion,
        }))
        .sort((a, b) => (a.branchId < b.branchId ? -1 : 1)),
      eligibleSkills: row.eligibleSkills
        .map((entry) => entry.skill)
        .sort((a, b) => (a.code < b.code ? -1 : 1)),
    };
  }

  private async lockCategory(tx: Prisma.TransactionClient, id: string, expectedVersion: number) {
    await tx.$queryRaw`SELECT id FROM service_categories WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.serviceCategory.findUnique({ where: { id }, select: categorySelect });
    if (!row) throw new AuthError('NOT_FOUND');
    if (row.rowVersion !== expectedVersion) throw new AuthError('CONFLICT');
    return row;
  }

  private async lockService(tx: Prisma.TransactionClient, id: string, expectedVersion: number) {
    await tx.$queryRaw`SELECT id FROM services WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.service.findUnique({ where: { id }, select: serviceSelect });
    if (!row) throw new AuthError('NOT_FOUND');
    if (row.rowVersion !== expectedVersion) throw new AuthError('CONFLICT');
    return row;
  }

  private async requireCategory(tx: Prisma.TransactionClient, categoryId: string) {
    if (
      !(await tx.serviceCategory.findUnique({ where: { id: categoryId }, select: { id: true } }))
    ) {
      throw new AuthError('VALIDATION_FAILED', 'categoryId');
    }
  }

  /** Only the fields that actually change; an update that changes nothing is rejected. */
  private changed<T extends object>(current: T, patch: Partial<T>): Partial<T> {
    const changes = Object.fromEntries(
      Object.entries(patch).filter(([key, value]) => current[key as keyof T] !== value),
    ) as Partial<T>;
    if (Object.keys(changes).length === 0) throw new AuthError('VALIDATION_FAILED');
    return changes;
  }

  private pick<T extends object>(current: T, changes: Partial<T>): Prisma.InputJsonObject {
    return Object.fromEntries(
      Object.keys(changes).map((key) => [key, current[key as keyof T] as Prisma.InputJsonValue]),
    ) as Prisma.InputJsonObject;
  }

  private audit(
    context: AdminContext,
    action: string,
    entityType: string,
    entityId: string,
    detail: {
      branchId?: string;
      reason: string | null;
      before?: Prisma.InputJsonObject;
      after: Prisma.InputJsonObject;
    },
  ): Promise<void> {
    return appendAdminAudit(context, {
      action,
      entityType,
      entityId,
      // Master-data events are global (null branch); availability names its branch.
      branchId: detail.branchId ?? null,
      reason: detail.reason,
      ...(detail.before ? { before: detail.before } : {}),
      after: detail.after,
    });
  }
}
