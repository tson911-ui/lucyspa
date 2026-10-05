import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { ServiceExecutionService } from './service-execution.service.js';
import { validVnMobile } from '../testing/phone.js';

// Added for the final Phase 3 gate. NOT EXECUTED during Step 7 implementation.
test(
  'Step 7 execution lifecycle, scope, ordering and database facts; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
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
    const rollback = new Error('Step 7 fixture rollback');
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    try {
      await assert.rejects(
        database.$transaction(
          async (tx: Prisma.TransactionClient) => {
            let n = 0;
            let savepoint = 0;
            const isolated = async <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => {
              const name = `execution_command_${++savepoint}`;
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
            const executions = new ServiceExecutionService(
              {
                withTransaction: isolated,
                withExclusiveTransaction: isolated,
                resolveForMutation: (token: string) => sessions.resolveForMutation(token, tx),
              },
              new AuthThrottleService(environment),
            );
            const fails = async (work: () => Promise<unknown>, code: string) => {
              await assert.rejects(
                work,
                (error: unknown) => error instanceof AuthError && error.code === code,
              );
            };
            const [clock] = await tx.$queryRaw<{ now: Date; hour: number }[]>`
          SELECT clock_timestamp() AS now, extract(hour FROM clock_timestamp() AT TIME ZONE 'UTC')::int AS hour`;
            const now = clock!.now;
            const offset = 12 - clock!.hour;
            const zone =
              offset === 0 ? 'UTC' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
            const today = new Date(now.getTime() + offset * 3_600_000).toISOString().slice(0, 10);
            const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
            const branch = await tx.branch.create({
              data: { code: `EXEC_${run}`, name: 'Execution fixture', timezone: zone },
            });
            const elsewhere = await tx.branch.create({
              data: { code: `EXEC_OTHER_${run}`, name: 'Other', timezone: zone },
            });
            for (let isoWeekday = 1; isoWeekday <= 7; isoWeekday++) {
              await tx.branchOperatingHours.create({
                data: { branchId: branch.id, isoWeekday, opensAtMinute: 0, closesAtMinute: 1440 },
              });
            }
            await syncPermissionCatalog(tx);
            const permission = await tx.permission.findUniqueOrThrow({
              where: { code: 'PERFORM_SERVICES' },
            });
            const role = await tx.role.create({
              data: {
                code: `EXEC_${run}`,
                displayNameVi: 'Execution',
                displayNameEn: 'Execution',
                permissions: { create: { permissionId: permission.id } },
              },
            });
            const category = await tx.serviceCategory.create({
              data: { code: `EXEC_${run}`, nameVi: 'Group', nameEn: 'Group' },
            });
            const skill = await tx.skill.create({
              data: { code: `EXEC_${run}`, nameVi: 'Skill', nameEn: 'Skill' },
            });
            const service = await tx.service.create({
              data: {
                code: `EXEC_${run}`,
                categoryId: category.id,
                nameVi: 'Service',
                nameEn: 'Service',
                priceVnd: 100_000n,
                priceMaxVnd: 100_000n,
                durationMinutes: 60,
                estimatedMinMinutes: 60,
                estimatedMaxMinutes: 60,
              },
            });
            await tx.serviceBranchAvailability.create({
              data: { serviceId: service.id, branchId: branch.id },
            });
            await tx.serviceSkill.create({ data: { serviceId: service.id, skillId: skill.id } });

            const ktv = async (options: { permission?: boolean; checkedIn?: boolean } = {}) => {
              n++;
              const user = await tx.user.create({
                data: {
                  kind: 'EMPLOYEE',
                  status: 'ACTIVE',
                  fullName: `Execution ${n}`,
                  preferredLocale: 'vi',
                  phoneCanonical: validVnMobile(),
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                  employeeProfile: {
                    create: {
                      employeeCodeCanonical: `EXEC_${run}_${n}`,
                      dateOfBirth: new Date('1990-01-01'),
                      address: 'Fixture',
                    },
                  },
                },
              });
              await tx.employmentClassificationChange.create({
                data: {
                  employeeUserId: user.id,
                  classification: 'OFFICIAL_EMPLOYEE',
                  effectiveDate: new Date('2020-01-01'),
                },
              });
              await tx.employeeBranchAssignment.create({
                data: { employeeUserId: user.id, branchId: branch.id, grantedByUserId: user.id },
              });
              await tx.employeeSkill.create({
                data: { employeeUserId: user.id, skillId: skill.id, grantedByUserId: user.id },
              });
              if (options.permission !== false)
                await tx.userRoleAssignment.create({
                  data: {
                    userId: user.id,
                    roleId: role.id,
                    scopeKind: 'BRANCH',
                    branchId: branch.id,
                  },
                });
              if (options.checkedIn !== false)
                await tx.attendanceRecord.create({
                  data: {
                    employeeUserId: user.id,
                    branchId: branch.id,
                    businessDate: new Date(today),
                    checkInAt: at(-180),
                  },
                });
              const token = (
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
              return { id: user.id, token };
            };

            const visit = async (
              employees: string[],
              baseMinute = -120,
              splitParticipants = false,
            ) => {
              const row = await tx.visit.create({
                data: {
                  code: `EXEC-${run}-${++n}`,
                  branchId: branch.id,
                  origin: 'WALK_IN',
                  serviceDate: new Date(today),
                  arrivedAt: at(-180),
                  createdByUserId: employees[0]!,
                },
              });
              const participant = await tx.visitParticipant.create({
                data: { visitId: row.id, kind: 'GUEST', displayName: 'Guest' },
              });
              const lines = [];
              for (const [index, employeeUserId] of employees.entries()) {
                const person =
                  splitParticipants && index > 0
                    ? await tx.visitParticipant.create({
                        data: { visitId: row.id, kind: 'GUEST', displayName: 'Other guest' },
                      })
                    : participant;
                lines.push(
                  await tx.visitServiceLine.create({
                    data: {
                      visitId: row.id,
                      participantId: person.id,
                      sequence: splitParticipants ? 1 : index + 1,
                      serviceId: service.id,
                      employeeUserId,
                      assignmentMode: 'SPECIFIC',
                      plannedStartAt: at(baseMinute + index * 15),
                      plannedEndAt: at(baseMinute + index * 15 + 10),
                      durationMinutes: 10,
                      bufferMinutes: 0,
                      serviceCode: service.code,
                      serviceNameVi: 'Service',
                      serviceNameEn: 'Service',
                      catalogPriceMinVnd: 100_000n,
                      catalogPriceMaxVnd: 100_000n,
                      catalogPricingUnit: 'PER_SERVICE',
                    },
                  }),
                );
              }
              return { row, lines };
            };

            await suite.test(
              'START/END are idempotent, immutable actual facts with one audit/outbox per transition',
              async () => {
                const actor = await ktv();
                const {
                  row,
                  lines: [line],
                } = await visit([actor.id]);
                const started = await executions.start(actor.token, line!.id);
                assert.equal(started.status, 'IN_PROGRESS');
                assert.equal(started.visitStatus, 'IN_SERVICE');
                assert.equal(
                  Date.parse(started.execution!.expectedEndAt) -
                    Date.parse(started.execution!.startedAt),
                  600_000,
                );
                const again = await executions.start(actor.token, line!.id);
                assert.deepEqual(again.execution, started.execution);
                const ended = await executions.end(actor.token, line!.id);
                const repeat = await executions.end(actor.token, line!.id);
                assert.deepEqual(repeat.execution, ended.execution);
                assert.equal(ended.status, 'DONE');
                assert.equal(ended.visitStatus, 'COMPLETED');
                assert.equal(ended.execution!.endKind, 'NORMAL');
                assert.ok(
                  Date.parse(ended.execution!.endedAt!) >= Date.parse(ended.execution!.startedAt),
                );
                const stored = await tx.visitServiceLine.findUniqueOrThrow({
                  where: { id: line!.id },
                });
                assert.deepEqual(stored.plannedStartAt, line!.plannedStartAt);
                assert.deepEqual(stored.plannedEndAt, line!.plannedEndAt);
                assert.ok(
                  (await tx.visit.findUniqueOrThrow({ where: { id: row.id } })).completedAt,
                );
                assert.equal(
                  await tx.auditEvent.count({
                    where: {
                      entityId: ended.execution!.id,
                      action: { in: ['SERVICE_STARTED', 'SERVICE_ENDED'] },
                    },
                  }),
                  2,
                );
                assert.equal(
                  await tx.outboxEvent.count({
                    where: {
                      aggregateId: ended.execution!.id,
                      eventType: { in: ['SERVICE_STARTED', 'SERVICE_ENDED'] },
                    },
                  }),
                  2,
                );
                const [claims] = await tx.$queryRaw<
                  { n: bigint }[]
                >`SELECT count(*) AS n FROM ktv_occupancies WHERE visit_service_line_id = ${line!.id}::uuid`;
                assert.equal(Number(claims!.n), 0);
                await fails(
                  () => executions.start(actor.token, line!.id),
                  'SERVICE_START_NOT_ALLOWED',
                );
              },
            );

            await suite.test(
              'preceding service must finish; consecutive different KTV assignments are preserved',
              async () => {
                const a = await ktv();
                const b = await ktv();
                const { lines } = await visit([a.id, b.id]);
                await fails(
                  () => executions.start(b.token, lines[1]!.id),
                  'SERVICE_SEQUENCE_BLOCKED',
                );
                await executions.start(a.token, lines[0]!.id);
                await fails(
                  () => executions.start(b.token, lines[1]!.id),
                  'SERVICE_SEQUENCE_BLOCKED',
                );
                assert.equal(
                  (await executions.end(a.token, lines[0]!.id)).visitStatus,
                  'IN_SERVICE',
                );
                assert.equal((await executions.start(b.token, lines[1]!.id)).status, 'IN_PROGRESS');
                assert.equal(
                  (await executions.end(b.token, lines[1]!.id)).visitStatus,
                  'COMPLETED',
                );
                assert.equal(
                  (await tx.visitServiceLine.findUniqueOrThrow({ where: { id: lines[1]!.id } }))
                    .employeeUserId,
                  b.id,
                );
              },
            );

            await suite.test(
              'different participants can execute independently; one KTV cannot START another customer',
              async () => {
                const a = await ktv();
                const b = await ktv();
                const { lines } = await visit([a.id, b.id], -120, true);
                const other = await visit([a.id], -60);
                await executions.start(a.token, lines[0]!.id);
                await executions.start(b.token, lines[1]!.id);
                await fails(
                  () => executions.start(a.token, other.lines[0]!.id),
                  'SERVICE_KTV_BUSY',
                );
                await executions.end(a.token, lines[0]!.id);
                await executions.end(b.token, lines[1]!.id);
                assert.equal(
                  (await executions.start(a.token, other.lines[0]!.id)).status,
                  'IN_PROGRESS',
                );
                await executions.end(a.token, other.lines[0]!.id);
              },
            );

            await suite.test(
              'END before START, another KTV, missing permission and wrong branch are refused',
              async () => {
                const a = await ktv();
                const b = await ktv();
                const denied = await ktv({ permission: false });
                const own = await visit([a.id]);
                const forbidden = await visit([denied.id]);
                await fails(
                  () => executions.end(a.token, own.lines[0]!.id),
                  'SERVICE_END_NOT_ALLOWED',
                );
                await fails(() => executions.start(b.token, own.lines[0]!.id), 'NOT_FOUND');
                await fails(
                  () => executions.start(denied.token, forbidden.lines[0]!.id),
                  'FORBIDDEN',
                );
                await fails(() => executions.myWork(a.token, elsewhere.id), 'FORBIDDEN');
                await fails(
                  () => executions.start(undefined, own.lines[0]!.id),
                  'AUTHENTICATION_REQUIRED',
                );
                assert.equal(
                  await tx.serviceExecution.count({
                    where: { visitServiceLineId: own.lines[0]!.id },
                  }),
                  0,
                );
              },
            );

            await suite.test(
              'attendance is required to START; checkout never substitutes END',
              async () => {
                const absent = await ktv({ checkedIn: false });
                const own = await visit([absent.id]);
                await fails(
                  () => executions.start(absent.token, own.lines[0]!.id),
                  'SERVICE_START_UNAVAILABLE',
                );
                const attendance = await tx.attendanceRecord.create({
                  data: {
                    employeeUserId: absent.id,
                    branchId: branch.id,
                    businessDate: new Date(today),
                    checkInAt: at(-1),
                  },
                });
                await executions.start(absent.token, own.lines[0]!.id);
                await tx.attendanceRecord.update({
                  where: { id: attendance.id },
                  data: { checkOutAt: new Date(), rowVersion: { increment: 1 } },
                });
                assert.equal(
                  (await executions.get(absent.token, own.lines[0]!.id)).execution!.status,
                  'IN_PROGRESS',
                );
                assert.equal((await executions.end(absent.token, own.lines[0]!.id)).status, 'DONE');
              },
            );

            await suite.test('future planned start and cancelled line cannot START', async () => {
              const actor = await ktv();
              const future = await visit([actor.id], 60);
              await fails(
                () => executions.start(actor.token, future.lines[0]!.id),
                'SERVICE_NOT_READY',
              );
              await tx.visitServiceLine.update({
                where: { id: future.lines[0]!.id },
                data: {
                  status: 'CANCELLED',
                  cancelledAt: now,
                  cancelledByUserId: actor.id,
                  cancelReason: 'Fixture cancellation',
                  rowVersion: { increment: 1 },
                },
              });
              await fails(
                () => executions.start(actor.token, future.lines[0]!.id),
                'SERVICE_START_NOT_ALLOWED',
              );
            });
            await suite.test(
              'WAITING cannot START and prevents premature visit completion',
              async () => {
                const actor = await ktv();
                const own = await visit([actor.id]);
                const waiting = await tx.visitServiceLine.create({
                  data: {
                    visitId: own.row.id,
                    participantId: own.lines[0]!.participantId,
                    sequence: 2,
                    serviceId: service.id,
                    status: 'WAITING',
                    assignmentMode: 'ANY',
                    durationMinutes: 10,
                    serviceCode: service.code,
                    serviceNameVi: 'Service',
                    serviceNameEn: 'Service',
                    catalogPriceMinVnd: 100_000n,
                    catalogPriceMaxVnd: 100_000n,
                    catalogPricingUnit: 'PER_SERVICE',
                  },
                });
                await fails(() => executions.start(actor.token, waiting.id), 'NOT_FOUND');
                await executions.start(actor.token, own.lines[0]!.id);
                assert.equal(
                  (await executions.end(actor.token, own.lines[0]!.id)).visitStatus,
                  'IN_SERVICE',
                );
                assert.equal(
                  await tx.serviceExecution.count({ where: { visitServiceLineId: waiting.id } }),
                  0,
                );
              },
            );
            throw rollback;
          },
          { timeout: 120_000 },
        ),
        (error: unknown) => error === rollback,
      );
    } finally {
      await database.$disconnect();
    }
  },
);
