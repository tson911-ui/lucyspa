import { createHash } from 'node:crypto';
import type { DatabaseClient } from '@lucy-spa/database';
import * as argon2 from 'argon2';
import { COMMON_PASSWORD_DIGESTS } from './password-data/common-passwords.js';

export const PASSWORD_POLICY = Object.freeze({ minCodePoints: 15, maxCodePoints: 128 });
export const PASSWORD_HASH_PARAMETERS = Object.freeze({
  type: argon2.argon2id,
  version: 0x13,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
});

export class PasswordPolicyError extends Error {
  constructor(readonly code: 'PASSWORD_LENGTH' | 'PASSWORD_INVALID' | 'PASSWORD_COMPROMISED') {
    super('Password does not meet the password policy.');
    this.name = 'PasswordPolicyError';
  }
}

export class PasswordWorkLimitError extends Error {
  constructor() {
    super('Password service is busy.');
    this.name = 'PasswordWorkLimitError';
  }
}

/** Used for every password entry path; do not trim, fold case, or truncate. */
export function normalizePassword(input: unknown): string {
  if (typeof input !== 'string' || input.length > 1_024) {
    throw new PasswordPolicyError('PASSWORD_INVALID');
  }
  // Lone UTF-16 surrogates otherwise collapse to replacement bytes in UTF-8,
  // making different malformed inputs authenticate as the same password.
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(input)) {
    throw new PasswordPolicyError('PASSWORD_INVALID');
  }
  const normalized = input.normalize('NFC');
  const count = [...normalized].length;
  if (count < PASSWORD_POLICY.minCodePoints || count > PASSWORD_POLICY.maxCodePoints) {
    throw new PasswordPolicyError('PASSWORD_LENGTH');
  }
  return normalized;
}

const commonPasswords: ReadonlySet<string> = new Set(COMMON_PASSWORD_DIGESTS);

export function validatePasswordForSetting(input: unknown): string {
  const normalized = normalizePassword(input);
  // These are fingerprints of public blocklist entries, never credential
  // hashes. Actual account passwords are stored exclusively with Argon2id.
  const fingerprint = createHash('sha256').update(normalized, 'utf8').digest('hex');
  if (commonPasswords.has(fingerprint)) {
    throw new PasswordPolicyError('PASSWORD_COMPROMISED');
  }
  return normalized;
}

interface HashMetadata {
  version: number;
  memoryCost: number;
  timeCost: number;
  parallelism: number;
  saltBytes: number;
  hashBytes: number;
}

/** Bound stored PHC parameters before dispatching expensive native work. */
function hashMetadata(encoded: string): HashMetadata | null {
  if (typeof encoded !== 'string' || encoded.length > 512) return null;
  const match =
    /^\$argon2id\$v=(16|19)\$((?:[mpt]=[1-9][0-9]{0,5},){2}[mpt]=[1-9][0-9]{0,5})\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(
      encoded,
    );
  if (!match) return null;
  const [, version, parameters, salt, hash] = match;
  if (!parameters || !salt || !hash) return null;
  // PHC parameter order is not meaningful; current node-argon2 emits m,p,t.
  // Require exactly one of each supported parameter and reject duplicates.
  const costs = Object.fromEntries(
    parameters.split(',').map((parameter) => {
      const [name, value] = parameter.split('=');
      return [name, Number(value)];
    }),
  );
  if (Object.keys(costs).length !== 3) return null;
  const saltBuffer = Buffer.from(salt, 'base64');
  const hashBuffer = Buffer.from(hash, 'base64');
  if (
    saltBuffer.toString('base64').replace(/=+$/, '') !== salt ||
    hashBuffer.toString('base64').replace(/=+$/, '') !== hash
  )
    return null;
  const metadata = {
    version: Number(version),
    memoryCost: costs['m'] as number,
    timeCost: costs['t'] as number,
    parallelism: costs['p'] as number,
    saltBytes: saltBuffer.length,
    hashBytes: hashBuffer.length,
  };
  if (
    metadata.memoryCost < 19_456 ||
    metadata.memoryCost > 262_144 ||
    metadata.timeCost < 2 ||
    metadata.timeCost > 10 ||
    metadata.parallelism > 8 ||
    metadata.saltBytes < 8 ||
    metadata.saltBytes > 64 ||
    metadata.hashBytes < 16 ||
    metadata.hashBytes > 64
  )
    return null;
  return metadata;
}

export interface PasswordVerification {
  verified: boolean;
  needsRehash: boolean;
}

export interface CredentialSnapshot {
  userId: string;
  passwordHash: string;
  credentialVersion: number;
}

