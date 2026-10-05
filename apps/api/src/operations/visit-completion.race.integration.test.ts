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
import { takeSharedAuthGraphLock } from '../auth/auth-store.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { ServiceExecutionService } from './service-execution.service.js';
import { validVnMobile } from '../testing/phone.js';

/**
 * Phase 4 Step 2 races on separate committed PostgreSQL connections, with real production
 * service calls. A two-party latch releases only after both transactions hold the shared
 * auth-graph lock; every remaining lock (users, session, visit, line, execution) is taken by
 * production code. Requires an explicitly opted-in local superuser validation database (replica
 * role cleanup). Cleanup is bounded to this invocation's exact UUIDs.
 */
test(
  'Phase 4 Step 2 PostgreSQL races keep one authoritative outcome',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl);
    const database = createDatabaseClient(databaseUrl);
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
    const sessions = new SessionService({ client: database } as PrismaService, environment);
    let meet: (() => Promise<void>) | null = null;
    const withTransaction = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
      database.$transaction(
        async (tx) => {
          await takeSharedAuthGraphLock(tx);
          if (meet) await meet();
          return work(tx);
        },
        { timeout: 30_000, maxWait: 10_000 },
      );
    const executions = new ServiceExecutionService(
      {
        withTransaction,
        withExclusiveTransaction: withTransaction,
        resolveForMutation: (token: string, tx: Prisma.TransactionClient) =>
          sessions.resolveForMutation(token, tx),
      },
      new AuthThrottleService(environment),
    );
    const ids = {
      branch: randomUUID(),
      category: randomUUID(),
      skill: randomUUID(),
      service: randomUUID(),
      role: randomUUID(),
    };
    const userIds: string[] = [];
    const sessionIds: string[] = [];
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    let serial = 0;
    const outcome = (result: PromiseSettledResult<unknown>) => {
      if (result.status === 'fulfilled') return 'OK';
      assert.ok(result.reason instanceof AuthError, String(result.reason));
      return result.reason.code;
    };
    const race = async <A, B>(first: () => Promise<A>, second: () => Promise<B>) => {
      let count = 0;
      let release!: () => void;
      let fail!: (error: Error) => void;
      const gate = new Promise<void>((resolve, reject) => {
        release = resolve;
        fail = reject;
      });
      const timer = setTimeout(
        () => fail(new Error('Both race transactions must reach the latch.')),
        10_000,
      );
      meet = async () => {
        if (++count === 2) release();
        await gate;
      };
      try {
        const results = await Promise.allSettled([first(), second()] as const);
        assert.equal(count, 2, 'two independent transactions competed');
        return results;
      } finally {
        clearTimeout(timer);
        meet = null;
      }
    };
    try {
      const [clock] = await database.$queryRaw<{ now: Date; hour: number }[]>`
        SELECT clock_timestamp() AS now, extract(hour FROM clock_timestamp() AT TIME ZONE 'UTC')::int AS hour`;
      const offset = 12 - clock!.hour;
      const zone = offset === 0 ? 'UTC' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
      const today = new Date(clock!.now.getTime() + offset * 3_600_000).toISOString().slice(0, 10);
      const at = (minutes: number) => new Date(clock!.now.getTime() + minutes * 60_000);
      await database.$transaction(async (tx) => {
        await tx.branch.create({
          data: { id: ids.branch, code: `VCR_${run}`, name: 'Completion race', timezone: zone },
        });
        for (let isoWeekday = 1; isoWeekday <= 7; isoWeekday++)
          await tx.branchOperatingHours.create({
            data: { branchId: ids.branch, isoWeekday, opensAtMinute: 0, closesAtMinute: 1440 },
          });
        await tx.skill.create({
          data: { id: ids.skill, code: `VCR_${run}`, nameVi: 'Race', nameEn: 'Race' },
        });
        await tx.serviceCategory.create({
          data: { id: ids.category, code: `VCR_${run}`, nameVi: 'Race', nameEn: 'Race' },
        });
        await tx.service.create({
          data: {
            id: ids.service,
            code: `VCR_${run}`,
            categoryId: ids.category,
            nameVi: 'Race',
            nameEn: 'Race',
            priceVnd: 1n,
            priceMaxVnd: 1n,
            durationMinutes: 10,
            estimatedMinMinutes: 10,
            estimatedMaxMinutes: 10,
          },
        });
        await tx.serviceSkill.create({ data: { serviceId: ids.service, skillId: ids.skill } });
        await tx.serviceBranchAvailability.create({
          data: { serviceId: ids.service, branchId: ids.branch },
        });
        await syncPermissionCatalog(tx);
        const permissions = await tx.permission.findMany({
          where: {
            code: { in: ['PERFORM_SERVICES', 'RESOLVE_SERVICE_EXECUTION', 'MANAGE_BOOKINGS'] },
          },
          select: { id: true },
        });
        assert.equal(permissions.length, 3);
        await tx.role.create({
          data: {
            id: ids.role,
            code: `VCR_${run}`,
            displayNameVi: 'Race',
            displayNameEn: 'Race',
            permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
          },
        });
      });
      const staff = () =>
        database.$transaction(async (tx) => {
          const id = randomUUID();
          userIds.push(id);
          const user = await tx.user.create({
            data: {
              id,
              kind: 'EMPLOYEE',
              status: 'ACTIVE',
              fullName: 'Race employee',
              preferredLocale: 'vi',
              normalizationVersion: 1,
              passwordHash: '$argon2id$fixture',
              phoneCanonical: validVnMobile(),
              employeeProfile: {
                create: {
                  employeeCodeCanonical: `VCR_${run}_${++serial}`,
                  dateOfBirth: new Date('1990-01-01'),
                  address: 'Fixture',
                },
              },
            },
          });
          await tx.employmentClassificationChange.create({
            data: {
              employeeUserId: id,
              classification: 'OFFICIAL_EMPLOYEE',
              effectiveDate: new Date('2020-01-01'),
            },
          });
          await tx.employeeBranchAssignment.create({
            data: { employeeUserId: id, branchId: ids.branch, grantedByUserId: id },
          });
          await tx.employeeSkill.create({
            data: { employeeUserId: id, skillId: ids.skill, grantedByUserId: id },
          });
          await tx.attendanceRecord.create({
            data: {
              employeeUserId: id,
              branchId: ids.branch,
              businessDate: new Date(today),
              checkInAt: at(-180),
            },
          });
          await tx.userRoleAssignment.create({
            data: { userId: id, roleId: ids.role, scopeKind: 'BRANCH', branchId: ids.branch },
          });
          const anonymous = await sessions.createAnonymous(tx);
          sessionIds.push(anonymous.session.id);
          const issued = await sessions.rotateAuthenticated(
            anonymous.token,
            {
              userId: id,
              passwordHash: user.passwordHash!,
              credentialVersion: user.credentialVersion,
              authzVersion: user.authzVersion,
            },
            { reauthenticated: false },
            tx,
          );
          sessionIds.push(issued.session.id);
          return { id, token: issued.token };
        });
      /** A visit with one PLANNED line for `employee`; `running` makes it a forgotten (past-due) END. */
      const lineFor = (employee: { id: string }, running: boolean) =>
        database.$transaction(async (tx) => {
          const visit = await tx.visit.create({
            data: {
              code: `VCR-${run}-${++serial}`,
              branchId: ids.branch,
              origin: 'WALK_IN',
              serviceDate: new Date(today),
              arrivedAt: at(-90),
              createdByUserId: employee.id,
            },
          });
          const participant = await tx.visitParticipant.create({
            data: { visitId: visit.id, kind: 'GUEST', displayName: 'Race guest' },
          });
          const line = await tx.visitServiceLine.create({
            data: {
              visitId: visit.id,
              participantId: participant.id,
              sequence: 1,
              serviceId: ids.service,
              employeeUserId: employee.id,
              requestedEmployeeUserId: employee.id,
              assignmentMode: 'SPECIFIC',
              plannedStartAt: at(-60),
              plannedEndAt: at(-50),
              durationMinutes: 10,
              bufferMinutes: 0,
              serviceCode: `VCR_${run}`,
              serviceNameVi: 'Race',
              serviceNameEn: 'Race',
              catalogPriceMinVnd: 1n,
              catalogPriceMaxVnd: 1n,
              catalogPricingUnit: 'PER_SERVICE',
            },
          });
          if (running) {
            await tx.visitServiceLine.update({
              where: { id: line.id },
              data: { status: 'IN_PROGRESS', rowVersion: { increment: 1 } },
            });
            await tx.visit.update({
              where: { id: visit.id },
              data: { status: 'IN_SERVICE', rowVersion: { increment: 1 } },
            });
            await tx.serviceExecution.create({
              data: {
                visitServiceLineId: line.id,
                employeeUserId: employee.id,
                startedAt: at(-55),
                expectedEndAt: at(-45),
              },
            });
          }
          return { visitId: visit.id, lineId: line.id };
        });
      const events = (executionId: string) =>
        database.outboxEvent.count({
          where: { aggregateId: executionId, eventType: 'SERVICE_ENDED' },
        });
      const audits = (entityId: string, actions: string[]) =>
        database.auditEvent.count({ where: { entityId, action: { in: actions } } });
      const ROUNDS = 4;

      await suite.test(
        'resolution vs resolution: one winner, one audit, one END event',
        async () => {
          for (let round = 0; round < ROUNDS; round++) {
            const performer = await staff();
            const [m1, m2] = [await staff(), await staff()];
            const { lineId, visitId } = await lineFor(performer, true);
            const [a, b] = await race(
              () => executions.resolve(m1.token, lineId, { reason: 'race one' }),
              () => executions.resolve(m2.token, lineId, { reason: 'race two' }),
            );
            const results = [outcome(a), outcome(b)].sort();
            assert.equal(results.filter((code) => code === 'OK').length, 1, results.join());
            const loser = results.find((code) => code !== 'OK');
            assert.ok(
              loser === 'SERVICE_EXECUTION_CONFLICT' || loser === 'SERVICE_RESOLUTION_NOT_ALLOWED',
              String(loser),
            );
            const execution = await database.serviceExecution.findUniqueOrThrow({
              where: { visitServiceLineId: lineId },
            });
            assert.equal(execution.endKind, 'MANAGER_RESOLVED');
            assert.ok(([m1.id, m2.id] as string[]).includes(execution.endedByUserId!));
            assert.equal(await audits(execution.id, ['SERVICE_EXECUTION_RESOLVED']), 1);
            assert.equal(await events(execution.id), 1);
            assert.equal(
              (await database.visit.findUniqueOrThrow({ where: { id: visitId } })).status,
              'COMPLETED',
            );
          }
        },
      );

      await suite.test('normal END vs resolution: exactly one END is recorded', async () => {
        for (let round = 0; round < ROUNDS; round++) {
          const performer = await staff();
          const manager = await staff();
          const { lineId } = await lineFor(performer, true);
          const [end, resolve] = await race(
            () => executions.end(performer.token, lineId),
            () => executions.resolve(manager.token, lineId, { reason: 'race' }),
          );
          const codes = [outcome(end), outcome(resolve)];
          const execution = await database.serviceExecution.findUniqueOrThrow({
            where: { visitServiceLineId: lineId },
          });
          assert.equal(execution.status, 'ENDED');
          // One write path won; the other was refused or returned the winner's facts.
          assert.equal(await events(execution.id), 1, codes.join());
          assert.equal(
            await audits(execution.id, ['SERVICE_ENDED', 'SERVICE_EXECUTION_RESOLVED']),
            1,
            codes.join(),
          );
          if (execution.endKind === 'NORMAL') {
            assert.equal(execution.endedByUserId, performer.id);
            assert.notEqual(codes[1], 'OK', 'a resolution cannot also succeed after a normal END');
            assert.equal(await audits(execution.id, ['SERVICE_EXECUTION_RESOLVED']), 0);
          } else {
            assert.equal(execution.endKind, 'MANAGER_RESOLVED');
            assert.equal(execution.endedByUserId, manager.id);
            assert.equal(codes[1], 'OK');
            assert.equal(await audits(execution.id, ['SERVICE_ENDED']), 0);
          }
        }
      });

      await suite.test('cancellation vs cancellation: one release, one audit', async () => {
        for (let round = 0; round < ROUNDS; round++) {
          const performer = await staff();
          const [m1, m2] = [await staff(), await staff()];
          const { lineId } = await lineFor(performer, false);
          const [a, b] = await race(
            () => executions.cancelLine(m1.token, lineId, { reason: 'race one' }),
            () => executions.cancelLine(m2.token, lineId, { reason: 'race two' }),
          );
          const results = [outcome(a), outcome(b)];
          assert.equal(results.filter((code) => code === 'OK').length, 1, results.join());
          assert.ok(
            results.some(
              (code) =>
                code === 'SERVICE_EXECUTION_CONFLICT' || code === 'SERVICE_LINE_CANCEL_NOT_ALLOWED',
            ),
          );
          const line = await database.visitServiceLine.findUniqueOrThrow({ where: { id: lineId } });
          assert.equal(line.status, 'CANCELLED');
          assert.ok(([m1.id, m2.id] as string[]).includes(line.cancelledByUserId!));
          assert.equal(await audits(lineId, ['VISIT_LINE_CANCELLED']), 1);
          const [claims] = await database.$queryRaw<{ n: bigint }[]>`
            SELECT count(*) AS n FROM ktv_occupancies WHERE visit_service_line_id = ${lineId}::uuid`;
          assert.equal(Number(claims!.n), 0);
        }
      });

      await suite.test('cancellation vs START: never both', async () => {
        for (let round = 0; round < ROUNDS; round++) {
          const performer = await staff();
          const manager = await staff();
          const { lineId } = await lineFor(performer, false);
          const [cancel, start] = await race(
            () => executions.cancelLine(manager.token, lineId, { reason: 'race' }),
            () => executions.start(performer.token, lineId),
          );
          const codes = [outcome(cancel), outcome(start)];
          const line = await database.visitServiceLine.findUniqueOrThrow({ where: { id: lineId } });
          const execution = await database.serviceExecution.findUnique({
            where: { visitServiceLineId: lineId },
          });
          if (line.status === 'CANCELLED') {
            assert.equal(execution, null, codes.join());
            assert.equal(codes[0], 'OK');
            assert.notEqual(codes[1], 'OK');
            assert.equal(await audits(lineId, ['VISIT_LINE_CANCELLED']), 1);
          } else {
            assert.equal(line.status, 'IN_PROGRESS', codes.join());
            assert.ok(execution);
            assert.equal(codes[1], 'OK');
            assert.notEqual(codes[0], 'OK');
            assert.equal(await audits(lineId, ['VISIT_LINE_CANCELLED']), 0);
          }
        }
      });
    } finally {
      meet = null;
      try {
        await database.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
            const visits = (
              await tx.visit.findMany({ where: { branchId: ids.branch }, select: { id: true } })
            ).map((v) => v.id);
            const lines = (
              await tx.visitServiceLine.findMany({
                where: { visitId: { in: visits } },
                select: { id: true },
              })
            ).map((v) => v.id);
            const executionRows = (
              await tx.serviceExecution.findMany({
                where: { visitServiceLineId: { in: lines } },
                select: { id: true },
              })
            ).map((v) => v.id);
            await tx.notification.deleteMany({ where: { branchId: ids.branch } });
            await tx.serviceWarningSchedule.deleteMany({ where: { lineId: { in: lines } } });
            await tx.outboxEvent.deleteMany({
              where: {
                OR: [
                  { branchId: ids.branch },
                  { aggregateId: { in: [...visits, ...executionRows] } },
                ],
              },
            });
            await tx.auditEvent.deleteMany({
              where: { OR: [{ branchId: ids.branch }, { actorUserId: { in: userIds } }] },
            });
            await tx.$executeRaw`DELETE FROM ktv_occupancies WHERE employee_user_id = ANY(${userIds}::uuid[])`;
            await tx.serviceExecution.deleteMany({ where: { id: { in: executionRows } } });
            await tx.visitServiceLine.deleteMany({ where: { id: { in: lines } } });
            await tx.visitParticipant.deleteMany({ where: { visitId: { in: visits } } });
            await tx.visit.deleteMany({ where: { id: { in: visits } } });
            await tx.session.deleteMany({
              where: { OR: [{ id: { in: sessionIds } }, { userId: { in: userIds } }] },
            });
            await tx.userRoleAssignment.deleteMany({ where: { userId: { in: userIds } } });
            await tx.rolePermission.deleteMany({ where: { roleId: ids.role } });
            await tx.role.deleteMany({ where: { id: ids.role } });
            await tx.attendanceRecord.deleteMany({ where: { employeeUserId: { in: userIds } } });
            await tx.employeeSkill.deleteMany({ where: { employeeUserId: { in: userIds } } });
            await tx.employeeBranchAssignment.deleteMany({
              where: { employeeUserId: { in: userIds } },
            });
            await tx.employmentClassificationChange.deleteMany({
              where: { employeeUserId: { in: userIds } },
            });
            await tx.employeeProfile.deleteMany({ where: { userId: { in: userIds } } });
            await tx.user.deleteMany({ where: { id: { in: userIds } } });
            await tx.serviceSkill.deleteMany({ where: { serviceId: ids.service } });
            await tx.serviceBranchAvailability.deleteMany({ where: { serviceId: ids.service } });
            await tx.service.deleteMany({ where: { id: ids.service } });
            await tx.skill.deleteMany({ where: { id: ids.skill } });
            await tx.serviceCategory.deleteMany({ where: { id: ids.category } });
            await tx.branchOperatingHours.deleteMany({ where: { branchId: ids.branch } });
            await tx.branch.deleteMany({ where: { id: ids.branch } });
          },
          { timeout: 30_000 },
        );
      } finally {
        await database.$disconnect();
      }
    }
  },
);
