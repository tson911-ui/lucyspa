import { AuthError } from '../auth/auth.error.js';
import { hasFreshReauthentication } from '../auth/session.policy.js';
import type { AdminContext } from '../authorization/admin-command.js';

/**
 * Phase 7 (P7-T12): the fresh password confirmation of a money action. One confirmation covers ONE action, whatever the action (the
 * refund rule, Owner 2026-10-08 P13-3, generalised): it must be recent (`freshAuthSeconds`) and unused. It is spent in the same
 * transaction by `spendConfirmation`; the database also refuses a second use and any confirmation a refund already spent.
 */
export type ConfirmationPurpose =
  | 'FINANCE_GO_LIVE'
  | 'CASH_OPENING'
  | 'CASH_WITHDRAWAL'
  | 'CASH_TRANSFER'
  | 'CASH_CLOSING'
  | 'PAYROLL_CLOSE'
  | 'PAYROLL_PAY'
  | 'ADVANCE_PAY'
  | 'ADVANCE_WRITE_OFF';

export async function takeFreshConfirmation(
  context: AdminContext,
  freshAuthSeconds: number,
): Promise<Date> {
  const confirmedAt = context.actor.principal.reauthenticatedAt;
  if (
    confirmedAt === null ||
    !hasFreshReauthentication(context.actor.principal, context.now, freshAuthSeconds)
  ) {
    throw new AuthError('REAUTHENTICATION_REQUIRED');
  }
  const key = { actorUserId: context.actor.userId, reauthenticatedAt: confirmedAt };
  const [other, refund] = await Promise.all([
    context.tx.reauthUse.findUnique({
      where: { actorUserId_reauthenticatedAt: key },
      select: { actorUserId: true },
    }),
    context.tx.refundReauthenticationUse.findUnique({
      where: { actorUserId_reauthenticatedAt: key },
      select: { actorUserId: true },
    }),
  ]);
  if (other || refund) throw new AuthError('REAUTHENTICATION_REQUIRED');
  return confirmedAt;
}

export async function spendConfirmation(
  context: AdminContext,
  confirmedAt: Date,
  purpose: ConfirmationPurpose,
  subjectId: string | null,
): Promise<void> {
  await context.tx.reauthUse.create({
    data: {
      actorUserId: context.actor.userId,
      reauthenticatedAt: confirmedAt,
      purpose,
      subjectId,
    },
    select: { actorUserId: true },
  });
}
