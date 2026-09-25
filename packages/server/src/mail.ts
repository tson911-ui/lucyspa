import { isIP } from 'node:net';
import { createTransport, type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import {
  AuthEmailSendError,
  type AuthEmailMessage,
  type AuthEmailTransport,
  type RenderedAuthEmail,
} from './auth-email.js';

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  /** STARTTLS on a plain port (587), or implicit TLS (465). Plaintext is never allowed. */
  readonly security: 'starttls' | 'tls';
  /** EHLO/HELO name; defaults to the sender domain. */
  readonly ehloName: string;
  readonly timeoutMs: number;
  readonly fromAddress: string;
  readonly fromName: string;
}

export type MailConfig =
  { readonly transport: 'disabled' } | ({ readonly transport: 'smtp' } & SmtpConfig);

const HOSTNAME =
  /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
// Sender identity is operator configuration: a plain ASCII mailbox is enough.
const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)$/;

function invalid(field: string): never {
  // Field names only; configuration values are never echoed.
  throw new Error(`Invalid email configuration: ${field}`);
}

function integer(
  env: NodeJS.ProcessEnv,
  field: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const input = env[field];
  if (input === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(input)) return invalid(field);
  const value = Number(input);
  return value >= min && value <= max ? value : invalid(field);
}

/**
 * Explicit, fail-closed mail configuration. `MAIL_TRANSPORT` must be set in production
 * (`smtp` or `disabled`); elsewhere it defaults to `disabled`. SMTP needs no username or
 * password: relays such as Google Workspace authenticate the sending IP.
 */
export function parseMailEnvironment(
  env: NodeJS.ProcessEnv,
  nodeEnv: 'development' | 'test' | 'production',
): MailConfig {
  const transport = env['MAIL_TRANSPORT'] ?? (nodeEnv === 'production' ? undefined : 'disabled');
  if (transport === 'disabled') return { transport };
  if (transport !== 'smtp') return invalid('MAIL_TRANSPORT');
  const host = env['SMTP_HOST'];
  if (host === undefined || !HOSTNAME.test(host)) return invalid('SMTP_HOST');
  const security = env['SMTP_SECURITY'] ?? 'starttls';
  if (security !== 'starttls' && security !== 'tls') return invalid('SMTP_SECURITY');
  const port = integer(env, 'SMTP_PORT', security === 'tls' ? 465 : 587, 1, 65_535);
  const fromAddress = env['MAIL_FROM_ADDRESS'];
  const sender = fromAddress === undefined ? null : ADDRESS.exec(fromAddress);
  if (!sender || fromAddress === undefined) return invalid('MAIL_FROM_ADDRESS');
  const fromName = env['MAIL_FROM_NAME'] ?? 'Lucy Spa';
  // Display name is a header value: no controls, quotes, angle brackets or line breaks.
  if (!/^[\p{L}\p{N} .,&'()-]{1,100}$/u.test(fromName) || fromName.trim() !== fromName) {
    return invalid('MAIL_FROM_NAME');
  }
  const ehloName = env['SMTP_EHLO_NAME'] ?? sender[1]!;
  if (!HOSTNAME.test(ehloName)) return invalid('SMTP_EHLO_NAME');
  return {
    transport,
    host,
    port,
    security,
    ehloName,
    timeoutMs: integer(env, 'SMTP_TIMEOUT_MS', 15_000, 1_000, 120_000),
    fromAddress,
    fromName,
  };
}

/** Maps provider failures to a safe code; the provider error itself is discarded. */
export function classifySmtpFailure(error: unknown): AuthEmailSendError {
  const responseCode = Reflect.get(Object(error), 'responseCode');
  const code = Reflect.get(Object(error), 'code');
  if (typeof responseCode === 'number' && responseCode >= 500 && responseCode < 600) {
    return new AuthEmailSendError('PROVIDER_REJECTED', true);
  }
  if (code === 'EENVELOPE') return new AuthEmailSendError('RECIPIENT_REJECTED', true);
  if (typeof responseCode === 'number' && responseCode >= 400 && responseCode < 500) {
    return new AuthEmailSendError('PROVIDER_DEFERRED', false);
  }
  return new AuthEmailSendError('PROVIDER_UNAVAILABLE', false);
}

/**
 * SMTP adapter (nodemailer). TLS is mandatory: STARTTLS is required on submission ports
 * and certificates are verified. No SMTP AUTH is configured. The delivery ID becomes the
 * stable Message-ID, so a retried send is recognizable as the same message. Nodemailer
 * logging is off; failures are rethrown as sanitized `AuthEmailSendError`s.
 */
export class SmtpAuthEmailTransport implements AuthEmailTransport {
  private readonly transporter: Transporter<SMTPTransport.SentMessageInfo>;
  private readonly domain: string;

  constructor(private readonly config: SmtpConfig) {
    this.domain = config.fromAddress.split('@')[1]!;
    this.transporter = createTransport({
      host: config.host,
      port: config.port,
      secure: config.security === 'tls',
      requireTLS: config.security === 'starttls',
      ignoreTLS: false,
      name: config.ehloName,
      connectionTimeout: config.timeoutMs,
      greetingTimeout: config.timeoutMs,
      socketTimeout: config.timeoutMs,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
      tls: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
        // SNI names a host, never an IP literal (RFC 6066).
        ...(isIP(config.host) === 0 ? { servername: config.host } : {}),
      },
    });
  }

  async send(
    message: AuthEmailMessage & RenderedAuthEmail,
    idempotencyKey: string,
  ): Promise<{ providerMessageId?: string }> {
    try {
      const info = await this.transporter.sendMail({
        from: { name: this.config.fromName, address: this.config.fromAddress },
        to: message.to,
        subject: message.subject,
        text: message.text,
        messageId: `<${idempotencyKey}.auth@${this.domain}>`,
        headers: { 'Auto-Submitted': 'auto-generated' },
      });
      return typeof info.messageId === 'string' ? { providerMessageId: info.messageId } : {};
    } catch (error) {
      throw classifySmtpFailure(error);
    }
  }

  close(): void {
    this.transporter.close();
  }
}

/** In-memory transport for tests and local runs; never sends and never logs. */
export class FakeAuthEmailTransport implements AuthEmailTransport {
  readonly sent: (AuthEmailMessage & RenderedAuthEmail & { idempotencyKey: string })[] = [];
  private failures: Error[] = [];

  /** Queue failures for the next sends (consumed in order). */
  failNext(...errors: Error[]): void {
    this.failures.push(...errors);
  }

  send(
    message: AuthEmailMessage & RenderedAuthEmail,
    idempotencyKey: string,
  ): Promise<{ providerMessageId?: string }> {
    const failure = this.failures.shift();
    if (failure) return Promise.reject(failure);
    this.sent.push({ ...message, idempotencyKey });
    return Promise.resolve({ providerMessageId: `fake-${this.sent.length}` });
  }
}