export class PasswordService {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly maxConcurrent: number;
  private readonly maxQueued: number;

  constructor(options: { maxConcurrent?: number; maxQueued?: number } = {}) {
    this.maxConcurrent = options.maxConcurrent ?? 2;
    this.maxQueued = options.maxQueued ?? 16;
    if (
      !Number.isInteger(this.maxConcurrent) ||
      this.maxConcurrent < 1 ||
      this.maxConcurrent > 8 ||
      !Number.isInteger(this.maxQueued) ||
      this.maxQueued < 0 ||
      this.maxQueued > 128
    )
      throw new Error('Invalid password work limits.');
  }

  async hashForSetting(input: unknown): Promise<string> {
    return this.hashNormalized(validatePasswordForSetting(input));
  }

  needsRehash(storedHash: string): boolean {
    const metadata = hashMetadata(storedHash);
    if (!metadata) return true;
    // Preserve stronger memory/iteration costs rather than downgrading them.
    return (
      metadata.version !== PASSWORD_HASH_PARAMETERS.version ||
      metadata.memoryCost < PASSWORD_HASH_PARAMETERS.memoryCost ||
      metadata.timeCost < PASSWORD_HASH_PARAMETERS.timeCost ||
      metadata.parallelism !== PASSWORD_HASH_PARAMETERS.parallelism ||
      metadata.saltBytes < 16 ||
      metadata.hashBytes < PASSWORD_HASH_PARAMETERS.hashLength
    );
  }

  async verify(input: unknown, storedHash: string): Promise<PasswordVerification> {
    let normalized: string;
    try {
      normalized = normalizePassword(input);
    } catch (error) {
      if (error instanceof PasswordPolicyError) return { verified: false, needsRehash: false };
      throw error;
    }
    if (!hashMetadata(storedHash)) return { verified: false, needsRehash: false };
    return this.withWorkSlot(async () => {
      try {
        const verified = await argon2.verify(storedHash, normalized);
        return { verified, needsRehash: verified && this.needsRehash(storedHash) };
      } catch {
        // Native/PHC errors must never echo supplied passwords or hashes.
        throw new Error('Password verification unavailable.');
      }
    });
  }

  /** A later login still must create its session with the same version guard. */
  async verifyAndRehash(
    input: unknown,
    snapshot: CredentialSnapshot,
    database: Pick<DatabaseClient, 'user'>,
  ): Promise<
    PasswordVerification & { rehash: 'not-needed' | 'updated' | 'stale' | 'not-verified' }
  > {
    const result = await this.verify(input, snapshot.passwordHash);
    if (!result.verified) return { ...result, rehash: 'not-verified' };
    if (!result.needsRehash) return { ...result, rehash: 'not-needed' };
    // Login rehash does not apply today's setting/reset blocklist retroactively.
    const metadata = hashMetadata(snapshot.passwordHash);
    if (!metadata) return { verified: false, needsRehash: false, rehash: 'not-verified' };
    const passwordHash = await this.hashNormalized(normalizePassword(input), {
      memoryCost: Math.max(metadata.memoryCost, PASSWORD_HASH_PARAMETERS.memoryCost),
      timeCost: Math.max(metadata.timeCost, PASSWORD_HASH_PARAMETERS.timeCost),
      hashLength: Math.max(metadata.hashBytes, PASSWORD_HASH_PARAMETERS.hashLength),
    });
    const updated = await database.user.updateMany({
      where: {
        id: snapshot.userId,
        passwordHash: snapshot.passwordHash,
        credentialVersion: snapshot.credentialVersion,
      },
      data: { passwordHash },
    });
    return updated.count === 1
      ? { verified: true, needsRehash: false, rehash: 'updated' }
      : { verified: false, needsRehash: false, rehash: 'stale' };
  }

  private async hashNormalized(
    normalized: string,
    strongerCosts: {
      memoryCost: number;
      timeCost: number;
      hashLength: number;
    } = PASSWORD_HASH_PARAMETERS,
  ): Promise<string> {
    return this.withWorkSlot(async () => {
      try {
        // argon2 generates a fresh 16-byte CSPRNG salt for every hash.
        return await argon2.hash(normalized, { ...PASSWORD_HASH_PARAMETERS, ...strongerCosts });
      } catch {
        throw new Error('Password hashing unavailable.');
      }
    });
  }

  private async withWorkSlot<T>(work: () => Promise<T>): Promise<T> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
    } else {
      if (this.waiting.length >= this.maxQueued) throw new PasswordWorkLimitError();
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}
