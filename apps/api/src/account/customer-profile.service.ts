import type { CustomerProfileResponse, CustomerProfileUpdateRequest } from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable } from '@nestjs/common';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { REGISTRATION_LIMITS, text } from '../auth/registration.js';
import { SessionService } from '../auth/session.service.js';
import { runCustomerCommand, type CustomerContext } from '../booking/customer-command.js';

const profileSelect = {
  id: true,
  kind: true,
  fullName: true,
  preferredLocale: true,
  phoneCanonical: true,
  emailDelivery: true,
  emailVerifiedAt: true,
  rowVersion: true,
  customerProfile: { select: { dateOfBirth: true } },
} satisfies Prisma.UserSelect;

type ProfileRecord = Prisma.UserGetPayload<{ select: typeof profileSelect }>;

/** A calendar date stored as `date`: read it back in UTC, never through a timezone. */
export const dateOnly = (value: Date): string => value.toISOString().slice(0, 10);

/** The response for one loaded customer row (pure: nothing here reads the database). */
export function presentCustomerProfile(user: ProfileRecord): CustomerProfileResponse {
  const dateOfBirth =
    user.customerProfile === null ? null : dateOnly(user.customerProfile.dateOfBirth);
  return {
    fullName: user.fullName,
    // A customer signs in by email, so it is always on file; an unverified one cannot sign in at all.
    email: { address: user.emailDelivery ?? '', verified: user.emailVerifiedAt !== null },
    phone: user.phoneCanonical,
    dateOfBirth,
    dateOfBirthLocked: dateOfBirth !== null,
    locale: user.preferredLocale,
    version: user.rowVersion,
  };
}

/**
 * The signed-in customer's own profile (session 7b). The session is the only identity: no customer id is accepted. Only the
 * name is written here: the phone is the customer key, the birthday protects the birthday gift (staff only), and the email
 * changes through the verified flow shared with staff (`EmailChangeService`).
 */
@Injectable()
export class CustomerProfileService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<SessionService, 'withTransaction' | 'resolveForMutation'>,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  get(token: string | undefined): Promise<CustomerProfileResponse> {
    return this.run(token, undefined, async ({ tx, customerUserId }) =>
      presentCustomerProfile(await this.load(tx, customerUserId)),
    );
  }

  update(
    token: string | undefined,
    input: CustomerProfileUpdateRequest,
    requestId?: string,
  ): Promise<CustomerProfileResponse> {
    return this.run(token, requestId, async (context) => {
      const { tx, customerUserId } = context;
      // Same limits as registration; checked after the session, so a stranger learns nothing from the answer.
      const fullName = text(input.fullName, 'fullName', REGISTRATION_LIMITS.fullNameMaxCodePoints);
      const before = await this.load(tx, customerUserId);
      if (before.rowVersion !== input.expectedVersion) throw new AuthError('CONFLICT');
      // Saving the same name again changes nothing: no new version, no audit row.
      if (before.fullName === fullName) return presentCustomerProfile(before);
      await tx.user.update({
        where: { id: customerUserId },
        data: { fullName, rowVersion: { increment: 1 } },
        select: { id: true },
      });
      await this.audit(context);
      return presentCustomerProfile(await this.load(tx, customerUserId));
    });
  }

  private run<T>(
    token: string | undefined,
    requestId: string | undefined,
    work: (context: CustomerContext) => Promise<T>,
  ): Promise<T> {
    return runCustomerCommand({ sessions: this.sessions, throttle: this.throttle }, token, work, {
      requestId,
    });
  }

  private async load(tx: Prisma.TransactionClient, userId: string): Promise<ProfileRecord> {
    const user = await tx.user.findUnique({ where: { id: userId }, select: profileSelect });
    if (user?.kind !== 'CUSTOMER') throw new AuthError('FORBIDDEN');
    return user;
  }

  private async audit(context: CustomerContext): Promise<void> {
    await context.tx.auditEvent.create({
      data: {
        action: 'PROFILE_UPDATED',
        actorKind: 'USER',
        actorUserId: context.customerUserId,
        subjectUserId: context.customerUserId,
        entityType: 'User',
        entityId: context.customerUserId,
        branchId: null,
        requestId: context.requestId,
        occurredAt: context.now,
        reason: null,
        // Field names only; values are not copied into permanent history.
        after: { fields: ['fullName'], via: 'MY_PROFILE' },
        dataClassification: 'STANDARD',
      },
      select: { id: true },
    });
  }
}
