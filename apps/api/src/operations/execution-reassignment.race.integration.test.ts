import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ReassignServicesRequest } from '@lucy-spa/contracts';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { takeSharedAuthGraphLock } from '../auth/auth-store.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { LeaveService } from '../leave/leave.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { WalkInService } from '../walkin/walkin.service.js';
import { ReassignmentService } from './reassignment.service.js';
import { ServiceExecutionService } from './service-execution.service.js';

/**
 * Real production service calls on separate committed PostgreSQL connections. The two-party
 * latch releases only after both transactions hold the shared auth-graph lock; all remaining
 * user/session/parent/line locks are taken by production code. No mocked availability or auth.
 * Requires an explicitly opted-in local superuser validation database (replica-role cleanup).
 * Cleanup is bounded to this invocation's exact UUIDs, never wildcard test prefixes.
 */
test(
  'Execution and reassignment PostgreSQL races retain one authoritative outcome',
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
    const runner = {
      withTransaction,
      withExclusiveTransaction: withTransaction,
      resolveForMutation: (token: string, tx: Prisma.TransactionClient) =>
        sessions.resolveForMutation(token, tx),
    };
    const throttle = new AuthThrottleService(environment);
    const executions = new ServiceExecutionService(runner, throttle);
    const reassignments = new ReassignmentService(runner, throttle);
    const leaves = new LeaveService(runner, throttle);
    const walkins = new WalkInService(runner, throttle);
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
    const reason = (result: PromiseSettledResult<unknown>) => {
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
          data: { id: ids.branch, code: `EXR_${run}`, name: 'Execution race', timezone: zone },
        });
        for (let isoWeekday = 1; isoWeekday <= 7; isoWeekday++)
          await tx.branchOperatingHours.create({
            data: { branchId: ids.branch, isoWeekday, opensAtMinute: 0, closesAtMinute: 1440 },
          });
        await tx.skill.create({
          data: { id: ids.skill, code: `EXR_${run}`, nameVi: 'Race', nameEn: 'Race' },
        });
        await tx.serviceCategory.create({
          data: { id: ids.category, code: `EXR_${run}`, nameVi: 'Race', nameEn: 'Race' },
        });
        await tx.service.create({
          data: {
            id: ids.service,
            code: `EXR_${run}`,
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
            code: {
              in: ['PERFORM_SERVICES', 'REASSIGN_SERVICES', 'MANAGE_BOOKINGS', 'APPROVE_LEAVE'],
            },
          },
          select: { id: true },
        });
        assert.equal(permissions.length, 4);
        await tx.role.create({
          data: {
            id: ids.role,
            code: `EXR_${run}`,
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
              phoneCanonical: `+849${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`,
              employeeProfile: {
                create: {
                  employeeCodeCanonical: `EXR_${run}_${++serial}`,
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
      const lineFor = (employee: { id: string }) =>
        database.$transaction(async (tx) => {
          const visit = await tx.visit.create({
            data: {
              code: `EXR-${run}-${++serial}`,
              branchId: ids.branch,
              origin: 'WALK_IN',
              serviceDate: new Date(today),
              arrivedAt: at(-30),
              createdByUserId: employee.id,
            },
          });
          const participant = await tx.visitParticipant.create({
            data: { visitId: visit.id, kind: 'GUEST', displayName: 'Race guest' },
          });
          return tx.visitServiceLine.create({
            data: {
              visitId: visit.id,
              participantId: participant.id,
              sequence: 1,
              serviceId: ids.service,
              employeeUserId: employee.id,
              requestedEmployeeUserId: employee.id,
              assignmentMode: 'SPECIFIC',
              plannedStartAt: at(-1),
              plannedEndAt: at(9),
              durationMinutes: 10,
              bufferMinutes: 0,
              serviceCode: `EXR_${run}`,
              serviceNameVi: 'Race',
              serviceNameEn: 'Race',
              catalogPriceMinVnd: 1n,
              catalogPriceMaxVnd: 1n,
              catalogPricingUnit: 'PER_SERVICE',
            },
          });
        });
      const body = (
        line: { id: string; rowVersion: number },
        employee: { id: string },
      ): ReassignServicesRequest => ({
        scope: 'LINE',
        targets: [{ id: line.id, expectedVersion: line.rowVersion }],
        employeeUserId: employee.id,
        context: 'MANAGER',
        reason: 'Explicit race fixture reassignment',
        acknowledgeSpecific: true,
      });
      const claims = async (lineId: string) => {
        const [row] = await database.$queryRaw<{ n: bigint }[]>`
          SELECT count(*) AS n FROM ktv_occupancies WHERE visit_service_line_id = ${lineId}::uuid`;
        return Number(row!.n);
      };
      const history = async (line: { id: string; visitId: string }, count: number) => {
        assert.equal(
          await database.serviceLineAssignmentChange.count({
            where: { visitServiceLineId: line.id },
          }),
          count,
        );
        assert.equal(
          await database.auditEvent.count({
            where: { action: 'KTV_REASSIGNED', entityId: line.id },
          }),
          count,
        );
        assert.equal(
          await database.outboxEvent.count({
            where: { eventType: 'KTV_REASSIGNED', aggregateId: line.visitId },
          }),
          count,
        );
      };

      await suite.test(
        'START vs START: one execution, one START audit and event, same authoritative timestamps',
        async () => {
          const actor = await staff();
          const line = await lineFor(actor);
          const [a, b] = await race(
            () => executions.start(actor.token, line.id),
            () => executions.start(actor.token, line.id),
          );
          assert.equal(reason(a), 'OK');
          assert.equal(reason(b), 'OK');
          if (a.status !== 'fulfilled' || b.status !== 'fulfilled')
            throw new Error('START must succeed');
          assert.deepEqual(a.value.execution, b.value.execution);
          assert.equal(
            await database.serviceExecution.count({ where: { visitServiceLineId: line.id } }),
            1,
          );
          assert.equal(
            await database.auditEvent.count({
              where: { action: 'SERVICE_STARTED', entityId: a.value.execution!.id },
            }),
            1,
          );
          assert.equal(
            await database.outboxEvent.count({
              where: { eventType: 'SERVICE_STARTED', aggregateId: a.value.execution!.id },
            }),
            1,
          );
          assert.equal(await claims(line.id), 1);
        },
      );
      await suite.test(
        'END vs END: one END fact and event; Visit COMPLETED and occupancy released',
        async () => {
          const actor = await staff();
          const line = await lineFor(actor);
          await executions.start(actor.token, line.id);
          const [a, b] = await race(
            () => executions.end(actor.token, line.id),
            () => executions.end(actor.token, line.id),
          );
          assert.equal(reason(a), 'OK');
          assert.equal(reason(b), 'OK');
          if (a.status !== 'fulfilled' || b.status !== 'fulfilled')
            throw new Error('END must succeed');
          assert.deepEqual(a.value.execution, b.value.execution);
          assert.equal(a.value.visitStatus, 'COMPLETED');
          assert.equal(
            await database.auditEvent.count({
              where: { action: 'SERVICE_ENDED', entityId: a.value.execution!.id },
            }),
            1,
          );
          assert.equal(
            await database.outboxEvent.count({
              where: { eventType: 'SERVICE_ENDED', aggregateId: a.value.execution!.id },
            }),
            1,
          );
          assert.equal(await claims(line.id), 0);
        },
      );
      await suite.test(
        'START vs cancellation: never a cancelled execution or partial START',
        async () => {
          const actor = await staff();
          const manager = await staff();
          const line = await lineFor(actor);
          const [started, cancelled] = await race(
            () => executions.start(actor.token, line.id),
            () => walkins.cancel(manager.token, line.visitId, { reason: 'Guest left during race' }),
          );
          const final = await database.visitServiceLine.findUniqueOrThrow({
            where: { id: line.id },
            include: { execution: true },
          });
          if (final.status === 'IN_PROGRESS') {
            assert.equal(reason(started), 'OK');
            assert.equal(reason(cancelled), 'WALKIN_CANCEL_NOT_ALLOWED');
            assert.equal(final.execution!.status, 'IN_PROGRESS');
            assert.equal(await claims(line.id), 1);
          } else {
            assert.equal(final.status, 'CANCELLED');
            assert.equal(reason(cancelled), 'OK');
            assert.ok(
              ['SERVICE_START_NOT_ALLOWED', 'SERVICE_EXECUTION_CONFLICT'].includes(reason(started)),
            );
            assert.equal(final.execution, null);
            assert.equal(await claims(line.id), 0);
          }
        },
      );
      await suite.test(
        'reassignment vs START: actual execution stays with the winning assignment',
        async () => {
          const original = await staff();
          const replacement = await staff();
          const manager = await staff();
          const line = await lineFor(original);
          const [assigned, started] = await race(
            () => reassignments.reassign(manager.token, 'VISIT', line.id, body(line, replacement)),
            () => executions.start(original.token, line.id),
          );
          const final = await database.visitServiceLine.findUniqueOrThrow({
            where: { id: line.id },
            include: { execution: true },
          });
          if (final.employeeUserId === replacement.id) {
            assert.equal(reason(assigned), 'OK');
            assert.equal(reason(started), 'NOT_FOUND');
            assert.equal(final.execution, null);
            assert.equal(final.status, 'PLANNED');
            await history(line, 1);
          } else {
            assert.equal(final.employeeUserId, original.id);
            assert.equal(reason(started), 'OK');
            assert.ok(
              ['REASSIGNMENT_NOT_ALLOWED', 'REASSIGNMENT_CONFLICT'].includes(reason(assigned)),
            );
            assert.equal(final.execution!.employeeUserId, original.id);
            await history(line, 0);
          }
          assert.equal(await claims(line.id), 1);
        },
      );
      await suite.test(
        'two managers reassign one version: one winner, one atomic history/audit/outbox set',
        async () => {
          const original = await staff();
          const a = await staff();
          const b = await staff();
          const managerA = await staff();
          const managerB = await staff();
          const line = await lineFor(original);
          const results = await race(
            () => reassignments.reassign(managerA.token, 'VISIT', line.id, body(line, a)),
            () => reassignments.reassign(managerB.token, 'VISIT', line.id, body(line, b)),
          );
          assert.deepEqual(results.map(reason).sort(), ['OK', 'REASSIGNMENT_CONFLICT']);
          const final = await database.visitServiceLine.findUniqueOrThrow({
            where: { id: line.id },
          });
          assert.equal(final.employeeUserId, results[0].status === 'fulfilled' ? a.id : b.id);
          assert.equal(final.requestedEmployeeUserId, original.id);
          assert.equal(final.rowVersion, line.rowVersion + 1);
          await history(line, 1);
          assert.equal(await claims(line.id), 1);
        },
      );
      await suite.test(
        'reassignment vs cancellation: cancellation releases every claim; losing reassignment is atomic',
        async () => {
          const original = await staff();
          const replacement = await staff();
          const managerA = await staff();
          const managerB = await staff();
          const line = await lineFor(original);
          const [assigned, cancelled] = await race(
            () => reassignments.reassign(managerA.token, 'VISIT', line.id, body(line, replacement)),
            () =>
              walkins.cancel(managerB.token, line.visitId, { reason: 'Guest left during race' }),
          );
          assert.equal(reason(cancelled), 'OK');
          assert.ok(
            ['OK', 'REASSIGNMENT_NOT_ALLOWED', 'REASSIGNMENT_CONFLICT'].includes(reason(assigned)),
          );
          const final = await database.visitServiceLine.findUniqueOrThrow({
            where: { id: line.id },
          });
          assert.equal(final.status, 'CANCELLED');
          assert.equal(await claims(line.id), 0);
          await history(line, assigned.status === 'fulfilled' ? 1 : 0);
          assert.equal(
            await database.serviceExecution.count({ where: { visitServiceLineId: line.id } }),
            0,
          );
        },
      );
      await suite.test(
        'reassignment vs new walk-in occupancy: replacement has one claim for overlapping work',
        async () => {
          const original = await staff();
          const replacement = await staff();
          const managerA = await staff();
          const managerB = await staff();
          const line = await lineFor(original);
          const [assigned, created] = await race(
            () => reassignments.reassign(managerA.token, 'VISIT', line.id, body(line, replacement)),
            () =>
              walkins.create(managerB.token, ids.branch, {
                idempotencyKey: randomUUID(),
                participants: [{ key: 'guest', kind: 'GUEST', displayName: 'Competing guest' }],
                lines: [
                  {
                    participantKey: 'guest',
                    serviceId: ids.service,
                    requestedEmployeeUserId: replacement.id,
                  },
                ],
              }),
          );
          assert.equal(reason(created), 'OK');
          assert.ok(
            ['OK', 'REASSIGNMENT_KTV_UNAVAILABLE', 'REASSIGNMENT_CONFLICT'].includes(
              reason(assigned),
            ),
          );
          const [row] = await database.$queryRaw<{ n: bigint }[]>`
          SELECT count(*) AS n FROM ktv_occupancies WHERE employee_user_id = ${replacement.id}::uuid`;
          assert.equal(Number(row!.n), 1);
          await history(line, assigned.status === 'fulfilled' ? 1 : 0);
          assert.equal(
            await database.serviceExecution.count({ where: { employeeUserId: replacement.id } }),
            0,
          );
        },
      );
      await suite.test(
        'replacement leave approval vs reassignment: reject unavailable replacement or flag its committed work',
        async () => {
          const original = await staff();
          const replacement = await staff();
          const managerA = await staff();
          const managerB = await staff();
          const line = await lineFor(original);
          const leave = await leaves.create(replacement.token, {
            leaveType: 'ANNUAL',
            startDate: today,
            endDate: today,
            reason: 'Race fixture leave',
          });
          const [assigned, approved] = await race(
            () => reassignments.reassign(managerA.token, 'VISIT', line.id, body(line, replacement)),
            () => leaves.approve(managerB.token, leave.id, { expectedVersion: leave.version }),
          );
          assert.equal(reason(approved), 'OK');
          const final = await database.visitServiceLine.findUniqueOrThrow({
            where: { id: line.id },
          });
          assert.equal(
            (await database.leaveRequest.findUniqueOrThrow({ where: { id: leave.id } })).status,
            'APPROVED',
          );
          if (assigned.status === 'fulfilled') {
            assert.equal(final.employeeUserId, replacement.id);
            assert.equal(final.assignmentConflict, 'LEAVE');
            assert.equal(
              await database.outboxEvent.count({
                where: { eventType: 'BOOKING_KTV_CONFLICT', aggregateId: line.visitId },
              }),
              1,
            );
            await assert.rejects(
              () => executions.start(replacement.token, line.id),
              (error: unknown) =>
                error instanceof AuthError && error.code === 'SERVICE_START_UNAVAILABLE',
            );
            await history(line, 1);
          } else {
            assert.equal(reason(assigned), 'REASSIGNMENT_KTV_UNAVAILABLE');
            assert.equal(final.employeeUserId, original.id);
            assert.equal(final.assignmentConflict, null);
            await history(line, 0);
          }
          assert.equal(await claims(line.id), 1);
        },
      );
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
            const executions = (
              await tx.serviceExecution.findMany({
                where: { visitServiceLineId: { in: lines } },
                select: { id: true },
              })
            ).map((v) => v.id);
            const leaves = (
              await tx.leaveRequest.findMany({
                where: { employeeUserId: { in: userIds } },
                select: { id: true },
              })
            ).map((v) => v.id);
            await tx.notification.deleteMany({ where: { branchId: ids.branch } });
            await tx.serviceWarningSchedule.deleteMany({ where: { lineId: { in: lines } } });
            await tx.outboxEvent.deleteMany({
              where: {
                OR: [
                  { branchId: ids.branch },
                  { aggregateId: { in: [...visits, ...executions, ...leaves] } },
                ],
              },
            });
            await tx.auditEvent.deleteMany({
              where: { OR: [{ branchId: ids.branch }, { actorUserId: { in: userIds } }] },
            });
            await tx.$executeRaw`DELETE FROM ktv_occupancies WHERE employee_user_id = ANY(${userIds}::uuid[])`;
            await tx.serviceLineAssignmentChange.deleteMany({
              where: { visitServiceLineId: { in: lines } },
            });
            await tx.serviceExecution.deleteMany({ where: { id: { in: executions } } });
            await tx.visitServiceLine.deleteMany({ where: { id: { in: lines } } });
            await tx.visitParticipant.deleteMany({ where: { visitId: { in: visits } } });
            await tx.visit.deleteMany({ where: { id: { in: visits } } });
            await tx.leaveRequest.deleteMany({ where: { id: { in: leaves } } });
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
