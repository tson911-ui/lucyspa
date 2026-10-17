import { randomBytes } from 'node:crypto';
import type { Prisma } from '@lucy-spa/database';
import {
  ACCOUNT_DELETION_EMAIL_EVENT_TYPE,
  AuthEmailSendError,
  DELIVERY_POLICY,
  ERASED_DELIVERY,
  accountDeletionEmailBinding,
  openDeliveryPayload,
  parseAccountDeletionEmailEnvelope,
  type AccountDeletionEmailLocale,
  type AuthTransactionRunner,
  type DeliveryOutcome,
  type NoticeEmailTransport,
} from '@lucy-spa/server';

/**
 * Session 10 A2: the confirmation email of a deleted customer account. The body states the fact and the date only: no name, phone,
 * points, orders or link (the account no longer exists, and a link in an unexpected email is what phishing looks like).
 */

export interface RenderedNotice {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** `16/10/2026` in Vietnam time, where the spa operates. */
function day(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('day')}/${part('month')}/${part('year')}`;
}

const copy = {
  vi: {
    subject: 'Lucy Spa – Tài khoản của bạn đã được xóa',
    done: (date: string) => `Tài khoản Lucy Spa dùng email này đã được xóa vào ngày ${date}.`,
    removed:
      'Thông tin đăng nhập, họ tên, số điện thoại, ngày sinh và địa chỉ đã lưu của bạn đã được xóa. Điểm thưởng và các lịch hẹn sắp tới không còn.',
    kept: 'Hóa đơn và thanh toán trước đây được Lucy Spa lưu giữ theo quy định về kế toán, không còn gắn với tên của bạn.',
    notYou:
      'Nếu bạn không yêu cầu xóa tài khoản, hãy liên hệ Lucy Spa qua số điện thoại của tiệm càng sớm càng tốt.',
  },
  en: {
    subject: 'Lucy Spa – Your account was deleted',
    done: (date: string) => `The Lucy Spa account that used this email was deleted on ${date}.`,
    removed:
      'Your sign-in details, name, phone number, date of birth and saved addresses were deleted. Your points and upcoming bookings are gone.',
    kept: 'Past invoices and payments are kept by Lucy Spa as accounting law requires, no longer linked to your name.',
    notYou: 'If you did not ask for this, contact Lucy Spa by phone as soon as possible.',
  },
} as const;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Plain text plus a self-contained HTML alternative (inline styles only, no images, links or remote assets), like the auth emails. */
export function renderAccountDeletedEmail(
  locale: AccountDeletionEmailLocale,
  deletedAt: Date,
): RenderedNotice {
  const text = copy[locale];
  const paragraphs = [text.done(day(deletedAt)), text.removed, text.kept, text.notYou];
  const font = "font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;";
  const paragraph = (value: string) =>
    `<p style="margin:0 0 16px 0;${font}font-size:15px;line-height:22px;color:#333333;">${escapeHtml(value)}</p>`;
  return {
    subject: text.subject,
    text: [...paragraphs.flatMap((value) => [value, '']), 'Lucy Spa'].join('\n'),
    html: [
      '<!DOCTYPE html>',
      `<html lang="${locale}">`,
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${escapeHtml(text.subject)}</title>`,
      '</head>',
      '<body style="margin:0;padding:0;background-color:#f5f5f7;">',
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f5f7;">',
      '<tr><td align="center" style="padding:32px 16px;">',
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#ffffff;border-radius:8px;">',
      `<tr><td style="padding:24px 32px 8px 32px;${font}font-size:20px;font-weight:700;color:#782b37;">LUCY SPA</td></tr>`,
      '<tr><td style="padding:16px 32px 8px 32px;">',
      ...paragraphs.map(paragraph),
      '</td></tr>',
      '</table>',
      '</td></tr>',
      '</table>',
      '</body>',
      '</html>',
    ].join('\n'),
  };
}

