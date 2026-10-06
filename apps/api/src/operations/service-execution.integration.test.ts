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
import { ReassignmentService } from './reassignment.service.js';
import { ServiceExecutionService } from './service-execution.service.js';
import { appointForFixture } from '../testing/organization-fixture.js';
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
            const runner = {
              withTransaction: isolated,
              withExclusiveTransaction: isolated,
              resolveForMutation: (token: string) => sessions.resolveForMutation(token, tx),
            };
            const throttle = new AuthThrottleService(environment);
            const executions = new ServiceExecutionService(runner, throttle);
            const reassignments = new ReassignmentService(runner, throttle);
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

            let managerRole: { id: string } | undefined;
            const ktv = async (
              options: {
                permission?: boolean;
                checkedIn?: boolean;
                collaborator?: boolean;
                manager?: boolean;
              } = {},
            ) => {
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
                  classification: options.collaborator ? 'COLLABORATOR' : 'OFFICIAL_EMPLOYEE',
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
              if (options.manager) {
                // A desk manager who may reassign work (hierarchy position needed by the command).
                managerRole ??= await tx.role.create({
                  data: {
                    code: `EXEC_MGR_${run}`,
                    displayNameVi: 'Manager',
                    displayNameEn: 'Manager',
                    permissions: {
                      create: {
                        permissionId: (
                          await tx.permission.findUniqueOrThrow({
                            where: { code: 'REASSIGN_SERVICES' },
                          })
                        ).id,
                      },
                    },
                  },
                });
                await tx.userRoleAssignment.create({
                  data: {
                    userId: user.id,
                    roleId: managerRole.id,
                    scopeKind: 'BRANCH',
                    branchId: branch.id,
                  },
                });
                await appointForFixture(tx, user.id, branch.id);
              }
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

            await suite.test('cancelled line cannot START', async () => {
              const actor = await ktv();
              const future = await visit([actor.id], 60);
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
            // ------------------------------------------------------------------ early START (Owner, 2026-10-07)
            const claimOf = async (lineId: string) => {
              const [row] = await tx.$queryRaw<{ lo: Date; hi: Date }[]>`
                SELECT lower(period) AS lo, upper(period) AS hi FROM ktv_occupancies
                WHERE visit_service_line_id = ${lineId}::uuid`;
              return row;
            };

            await suite.test(
              'early START: free KTV, checked-in customer; booked and actual times are both kept',
              async () => {
                const actor = await ktv();
                const {
                  row,
                  lines: [line],
                } = await visit([actor.id], 30);
                const hint = await executions.get(actor.token, line!.id);
                assert.equal(hint.actions.start, true);
                assert.equal(hint.actions.startBlockedBy, null);
                assert.equal(
                  (await executions.myWork(actor.token, branch.id)).lines.find(
                    (entry) => entry.lineId === line!.id,
                  )?.actions.start,
                  true,
                );
                const started = await executions.start(actor.token, line!.id);
                assert.equal(started.status, 'IN_PROGRESS');
                assert.equal(started.visitStatus, 'IN_SERVICE');
                const early = started.execution!.startedEarlyMinutes;
                assert.ok(early >= 29 && early <= 30, `started ${early} minutes early`);
                assert.equal(
                  Date.parse(started.execution!.expectedEndAt) -
                    Date.parse(started.execution!.startedAt),
                  600_000,
                  'expected end = actual start + duration',
                );
                // The booked window is never rewritten; the database claims the early part too.
                const stored = await tx.visitServiceLine.findUniqueOrThrow({
                  where: { id: line!.id },
                });
                assert.deepEqual(stored.plannedStartAt, line!.plannedStartAt);
                assert.deepEqual(stored.plannedEndAt, line!.plannedEndAt);
                const claim = await claimOf(line!.id);
                assert.equal(claim!.lo.getTime(), Date.parse(started.execution!.startedAt));
                assert.equal(claim!.hi.getTime(), line!.plannedEndAt!.getTime());
                // Audit and outbox carry the booked time, the actual time and the minutes early.
                const audit = await tx.auditEvent.findFirstOrThrow({
                  where: { entityId: started.execution!.id, action: 'SERVICE_STARTED' },
                });
                const outbox = await tx.outboxEvent.findFirstOrThrow({
                  where: { aggregateId: started.execution!.id, eventType: 'SERVICE_STARTED' },
                });
                for (const facts of [audit.after, outbox.payload] as Record<string, unknown>[]) {
                  assert.equal(facts['plannedStartAt'], line!.plannedStartAt!.toISOString());
                  assert.equal(facts['startedAt'], started.execution!.startedAt);
                  assert.equal(facts['startedEarlyMinutes'], early);
                }
                // The board read model shows the same label data.
                const ended = await executions.end(actor.token, line!.id);
                assert.equal(ended.status, 'DONE');
                assert.equal(ended.visitStatus, 'COMPLETED');
                assert.equal(ended.execution!.startedEarlyMinutes, early);
                assert.equal(await claimOf(line!.id), undefined, 'the claim ends with the line');
                assert.ok(
                  (await tx.visit.findUniqueOrThrow({ where: { id: row.id } })).completedAt,
                );
              },
            );

            await suite.test(
              'early START is refused while the KTV has a service running',
              async () => {
                const actor = await ktv();
                const running = await visit([actor.id], -60);
                const later = await visit([actor.id], 30);
                await executions.start(actor.token, running.lines[0]!.id);
                await fails(
                  () => executions.start(actor.token, later.lines[0]!.id),
                  'SERVICE_KTV_BUSY',
                );
                assert.equal(
                  (await executions.get(actor.token, later.lines[0]!.id)).actions.startBlockedBy,
                  'SERVICE_KTV_BUSY',
                );
              },
            );

            await suite.test(
              'early START is refused over the previous booking, allowed once it has finished',
              async () => {
                const actor = await ktv();
                const previous = await visit([actor.id], -5); // planned [-5, +5): customer not started yet
                const target = await visit([actor.id], 30);
                await fails(
                  () => executions.start(actor.token, target.lines[0]!.id),
                  'SERVICE_EARLY_START_CONFLICT',
                );
                const hint = await executions.get(actor.token, target.lines[0]!.id);
                assert.equal(hint.actions.start, false);
                assert.equal(hint.actions.startBlockedBy, 'SERVICE_EARLY_START_CONFLICT');
                assert.equal(
                  await tx.serviceExecution.count({
                    where: { visitServiceLineId: target.lines[0]!.id },
                  }),
                  0,
                );
                await executions.start(actor.token, previous.lines[0]!.id);
                await executions.end(actor.token, previous.lines[0]!.id);
                assert.equal(
                  (await executions.start(actor.token, target.lines[0]!.id)).status,
                  'IN_PROGRESS',
                );
              },
            );

            await suite.test(
              'early START is safe for the next booking: it keeps its slot and nobody can book the early part',
              async () => {
                const actor = await ktv();
                const target = await visit([actor.id], 30); // [+30, +40)
                const next = await visit([actor.id], 40); // [+40, +50)
                const started = await executions.start(actor.token, target.lines[0]!.id);
                const claim = await claimOf(target.lines[0]!.id);
                const nextClaim = await claimOf(next.lines[0]!.id);
                assert.equal(claim!.lo.getTime(), Date.parse(started.execution!.startedAt));
                assert.equal(claim!.hi.getTime(), at(40).getTime());
                assert.equal(
                  nextClaim!.lo.getTime(),
                  at(40).getTime(),
                  'the next slot is untouched',
                );
                assert.ok(claim!.hi.getTime() <= nextClaim!.lo.getTime(), 'no overlap');
                // The database itself rejects new work inside the early part of the claim.
                await assert.rejects(
                  () => isolated(() => visit([actor.id], 5)),
                  /ktv_occupancies_no_overlap|exclusion constraint/,
                );
                await executions.end(actor.token, target.lines[0]!.id);
                // After END the early service freed everything it did not use.
                assert.equal(await claimOf(target.lines[0]!.id), undefined);
                assert.equal(
                  (await executions.get(actor.token, next.lines[0]!.id)).actions.start,
                  true,
                );
              },
            );

            await suite.test(
              'early START of a collaborator is refused outside the scheduled shift',
              async () => {
                const outside = await ktv({ collaborator: true });
                const covered = await ktv({ collaborator: true });
                const outsideLine = (await visit([outside.id], 30)).lines[0]!;
                const coveredLine = (await visit([covered.id], 30)).lines[0]!;
                const shift = (employeeUserId: string, startMinute: number) =>
                  tx.collaboratorWorkOccurrence.create({
                    data: {
                      employeeUserId,
                      branchId: branch.id,
                      workDate: new Date(today),
                      mode: 'SHIFT',
                      startMinute,
                      endMinute: 20 * 60,
                      createdByUserId: employeeUserId,
                      updatedByUserId: employeeUserId,
                    },
                  });
                // The fixture clock is 12:mm branch-local (mm = the current minute): this shift begins 20 minutes from now.
                await shift(outside.id, 12 * 60 + now.getUTCMinutes() + 20);
                await shift(covered.id, 10 * 60);
                await fails(
                  () => executions.start(outside.token, outsideLine.id),
                  'SERVICE_EARLY_START_OUTSIDE_SHIFT',
                );
                assert.equal(
                  (await executions.get(outside.token, outsideLine.id)).actions.startBlockedBy,
                  'SERVICE_EARLY_START_OUTSIDE_SHIFT',
                );
                assert.equal(
                  (await executions.start(covered.token, coveredLine.id)).status,
                  'IN_PROGRESS',
                );
              },
            );

            await suite.test(
              'late START is unchanged: no early label, planned claim kept, conflicts still refused',
              async () => {
                const actor = await ktv();
                const late = await visit([actor.id], -30); // planned [-30, -20)
                const started = await executions.start(actor.token, late.lines[0]!.id);
                assert.equal(started.execution!.startedEarlyMinutes, 0);
                assert.equal(
                  (await claimOf(late.lines[0]!.id))!.lo.getTime(),
                  late.lines[0]!.plannedStartAt!.getTime(),
                );
                const audit = await tx.auditEvent.findFirstOrThrow({
                  where: { entityId: started.execution!.id, action: 'SERVICE_STARTED' },
                });
                assert.equal((audit.after as Record<string, unknown>)['startedEarlyMinutes'], 0);
                await executions.end(actor.token, late.lines[0]!.id);
                const blocked = await ktv();
                const delayed = await visit([blocked.id], -30);
                await visit([blocked.id], -5); // another reservation covering now
                await fails(
                  () => executions.start(blocked.token, delayed.lines[0]!.id),
                  'SERVICE_START_UNAVAILABLE',
                );
              },
            );

            await suite.test(
              'technician switch, then early START: only the new technician can start, within their own free time',
              async () => {
                const original = await ktv();
                const replacement = await ktv();
                const manager = await ktv({ manager: true, permission: false });
                const {
                  lines: [line],
                } = await visit([original.id], 30);
                await reassignments.reassign(manager.token, 'VISIT', line!.id, {
                  scope: 'LINE',
                  targets: [{ id: line!.id, expectedVersion: line!.rowVersion }],
                  employeeUserId: replacement.id,
                  context: 'MANAGER',
                  reason: 'Switch technician before an early start',
                  acknowledgeSpecific: true,
                });
                await fails(() => executions.start(original.token, line!.id), 'NOT_FOUND');
                const started = await executions.start(replacement.token, line!.id);
                assert.equal(started.status, 'IN_PROGRESS');
                assert.ok(started.execution!.startedEarlyMinutes >= 29);
                assert.equal(
                  (
                    await tx.serviceExecution.findUniqueOrThrow({
                      where: { id: started.execution!.id },
                    })
                  ).employeeUserId,
                  replacement.id,
                );
                const claim = await claimOf(line!.id);
                assert.equal(claim!.lo.getTime(), Date.parse(started.execution!.startedAt));
              },
            );

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
