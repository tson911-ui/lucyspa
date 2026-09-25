const MAX_DATABASE_INTEGER = 2_147_483_647;

export interface AuthEnvironment {
  anonymousTtlSeconds: number;
  idleTtlSeconds: number;
  absoluteTtlSeconds: number;
  freshAuthSeconds: number;
  csrfActiveVersion: number;
  csrfKeys: ReadonlyMap<number, Buffer>;
  throttleActiveVersion: number;
  throttleKeys: ReadonlyMap<number, Buffer>;
  otpActiveVersion?: number;
  otpKeys?: ReadonlyMap<number, Buffer>;
  deliveryActiveVersion?: number;
  deliveryKeys?: ReadonlyMap<number, Buffer>;
  cookieName: '__Host-lucy_session' | 'lucy_session_dev';
  cookieSecure: boolean;
  contextLimit: number;
  contextWindowSeconds: number;
  otpIpIssueLimit: number;
}

function invalid(field: string): never {
  // Never include provided environment values or the JSON parser's error text.
  throw new Error(`Invalid authentication configuration: ${field}`);
}

function positiveInteger(env: NodeJS.ProcessEnv, field: string, fallback?: number): number {
  const input = env[field];
  if (input === undefined && fallback !== undefined) return fallback;
  if (input === undefined || !/^[1-9][0-9]*$/.test(input)) return invalid(field);
  const value = Number(input);
  if (!Number.isSafeInteger(value) || value > MAX_DATABASE_INTEGER || value.toString() !== input) {
    return invalid(field);
  }
  return value;
}

function keyRing(env: NodeJS.ProcessEnv, field: string): ReadonlyMap<number, Buffer> {
  const input = env[field];
  if (input === undefined || input.length > 65_536) return invalid(field);
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return invalid(field);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return invalid(field);
  }
  const keys = new Map<number, Buffer>();
  for (const [version, value] of Object.entries(parsed)) {
    if (!/^[1-9][0-9]*$/.test(version)) return invalid(field);
    const numericVersion = Number(version);
    if (
      !Number.isSafeInteger(numericVersion) ||
      numericVersion > MAX_DATABASE_INTEGER ||
      numericVersion.toString() !== version
    ) {
      return invalid(field);
    }
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return invalid(field);
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.length < 32 || bytes.toString('base64url') !== value) return invalid(field);
    keys.set(numericVersion, bytes);
  }
  if (keys.size === 0) return invalid(field);
  return keys;
}

function activeVersion(
  env: NodeJS.ProcessEnv,
  field: string,
  keys: ReadonlyMap<number, Buffer>,
): number {
  const version = positiveInteger(env, field);
  if (!keys.has(version)) return invalid(field);
  return version;
}

function requireIndependentKeys(rings: readonly ReadonlyMap<number, Buffer>[]): void {
  const values = new Set<string>();
  for (const ring of rings) {
    for (const key of ring.values()) {
      const value = key.toString('base64url');
      if (values.has(value)) return invalid('AUTH_KEYS_MUST_BE_INDEPENDENT');
      values.add(value);
    }
  }
}

