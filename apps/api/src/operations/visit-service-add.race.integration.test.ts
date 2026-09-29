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

/**
 * Phase 4 Step 3 races on separate committed PostgreSQL connections with real production service
 * calls. A two-party latch releases only after both transactions hold the shared auth-graph lock;
 * every other lock (users, session, visit, line, KTV rows) is taken by production code. Requires an
 * explicitly opted-in local superuser validation database (replica-role cleanup); cleanup is bounded
 * to this invocation's exact UUIDs.
 */
test(
  'Phase 4 Step 3 PostgreSQL races keep one authoritative outcome',
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
      extra: randomUUID(),
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
          data: { id: ids.branch, code: `VAR_${run}`, name: 'Add race', timezone: zone },
        });
        for (let isoWeekday = 1; isoWeekday <= 7; isoWeekday++)
          await tx.branchOperatingHours.create({
            data: { branchId: ids.branch, isoWeekday, opensAtMinute: 0, closesAtMinute: 1440 },
          });
        await tx.skill.create({
          data: { id: ids.skill, code: `VAR_${run}`, nameVi: 'Race', nameEn: 'Race' },
        });
        await tx.serviceCategory.create({
          data: { id: ids.category, code: `VAR_${run}`, nameVi: 'Race', nameEn: 'Race' },
        });
        for (const [id, code] of [
          [ids.service, 'BASE'],
          [ids.extra, 'EXTRA'],
        ] as const) {
          await tx.service.create({
            data: {
              id,
              code: `VAR_${code}_${run}`,
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
          await tx.serviceSkill.create({ data: { serviceId: id, skillId: ids.skill } });
          await tx.serviceBranchAvailability.create({
            data: { serviceId: id, branchId: ids.branch },
          });
        }
        await syncPermissionCatalog(tx);
        const permissions = await tx.permission.findMany({
          where: { code: { in: ['PERFORM_SERVICES', 'MANAGE_BOOKINGS'] } },
          select: { id: true },
        });
        assert.equal(permissions.length, 2);
        await tx.role.create({
          data: {
            id: ids.role,
            code: `VAR_${run}`,
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
                  employeeCodeCanonical: `VAR_${run}_${++serial}`,
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
      /** A visit with one PLANNED line (past times) for `employee`; `running` makes it IN_PROGRESS. */
      const visitFor = (employee: { id: string }, running: boolean) =>
        database.$transaction(async (tx) => {
          const visit = await tx.visit.create({
            data: {
              code: `VAR-${run}-${++serial}`,
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
              serviceCode: `VAR_BASE_${run}`,
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
          return { visitId: visit.id, participantId: participant.id, lineId: line.id };
        });
      const added = (visitId: string) =>
        database.visitServiceLine.findMany({
          where: { visitId, addedOnBehalf: true },
          orderBy: { sequence: 'asc' },
        });
      const ROUNDS = 4;

      await suite.test(
        'same key twice at once: one line, one audit, one stored request',
        async () => {
          for (let round = 0; round < ROUNDS; round++) {
            const performer = await staff();
            const desk = await staff();
            await staff(); // a free qualified KTV
            const { visitId, participantId } = await visitFor(performer, true);
            const key = randomUUID();
            const body = { participantId, serviceId: ids.extra, idempotencyKey: key };
            const [a, b] = await race(
              () => executions.addLine(desk.token, visitId, body),
              () => executions.addLine(desk.token, visitId, body),
            );
            assert.equal(outcome(a), 'OK');
            assert.equal(outcome(b), 'OK');
            if (a.status !== 'fulfilled' || b.status !== 'fulfilled')
              throw new Error('unreachable');
            assert.equal(a.value.lineId, b.value.lineId);
            assert.equal([a.value.replayed, b.value.replayed].filter(Boolean).length, 1);
            const lines = await added(visitId);
            assert.equal(lines.length, 1);
            assert.equal(
              await database.auditEvent.count({
                where: { entityId: lines[0]!.id, action: 'VISIT_LINE_ADDED' },
              }),
              1,
            );
            assert.equal(
              await database.visitLineAddRequest.count({
                where: { visitServiceLineId: lines[0]!.id },
              }),
              1,
            );
          }
        },
      );

      await suite.test(
        'two visits want the same KTV time: one is planned, the other waits',
        async () => {
          for (let round = 0; round < ROUNDS; round++) {
            const [p1, p2, desk1, desk2, target] = [
              await staff(),
              await staff(),
              await staff(),
              await staff(),
              await staff(),
            ];
            const v1 = await visitFor(p1, true);
            const v2 = await visitFor(p2, true);
            const request = (visit: typeof v1, who: typeof desk1) =>
              executions.addLine(who.token, visit.visitId, {
                participantId: visit.participantId,
                serviceId: ids.extra,
                requestedEmployeeUserId: target.id,
                idempotencyKey: randomUUID(),
              });
            const [a, b] = await race(
              () => request(v1, desk1),
              () => request(v2, desk2),
            );
            assert.equal(outcome(a), 'OK');
            assert.equal(outcome(b), 'OK');
            const lines = [...(await added(v1.visitId)), ...(await added(v2.visitId))];
            assert.equal(lines.length, 2);
            const planned = lines.filter((line) => line.status === 'PLANNED');
            assert.equal(planned.length, 1, lines.map((line) => line.status).join());
            assert.equal(planned[0]!.employeeUserId, target.id);
            assert.equal(lines.filter((line) => line.status === 'WAITING').length, 1);
            const [claims] = await database.$queryRaw<{ n: bigint }[]>`
            SELECT count(*) AS n FROM ktv_occupancies WHERE employee_user_id = ${target.id}::uuid`;
            assert.equal(Number(claims!.n), 1);
          }
        },
      );

      await suite.test(
        'add vs the last END: a visit never completes with an open added line',
        async () => {
          for (let round = 0; round < ROUNDS; round++) {
            const performer = await staff();
            const desk = await staff();
            await staff();
            const { visitId, participantId, lineId } = await visitFor(performer, true);
            const [end, add] = await race(
              () => executions.end(performer.token, lineId),
              () =>
                executions.addLine(desk.token, visitId, {
                  participantId,
                  serviceId: ids.extra,
                  idempotencyKey: randomUUID(),
                }),
            );
            const codes = [outcome(end), outcome(add)];
            const visit = await database.visit.findUniqueOrThrow({ where: { id: visitId } });
            const lines = await added(visitId);
            const open = await database.visitServiceLine.count({
              where: { visitId, status: { notIn: ['DONE', 'CANCELLED'] } },
            });
            if (visit.status === 'COMPLETED') {
              assert.equal(lines.length, 0, codes.join());
              assert.equal(open, 0);
              assert.equal(codes[1], 'VISIT_LINE_ADD_NOT_ALLOWED');
            } else {
              assert.equal(visit.status, 'IN_SERVICE', codes.join());
              assert.equal(lines.length, 1);
              assert.ok(open >= 1);
              assert.equal(codes[1], 'OK');
            }
          }
        },
      );

      await suite.test(
        'add vs cancelling the last line: never a cancelled visit with an added line',
        async () => {
          for (let round = 0; round < ROUNDS; round++) {
            const performer = await staff();
            const desk = await staff();
            const closer = await staff();
            await staff();
            const { visitId, participantId, lineId } = await visitFor(performer, false);
            const [cancel, add] = await race(
              () => executions.cancelLine(closer.token, lineId, { reason: 'race' }),
              () =>
                executions.addLine(desk.token, visitId, {
                  participantId,
                  serviceId: ids.extra,
                  idempotencyKey: randomUUID(),
                }),
            );
            const codes = [outcome(cancel), outcome(add)];
            const visit = await database.visit.findUniqueOrThrow({ where: { id: visitId } });
            const lines = await added(visitId);
            if (visit.status === 'CANCELLED') {
              assert.equal(lines.length, 0, codes.join());
              assert.equal(codes[1], 'VISIT_LINE_ADD_NOT_ALLOWED');
            } else {
              assert.equal(visit.status, 'OPEN', codes.join());
              assert.equal(lines.length, 1);
              assert.equal(codes[1], 'OK');
              // The original line was cancelled; the added one keeps the visit open.
              assert.ok(['OK', 'SERVICE_EXECUTION_CONFLICT'].includes(codes[0]!));
            }
          }
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
            await tx.visitLineAddRequest.deleteMany({
              where: { visitServiceLineId: { in: lines } },
            });
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
            await tx.serviceSkill.deleteMany({
              where: { serviceId: { in: [ids.service, ids.extra] } },
            });
            await tx.serviceBranchAvailability.deleteMany({
              where: { serviceId: { in: [ids.service, ids.extra] } },
            });
            await tx.service.deleteMany({ where: { id: { in: [ids.service, ids.extra] } } });
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
