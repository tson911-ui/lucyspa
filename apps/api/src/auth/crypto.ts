import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const TOKEN_BYTES = 32;
const MAX_DATABASE_VERSION = 2_147_483_647;

/** Decode only the single unpadded base64url representation of a 256-bit value. */
function decodeToken(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length === TOKEN_BYTES && bytes.toString('base64url') === value ? bytes : null;
}

export function generateCapability(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** SHA-256 of decoded capability bytes. Never use this for low-entropy secrets. */
export function capabilityDigest(raw: string): Buffer | null {
  const bytes = decodeToken(raw);
  return bytes === null ? null : createHash('sha256').update(bytes).digest();
}

/** Public length differences may fail early; equal-length secret bytes use timingSafeEqual. */
export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

/** Each UTF-8 field is preceded by its unsigned 32-bit big-endian byte length. */
export function lengthPrefixedTuple(fields: readonly string[]): Buffer {
  const chunks: Buffer[] = [];
  for (const field of fields) {
    // Unpaired UTF-16 surrogates would alias U+FFFD in UTF-8 and break tuple injectivity.
    const value = Buffer.from(field, 'utf8');
    if (value.toString('utf8') !== field || value.length > 0xffff_ffff) {
      throw new Error('Invalid cryptographic tuple field');
    }
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(value.length);
    chunks.push(prefix, value);
  }
  return Buffer.concat(chunks);
}

function keyedDigest(key: Uint8Array, fields: readonly string[]): Buffer {
  if (key.byteLength < TOKEN_BYTES) throw new Error('Invalid authentication key');
  return createHmac('sha256', key).update(lengthPrefixedTuple(fields)).digest();
}

export function csrfToken(sessionId: string, rawToken: string, key: Uint8Array): string {
  if (!sessionId || decodeToken(rawToken) === null) {
    throw new Error('Invalid CSRF session binding');
  }
  return keyedDigest(key, ['csrf-v1', sessionId, rawToken]).toString('base64url');
}

export function verifyCsrfToken(
  supplied: string,
  sessionId: string,
  rawToken: string,
  key: Uint8Array,
): boolean {
  const suppliedBytes = decodeToken(supplied);
  if (suppliedBytes === null || !sessionId || decodeToken(rawToken) === null) return false;
  return constantTimeEqual(
    suppliedBytes,
    Buffer.from(csrfToken(sessionId, rawToken, key), 'base64url'),
  );
}

export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export interface OtpBinding {
  purpose: 'ACTIVATE_CUSTOMER' | 'RESET_PASSWORD' | 'VERIFY_RECOVERY_EMAIL';
  challengeId: string;
  generation: number;
  subjectId: string;
  emailCanonical: string;
  credentialVersion: number | null;
}

function positiveVersion(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_DATABASE_VERSION;
}

/** The key must come from the independent OTP ring, never the CSRF/throttle ring. */
export function otpDigest(binding: OtpBinding, code: string, key: Uint8Array): Buffer {
  if (
    !['ACTIVATE_CUSTOMER', 'RESET_PASSWORD', 'VERIFY_RECOVERY_EMAIL'].includes(binding.purpose) ||
    !binding.challengeId ||
    !binding.subjectId ||
    !binding.emailCanonical ||
    !positiveVersion(binding.generation) ||
    (binding.credentialVersion !== null && !positiveVersion(binding.credentialVersion)) ||
    (binding.purpose === 'ACTIVATE_CUSTOMER') !== (binding.credentialVersion === null) ||
    code.length !== 6 ||
    !/^[0-9]{6}$/.test(code)
  ) {
    throw new Error('Invalid OTP binding');
  }
  return keyedDigest(key, [
    'otp-v1',
    binding.purpose,
    binding.challengeId,
    binding.generation.toString(),
    binding.subjectId,
    binding.emailCanonical,
    binding.credentialVersion?.toString() ?? '',
    code,
  ]);
}

export function verifyOtpDigest(
  expected: Uint8Array,
  binding: OtpBinding,
  suppliedCode: string,
  key: Uint8Array,
): boolean {
  if (
    expected.byteLength !== TOKEN_BYTES ||
    suppliedCode.length !== 6 ||
    !/^[0-9]{6}$/.test(suppliedCode)
  )
    return false;
  return constantTimeEqual(expected, otpDigest(binding, suppliedCode, key));
}

/** Domain and operation binding prevent unrelated identifier/IP budgets from aliasing. */
export function throttleDigest(purpose: string, identifier: string, key: Uint8Array): Buffer {
  if (!purpose || !identifier) throw new Error('Invalid throttle binding');
  return keyedDigest(key, ['throttle-v1', purpose, identifier]);
}
