import type { Prisma } from '@lucy-spa/database';
import { randomInt } from 'node:crypto';
import { officialOn } from './compensation.js';

/**
 * Staff referral codes (Phase 7 P7-10b; P7-T16). A code is six characters from an alphabet without the look-alikes (no 0, 1, I, O), stored
 * upper-case, so it is case-insensitive for the customer. It is unique for ever (a deactivated code is never given again).
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const STAFF_CODE_LENGTH = 6;
const SHAPE = /^[A-Z2-9]{6,12}$/;

export function generateStaffCode(): string {
  let code = '';
  for (let index = 0; index < STAFF_CODE_LENGTH; index += 1)
    code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** The code as stored (trimmed, upper-case, no inner spaces or dashes), or null when it cannot be a code at all. */
export function normalizeStaffCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value
    .normalize('NFC')
    .replace(/[\s-]+/g, '')
    .toUpperCase();
  return SHAPE.test(code) && !/[IO]/.test(code) ? code : null;
}

export interface ResolvedStaffCode {
  id: string;
  employeeUserId: string;
  code: string;
}

/**
 * The active code a customer typed, when its owner is an active OFFICIAL employee on `date` (a `YYYY-MM-DD` shop day); otherwise null. The
 * caller gives ONE answer for every failure (no hint whether the code exists, was switched off, or its owner left).
 */
export async function resolveStaffCode(
  tx: Prisma.TransactionClient,
  raw: unknown,
  date: string,
): Promise<ResolvedStaffCode | null> {
  const code = normalizeStaffCode(raw);
  if (code === null) return null;
  const row = await tx.employeeReferralCode.findFirst({
    where: { code, isActive: true, employee: { user: { status: 'ACTIVE' } } },
    select: { id: true, employeeUserId: true, code: true },
  });
  if (!row) return null;
  return (await officialOn(tx, [row.employeeUserId], date)).has(row.employeeUserId) ? row : null;
}
