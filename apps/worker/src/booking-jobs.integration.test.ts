import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { appendOutboxEvent, createDatabaseClient, type Prisma } from '@lucy-spa/database';
import { redisConnectionOptions, takeSharedAuthGraphLock } from '@lucy-spa/server';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { recoverWarningPage, relayBookingEvent } from './booking-jobs.js';
import { consumeBookingNotification, operationalRecipients } from './notification-delivery.js';
import {
  ensureWarningSchedules,
  processServiceWarning,
  type WarningTimer,
} from './service-warnings.js';

// Source only for Step 10. Requires an explicitly supplied DISPOSABLE, migrated, seeded
// PostgreSQL database with local-superuser cleanup privileges; never loads the application .env.
test(
  'Step 9 PostgreSQL notifications, recovery, idempotency and source-row races',
  {
    skip: !process.env['PHASE3_TEST_DATABASE_URL'],
  },
  async (suite) => {
    const database = createDatabaseClient(process.env['PHASE3_TEST_DATABASE_URL']!);
    const branchId = randomUUID();
    const categoryId = randomUUID();
    const serviceId = randomUUID();
    const roleId = randomUUID();
    const run = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
    const userIds: string[] = [];
    const phoneBase = String(Math.floor(Math.random() * 100_000)).padStart(5, '0');
    const timers = new Map<string, WarningTimer>();
    const schedule = async (timer: WarningTimer) => {
      timers.set(timer.id, timer);
    };
    let sequence = 0;
    const [clock] = await database.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const now = clock!.now;
    const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
    const employee = async (management = false): Promise<string> => {
      const id = randomUUID();
      userIds.push(id);
      await database.$transaction(async (tx) => {
        await tx.user.create({
          data: {
            id,
            kind: 'EMPLOYEE',
            status: 'ACTIVE',
            fullName: 'Step9 fixture',
            preferredLocale: 'vi',
            normalizationVersion: 1,
            passwordHash: '$argon2id$fixture',
            phoneCanonical: `+849${phoneBase}${String(userIds.length).padStart(3, '0')}`,
            emailCanonical: `step9-${id}@example.invalid`,
            emailDelivery: `step9-${id}@example.invalid`,
            emailVerifiedAt: now,
            employeeProfile: {
              create: {
                employeeCodeCanonical: `S9_${run}_${++sequence}`,
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
          data: { employeeUserId: id, branchId, grantedByUserId: id },
        });
        await tx.userRoleAssignment.create({
          data: { userId: id, roleId, scopeKind: 'BRANCH', branchId },
        });
        if (management) {
          const permission = await tx.permission.findUniqueOrThrow({
            where: { code: 'MANAGE_QUEUE' },
          });
          await tx.userPermissionOverride.create({
            data: {
              userId: id,
              permissionId: permission.id,
              effect: 'ALLOW',
              scopeKind: 'BRANCH',
              branchId,
            },
          });
        }
      });
      return id;
    };
    const work = async (plannedOffset = -60) => {
      const employeeUserId = await employee();
      return database.$transaction(async (tx) => {
        const visit = await tx.visit.create({
          data: {
            code: `S9-${run}-${++sequence}`,
            branchId,
            origin: 'WALK_IN',
            serviceDate: new Date(at(plannedOffset).toISOString().slice(0, 10)),
            arrivedAt: at(-120),
            createdByUserId: employeeUserId,
          },
        });
        const participant = await tx.visitParticipant.create({
          data: { visitId: visit.id, kind: 'GUEST', displayName: 'Fixture' },
        });
        return tx.visitServiceLine.create({
          data: {
            visitId: visit.id,
            participantId: participant.id,
            sequence: 1,
            serviceId,
            employeeUserId,
            assignmentMode: 'ANY',
            plannedStartAt: at(plannedOffset),
            plannedEndAt: at(plannedOffset + 10),
            durationMinutes: 10,
            bufferMinutes: 0,
            serviceCode: `S9_${run}`,
            serviceNameVi: 'Service',
            serviceNameEn: 'Service',
            catalogPriceMinVnd: 1n,
            catalogPriceMaxVnd: 1n,
            catalogPricingUnit: 'PER_SERVICE',
          },
        });
      });
    };
    type Line = Awaited<ReturnType<typeof work>>;
    const start = async (tx: Prisma.TransactionClient, line: Line, startOffset = -20) => {
      await tx.visit.update({
        where: { id: line.visitId },
        data: { status: 'IN_SERVICE', rowVersion: { increment: 1 } },
      });
      await tx.visitServiceLine.update({
        where: { id: line.id },
        data: { status: 'IN_PROGRESS', rowVersion: { increment: 1 } },
      });
      return tx.serviceExecution.create({
        data: {
          visitServiceLineId: line.id,
          employeeUserId: line.employeeUserId!,
          startedAt: at(startOffset),
          expectedEndAt: at(startOffset + line.durationMinutes),
        },
      });
    };
    const end = async (tx: Prisma.TransactionClient, line: Line) => {
      await tx.serviceExecution.update({
        where: { visitServiceLineId: line.id },
        data: {
          status: 'ENDED',
          endedAt: now,
          endKind: 'NORMAL',
          endedByUserId: line.employeeUserId,
          rowVersion: { increment: 1 },
        },
      });
      await tx.visitServiceLine.update({
        where: { id: line.id },
        data: { status: 'DONE', rowVersion: { increment: 1 } },
      });
      await tx.visit.update({
        where: { id: line.visitId },
        data: { status: 'COMPLETED', completedAt: now, rowVersion: { increment: 1 } },
      });
    };
    const schedules = (line: Line) =>
      database.$transaction((tx) => ensureWarningSchedules(tx, line.id));
    try {
      await database.$transaction(async (tx) => {
        await tx.branch.create({
          data: { id: branchId, code: `S9_${run}`, name: 'Step9', timezone: 'UTC' },
        });
        await tx.serviceCategory.create({
          data: { id: categoryId, code: `S9_${run}`, nameVi: 'Group', nameEn: 'Group' },
        });
        await tx.service.create({
          data: {
            id: serviceId,
            categoryId,
            code: `S9_${run}`,
            nameVi: 'Service',
            nameEn: 'Service',
            priceVnd: 1n,
            priceMaxVnd: 1n,
            durationMinutes: 10,
            estimatedMinMinutes: 10,
            estimatedMaxMinutes: 10,
          },
        });
        const permission = await tx.permission.findUniqueOrThrow({
          where: { code: 'PERFORM_SERVICES' },
        });
        await tx.role.create({
          data: {
            id: roleId,
            code: `S9_${run}`,
            displayNameVi: 'No role-name semantics',
            displayNameEn: 'No role-name semantics',
            permissions: { create: { permissionId: permission.id } },
          },
        });
      });
      const manager = await employee(true);
      await suite.test(
        'START-overdue, duplicate jobs and recovery emit once; read survives duplicate delivery',
        async () => {
          const line = await work();
          const [timer] = await schedules(line);
          assert.ok(timer);
          const results = await Promise.allSettled([
            processServiceWarning(database, timer.id),
            processServiceWarning(database, timer.id),
          ]);
          assert.ok(
            results.some((result) => result.status === 'fulfilled' && result.value === 'emitted'),
          );
          assert.equal(await processServiceWarning(database, timer.id), 'stale');
          const notices = await database.notification.findMany({
            where: { entityId: line.visitId, type: 'START_OVERDUE' },
          });
          assert.ok(notices.some((row) => row.recipientUserId === manager));
          const own = notices.find((row) => row.recipientUserId === line.employeeUserId)!;
          assert.ok(own);
          await database.notification.update({ where: { id: own.id }, data: { readAt: now } });
          await recoverWarningPage(database, undefined, schedule, (error) => {
            throw error;
          });
          assert.equal(
            await database.notification.count({
              where: { entityId: line.visitId, recipientUserId: line.employeeUserId! },
            }),
            1,
          );
          assert.equal(
            (
              await database.notification.findUniqueOrThrow({ where: { id: own.id } })
            ).readAt!.getTime(),
            now.getTime(),
          );
          assert.equal(
            (await database.visitServiceLine.findUniqueOrThrow({ where: { id: line.id } })).status,
            'PLANNED',
          );
        },
      );
      await suite.test(
        'pre-END and END-overdue use execution facts and never auto-END',
        async () => {
          const line = await work();
          await database.$transaction((tx) => start(tx, line));
          const saved = await schedules(line);
          assert.deepEqual(saved.map((timer) => timer.kind).sort(), ['END_OVERDUE', 'PRE_END']);
          for (const timer of saved)
            assert.equal(await processServiceWarning(database, timer.id), 'emitted');
          const execution = await database.serviceExecution.findUniqueOrThrow({
            where: { visitServiceLineId: line.id },
          });
          assert.equal(execution.status, 'IN_PROGRESS');
          assert.equal(execution.endedAt, null);
          assert.equal(execution.expectedEndAt.getTime() - execution.startedAt.getTime(), 600_000);
          assert.ok(execution.preEndWarnedAt);
          assert.ok(execution.endOverdueWarnedAt);
          await database.$transaction((tx) => end(tx, line));
          for (const timer of saved)
            assert.equal(await processServiceWarning(database, timer.id), 'stale');
        },
      );
      await suite.test(
        'Redis job loss recreates future schedules; recovery racing normal scheduling keeps one timer',
        async () => {
          const line = await work(10);
          const [a, b] = await Promise.all([schedules(line), schedules(line)]);
          assert.equal(a[0]!.id, b[0]!.id);
          await schedule(a[0]!);
          timers.clear();
          await recoverWarningPage(database, undefined, schedule, (error) => {
            throw error;
          });
          assert.ok(timers.has(a[0]!.id));
          assert.equal(await processServiceWarning(database, a[0]!.id), 'early');
          assert.equal(await database.notification.count({ where: { entityId: line.visitId } }), 0);
        },
      );
      await suite.test(
        'real Redis delayed-job loss is recovered; duplicate BullMQ deliveries commit one warning',
        async () => {
          const redisUrl = process.env['REDIS_URL'];
          assert.ok(redisUrl, 'REDIS_URL must explicitly identify the local validation Redis.');
          const endpoint = new URL(redisUrl);
          assert.ok(
            ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname),
            'Local Redis only.',
          );
          const prefix = `s9-test-${randomUUID()}`;
          const queueName = 'warning-recovery';
          const queue = new Queue<{ scheduleId: string }>(queueName, {
            prefix,
            connection: redisConnectionOptions(redisUrl, 'producer'),
          });
          const events = new QueueEvents(queueName, {
            prefix,
            connection: redisConnectionOptions(redisUrl, 'worker'),
          });
          const errors: Error[] = [];
          queue.on('error', (error) => errors.push(error));
          events.on('error', (error) => errors.push(error));
          const worker = new Worker<{ scheduleId: string }>(
            queueName,
            async (job) => {
              const result = await processServiceWarning(database, job.data.scheduleId);
              if (result === 'early') throw new Error('Warning not due');
              return result;
            },
            { prefix, connection: redisConnectionOptions(redisUrl, 'worker'), concurrency: 2 },
          );
          worker.on('error', (error) => errors.push(error));
          try {
            await Promise.all([
              queue.waitUntilReady(),
              events.waitUntilReady(),
              worker.waitUntilReady(),
            ]);
            const future = await work(30);
            const [timer] = await schedules(future);
            assert.ok(timer);
            const jobId = `warning-${timer.id}`;
            const realSchedule = async (pending: WarningTimer) => {
              // This test's private queue must never pick up another fixture's work.
              if (pending.lineId !== future.id) return;
              await queue.add(
                'service-warning',
                { scheduleId: pending.id },
                {
                  jobId: `warning-${pending.id}`,
                  delay: Math.max(0, pending.dueAt.getTime() - Date.now()),
                  attempts: 10,
                  backoff: { type: 'fixed', delay: 25 },
                },
              );
            };
            await realSchedule(timer);
            const scheduled = await queue.getJob(jobId);
            assert.ok(scheduled);
            assert.equal(await scheduled.getState(), 'delayed');
            await scheduled.remove(); // Simulated Redis job loss, scoped to this exact timer.
            assert.equal(await queue.getJob(jobId), undefined);
            assert.equal(
              await database.serviceWarningSchedule.count({ where: { id: timer.id } }),
              1,
            );
            await recoverWarningPage(database, undefined, realSchedule, (error) => {
              throw error;
            });
            const recovered = await queue.getJob(jobId);
            assert.ok(recovered);
            assert.equal(await recovered.getState(), 'delayed');
            await Promise.all([
              realSchedule(timer),
              recoverWarningPage(database, undefined, realSchedule, (error) => {
                throw error;
              }),
            ]);
            assert.equal(
              await queue.getDelayedCount(),
              1,
              'normal scheduling and recovery share one deterministic job',
            );
            assert.equal(
              await database.notification.count({ where: { entityId: future.visitId } }),
              0,
            );

            const overdue = await work();
            const [due] = await schedules(overdue);
            assert.ok(due);
            // Different technical IDs deliberately bypass Redis deduplication. PostgreSQL must
            // still deduplicate the business occurrence; NOWAIT losers are retried by BullMQ.
            const duplicates = await Promise.all(
              ['first', 'duplicate'].map((suffix) =>
                queue.add(
                  'service-warning',
                  { scheduleId: due.id },
                  {
                    jobId: `warning-${due.id}-${suffix}`,
                    attempts: 10,
                    backoff: { type: 'fixed', delay: 25 },
                  },
                ),
              ),
            );
            const outcomes = await Promise.all(
              duplicates.map((job) => job.waitUntilFinished(events, 15_000)),
            );
            assert.deepEqual(outcomes.sort(), ['emitted', 'stale']);
            const notices = await database.notification.findMany({
              where: { entityId: overdue.visitId, type: 'START_OVERDUE' },
            });
            assert.equal(
              notices.filter((notice) => notice.recipientUserId === overdue.employeeUserId).length,
              1,
            );
            assert.equal(notices.filter((notice) => notice.recipientUserId === manager).length, 1);
            assert.equal(
              await database.outboxEvent.count({
                where: { aggregateId: overdue.visitId, eventType: 'SERVICE_WARNING_DUE' },
              }),
              1,
            );
            assert.equal(await processServiceWarning(database, due.id), 'stale');
            assert.equal(
              (await database.visitServiceLine.findUniqueOrThrow({ where: { id: overdue.id } }))
                .status,
              'PLANNED',
            );
            assert.deepEqual(errors, []);
          } finally {
            await worker.close();
            await events.close();
            // A per-run queue/prefix permits exact queue cleanup. Never FLUSHDB or shared queues.
            try {
              await queue.obliterate({ force: true });
            } finally {
              await queue.close();
            }
          }
        },
      );
      await suite.test(
        'source mutation holds Visit: worker retries; START/END/cancel commit silences stale work',
        async () => {
          for (const action of ['start', 'end', 'cancel'] as const) {
            const line = await work();
            if (action === 'end') await database.$transaction((tx) => start(tx, line));
            const saved = await schedules(line);
            let release!: () => void;
            let locked!: () => void;
            const gate = new Promise<void>((resolve) => {
              release = resolve;
            });
            const ready = new Promise<void>((resolve) => {
              locked = resolve;
            });
            const mutation = database.$transaction(async (tx) => {
              await tx.$queryRaw`SELECT id FROM visits WHERE id = ${line.visitId}::uuid FOR UPDATE`;
              locked();
              await gate;
              if (action === 'start') await start(tx, line);
              if (action === 'end') await end(tx, line);
              if (action === 'cancel')
                await tx.visitServiceLine.update({
                  where: { id: line.id },
                  data: {
                    status: 'CANCELLED',
                    cancelledAt: now,
                    cancelledByUserId: line.employeeUserId,
                    cancelReason: 'Fixture',
                    rowVersion: { increment: 1 },
                  },
                });
            });
            try {
              await ready;
              await assert.rejects(processServiceWarning(database, saved[0]!.id));
            } finally {
              release();
              await mutation;
            }
            for (const timer of saved)
              assert.equal(await processServiceWarning(database, timer.id), 'stale');
            assert.equal(
              await database.notification.count({ where: { entityId: line.visitId } }),
              0,
            );
          }
        },
      );
      await suite.test(
        'reassignment before warning resolves current KTV, never cached old recipient',
        async () => {
          const line = await work();
          const [timer] = await schedules(line);
          const replacement = await employee();
          let release!: () => void;
          let locked!: () => void;
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          const ready = new Promise<void>((resolve) => {
            locked = resolve;
          });
          const mutation = database.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM visits WHERE id = ${line.visitId}::uuid FOR UPDATE`;
            locked();
            await gate;
            await tx.visitServiceLine.update({
              where: { id: line.id },
              data: { employeeUserId: replacement, rowVersion: { increment: 1 } },
            });
          });
          try {
            await ready;
            await assert.rejects(processServiceWarning(database, timer!.id));
          } finally {
            release();
            await mutation;
          }
          await processServiceWarning(database, timer!.id);
          assert.equal(
            await database.notification.count({
              where: { entityId: line.visitId, recipientUserId: line.employeeUserId! },
            }),
            0,
          );
          assert.equal(
            await database.notification.count({
              where: { entityId: line.visitId, recipientUserId: replacement },
            }),
            1,
          );
        },
      );
      await suite.test(
        'permission-based managers, branch DENY and inactive accounts are respected',
        async () => {
          const denied = await employee(true);
          const permission = await database.permission.findUniqueOrThrow({
            where: { code: 'MANAGE_QUEUE' },
          });
          await database.userPermissionOverride.updateMany({
            where: { userId: denied, permissionId: permission.id },
            data: { effect: 'DENY' },
          });
          const inactive = await employee(true);
          await database.user.update({
            where: { id: inactive },
            data: { status: 'INACTIVE', rowVersion: { increment: 1 } },
          });
          const selected = await database.$transaction(async (tx) => {
            await takeSharedAuthGraphLock(tx);
            return operationalRecipients(tx, branchId, [], true);
          });
          assert.ok(selected.includes(manager));
          assert.ok(!selected.includes(denied));
          assert.ok(!selected.includes(inactive));
        },
      );
      await suite.test(
        'late customer cancellation alerts management once; outbox retries preserve read state',
        async () => {
          const customerId = randomUUID();
          userIds.push(customerId);
          const event = await database.$transaction(async (tx) => {
            await tx.user.create({
              data: {
                id: customerId,
                kind: 'CUSTOMER',
                status: 'ACTIVE',
                fullName: 'Fixture',
                preferredLocale: 'vi',
                emailCanonical: `step9-${customerId}@example.invalid`,
                emailDelivery: `step9-${customerId}@example.invalid`,
                emailVerifiedAt: now,
                normalizationVersion: 1,
                passwordHash: '$argon2id$fixture',
                phoneCanonical: `+849${phoneBase}${String(userIds.length).padStart(3, '0')}`,
                customerProfile: {
                  create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
                },
              },
            });
            const booking = await tx.booking.create({
              data: {
                branchId,
                code: `S9-${run}-${++sequence}`,
                ownerUserId: customerId,
                createdByUserId: customerId,
                channel: 'ONLINE',
                startsAt: at(10),
                endsAt: at(20),
                serviceDate: new Date(now.toISOString().slice(0, 10)),
                idempotencyKey: randomUUID(),
              },
            });
            await tx.booking.update({
              where: { id: booking.id },
              data: {
                status: 'CANCELLED',
                cancelledAt: now,
                cancelledByUserId: customerId,
                cancelledLate: true,
                rowVersion: { increment: 1 },
              },
            });
            return appendOutboxEvent(tx, {
              branchId,
              aggregateType: 'Booking',
              aggregateId: booking.id,
              eventType: 'BOOKING_CANCELLED',
              schemaVersion: 1,
              occurredAt: now,
              payload: { late: true, actor: 'CUSTOMER' },
            });
          });
          await Promise.all([
            relayBookingEvent(database, event.id, schedule),
            relayBookingEvent(database, event.id, schedule),
          ]);
          assert.equal(
            await database.notification.count({
              where: {
                sourceEventId: event.id,
                recipientUserId: manager,
                type: 'LATE_CANCELLATION',
              },
            }),
            1,
          );
          assert.equal(
            await database.notification.count({
              where: {
                sourceEventId: event.id,
                recipientUserId: customerId,
                type: 'BOOKING_CANCELLED',
              },
            }),
            1,
          );
          const row = await database.notification.findFirstOrThrow({
            where: { sourceEventId: event.id, recipientUserId: manager },
          });
          await Promise.all([
            database.notification.update({ where: { id: row.id }, data: { readAt: now } }),
            database.$transaction(async (tx) => {
              await takeSharedAuthGraphLock(tx);
              await consumeBookingNotification(tx, event);
            }),
          ]);
          await relayBookingEvent(database, event.id, schedule);
          assert.equal(
            (
              await database.notification.findUniqueOrThrow({ where: { id: row.id } })
            ).readAt!.getTime(),
            now.getTime(),
          );
        },
      );
      await suite.test(
        'leave-conflict and reassignment outbox consumers notify scoped operations and customer once',
        async () => {
          const original = await employee();
          const replacement = await employee();
          const unrelated = await employee();
          const customerId = randomUUID();
          userIds.push(customerId);
          const fixture = await database.$transaction(async (tx) => {
            await tx.user.create({
              data: {
                id: customerId,
                kind: 'CUSTOMER',
                status: 'ACTIVE',
                fullName: 'Event fixture',
                preferredLocale: 'vi',
                emailCanonical: `step9-${customerId}@example.invalid`,
                emailDelivery: `step9-${customerId}@example.invalid`,
                emailVerifiedAt: now,
                normalizationVersion: 1,
                passwordHash: '$argon2id$fixture',
                phoneCanonical: `+849${phoneBase}${String(userIds.length).padStart(3, '0')}`,
                customerProfile: {
                  create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
                },
              },
            });
            const booking = await tx.booking.create({
              data: {
                branchId,
                code: `S9-${run}-${++sequence}`,
                ownerUserId: customerId,
                createdByUserId: customerId,
                channel: 'ONLINE',
                startsAt: at(120),
                endsAt: at(130),
                serviceDate: new Date(at(120).toISOString().slice(0, 10)),
                idempotencyKey: randomUUID(),
              },
            });
            const recipient = await tx.bookingRecipient.create({
              data: { bookingId: booking.id, relation: 'SELF' },
            });
            const line = await tx.bookingServiceLine.create({
              data: {
                bookingId: booking.id,
                recipientId: recipient.id,
                sequence: 1,
                serviceId,
                employeeUserId: original,
                assignmentMode: 'SPECIFIC',
                plannedStartAt: at(120),
                plannedEndAt: at(130),
                durationMinutes: 10,
                bufferMinutes: 0,
                serviceCode: `S9_${run}`,
                serviceNameVi: 'Service',
                serviceNameEn: 'Service',
                catalogPriceMinVnd: 1n,
                catalogPriceMaxVnd: 1n,
                catalogPricingUnit: 'PER_SERVICE',
              },
            });
            const leave = await tx.leaveRequest.create({
              data: {
                employeeUserId: original,
                startDate: booking.serviceDate,
                endDate: booking.serviceDate,
                leaveType: 'ANNUAL',
                reason: 'Fixture approved leave',
                requestedAt: at(-1),
                createdAt: at(-1),
              },
            });
            await tx.leaveRequest.update({
              where: { id: leave.id },
              data: {
                status: 'APPROVED',
                decidedByUserId: manager,
                decidedAt: now,
                rowVersion: { increment: 1 },
              },
            });
            await tx.bookingServiceLine.update({
              where: { id: line.id },
              data: { assignmentConflict: 'LEAVE', rowVersion: { increment: 1 } },
            });
            const conflict = await appendOutboxEvent(tx, {
              branchId,
              aggregateType: 'Booking',
              aggregateId: booking.id,
              eventType: 'BOOKING_KTV_CONFLICT',
              schemaVersion: 1,
              occurredAt: now,
              payload: {
                leaveRequestId: leave.id,
                lineKind: 'BOOKING',
                lineId: line.id,
                employeeUserId: original,
                assignmentMode: 'SPECIFIC',
                context: 'LEAVE',
              },
            });
            return { booking, line, leave, conflict };
          });
          await Promise.all([
            relayBookingEvent(database, fixture.conflict.id, schedule),
            relayBookingEvent(database, fixture.conflict.id, schedule),
          ]);
          const conflictNotices = await database.notification.findMany({
            where: { sourceEventId: fixture.conflict.id },
          });
          assert.equal(
            conflictNotices.filter((notice) => notice.recipientUserId === customerId).length,
            1,
          );
          assert.equal(
            conflictNotices.filter((notice) => notice.recipientUserId === manager).length,
            1,
          );
          assert.ok(conflictNotices.every((notice) => notice.type === 'BOOKING_KTV_CONFLICT'));
          assert.ok(
            conflictNotices.every(
              (notice) => ![original, replacement, unrelated].includes(notice.recipientUserId),
            ),
          );
          const reassigned = await database.$transaction(async (tx) => {
            await tx.bookingServiceLine.update({
              where: { id: fixture.line.id },
              data: {
                employeeUserId: replacement,
                assignmentConflict: null,
                rowVersion: { increment: 1 },
              },
            });
            await tx.serviceLineAssignmentChange.create({
              data: {
                bookingServiceLineId: fixture.line.id,
                fromEmployeeUserId: original,
                toEmployeeUserId: replacement,
                actorUserId: manager,
                reason: 'LEAVE',
                note: 'Explicit fixture reassignment',
                occurredAt: now,
              },
            });
            return appendOutboxEvent(tx, {
              branchId,
              aggregateType: 'Booking',
              aggregateId: fixture.booking.id,
              eventType: 'KTV_REASSIGNED',
              schemaVersion: 1,
              occurredAt: now,
              payload: {
                lineKind: 'BOOKING',
                lineId: fixture.line.id,
                bookingId: fixture.booking.id,
                visitId: null,
                fromEmployeeUserId: original,
                toEmployeeUserId: replacement,
                assignmentMode: 'SPECIFIC',
                requestedEmployeeId: original,
                context: 'LEAVE',
                leaveRequestId: fixture.leave.id,
                actorUserId: manager,
              },
            });
          });
          await Promise.all([
            relayBookingEvent(database, reassigned.id, schedule),
            relayBookingEvent(database, reassigned.id, schedule),
          ]);
          const reassignedNotices = await database.notification.findMany({
            where: { sourceEventId: reassigned.id },
          });
          for (const recipient of [manager, customerId, original, replacement]) {
            assert.equal(
              reassignedNotices.filter((notice) => notice.recipientUserId === recipient).length,
              1,
            );
          }
          assert.ok(
            reassignedNotices.every(
              (notice) => notice.type === 'KTV_REASSIGNED' && notice.recipientUserId !== unrelated,
            ),
          );
          const own = reassignedNotices.find((notice) => notice.recipientUserId === customerId)!;
          await database.notification.update({ where: { id: own.id }, data: { readAt: now } });
          await database.$transaction(async (tx) => {
            await takeSharedAuthGraphLock(tx);
            await consumeBookingNotification(tx, reassigned);
          });
          assert.equal(
            await database.notification.count({ where: { sourceEventId: reassigned.id } }),
            reassignedNotices.length,
          );
          assert.equal(
            (
              await database.notification.findUniqueOrThrow({ where: { id: own.id } })
            ).readAt!.getTime(),
            now.getTime(),
          );
        },
      );
    } finally {
      // This exact fixture only; replica mode permits deleting append-only test history.
      await database.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        await tx.notification.deleteMany({ where: { branchId } });
        await tx.serviceWarningSchedule.deleteMany({ where: { line: { visit: { branchId } } } });
        await tx.outboxEvent.deleteMany({ where: { branchId } });
        await tx.$executeRaw`DELETE FROM ktv_occupancies WHERE employee_user_id = ANY(${userIds}::uuid[])`;
        await tx.serviceExecution.deleteMany({
          where: { visitServiceLine: { visit: { branchId } } },
        });
        await tx.visitServiceLine.deleteMany({ where: { visit: { branchId } } });
        await tx.visitParticipant.deleteMany({ where: { visit: { branchId } } });
        await tx.visit.deleteMany({ where: { branchId } });
        await tx.serviceLineAssignmentChange.deleteMany({
          where: { bookingServiceLine: { booking: { branchId } } },
        });
        await tx.bookingServiceLine.deleteMany({ where: { booking: { branchId } } });
        await tx.bookingRecipient.deleteMany({ where: { booking: { branchId } } });
        await tx.booking.deleteMany({ where: { branchId } });
        await tx.leaveRequest.deleteMany({ where: { employeeUserId: { in: userIds } } });
        await tx.userPermissionOverride.deleteMany({ where: { userId: { in: userIds } } });
        await tx.userRoleAssignment.deleteMany({ where: { userId: { in: userIds } } });
        await tx.rolePermission.deleteMany({ where: { roleId } });
        await tx.role.deleteMany({ where: { id: roleId } });
        await tx.employeeBranchAssignment.deleteMany({
          where: { employeeUserId: { in: userIds } },
        });
        await tx.employmentClassificationChange.deleteMany({
          where: { employeeUserId: { in: userIds } },
        });
        await tx.employeeProfile.deleteMany({ where: { userId: { in: userIds } } });
        await tx.customerProfile.deleteMany({ where: { userId: { in: userIds } } });
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.service.deleteMany({ where: { id: serviceId } });
        await tx.serviceCategory.deleteMany({ where: { id: categoryId } });
        await tx.branch.deleteMany({ where: { id: branchId } });
      });
      await database.$disconnect();
    }
  },
);
