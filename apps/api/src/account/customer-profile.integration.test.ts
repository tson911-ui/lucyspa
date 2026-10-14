import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, type Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { validVnMobile } from '../testing/phone.js';
import { CustomerProfileService } from './customer-profile.service.js';

/**
 * Session 7b: the customer's own profile against real PostgreSQL. The name is the only thing written; the version guards a stale
 * form; the birthday and phone are shown, never written; a staff session is refused; the audit row carries field names only.
 * Every fixture rolls back with the outer transaction.
 */
test(
  'Session 7b customer profile; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async () => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl);
    const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
    const environment = parseApiEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      REDIS_URL: 'redis://localhost:6379',
      WEB_ORIGIN: 'http://localhost:3000',
      AUTH_ALLOW_INSECURE_LOCAL_COOKIE: 'true',
      AUTH_CSRF_KEYS: ring(),
      AUTH_CSRF_ACTIVE_VERSION: '1',
      AUTH_THROTTLE_KEYS: ring(),
      AUTH_THROTTLE_ACTIVE_VERSION: '1',
    });
    const database = createDatabaseClient(databaseUrl);
    const sessions = new SessionService({ client: database } as PrismaService, environment);
    const rollback = new Error('Session 7b fixture rollback');
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toLowerCase();
    try {
      await assert.rejects(
        database.$transaction(
          async (tx: Prisma.TransactionClient) => {
            let savepoint = 0;
            const isolated = async <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => {
              const name = `s7b_${++savepoint}`;
              await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
              try {
                const result = await work(tx);
                await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
                return result;
              } catch (error) {
                await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
                throw error;
              }
            };
            const adapter = {
              withTransaction: isolated,
              resolveForMutation: (token: string) => sessions.resolveForMutation(token, tx),
            };
            const profile = new CustomerProfileService(
              adapter,
              new AuthThrottleService(environment),
            );
            const fails = (work: Promise<unknown>, code: string, field?: string) =>
              assert.rejects(work, (error: unknown) => {
                assert.equal(Reflect.get(Object(error), 'code'), code);
                if (field !== undefined) assert.equal(Reflect.get(Object(error), 'field'), field);
                return true;
              });
            const signIn = async (user: {
              id: string;
              passwordHash: string | null;
              credentialVersion: number;
              authzVersion: number;
            }) =>
              (
                await sessions.rotateAuthenticated(
                  (await sessions.createAnonymous(tx)).token,
                  {
                    userId: user.id,
                    passwordHash: user.passwordHash!,
                    credentialVersion: user.credentialVersion,
                    authzVersion: user.authzVersion,
                  },
                  { reauthenticated: false },
                  tx,
                )
              ).token;
            const make = async (label: string, kind: 'CUSTOMER' | 'EMPLOYEE') => {
              const email = `s7b-${label}-${run}@example.com`;
              const user = await tx.user.create({
                data: {
                  kind,
                  status: 'ACTIVE',
                  fullName: `Khách ${label}`,
                  preferredLocale: 'en',
                  emailCanonical: email,
                  emailDelivery: email,
                  emailVerifiedAt: new Date(),
                  phoneCanonical: validVnMobile(),
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                  ...(kind === 'CUSTOMER'
                    ? {
                        customerProfile: {
                          create: { dateOfBirth: new Date('1990-03-05'), address: 'Fixture' },
                        },
                      }
                    : {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `S7B-${label}-${run}`.toUpperCase(),
                            dateOfBirth: new Date('1991-01-01'),
                            address: 'Fixture',
                          },
                        },
                      }),
                },
              });
              return { ...user, email, token: await signIn(user) };
            };
            const lan = await make('lan', 'CUSTOMER');
            const mai = await make('mai', 'CUSTOMER');
            const staff = await make('staff', 'EMPLOYEE');

            // Read: own data only, birthday as a plain date and locked, email verified, language as stored.
            const first = await profile.get(lan.token);
            assert.equal(first.fullName, 'Khách lan');
            assert.deepEqual(first.email, { address: lan.email, verified: true });
            assert.equal(first.phone, lan.phoneCanonical);
            assert.equal(first.dateOfBirth, '1990-03-05');
            assert.equal(first.dateOfBirthLocked, true);
            assert.equal(first.locale, 'en');
            assert.equal(first.version, lan.rowVersion);
            assert.equal(
              (await profile.get(mai.token)).fullName,
              'Khách mai',
              'never another person',
            );

            // Write: the name is trimmed, NFC-normalized, the version moves and one audit row records field names only.
            const saved = await profile.update(
              lan.token,
              { expectedVersion: first.version, fullName: '  Hoàng Thị Lan  ' },
              randomUUID(),
            );
            assert.equal(saved.fullName, 'Hoàng Thị Lan');
            assert.equal(saved.version, first.version + 1);
            assert.equal(saved.dateOfBirth, '1990-03-05');
            assert.equal(saved.phone, first.phone);
            assert.deepEqual(saved.email, first.email);
            const audits = await tx.auditEvent.findMany({
              where: { subjectUserId: lan.id, action: 'PROFILE_UPDATED' },
            });
            assert.equal(audits.length, 1);
            assert.deepEqual(audits[0]?.after, { fields: ['fullName'], via: 'MY_PROFILE' });
            assert.equal(audits[0]?.actorUserId, lan.id);
            assert.doesNotMatch(JSON.stringify(audits[0]?.after), /Hoàng/);
            // Another customer is untouched.
            assert.equal((await profile.get(mai.token)).fullName, 'Khách mai');

            // The same name again changes nothing: no new version, no second audit row.
            const same = await profile.update(lan.token, {
              expectedVersion: saved.version,
              fullName: 'Hoàng Thị Lan',
            });
            assert.equal(same.version, saved.version);
            assert.equal(
              await tx.auditEvent.count({
                where: { subjectUserId: lan.id, action: 'PROFILE_UPDATED' },
              }),
              1,
            );

            // A stale form (an older version) is a conflict and writes nothing.
            await fails(
              profile.update(lan.token, { expectedVersion: first.version, fullName: 'Lan Khác' }),
              'CONFLICT',
            );
            assert.equal((await profile.get(lan.token)).fullName, 'Hoàng Thị Lan');

            // Names the same limits as registration: empty, blank, control characters and too long are refused.
            for (const bad of ['', '   ', 'Lan\nHoàng', 'Lan\u0000', 'x'.repeat(201)]) {
              await fails(
                profile.update(lan.token, { expectedVersion: saved.version, fullName: bad }),
                'VALIDATION_FAILED',
                'fullName',
              );
            }

            // Not for anonymous or staff sessions.
            await fails(profile.get(undefined), 'AUTHENTICATION_REQUIRED');
            await fails(profile.get('x'.repeat(43)), 'AUTHENTICATION_REQUIRED');
            await fails(profile.get(staff.token), 'FORBIDDEN');
            await fails(
              profile.update(staff.token, { expectedVersion: 1, fullName: 'Nhân viên' }),
              'FORBIDDEN',
            );
            assert.equal(
              (await tx.user.findUniqueOrThrow({ where: { id: staff.id } })).fullName,
              'Khách staff',
            );

            // The birthday and the phone were never writable: they are exactly as registered.
            const row = await tx.user.findUniqueOrThrow({
              where: { id: lan.id },
              select: { phoneCanonical: true, customerProfile: { select: { dateOfBirth: true } } },
            });
            assert.equal(row.phoneCanonical, lan.phoneCanonical);
            assert.equal(row.customerProfile?.dateOfBirth.toISOString().slice(0, 10), '1990-03-05');
            throw rollback;
          },
          { timeout: 60_000 },
        ),
        rollback,
      );
    } finally {
      await database.$disconnect();
    }
  },
);
