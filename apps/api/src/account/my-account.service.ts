import type { MyAccountProfileUpdateRequest, MyAccountResponse } from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { normalizeProfilePatch } from '../employees/employee.input.js';
import { day } from '../employees/employment.js';
import { writeProfile } from '../employees/profile.js';
import { currentClassification, titleOfEmployee } from '../employees/workforce-title.js';

const accountSelect = {
  id: true,
  kind: true,
  status: true,
  fullName: true,
  preferredLocale: true,
  phoneCanonical: true,
  emailDelivery: true,
  emailVerifiedAt: true,
  rowVersion: true,
  employeeProfile: {
    select: {
      employeeCodeCanonical: true,
      dateOfBirth: true,
      address: true,
      branchAssignments: {
        where: { revokedAt: null },
        select: { branch: { select: { id: true, code: true, name: true } } },
        orderBy: { branchId: 'asc' },
      },
      skills: {
        where: { revokedAt: null },
        select: { skill: { select: { id: true, code: true, nameVi: true, nameEn: true } } },
        orderBy: { grantedAt: 'asc' },
      },
    },
  },
} satisfies Prisma.UserSelect;

type AccountRecord = Prisma.UserGetPayload<{ select: typeof accountSelect }>;

/**
 * "Tài khoản của tôi / My Account": the signed-in workforce account's own view and
 * self-edit over the SAME `users` / `employee_profiles` rows that employee detail reads and
 * writes (one shared write path, `writeProfile`). The subject is always the session's user;
 * no target ID is accepted, so another account can never be read or changed here.
 * Customers are refused by the admin command frame.
 */
@Injectable()
export class MyAccountService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  async get(sessionToken: string | undefined): Promise<MyAccountResponse> {
    return this.run(sessionToken, undefined, ({ tx, actor }) => this.present(tx, actor.userId));
  }

  /**
   * Allowlisted fields only (name, phone, date of birth, address, language); anything else
   * is rejected by the DTO. Audited as PROFILE_UPDATED with actor = subject, field names only.
   */
  async updateProfile(
    sessionToken: string | undefined,
    input: MyAccountProfileUpdateRequest,
    requestId?: string,
  ): Promise<MyAccountResponse> {
    const patch = normalizeProfilePatch(input);
    return this.run(sessionToken, requestId, async (context) => {
      const { tx, actor } = context;
      const self = await this.load(tx, actor.userId);
      if (self.rowVersion !== input.expectedVersion) throw new AuthError('CONFLICT');
      const fields = await writeProfile(tx, self.id, patch, self.employeeProfile !== null);
      await this.audit(context, self, fields);
      return this.present(tx, self.id);
    });
  }

  private run<T>(
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

  private async load(tx: Prisma.TransactionClient, userId: string): Promise<AccountRecord> {
    const user = await tx.user.findUnique({ where: { id: userId }, select: accountSelect });
    // The Owner never has an employee profile; an employee always has one.
    if (
      !user ||
      !(
        (user.kind === 'OWNER' && user.employeeProfile === null) ||
        (user.kind === 'EMPLOYEE' && user.employeeProfile !== null)
      )
    ) {
      throw new AuthError('FORBIDDEN');
    }
    return user;
  }

  private async present(tx: Prisma.TransactionClient, userId: string): Promise<MyAccountResponse> {
    const user = await this.load(tx, userId);
    const profile = user.employeeProfile;
    const branchIds = profile?.branchAssignments.map((row) => row.branch.id) ?? [];
    return {
      id: user.id,
      kind: user.kind === 'OWNER' ? 'OWNER' : 'EMPLOYEE',
      fullName: user.fullName,
      phone: user.phoneCanonical,
      email: user.emailDelivery
        ? { address: user.emailDelivery, verified: user.emailVerifiedAt !== null }
        : null,
      locale: user.preferredLocale,
      status: user.status,
      title: profile ? await titleOfEmployee(tx, user.id, branchIds) : 'OWNER',
      employee: profile
        ? {
            employeeId: profile.employeeCodeCanonical,
            dateOfBirth: day(profile.dateOfBirth),
            address: profile.address,
            classification: await currentClassification(tx, user.id, branchIds),
            branches: profile.branchAssignments.map((row) => row.branch),
            skills: profile.skills.map((row) => row.skill),
          }
        : null,
      version: user.rowVersion,
    };
  }

  private async audit(context: AdminContext, self: AccountRecord, fields: string[]): Promise<void> {
    const branchIds = self.employeeProfile?.branchAssignments.map((row) => row.branch.id) ?? [];
    await context.tx.auditEvent.create({
      data: {
        action: 'PROFILE_UPDATED',
        actorKind: 'USER',
        actorUserId: self.id,
        subjectUserId: self.id,
        entityType: 'User',
        entityId: self.id,
        branchId: branchIds.length === 1 ? (branchIds[0] ?? null) : null,
        requestId: context.requestId,
        occurredAt: context.now,
        reason: null,
        // Field names only; values are not copied into permanent history.
        after: { fields, via: 'MY_ACCOUNT' },
        dataClassification: 'STANDARD',
      },
      select: { id: true },
    });
  }
}
