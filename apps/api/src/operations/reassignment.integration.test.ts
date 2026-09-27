import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ReassignServicesRequest, ReplacementOptionsResponse } from '@lucy-spa/contracts';
import {
  createDatabaseClient,
  syncPermissionCatalog,
  type PermissionCode,
  type Prisma,
} from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { LeaveService } from '../leave/leave.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { ReassignmentService } from './reassignment.service.js';

// Added for the final Phase 3 gate. No tests were executed during Step 8 implementation.
test(
  'Step 8 leave approval, discovery, scoped reassignment and durable history; fixtures roll back',
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
    const rollback = new Error('Step 8 fixture rollback');
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    try {
      await assert.rejects(
        database.$transaction(
          async (tx: Prisma.TransactionClient) => {
            let n = 0;
            let serial = 0;
            const isolated = async <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => {
              const name = `reassignment_command_${++serial}`;
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
            const assignments = new ReassignmentService(runner, throttle);
            const leaves = new LeaveService(runner, throttle);
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
            const localDate = (instant: Date) =>
              new Date(instant.getTime() + offset * 3_600_000).toISOString().slice(0, 10);
            const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
            const today = localDate(now);
            const tomorrow = localDate(at(1440));
            const branch = await tx.branch.create({
              data: { code: `RAS_${run}`, name: 'Reassignment', timezone: zone },
            });
            const otherBranch = await tx.branch.create({
              data: { code: `RAS_OTHER_${run}`, name: 'Other', timezone: zone },
            });
            for (let isoWeekday = 1; isoWeekday <= 7; isoWeekday++)
              await tx.branchOperatingHours.create({
                data: {
                  branchId: branch.id,
                  isoWeekday,
                  opensAtMinute: 0,
                  closesAtMinute: 1440,
                },
              });
            await syncPermissionCatalog(tx);
            const skill = await tx.skill.create({
              data: { code: `RAS_${run}`, nameVi: 'Skill', nameEn: 'Skill' },
            });
            const category = await tx.serviceCategory.create({
              data: { code: `RAS_${run}`, nameVi: 'Group', nameEn: 'Group' },
            });
            const service = await tx.service.create({
              data: {
                code: `RAS_${run}`,
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
            await tx.serviceSkill.create({ data: { serviceId: service.id, skillId: skill.id } });
            await tx.serviceBranchAvailability.create({
              data: { serviceId: service.id, branchId: branch.id },
            });
            const phonePrefix = String(Math.floor(Math.random() * 100_000)).padStart(5, '0');
            const user = async (kind: 'EMPLOYEE' | 'CUSTOMER') => {
              const number = ++n;
              return tx.user.create({
                data: {
                  kind,
                  status: 'ACTIVE',
                  fullName: `Reassignment ${number}`,
                  preferredLocale: 'vi',
                  normalizationVersion: 1,
                  phoneCanonical: `+849${phonePrefix}${String(number).padStart(3, '0')}`,
                  passwordHash: '$argon2id$fixture',
                  ...(kind === 'EMPLOYEE'
                    ? {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `RAS_${run}_${number}`,
                            dateOfBirth: new Date('1990-01-01'),
                            address: 'Fixture',
                          },
                        },
                      }
                    : {
                        emailCanonical: `ras-${run.toLowerCase()}-${number}@example.invalid`,
                        emailDelivery: `ras-${run.toLowerCase()}-${number}@example.invalid`,
                        emailVerifiedAt: at(-60),
                        customerProfile: {
                          create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
                        },
                      }),
                },
              });
            };
            const staff = async (codes: PermissionCode[], checkedIn = true, qualified = true) => {
              const employee = await user('EMPLOYEE');
              await tx.employmentClassificationChange.create({
                data: {
                  employeeUserId: employee.id,
                  classification: 'OFFICIAL_EMPLOYEE',
                  effectiveDate: new Date('2020-01-01'),
                },
              });
              await tx.employeeBranchAssignment.create({
                data: {
                  employeeUserId: employee.id,
                  branchId: branch.id,
                  grantedByUserId: employee.id,
                },
              });
              if (qualified)
                await tx.employeeSkill.create({
                  data: {
                    employeeUserId: employee.id,
                    skillId: skill.id,
                    grantedByUserId: employee.id,
                  },
                });
              if (checkedIn)
                await tx.attendanceRecord.create({
                  data: {
                    employeeUserId: employee.id,
                    branchId: branch.id,
                    businessDate: new Date(today),
                    checkInAt: at(-180),
                  },
                });
              if (codes.length) {
                const permissions = await tx.permission.findMany({
                  where: { code: { in: codes } },
                  select: { id: true },
                });
                const role = await tx.role.create({
                  data: {
                    code: `RAS_${run}_${++n}`,
                    displayNameVi: 'Role',
                    displayNameEn: 'Role',
                    permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
                  },
                });
                await tx.userRoleAssignment.create({
                  data: {
                    userId: employee.id,
                    roleId: role.id,
                    scopeKind: 'BRANCH',
                    branchId: branch.id,
                  },
                });
              }
              const token = (
                await sessions.rotateAuthenticated(
                  (await sessions.createAnonymous(tx)).token,
                  {
                    userId: employee.id,
                    passwordHash: employee.passwordHash!,
                    credentialVersion: employee.credentialVersion,
                    authzVersion: employee.authzVersion,
                  },
                  { reauthenticated: false },
                  tx,
                )
              ).token;
              return { id: employee.id, token };
            };
            const manager = await staff(['REASSIGN_SERVICES', 'APPROVE_LEAVE'], true, false);
            const desk = await staff(['MANAGE_BOOKINGS'], true, false);
            const original = await staff([]);
            const replacement = await staff([]);
            const absent = await staff([], false);
            const unqualified = await staff([], true, false);
            const customer = await user('CUSTOMER');
            const snapshot = {
              serviceId: service.id,
              durationMinutes: 10,
              bufferMinutes: 5,
              serviceCode: service.code,
              serviceNameVi: 'Snapshot service',
              serviceNameEn: 'Snapshot service',
              catalogPriceMinVnd: 100_000n,
              catalogPriceMaxVnd: 100_000n,
              catalogPricingUnit: 'PER_SERVICE' as const,
            };
            const booking = await tx.booking.create({
              data: {
                code: `RAS-B-${run}`,
                branchId: branch.id,
                ownerUserId: customer.id,
                channel: 'ONLINE',
                startsAt: at(1440),
                endsAt: at(1465),
                serviceDate: new Date(tomorrow),
                idempotencyKey: randomUUID(),
                createdByUserId: customer.id,
              },
            });
            const recipient = await tx.bookingRecipient.create({
              data: { bookingId: booking.id, relation: 'SELF' },
            });
            const bookingLines: Prisma.BookingServiceLineGetPayload<Record<string, never>>[] = [];
            for (const [i, mode] of (['SPECIFIC', 'ANY'] as const).entries())
              bookingLines.push(
                await tx.bookingServiceLine.create({
                  data: {
                    ...snapshot,
                    bookingId: booking.id,
                    recipientId: recipient.id,
                    sequence: i + 1,
                    employeeUserId: original.id,
                    assignmentMode: mode,
                    plannedStartAt: at(1440 + i * 15),
                    plannedEndAt: at(1450 + i * 15),
                  },
                }),
              );
            const visit = await tx.visit.create({
              data: {
                code: `RAS-V-${run}`,
                branchId: branch.id,
                origin: 'WALK_IN',
                serviceDate: new Date(today),
                arrivedAt: at(-60),
                createdByUserId: manager.id,
              },
            });
            const participant = await tx.visitParticipant.create({
              data: { visitId: visit.id, kind: 'GUEST', displayName: 'Guest' },
            });
            const visitLine = await tx.visitServiceLine.create({
              data: {
                ...snapshot,
                visitId: visit.id,
                participantId: participant.id,
                sequence: 1,
                employeeUserId: original.id,
                assignmentMode: 'SPECIFIC',
                requestedEmployeeUserId: original.id,
                plannedStartAt: at(30),
                plannedEndAt: at(40),
              },
            });
            const waiting = await tx.visitServiceLine.create({
              data: {
                ...snapshot,
                bufferMinutes: null,
                visitId: visit.id,
                participantId: participant.id,
                sequence: 2,
                assignmentMode: 'ANY',
                status: 'WAITING',
              },
            });
            const request = (
              options: ReplacementOptionsResponse,
              employeeUserId = replacement.id,
            ): ReassignServicesRequest => ({
              scope: options.scope,
              targets: options.lines.map((line) => ({
                id: line.id,
                expectedVersion: line.version,
              })),
              employeeUserId,
              context: 'LEAVE',
              reason: 'Replace staff for approved leave',
              acknowledgeSpecific: true,
            });
            let pendingId = '';

            await suite.test(
              'database preserves SPECIFIC initial assignment and immutable intent',
              async () => {
                await assert.rejects(
                  isolated((client) =>
                    client.visitServiceLine.create({
                      data: {
                        ...snapshot,
                        visitId: visit.id,
                        participantId: participant.id,
                        sequence: 3,
                        assignmentMode: 'SPECIFIC',
                        requestedEmployeeUserId: original.id,
                        employeeUserId: replacement.id,
                        plannedStartAt: at(90),
                        plannedEndAt: at(100),
                      },
                    }),
                  ),
                  /Initial assignment must honor the requested KTV/,
                );
                await tx.visitServiceLine.update({
                  where: { id: waiting.id },
                  data: {
                    assignmentMode: 'SPECIFIC',
                    requestedEmployeeUserId: original.id,
                    rowVersion: { increment: 1 },
                  },
                });
                await assert.rejects(
                  isolated((client) =>
                    client.visitServiceLine.update({
                      where: { id: waiting.id },
                      data: {
                        status: 'PLANNED',
                        employeeUserId: replacement.id,
                        plannedStartAt: at(90),
                        plannedEndAt: at(100),
                        bufferMinutes: 0,
                        rowVersion: { increment: 1 },
                      },
                    }),
                  ),
                  /Initial assignment must honor the requested KTV/,
                );
                await assert.rejects(
                  isolated((client) =>
                    client.visitServiceLine.update({
                      where: { id: visitLine.id },
                      data: {
                        requestedEmployeeUserId: replacement.id,
                        rowVersion: { increment: 1 },
                      },
                    }),
                  ),
                  /intent/,
                );
                await tx.visitServiceLine.update({
                  where: { id: waiting.id },
                  data: {
                    assignmentMode: 'ANY',
                    requestedEmployeeUserId: null,
                    rowVersion: { increment: 1 },
                  },
                });
              },
            );

            await suite.test(
              'PENDING leave is not a conflict; approval flags affected work and emits events without moving it',
              async () => {
                const pending = await leaves.create(original.token, {
                  leaveType: 'ANNUAL',
                  startDate: today,
                  endDate: tomorrow,
                  reason: 'Fixture leave',
                });
                pendingId = pending.id;
                assert.equal(
                  (await assignments.list(manager.token, branch.id, { from: today, to: tomorrow }))
                    .lines.length,
                  0,
                );
                await leaves.approve(manager.token, pending.id, {
                  expectedVersion: pending.version,
                });
                const rows = (
                  await assignments.list(manager.token, branch.id, { from: today, to: tomorrow })
                ).lines;
                assert.equal(rows.length, 3);
                assert.ok(
                  rows.every(
                    (line) =>
                      line.employee.id === original.id && line.leaveRequestId === pending.id,
                  ),
                );
                assert.equal(
                  (
                    await tx.bookingServiceLine.findUniqueOrThrow({
                      where: { id: bookingLines[0]!.id },
                    })
                  ).assignmentConflict,
                  'LEAVE',
                );
                assert.equal(
                  await tx.outboxEvent.count({
                    where: {
                      eventType: 'BOOKING_KTV_CONFLICT',
                      OR: [{ aggregateId: booking.id }, { aggregateId: visit.id }],
                    },
                  }),
                  3,
                );
                assert.equal(
                  await tx.outboxEvent.count({
                    where: { eventType: 'EMPLOYEE_LEAVE_APPROVED', aggregateId: pending.id },
                  }),
                  1,
                );
                assert.equal(
                  await tx.serviceLineAssignmentChange.count({
                    where: { bookingServiceLineId: bookingLines[0]!.id },
                  }),
                  0,
                );
              },
            );

            await suite.test(
              'future replacements need no attendance; operational visit replacements require it and qualification',
              async () => {
                const future = await assignments.replacements(
                  manager.token,
                  'BOOKING',
                  bookingLines[0]!.id,
                  'PARTICIPANT',
                );
                assert.equal(future.lines.length, 2);
                assert.ok(future.candidates.some((candidate) => candidate.id === absent.id));
                const operational = await assignments.replacements(
                  manager.token,
                  'VISIT',
                  visitLine.id,
                  'PARTICIPANT',
                );
                assert.equal(operational.lines.length, 1); // WAITING remains initial assignment.
                assert.ok(
                  !operational.candidates.some(
                    (candidate) =>
                      candidate.id === absent.id ||
                      candidate.id === unqualified.id ||
                      candidate.id === original.id,
                  ),
                );
                await fails(
                  () =>
                    assignments.reassign(
                      manager.token,
                      'VISIT',
                      visitLine.id,
                      request(operational, absent.id),
                    ),
                  'REASSIGNMENT_KTV_UNAVAILABLE',
                );
                await fails(
                  () => assignments.replacements(manager.token, 'VISIT', waiting.id, 'LINE'),
                  'REASSIGNMENT_NOT_ALLOWED',
                );
                await fails(
                  () =>
                    assignments.replacements(desk.token, 'BOOKING', bookingLines[0]!.id, 'LINE'),
                  'FORBIDDEN',
                );
                await fails(() => assignments.list(manager.token, otherBranch.id, {}), 'FORBIDDEN');
              },
            );

            await suite.test(
              'explicit Q3 scope moves only shown lines, keeps ANY/SPECIFIC intent and appends atomic history/audit/events',
              async () => {
                const options = await assignments.replacements(
                  manager.token,
                  'BOOKING',
                  bookingLines[0]!.id,
                  'PARTICIPANT',
                );
                const body = request(options);
                await fails(
                  () =>
                    assignments.reassign(manager.token, 'BOOKING', bookingLines[0]!.id, {
                      ...body,
                      acknowledgeSpecific: false,
                    }),
                  'REASSIGNMENT_SPECIFIC_ACK_REQUIRED',
                );
                const changed = await assignments.reassign(
                  manager.token,
                  'BOOKING',
                  bookingLines[0]!.id,
                  body,
                );
                assert.ok(
                  changed.lines.every(
                    (line) => line.employee.id === replacement.id && !line.leaveConflict,
                  ),
                );
                assert.equal(changed.lines[0]!.assignmentMode, 'SPECIFIC');
                assert.equal(changed.lines[0]!.requestedEmployeeId, original.id);
                assert.equal(changed.lines[1]!.assignmentMode, 'ANY');
                for (const line of bookingLines) {
                  const stored = await tx.bookingServiceLine.findUniqueOrThrow({
                    where: { id: line.id },
                  });
                  assert.deepEqual(stored.plannedStartAt, line.plannedStartAt);
                  assert.deepEqual(stored.plannedEndAt, line.plannedEndAt);
                  assert.equal(stored.durationMinutes, 10);
                  assert.equal(stored.bufferMinutes, 5);
                  const history = await tx.serviceLineAssignmentChange.findMany({
                    where: { bookingServiceLineId: line.id },
                  });
                  assert.equal(history.length, 1);
                  assert.equal(history[0]!.fromEmployeeUserId, original.id);
                  assert.equal(history[0]!.toEmployeeUserId, replacement.id);
                  assert.equal(history[0]!.actorUserId, manager.id);
                  assert.equal(history[0]!.reason, 'LEAVE');
                  assert.equal(history[0]!.note, body.reason);
                  assert.equal(
                    await tx.auditEvent.count({
                      where: { entityId: line.id, action: 'KTV_REASSIGNED' },
                    }),
                    1,
                  );
                }
                assert.equal(
                  await tx.outboxEvent.count({
                    where: { aggregateId: booking.id, eventType: 'KTV_REASSIGNED' },
                  }),
                  2,
                );
                assert.equal(
                  (await tx.visitServiceLine.findUniqueOrThrow({ where: { id: visitLine.id } }))
                    .employeeUserId,
                  original.id,
                );
                await fails(
                  () => assignments.reassign(manager.token, 'BOOKING', bookingLines[0]!.id, body),
                  'REASSIGNMENT_CONFLICT',
                );
                const [claims] = await tx.$queryRaw<
                  { n: bigint }[]
                >`SELECT count(*) AS n FROM ktv_occupancies WHERE booking_service_line_id = ANY(${bookingLines.map((line) => line.id)}::uuid[]) AND employee_user_id = ${replacement.id}::uuid`;
                assert.equal(Number(claims!.n), 2);
                assert.ok(pendingId);
              },
            );

            await suite.test(
              'visit reassignment keeps the requested KTV reference and leaves WAITING untouched',
              async () => {
                const options = await assignments.replacements(
                  manager.token,
                  'VISIT',
                  visitLine.id,
                  'LINE',
                );
                await assignments.reassign(manager.token, 'VISIT', visitLine.id, request(options));
                const stored = await tx.visitServiceLine.findUniqueOrThrow({
                  where: { id: visitLine.id },
                });
                assert.equal(stored.status, 'PLANNED');
                assert.equal(stored.employeeUserId, replacement.id);
                assert.equal(stored.requestedEmployeeUserId, original.id);
                assert.equal(stored.assignmentMode, 'SPECIFIC');
                assert.equal(
                  (await tx.visitServiceLine.findUniqueOrThrow({ where: { id: waiting.id } }))
                    .status,
                  'WAITING',
                );
                assert.equal(
                  await tx.serviceExecution.count({ where: { visitServiceLineId: visitLine.id } }),
                  0,
                );
                assert.equal(
                  (await assignments.list(manager.token, branch.id, { from: today, to: tomorrow }))
                    .lines.length,
                  0,
                );
              },
            );
            await suite.test(
              'STARTed, DONE and CANCELLED visit work cannot be reassigned or have execution facts rewritten',
              async () => {
                const before = await assignments.replacements(
                  manager.token,
                  'VISIT',
                  visitLine.id,
                  'LINE',
                );
                const body = { ...request(before, absent.id), context: 'MANAGER' as const };
                await tx.visit.update({
                  where: { id: visit.id },
                  data: { status: 'IN_SERVICE', rowVersion: { increment: 1 } },
                });
                await tx.visitServiceLine.update({
                  where: { id: visitLine.id },
                  data: { status: 'IN_PROGRESS', rowVersion: { increment: 1 } },
                });
                const execution = await tx.serviceExecution.create({
                  data: {
                    visitServiceLineId: visitLine.id,
                    employeeUserId: replacement.id,
                    startedAt: now,
                    expectedEndAt: at(10),
                  },
                });
                await fails(
                  () => assignments.reassign(manager.token, 'VISIT', visitLine.id, body),
                  'REASSIGNMENT_NOT_ALLOWED',
                );
                assert.deepEqual(
                  (await tx.serviceExecution.findUniqueOrThrow({ where: { id: execution.id } }))
                    .startedAt,
                  now,
                );
                await tx.serviceExecution.update({
                  where: { id: execution.id },
                  data: {
                    status: 'ENDED',
                    endedAt: at(5),
                    endKind: 'NORMAL',
                    endedByUserId: replacement.id,
                    rowVersion: { increment: 1 },
                  },
                });
                await tx.visitServiceLine.update({
                  where: { id: visitLine.id },
                  data: { status: 'DONE', rowVersion: { increment: 1 } },
                });
                await fails(
                  () => assignments.reassign(manager.token, 'VISIT', visitLine.id, body),
                  'REASSIGNMENT_NOT_ALLOWED',
                );
                await tx.visitServiceLine.update({
                  where: { id: waiting.id },
                  data: {
                    status: 'CANCELLED',
                    cancelledAt: now,
                    cancelledByUserId: manager.id,
                    cancelReason: 'Fixture cancellation',
                    rowVersion: { increment: 1 },
                  },
                });
                await fails(
                  () => assignments.replacements(manager.token, 'VISIT', waiting.id, 'LINE'),
                  'REASSIGNMENT_NOT_ALLOWED',
                );
                assert.equal(
                  await tx.serviceLineAssignmentChange.count({
                    where: { visitServiceLineId: visitLine.id },
                  }),
                  1,
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
