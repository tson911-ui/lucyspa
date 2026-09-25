/** Email-OTP purposes that carry a code. EMPLOYEE_SETUP capabilities are never emailed. */
export type AuthEmailPurpose = 'ACTIVATE_CUSTOMER' | 'RESET_PASSWORD' | 'VERIFY_RECOVERY_EMAIL';

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
  readonly text: string;
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
        value.purpose === 'VERIFY_RECOVERY_EMAIL') &&
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
} as const;

/**
 * Plain-text transactional email for one OTP purpose and locale. States what the code is
 * for, the code, its deadline from the delivery record and what to do if unrequested.
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
  return {
    subject: text.subject,
    text: [
      text.purpose,
      '',
      text.use,
      '',
      `    ${message.code}`,
      '',
      expiry,
      '',
      text.ignore,
      never,
      '',
      'Lucy Spa',
    ].join('\n'),
  };
}
