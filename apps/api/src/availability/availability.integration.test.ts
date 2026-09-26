import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, type Prisma } from '@lucy-spa/database';
import {
  evaluateSequence,
  feasibleStarts,
  lockAvailabilitySubjects,
  validateAssignment,
} from './availability.engine.js';
import type { AvailabilityContext, SequenceAtRequest } from './availability.types.js';

// Branch timezone Asia/Ho_Chi_Minh (UTC+7, no DST). Monday 2027-03-01 is the fixture "today".
const local = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+07:00`);
const minute = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const TODAY = '2027-03-01';
const NOW = local(TODAY, '08:00');

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'Availability & Qualification Engine (Phase 3 Step 3); all fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (context) => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl, 'DATABASE_URL required for explicit integration tests.');
    const database = createDatabaseClient(databaseUrl);
    const run = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
    const rollback = new Error('Intentional availability integration rollback');
    try {
      await assert.rejects(
        database.$transaction(
          async (tx: Prisma.TransactionClient) => {
            // ---------------------------------------------------------------- fixtures
            let sequence = 0;
            const phoneBase = String(Math.floor(Math.random() * 100_000)).padStart(5, '0');
            const user = async (
              kind: 'CUSTOMER' | 'EMPLOYEE',
              status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
            ) => {
              sequence += 1;
              const id = randomUUID();
              await tx.user.create({
                data: {
                  id,
                  kind,
                  status,
                  fullName: `Availability fixture ${sequence}`,
                  preferredLocale: 'vi',
                  emailCanonical: `av-${sequence}-${run.toLowerCase()}@example.invalid`,
                  emailDelivery: `av-${sequence}-${run.toLowerCase()}@example.invalid`,
                  emailVerifiedAt: new Date(),
                  phoneCanonical: `+849${phoneBase}${String(sequence).padStart(3, '0')}`,
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture-password-hash',
                  ...(kind === 'CUSTOMER'
                    ? {
                        customerProfile: {
                          create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
                        },
                      }
                    : {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `AV_${run}_${sequence}`,
                            dateOfBirth: new Date('1990-01-01'),
                            address: 'Fixture',
                          },
                        },
                      }),
                },
                select: { id: true },
              });
              return id;
            };

            const branch = (
              await tx.branch.create({
                data: {
                  code: `IT-AV-${run}`,
                  name: 'Availability branch',
                  timezone: 'Asia/Ho_Chi_Minh',
                },
                select: { id: true },
              })
            ).id;
            const otherBranch = (
              await tx.branch.create({
                data: { code: `IT-AV2-${run}`, name: 'Other branch', timezone: 'Asia/Ho_Chi_Minh' },
                select: { id: true },
              })
            ).id;
            // Mon–Sat 09:00–21:00, Sunday closed (branch data, not constants in the engine).
            for (let isoWeekday = 1; isoWeekday <= 7; isoWeekday += 1) {
              await tx.branchOperatingHours.create({
                data:
                  isoWeekday === 7
                    ? { branchId: branch, isoWeekday, isClosed: true }
                    : { branchId: branch, isoWeekday, opensAtMinute: 540, closesAtMinute: 1260 },
              });
            }

            const skill = async (code: string) =>
              (
                await tx.skill.create({
                  data: { code: `AV_${code}_${run}`, nameVi: code, nameEn: code },
                  select: { id: true },
                })
              ).id;
            const massage = await skill('MASSAGE');
            const nails = await skill('NAILS');
            const category = (
              await tx.serviceCategory.create({
                data: { code: `AV_CAT_${run}`, nameVi: 'Nhóm', nameEn: 'Group' },
                select: { id: true },
              })
            ).id;
            const service = async (
              code: string,
              durationMinutes: number,
              skillId: string,
              atBranch: boolean,
            ) => {
              const id = (
                await tx.service.create({
                  data: {
                    code: `AV_${code}_${run}`,
                    categoryId: category,
                    nameVi: code,
                    nameEn: code,
                    priceVnd: 100_000n,
                    priceMaxVnd: 100_000n,
                    durationMinutes,
                    estimatedMinMinutes: durationMinutes,
                    estimatedMaxMinutes: durationMinutes,
                  },
                  select: { id: true },
                })
              ).id;
              await tx.serviceSkill.create({ data: { serviceId: id, skillId } });
              if (atBranch)
                await tx.serviceBranchAvailability.create({
                  data: { serviceId: id, branchId: branch },
                });
              return id;
            };
            const svcA = await service('A', 60, massage, true);
            const svcB = await service('B', 30, nails, true);
            const svcElsewhere = await service('C', 30, massage, false);

            const granter = await user('EMPLOYEE');
            const employee = async (
              classification: 'OFFICIAL_EMPLOYEE' | 'COLLABORATOR' | 'TRAINEE',
              options: { skills: string[]; assigned?: boolean; status?: 'ACTIVE' | 'INACTIVE' },
            ) => {
              const id = await user('EMPLOYEE', options.status ?? 'ACTIVE');
              await tx.employmentClassificationChange.create({
                data: {
                  employeeUserId: id,
                  classification,
                  effectiveDate: new Date('2026-01-01'),
                  recordedByUserId: granter,
                },
              });
              await tx.employeeBranchAssignment.create({
                data: {
                  employeeUserId: id,
                  branchId: options.assigned === false ? otherBranch : branch,
                  grantedByUserId: granter,
                },
              });
              for (const skillId of options.skills) {
                await tx.employeeSkill.create({
                  data: { employeeUserId: id, skillId, grantedByUserId: granter },
                });
              }
              return id;
            };
            const official = await employee('OFFICIAL_EMPLOYEE', { skills: [massage, nails] });
            const massageOnly = await employee('OFFICIAL_EMPLOYEE', { skills: [massage] });
            const ctv = await employee('COLLABORATOR', { skills: [massage] });
            const trainee = await employee('TRAINEE', { skills: [massage, nails] });
            const inactive = await employee('OFFICIAL_EMPLOYEE', {
              skills: [massage],
              status: 'INACTIVE',
            });
            const unassigned = await employee('OFFICIAL_EMPLOYEE', {
              skills: [massage],
              assigned: false,
            });
            const leaver = await employee('OFFICIAL_EMPLOYEE', { skills: [massage, nails] });
            const customer = await user('CUSTOMER');

            // CTV: SCHEDULED 10:00–14:00 on the 1st; a CANCELLED full-window occurrence on the 3rd.
            const occurrence = (workDate: string, startMinute: number, endMinute: number) =>
              tx.collaboratorWorkOccurrence.create({
                data: {
                  employeeUserId: ctv,
                  branchId: branch,
                  workDate: new Date(workDate),
                  mode: 'SHIFT',
                  startMinute,
                  endMinute,
                  createdByUserId: granter,
                  updatedByUserId: granter,
                },
                select: { id: true },
              });
            await occurrence(TODAY, minute('10:00'), minute('14:00'));
            const cancelled = await occurrence('2027-03-03', minute('09:00'), minute('21:00'));
            await tx.collaboratorWorkOccurrence.update({
              where: { id: cancelled.id },
              data: {
                status: 'CANCELLED',
                cancelledByUserId: granter,
                cancelledAt: new Date(),
                cancelReason: 'Fixture',
                updatedByUserId: granter,
                rowVersion: { increment: 1 },
              },
            });

            // APPROVED whole-day leave on the 2nd; a PENDING request on the 1st never blocks.
            const leave = (date: string, status: 'APPROVED' | 'PENDING') =>
              tx.leaveRequest.create({
                data: {
                  employeeUserId: leaver,
                  startDate: new Date(date),
                  endDate: new Date(date),
                  leaveType: 'ANNUAL',
                  reason: 'Fixture',
                  status,
                  ...(status === 'APPROVED'
                    ? { decidedByUserId: granter, decidedAt: new Date(Date.now() + 1_000) }
                    : {}),
                },
              });
            await leave('2027-03-02', 'APPROVED');
            await leave(TODAY, 'PENDING');

            let codes = 0;
            const snapshot = {
              serviceCode: 'AV',
              serviceNameVi: 'AV',
              serviceNameEn: 'AV',
              catalogPriceMinVnd: 100_000n,
              catalogPriceMaxVnd: 100_000n,
              catalogPricingUnit: 'PER_SERVICE' as const,
            };
            /** A CONFIRMED booking with one line (the engine must see it as occupying). */
            const booked = async (
              date: string,
              start: string,
              minutes: number,
              employeeUserId: string,
              bufferMinutes: number,
            ) => {
              const startsAt = local(date, start);
              const endsAt = new Date(startsAt.getTime() + minutes * 60_000);
              const booking = await tx.booking.create({
                data: {
                  code: `AV-${run}-${++codes}`,
                  branchId: branch,
                  ownerUserId: customer,
                  channel: 'DESK',
                  startsAt,
                  endsAt,
                  serviceDate: new Date(date),
                  idempotencyKey: randomUUID(),
                  createdByUserId: granter,
                },
                select: { id: true },
              });
              const recipient = await tx.bookingRecipient.create({
                data: { bookingId: booking.id, relation: 'SELF' },
                select: { id: true },
              });
              const line = await tx.bookingServiceLine.create({
                data: {
                  bookingId: booking.id,
                  recipientId: recipient.id,
                  sequence: 1,
                  serviceId: svcA,
                  employeeUserId,
                  assignmentMode: 'SPECIFIC',
                  plannedStartAt: startsAt,
                  plannedEndAt: endsAt,
                  durationMinutes: minutes,
                  bufferMinutes,
                  ...snapshot,
                },
                select: { id: true },
              });
              return { bookingId: booking.id, lineId: line.id };
            };

            const setSetting = async (key: string, value: number) => {
              await tx.appSetting.update({
                where: { key },
                data: { value, rowVersion: { increment: 1 } },
              });
            };

            const ask = (
              serviceDate: string,
              start: string,
              overrides: Partial<SequenceAtRequest> & { context?: AvailabilityContext } = {},
            ) =>
              evaluateSequence(tx, {
                branchId: branch,
                serviceDate,
                startMinute: minute(start),
                serviceIds: [svcA],
                context: 'BOOKING',
                now: NOW,
                ...overrides,
              });
            const reasonsOf = (
              result: Awaited<ReturnType<typeof ask>>,
              employeeUserId: string,
              line = 0,
            ) =>
              result.lines[line]?.verdicts.find((entry) => entry.employeeUserId === employeeUserId)
                ?.reasons;

            // ---------------------------------------------------------------- tests
            await context.test('branch hours, closing boundary, service availability', async () => {
              const open = await ask(TODAY, '10:00');
              assert.deepEqual(open.reasons, []);
              assert.equal(open.feasible, true);
              assert.equal(open.lines[0]?.startsAt.toISOString(), '2027-03-01T03:00:00.000Z');
              assert.deepEqual((await ask('2027-03-07', '10:00')).reasons, ['BRANCH_CLOSED']);
              // A 60-minute service may end exactly at 21:00, not after.
              assert.deepEqual((await ask(TODAY, '20:00')).reasons, []);
              assert.deepEqual((await ask(TODAY, '20:15')).reasons, ['OUTSIDE_HOURS']);
              assert.deepEqual((await ask(TODAY, '08:45')).reasons, ['OUTSIDE_HOURS']);
              const elsewhere = await ask(TODAY, '10:00', { serviceIds: [svcElsewhere] });
              assert.deepEqual(elsewhere.reasons, ['SERVICE_UNAVAILABLE']);
              assert.deepEqual(elsewhere.unavailableServiceIndexes, [0]);
              assert.equal(elsewhere.lines[0]?.verdicts.length, 0, 'nobody is evaluated');
            });

            await context.test(
              'qualification, employment, trainee and branch assignment',
              async () => {
                const result = await ask(TODAY, '10:00');
                assert.deepEqual(result.lines[0]?.eligibleEmployeeUserIds, [
                  ...[official, massageOnly, ctv, leaver].sort(),
                ]);
                assert.deepEqual(reasonsOf(result, trainee), ['TRAINEE']);
                assert.deepEqual(reasonsOf(result, inactive), ['EMPLOYEE_INACTIVE']);
                assert.equal(
                  reasonsOf(result, unassigned),
                  undefined,
                  'the default pool is the branch',
                );
                const specific = await ask(TODAY, '10:00', { employeeUserIds: [unassigned] });
                assert.deepEqual(reasonsOf(specific, unassigned), ['NOT_ASSIGNED']);
                const nailsLine = await ask(TODAY, '10:00', { serviceIds: [svcB] });
                assert.deepEqual(reasonsOf(nailsLine, massageOnly), ['NOT_QUALIFIED']);
                assert.deepEqual(reasonsOf(nailsLine, official), []);
                // Verdicts are deterministic (sorted by user id); no ranking is applied.
                const ids = result.lines[0]?.verdicts.map((entry) => entry.employeeUserId) ?? [];
                assert.deepEqual(ids, [...ids].sort());
              },
            );

            await context.test(
              'collaborator needs a SCHEDULED occurrence covering the whole line',
              async () => {
                assert.deepEqual(reasonsOf(await ask(TODAY, '10:00'), ctv), []);
                assert.deepEqual(
                  reasonsOf(await ask(TODAY, '13:00'), ctv),
                  [],
                  'ends at 14:00 exactly',
                );
                assert.deepEqual(reasonsOf(await ask(TODAY, '13:30'), ctv), ['CTV_NOT_SCHEDULED']);
                assert.deepEqual(reasonsOf(await ask(TODAY, '09:30'), ctv), ['CTV_NOT_SCHEDULED']);
                assert.deepEqual(reasonsOf(await ask('2027-03-02', '10:00'), ctv), [
                  'CTV_NOT_SCHEDULED',
                ]);
                assert.deepEqual(reasonsOf(await ask('2027-03-03', '10:00'), ctv), [
                  'CTV_NOT_SCHEDULED',
                ]);
              },
            );

            await context.test(
              'approved whole-day leave blocks; pending leave does not',
              async () => {
                assert.deepEqual(reasonsOf(await ask('2027-03-02', '15:00'), leaver), ['ON_LEAVE']);
                assert.deepEqual(reasonsOf(await ask(TODAY, '15:00'), leaver), []);
              },
            );

            await context.test(
              'attendance (O6): future booking no, same-day operational yes',
              async () => {
                const future = await ask('2027-03-02', '10:00', { employeeUserIds: [official] });
                assert.deepEqual(reasonsOf(future, official), []);
                const operational = (now: Date) =>
                  ask(TODAY, '16:00', { context: 'OPERATIONAL', now, employeeUserIds: [official] });
                assert.deepEqual(reasonsOf(await operational(local(TODAY, '16:00')), official), [
                  'NOT_CHECKED_IN',
                ]);
                await tx.attendanceRecord.create({
                  data: {
                    employeeUserId: official,
                    branchId: branch,
                    businessDate: new Date(TODAY),
                    checkInAt: local(TODAY, '08:55'),
                  },
                });
                assert.deepEqual(reasonsOf(await operational(local(TODAY, '16:00')), official), []);
                const tomorrow = await ask('2027-03-02', '10:00', {
                  context: 'OPERATIONAL',
                  now: local(TODAY, '16:00'),
                });
                assert.deepEqual(tomorrow.reasons, ['NOT_SAME_DAY']);
                // Branch-local today, not UTC: 00:30 on the 1st local is still Feb 28 in UTC.
                const earlyNow = local(TODAY, '00:30');
                assert.equal(earlyNow.toISOString().slice(0, 10), '2027-02-28');
                const early = await ask(TODAY, '16:00', {
                  context: 'OPERATIONAL',
                  now: earlyNow,
                  employeeUserIds: [official],
                });
                assert.deepEqual(early.reasons, []);
              },
            );

            await context.test('conflicts and the O7 buffer ([start, end + buffer))', async () => {
              // official: 10:00–11:00 with a 10-minute buffer → occupied [10:00, 11:10).
              const first = await booked(TODAY, '10:00', 60, official, 10);
              const at = (start: string, context: AvailabilityContext = 'REVALIDATION') =>
                ask(TODAY, start, { context, employeeUserIds: [official] }).then((result) =>
                  reasonsOf(result, official),
                );
              assert.deepEqual(await at('10:30'), ['CONFLICT']);
              assert.deepEqual(await at('11:00'), ['CONFLICT']);
              assert.deepEqual(await at('11:05'), ['CONFLICT']);
              assert.deepEqual(await at('11:10'), [], 'free exactly at the buffer end');
              // Before: a request ending exactly at 10:00 with buffer 0 is adjacent, allowed.
              assert.deepEqual(await at('09:00'), []);

              // massageOnly: 13:00–14:00 with buffer 0; adjacent starts at 14:00 are allowed.
              await booked(TODAY, '13:00', 60, massageOnly, 0);
              const mo = (start: string) =>
                ask(TODAY, start, { context: 'REVALIDATION', employeeUserIds: [massageOnly] }).then(
                  (result) => reasonsOf(result, massageOnly),
                );
              assert.deepEqual(await mo('14:00'), []);
              assert.deepEqual(await mo('13:45'), ['CONFLICT']);
              assert.deepEqual(await mo('12:00'), [], '12:00–13:00 touches 13:00 with buffer 0');
              // The candidate's own buffer comes from the setting: with 10 minutes it occupies
              // [12:00, 13:10) and now overlaps the 13:00 line. No code change needed.
              await setSetting('booking.serviceBufferMinutes', 10);
              assert.deepEqual(await mo('12:00'), ['CONFLICT']);
              const withBuffer = await ask(TODAY, '15:00', { employeeUserIds: [massageOnly] });
              assert.equal(withBuffer.lines[0]?.bufferMinutes, 10);
              assert.equal(
                withBuffer.lines[0]?.occupiedUntil.toISOString(),
                local(TODAY, '16:10').toISOString(),
              );
              await setSetting('booking.serviceBufferMinutes', 0);

              // Re-check before write: the line being revalidated does not conflict with itself.
              const recheck = await validateAssignment(tx, {
                branchId: branch,
                serviceDate: TODAY,
                startMinute: minute('10:00'),
                serviceIds: [svcA],
                context: 'REVALIDATION',
                now: NOW,
                assignments: [official],
                exclude: { bookingServiceLineIds: [first.lineId] },
              });
              assert.equal(recheck.valid, true);
              const clash = await validateAssignment(tx, {
                branchId: branch,
                serviceDate: TODAY,
                startMinute: minute('10:00'),
                serviceIds: [svcA],
                context: 'REVALIDATION',
                now: NOW,
                assignments: [official],
              });
              assert.equal(clash.valid, false);
              assert.deepEqual(clash.lines[0]?.reasons, ['CONFLICT']);

              // The customer's own CONFIRMED bookings (contract section 5).
              const own = await ask(TODAY, '10:30', {
                context: 'REVALIDATION',
                customerUserId: customer,
              });
              assert.deepEqual(own.reasons, ['CUSTOMER_CONFLICT']);
              const ownExcluded = await ask(TODAY, '10:30', {
                context: 'REVALIDATION',
                customerUserId: customer,
                exclude: { bookingId: first.bookingId },
              });
              assert.deepEqual(ownExcluded.reasons, []);

              // A cancelled booking no longer occupies.
              await tx.booking.update({
                where: { id: first.bookingId },
                data: {
                  status: 'CANCELLED',
                  cancelledAt: new Date(),
                  cancelledByUserId: customer,
                  cancelledLate: false,
                  rowVersion: { increment: 1 },
                },
              });
              assert.deepEqual(await at('10:30'), []);
              await lockAvailabilitySubjects(tx, [official, massageOnly, customer]);
            });

            await context.test(
              'an unended execution blocks past its expected end until END',
              async () => {
                const visit = await tx.visit.create({
                  data: {
                    code: `AVV-${run}-1`,
                    branchId: branch,
                    origin: 'WALK_IN',
                    serviceDate: new Date(TODAY),
                    arrivedAt: local(TODAY, '14:55'),
                    createdByUserId: granter,
                  },
                  select: { id: true },
                });
                const guest = await tx.visitParticipant.create({
                  data: {
                    visitId: visit.id,
                    kind: 'GUEST',
                    displayName: 'Khách',
                    phone: '0905000333',
                  },
                  select: { id: true },
                });
                const line = await tx.visitServiceLine.create({
                  data: {
                    visitId: visit.id,
                    participantId: guest.id,
                    sequence: 1,
                    serviceId: svcB,
                    employeeUserId: official,
                    assignmentMode: 'ANY',
                    plannedStartAt: local(TODAY, '15:00'),
                    plannedEndAt: local(TODAY, '15:30'),
                    durationMinutes: 30,
                    bufferMinutes: 0,
                    ...snapshot,
                  },
                  select: { id: true },
                });
                await tx.visitServiceLine.update({
                  where: { id: line.id },
                  data: { status: 'IN_PROGRESS', rowVersion: { increment: 1 } },
                });
                const execution = await tx.serviceExecution.create({
                  data: {
                    visitServiceLineId: line.id,
                    employeeUserId: official,
                    startedAt: local(TODAY, '15:00'),
                    expectedEndAt: local(TODAY, '15:30'),
                  },
                  select: { id: true },
                });
                // 15:45: the planned range [15:00, 15:30) is over, but the service never ENDed.
                const late = local(TODAY, '15:45');
                const operational = (start: string, now: Date) =>
                  ask(TODAY, start, {
                    context: 'OPERATIONAL',
                    now,
                    serviceIds: [svcB],
                    employeeUserIds: [official],
                  }).then((result) => reasonsOf(result, official));
                assert.deepEqual(await operational('15:45', late), ['SERVICE_RUNNING']);
                // Booking context too: still running at "now".
                const booking = await ask(TODAY, '15:45', {
                  now: local(TODAY, '15:40'),
                  serviceIds: [svcB],
                  employeeUserIds: [official],
                });
                assert.deepEqual(reasonsOf(booking, official), ['SERVICE_RUNNING']);
                // Unended means unknown end: later starts stay blocked until END is recorded.
                const later = await ask(TODAY, '18:00', {
                  now: local(TODAY, '15:40'),
                  serviceIds: [svcB],
                  employeeUserIds: [official],
                });
                assert.deepEqual(reasonsOf(later, official), ['SERVICE_RUNNING']);
                // Time that ended before the execution started is unaffected.
                const before = await ask(TODAY, '13:00', {
                  context: 'REVALIDATION',
                  serviceIds: [svcB],
                  employeeUserIds: [official],
                });
                assert.deepEqual(reasonsOf(before, official), []);
                await tx.serviceExecution.update({
                  where: { id: execution.id },
                  data: {
                    status: 'ENDED',
                    endedAt: local(TODAY, '15:50'),
                    endKind: 'NORMAL',
                    endedByUserId: official,
                    rowVersion: { increment: 1 },
                  },
                });
                await tx.visitServiceLine.update({
                  where: { id: line.id },
                  data: { status: 'DONE', rowVersion: { increment: 1 } },
                });
                const after = local(TODAY, '15:52');
                assert.deepEqual(await operational('15:52', after), []);
                // The actual run [15:00, 15:50) still occupies its past time.
                assert.deepEqual(await operational('15:40', after), ['CONFLICT']);
              },
            );

            await context.test('horizon and slot grid follow the settings', async () => {
              assert.deepEqual((await ask('2027-04-30', '10:00')).reasons, [], 'today + 60');
              assert.deepEqual((await ask('2027-05-01', '10:00')).reasons, ['HORIZON']);
              assert.deepEqual((await ask('2027-02-27', '10:00')).reasons, ['HORIZON']);
              assert.deepEqual(
                (await ask(TODAY, '10:00', { now: local(TODAY, '10:05') })).reasons,
                ['HORIZON'],
                'a start in the past',
              );
              await setSetting('booking.maxAdvanceDays', 10);
              assert.deepEqual((await ask('2027-03-11', '10:00')).reasons, []);
              assert.deepEqual((await ask('2027-03-12', '10:00')).reasons, ['HORIZON']);
              // Branch-local "today": at 00:30 local on the 1st (UTC Feb 28), the 11th is day 10.
              assert.deepEqual(
                (await ask('2027-03-11', '10:00', { now: local(TODAY, '00:30') })).reasons,
                [],
              );

              assert.deepEqual((await ask(TODAY, '10:15')).reasons, []);
              assert.deepEqual((await ask(TODAY, '10:05')).reasons, ['INVALID_SLOT']);
              await setSetting('booking.slotIntervalMinutes', 30);
              assert.deepEqual((await ask(TODAY, '10:15')).reasons, ['INVALID_SLOT']);
              assert.deepEqual((await ask(TODAY, '10:30')).reasons, []);
              // Internal revalidation of an established sequence is not held to the grid.
              assert.deepEqual(
                (await ask(TODAY, '10:05', { context: 'REVALIDATION' })).reasons,
                [],
              );
              await setSetting('booking.slotIntervalMinutes', 15);
              await setSetting('booking.maxAdvanceDays', 60);
            });

            await context.test(
              'multi-service sequence: whole-sequence and per-line candidates',
              async () => {
                const date = '2027-03-03';
                const plan = await ask(date, '10:00', { serviceIds: [svcA, svcB] });
                assert.equal(plan.lines[1]?.startMinute, minute('11:00'), 'buffer 0: back to back');
                assert.deepEqual(plan.wholeSequenceEmployeeUserIds, [official, leaver].sort());
                assert.ok(plan.lines[0]?.eligibleEmployeeUserIds.includes(massageOnly));
                assert.ok(
                  !plan.wholeSequenceEmployeeUserIds.includes(massageOnly),
                  'missing a skill',
                );
                // A conflict during the second segment only removes leaver from the whole sequence.
                await booked(date, '11:00', 30, leaver, 0);
                const again = await ask(date, '10:00', { serviceIds: [svcA, svcB] });
                assert.deepEqual(again.wholeSequenceEmployeeUserIds, [official]);
                assert.ok(again.lines[0]?.eligibleEmployeeUserIds.includes(leaver));
                assert.deepEqual(reasonsOf(again, leaver, 1), ['CONFLICT']);
                assert.equal(again.everyLineCovered, true);
                // With a buffer, line 2 starts after line 1's buffer (contract section 6).
                await setSetting('booking.serviceBufferMinutes', 5);
                const buffered = await ask(date, '10:00', { serviceIds: [svcA, svcB] });
                assert.equal(buffered.lines[1]?.startMinute, minute('11:05'));
                await setSetting('booking.serviceBufferMinutes', 0);

                const starts = await feasibleStarts(tx, {
                  branchId: branch,
                  serviceDate: date,
                  serviceIds: [svcA, svcB],
                  context: 'BOOKING',
                  now: NOW,
                  employeeUserIds: [leaver],
                });
                const listed = starts.map((entry) => entry.startMinute);
                assert.ok(!listed.includes(minute('10:00')), 'leaver is busy at 11:00');
                assert.ok(listed.includes(minute('11:30')));
                assert.ok(
                  listed.every((value) => (value - 540) % 15 === 0),
                  'on the slot grid',
                );
                assert.equal(listed.at(-1), minute('19:30'), 'the last start still ends by 21:00');
              },
            );

            await context.test(
              'CTV coverage is over each line service interval, not its buffer',
              async () => {
                // Contract section 5.6: collaboratorWorkCovering(E, B, D, t0, t1) over the line
                // interval [t0, t1); the O7 buffer is occupancy (section 5.10), not service time.
                const date = '2027-03-04';
                await occurrence(date, minute('09:00'), minute('11:00'));
                await setSetting('booking.serviceBufferMinutes', 10);
                const single = await ask(date, '10:00', { employeeUserIds: [ctv] });
                assert.equal(
                  single.lines[0]?.occupiedUntil.toISOString(),
                  local(date, '11:10').toISOString(),
                );
                assert.deepEqual(
                  reasonsOf(single, ctv),
                  [],
                  'service 10:00–11:00 inside 09:00–11:00',
                );
                // Sequence 09:00–10:00, then 10:10–11:10: the second service ends after the shift.
                const pair = await ask(date, '09:00', {
                  serviceIds: [svcA, svcA],
                  employeeUserIds: [ctv],
                });
                assert.deepEqual(reasonsOf(pair, ctv, 0), []);
                assert.deepEqual(reasonsOf(pair, ctv, 1), ['CTV_NOT_SCHEDULED']);
                assert.deepEqual(pair.wholeSequenceEmployeeUserIds, []);
                await setSetting('booking.serviceBufferMinutes', 0);
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
