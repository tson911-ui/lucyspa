import type { DeliveryBinding } from './delivery-crypto.js';

/**
 * Session 10 A2: the confirmation email of a deleted customer account, shared by the API (which seals it inside the deletion
 * transaction) and the worker (which sends it). The address exists only in the sealed payload of `account_deletion_emails` (the same
 * AES-GCM key ring as the auth emails); the outbox event carries the row id only, so no plaintext copy of the erased address is kept.
 */
export const ACCOUNT_DELETION_EMAIL_EVENT_TYPE = 'account.deletion_email.requested';
export const ACCOUNT_DELETION_EMAIL_EVENT_VERSION = 1;

/** How long the worker may keep trying (the row's `expires_at`). */
export const ACCOUNT_DELETION_EMAIL_LIFETIME_MS = 24 * 60 * 60 * 1_000;

export type AccountDeletionEmailLocale = 'vi' | 'en';

/** The only plaintext ever sealed: where to send, in which language, and when the account was deleted. */
export interface AccountDeletionEmailEnvelope {
  v: 1;
  kind: 'ACCOUNT_DELETED';
  to: string;
  locale: AccountDeletionEmailLocale;
  /** ISO instant of the deletion. */
  deletedAt: string;
}

/**
 * The authenticated context of one sealed row. The row id stands in for both the delivery and the challenge of the auth binding, so a
 * payload sealed for one row never opens for another row or for an auth delivery.
 */
export function accountDeletionEmailBinding(emailId: string): DeliveryBinding {
  return { deliveryId: emailId, challengeId: `account-deletion:${emailId}`, generation: 1 };
}

export function parseAccountDeletionEmailEnvelope(
  plaintext: string,
): AccountDeletionEmailEnvelope | null {
  try {
    const value = JSON.parse(plaintext) as Partial<AccountDeletionEmailEnvelope>;
    return value.v === 1 &&
      value.kind === 'ACCOUNT_DELETED' &&
      typeof value.to === 'string' &&
      value.to.includes('@') &&
      (value.locale === 'vi' || value.locale === 'en') &&
      typeof value.deletedAt === 'string' &&
      !Number.isNaN(Date.parse(value.deletedAt))
      ? (value as AccountDeletionEmailEnvelope)
      : null;
  } catch {
    return null;
  }
}

/** A sender that needs only the address and the rendered message (the SMTP auth transport fits). */
export interface NoticeEmailTransport {
  send(
    message: { to: string; subject: string; text: string; html: string },
    idempotencyKey: string,
  ): Promise<{ providerMessageId?: string }>;
}
