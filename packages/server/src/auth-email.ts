/** Email-OTP purposes that carry a code. EMPLOYEE_SETUP capabilities are never emailed. */
export type AuthEmailPurpose =
  'ACTIVATE_CUSTOMER' | 'RESET_PASSWORD' | 'VERIFY_RECOVERY_EMAIL' | 'CHANGE_EMAIL';

export type AuthEmailLocale = 'vi' | 'en';

/** Only the recipient and code needed for sending; decrypted by the delivery processor. */
export interface AuthEmailEnvelope {
  v: 1;
  purpose: AuthEmailPurpose;
  to: string;
  code: string;
  locale: AuthEmailLocale;
}

export interface AuthEmailMessage {
  readonly deliveryId: string;
  readonly purpose: AuthEmailPurpose;
  readonly to: string;
  readonly code: string;
  readonly locale: AuthEmailLocale;
  /** The code's own deadline (delivery expiry = code expiry). */
  readonly expiresAt: Date;
}

export interface RenderedAuthEmail {
  readonly subject: string;
  /** Plain-text alternative; always present. */
  readonly text: string;
  /** Self-contained HTML alternative: inline styles only, no external assets. */
  readonly html: string;
}

/**
 * Provider port. Adapters pass `idempotencyKey` to the provider where supported, never
 * log the message, and throw `AuthEmailSendError` (or any error, treated as transient)
 * on failure. Errors must not carry the recipient, code or rendered content.
 */
export interface AuthEmailTransport {
  send(
    message: AuthEmailMessage & RenderedAuthEmail,
    idempotencyKey: string,
  ): Promise<{ providerMessageId?: string }>;
}

/** Sanitized provider failure: a stable safe code and whether retrying can help. */
export class AuthEmailSendError extends Error {
  constructor(
    readonly safeCode: string,
    readonly permanent: boolean,
  ) {
    super(`Email provider failure: ${safeCode}`);
    this.name = 'AuthEmailSendError';
  }
}

export function parseAuthEmailEnvelope(plaintext: string): AuthEmailEnvelope | null {
  try {
    const value = JSON.parse(plaintext) as Partial<AuthEmailEnvelope>;
    return value.v === 1 &&
      (value.purpose === 'ACTIVATE_CUSTOMER' ||
        value.purpose === 'RESET_PASSWORD' ||
        value.purpose === 'VERIFY_RECOVERY_EMAIL' ||
        value.purpose === 'CHANGE_EMAIL') &&
      typeof value.to === 'string' &&
      typeof value.code === 'string' &&
      /^[0-9]{6}$/.test(value.code) &&
      (value.locale === 'vi' || value.locale === 'en')
      ? (value as AuthEmailEnvelope)
      : null;
  } catch {
    return null;
  }
}

