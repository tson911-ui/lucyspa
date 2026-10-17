import type { AccountDeletionCheckResponse } from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable } from '@nestjs/common';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { LoginService } from '../auth/login.service.js';
import { requireDeliveryKey } from '../auth/otp-flow.js';
import { SessionService } from '../auth/session.service.js';
import { runCustomerCommand } from '../booking/customer-command.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { deletionFacts, eraseCustomerAccount } from './account-deletion.core.js';

const accountSelect = {
  id: true,
  kind: true,
  status: true,
  deletedAt: true,
  emailDelivery: true,
  passwordHash: true,
  credentialVersion: true,
  preferredLocale: true,
} satisfies Prisma.UserSelect;

/**
 * Session 10 A2: "Xóa tài khoản", the signed-in customer's own account deletion. The session is the only identity (no customer id
 * is accepted). The check is read only; the deletion proves the current password first (the shared reauthentication budgets), then,
 * in one transaction under the user's row lock, re-checks the blockers, erases the account and queues the confirmation email.
 */
@Injectable()
export class AccountDeletionService {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(SessionService)
    private readonly sessions: Pick<SessionService, 'withTransaction' | 'resolveForMutation'>,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
    @Inject(LoginService) private readonly logins: Pick<LoginService, 'proveCurrentPassword'>,
  ) {}

  check(token: string | undefined): Promise<AccountDeletionCheckResponse> {
    return runCustomerCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      async ({ tx, now, customerUserId }) => {
        await this.account(tx, customerUserId);
        return (await deletionFacts(tx, customerUserId, now)).response;
      },
    );
  }

  /**
   * Wrong password: one generic AUTHENTICATION_FAILED (budgets debited, nothing changed). A blocker that appeared since the check:
   * ACCOUNT_DELETION_BLOCKED and nothing changed. Success: the account is erased and every session of it is revoked, this one too.
   */
  async delete(
    token: string | undefined,
    currentPassword: string,
    peer: string,
    requestId?: string,
  ): Promise<void> {
    if (token === undefined) throw new AuthError('AUTHENTICATION_REQUIRED');
    // The confirmation email is sealed in the same transaction: without the key ring nothing is deleted.
    requireDeliveryKey(this.environment.auth);
    const proof = await this.logins.proveCurrentPassword(token, currentPassword, peer, {
      allowCustomer: true,
    });
    await runCustomerCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      async ({ tx, now, customerUserId, requestId: request }) => {
        if (customerUserId !== proof.userId) throw new AuthError('AUTHENTICATION_REQUIRED');
        const user = await this.account(tx, customerUserId);
        // The proof must still describe the stored credential (a password changed meanwhile ends here).
        if (
          user.passwordHash !== proof.evidenceHash ||
          user.credentialVersion !== proof.user.credentialVersion
        ) {
          throw new AuthError('AUTHENTICATION_REQUIRED');
        }
        const facts = await deletionFacts(tx, customerUserId, now);
        if (!facts.response.canDelete) throw new AuthError('ACCOUNT_DELETION_BLOCKED');
        const summary = await eraseCustomerAccount(tx, {
          user: {
            id: user.id,
            emailDelivery: user.emailDelivery,
            preferredLocale: user.preferredLocale,
          },
          bookingsToCancel: facts.bookingsToCancel,
          now,
          auth: this.environment.auth,
        });
        // Ids and counts only: no name, phone, email, password or hash is copied into permanent history.
        await tx.auditEvent.create({
          data: {
            action: 'CUSTOMER_ACCOUNT_DELETED',
            actorKind: 'USER',
            actorUserId: customerUserId,
            subjectUserId: customerUserId,
            entityType: 'User',
            entityId: customerUserId,
            branchId: null,
            requestId: request,
            occurredAt: now,
            reason: null,
            after: { via: 'SELF_SERVICE', ...summary },
            dataClassification: 'STANDARD',
          },
          select: { id: true },
        });
      },
      { requestId },
    );
  }

  private async account(tx: Prisma.TransactionClient, userId: string) {
    const user = await tx.user.findUnique({ where: { id: userId }, select: accountSelect });
    if (user?.kind !== 'CUSTOMER') throw new AuthError('FORBIDDEN');
    if (user.status !== 'ACTIVE' || user.deletedAt !== null) {
      throw new AuthError('AUTHENTICATION_REQUIRED');
    }
    return user;
  }
}
