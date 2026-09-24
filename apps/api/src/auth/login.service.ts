import type { CurrentAccountResponse } from '@lucy-spa/contracts';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service.js';
import { AuthThrottleService } from './auth-throttle.service.js';
import { AuthError } from './auth.error.js';
import { generateCapability } from './crypto.js';
import { normalizeEmail } from './identity.js';
import { PasswordService } from './password.service.js';
import { RateLimitedError } from './registration.service.js';
import { SessionService, type CredentialEvidence } from './session.service.js';

/** Design section 6 login failure budgets (fixed 15-minute UTC windows). */
export const LOGIN_POLICY = Object.freeze({
  identifierFailureLimit: 10,
  ipFailureLimit: 100,
  windowSeconds: 900,
} as const);

const OPS = {
  identifierFailure: 'LOGIN_FAILURE_CUSTOMER_EMAIL',
  ipFailure: 'LOGIN_FAILURE_IP',
} as const;

export interface LoginResult {
  readonly token: string;
  readonly account: CurrentAccountResponse;
}

const userSelect = {
  id: true,
  kind: true,
  status: true,
  fullName: true,
  preferredLocale: true,
  emailVerifiedAt: true,
  passwordHash: true,
  credentialVersion: true,
  authzVersion: true,
} as const;

@Injectable()
export class LoginService implements OnModuleInit {
  private dummyHash: Promise<string> | undefined;

  constructor(
    @Inject(PrismaService) private readonly prisma: Pick<PrismaService, 'client'>,
    @Inject(SessionService)
    private readonly sessions: Pick<SessionService, 'withTransaction' | 'rotateAuthenticated'>,
    @Inject(PasswordService)
    private readonly passwords: Pick<
      PasswordService,
      'hashForSetting' | 'verify' | 'verifyAndRehash'
    >,
    @Inject(AuthThrottleService) private readonly throttle: AuthThrottleService,
  ) {}

  /** Prepare the dummy verifier at startup so the first unknown-account login does no extra work. */
  async onModuleInit(): Promise<void> {
    await this.dummy();
  }

  /**
   * CUSTOMER realm, email identifier. Exactly one real or dummy Argon2 verification;
   * unknown, wrong-password, wrong-realm and ineligible accounts share one 401.
   */
  async login(
    identifier: string,
    password: string,
    sessionToken: string,
    peer: string,
    requestId?: string,
  ): Promise<LoginResult> {
    let emailCanonical: string | null = null;
    try {
      emailCanonical = normalizeEmail(identifier).emailCanonical;
    } catch {
      // Malformed identifiers fail like unknown accounts, after the same dummy work.
    }
    const user = await this.guard(() =>
      this.sessions.withTransaction(async (tx) => {
        const now = await this.throttle.now(tx);
        const ipFailures = await this.throttle.windowCount(
          tx,
          OPS.ipFailure,
          peer,
          LOGIN_POLICY.windowSeconds,
          now,
        );
        const identifierFailures =
          emailCanonical === null
            ? 0
            : await this.throttle.windowCount(
                tx,
                OPS.identifierFailure,
                emailCanonical,
                LOGIN_POLICY.windowSeconds,
                now,
              );
        // Applies equally to known and unknown identifiers; no password work when limited.
        if (
          ipFailures >= LOGIN_POLICY.ipFailureLimit ||
          identifierFailures >= LOGIN_POLICY.identifierFailureLimit
        ) {
          throw new RateLimitedError(LOGIN_POLICY.windowSeconds);
        }
        return emailCanonical === null
          ? null
          : tx.user.findUnique({ where: { emailCanonical }, select: userSelect });
      }),
    );

    const snapshot =
      user?.passwordHash != null
        ? {
            userId: user.id,
            passwordHash: user.passwordHash,
            credentialVersion: user.credentialVersion,
          }
        : null;
    let verified = false;
    let evidenceHash: string | null = null;
    try {
      if (snapshot) {
        const result = await this.passwords.verifyAndRehash(password, snapshot, this.prisma.client);
        verified = result.verified;
        evidenceHash = snapshot.passwordHash;
        if (result.rehash === 'updated') {
          // Session evidence must match the guarded rehash, never the pre-rehash hash.
          const current = await this.prisma.client.user.findUnique({
            where: { id: snapshot.userId },
            select: { passwordHash: true, credentialVersion: true },
          });
          evidenceHash =
            current?.credentialVersion === snapshot.credentialVersion ? current.passwordHash : null;
        }
      } else {
        await this.passwords.verify(password, await this.dummy());
      }
    } catch {
      throw new AuthError('SERVICE_UNAVAILABLE');
    }
    // Eligibility is evaluated only after the verification work, never as an early shortcut.
    const eligible =
      user !== null &&
      user.kind === 'CUSTOMER' &&
      user.status === 'ACTIVE' &&
      user.emailVerifiedAt !== null;
    if (!verified || !eligible || evidenceHash === null) {
      await this.recordFailure(emailCanonical, peer);
      throw new AuthError('AUTHENTICATION_FAILED');
    }

    const evidence: CredentialEvidence = {
      userId: user.id,
      passwordHash: evidenceHash,
      credentialVersion: user.credentialVersion,
      authzVersion: user.authzVersion,
    };
    let token: string;
    try {
      ({ token } = await this.sessions.rotateAuthenticated(sessionToken, evidence, {
        reauthenticated: false,
        ...(requestId ? { requestId } : {}),
      }));
    } catch (error) {
      // A concurrent reset, version change or revoked pre-auth session fails closed.
      if (error instanceof AuthError) throw new AuthError('AUTHENTICATION_FAILED');
      throw new AuthError('SERVICE_UNAVAILABLE');
    }
    return {
      token,
      account: {
        id: user.id,
        kind: 'CUSTOMER',
        displayName: user.fullName,
        locale: user.preferredLocale,
        authorization: { version: user.authzVersion, grants: [], denies: [] },
      },
    };
  }

  /** Failure debits commit in their own transaction; the 401 never rolls them back. */
  private async recordFailure(emailCanonical: string | null, peer: string): Promise<void> {
    await this.guard(() =>
      this.sessions.withTransaction(async (tx) => {
        const now = await this.throttle.now(tx);
        await this.throttle.debitWindow(
          tx,
          OPS.ipFailure,
          peer,
          LOGIN_POLICY.ipFailureLimit,
          LOGIN_POLICY.windowSeconds,
          now,
        );
        if (emailCanonical !== null) {
          await this.throttle.debitWindow(
            tx,
            OPS.identifierFailure,
            emailCanonical,
            LOGIN_POLICY.identifierFailureLimit,
            LOGIN_POLICY.windowSeconds,
            now,
          );
        }
      }),
    );
  }

  private dummy(): Promise<string> {
    // A random, never-stored password hashed with the current parameters.
    this.dummyHash ??= this.passwords.hashForSetting(generateCapability());
    return this.dummyHash;
  }

  private async guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError('SERVICE_UNAVAILABLE');
    }
  }
}