async function databaseNow(transaction: Prisma.TransactionClient): Promise<Date> {
  const rows = await transaction.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  const now = rows[0]?.now;
  if (!(now instanceof Date)) throw new Error('Database clock unavailable.');
  return now;
}

/**
 * Sends one sealed row by id, with the auth emails' semantics: claim and completion are short transactions, the provider call happens
 * outside them under a lease, retries back off and stop at the row's deadline, and the ciphertext is erased whenever the row leaves
 * PENDING. Only the id and an outcome ever leave this class.
 */
export class AccountDeletionEmailProcessor {
  constructor(
    private readonly transactions: AuthTransactionRunner,
    private readonly keys: { readonly deliveryKeys?: ReadonlyMap<number, Uint8Array> | undefined },
    private readonly transport: NoticeEmailTransport,
  ) {}

  async deliver(emailId: string): Promise<DeliveryOutcome> {
    const claimed = await this.transactions.withTransaction((tx) => this.claim(tx, emailId));
    if (typeof claimed === 'string') return claimed;
    let providerMessageId: string | null = null;
    let failure: { safeCode: string; permanent: boolean } | null = null;
    try {
      const result = await this.transport.send(claimed.message, emailId);
      providerMessageId =
        typeof result.providerMessageId === 'string'
          ? result.providerMessageId.slice(0, 256)
          : null;
    } catch (error) {
      // Provider errors may echo the recipient; keep only a safe classification.
      failure =
        error instanceof AuthEmailSendError
          ? { safeCode: error.safeCode, permanent: error.permanent }
          : { safeCode: 'PROVIDER_UNAVAILABLE', permanent: false };
    }
    return this.transactions.withTransaction((tx) =>
      this.complete(tx, emailId, claimed.leaseToken, failure, providerMessageId),
    );
  }

  private async claim(
    tx: Prisma.TransactionClient,
    emailId: string,
  ): Promise<DeliveryOutcome | { message: RenderedNotice & { to: string }; leaseToken: Buffer }> {
    await tx.$queryRaw`SELECT id FROM account_deletion_emails WHERE id = ${emailId}::uuid FOR UPDATE`;
    const row = await tx.accountDeletionEmail.findUnique({ where: { id: emailId } });
    const now = await databaseNow(tx);
    if (
      !row ||
      row.state !== 'PENDING' ||
      row.nextAttemptAt > now ||
      (row.leaseUntil !== null && row.leaseUntil > now)
    ) {
      return 'SKIPPED';
    }
    if (now >= row.expiresAt) {
      await this.finish(tx, emailId, { state: 'EXPIRED' });
      return 'EXPIRED';
    }
    const key = row.keyVersion === null ? undefined : this.keys.deliveryKeys?.get(row.keyVersion);
    const plaintext =
      key && row.encryptedPayload && row.nonce && row.tag
        ? openDeliveryPayload(
            {
              ciphertext: Buffer.from(row.encryptedPayload),
              nonce: Buffer.from(row.nonce),
              tag: Buffer.from(row.tag),
            },
            accountDeletionEmailBinding(emailId),
            key,
          )
        : null;
    const envelope = plaintext === null ? null : parseAccountDeletionEmailEnvelope(plaintext);
    if (envelope === null) {
      await this.finish(tx, emailId, { state: 'FAILED', safeErrorCode: 'PAYLOAD_UNAVAILABLE' });
      return 'FAILED';
    }
    const leaseToken = randomBytes(32);
    await tx.accountDeletionEmail.update({
      where: { id: emailId },
      data: {
        attempts: { increment: 1 },
        leaseToken: new Uint8Array(leaseToken),
        leaseUntil: new Date(
          Math.min(now.getTime() + DELIVERY_POLICY.leaseMs, row.expiresAt.getTime()),
        ),
      },
      select: { id: true },
    });
    return {
      leaseToken,
      message: {
        to: envelope.to,
        ...renderAccountDeletedEmail(envelope.locale, new Date(envelope.deletedAt)),
      },
    };
  }

