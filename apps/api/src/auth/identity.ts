import { domainToASCII } from 'node:url';
import { parsePhoneNumberWithError } from 'libphonenumber-js/max';
import validator from 'validator';

// Changing comparison keys requires a reviewed collision/migration plan.
export const IDENTITY_NORMALIZATION_VERSION = 1;
const ASCII_EDGE_WHITESPACE = /^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g;
const ASCII_DOT_ATOM = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;

export class IdentityValidationError extends Error {
  constructor(readonly field: 'email' | 'phone' | 'employeeCode') {
    super(`Invalid ${field}.`);
    this.name = 'IdentityValidationError';
  }
}

export interface NormalizedEmail {
  emailCanonical: string;
  emailDelivery: string;
  normalizationVersion: typeof IDENTITY_NORMALIZATION_VERSION;
}

/** Server authority: never use provider-specific dot/tag rewriting. */
export function normalizeEmail(input: unknown): NormalizedEmail {
  if (typeof input !== 'string' || input.length > 1_024) {
    throw new IdentityValidationError('email');
  }
  const address = input.replace(ASCII_EDGE_WHITESPACE, '');
  const at = address.indexOf('@');
  // eslint-disable-next-line no-control-regex -- Explicitly reject mailbox control characters.
  if (at < 1 || at !== address.lastIndexOf('@') || /[\u0000-\u001f\u007f]/.test(address)) {
    throw new IdentityValidationError('email');
  }
  const local = address.slice(0, at);
  const submittedDomain = address.slice(at + 1);
  // WHATWG IDNA can parse percent escapes and URL punctuation; these are not
  // mailbox-domain syntax. Reject them before invoking the IDNA processor.
  if (
    !ASCII_DOT_ATOM.test(local) ||
    /[\s%/\\:#?@[\]]/u.test(submittedDomain) ||
    submittedDomain.length === 0
  ) {
    throw new IdentityValidationError('email');
  }
  const domain = domainToASCII(submittedDomain).toLowerCase();
  const emailDelivery = `${local}@${domain}`;
  if (
    !domain ||
    !validator.isEmail(emailDelivery, {
      allow_display_name: false,
      allow_utf8_local_part: false,
      allow_ip_domain: false,
      allow_underscores: false,
      require_tld: true,
      ignore_max_length: false,
      domain_specific_validation: false,
    })
  ) {
    throw new IdentityValidationError('email');
  }
  return {
    emailCanonical: `${local.toLowerCase()}@${domain}`,
    emailDelivery,
    normalizationVersion: IDENTITY_NORMALIZATION_VERSION,
  };
}

/** Numeric validity is not a claim of reachability or ownership. */
export function normalizePhone(input: unknown): {
  phoneCanonical: string;
  normalizationVersion: typeof IDENTITY_NORMALIZATION_VERSION;
} {
  if (typeof input !== 'string' || input.length > 128 || !/^[0-9+ ().-]+$/.test(input)) {
    throw new IdentityValidationError('phone');
  }
  let number = input.replace(/[ ().-]/g, '');
  if (number.startsWith('0084')) number = `+84${number.slice(4)}`;
  if (!/^(?:0[0-9]+|\+[1-9][0-9]+)$/.test(number) || number.startsWith('+840')) {
    throw new IdentityValidationError('phone');
  }
  // Only 0084 is an accepted international-dialling alias. Do not let the
  // parser guess another region from a different 00 prefix.
  if (number.startsWith('00')) throw new IdentityValidationError('phone');
  try {
    const parsed = parsePhoneNumberWithError(number, { defaultCountry: 'VN', extract: false });
    if (!parsed.isValid()) throw new IdentityValidationError('phone');
    return {
      phoneCanonical: parsed.number,
      normalizationVersion: IDENTITY_NORMALIZATION_VERSION,
    };
  } catch {
    throw new IdentityValidationError('phone');
  }
}

export function normalizeEmployeeCode(input: unknown): {
  employeeCodeCanonical: string;
  normalizationVersion: typeof IDENTITY_NORMALIZATION_VERSION;
} {
  if (typeof input !== 'string' || input.length > 256) {
    throw new IdentityValidationError('employeeCode');
  }
  const code = input.trim();
  // Validate ASCII before uppercasing: Unicode case folding may create an
  // ASCII-looking identifier (for example long-s or sharp-s).
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(code)) {
    throw new IdentityValidationError('employeeCode');
  }
  return {
    employeeCodeCanonical: code.toUpperCase(),
    normalizationVersion: IDENTITY_NORMALIZATION_VERSION,
  };
}
