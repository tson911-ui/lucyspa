import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { appendLedgerEntry, readRows } from '@lucy-spa/server';
import { onlineOrderKit } from '../testing/online-order-kit.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { seedTip } from '../testing/tip-fixture.js';
import { addDays } from './report.dates.js';
import { ReportExportService } from './export.service.js';
import { ReportsService } from './reports.service.js';

/**
 * Phase 8 P8-8 against real PostgreSQL (design PHASE8_REPORTS.md 4.3-4.4, Owner OQ-P8-3 and OQ-P8-4): customers (lượt đến, people, new and
 * returning), the booking funnel, loyalty, top customers and the staff report. Sales, tips and points come from the real services; the
 * visits, bookings, attendance, leave and earnings are inserted as the system writes them (triggers lifted for that statement only).
 * Every figure is hand-computed. Fixtures roll back.
 */
test(
  'Phase 8 P8-8 people reports: customers, bookings, loyalty, top customers, staff; scope, columns by permission, exports; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await onlineOrderKit(base);
      const { tx, fails } = base;
      const { A, B, people } = k;
      const reports = new ReportsService(base.adapter, base.throttle);
      const exports = new ReportExportService(base.adapter, base.throttle, base.environment);
      const owner = people.owner.id;
      const today = await k.day();
      const earlier = addDays(today, -10);
      // Loyalty is live before anything is sold, so the invoices below earn points.
      if ((await tx.loyaltyGoLive.count()) === 0) {
        await tx.loyaltyGoLive.create({ data: { activatedByUserId: owner } });
      }
      const query = { from: today, to: today, branchId: A.id };
      const exporter = await base.staff(
        ['VIEW_BOOKINGS', 'VIEW_LOYALTY', 'VIEW_REVENUE', 'VIEW_STAFF_REPORTS', 'EXPORT_REPORTS'],
        { branchId: A.id },
      );
      const bookingsOnly = await base.staff(['VIEW_BOOKINGS'], { branchId: A.id });
      const staffOnly = await base.staff(['VIEW_STAFF_REPORTS'], { branchId: A.id });
      const staffSales = await base.staff(['VIEW_STAFF_REPORTS', 'VIEW_REVENUE'], {
        branchId: A.id,
      });
      const staffPay = await base.staff(['VIEW_STAFF_REPORTS', 'VIEW_EMPLOYEE_PAY'], {
        branchId: A.id,
      });
      const elsewhere = await base.staff(
        ['VIEW_BOOKINGS', 'VIEW_LOYALTY', 'VIEW_STAFF_REPORTS', 'VIEW_REVENUE'],
        { branchId: B.id },
      );
      const replica = async (sql: string) => {
        await tx.$executeRawUnsafe('SAVEPOINT fixture_row');
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        try {
          await tx.$executeRawUnsafe(sql);
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT fixture_row');
        } catch (error) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT fixture_row');
          const detail =
            error instanceof Error ? error.message.replace(/\s+/g, ' ') : String(error);
          throw new Error(
            `fixture row failed: ${sql.slice(0, 160).replace(/\s+/g, ' ')} -> ${detail.slice(-300)}`,
            { cause: error },
          );
        } finally {
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
        }
      };
      let n = 0;
      const stamp = (day: string, hour = 10) =>
        `'${day}T${String(hour).padStart(2, '0')}:00:00+07:00'`;

      // ----------------------------------------------------------------------------------------------- customers and visits
      const c1 = await k.customer('mot');
      const c2 = await k.customer('hai');
      const guestPhone = '+84901111111';
      const visit = async (
        day: string,
        origin: 'BOOKING' | 'WALK_IN',
        participants: { member?: string; guest?: { name: string; phone?: string } }[],
        bookingId?: string,
      ) => {
        n += 1;
        const id = randomUUID();
        await replica(
          `INSERT INTO visits (id, code, branch_id, origin, booking_id, status, service_date, arrived_at, completed_at, created_by_user_id)
           VALUES ('${id}', 'VS-P88-${base.run}-${n}', '${A.id}', '${origin}', ${bookingId ? `'${bookingId}'` : 'NULL'}, 'COMPLETED', '${day}', ${stamp(day, 9)}, ${stamp(day, 11)}, '${owner}')`,
        );
        for (const person of participants) {
          if (person.member) {
            await replica(
              `INSERT INTO visit_participants (id, visit_id, kind, customer_user_id) VALUES ('${randomUUID()}', '${id}', 'MEMBER', '${person.member}')`,
            );
          } else {
            const phone = person.guest?.phone;
            await replica(
              `INSERT INTO visit_participants (id, visit_id, kind, display_name, phone)
               VALUES ('${randomUUID()}', '${id}', 'GUEST', '${person.guest?.name ?? 'Khách lẻ'}', ${phone ? `'${phone}'` : 'NULL'})`,
            );
          }
        }
        return id;
      };
      const booking = async (
        status: 'CONFIRMED' | 'CHECKED_IN' | 'CANCELLED' | 'NO_SHOW',
        channel: 'ONLINE' | 'DESK',
        late = false,
      ) => {
        n += 1;
        const id = randomUUID();
        const facts =
          status === 'CHECKED_IN'
            ? `, checked_in_at, checked_in_by_user_id) VALUES ('${id}', 'BK${base.run}${n}', '${A.id}', '${owner}', '${status}', '${channel}', ${stamp(today, 9)}, ${stamp(today, 10)}, '${today}', '${randomUUID()}', '${owner}', ${stamp(today, 9)}, '${owner}')`
            : status === 'CANCELLED'
              ? `, cancelled_at, cancelled_by_user_id, cancel_reason, cancelled_late) VALUES ('${id}', 'BK${base.run}${n}', '${A.id}', '${owner}', '${status}', '${channel}', ${stamp(today, 9)}, ${stamp(today, 10)}, '${today}', '${randomUUID()}', '${owner}', ${stamp(today, 8)}, '${owner}', 'Khách bận', ${late})`
              : status === 'NO_SHOW'
                ? `, no_show_at, no_show_by_user_id, no_show_reason) VALUES ('${id}', 'BK${base.run}${n}', '${A.id}', '${owner}', '${status}', '${channel}', ${stamp(today, 9)}, ${stamp(today, 10)}, '${today}', '${randomUUID()}', '${owner}', ${stamp(today, 10)}, '${owner}', 'Không đến')`
                : `) VALUES ('${id}', 'BK${base.run}${n}', '${A.id}', '${owner}', '${status}', '${channel}', ${stamp(today, 9)}, ${stamp(today, 10)}, '${today}', '${randomUUID()}', '${owner}')`;
        await replica(
          `INSERT INTO bookings (id, code, branch_id, owner_user_id, status, channel, starts_at, ends_at, service_date, idempotency_key, created_by_user_id${facts}`,
        );
        return id;
      };
      const b1 = await booking('CHECKED_IN', 'DESK');
      await booking('CHECKED_IN', 'ONLINE');
      await booking('CANCELLED', 'ONLINE', true);
      await booking('CANCELLED', 'DESK', false);
      await booking('NO_SHOW', 'DESK');
      await booking('CONFIRMED', 'ONLINE');
      // History: C2 and the guest came ten days ago (so they are returning today); C1 is new today.
      await visit(earlier, 'WALK_IN', [
        { member: c2.id },
        { guest: { name: 'Khách lẻ', phone: guestPhone } },
      ]);
      await visit(today, 'BOOKING', [{ member: c1.id }, { member: c2.id }], b1); // one lượt đến, two people
      await visit(today, 'WALK_IN', [{ guest: { name: 'Chị Hoa', phone: guestPhone } }]);
      await visit(today, 'WALK_IN', [{ guest: { name: 'Chị Hoa', phone: guestPhone } }]); // the same guest again: one person
      await visit(today, 'WALK_IN', [{ guest: { name: 'Khách lẻ' } }]); // no account, no phone: unidentified

      // -------------------------------------------------------------------------------------------------- sales, tips, points
      const product = await k.product('ppl', [150_000]);
      const variant = product.variants[0]!;
      await k.receive(variant.id, 30);
      const sell = async (payer: string | null, quantity: number, seller?: string) => {
        const invoice = await k.finalize(
          await k.addLine(await k.openSale(people.cashier, payer), variant.id, quantity, seller),
        );
        await k.pay(invoice.id, Number(invoice.totalVnd));
        await k.runInventory(invoice.id);
        return invoice;
      };
      const first = await sell(c1.id, 1); // C1 150,000
      await sell(c1.id, 1); // C1 150,000 (two invoices: 300,000)
      await sell(c2.id, 3); // C2 450,000, one invoice
      const ktv = people.ktv.id;
      const sold = await sell(null, 2, ktv); // the KTV sells 2 x 150,000 = 300,000
      const service = await k.finalize(await k.serviceDraft([k.exact, k.ranged]));
      await k.pay(service.id, Number(service.totalVnd)); // 200,000 + 100,000 performed by the KTV
      await seedTip(tx, {
        invoiceId: service.id,
        employeeUserId: ktv,
        amountVnd: 20_000n,
        recordedByUserId: owner,
      });
      const line = await tx.invoiceLine.findFirstOrThrow({
        where: { invoiceId: sold.id },
        select: { id: true },
      });
      for (const [kind, amount] of [
        ['TOUR', 30_000],
        ['PRODUCT_COMMISSION', 5_000],
      ] as const) {
        await replica(
          `INSERT INTO pay_earnings (kind, employee_user_id, branch_id, invoice_id, invoice_line_id, paid_seq, business_date, amount_vnd, source_key)
           VALUES ('${kind}', '${ktv}', '${A.id}', '${sold.id}', '${line.id}', 1, '${today}', ${amount}, 'p88-${base.run}-${kind}')`,
        );
      }
      await replica(
        `INSERT INTO attendance_records (employee_user_id, branch_id, business_date, check_in_at, check_out_at)
         VALUES ('${ktv}', '${A.id}', '${today}', ${stamp(today, 8)}, ${stamp(today, 16)})`,
      );
      await replica(
        `INSERT INTO leave_requests (employee_user_id, start_date, end_date, leave_type, reason, status, decided_by_user_id, decided_at)
         VALUES ('${ktv}', '${today}', '${addDays(today, 2)}', 'ANNUAL', 'Nghỉ phép', 'APPROVED', '${owner}', now())`,
      );
      const referralCodeId = randomUUID();
      await replica(
        `INSERT INTO employee_referral_codes (id, employee_user_id, code, created_by_user_id) VALUES ('${referralCodeId}', '${ktv}', 'KTV234', '${owner}')`,
      );
      await replica(
        `INSERT INTO order_referrals (invoice_id, employee_user_id, code_id, code) VALUES ('${first.id}', '${ktv}', '${referralCodeId}', 'KTV234')`,
      );
      // The service visit of the KTV was completed on a day in the future (the kit's date); the executions end that day.
      const kitDay = '2027-03-01';

      // Points: a manual adjustment (no branch), an EARN on an invoice, a referral between the two customers.
      await appendLedgerEntry(tx, {
        userId: c1.id,
        wallet: 'SPA',
        kind: 'MANUAL_ADJUSTMENT',
        points: 1200,
        idempotencyKey: randomUUID(),
        reason: 'P8-8 fixture',
        actorUserId: owner,
      });
      await appendLedgerEntry(tx, {
        userId: c2.id,
        wallet: 'BEAUTY',
        kind: 'MANUAL_ADJUSTMENT',
        points: 600,
        idempotencyKey: randomUUID(),
        reason: 'P8-8 fixture',
        actorUserId: owner,
      });
      await appendLedgerEntry(tx, {
        userId: c1.id,
        wallet: 'SPA',
        kind: 'EARN',
        points: 200,
        idempotencyKey: randomUUID(),
        invoiceId: first.id,
        paidSeq: 1,
      });
      await replica(
        `INSERT INTO referrals (referred_user_id, referrer_user_id, bound_via) VALUES ('${c2.id}', '${c1.id}', 'SIGNUP')`,
      );

      await suite.test(
        'C1 customers: lượt đến, people, new and returning, unidentified; a group is one visit',
        async () => {
          const r = await reports.customerVisits(exporter.token, query);
          assert.equal(r.totals.visits, 4);
          assert.equal(r.totals.bookedVisits, 1);
          assert.equal(r.totals.walkInVisits, 3);
          assert.equal(r.totals.people, 3); // C1, C2 and the guest (two visits, one person)
          assert.equal(r.totals.newPeople, 1); // C1
          assert.equal(r.totals.returningPeople, 2); // C2 and the guest came before
          assert.equal(r.totals.unidentified, 1);
          assert.equal(r.series.length, 1);
          assert.deepEqual(
            [
              r.series[0]!.visits,
              r.series[0]!.people,
              r.series[0]!.newPeople,
              r.series[0]!.returningPeople,
            ],
            [4, 3, 1, 2],
          );
          assert.equal(r.byBranch[0]!.visits, 4);
          // A period that includes the earlier day counts the history as in-period: nobody is returning for a first visit inside it.
          const wide = await reports.customerVisits(exporter.token, { ...query, from: earlier });
          assert.equal(wide.totals.visits, 5);
          assert.equal(wide.totals.newPeople, 3);
          assert.equal(wide.totals.returningPeople, 0);
          const weekly = await reports.customerVisits(exporter.token, {
            ...query,
            from: earlier,
            bucket: 'week',
          });
          assert.equal(
            weekly.series.reduce((a, p) => a + p.visits, 0),
            5,
          );
        },
      );

      await suite.test(
        'C2 booking funnel: counts by state and channel, rates over the bookings that were not cancelled',
        async () => {
          const r = await reports.bookingFunnel(exporter.token, query);
          assert.deepEqual(r.totals, {
            bookings: 6,
            checkedIn: 2,
            cancelled: 2,
            lateCancelled: 1,
            noShow: 1,
            open: 1,
          });
          assert.equal(r.cameBp, 5000); // 2 of the 4 that were not cancelled
          assert.equal(r.noShowBp, 2500);
          const online = r.byChannel.find((c) => c.channel === 'ONLINE')!;
          const desk = r.byChannel.find((c) => c.channel === 'DESK')!;
          assert.deepEqual(
            [online.bookings, online.checkedIn, online.cancelled, online.noShow],
            [3, 1, 1, 0],
          );
          assert.deepEqual(
            [desk.bookings, desk.checkedIn, desk.cancelled, desk.noShow],
            [3, 1, 1, 1],
          );
          assert.equal(r.series[0]!.bookings, 6);
        },
      );

      await suite.test(
        'C3 loyalty: points by kind, tiers by balance, outstanding, referral; branchless points only for a person who reads every branch',
        async () => {
          const all = await reports.loyalty(people.owner.token, { from: today, to: today });
          const row = (wallet: string, kind: string) =>
            all.points.find((p) => p.wallet === wallet && p.kind === kind);
          assert.equal(row('SPA', 'MANUAL_ADJUSTMENT')?.points, 1200);
          assert.equal(row('SPA', 'EARN')?.points, 200);
          assert.equal(row('BEAUTY', 'MANUAL_ADJUSTMENT')?.points, 600);
          assert.equal(all.includesBranchless, true);
          const tier = (name: string) => all.tiers.find((t) => t.tier === name)!;
          assert.equal(tier('GOLD').spa, 1); // C1 has 1,400 points
          assert.equal(tier('SILVER').beauty, 1); // C2 has 600
          assert.ok(all.outstanding.spa >= 1400);
          assert.equal(all.referrals.bound, 1);
          assert.equal(all.referrals.rewarded, 0);
          const mine = await reports.loyalty(exporter.token, query);
          assert.equal(mine.includesBranchless, false);
          assert.equal(
            mine.points.find((p) => p.kind === 'MANUAL_ADJUSTMENT'),
            undefined,
          );
          assert.equal(mine.points.find((p) => p.kind === 'EARN')?.points, 200);
          assert.equal(mine.referrals.bound, 0);
        },
      );

      await suite.test(
        'C4 top customers: who paid most, with the full phone and their visits',
        async () => {
          const r = await reports.topCustomers(exporter.token, query);
          assert.deepEqual(
            r.rows.map((x) => x.userId),
            [c2.id, c1.id],
          );
          assert.equal(r.rows[0]!.collectedVnd, '450000');
          assert.equal(r.rows[0]!.invoices, 1);
          assert.equal(r.rows[1]!.collectedVnd, '300000');
          assert.equal(r.rows[1]!.invoices, 2);
          assert.equal(r.rows[1]!.visits, 1);
          assert.match(r.rows[0]!.phone ?? '', /^\+84\d{9}$/);
          const noLoyalty = await base.staff(['VIEW_REVENUE'], { branchId: A.id });
          await fails(() => reports.topCustomers(noLoyalty.token, query), 'FORBIDDEN');
        },
      );

      await suite.test(
        'S1 staff: services, time, sales, referral orders, tips, tour, commission, attendance, leave; facts only',
        async () => {
          const range = { from: today, to: kitDay, branchId: A.id };
          const r = await reports.staffActivity(exporter.token, range);
          assert.deepEqual(r.columns, { sales: true, pay: false });
          const row = r.rows.find((x) => x.userId === ktv)!;
          assert.equal(row.servicesPerformed, 2);
          assert.equal(row.customersServed, 1);
          assert.equal(row.plannedMinutes, 20);
          assert.equal(row.actualMinutes, 20);
          assert.equal(row.serviceSalesVnd, '300000');
          assert.equal(row.productSalesVnd, '300000');
          assert.equal(row.referralOrders, 1);
          assert.equal(row.referralInvoiceVnd, '150000');
          assert.equal(row.tipsVnd, null, 'no VIEW_EMPLOYEE_PAY: the pay columns are left out');
          assert.equal(row.tourVnd, null);
          assert.equal(row.commissionVnd, null);
          assert.equal(row.attendanceDays, 1);
          assert.equal(row.attendanceMinutes, 480);
          assert.equal(row.leaveDays, 3);
          // With the pay permission at the branch the pay columns appear; without VIEW_REVENUE the sales columns are left out.
          const owned = await reports.staffActivity(people.owner.token, range);
          const full = owned.rows.find((x) => x.userId === ktv)!;
          assert.deepEqual(owned.columns, { sales: true, pay: true });
          assert.equal(full.tipsVnd, '20000');
          assert.equal(full.tourVnd, '30000');
          assert.equal(full.commissionVnd, '5000');
          const onlyStaff = (await reports.staffActivity(staffOnly.token, range)).rows.find(
            (x) => x.userId === ktv,
          )!;
          assert.equal(onlyStaff.serviceSalesVnd, null);
          assert.equal(onlyStaff.tipsVnd, null);
          assert.equal(
            onlyStaff.servicesPerformed,
            2,
            'the work figures need only VIEW_STAFF_REPORTS',
          );
          const withSales = (await reports.staffActivity(staffSales.token, range)).rows.find(
            (x) => x.userId === ktv,
          )!;
          assert.equal(withSales.serviceSalesVnd, '300000');
          assert.equal(withSales.tipsVnd, null);
          const withPay = (await reports.staffActivity(staffPay.token, range)).rows.find(
            (x) => x.userId === ktv,
          )!;
          assert.equal(withPay.tipsVnd, '20000');
          assert.equal(withPay.serviceSalesVnd, null);
          // No ranking: the rows come in name order whatever the figures.
          const names = r.rows.map((x) => x.name);
          assert.deepEqual(
            names,
            [...names].sort((a, b) => a.localeCompare(b)),
          );
        },
      );

      await suite.test(
        'scope and permissions: another branch sees none of it; each report needs its own permission',
        async () => {
          const theirs = await reports.customerVisits(elsewhere.token, { from: today, to: today });
          assert.equal(theirs.totals.visits, 0);
          await fails(() => reports.customerVisits(elsewhere.token, query), 'FORBIDDEN');
          assert.equal(
            (await reports.bookingFunnel(elsewhere.token, { from: today, to: today })).totals
              .bookings,
            0,
          );
          assert.equal(
            (await reports.staffActivity(elsewhere.token, { from: today, to: kitDay })).rows.some(
              (r) => r.userId === ktv,
            ),
            false,
          );
          await fails(() => reports.loyalty(bookingsOnly.token, query), 'FORBIDDEN');
          await fails(() => reports.staffActivity(bookingsOnly.token, query), 'FORBIDDEN');
          await fails(() => reports.bookingFunnel(staffOnly.token, query), 'FORBIDDEN');
          await fails(
            () => reports.customerVisits(exporter.token, { ...query, bucket: 'hour' }),
            'VALIDATION_FAILED',
            'bucket',
          );
          await fails(
            () => reports.customerVisits(exporter.token, { from: today }),
            'VALIDATION_FAILED',
            'to',
          );
        },
      );

      await suite.test(
        'exports: customer and staff files hold the screen numbers; the staff file asks for the password; phones in full',
        async () => {
          const decode = (bytes: Uint8Array) =>
            new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
          const visits = await exports.export(exporter.token, {
            report: 'customers-visits',
            format: 'csv',
            ...query,
          });
          assert.ok(decode(visits.bytes).includes(`${today},4,3,1,2`));
          const funnel = await exports.export(exporter.token, {
            report: 'bookings-funnel',
            format: 'csv',
            ...query,
          });
          assert.ok(decode(funnel.bytes).includes(`${today},6,2,2,1,1,1`));
          const loyalty = await exports.export(exporter.token, {
            report: 'loyalty',
            format: 'xlsx',
            ...query,
          });
          assert.ok(readRows(loyalty.bytes, loyalty.filename).length >= 2);
          const top = await exports.export(exporter.token, {
            report: 'top-customers',
            format: 'csv',
            ...query,
          });
          assert.match(decode(top.bytes), /\+84\d{9}/);
          // The staff report is pay data: one file per password confirmation (sign-in covers the first, then it is spent).
          const staff = await exports.export(exporter.token, {
            report: 'staff-activity',
            format: 'xlsx',
            from: today,
            to: kitDay,
            branchId: A.id,
          });
          assert.equal(staff.rows >= 1, true);
          await fails(
            () =>
              exports.export(exporter.token, {
                report: 'staff-activity',
                format: 'csv',
                from: today,
                to: kitDay,
              }),
            'REAUTHENTICATION_REQUIRED',
          );
        },
      );
    });
  },
);