export function parseAuthEnvironment(
  env: NodeJS.ProcessEnv,
  nodeEnv: 'development' | 'test' | 'production',
  webOrigin: string,
): AuthEnvironment {
  let origin: URL;
  try {
    origin = new URL(webOrigin);
  } catch {
    return invalid('WEB_ORIGIN');
  }
  if (origin.origin !== webOrigin || !['http:', 'https:'].includes(origin.protocol)) {
    return invalid('WEB_ORIGIN');
  }
  const localCookieSetting = env['AUTH_ALLOW_INSECURE_LOCAL_COOKIE'];
  if (localCookieSetting !== undefined && !['true', 'false'].includes(localCookieSetting)) {
    return invalid('AUTH_ALLOW_INSECURE_LOCAL_COOKIE');
  }
  const insecureCookie = localCookieSetting === 'true';
  const loopback =
    ['localhost', '[::1]'].includes(origin.hostname) ||
    /^127\.(?:[0-9]{1,3}\.){2}[0-9]{1,3}$/.test(origin.hostname);
  if (insecureCookie && (nodeEnv === 'production' || origin.protocol !== 'http:' || !loopback)) {
    return invalid('AUTH_ALLOW_INSECURE_LOCAL_COOKIE');
  }
  if (!insecureCookie && origin.protocol !== 'https:') return invalid('WEB_ORIGIN');

  const anonymousTtlSeconds = positiveInteger(env, 'AUTH_ANONYMOUS_TTL_SECONDS', 900);
  const idleTtlSeconds = positiveInteger(env, 'AUTH_IDLE_TTL_SECONDS', 1800);
  const absoluteTtlSeconds = positiveInteger(env, 'AUTH_ABSOLUTE_TTL_SECONDS', 43_200);
  const freshAuthSeconds = positiveInteger(env, 'AUTH_FRESH_AUTH_SECONDS', 300);
  if (anonymousTtlSeconds > absoluteTtlSeconds) return invalid('AUTH_ANONYMOUS_TTL_SECONDS');
  if (idleTtlSeconds > absoluteTtlSeconds) return invalid('AUTH_IDLE_TTL_SECONDS');
  if (freshAuthSeconds > idleTtlSeconds) return invalid('AUTH_FRESH_AUTH_SECONDS');

  const csrfKeys = keyRing(env, 'AUTH_CSRF_KEYS');
  const csrfActiveVersion = activeVersion(env, 'AUTH_CSRF_ACTIVE_VERSION', csrfKeys);
  const throttleKeys = keyRing(env, 'AUTH_THROTTLE_KEYS');
  const throttleActiveVersion = activeVersion(env, 'AUTH_THROTTLE_ACTIVE_VERSION', throttleKeys);
  let otp: Pick<AuthEnvironment, 'otpKeys' | 'otpActiveVersion'> = {};
  if (env['AUTH_OTP_KEYS'] !== undefined || env['AUTH_OTP_ACTIVE_VERSION'] !== undefined) {
    const otpKeys = keyRing(env, 'AUTH_OTP_KEYS');
    otp = {
      otpKeys,
      otpActiveVersion: activeVersion(env, 'AUTH_OTP_ACTIVE_VERSION', otpKeys),
    };
  }
  let delivery: Pick<AuthEnvironment, 'deliveryKeys' | 'deliveryActiveVersion'> = {};
  if (
    env['AUTH_DELIVERY_KEYS'] !== undefined ||
    env['AUTH_DELIVERY_ACTIVE_VERSION'] !== undefined
  ) {
    const deliveryKeys = keyRing(env, 'AUTH_DELIVERY_KEYS');
    delivery = {
      deliveryKeys,
      deliveryActiveVersion: activeVersion(env, 'AUTH_DELIVERY_ACTIVE_VERSION', deliveryKeys),
    };
  }
  requireIndependentKeys([
    csrfKeys,
    throttleKeys,
    ...(otp.otpKeys ? [otp.otpKeys] : []),
    ...(delivery.deliveryKeys ? [delivery.deliveryKeys] : []),
  ]);

  return {
    anonymousTtlSeconds,
    idleTtlSeconds,
    absoluteTtlSeconds,
    freshAuthSeconds,
    csrfActiveVersion,
    csrfKeys,
    throttleActiveVersion,
    throttleKeys,
    ...otp,
    ...delivery,
    cookieName: insecureCookie ? 'lucy_session_dev' : '__Host-lucy_session',
    cookieSecure: !insecureCookie,
    contextLimit: positiveInteger(env, 'AUTH_CONTEXT_LIMIT', 30),
    contextWindowSeconds: positiveInteger(env, 'AUTH_CONTEXT_WINDOW_SECONDS', 900),
    // Per direct peer per hour; raise explicitly for shared spa networks behind one address.
    otpIpIssueLimit: positiveInteger(env, 'AUTH_OTP_IP_ISSUE_LIMIT', 30),
  };
}

/**
 * The delivery ring alone, for the email worker: it decrypts delivery envelopes and
 * needs no CSRF, throttle or OTP keys. Same syntax and validation as the API ring.
 */
export function parseDeliveryKeyRing(env: NodeJS.ProcessEnv): {
  deliveryKeys: ReadonlyMap<number, Buffer>;
  deliveryActiveVersion: number;
} {
  const deliveryKeys = keyRing(env, 'AUTH_DELIVERY_KEYS');
  return {
    deliveryKeys,
    deliveryActiveVersion: activeVersion(env, 'AUTH_DELIVERY_ACTIVE_VERSION', deliveryKeys),
  };
}