/** Deadline shown in Vietnam time, where the spa operates, e.g. `14:35, 25/09/2026`. */
function deadline(expiresAt: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(expiresAt);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('hour')}:${part('minute')}, ${part('day')}/${part('month')}/${part('year')}`;
}

const copy = {
  ACTIVATE_CUSTOMER: {
    vi: {
      subject: 'Lucy Spa – Mã xác minh đăng ký tài khoản',
      purpose: 'Bạn (hoặc ai đó) vừa đăng ký tài khoản khách hàng Lucy Spa bằng địa chỉ email này.',
      use: 'Nhập mã sau để xác minh email và kích hoạt tài khoản:',
      ignore: 'Nếu bạn không đăng ký, hãy bỏ qua email này; sẽ không có tài khoản nào được tạo.',
    },
    en: {
      subject: 'Lucy Spa – Your account verification code',
      purpose:
        'You (or someone else) just signed up for a Lucy Spa customer account with this email address.',
      use: 'Enter this code to verify your email and activate the account:',
      ignore: 'If you did not sign up, ignore this email; no account will be created.',
    },
  },
  RESET_PASSWORD: {
    vi: {
      subject: 'Lucy Spa – Mã đặt lại mật khẩu',
      purpose:
        'Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản Lucy Spa dùng email này.',
      use: 'Nhập mã sau để đặt mật khẩu mới:',
      ignore:
        'Nếu bạn không yêu cầu, hãy bỏ qua email này; mật khẩu hiện tại của bạn không thay đổi.',
    },
    en: {
      subject: 'Lucy Spa – Your password reset code',
      purpose:
        'We received a request to reset the password of the Lucy Spa account that uses this email.',
      use: 'Enter this code to choose a new password:',
      ignore: 'If you did not request this, ignore this email; your current password is unchanged.',
    },
  },
  VERIFY_RECOVERY_EMAIL: {
    vi: {
      subject: 'Lucy Spa – Mã xác minh email khôi phục tài khoản nhân sự',
      purpose:
        'Tài khoản nhân sự Lucy Spa của bạn đang xác minh email này làm email khôi phục mật khẩu.',
      use: 'Nhập mã sau khi đang đăng nhập để xác nhận email:',
      ignore: 'Nếu bạn không yêu cầu, hãy bỏ qua email này và báo cho quản lý của bạn.',
    },
    en: {
      subject: 'Lucy Spa – Verify your staff recovery email',
      purpose:
        'Your Lucy Spa staff account is verifying this address as its password recovery email.',
      use: 'Enter this code while signed in to confirm the address:',
      ignore: 'If you did not request this, ignore this email and tell your manager.',
    },
  },
  CHANGE_EMAIL: {
    vi: {
      subject: 'Lucy Spa – Mã xác minh đổi email tài khoản',
      purpose:
        'Một tài khoản nhân sự Lucy Spa đang yêu cầu đổi email đăng nhập/khôi phục sang địa chỉ này.',
      use: 'Nhập mã sau trong mục “Tài khoản của tôi” khi đang đăng nhập để hoàn tất việc đổi email:',
      ignore: 'Nếu bạn không yêu cầu, hãy bỏ qua email này; email của tài khoản sẽ không thay đổi.',
    },
    en: {
      subject: 'Lucy Spa – Confirm your new account email',
      purpose:
        'A Lucy Spa staff account asked to change its sign-in and recovery email to this address.',
      use: 'Enter this code in “My Account” while signed in to finish changing the email:',
      ignore: 'If you did not request this, ignore this email; the account email will not change.',
    },
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

const CODE_LABEL = { vi: 'Mã xác minh của bạn', en: 'Your verification code' } as const;

/**
 * Table layout with inline styles only (no <style>, scripts, images, links or remote
 * assets) for broad email-client support. The code is large, bold and centered.
 */
function renderHtml(
  message: AuthEmailMessage,
  parts: {
    subject: string;
    purpose: string;
    use: string;
    expiry: string;
    ignore: string;
    never: string;
  },
): string {
  const font = "font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;";
  const paragraph = (value: string) =>
    `<p style="margin:0 0 16px 0;${font}font-size:15px;line-height:22px;color:#333333;">${escapeHtml(value)}</p>`;
  return [
    '<!DOCTYPE html>',
    `<html lang="${message.locale}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(parts.subject)}</title>`,
    '</head>',
    '<body style="margin:0;padding:0;background-color:#f4f1ec;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f1ec;">',
    '<tr><td align="center" style="padding:32px 16px;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#ffffff;border-radius:8px;">',
    `<tr><td style="padding:24px 32px 8px 32px;${font}font-size:20px;font-weight:700;color:#5b4636;">Lucy Spa</td></tr>`,
    '<tr><td style="padding:16px 32px 0 32px;">',
    paragraph(parts.purpose),
    paragraph(parts.use),
    '</td></tr>',
    '<tr><td style="padding:8px 32px;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">',
    `<tr><td align="center" style="padding:8px 0 0 0;${font}font-size:13px;color:#6b5b4e;">${escapeHtml(CODE_LABEL[message.locale])}</td></tr>`,
    `<tr><td align="center" style="padding:20px 0 24px 0;font-family:'Courier New',Courier,monospace;font-size:32px;line-height:40px;font-weight:700;letter-spacing:6px;text-align:center;color:#2b2b2b;background-color:#f7efe6;border-radius:6px;">${escapeHtml(message.code)}</td></tr>`,
    '</table>',
    '</td></tr>',
    '<tr><td style="padding:16px 32px 8px 32px;">',
    paragraph(parts.expiry),
    paragraph(parts.ignore),
    paragraph(parts.never),
    '</td></tr>',
    `<tr><td style="padding:8px 32px 24px 32px;${font}font-size:13px;color:#8a7a6d;">Lucy Spa</td></tr>`,
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('\n');
}

/**
 * Transactional email for one OTP purpose and locale, as plain text plus an HTML
 * alternative. States what the code is for, the code, its deadline from the delivery
 * record and what to do if unrequested.
 */
export function renderAuthEmail(message: AuthEmailMessage): RenderedAuthEmail {
  const text = copy[message.purpose][message.locale];
  const expiry =
    message.locale === 'vi'
      ? `Mã chỉ dùng một lần và hết hạn lúc ${deadline(message.expiresAt)} (giờ Việt Nam).`
      : `The code can be used once and expires at ${deadline(message.expiresAt)} (Vietnam time).`;
  const never =
    message.locale === 'vi'
      ? 'Lucy Spa không bao giờ hỏi mã này qua điện thoại, tin nhắn hay email.'
      : 'Lucy Spa never asks for this code by phone, message or email.';
  const rule = '===========================';
  return {
    subject: text.subject,
    text: [
      text.purpose,
      '',
      text.use,
      '',
      rule,
      `${CODE_LABEL[message.locale]}:`,
      '',
      `        ${message.code}`,
      rule,
      '',
      expiry,
      '',
      text.ignore,
      never,
      '',
      'Lucy Spa',
    ].join('\n'),
    html: renderHtml(message, {
      subject: text.subject,
      purpose: text.purpose,
      use: text.use,
      expiry,
      ignore: text.ignore,
      never,
    }),
  };
}
