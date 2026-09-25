import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createDatabaseClient,
  syncPermissionCatalog,
  type PermissionCode,
  type Prisma,
} from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { PasswordService } from '../auth/password.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { ServiceCatalogService } from './service-catalog.service.js';

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'service catalog, price authority and branch availability; all fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (context) => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl, 'DATABASE_URL required for explicit auth integration tests.');
    const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
    const environment = parseApiEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      REDIS_URL: 'redis://localhost:6379',
      WEB_ORIGIN: 'http://localhost:3000',
      AUTH_ALLOW_INSECURE_LOCAL_COOKIE: 'true',
      AUTH_CSRF_ACTIVE_VERSION: '1',
      AUTH_CSRF_KEYS: ring(),
      AUTH_THROTTLE_ACTIVE_VERSION: '1',
      AUTH_THROTTLE_KEYS: ring(),
    });
    const database = createDatabaseClient(databaseUrl);
    const sessions = new SessionService({ client: database } as PrismaService, environment);
    const run = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
    const userIds: string[] = [];
    const rollback = new Error('Intentional service catalog integration rollback');
    try {
      await database.$connect();
      const existingOwner = await database.user.findFirst({
        where: { kind: 'OWNER' },
        select: { id: true },
      });
      const counts = {
        services: await database.service.count(),
        categories: await database.serviceCategory.count(),
      };
      const hash = await new PasswordService().hashForSetting('a calm lotus evening 2026');
      await assert.rejects(
        database.$transaction(
          async (tx) => {
            let savepoints = 0;
            // Each command gets its own savepoint: a rejected command rolls back exactly as
            // its own transaction would in production.
            const isolated = async <T>(work: () => Promise<T>): Promise<T> => {
              const name = `command_${++savepoints}`;
              await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
              try {
                const result = await work();
                await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
                return result;
              } catch (error) {
                await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
                throw error;
              }
            };
            const runner = {
              withTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) =>
                isolated(() => work(tx)),
              withExclusiveTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) =>
                isolated(() => work(tx)),
              resolveForMutation: (token: string) => sessions.resolveForMutation(token, tx),
            };
            const catalog = new ServiceCatalogService(runner, new AuthThrottleService(environment));
            await syncPermissionCatalog(tx);
            const permissions = new Map(
              (await tx.permission.findMany({ select: { id: true, code: true } })).map((row) => [
                row.code as string,
                row.id,
              ]),
            );
            const branch = async (label: string) =>
              (
                await tx.branch.create({
                  data: { code: `SVC-${label}-${run}`, name: `Branch ${label}` },
                  select: { id: true },
                })
              ).id;
            const [A, B] = [await branch('A'), await branch('B')];
            let sequence = 0;
            const principal = async (
              kind: 'EMPLOYEE' | 'CUSTOMER' | 'OWNER',
              member: string[] = [],
            ) => {
              const id = randomUUID();
              userIds.push(id);
              sequence += 1;
              await tx.user.create({
                data: {
                  id,
                  kind,
                  status: 'ACTIVE',
                  fullName: `Fixture ${sequence}`,
                  preferredLocale: 'vi',
                  emailCanonical: `svc-${sequence}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `svc-${sequence}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: kind === 'CUSTOMER' ? new Date() : null,
                  phoneCanonical:
                    kind === 'OWNER'
                      ? null
                      : `+84917${randomInt(0, 1_000_000).toString().padStart(6, '0')}`,
                  normalizationVersion: 1,
                  passwordHash: hash,
                  ...(kind === 'EMPLOYEE'
                    ? {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `SV-${sequence}-${run}`,
                            dateOfBirth: new Date('1992-01-01'),
                            address: 'Fixture',
                          },
                        },
                      }
                    : {}),
                  ...(kind === 'CUSTOMER'
                    ? {
                        customerProfile: {
                          create: { dateOfBirth: new Date('1992-01-01'), address: 'Fixture' },
                        },
                      }
                    : {}),
                },
                select: { id: true },
              });
              for (const branchId of member) {
                await tx.employeeBranchAssignment.create({
                  data: { employeeUserId: id, branchId, grantedByUserId: id },
                });
              }
              return id;
            };
            const actor = async (
              codes: PermissionCode[],
              scope: { branch?: string; member?: string[] } = {},
            ) => {
              const id = await principal('EMPLOYEE', scope.member ?? []);
              if (codes.length > 0) {
                sequence += 1;
                const role = await tx.role.create({
                  data: {
                    code: `SV_${run}_${sequence}`,
                    displayNameVi: 'Vai trò',
                    displayNameEn: 'Role',
                    permissions: {
                      create: codes.map((code) => ({ permissionId: permissions.get(code)! })),
                    },
                  },
                  select: { id: true },
                });
                await tx.userRoleAssignment.create({
                  data: {
                    userId: id,
                    roleId: role.id,
                    scopeKind: scope.branch ? 'BRANCH' : 'GLOBAL',
                    branchId: scope.branch ?? null,
                  },
                });
              }
              return login(id);
            };
            const login = async (userId: string) => {
              const user = await tx.user.findUniqueOrThrow({
                where: { id: userId },
                select: { credentialVersion: true, authzVersion: true },
              });
              const anonymous = await sessions.createAnonymous(tx);
              return (
                await sessions.rotateAuthenticated(
                  anonymous.token,
                  {
                    userId,
                    passwordHash: hash,
                    credentialVersion: user.credentialVersion,
                    authzVersion: user.authzVersion,
                  },
                  { reauthenticated: false },
                  tx,
                )
              ).token;
            };
            const fails = (work: Promise<unknown>, code: string) =>
              assert.rejects(
                work,
                (error: unknown) => error instanceof AuthError && error.code === code,
              );
            const audit = (entityId: string, action: string) =>
              tx.auditEvent.findMany({
                where: { entityId, action },
                orderBy: { occurredAt: 'asc' },
              });

            // Principals: Owner (or a GLOBAL all-catalog admin), a GLOBAL catalog manager
            // without price authority, a price manager, a branch-A service manager, staff.
            const ownerSession = existingOwner
              ? await actor(['MANAGE_SERVICES', 'MANAGE_SERVICE_PRICES'])
              : await login(await principal('OWNER'));
            const catalogManager = await actor(['MANAGE_SERVICES']);
            const priceManager = await actor(['MANAGE_SERVICE_PRICES']);
            const branchManager = await actor(['MANAGE_SERVICES'], { branch: A, member: [A] });
            const staff = await actor([], { member: [A] });
            const customer = await login(await principal('CUSTOMER'));

            let categoryId = '';
            await context.test(
              'categories: GLOBAL only, validated, versioned, audited',
              async () => {
                const created = await catalog.createCategory(catalogManager, {
                  code: ` hair_${run} `,
                  nameVi: ' Gội đầu ',
                  nameEn: 'Hair wash',
                  sortOrder: 10,
                });
                categoryId = created.id;
                assert.equal(created.code, `HAIR_${run}`);
                assert.equal(created.nameVi, 'Gội đầu');
                assert.equal(created.version, 1);
                assert.equal((await audit(created.id, 'SERVICE_CATEGORY_CREATED')).length, 1);
                await fails(
                  catalog.createCategory(catalogManager, {
                    code: `hair_${run}`,
                    nameVi: 'x',
                    nameEn: 'y',
                  }),
                  'CONFLICT',
                );
                await fails(
                  catalog.createCategory(catalogManager, {
                    code: '9BAD',
                    nameVi: 'x',
                    nameEn: 'y',
                  }),
                  'VALIDATION_FAILED',
                );
                await fails(
                  catalog.createCategory(catalogManager, {
                    code: `OK_${run}`,
                    nameVi: ' ',
                    nameEn: 'y',
                  }),
                  'VALIDATION_FAILED',
                );
                await fails(
                  catalog.createCategory(catalogManager, {
                    code: `OK_${run}`,
                    nameVi: 'x',
                    nameEn: 'y',
                    sortOrder: -1,
                  }),
                  'VALIDATION_FAILED',
                );
                for (const denied of [branchManager, priceManager, staff]) {
                  await fails(
                    catalog.createCategory(denied, { code: `NO_${run}`, nameVi: 'x', nameEn: 'y' }),
                    'FORBIDDEN',
                  );
                }
                await fails(catalog.listCategories(customer), 'FORBIDDEN');
                await fails(catalog.listCategories(undefined), 'AUTHENTICATION_REQUIRED');

                const updated = await catalog.updateCategory(catalogManager, categoryId, {
                  expectedVersion: 1,
                  nameEn: 'Hair care',
                  sortOrder: 5,
                });
                assert.equal(updated.version, 2);
                const [event] = await audit(categoryId, 'SERVICE_CATEGORY_UPDATED');
                assert.deepEqual(event?.before, { nameEn: 'Hair wash', sortOrder: 10 });
                assert.deepEqual(event?.after, { nameEn: 'Hair care', sortOrder: 5 });
                await fails(
                  catalog.updateCategory(catalogManager, categoryId, {
                    expectedVersion: 1,
                    nameEn: 'Stale',
                  }),
                  'CONFLICT',
                );
                await fails(
                  catalog.updateCategory(catalogManager, categoryId, {
                    expectedVersion: 2,
                    nameEn: 'Hair care',
                  }),
                  'VALIDATION_FAILED',
                );
                // Deactivate a spare category: staff no longer see it; managers still do.
                const spare = await catalog.createCategory(catalogManager, {
                  code: `SPARE_${run}`,
                  nameVi: 'Dự phòng',
                  nameEn: 'Spare',
                });
                const off = await catalog.setCategoryStatus(catalogManager, spare.id, {
                  expectedVersion: 1,
                  isActive: false,
                  reason: 'Not offered',
                });
                assert.equal(off.isActive, false);
                await fails(
                  catalog.setCategoryStatus(catalogManager, spare.id, {
                    expectedVersion: 2,
                    isActive: false,
                    reason: 'Again',
                  }),
                  'CONFLICT',
                );
                const staffView = (await catalog.listCategories(staff)).categories.map((c) => c.id);
                assert.ok(staffView.includes(categoryId) && !staffView.includes(spare.id));
                const managerView = (await catalog.listCategories(catalogManager)).categories.map(
                  (c) => c.id,
                );
                assert.ok(managerView.includes(spare.id));
              },
            );

            let serviceId = '';
            await context.test(
              'services: master data, separate offerings, validated, audited',
              async () => {
                const base = {
                  categoryId,
                  nameVi: 'Massage chân',
                  nameEn: 'Foot massage',
                  priceVnd: '150000',
                  durationMinutes: 30,
                };
                const short = await catalog.createService(ownerSession, {
                  ...base,
                  code: `foot_30_${run}`,
                  reason: 'Launch',
                });
                serviceId = short.id;
                assert.equal(short.code, `FOOT_30_${run}`);
                assert.equal(short.priceVnd, '150000');
                assert.equal(short.durationMinutes, 30);
                assert.deepEqual(short.availability, [], 'offered nowhere until configured');
                // A 60-minute offering is its own service.
                const long = await catalog.createService(ownerSession, {
                  ...base,
                  code: `FOOT_60_${run}`,
                  priceVnd: '250000',
                  durationMinutes: 60,
                });
                assert.notEqual(long.id, short.id);
                const [created] = await audit(serviceId, 'SERVICE_CREATED');
                assert.equal((created?.after as { priceVnd: string }).priceVnd, '150000');
                assert.equal(created?.branchId, null);

                // Creating sets a price, so MANAGE_SERVICES alone is not enough.
                await fails(
                  catalog.createService(catalogManager, { ...base, code: `NOPRICE_${run}` }),
                  'FORBIDDEN',
                );
                await fails(
                  catalog.createService(ownerSession, {
                    ...base,
                    code: `D0_${run}`,
                    durationMinutes: 0,
                  }),
                  'VALIDATION_FAILED',
                );
                await fails(
                  catalog.createService(ownerSession, {
                    ...base,
                    code: `D1_${run}`,
                    durationMinutes: 1441,
                  }),
                  'VALIDATION_FAILED',
                );
                await fails(
                  catalog.createService(ownerSession, {
                    ...base,
                    code: `P1_${run}`,
                    priceVnd: '-1',
                  }),
                  'VALIDATION_FAILED',
                );
                await fails(
                  catalog.createService(ownerSession, {
                    ...base,
                    code: `C1_${run}`,
                    categoryId: randomUUID(),
                  }),
                  'VALIDATION_FAILED',
                );
                await fails(
                  catalog.createService(ownerSession, { ...base, code: `FOOT_30_${run}` }),
                  'CONFLICT',
                );

                const updated = await catalog.updateService(catalogManager, serviceId, {
                  expectedVersion: 1,
                  nameEn: 'Foot massage (30 min)',
                  durationMinutes: 35,
                  descriptionVi: 'Thư giãn',
                });
                assert.equal(updated.version, 2);
                assert.equal(updated.priceVnd, '150000', 'price untouched by master edits');
                const [event] = await audit(serviceId, 'SERVICE_UPDATED');
                assert.deepEqual(event?.before, {
                  nameEn: 'Foot massage',
                  descriptionVi: null,
                  durationMinutes: 30,
                });
                await fails(
                  catalog.updateService(catalogManager, serviceId, {
                    expectedVersion: 1,
                    nameVi: 'Stale',
                  }),
                  'CONFLICT',
                );
                // Branch-scoped MANAGE_SERVICES never edits master data.
                await fails(
                  catalog.updateService(branchManager, serviceId, {
                    expectedVersion: 2,
                    nameVi: 'Tên mới',
                  }),
                  'FORBIDDEN',
                );
                await fails(
                  catalog.updateService(branchManager, serviceId, {
                    expectedVersion: 2,
                    durationMinutes: 45,
                  }),
                  'FORBIDDEN',
                );
                await fails(
                  catalog.setServiceStatus(branchManager, serviceId, {
                    expectedVersion: 2,
                    isActive: false,
                    reason: 'x',
                  }),
                  'FORBIDDEN',
                );
                // Inactive services disappear for staff but remain for catalog managers.
                const off = await catalog.setServiceStatus(catalogManager, long.id, {
                  expectedVersion: 1,
                  isActive: false,
                  reason: 'Seasonal',
                });
                assert.equal(off.isActive, false);
                await fails(catalog.getService(staff, long.id), 'NOT_FOUND');
                assert.equal((await catalog.getService(catalogManager, long.id)).isActive, false);
                assert.equal(
                  await tx.service.count({ where: { id: long.id } }),
                  1,
                  'never deleted',
                );
              },
            );

            await context.test(
              'price: GLOBAL_ONLY MANAGE_SERVICE_PRICES, audited before/after',
              async () => {
                const current = await catalog.getService(ownerSession, serviceId);
                for (const denied of [catalogManager, branchManager, staff]) {
                  await fails(
                    catalog.setPrice(denied, serviceId, {
                      expectedVersion: current.version,
                      priceVnd: '1',
                      reason: 'Discount',
                    }),
                    'FORBIDDEN',
                  );
                }
                const priced = await catalog.setPrice(priceManager, serviceId, {
                  expectedVersion: current.version,
                  priceVnd: '180000',
                  reason: 'New menu',
                });
                assert.equal(priced.priceVnd, '180000');
                assert.equal(priced.version, current.version + 1);
                const [event] = await audit(serviceId, 'SERVICE_PRICE_CHANGED');
                assert.deepEqual(event?.before, { priceVnd: '150000' });
                assert.deepEqual(event?.after, { priceVnd: '180000' });
                assert.equal(event?.reason, 'New menu');
                assert.equal(event?.dataClassification, 'STANDARD');
                await fails(
                  catalog.setPrice(priceManager, serviceId, {
                    expectedVersion: current.version,
                    priceVnd: '190000',
                    reason: 'Stale',
                  }),
                  'CONFLICT',
                );
                await fails(
                  catalog.setPrice(priceManager, serviceId, {
                    expectedVersion: priced.version,
                    priceVnd: '180000',
                    reason: 'Same',
                  }),
                  'VALIDATION_FAILED',
                );
                assert.equal(
                  (await catalog.getService(ownerSession, serviceId)).priceVnd,
                  '180000',
                );
              },
            );

            await context.test(
              'availability: explicit rows, own branch only for branch scope',
              async () => {
                // No row: not offered at A.
                assert.equal(
                  (await catalog.listServices(staff, { branchId: A })).services.some(
                    (s) => s.id === serviceId,
                  ),
                  false,
                );
                const enabled = await catalog.setAvailability(branchManager, serviceId, A, {
                  expectedVersion: null,
                  isActive: true,
                  reason: 'Offered in Q1',
                });
                assert.deepEqual(enabled.availability, [
                  { branchId: A, isActive: true, version: 1 },
                ]);
                assert.ok(
                  (await catalog.listServices(staff, { branchId: A })).services.some(
                    (s) => s.id === serviceId,
                  ),
                );
                const [event] = await audit(serviceId, 'SERVICE_AVAILABILITY_CHANGED');
                assert.equal(event?.branchId, A);
                assert.deepEqual(event?.before, { branchId: A, isActive: null });
                assert.deepEqual(event?.after, { branchId: A, isActive: true });
                // Master version untouched by availability.
                assert.equal(
                  enabled.version,
                  (await catalog.getService(ownerSession, serviceId)).version,
                );

                // Another branch is invisible to a branch-A manager.
                await fails(
                  catalog.setAvailability(branchManager, serviceId, B, {
                    expectedVersion: null,
                    isActive: true,
                  }),
                  'NOT_FOUND',
                );
                await fails(catalog.listServices(branchManager, { branchId: B }), 'NOT_FOUND');
                // Stale or missing version, and no-op states.
                await fails(
                  catalog.setAvailability(branchManager, serviceId, A, {
                    expectedVersion: null,
                    isActive: false,
                  }),
                  'CONFLICT',
                );
                await fails(
                  catalog.setAvailability(branchManager, serviceId, A, {
                    expectedVersion: 1,
                    isActive: true,
                  }),
                  'CONFLICT',
                );
                const disabled = await catalog.setAvailability(branchManager, serviceId, A, {
                  expectedVersion: 1,
                  isActive: false,
                });
                assert.deepEqual(disabled.availability, [
                  { branchId: A, isActive: false, version: 2 },
                ]);
                assert.equal(
                  (await catalog.listServices(staff, { branchId: A })).services.some(
                    (s) => s.id === serviceId,
                  ),
                  false,
                );
                await fails(
                  catalog.setAvailability(branchManager, randomUUID(), A, {
                    expectedVersion: null,
                    isActive: true,
                  }),
                  'NOT_FOUND',
                );
                // A GLOBAL catalog manager manages any branch; branch-scoped callers see
                // only their branch's availability entries.
                await catalog.setAvailability(catalogManager, serviceId, B, {
                  expectedVersion: null,
                  isActive: true,
                });
                const globalView = await catalog.getService(catalogManager, serviceId);
                assert.deepEqual(
                  globalView.availability.map((entry) => entry.branchId).sort(),
                  [A, B].sort(),
                );
                const localView = await catalog.getService(branchManager, serviceId);
                assert.deepEqual(
                  localView.availability.map((entry) => entry.branchId),
                  [A],
                );
                // Staff and price managers without MANAGE_SERVICES cannot toggle.
                await fails(
                  catalog.setAvailability(staff, serviceId, A, {
                    expectedVersion: 2,
                    isActive: true,
                  }),
                  'FORBIDDEN',
                );
                await fails(
                  catalog.setAvailability(customer, serviceId, A, {
                    expectedVersion: 2,
                    isActive: true,
                  }),
                  'FORBIDDEN',
                );
              },
            );

            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            throw rollback;
          },
          { timeout: 180_000 },
        ),
        (error: unknown) => error === rollback,
      );
      assert.equal(await database.service.count(), counts.services);
      assert.equal(await database.serviceCategory.count(), counts.categories);
      assert.equal(await database.user.count({ where: { id: { in: userIds } } }), 0);
      assert.equal(
        (await database.user.findFirst({ where: { kind: 'OWNER' }, select: { id: true } }))?.id,
        existingOwner?.id,
        'no Owner created',
      );
    } finally {
      await database.$disconnect();
    }
  },
);
