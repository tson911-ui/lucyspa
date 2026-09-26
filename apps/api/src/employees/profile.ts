import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import type { ProfilePatch } from './employee.input.js';

/**
 * The single write path for a workforce member's profile, used by both management
 * (employee detail) and self-service (My Account). It writes the one authoritative copy:
 * `users` (name, phone, language) and `employee_profiles` (date of birth, address). There
 * is no second profile and nothing to synchronize.
 *
 * The Owner has no employee profile, so date of birth and address are refused for them.
 * Returns the changed field names (for audit; values are never copied into history).
 */
export async function writeProfile(
  tx: Prisma.TransactionClient,
  userId: string,
  patch: ProfilePatch,
  hasEmployeeProfile: boolean,
): Promise<string[]> {
  if (!hasEmployeeProfile) {
    if (patch.dateOfBirth !== undefined) throw new AuthError('VALIDATION_FAILED', 'dateOfBirth');
    if (patch.address !== undefined) throw new AuthError('VALIDATION_FAILED', 'address');
  }
  if (patch.phone !== undefined) {
    // Unique across all users (customers too); the refusal names no holder.
    const holder = await tx.user.findFirst({
      where: { phoneCanonical: patch.phone.phoneCanonical, id: { not: userId } },
      select: { id: true },
    });
    if (holder) throw new AuthError('CONFLICT', 'phone');
  }
  const profile = {
    ...(patch.dateOfBirth !== undefined ? { dateOfBirth: patch.dateOfBirth } : {}),
    ...(patch.address !== undefined ? { address: patch.address } : {}),
  };
  await tx.user.update({
    where: { id: userId },
    data: {
      ...(patch.fullName !== undefined ? { fullName: patch.fullName } : {}),
      ...(patch.phone !== undefined
        ? {
            phoneCanonical: patch.phone.phoneCanonical,
            normalizationVersion: patch.phone.normalizationVersion,
          }
        : {}),
      ...(patch.locale !== undefined ? { preferredLocale: patch.locale } : {}),
      rowVersion: { increment: 1 },
      ...(hasEmployeeProfile && Object.keys(profile).length > 0
        ? { employeeProfile: { update: profile } }
        : {}),
    },
    select: { id: true },
  });
  return Object.keys(patch).sort();
}
