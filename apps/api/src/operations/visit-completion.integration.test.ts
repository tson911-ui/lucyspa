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
import { loadTimingSettings, operationalToday } from './operations.core.js';
import { ServiceExecutionService } from './service-execution.service.js';

/**
 * Phase 4 Step 2: management resolution of a forgotten END and cancellation of an unperformed
 * line, against real PostgreSQL. Every fixture (and every command) rolls back with the outer
 * transaction; concurrency is covered by the separate race suite.
 */
test(
  'Phase 4 Step 2 visit completion carryover; fixtures roll back',
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
    const rollback = new Error('Phase 4 Step 2 fixture rollback');
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    try {
      await assert.rejects(
        database.$transaction(
          async (tx: Prisma.TransactionClient) => {
            let n = 0;
            let savepoint = 0;
            const isolated = async <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => {
              const name = `visit_completion_${++savepoint}`;
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
            const fails = async (work: () => Promise<unknown>, code: string, field?: string) => {
              await assert.rejects(
                work,
                (error: unknown) =>
                  error instanceof AuthError &&
                  error.code === code &&
                  (field === undefined || error.field === field),
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
              data: { code: `VC_${run}`, name: 'Completion fixture', timezone: zone },
            });
            const elsewhere = await tx.branch.create({
              data: { code: `VC_OTHER_${run}`, name: 'Other', timezone: zone },
            });
            for (let isoWeekday = 1; isoWeekday <= 7; isoWeekday++) {
              await tx.branchOperatingHours.create({
                data: { branchId: branch.id, isoWeekday, opensAtMinute: 0, closesAtMinute: 1440 },
              });
            }
            await syncPermissionCatalog(tx);
            const permissionId = async (
              code: 'PERFORM_SERVICES' | 'MANAGE_BOOKINGS' | 'RESOLVE_SERVICE_EXECUTION',
            ) => (await tx.permission.findUniqueOrThrow({ where: { code } })).id;
            const makeRole = async (name: string, codes: Parameters<typeof permissionId>[0][]) =>
              tx.role.create({
                data: {
                  code: `VC_${name}_${run}`,
                  displayNameVi: name,
                  displayNameEn: name,
                  permissions: {
                    create: await Promise.all(
                      codes.map(async (code) => ({ permissionId: await permissionId(code) })),
                    ),
                  },
                },
              });
            const performerRole = await makeRole('PERFORM', ['PERFORM_SERVICES']);
            const managerRole = await makeRole('MANAGER', [
              'RESOLVE_SERVICE_EXECUTION',
              'MANAGE_BOOKINGS',
            ]);
            const resolveOnlyRole = await makeRole('RESOLVE', ['RESOLVE_SERVICE_EXECUTION']);
            const cancelOnlyRole = await makeRole('CANCEL', ['MANAGE_BOOKINGS']);
            const category = await tx.serviceCategory.create({
              data: { code: `VC_${run}`, nameVi: 'Group', nameEn: 'Group' },
            });
            const skill = await tx.skill.create({
              data: { code: `VC_${run}`, nameVi: 'Skill', nameEn: 'Skill' },
            });
            const service = await tx.service.create({
              data: {
                code: `VC_${run}`,
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

            type Person = { id: string; token: string };
            const person = async (
              roles: { roleId: string; branchId: string }[],
              options: { checkedIn?: boolean } = {},
            ): Promise<Person> => {
              n++;
              const user = await tx.user.create({
                data: {
                  kind: 'EMPLOYEE',
                  status: 'ACTIVE',
                  fullName: `Completion ${n}`,
                  preferredLocale: 'vi',
                  phoneCanonical: `+849${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`,
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                  employeeProfile: {
                    create: {
                      employeeCodeCanonical: `VC_${run}_${n}`,
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
              for (const role of roles)
                await tx.userRoleAssignment.create({
                  data: {
                    userId: user.id,
                    roleId: role.roleId,
                    scopeKind: 'BRANCH',
                    branchId: role.branchId,
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
            const ktv = () => person([{ roleId: performerRole.id, branchId: branch.id }]);
            const manager = () => person([{ roleId: managerRole.id, branchId: branch.id }]);

            const visit = async (
              employees: string[],
              options: { split?: boolean; base?: number } = {},
            ) => {
              const row = await tx.visit.create({
                data: {
                  code: `VC-${run}-${++n}`,
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
                const owner =
                  options.split && index > 0
                    ? await tx.visitParticipant.create({
                        data: { visitId: row.id, kind: 'GUEST', displayName: 'Other guest' },
                      })
                    : participant;
                lines.push(
                  await tx.visitServiceLine.create({
                    data: {
                      visitId: row.id,
                      participantId: owner.id,
                      sequence: options.split ? 1 : index + 1,
                      serviceId: service.id,
                      employeeUserId,
                      assignmentMode: 'SPECIFIC',
                      plannedStartAt: at((options.base ?? -120) + index * 15),
                      plannedEndAt: at((options.base ?? -120) + index * 15 + 10),
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
            /** Puts a line into a forgotten-END state: running for `startedMinutesAgo`, expected end passed. */
            const forgotten = async (
              line: { id: string; visitId: string; employeeUserId: string | null },
              startedMinutesAgo = 90,
            ) => {
              await tx.visitServiceLine.update({
                where: { id: line.id },
                data: { status: 'IN_PROGRESS', rowVersion: { increment: 1 } },
              });
              await tx.visit.updateMany({
                where: { id: line.visitId, status: 'OPEN' },
                data: { status: 'IN_SERVICE', rowVersion: { increment: 1 } },
              });
              return tx.serviceExecution.create({
                data: {
                  visitServiceLineId: line.id,
                  employeeUserId: line.employeeUserId!,
                  startedAt: at(-startedMinutesAgo),
                  expectedEndAt: at(-startedMinutesAgo + 10),
                },
              });
            };
            const occupancy = async (lineId: string) => {
              const [claims] = await tx.$queryRaw<
                { n: bigint }[]
              >`SELECT count(*) AS n FROM ktv_occupancies WHERE visit_service_line_id = ${lineId}::uuid`;
              return Number(claims!.n);
            };
            const audits = (entityId: string, action: string) =>
              tx.auditEvent.findMany({ where: { entityId, action } });

            // ------------------------------------------------------------------ A. resolution
            await suite.test(
              'a manager resolves a forgotten END: facts, completion, audit, one event, replay',
              async () => {
                const performer = await ktv();
                const boss = await manager();
                const { row, lines } = await visit([performer.id]);
                const running = await forgotten(lines[0]!);
                const result = await executions.resolve(boss.token, lines[0]!.id, {
                  reason: '  Khách đã về, KTV quên bấm  ',
                });
                assert.equal(result.visitStatus, 'COMPLETED');
                assert.equal(result.endKind, 'MANAGER_RESOLVED');
                assert.equal(result.startedAt, running.startedAt.toISOString());
                const stored = await tx.serviceExecution.findUniqueOrThrow({
                  where: { id: running.id },
                });
                assert.equal(stored.status, 'ENDED');
                assert.equal(stored.endKind, 'MANAGER_RESOLVED');
                assert.equal(stored.endedByUserId, boss.id);
                assert.equal(stored.resolutionReason, 'Khách đã về, KTV quên bấm');
                assert.deepEqual(stored.startedAt, running.startedAt);
                assert.ok(stored.endedAt && stored.endedAt >= stored.startedAt);
                const line = await tx.visitServiceLine.findUniqueOrThrow({
                  where: { id: lines[0]!.id },
                });
                assert.equal(line.status, 'DONE');
                assert.deepEqual(line.plannedStartAt, lines[0]!.plannedStartAt);
                const visitRow = await tx.visit.findUniqueOrThrow({ where: { id: row.id } });
                assert.equal(visitRow.status, 'COMPLETED');
                assert.ok(visitRow.completedAt);
                assert.equal(await occupancy(lines[0]!.id), 0);

                const [audit] = await audits(running.id, 'SERVICE_EXECUTION_RESOLVED');
                assert.ok(audit);
                assert.equal(audit.actorUserId, boss.id);
                assert.equal(audit.subjectUserId, performer.id);
                assert.equal(audit.branchId, branch.id);
                assert.equal(audit.reason, 'Khách đã về, KTV quên bấm');
                assert.equal(audit.dataClassification, 'STANDARD');
                assert.equal(
                  (audit.before as { executionStatus: string }).executionStatus,
                  'IN_PROGRESS',
                );
                const after = audit.after as {
                  endedAt: string;
                  resolvedAt: string;
                  visitStatus: string;
                };
                assert.equal(after.endedAt, stored.endedAt!.toISOString());
                assert.equal(after.visitStatus, 'COMPLETED');
                assert.ok(after.resolvedAt);
                const events = await tx.outboxEvent.findMany({
                  where: { aggregateId: running.id, eventType: 'SERVICE_ENDED' },
                });
                assert.equal(events.length, 1, 'one logical END event, not two');
                assert.equal(
                  (events[0]!.payload as { endKind: string }).endKind,
                  'MANAGER_RESOLVED',
                );

                // Replay by the same actor: original outcome, nothing new written.
                const again = await executions.resolve(boss.token, lines[0]!.id, {
                  reason: 'other',
                });
                assert.deepEqual(again, result);
                assert.equal((await audits(running.id, 'SERVICE_EXECUTION_RESOLVED')).length, 1);
                assert.equal(
                  await tx.outboxEvent.count({
                    where: { aggregateId: running.id, eventType: 'SERVICE_ENDED' },
                  }),
                  1,
                );
                // Anyone else, and the performer's own END, now find it already ended.
                const second = await manager();
                await fails(
                  () => executions.resolve(second.token, lines[0]!.id, { reason: 'r' }),
                  'SERVICE_RESOLUTION_NOT_ALLOWED',
                );
                // The performer's own END is now an idempotent no-op that keeps the resolved facts.
                const late = await executions.end(performer.token, lines[0]!.id);
                assert.equal(late.execution?.endKind, 'MANAGER_RESOLVED');
                assert.equal(late.execution?.endedAt, result.endedAt);
              },
            );

            await suite.test(
              'the resolved end time is bounded by the start and the server clock',
              async () => {
                const performer = await ktv();
                const boss = await manager();
                const { lines } = await visit([performer.id]);
                const running = await forgotten(lines[0]!, 90);
                const bad = (value: unknown) =>
                  fails(
                    () =>
                      executions.resolve(boss.token, lines[0]!.id, {
                        reason: 'r',
                        endedAt: value as string,
                      }),
                    'VALIDATION_FAILED',
                    'endedAt',
                  );
                await bad(new Date(running.startedAt.getTime() - 1).toISOString());
                await bad(new Date(Date.now() + 3_600_000).toISOString());
                await bad(new Date(Date.now() + 60_000).toISOString());
                await bad('2026-09-30 10:00');
                await bad('not a date');
                await bad('2026-09-30T10:00:00');
                await bad(12345);
                await fails(
                  () => executions.resolve(boss.token, lines[0]!.id, { reason: '   ' }),
                  'VALIDATION_FAILED',
                  'reason',
                );
                await fails(
                  () => executions.resolve(boss.token, lines[0]!.id, { reason: 'x'.repeat(501) }),
                  'VALIDATION_FAILED',
                  'reason',
                );
                // Nothing changed by the refusals.
                assert.equal(
                  (await tx.serviceExecution.findUniqueOrThrow({ where: { id: running.id } }))
                    .status,
                  'IN_PROGRESS',
                );
                const chosen = new Date(running.startedAt.getTime() + 45 * 60_000);
                const result = await executions.resolve(boss.token, lines[0]!.id, {
                  reason: 'r',
                  endedAt: chosen.toISOString(),
                });
                assert.equal(result.endedAt, chosen.toISOString());
                const stored = await tx.serviceExecution.findUniqueOrThrow({
                  where: { id: running.id },
                });
                assert.deepEqual(stored.endedAt, chosen);
                assert.deepEqual(stored.startedAt, running.startedAt);
              },
            );

            await suite.test('the end time may equal the start (boundary)', async () => {
              const performer = await ktv();
              const boss = await manager();
              const { lines } = await visit([performer.id]);
              const running = await forgotten(lines[0]!, 30);
              const result = await executions.resolve(boss.token, lines[0]!.id, {
                reason: 'r',
                endedAt: running.startedAt.toISOString(),
              });
              assert.equal(result.endedAt, running.startedAt.toISOString());
            });

            await suite.test(
              'authority: permission, branch scope, self-resolution, state',
              async () => {
                const performer = await ktv();
                const selfManager = await person([
                  { roleId: performerRole.id, branchId: branch.id },
                  { roleId: resolveOnlyRole.id, branchId: branch.id },
                ]);
                const boss = await manager();
                const wrongBranch = await person([
                  { roleId: resolveOnlyRole.id, branchId: elsewhere.id },
                ]);
                const cancelOnly = await person([
                  { roleId: cancelOnlyRole.id, branchId: branch.id },
                ]);
                const { lines } = await visit([performer.id, selfManager.id], { split: true });
                await forgotten(lines[0]!);
                await fails(
                  () => executions.resolve(performer.token, lines[0]!.id, { reason: 'r' }),
                  'FORBIDDEN',
                );
                await fails(
                  () => executions.resolve(wrongBranch.token, lines[0]!.id, { reason: 'r' }),
                  'FORBIDDEN',
                );
                await fails(
                  () => executions.resolve(cancelOnly.token, lines[0]!.id, { reason: 'r' }),
                  'FORBIDDEN',
                );
                await fails(
                  () => executions.resolve('missing-token', lines[0]!.id, { reason: 'r' }),
                  'AUTHENTICATION_REQUIRED',
                );
                await fails(
                  () => executions.resolve(boss.token, 'not-a-uuid', { reason: 'r' }),
                  'NOT_FOUND',
                );
                await fails(
                  () => executions.resolve(boss.token, randomUUID(), { reason: 'r' }),
                  'NOT_FOUND',
                );
                // A performer holding the permission still cannot resolve their own running service.
                const own = await forgotten(lines[1]!, 20);
                await fails(
                  () => executions.resolve(selfManager.token, lines[1]!.id, { reason: 'r' }),
                  'FORBIDDEN',
                );
                assert.equal(
                  (await tx.serviceExecution.findUniqueOrThrow({ where: { id: own.id } })).status,
                  'IN_PROGRESS',
                );
                // A line that never started has no execution to resolve.
                const fresh = await visit([performer.id], { base: -300 });
                await fails(
                  () => executions.resolve(boss.token, fresh.lines[0]!.id, { reason: 'r' }),
                  'SERVICE_RESOLUTION_NOT_ALLOWED',
                );
              },
            );

            await suite.test(
              'a normally ended execution cannot be resolved; completion is shared',
              async () => {
                const a = await ktv();
                const b = await ktv();
                const boss = await manager();
                const { row, lines } = await visit([a.id, b.id]);
                await executions.start(a.token, lines[0]!.id);
                await executions.end(a.token, lines[0]!.id);
                await fails(
                  () => executions.resolve(boss.token, lines[0]!.id, { reason: 'r' }),
                  'SERVICE_RESOLUTION_NOT_ALLOWED',
                );
                // Second line is forgotten: resolving it completes the visit exactly like a normal END.
                await tx.visitServiceLine.update({
                  where: { id: lines[1]!.id },
                  data: { status: 'IN_PROGRESS', rowVersion: { increment: 1 } },
                });
                await tx.serviceExecution.create({
                  data: {
                    visitServiceLineId: lines[1]!.id,
                    employeeUserId: b.id,
                    startedAt: at(-40),
                    expectedEndAt: at(-30),
                  },
                });
                assert.equal(
                  (await tx.visit.findUniqueOrThrow({ where: { id: row.id } })).status,
                  'IN_SERVICE',
                );
                const result = await executions.resolve(boss.token, lines[1]!.id, { reason: 'r' });
                assert.equal(result.visitStatus, 'COMPLETED');
                assert.equal(
                  (await tx.visit.findUniqueOrThrow({ where: { id: row.id } })).status,
                  'COMPLETED',
                );
              },
            );

            await suite.test(
              'resolving one of several running services keeps the visit in service',
              async () => {
                const a = await ktv();
                const b = await ktv();
                const boss = await manager();
                const { row, lines } = await visit([a.id, b.id], { split: true });
                await forgotten(lines[0]!);
                await forgotten(lines[1]!, 20);
                const result = await executions.resolve(boss.token, lines[0]!.id, { reason: 'r' });
                assert.equal(result.visitStatus, 'IN_SERVICE');
                assert.equal(
                  (await tx.visit.findUniqueOrThrow({ where: { id: row.id } })).status,
                  'IN_SERVICE',
                );
                assert.equal(
                  (
                    await tx.serviceExecution.findUniqueOrThrow({
                      where: { visitServiceLineId: lines[1]!.id },
                    })
                  ).status,
                  'IN_PROGRESS',
                );
              },
            );

            // ------------------------------------------------------------------ B. line cancellation
            await suite.test(
              'a manager cancels an unperformed line: kept, released, audited, replay-safe',
              async () => {
                const a = await ktv();
                const b = await ktv();
                const boss = await manager();
                const { row, lines } = await visit([a.id, b.id]);
                assert.equal(await occupancy(lines[1]!.id), 1);
                const result = await executions.cancelLine(boss.token, lines[1]!.id, {
                  reason: ' Khách đổi ý ',
                });
                assert.deepEqual(result, {
                  lineId: lines[1]!.id,
                  visitId: row.id,
                  visitCode: row.code,
                  visitStatus: 'OPEN',
                });
                const stored = await tx.visitServiceLine.findUniqueOrThrow({
                  where: { id: lines[1]!.id },
                });
                assert.equal(stored.status, 'CANCELLED');
                assert.equal(stored.cancelReason, 'Khách đổi ý');
                assert.equal(stored.cancelledByUserId, boss.id);
                assert.ok(
                  stored.cancelledAt &&
                    Math.abs(stored.cancelledAt.getTime() - Date.now()) < 60_000,
                );
                assert.equal(
                  stored.serviceCode,
                  service.code,
                  'the line and its snapshot are kept',
                );
                assert.equal(await occupancy(lines[1]!.id), 0, 'the KTV occupancy is released');
                assert.equal(
                  (await tx.visit.findUniqueOrThrow({ where: { id: row.id } })).status,
                  'OPEN',
                );
                const [audit] = await audits(lines[1]!.id, 'VISIT_LINE_CANCELLED');
                assert.ok(audit);
                assert.equal(audit.actorUserId, boss.id);
                assert.equal(audit.subjectUserId, b.id);
                assert.equal(audit.reason, 'Khách đổi ý');
                assert.equal((audit.before as { lineStatus: string }).lineStatus, 'PLANNED');
                // Replay by the same actor is quiet; another actor is refused; nothing is duplicated.
                assert.deepEqual(
                  await executions.cancelLine(boss.token, lines[1]!.id, { reason: 'x' }),
                  result,
                );
                assert.equal((await audits(lines[1]!.id, 'VISIT_LINE_CANCELLED')).length, 1);
                const other = await manager();
                await fails(
                  () => executions.cancelLine(other.token, lines[1]!.id, { reason: 'x' }),
                  'SERVICE_LINE_CANCEL_NOT_ALLOWED',
                );
                // The cancelled line can never START, and it no longer blocks the sequence.
                await fails(
                  () => executions.start(b.token, lines[1]!.id),
                  'SERVICE_START_NOT_ALLOWED',
                );
                assert.equal(await tx.visitServiceLine.count({ where: { visitId: row.id } }), 2);
              },
            );

            await suite.test(
              'cancelling the last open line completes or cancels the visit by the shared rule',
              async () => {
                const a = await ktv();
                const boss = await manager();
                // Something performed, the rest cancelled -> COMPLETED.
                const first = await visit([a.id, a.id]);
                await executions.start(a.token, first.lines[0]!.id);
                await executions.end(a.token, first.lines[0]!.id);
                const done = await executions.cancelLine(boss.token, first.lines[1]!.id, {
                  reason: 'r',
                });
                assert.equal(done.visitStatus, 'COMPLETED');
                const completed = await tx.visit.findUniqueOrThrow({ where: { id: first.row.id } });
                assert.equal(completed.status, 'COMPLETED');
                assert.ok(completed.completedAt);
                // A completed visit is never mutated: its lines can no longer be cancelled.
                await fails(
                  () => executions.cancelLine(boss.token, first.lines[0]!.id, { reason: 'r' }),
                  'SERVICE_LINE_CANCEL_NOT_ALLOWED',
                );
                // Nothing performed and everything cancelled -> the existing CANCELLED visit.
                const second = await visit([a.id], { base: -300 });
                const cancelled = await executions.cancelLine(boss.token, second.lines[0]!.id, {
                  reason: 'Khách rời đi',
                });
                assert.equal(cancelled.visitStatus, 'CANCELLED');
                const closed = await tx.visit.findUniqueOrThrow({ where: { id: second.row.id } });
                assert.equal(closed.status, 'CANCELLED');
                assert.equal(closed.cancelReason, 'Khách rời đi');
                assert.equal(closed.cancelledByUserId, boss.id);
              },
            );

            await suite.test(
              'started or performed lines and closed visits are refused',
              async () => {
                const a = await ktv();
                const boss = await manager();
                const { row, lines } = await visit([a.id, a.id, a.id]);
                await executions.start(a.token, lines[0]!.id);
                await fails(
                  () => executions.cancelLine(boss.token, lines[0]!.id, { reason: 'r' }),
                  'SERVICE_LINE_CANCEL_NOT_ALLOWED',
                );
                await executions.end(a.token, lines[0]!.id);
                await fails(
                  () => executions.cancelLine(boss.token, lines[0]!.id, { reason: 'r' }),
                  'SERVICE_LINE_CANCEL_NOT_ALLOWED',
                );
                assert.equal(
                  (await tx.visitServiceLine.findUniqueOrThrow({ where: { id: lines[0]!.id } }))
                    .status,
                  'DONE',
                );
                // Middle line cancelled: the participant's next line is no longer blocked by it.
                await executions.cancelLine(boss.token, lines[1]!.id, { reason: 'r' });
                assert.equal((await executions.start(a.token, lines[2]!.id)).status, 'IN_PROGRESS');
                assert.equal(
                  (await tx.visit.findUniqueOrThrow({ where: { id: row.id } })).status,
                  'IN_SERVICE',
                );
              },
            );

            await suite.test('a WAITING walk-in line can be cancelled too', async () => {
              const a = await ktv();
              const boss = await manager();
              const anchor = await visit([a.id]);
              const waiting = await tx.visitServiceLine.create({
                data: {
                  visitId: anchor.row.id,
                  participantId: anchor.lines[0]!.participantId,
                  sequence: 2,
                  serviceId: service.id,
                  assignmentMode: 'ANY',
                  status: 'WAITING',
                  durationMinutes: 10,
                  serviceCode: service.code,
                  serviceNameVi: 'Service',
                  serviceNameEn: 'Service',
                  catalogPriceMinVnd: 100_000n,
                  catalogPriceMaxVnd: 100_000n,
                  catalogPricingUnit: 'PER_SERVICE',
                },
              });
              const result = await executions.cancelLine(boss.token, waiting.id, { reason: 'r' });
              assert.equal(result.visitStatus, 'OPEN');
              assert.equal(
                (await tx.visitServiceLine.findUniqueOrThrow({ where: { id: waiting.id } })).status,
                'CANCELLED',
              );
            });

            await suite.test(
              'cancellation authority: permission, branch, reason, unknown ids',
              async () => {
                const a = await ktv();
                const boss = await manager();
                const resolveOnly = await person([
                  { roleId: resolveOnlyRole.id, branchId: branch.id },
                ]);
                const wrongBranch = await person([
                  { roleId: cancelOnlyRole.id, branchId: elsewhere.id },
                ]);
                const { lines } = await visit([a.id]);
                await fails(
                  () => executions.cancelLine(a.token, lines[0]!.id, { reason: 'r' }),
                  'FORBIDDEN',
                );
                await fails(
                  () => executions.cancelLine(resolveOnly.token, lines[0]!.id, { reason: 'r' }),
                  'FORBIDDEN',
                );
                await fails(
                  () => executions.cancelLine(wrongBranch.token, lines[0]!.id, { reason: 'r' }),
                  'FORBIDDEN',
                );
                await fails(
                  () => executions.cancelLine(boss.token, lines[0]!.id, { reason: '  ' }),
                  'VALIDATION_FAILED',
                  'reason',
                );
                await fails(
                  () => executions.cancelLine(boss.token, randomUUID(), { reason: 'r' }),
                  'NOT_FOUND',
                );
                await fails(
                  () => executions.cancelLine(boss.token, 'nope', { reason: 'r' }),
                  'NOT_FOUND',
                );
                assert.equal(
                  (await tx.visitServiceLine.findUniqueOrThrow({ where: { id: lines[0]!.id } }))
                    .status,
                  'PLANNED',
                );
              },
            );

            await suite.test(
              'history is never deleted: guards reject removing lines and executions',
              async () => {
                const a = await ktv();
                const boss = await manager();
                const { lines } = await visit([a.id, a.id]);
                await executions.cancelLine(boss.token, lines[1]!.id, { reason: 'r' });
                await assert.rejects(() =>
                  isolated(() => tx.visitServiceLine.delete({ where: { id: lines[1]!.id } })),
                );
                assert.equal(
                  await tx.visitServiceLine.count({
                    where: { id: lines[1]!.id, status: 'CANCELLED' },
                  }),
                  1,
                );
              },
            );

            // ------------------------------------------------------------------ the operational board
            await suite.test(
              'the board offers only the relevant actions to the right actor',
              async () => {
                const a = await ktv();
                const b = await ktv();
                const boss = await manager();
                const { row, lines } = await visit([a.id, b.id], { split: true });
                await forgotten(lines[0]!);
                const settings = await loadTimingSettings(tx);
                const board = (
                  actorUserId: string,
                  canCancelLine: boolean,
                  canResolveExecution: boolean,
                ) =>
                  operationalToday(tx, {
                    branchId: branch.id,
                    date: new Date(today),
                    now: new Date(),
                    settings,
                    canArrive: false,
                    canManageQueue: false,
                    actorUserId,
                    canCancelLine,
                    canResolveExecution,
                  });
                const asManager = await board(boss.id, true, true);
                const entry = asManager.activeVisits.find((item) => item.id === row.id)!;
                const running = entry.lines.find((line) => line.id === lines[0]!.id)!;
                const planned = entry.lines.find((line) => line.id === lines[1]!.id)!;
                assert.equal(running.status, 'IN_PROGRESS');
                assert.equal(running.execution?.overdue, true);
                assert.deepEqual(running.actions, { cancel: false, resolve: true });
                assert.deepEqual(planned.actions, { cancel: true, resolve: false });
                // The performer never sees "resolve" for their own service; permissions gate both actions.
                const asPerformer = await board(a.id, true, true);
                assert.equal(
                  asPerformer.activeVisits
                    .find((item) => item.id === row.id)!
                    .lines.find((l) => l.id === lines[0]!.id)!.actions.resolve,
                  false,
                );
                const viewOnly = await board(boss.id, false, false);
                assert.ok(
                  viewOnly.activeVisits
                    .find((item) => item.id === row.id)!
                    .lines.every((line) => !line.actions.cancel && !line.actions.resolve),
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