  private async complete(
    tx: Prisma.TransactionClient,
    emailId: string,
    leaseToken: Buffer,
    failure: { safeCode: string; permanent: boolean } | null,
    providerMessageId: string | null,
  ): Promise<DeliveryOutcome> {
    await tx.$queryRaw`SELECT id FROM account_deletion_emails WHERE id = ${emailId}::uuid FOR UPDATE`;
    const row = await tx.accountDeletionEmail.findUnique({
      where: { id: emailId },
      select: { state: true, leaseToken: true, attempts: true, expiresAt: true },
    });
    if (
      !row ||
      row.state !== 'PENDING' ||
      !row.leaseToken ||
      !leaseToken.equals(Buffer.from(row.leaseToken))
    ) {
      return 'SKIPPED';
    }
    const now = await databaseNow(tx);
    if (failure === null) {
      await this.finish(tx, emailId, { state: 'DELIVERED', deliveredAt: now, providerMessageId });
      return 'DELIVERED';
    }
    const retryAt = new Date(now.getTime() + DELIVERY_POLICY.retryBaseMs * 2 ** (row.attempts - 1));
    if (
      failure.permanent ||
      row.attempts >= DELIVERY_POLICY.maxAttempts ||
      retryAt >= row.expiresAt
    ) {
      await this.finish(tx, emailId, {
        state: 'FAILED',
        safeErrorCode: failure.permanent ? failure.safeCode : 'RETRIES_EXHAUSTED',
      });
      return 'FAILED';
    }
    await tx.accountDeletionEmail.update({
      where: { id: emailId },
      data: { leaseToken: null, leaseUntil: null, nextAttemptAt: retryAt },
      select: { id: true },
    });
    return 'RETRY_SCHEDULED';
  }

  private async finish(
    tx: Prisma.TransactionClient,
    emailId: string,
    data: Prisma.AccountDeletionEmailUpdateInput,
  ): Promise<void> {
    await tx.accountDeletionEmail.update({
      where: { id: emailId },
      data: { ...data, ...ERASED_DELIVERY },
      select: { id: true },
    });
  }
}

/**
 * Polls due rows through the claim index and sends each one; a row that leaves PENDING marks its outbox event published. Returns the
 * number examined and the outcomes (counts only).
 */
export async function dispatchAccountDeletionEmails(
  client: {
    $queryRaw: Prisma.TransactionClient['$queryRaw'];
    outboxEvent: Pick<Prisma.TransactionClient['outboxEvent'], 'updateMany'>;
  },
  processor: Pick<AccountDeletionEmailProcessor, 'deliver'>,
  limit: number,
): Promise<{ examined: number; outcomes: Record<DeliveryOutcome, number> }> {
  const due = await client.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM account_deletion_emails
    WHERE state = 'PENDING'
      AND next_attempt_at <= clock_timestamp()
      AND (lease_until IS NULL OR lease_until <= clock_timestamp())
    ORDER BY next_attempt_at, id
    LIMIT ${limit}`;
  const outcomes: Record<DeliveryOutcome, number> = {
    DELIVERED: 0,
    RETRY_SCHEDULED: 0,
    FAILED: 0,
    INVALIDATED: 0,
    EXPIRED: 0,
    SKIPPED: 0,
  };
  for (const { id } of due) {
    const outcome = await processor.deliver(id);
    outcomes[outcome] += 1;
    if (outcome !== 'RETRY_SCHEDULED' && outcome !== 'SKIPPED') {
      await client.outboxEvent.updateMany({
        where: {
          aggregateType: 'AccountDeletionEmail',
          aggregateId: id,
          eventType: ACCOUNT_DELETION_EMAIL_EVENT_TYPE,
          publishedAt: null,
        },
        data: { publishedAt: new Date() },
      });
    }
  }
  return { examined: due.length, outcomes };
}
