import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { CustomerBookingCreateRequest } from '@lucy-spa/contracts';
import { createDatabaseClient, type Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { loadTieBreakFacts } from './booking.core.js';
import { CustomerBookingService } from './customer-booking.service.js';

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
const local = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+07:00`);
const code = (error: unknown) => (error instanceof AuthError ? error.code : String(error));

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'Customer booking (Phase 3 Step 4); all fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (context) => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl, 'DATABASE_URL required for explicit integration tests.');
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
    const rollback = new Error('Intentional customer booking rollback');
    try {
      await assert.rejects(
        database.$transaction(
          async (tx: Prisma.TransactionClient) => {
            let savepoints = 0;
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
              resolveForMutation: (token: string) => sessions.resolveForMutation(token, tx),
            };
            const booking = new CustomerBookingService(
              runner,
              new AuthThrottleService(environment),
            );
            const failsWith = async (work: () => Promise<unknown>, expected: string) => {
              await assert.rejects(work, (error: unknown) => {
                assert.equal(code(error), expected);
                return true;
              });
            };

            // ---------------------------------------------------------------- fixtures
            let sequence = 0;
            const phoneBase = String(Math.floor(Math.random() * 100_000)).padStart(5, '0');
            const user = async (kind: 'CUSTOMER' | 'EMPLOYEE', employeeCode?: string) => {
              sequence += 1;
              const id = randomUUID();
              await tx.user.create({
                data: {
                  id,
                  kind,
                  status: 'ACTIVE',
                  fullName: `Booking fixture ${sequence}`,
                  preferredLocale: 'vi',
                  emailCanonical: `bk-${sequence}-${run.toLowerCase()}@example.invalid`,
                  emailDelivery: `bk-${sequence}-${run.toLowerCase()}@example.invalid`,
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
                            employeeCodeCanonical: employeeCode ?? `BKX_${run}_${sequence}`,
                            dateOfBirth: new Date('1990-01-01'),
                            address: 'Fixture',
                          },
                        },
                      }),
                },
              });
              return id;
            };
            const login = async (userId: string) => {
              const row = await tx.user.findUniqueOrThrow({
                where: { id: userId },
                select: { credentialVersion: true, authzVersion: true, passwordHash: true },
              });
              return (
                await sessions.rotateAuthenticated(
                  (await sessions.createAnonymous(tx)).token,
                  {
                    userId,
                    passwordHash: row.passwordHash!,
                    credentialVersion: row.credentialVersion,
                    authzVersion: row.authzVersion,
                  },
                  { reauthenticated: false },
                  tx,
                )
              ).token;
            };

            const branch = (
              await tx.branch.create({
                data: {
                  code: `IT-BK-${run}`,
                  name: 'Booking branch',
                  timezone: 'Asia/Ho_Chi_Minh',
                },
                select: { id: true },
              })
            ).id;
            for (let isoWeekday = 1; isoWeekday <= 7; isoWeekday += 1) {
              await tx.branchOperatingHours.create({
                data: { branchId: branch, isoWeekday, opensAtMinute: 540, closesAtMinute: 1260 },
              });
            }
            const skill = async (label: string) =>
              (
                await tx.skill.create({
                  data: { code: `BK_${label}_${run}`, nameVi: label, nameEn: label },
                  select: { id: true },
                })
              ).id;
            const massage = await skill('MASSAGE');
            const nails = await skill('NAILS');
            const category = (
              await tx.serviceCategory.create({
                data: { code: `BK_CAT_${run}`, nameVi: 'Nhóm', nameEn: 'Group' },
                select: { id: true },
              })
            ).id;
            const service = async (
              label: string,
              minutes: number,
              skillId: string,
              here = true,
            ) => {
              const id = (
                await tx.service.create({
                  data: {
                    code: `BK_${label}_${run}`,
                    categoryId: category,
                    nameVi: `Dịch vụ ${label}`,
                    nameEn: `Service ${label}`,
                    priceVnd: 150_000n,
                    priceMaxVnd: 200_000n,
                    durationMinutes: minutes,
                    estimatedMinMinutes: minutes,
                    estimatedMaxMinutes: minutes,
                  },
                  select: { id: true },
                })
              ).id;
              await tx.serviceSkill.create({ data: { serviceId: id, skillId } });
              if (here) {
                await tx.serviceBranchAvailability.create({
                  data: { serviceId: id, branchId: branch },
                });
              }
              return id;
            };
            const svcA = await service('A', 60, massage);
            const svcN = await service('N', 30, nails);
            const svcElsewhere = await service('X', 30, massage, false);

            const staff = await user('EMPLOYEE');
            const employee = async (label: string, skills: string[]) => {
              const id = await user('EMPLOYEE', `${label}_${run}`);
              await tx.employmentClassificationChange.create({
                data: {
                  employeeUserId: id,
                  classification: 'OFFICIAL_EMPLOYEE',
                  effectiveDate: new Date('2026-01-01'),
                  recordedByUserId: staff,
                },
              });
              await tx.employeeBranchAssignment.create({
                data: { employeeUserId: id, branchId: branch, grantedByUserId: staff },
              });
              for (const skillId of skills) {
                await tx.employeeSkill.create({
                  data: { employeeUserId: id, skillId, grantedByUserId: staff },
                });
              }
              return id;
            };
            // Codes order e1 < e2 < e3 (the second tie-break key).
            const e1 = await employee('BKA', [massage, nails]);
            const e2 = await employee('BKB', [massage]);
            const e3 = await employee('BKC', [nails]);
            const customerA = await user('CUSTOMER');
            const customerB = await user('CUSTOMER');
            const sessionA = await login(customerA);
            const sessionB = await login(customerB);
            const staffSession = await login(staff);

            const [clock] = await tx.$queryRaw<{ today: string }[]>`
              SELECT to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS today`;
            const today = clock!.today;
            const D = addDays(today, 3);
            const D2 = addDays(today, 4);

            const request = (
              date: string,
              startTime: string,
              lines: { serviceId: string; employeeUserId: string | null; recipientKey?: string }[],
              recipients: CustomerBookingCreateRequest['recipients'] = [
                { key: 'me', relation: 'SELF' },
              ],
            ): CustomerBookingCreateRequest => ({
              idempotencyKey: randomUUID(),
              branchId: branch,
              date,
              startTime,
              recipients,
              lines: lines.map((line) => ({
                serviceId: line.serviceId,
                employeeUserId: line.employeeUserId,
                recipientKey: line.recipientKey ?? 'me',
              })),
            });

            // ---------------------------------------------------------------- tests
            await context.test(
              'authentication and realm: no customer session, no access',
              async () => {
                const anonymous = (await sessions.createAnonymous(tx)).token;
                for (const token of [undefined, anonymous]) {
                  await failsWith(() => booking.list(token), 'AUTHENTICATION_REQUIRED');
                  await failsWith(
                    () =>
                      booking.create(
                        token,
                        request(D, '10:00', [{ serviceId: svcA, employeeUserId: null }]),
                      ),
                    'AUTHENTICATION_REQUIRED',
                  );
                  await failsWith(
                    () => booking.detail(token, randomUUID()),
                    'AUTHENTICATION_REQUIRED',
                  );
                  await failsWith(
                    () => booking.cancel(token, randomUUID(), {}),
                    'AUTHENTICATION_REQUIRED',
                  );
                }
                await failsWith(() => booking.list(staffSession), 'FORBIDDEN');
              },
            );

            await context.test(
              'catalog, bookable dates and qualified KTVs come from the server',
              async () => {
                const branches = await booking.branches(sessionA);
                assert.ok(branches.branches.some((entry) => entry.id === branch));
                const detail = await booking.branch(sessionA, branch);
                assert.deepEqual(
                  detail.services.map((entry) => entry.id).sort(),
                  [svcA, svcN].sort(),
                );
                assert.ok(!detail.services.some((entry) => entry.id === svcElsewhere));
                assert.equal(detail.firstDate, today);
                assert.equal(detail.lastDate, addDays(today, 60), 'booking.maxAdvanceDays');
                const ktvs = await booking.employees(sessionA, branch, `${svcA},${svcN}`);
                const ids = (index: number) =>
                  ktvs.services[index]!.employees.map((entry) => entry.id).sort();
                assert.deepEqual(ids(0), [e1, e2].sort());
                assert.deepEqual(ids(1), [e1, e3].sort());
                assert.deepEqual(Object.keys(ktvs.services[0]!.employees[0]!).sort(), [
                  'displayName',
                  'id',
                ]);
                const slots = await booking.availability(sessionA, {
                  branchId: branch,
                  date: D,
                  serviceIds: svcA,
                  employees: 'ANY',
                });
                assert.equal(slots.starts[0], '09:00');
                assert.ok(slots.starts.includes('20:00') && !slots.starts.includes('20:15'));
              },
            );

            let specificId = '';
            let specificKey = '';
            await context.test(
              'specific KTV: CONFIRMED with snapshots; replay is idempotent',
              async () => {
                const body = request(D, '10:00', [{ serviceId: svcA, employeeUserId: e2 }]);
                specificKey = body.idempotencyKey;
                // OP-1: give the service a non-default per-service limit for this scenario.
                await tx.service.update({
                  where: { id: svcA },
                  data: { pricingUnit: 'PER_NAIL', maxQuantity: 10, rowVersion: { increment: 1 } },
                });
                const created = await booking.create(sessionA, body);
                specificId = created.id;
                assert.equal(created.status, 'CONFIRMED');
                assert.match(created.code, /^BK-\d{6}-[A-Z0-9]{6}$/);
                assert.equal(created.startsAt, local(D, '10:00').toISOString());
                assert.equal(created.endsAt, local(D, '11:00').toISOString());
                assert.deepEqual(
                  created.lines.map((line) => [line.employee.id, line.assignmentMode]),
                  [[e2, 'SPECIFIC']],
                );
                assert.equal(created.lines[0]!.priceMinVnd, '150000');
                assert.equal(created.recipients[0]!.relation, 'SELF');
                const row = await tx.bookingServiceLine.findFirstOrThrow({
                  where: { bookingId: created.id },
                });
                assert.equal(row.durationMinutes, 60);
                assert.equal(row.bufferMinutes, 0);
                assert.equal(row.serviceCode, `BK_A_${run}`);
                // OP-1: the limit is snapshotted with the price range and never re-read.
                assert.equal(row.maxQuantitySnapshot, 10);
                assert.equal(row.catalogPricingUnit, 'PER_NAIL');
                // Phase 4 Step 6: the service category is snapshotted too, and a later category move never alters it.
                const categoryThen = (await tx.service.findUniqueOrThrow({ where: { id: svcA } }))
                  .categoryId;
                assert.equal(row.serviceCategoryId, categoryThen);
                const movedTo = await tx.serviceCategory.create({
                  data: {
                    code: `MV_${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
                    nameVi: 'Chuyển',
                    nameEn: 'Moved',
                  },
                });
                await tx.service.update({
                  where: { id: svcA },
                  data: { categoryId: movedTo.id, rowVersion: { increment: 1 } },
                });
                assert.equal(
                  (await tx.bookingServiceLine.findUniqueOrThrow({ where: { id: row.id } }))
                    .serviceCategoryId,
                  categoryThen,
                  'a later category move never alters the historical category',
                );
                await tx.service.update({
                  where: { id: svcA },
                  data: { categoryId: categoryThen, rowVersion: { increment: 1 } },
                });
                await tx.service.update({
                  where: { id: svcA },
                  data: { maxQuantity: 20, rowVersion: { increment: 1 } },
                });
                assert.equal(
                  (await tx.bookingServiceLine.findUniqueOrThrow({ where: { id: row.id } }))
                    .maxQuantitySnapshot,
                  10,
                  'a later catalog change never alters an existing booking line',
                );
                await tx.service.update({
                  where: { id: svcA },
                  data: {
                    pricingUnit: 'PER_SERVICE',
                    maxQuantity: 1,
                    rowVersion: { increment: 1 },
                  },
                });
                const events = await tx.outboxEvent.findMany({
                  where: { aggregateId: created.id },
                });
                assert.deepEqual(
                  events.map((event) => event.eventType),
                  ['BOOKING_CREATED'],
                );
                assert.equal(events[0]!.aggregateType, 'Booking');

                const again = await booking.create(sessionA, body);
                assert.equal(again.id, created.id, 'same key, same booking');
                assert.equal(await tx.booking.count({ where: { ownerUserId: customerA } }), 1);
                assert.equal(await tx.outboxEvent.count({ where: { aggregateId: created.id } }), 1);
              },
            );

            await context.test(
              'a specific KTV is never replaced; the customer own-overlap rule',
              async () => {
                const body = request(D, '10:30', [{ serviceId: svcA, employeeUserId: e2 }]);
                await failsWith(() => booking.create(sessionB, body), 'BOOKING_KTV_UNAVAILABLE');
                assert.equal(
                  await tx.booking.count({ where: { idempotencyKey: body.idempotencyKey } }),
                  0,
                  'a refused write leaves nothing behind',
                );
                const slots = await booking.availability(sessionB, {
                  branchId: branch,
                  date: D,
                  serviceIds: svcA,
                  employees: e2,
                });
                assert.ok(!slots.starts.includes('10:00') && !slots.starts.includes('10:45'));
                assert.ok(slots.starts.includes('11:00'));
                await failsWith(
                  () =>
                    booking.create(
                      sessionA,
                      request(D, '10:15', [{ serviceId: svcN, employeeUserId: null }]),
                    ),
                  'BOOKING_CUSTOMER_CONFLICT',
                );
                await failsWith(
                  () =>
                    booking.create(
                      sessionA,
                      request(D, '10:05', [{ serviceId: svcN, employeeUserId: null }]),
                    ),
                  'BOOKING_INVALID_TIME',
                );
                await failsWith(
                  () =>
                    booking.create(
                      sessionA,
                      request(addDays(today, 61), '10:00', [
                        { serviceId: svcN, employeeUserId: null },
                      ]),
                    ),
                  'BOOKING_OUTSIDE_HORIZON',
                );
                await failsWith(
                  () =>
                    booking.create(
                      sessionA,
                      request(D, '12:00', [{ serviceId: svcElsewhere, employeeUserId: null }]),
                    ),
                  'BOOKING_SERVICE_UNAVAILABLE',
                );
              },
            );

            await context.test(
              'Any KTV: one KTV for the whole sequence first, then the tie-break',
              async () => {
                // Only e1 has both skills: the whole sequence goes to e1.
                const whole = await booking.create(
                  sessionB,
                  request(D, '13:00', [
                    { serviceId: svcA, employeeUserId: null },
                    { serviceId: svcN, employeeUserId: null },
                  ]),
                );
                assert.deepEqual(
                  whole.lines.map((line) => [line.employee.id, line.assignmentMode, line.startsAt]),
                  [
                    [e1, 'ANY', local(D, '13:00').toISOString()],
                    [e1, 'ANY', local(D, '14:00').toISOString()],
                  ],
                );
                // e1 now has 90 booked minutes, e2 60: the fewest minutes wins (e2).
                const fewest = await booking.create(
                  sessionB,
                  request(D, '16:00', [{ serviceId: svcA, employeeUserId: null }]),
                );
                assert.equal(fewest.lines[0]!.employee.id, e2);
                // Another date, nobody booked: equal minutes, the earliest employee code (e1).
                const byCode = await booking.create(
                  sessionB,
                  request(D2, '09:00', [{ serviceId: svcA, employeeUserId: null }]),
                );
                assert.equal(byCode.lines[0]!.employee.id, e1);
              },
            );

            await context.test(
              'split only when no single KTV can; family recipient without an account',
              async () => {
                const users = await tx.user.count();
                // e1 is busy 13:00–14:30, so nobody has both skills: A → e2, N → e3.
                const split = await booking.create(
                  sessionA,
                  request(
                    D,
                    '13:00',
                    [
                      { serviceId: svcA, employeeUserId: null, recipientKey: 'me' },
                      { serviceId: svcN, employeeUserId: null, recipientKey: 'kid' },
                    ],
                    [
                      { key: 'me', relation: 'SELF' },
                      {
                        key: 'kid',
                        relation: 'CHILD',
                        displayName: '  Bé   Na ',
                        phone: '0905 123 456',
                      },
                    ],
                  ),
                );
                assert.deepEqual(
                  split.lines.map((line) => line.employee.id),
                  [e2, e3],
                );
                assert.equal(await tx.user.count(), users, 'no account for a recipient (O11)');
                // Recipients keep the request order: a strictly increasing createdAt, never a UUID tie-break.
                const stored = await tx.bookingRecipient.findMany({
                  where: { bookingId: split.id },
                  orderBy: { createdAt: 'asc' },
                  select: { relation: true, createdAt: true },
                });
                assert.deepEqual(
                  stored.map((row) => row.relation),
                  ['SELF', 'CHILD'],
                );
                assert.ok(stored[0]!.createdAt < stored[1]!.createdAt, 'strictly increasing');
                const kid = split.recipients.find((recipient) => recipient.relation === 'CHILD');
                assert.equal(kid?.displayName, 'Bé Na');
                assert.equal(split.lines[1]!.recipientKey, kid?.key);
                assert.equal(
                  split.lines[0]!.recipientKey,
                  split.recipients.find((r) => r.relation === 'SELF')?.key,
                );
                await failsWith(
                  () =>
                    booking.create(
                      sessionA,
                      request(
                        D,
                        '18:00',
                        [{ serviceId: svcA, employeeUserId: null }],
                        [
                          { key: 'me', relation: 'SELF' },
                          { key: 'x', relation: 'OTHER' },
                        ],
                      ),
                    ),
                  'VALIDATION_FAILED',
                );
              },
            );

            await context.test(
              'ownership: another customer’s booking does not exist for you',
              async () => {
                await failsWith(() => booking.detail(sessionB, specificId), 'NOT_FOUND');
                await failsWith(() => booking.cancel(sessionB, specificId, {}), 'NOT_FOUND');
                const listB = await booking.list(sessionB);
                assert.ok(
                  ![...listB.upcoming, ...listB.history].some((item) => item.id === specificId),
                );
                const listA = await booking.list(sessionA);
                assert.ok(listA.upcoming.some((item) => item.id === specificId));
              },
            );

            await context.test(
              'cancellation: releases the KTV, repeat is safe, late flag',
              async () => {
                const line = await tx.bookingServiceLine.findFirstOrThrow({
                  where: { bookingId: specificId },
                });
                const cancelled = await booking.cancel(sessionA, specificId, {
                  reason: 'Đổi lịch',
                });
                assert.equal(cancelled.status, 'CANCELLED');
                assert.equal(cancelled.cancelledLate, false);
                assert.equal(cancelled.canCancel, false);
                assert.equal(
                  await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM ktv_occupancies
                  WHERE booking_service_line_id = ${line.id}::uuid`.then((rows) =>
                    Number(rows[0]!.n),
                  ),
                  0,
                  'occupancy released',
                );
                const again = await booking.cancel(sessionA, specificId, {});
                assert.equal(again.status, 'CANCELLED');
                assert.equal(
                  await tx.outboxEvent.count({
                    where: { aggregateId: specificId, eventType: 'BOOKING_CANCELLED' },
                  }),
                  1,
                );
                // The same idempotency key still replays the (now cancelled) booking.
                const replay = await booking.create(sessionA, {
                  ...request(D, '10:00', [{ serviceId: svcA, employeeUserId: e2 }]),
                  idempotencyKey: specificKey,
                });
                assert.equal(replay.id, specificId);
                const slots = await booking.availability(sessionB, {
                  branchId: branch,
                  date: D,
                  serviceIds: svcA,
                  employees: e2,
                });
                assert.ok(slots.starts.includes('10:00'), 'the KTV is free again');

                // Late: less than booking.lateCancelAlertMinutes (15) before the start.
                const [soon] = await tx.$queryRaw<{ at: Date; day: string }[]>`
                SELECT date_trunc('minute', now()) + interval '6 minutes' AS at,
                       to_char((date_trunc('minute', now()) + interval '6 minutes') AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS day`;
                const lateBooking = await tx.booking.create({
                  data: {
                    code: `BK-LATE-${run}`,
                    branchId: branch,
                    ownerUserId: customerA,
                    channel: 'ONLINE',
                    startsAt: soon!.at,
                    endsAt: new Date(soon!.at.getTime() + 30 * 60_000),
                    serviceDate: new Date(soon!.day),
                    idempotencyKey: randomUUID(),
                    createdByUserId: customerA,
                  },
                  select: { id: true },
                });
                const late = await booking.cancel(sessionA, lateBooking.id, {});
                assert.equal(late.status, 'CANCELLED');
                assert.equal(late.cancelledLate, true);
                const event = await tx.outboxEvent.findFirstOrThrow({
                  where: { aggregateId: lateBooking.id, eventType: 'BOOKING_CANCELLED' },
                });
                assert.deepEqual((event.payload as { late: boolean }).late, true);
              },
            );

            await context.test(
              'after check-in: cancel before START, refused after START',
              async () => {
                const checkedIn = async (start: string) => {
                  const created = await tx.booking.create({
                    data: {
                      code: `BK-CI-${start.replace(':', '')}-${run}`,
                      branchId: branch,
                      ownerUserId: customerA,
                      channel: 'DESK',
                      startsAt: local(D2, start),
                      endsAt: new Date(local(D2, start).getTime() + 30 * 60_000),
                      serviceDate: new Date(D2),
                      idempotencyKey: randomUUID(),
                      createdByUserId: staff,
                    },
                    select: { id: true },
                  });
                  const recipient = await tx.bookingRecipient.create({
                    data: { bookingId: created.id, relation: 'SELF' },
                    select: { id: true },
                  });
                  const snapshot = {
                    serviceId: svcN,
                    employeeUserId: e3,
                    assignmentMode: 'SPECIFIC' as const,
                    plannedStartAt: local(D2, start),
                    plannedEndAt: new Date(local(D2, start).getTime() + 30 * 60_000),
                    durationMinutes: 30,
                    bufferMinutes: 0,
                    serviceCode: 'N',
                    serviceNameVi: 'N',
                    serviceNameEn: 'N',
                    catalogPriceMinVnd: 1n,
                    catalogPriceMaxVnd: 1n,
                    catalogPricingUnit: 'PER_SERVICE' as const,
                  };
                  const bookingLine = await tx.bookingServiceLine.create({
                    data: {
                      bookingId: created.id,
                      recipientId: recipient.id,
                      sequence: 1,
                      ...snapshot,
                    },
                    select: { id: true },
                  });
                  const visit = await tx.visit.create({
                    data: {
                      code: `VS-CI-${start.replace(':', '')}-${run}`,
                      branchId: branch,
                      origin: 'BOOKING',
                      bookingId: created.id,
                      ownerUserId: customerA,
                      serviceDate: new Date(D2),
                      arrivedAt: local(D2, '12:00'),
                      createdByUserId: staff,
                    },
                    select: { id: true },
                  });
                  const participant = await tx.visitParticipant.create({
                    data: {
                      visitId: visit.id,
                      kind: 'MEMBER',
                      customerUserId: customerA,
                      bookingRecipientId: recipient.id,
                    },
                    select: { id: true },
                  });
                  const visitLine = await tx.visitServiceLine.create({
                    data: {
                      visitId: visit.id,
                      participantId: participant.id,
                      sequence: 1,
                      bookingServiceLineId: bookingLine.id,
                      ...snapshot,
                    },
                    select: { id: true },
                  });
                  await tx.booking.update({
                    where: { id: created.id },
                    data: {
                      status: 'CHECKED_IN',
                      checkedInAt: local(D2, '12:00'),
                      checkedInByUserId: staff,
                      rowVersion: { increment: 1 },
                    },
                  });
                  return { bookingId: created.id, visitId: visit.id, visitLineId: visitLine.id };
                };

                const waiting = await checkedIn('15:00');
                const beforeStart = await booking.cancel(sessionA, waiting.bookingId, {});
                assert.equal(beforeStart.status, 'CANCELLED', 'derived from the cancelled visit');
                const visit = await tx.visit.findUniqueOrThrow({
                  where: { id: waiting.visitId },
                  select: { status: true, lines: { select: { status: true } } },
                });
                assert.equal(visit.status, 'CANCELLED');
                assert.deepEqual(
                  visit.lines.map((line) => line.status),
                  ['CANCELLED'],
                );
                assert.equal(
                  (await tx.booking.findUniqueOrThrow({ where: { id: waiting.bookingId } })).status,
                  'CHECKED_IN',
                );

                const running = await checkedIn('17:00');
                await tx.visitServiceLine.update({
                  where: { id: running.visitLineId },
                  data: { status: 'IN_PROGRESS', rowVersion: { increment: 1 } },
                });
                await tx.visit.update({
                  where: { id: running.visitId },
                  data: { status: 'IN_SERVICE', rowVersion: { increment: 1 } },
                });
                await failsWith(
                  () => booking.cancel(sessionA, running.bookingId, {}),
                  'BOOKING_CANCEL_NOT_ALLOWED',
                );
                const detail = await booking.detail(sessionA, running.bookingId);
                assert.equal(detail.status, 'IN_SERVICE');
                assert.equal(detail.canCancel, false);
              },
            );

            await context.test(
              'booked minutes: same branch and date, CONFIRMED/CHECKED_IN, no buffer',
              async () => {
                const D3 = addDays(today, 5);
                const elsewhere = (
                  await tx.branch.create({
                    data: {
                      code: `IT-BK2-${run}`,
                      name: 'Other branch',
                      timezone: 'Asia/Ho_Chi_Minh',
                    },
                    select: { id: true },
                  })
                ).id;
                let n = 0;
                // A booking with one line for the KTV, then moved to the given status.
                const held = async (
                  where: string,
                  date: string,
                  start: string,
                  minutes: number,
                  bufferMinutes: number,
                  status: 'CONFIRMED' | 'CANCELLED' | 'NO_SHOW' | 'CHECKED_IN',
                ) => {
                  const startsAt = local(date, start);
                  const endsAt = new Date(startsAt.getTime() + minutes * 60_000);
                  const row = await tx.booking.create({
                    data: {
                      code: `BK-BM${++n}-${run}`,
                      branchId: where,
                      ownerUserId: customerB,
                      channel: 'DESK',
                      startsAt,
                      endsAt,
                      serviceDate: new Date(date),
                      idempotencyKey: randomUUID(),
                      createdByUserId: staff,
                    },
                    select: { id: true },
                  });
                  const recipient = await tx.bookingRecipient.create({
                    data: { bookingId: row.id, relation: 'SELF' },
                    select: { id: true },
                  });
                  await tx.bookingServiceLine.create({
                    data: {
                      bookingId: row.id,
                      recipientId: recipient.id,
                      sequence: 1,
                      serviceId: svcA,
                      employeeUserId: e2,
                      assignmentMode: 'SPECIFIC',
                      plannedStartAt: startsAt,
                      plannedEndAt: endsAt,
                      durationMinutes: minutes,
                      bufferMinutes,
                      serviceCode: 'A',
                      serviceNameVi: 'A',
                      serviceNameEn: 'A',
                      catalogPriceMinVnd: 1n,
                      catalogPriceMaxVnd: 1n,
                      catalogPricingUnit: 'PER_SERVICE',
                    },
                  });
                  const facts = {
                    CONFIRMED: {},
                    CANCELLED: {
                      cancelledAt: new Date(),
                      cancelledByUserId: staff,
                      cancelledLate: false,
                    },
                    NO_SHOW: { noShowAt: new Date(), noShowByUserId: staff },
                    CHECKED_IN: { checkedInAt: new Date(), checkedInByUserId: staff },
                  }[status];
                  if (status !== 'CONFIRMED') {
                    await tx.booking.update({
                      where: { id: row.id },
                      data: { status, ...facts, rowVersion: { increment: 1 } },
                    });
                  }
                };
                await held(branch, D3, '09:00', 60, 15, 'CONFIRMED'); // counts 60 (buffer 15 never)
                await held(branch, D3, '10:30', 20, 0, 'CHECKED_IN'); // counts 20
                await held(branch, D3, '11:00', 30, 0, 'CANCELLED'); // no
                await held(branch, D3, '12:00', 45, 0, 'NO_SHOW'); // no
                await held(elsewhere, D3, '13:00', 90, 0, 'CONFIRMED'); // other branch: no
                await held(branch, addDays(D3, 1), '13:00', 40, 0, 'CONFIRMED'); // other date: no
                const facts = await loadTieBreakFacts(tx, {
                  branchId: branch,
                  date: new Date(D3),
                  employeeUserIds: [e1, e2],
                });
                assert.equal(facts.bookedMinutes.get(e2), 80);
                assert.equal(facts.bookedMinutes.get(e1) ?? 0, 0);
                // End to end on D3: e1 (0) has fewer booked minutes than e2 (80) for an Any line.
                const chosen = await booking.create(
                  sessionA,
                  request(D3, '15:00', [{ serviceId: svcA, employeeUserId: null }]),
                );
                assert.equal(chosen.lines[0]!.employee.id, e1);
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
