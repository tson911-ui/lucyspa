import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import {
  appendLedgerEntry,
  LOYALTY_CONSUMER,
  LOYALTY_EVENT_TYPES,
  parseApiEnvironment,
  processLoyaltyEvent,
} from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { takeSharedAuthGraphLock } from '../auth/auth-store.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { validVnMobile } from '../testing/phone.js';
import { InvoiceService } from './invoice.service.js';
import { cumulativeShare } from './split.js';

/**
 * Phase 6 P6-9 races on separate committed PostgreSQL connections with real production service calls (the same latch as the P6-8
 * races: it releases only after both transactions hold the shared auth-graph lock; every other lock is taken by production code).
 * Whatever the interleaving: a single-use shared voucher is redeemed once, the Spa and Beauty wallets are read consistently, two
 * payments never overpay and the payments attributed to the sides add up, and every invoice's pricing reconciles afterwards
 * (`audit`: nets = receivable, shares = discount, one redemption per applied program, sides paid exactly their nets when PAID).
 * Requires an explicitly opted-in local validation database (replica-role cleanup of permanent financial history); cleanup is
 * bounded to this invocation's exact UUIDs.
 */
test(
  'Phase 6 P6-9 PostgreSQL races keep pricing, redemptions, wallets and side attribution consistent',
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
    const adapter = {
      withTransaction,
      withExclusiveTransaction: withTransaction,
      resolveForMutation: (token: string, tx: Prisma.TransactionClient) =>
        sessions.resolveForMutation(token, tx),
    };
    const throttle = new AuthThrottleService(environment);
    const invoices = new InvoiceService(adapter, throttle, environment);
    const loyaltyService = new LoyaltyService(adapter, throttle, environment);
    const inventory = new InventoryService(adapter as never, throttle, environment);
    const ids = {
      branch: randomUUID(),
      category: randomUUID(),
      service: randomUUID(),
      role: randomUUID(),
      adjustRole: randomUUID(),
    };
    const userIds: string[] = [];
    const sessionIds: string[] = [];
    const productIds: string[] = [];
    const programIds: string[] = [];
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    let serial = 0;
    let installedGoLive = false;
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
      // Only the first two transactions to arrive are latched (a command may open a second one later).
      meet = async () => {
        if (count < 2 && ++count === 2) release();
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
      await database.$transaction(async (tx) => {
        await tx.branch.create({
          data: {
            id: ids.branch,
            code: `P9R_${run}`,
            name: 'Pricing race',
            timezone: 'Asia/Ho_Chi_Minh',
          },
        });
        await tx.serviceCategory.create({
          data: { id: ids.category, code: `P9R_${run}`, nameVi: 'Race', nameEn: 'Race' },
        });
        await tx.service.create({
          data: {
            id: ids.service,
            code: `P9R_SVC_${run}`,
            categoryId: ids.category,
            nameVi: 'Race',
            nameEn: 'Race',
            priceVnd: 100_000n,
            priceMaxVnd: 100_000n,
            durationMinutes: 10,
            estimatedMinMinutes: 10,
            estimatedMaxMinutes: 10,
          },
        });
        await syncPermissionCatalog(tx);
        const permissions = await tx.permission.findMany({
          where: {
            code: {
              in: [
                'SELL_PRODUCTS',
                'VIEW_INVOICES',
                'MANAGE_INVOICES',
                'COLLECT_PAYMENTS',
                'CANCEL_INVOICES',
                'CORRECT_PAYMENTS',
                'APPLY_DISCOUNTS',
                'MANAGE_STOCK_RECEIPTS',
                'ADJUST_STOCK',
                'VIEW_INVENTORY',
              ],
            },
          },
          select: { id: true },
        });
        assert.equal(permissions.length, 10);
        const adjustPermission = await tx.permission.findUniqueOrThrow({
          where: { code: 'ADJUST_LOYALTY_POINTS' },
          select: { id: true },
        });
        await tx.role.create({
          data: {
            id: ids.adjustRole,
            code: `P9R_ADJ_${run}`,
            displayNameVi: 'Race adjuster',
            displayNameEn: 'Race adjuster',
            permissions: { create: [{ permissionId: adjustPermission.id }] },
          },
        });
        await tx.role.create({
          data: {
            id: ids.role,
            code: `P9R_${run}`,
            displayNameVi: 'Race',
            displayNameEn: 'Race',
            permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
          },
        });
      });
      const staff = (reauthenticated: boolean, adjuster = false) =>
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
                  employeeCodeCanonical: `P9R_${run}_${++serial}`,
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
          await tx.userRoleAssignment.create({
            data: { userId: id, roleId: ids.role, scopeKind: 'BRANCH', branchId: ids.branch },
          });
          if (adjuster) {
            await tx.userRoleAssignment.create({
              data: { userId: id, roleId: ids.adjustRole, scopeKind: 'GLOBAL' },
            });
          }
          const principal = {
            userId: id,
            passwordHash: user.passwordHash!,
            credentialVersion: user.credentialVersion,
            authzVersion: user.authzVersion,
          };
          const anonymous = await sessions.createAnonymous(tx);
          sessionIds.push(anonymous.session.id);
          let issued = await sessions.rotateAuthenticated(
            anonymous.token,
            principal,
            { reauthenticated: false },
            tx,
          );
          sessionIds.push(issued.session.id);
          if (reauthenticated) {
            issued = await sessions.rotateAuthenticated(
              issued.token,
              principal,
              { reauthenticated: true },
              tx,
            );
            sessionIds.push(issued.session.id);
          }
          return { id, token: issued.token };
        });
      const a = await staff(false);
      const b = await staff(false);
      const boss = await staff(true);
      const ktv = await staff(false);
      const adjuster = await staff(true, true);
      if ((await database.loyaltyGoLive.count()) === 0) {
        await database.loyaltyGoLive.create({ data: { activatedByUserId: a.id } });
        installedGoLive = true;
      }

      /** A published product with one priced variant and `stock` units received at the branch. */
      const variant = async (price: number, stock: number) => {
        const created = await database.$transaction(async (tx) => {
          const product = await tx.product.create({
            data: {
              code: `p9r-${run.toLowerCase()}-${++serial}`,
              nameVi: 'Kem race',
              nameEn: 'Race cream',
              createdByUserId: a.id,
              variants: { create: [{ sku: `P9R-${run}-${serial}` }] },
            },
            include: { variants: true },
          });
          productIds.push(product.id);
          const variantRow = product.variants[0]!;
          await tx.productPriceVersion.create({
            data: {
              variantId: variantRow.id,
              versionNo: 1,
              listPriceVnd: BigInt(price),
              createdByUserId: a.id,
            },
          });
          await tx.product.update({
            where: { id: product.id },
            data: { status: 'PUBLISHED', rowVersion: { increment: 1 } },
          });
          return variantRow.id;
        });
        if (stock > 0) await receive(created, stock);
        return created;
      };
      const receive = async (variantId: string, quantity: number) => {
        const today = (
          await database.$queryRaw<
            { d: string }[]
          >`SELECT to_char((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') AS d`
        )[0]!.d;
        const draft = await inventory.createReceipt(a.token, {
          branchId: ids.branch,
          supplierId: null,
          receiptDate: today,
          notes: null,
          lines: [{ variantId, quantity, lotCode: null, expiryDate: null }],
        });
        await inventory.confirmReceipt(a.token, draft.id, { expectedRowVersion: draft.rowVersion });
      };
      /** A customer with the given points in each wallet (manual ledger entries), committed. */
      const member = async (spa: number, beauty: number) => {
        const id = randomUUID();
        userIds.push(id);
        await database.user.create({
          data: {
            id,
            kind: 'CUSTOMER',
            status: 'ACTIVE',
            fullName: 'Race member',
            preferredLocale: 'vi',
            emailCanonical: `p9r-${id}@example.com`,
            emailDelivery: `p9r-${id}@example.com`,
            emailVerifiedAt: new Date(),
            phoneCanonical: validVnMobile(),
            normalizationVersion: 1,
            passwordHash: '$argon2id$fixture',
            customerProfile: {
              create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
            },
          },
        });
        for (const [wallet, points] of [
          ['SPA', spa],
          ['BEAUTY', beauty],
        ] as const) {
          if (points === 0) continue;
          await database.$transaction((tx) =>
            appendLedgerEntry(tx, {
              userId: id,
              wallet,
              kind: 'MANUAL_ADJUSTMENT',
              points,
              idempotencyKey: `P9R:${id}:${wallet}`,
              reason: 'Race',
              actorUserId: a.id,
            }),
          );
        }
        return id;
      };
      let slot = 0;
      /** A COMPLETED visit with one performed service of 100,000 VND, committed. */
      const completedVisit = () =>
        database.$transaction(async (tx) => {
          const start = new Date(Date.parse('2027-03-01T06:00:00+07:00') + 10 * 60_000 * slot++);
          const visit = await tx.visit.create({
            data: {
              code: `P9R-${run}-${++serial}`,
              branchId: ids.branch,
              origin: 'WALK_IN',
              serviceDate: new Date('2027-03-01T00:00:00.000Z'),
              arrivedAt: new Date('2027-03-01T05:30:00+07:00'),
              createdByUserId: a.id,
              idempotencyKey: randomUUID(),
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
              employeeUserId: ktv.id,
              assignmentMode: 'ANY',
              plannedStartAt: start,
              plannedEndAt: new Date(start.getTime() + 10 * 60_000),
              durationMinutes: 10,
              bufferMinutes: 0,
              serviceCode: `P9R_SVC_${run}`,
              serviceNameVi: 'Race',
              serviceNameEn: 'Race',
              catalogPriceMinVnd: 100_000n,
              catalogPriceMaxVnd: 100_000n,
              catalogPricingUnit: 'PER_SERVICE',
            },
          });
          const started = new Date('2027-03-01T06:00:00+07:00');
          await tx.visitServiceLine.update({
            where: { id: line.id },
            data: { status: 'IN_PROGRESS', rowVersion: { increment: 1 } },
          });
          await tx.visit.update({
            where: { id: visit.id },
            data: { status: 'IN_SERVICE', rowVersion: { increment: 1 } },
          });
          const execution = await tx.serviceExecution.create({
            data: {
              visitServiceLineId: line.id,
              employeeUserId: ktv.id,
              startedAt: started,
              expectedEndAt: new Date(started.getTime() + 10 * 60_000),
            },
          });
          await tx.serviceExecution.update({
            where: { id: execution.id },
            data: {
              status: 'ENDED',
              endedAt: new Date(started.getTime() + 10 * 60_000),
              endKind: 'NORMAL',
              endedByUserId: ktv.id,
              rowVersion: { increment: 1 },
            },
          });
          await tx.visitServiceLine.update({
            where: { id: line.id },
            data: { status: 'DONE', rowVersion: { increment: 1 } },
          });
          await tx.visit.update({
            where: { id: visit.id },
            data: {
              status: 'COMPLETED',
              completedAt: new Date('2027-03-01T07:00:00+07:00'),
              rowVersion: { increment: 1 },
            },
          });
          return visit.id;
        });
      /** A mixed draft: one service (100,000) and one unit of each given variant, for `payer`. */
      const mixedDraft = async (variants: string[], payer: string | null) => {
        const opened = (await invoices.open(a.token, await completedVisit())).invoice;
        let current = payer
          ? await invoices.payer(a.token, opened.id, {
              expectedVersion: opened.version,
              payerUserId: payer,
            })
          : opened;
        for (const variantId of variants) {
          current = await invoices.addProductLine(a.token, current.id, {
            expectedVersion: current.version,
            variantId,
            quantity: 1,
          });
        }
        return current;
      };
      const serviceDraft = async (payer: string | null) => {
        const opened = (await invoices.open(a.token, await completedVisit())).invoice;
        return payer
          ? invoices.payer(a.token, opened.id, {
              expectedVersion: opened.version,
              payerUserId: payer,
            })
          : opened;
      };
      const finalize = (actor: { token: string }, draft: { id: string; version: number }) =>
        invoices.finalize(actor.token, draft.id, { expectedVersion: draft.version });
      const pay = (actor: { token: string }, invoiceId: string, amount: number) =>
        invoices.recordPayment(actor.token, invoiceId, {
          method: 'CASH',
          amountVnd: String(amount),
          tenderedVnd: String(amount),
          idempotencyKey: randomUUID(),
        });
      /** A voucher program of `scope` worth `fixed` VND (single use when `limit` is 1), one code, committed. */
      const voucherProgram = async (
        scope: 'SERVICES' | 'PRODUCTS' | 'BOTH',
        fixed: number,
        limit: number | null,
      ) => {
        const no = ++serial;
        const program = await database.discount.create({
          data: {
            code: `P9R${run}${no}`,
            nameVi: 'Race',
            nameEn: 'Race',
            requiresCode: true,
            versions: {
              create: {
                versionNo: 1,
                kind: 'FIXED_AMOUNT',
                fixedAmountVnd: BigInt(fixed),
                validFrom: new Date(Date.now() - 86_400_000),
                validUntil: new Date(Date.now() + 30 * 86_400_000),
                minSpendVnd: 0n,
                scopeMode: 'ALL_SERVICES',
                scope,
                usageLimitTotal: limit,
                createdByUserId: a.id,
              },
            },
          },
          select: { id: true },
        });
        programIds.push(program.id);
        const voucher = await database.voucher.create({
          data: { discountId: program.id, code: `V9R${run}${no}`, createdByUserId: a.id },
          select: { id: true, code: true },
        });
        return { id: program.id, code: voucher.code };
      };
      const supply = (
        actor: { token: string },
        invoice: { id: string; version: number },
        code: string,
      ) =>
        invoices.supplyVoucher(actor.token, invoice.id, { expectedVersion: invoice.version, code });
      const activeRedemptions = (programId: string) =>
        database.discountRedemption.count({ where: { discountId: programId, release: null } });
      const reservationsOf = (invoiceId: string) =>
        database.stockReservation.findMany({ where: { invoiceId }, orderBy: { id: 'asc' } });
      const effective = async (invoiceId: string) =>
        (
          await database.payment.findMany({
            where: { invoiceId, correction: null, status: 'SUCCEEDED' },
          })
        ).reduce((sum, payment) => sum + payment.amountVnd, 0n);

      /** The Owner's reconciliation rules over everything this run created, after every race. */
      const audit = async () => {
        const all = await database.invoice.findMany({ where: { branchId: ids.branch } });
        for (const row of all) {
          assert.equal(
            row.totalVnd,
            row.subtotalVnd - row.discountTotalVnd + row.shippingFeeVnd,
            `total ${row.code}`,
          );
          const lines = await database.invoiceLine.findMany({ where: { invoiceId: row.id } });
          if (row.status !== 'DRAFT') {
            assert.equal(
              lines.reduce((sum, line) => sum + (line.grossVnd ?? 0n), 0n),
              row.subtotalVnd,
              `lines ${row.code}`,
            );
          }
          const paid = await effective(row.id);
          if (row.status === 'PAID') assert.equal(paid, row.totalVnd, `paid ${row.code}`);
          if (row.status === 'CANCELLED') assert.equal(paid, 0n, `cancelled ${row.code} paid`);
          const allocations = await database.invoiceLineAllocation.findMany({
            where: { invoiceId: row.id },
          });
          const attributed = await database.paymentSideAllocation.findMany({
            where: { invoiceId: row.id },
          });
          const redemptions = await database.discountRedemption.findMany({
            where: { invoiceId: row.id },
            include: { release: true },
          });
          if (row.calculationVersion < 3) {
            assert.equal(allocations.length, 0, `${row.code} (v2) has no allocation`);
            assert.equal(attributed.length, 0, `${row.code} (v2) has no attribution`);
            continue;
          }
          assert.equal(allocations.length, lines.length, `${row.code} allocates every line`);
          const net = allocations.reduce((sum, entry) => sum + entry.netVnd, 0n);
          const shares = allocations.reduce((sum, entry) => sum + entry.discountShareVnd, 0n);
          assert.equal(net, row.totalVnd - row.shippingFeeVnd, `nets ${row.code}`);
          assert.equal(shares, row.discountTotalVnd, `shares ${row.code}`);
          const sideNet = (side: 'SPA' | 'BEAUTY') =>
            allocations
              .filter((entry) => entry.side === side)
              .reduce((sum, entry) => sum + entry.netVnd, 0n);
          const attributedTo = (side: 'SPA' | 'BEAUTY') =>
            attributed
              .filter((entry) => entry.side === side)
              .reduce((sum, entry) => sum + entry.amountVnd, 0n);
          assert.equal(
            attributedTo('SPA') + attributedTo('BEAUTY'),
            paid,
            `attributed = paid ${row.code}`,
          );
          if (row.status === 'PAID') {
            assert.equal(attributedTo('SPA'), sideNet('SPA'), `Spa paid ${row.code}`);
            assert.equal(attributedTo('BEAUTY'), sideNet('BEAUTY'), `Beauty paid ${row.code}`);
          }
          const applied = new Set<string>();
          const spaApplication = await database.invoiceDiscountApplication.findUnique({
            where: { invoiceId: row.id },
          });
          const beautyApplication = await database.invoiceBeautyApplication.findUnique({
            where: { invoiceId: row.id },
          });
          if (spaApplication) applied.add(spaApplication.discountId);
          if (beautyApplication) applied.add(beautyApplication.discountId);
          assert.deepEqual(
            redemptions.map((entry) => entry.discountId).sort(),
            [...applied].sort(),
            `redemptions ${row.code}`,
          );
          for (const redemption of redemptions) {
            assert.equal(
              redemption.release !== null,
              row.status === 'CANCELLED',
              `release ${row.code}`,
            );
          }
          // Each wallet's snapshot is internally consistent with the tier table (the database CHECK) and with the discount it gave.
          const beautySnapshot = await database.invoiceBeautySnapshot.findUnique({
            where: { invoiceId: row.id },
          });
          if (beautySnapshot?.winnerSource === 'MEMBER_TIER') {
            assert.equal(
              beautySnapshot.memberAmountVnd,
              (beautySnapshot.eligibleBeautyVnd * BigInt(beautySnapshot.memberDiscountBp) + 5000n) /
                10000n,
            );
          }
        }
        for (const programId of programIds) {
          const program = await database.discount.findUniqueOrThrow({
            where: { id: programId },
            include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } },
          });
          const limit = program.versions[0]!.usageLimitTotal;
          if (limit !== null)
            assert.ok(
              (await activeRedemptions(programId)) <= limit,
              `usage limit of ${program.code}`,
            );
        }
      };

      await suite.test(
        'two mixed invoices finalize with the same single-use shared voucher at once: exactly one gets it, once; the other falls back to its member discounts',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const v = await variant(100_000, 4);
            const shared = await voucherProgram('BOTH', 60_000, 1);
            const payerOne = await member(1000, 500);
            const payerTwo = await member(1000, 500);
            let first = await mixedDraft([v], payerOne);
            let second = await mixedDraft([v], payerTwo);
            first = await supply(a, first, shared.code);
            second = await supply(b, second, shared.code);
            const results = await race(
              () => finalize(a, first),
              () => finalize(b, second),
            );
            assert.deepEqual(results.map(outcome), ['OK', 'OK'], `round ${round}`);
            assert.equal(await activeRedemptions(shared.id), 1, 'the voucher is redeemed once');
            const stored = await Promise.all(
              [first.id, second.id].map((id) =>
                database.invoice.findUniqueOrThrow({ where: { id } }),
              ),
            );
            const withVoucher = await database.discountRedemption.count({
              where: { invoiceId: { in: [first.id, second.id] }, discountId: shared.id },
            });
            assert.equal(withVoucher, 1);
            // The winner paid 60,000 less on the two sides together (30,000 + 30,000: eligible 100,000 + 100,000); the other took Gold 4% + Silver 3% = 7,000.
            const discounts = stored
              .map((row) => row.discountTotalVnd)
              .sort((x, y) => Number(x - y));
            assert.deepEqual(discounts, [7_000n, 60_000n]);
          }
          await audit();
        },
      );

      await suite.test(
        'a mixed finalization racing a service-only finalization of the SAME member never deadlocks and both price correctly',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const v = await variant(100_000, 4);
            const payer = await member(1000, 500);
            const mixed = await mixedDraft([v], payer);
            const plain = await serviceDraft(payer);
            const results = await race(
              () => finalize(a, mixed),
              () => finalize(b, plain),
            );
            assert.deepEqual(results.map(outcome), ['OK', 'OK'], `round ${round}`);
            const [mixedRow, plainRow] = await Promise.all(
              [mixed.id, plain.id].map((id) =>
                database.invoice.findUniqueOrThrow({ where: { id } }),
              ),
            );
            assert.equal(mixedRow!.calculationVersion, 3);
            assert.equal(plainRow!.calculationVersion, 2);
            // Spa 100,000 x 4% = 4,000 and Beauty 100,000 x 3% = 3,000 on the mixed invoice; 4,000 on the service-only one.
            assert.equal(mixedRow!.discountTotalVnd, 7_000n);
            assert.equal(plainRow!.discountTotalVnd, 4_000n);
          }
          await audit();
        },
      );

      await suite.test(
        'a finalization racing a Beauty-wallet adjustment of its payer: the Beauty snapshot is the balance before OR after, and the discount follows it exactly',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const v = await variant(100_000, 4);
            const payer = await member(0, 400);
            const draft = await mixedDraft([v], payer);
            // +200 points moves the Beauty wallet from 400 (no tier) to 600 (Silver 3%).
            const adjust = () =>
              loyaltyService.adjust(adjuster.token, payer, {
                wallet: 'BEAUTY',
                points: 200,
                reason: 'Race: cộng điểm khi chốt hóa đơn',
                clientRequestId: randomUUID(),
              });
            const results = await race(() => finalize(a, draft), adjust);
            assert.deepEqual(results.map(outcome), ['OK', 'OK'], `round ${round}`);
            const snapshot = await database.invoiceBeautySnapshot.findUniqueOrThrow({
              where: { invoiceId: draft.id },
            });
            assert.ok(
              [400, 600].includes(snapshot.balanceBefore),
              `balance ${snapshot.balanceBefore}`,
            );
            assert.equal(snapshot.memberDiscountBp, snapshot.balanceBefore === 600 ? 300 : 0);
            assert.equal(snapshot.memberAmountVnd, snapshot.balanceBefore === 600 ? 3_000n : 0n);
            const stored = await database.invoice.findUniqueOrThrow({ where: { id: draft.id } });
            assert.equal(stored.discountTotalVnd, snapshot.memberAmountVnd);
            const wallet = await database.loyaltyWalletAccount.findUniqueOrThrow({
              where: { userId_wallet: { userId: payer, wallet: 'BEAUTY' } },
            });
            assert.equal(wallet.balancePoints, 600);
          }
          await audit();
        },
      );

      await suite.test(
        'two cashiers pay the same mixed invoice in full at once: one payment, the sides attributed exactly to their nets',
        async () => {
          for (let round = 0; round < 5; round += 1) {
            const v = await variant(100_000, 4);
            const payer = await member(1000, 500);
            const done = await finalize(a, await mixedDraft([v], payer));
            assert.equal(done.totalVnd, '193000');
            const results = await race(
              () => pay(a, done.id, 193_000),
              () => pay(b, done.id, 193_000),
            );
            const codes = results.map(outcome).sort();
            assert.equal(codes.filter((code) => code === 'OK').length, 1, codes.join());
            const stored = await database.invoice.findUniqueOrThrow({ where: { id: done.id } });
            assert.equal(stored.status, 'PAID');
            assert.equal(await effective(done.id), 193_000n);
            const rows = await database.paymentSideAllocation.findMany({
              where: { invoiceId: done.id },
            });
            assert.equal(rows.length, 2, 'one attribution row per side');
            assert.deepEqual(rows.map((row) => [row.side, row.amountVnd]).sort(), [
              ['BEAUTY', 97_000n],
              ['SPA', 96_000n],
            ]);
          }
          await audit();
        },
      );

      await suite.test(
        'a payment racing the reversal of an earlier one: the attribution stays equal to the effective payments and the next payment realigns the sides',
        async () => {
          for (let round = 0; round < 5; round += 1) {
            const v = await variant(100_000, 4);
            const payer = await member(1000, 500);
            const done = await finalize(a, await mixedDraft([v], payer));
            const first = await pay(a, done.id, 60_001);
            const results = await race(
              () => pay(b, done.id, 50_000),
              () =>
                invoices.reversePayment(boss.token, done.id, first.payment.id, {
                  reason: 'Nhập nhầm',
                }),
            );
            assert.deepEqual(results.map(outcome), ['OK', 'OK'], `round ${round}`);
            assert.equal(await effective(done.id), 50_000n);
            const rows = await database.paymentSideAllocation.findMany({
              where: { invoiceId: done.id },
            });
            const total = rows.reduce((sum, row) => sum + row.amountVnd, 0n);
            assert.equal(total, 50_000n, 'what is attributed equals what is effectively paid');
            // The rest is paid: each side ends exactly at its net (96,000 + 97,000).
            const rest = await pay(a, done.id, 143_000);
            assert.equal(rest.invoice.status, 'PAID');
            const final = await database.paymentSideAllocation.findMany({
              where: { invoiceId: done.id },
            });
            const sum = (side: 'SPA' | 'BEAUTY') =>
              final.filter((row) => row.side === side).reduce((s, row) => s + row.amountVnd, 0n);
            assert.equal(sum('SPA'), 96_000n);
            assert.equal(sum('BEAUTY'), 97_000n);
            assert.equal(cumulativeShare(193_000n, 96_000n, 193_000n), 96_000n);
          }
          await audit();
        },
      );

      // ---------------------------------------------------------------------- P6-11: the Beauty wallet earns
      /** One `loyalty` event in its own committed transaction, as the worker runs it (the graph lock first, then the latch). */
      const loyaltyWorker = (eventId: string) =>
        database.$transaction(
          async (tx) => {
            await takeSharedAuthGraphLock(tx);
            if (meet) await meet();
            return processLoyaltyEvent(tx, eventId);
          },
          { timeout: 30_000, maxWait: 10_000 },
        );
      const loyaltyEvents = (invoiceId: string) =>
        database.outboxEvent.findMany({
          where: {
            aggregateType: 'Invoice',
            aggregateId: invoiceId,
            eventType: { in: LOYALTY_EVENT_TYPES },
            consumptions: { none: { consumer: LOYALTY_CONSUMER } },
          },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          select: { id: true, eventType: true },
        });
      /** The worker catching up on everything pending for the invoice, oldest first. */
      const drainLoyalty = async (invoiceId: string) => {
        for (const event of await loyaltyEvents(invoiceId)) await loyaltyWorker(event.id);
      };
      const settledValue = (result: PromiseSettledResult<unknown>) =>
        result.status === 'fulfilled' ? String(result.value) : outcome(result);
      const ledger = (invoiceId: string, wallet: 'SPA' | 'BEAUTY') =>
        database.loyaltyLedgerEntry.findMany({
          where: { invoiceId, wallet },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
      const balanceOf = async (userId: string, wallet: 'SPA' | 'BEAUTY') =>
        (
          await database.loyaltyWalletAccount.findUniqueOrThrow({
            where: { userId_wallet: { userId, wallet } },
          })
        ).balancePoints;
      /** Each wallet's balance equals the sum of its entries (Owner's reconciliation rule), for every race member. */
      const reconcileWallets = async () => {
        for (const wallet of await database.loyaltyWalletAccount.findMany({
          where: { userId: { in: userIds } },
        })) {
          const sum = await database.loyaltyLedgerEntry.aggregate({
            where: { userId: wallet.userId, wallet: wallet.wallet },
            _sum: { points: true },
          });
          assert.equal(wallet.balancePoints, sum._sum.points ?? 0, `${wallet.wallet} balance`);
        }
      };

      await suite.test(
        'two workers claim the same paid event of a mixed invoice at once: one earns in both wallets, the other claims nothing',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const v = await variant(100_000, 4);
            const payer = await member(1000, 500);
            const done = await finalize(a, await mixedDraft([v], payer));
            await pay(a, done.id, 193_000);
            const [event] = await loyaltyEvents(done.id);
            assert.equal(event!.eventType, 'INVOICE_PAID');
            const results = await race(
              () => loyaltyWorker(event!.id),
              () => loyaltyWorker(event!.id),
            );
            assert.deepEqual(
              results.map(settledValue).sort(),
              ['APPLIED', 'NOT_CLAIMED'],
              `round ${round}`,
            );
            assert.deepEqual(
              (await ledger(done.id, 'SPA')).map((e) => [e.points, e.idempotencyKey]),
              [[96, `SPA_EARN:${done.id}:1`]],
            );
            assert.deepEqual(
              (await ledger(done.id, 'BEAUTY')).map((e) => [e.points, e.idempotencyKey]),
              [[97, `BEAUTY_EARN:${done.id}:1`]],
            );
            assert.equal(await balanceOf(payer, 'SPA'), 1096);
            assert.equal(await balanceOf(payer, 'BEAUTY'), 597);
          }
          await reconcileWallets();
          await audit();
        },
      );

      await suite.test(
        'the paid event racing the reversal of the payment: the points are earned and taken back, or never earned; never earned without being taken back',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const v = await variant(100_000, 4);
            const payer = await member(1000, 500);
            const done = await finalize(a, await mixedDraft([v], payer));
            const paid = await pay(a, done.id, 193_000);
            const [event] = await loyaltyEvents(done.id);
            const results = await race(
              () => loyaltyWorker(event!.id),
              () =>
                invoices.reversePayment(boss.token, done.id, paid.payment.id, {
                  reason: 'Nhập nhầm',
                }),
            );
            assert.equal(outcome(results[1]!), 'OK', `round ${round}`);
            assert.ok(
              ['APPLIED', 'SKIPPED_STALE'].includes(settledValue(results[0]!)),
              settledValue(results[0]!),
            );
            await drainLoyalty(done.id);
            for (const wallet of ['SPA', 'BEAUTY'] as const) {
              const entries = await ledger(done.id, wallet);
              const net = entries.reduce((sum, entry) => sum + entry.points, 0);
              assert.equal(net, 0, `${wallet} nets to zero after the reversal`);
              assert.ok([0, 2].includes(entries.length), `${wallet}: no earn without its reversal`);
            }
            assert.equal(await balanceOf(payer, 'SPA'), 1000);
            assert.equal(await balanceOf(payer, 'BEAUTY'), 500);
          }
          await reconcileWallets();
          await audit();
        },
      );

      await suite.test(
        'the Beauty earn racing a manual adjustment of the same wallet: both apply, whichever comes first',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const v = await variant(100_000, 4);
            const payer = await member(1000, 500);
            const done = await finalize(a, await mixedDraft([v], payer));
            await pay(a, done.id, 193_000);
            const [event] = await loyaltyEvents(done.id);
            const results = await race(
              () => loyaltyWorker(event!.id),
              () =>
                loyaltyService.adjust(adjuster.token, payer, {
                  wallet: 'BEAUTY',
                  points: 200,
                  reason: 'Race: cộng điểm khi tích điểm',
                  clientRequestId: randomUUID(),
                }),
            );
            assert.equal(settledValue(results[0]!), 'APPLIED', `round ${round}`);
            assert.equal(outcome(results[1]!), 'OK');
            assert.equal(await balanceOf(payer, 'BEAUTY'), 500 + 97 + 200);
            assert.equal(await balanceOf(payer, 'SPA'), 1096);
          }
          await reconcileWallets();
          await audit();
        },
      );

      await suite.test(
        'finalize against cancel of a mixed draft that holds a shared voucher: finalized with its redemption and stock, or cancelled with neither',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const v = await variant(100_000, 3);
            const shared = await voucherProgram('BOTH', 20_000, 1);
            const draft = await supply(a, await mixedDraft([v], null), shared.code);
            const results = await race(
              () => finalize(a, draft),
              () =>
                invoices.cancel(boss.token, draft.id, {
                  expectedVersion: draft.version,
                  reason: 'Khách đổi ý',
                }),
            );
            const [finalizeResult, cancelResult] = results.map(outcome);
            const stored = await database.invoice.findUniqueOrThrow({ where: { id: draft.id } });
            if (stored.status === 'CANCELLED') {
              assert.equal(cancelResult, 'OK');
              assert.notEqual(finalizeResult, 'OK');
              assert.equal(await activeRedemptions(shared.id), 0);
              assert.ok((await reservationsOf(draft.id)).every((r) => r.status === 'RELEASED'));
            } else {
              assert.equal(finalizeResult, 'OK');
              assert.equal(stored.status, 'PENDING_PAYMENT');
              assert.equal(await activeRedemptions(shared.id), 1);
              assert.equal((await reservationsOf(draft.id)).length, 1);
            }
          }
          await audit();
        },
      );

      await suite.test(
        'cancelling a finalized invoice that holds a single-use voucher while another invoice finalizes with the same code: the use is taken at most once',
        async () => {
          for (let round = 0; round < 5; round += 1) {
            const v = await variant(100_000, 4);
            const shared = await voucherProgram('BOTH', 20_000, 1);
            const held = await finalize(
              a,
              await supply(a, await mixedDraft([v], null), shared.code),
            );
            assert.equal(await activeRedemptions(shared.id), 1);
            const waiting = await supply(b, await mixedDraft([v], null), shared.code);
            const results = await race(
              () =>
                invoices.cancel(boss.token, held.id, {
                  expectedVersion: held.version,
                  reason: 'Khách đổi ý',
                }),
              () => finalize(b, waiting),
            );
            assert.deepEqual(results.map(outcome), ['OK', 'OK'], `round ${round}`);
            // Either the cancellation released the use first (the waiting invoice took it) or the waiting one was priced without it.
            const taken = await database.discountRedemption.count({
              where: { invoiceId: waiting.id, release: null },
            });
            assert.equal(await activeRedemptions(shared.id), taken);
            assert.ok(taken <= 1);
          }
          await audit();
        },
      );
    } finally {
      meet = null;
      try {
        await database.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
            const invoiceRows = (
              await tx.invoice.findMany({ where: { branchId: ids.branch }, select: { id: true } })
            ).map((row) => row.id);
            const visits = (
              await tx.visit.findMany({ where: { branchId: ids.branch }, select: { id: true } })
            ).map((row) => row.id);
            const lines = (
              await tx.visitServiceLine.findMany({
                where: { visitId: { in: visits } },
                select: { id: true },
              })
            ).map((row) => row.id);
            const executionRows = (
              await tx.serviceExecution.findMany({
                where: { visitServiceLineId: { in: lines } },
                select: { id: true },
              })
            ).map((row) => row.id);
            const paymentRows = (
              await tx.payment.findMany({
                where: { invoiceId: { in: invoiceRows } },
                select: { id: true },
              })
            ).map((row) => row.id);
            const variantRows = (
              await tx.productVariant.findMany({
                where: { productId: { in: productIds } },
                select: { id: true },
              })
            ).map((row) => row.id);
            await tx.outboxEvent.deleteMany({
              where: {
                OR: [
                  { branchId: ids.branch },
                  {
                    aggregateId: {
                      in: [...invoiceRows, ...visits, ...executionRows, ...paymentRows, ...userIds],
                    },
                  },
                ],
              },
            });
            await tx.auditEvent.deleteMany({
              where: { OR: [{ branchId: ids.branch }, { actorUserId: { in: userIds } }] },
            });
            await tx.paymentSideAllocation.deleteMany({
              where: { invoiceId: { in: invoiceRows } },
            });
            await tx.paymentAttempt.deleteMany({ where: { paymentId: { in: paymentRows } } });
            await tx.paymentCorrection.deleteMany({ where: { paymentId: { in: paymentRows } } });
            await tx.payment.deleteMany({ where: { id: { in: paymentRows } } });
            await tx.invoiceLineAllocation.deleteMany({
              where: { invoiceId: { in: invoiceRows } },
            });
            await tx.stockReservation.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.discountRedemptionRelease.deleteMany({
              where: { redemption: { invoiceId: { in: invoiceRows } } },
            });
            await tx.discountRedemption.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoiceBeautyApplication.deleteMany({
              where: { invoiceId: { in: invoiceRows } },
            });
            await tx.invoiceBeautySnapshot.deleteMany({
              where: { invoiceId: { in: invoiceRows } },
            });
            await tx.invoiceDiscountApplication.deleteMany({
              where: { invoiceId: { in: invoiceRows } },
            });
            await tx.invoiceLoyaltySnapshot.deleteMany({
              where: { invoiceId: { in: invoiceRows } },
            });
            await tx.invoiceVoucherEntry.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoiceLineProduct.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoiceLineService.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoice.deleteMany({ where: { id: { in: invoiceRows } } });
            await tx.voucher.deleteMany({ where: { discountId: { in: programIds } } });
            await tx.discountVersion.deleteMany({ where: { discountId: { in: programIds } } });
            await tx.discount.deleteMany({ where: { id: { in: programIds } } });
            await tx.loyaltyLedgerEntry.deleteMany({ where: { userId: { in: userIds } } });
            await tx.loyaltyWalletAccount.deleteMany({ where: { userId: { in: userIds } } });
            if (installedGoLive) await tx.loyaltyGoLive.deleteMany({});
            await tx.$executeRaw`DELETE FROM ktv_occupancies WHERE employee_user_id = ANY(${userIds}::uuid[])`;
            await tx.serviceExecution.deleteMany({ where: { id: { in: executionRows } } });
            await tx.visitServiceLine.deleteMany({ where: { id: { in: lines } } });
            await tx.visitParticipant.deleteMany({ where: { visitId: { in: visits } } });
            await tx.visit.deleteMany({ where: { id: { in: visits } } });
            await tx.stockMovement.deleteMany({ where: { branchId: ids.branch } });
            await tx.inventoryLot.deleteMany({ where: { branchId: ids.branch } });
            await tx.inventoryLowStockAlert.deleteMany({ where: { branchId: ids.branch } });
            await tx.stockLevel.deleteMany({ where: { branchId: ids.branch } });
            await tx.stockReceiptLine.deleteMany({ where: { receipt: { branchId: ids.branch } } });
            await tx.stockReceipt.deleteMany({ where: { branchId: ids.branch } });
            await tx.productPriceVersion.deleteMany({ where: { variantId: { in: variantRows } } });
            await tx.productVariant.deleteMany({ where: { id: { in: variantRows } } });
            await tx.product.deleteMany({ where: { id: { in: productIds } } });
            await tx.session.deleteMany({
              where: { OR: [{ id: { in: sessionIds } }, { userId: { in: userIds } }] },
            });
            await tx.userRoleAssignment.deleteMany({ where: { userId: { in: userIds } } });
            await tx.rolePermission.deleteMany({
              where: { roleId: { in: [ids.role, ids.adjustRole] } },
            });
            await tx.role.deleteMany({ where: { id: { in: [ids.role, ids.adjustRole] } } });
            await tx.employeeBranchAssignment.deleteMany({
              where: { employeeUserId: { in: userIds } },
            });
            await tx.employmentClassificationChange.deleteMany({
              where: { employeeUserId: { in: userIds } },
            });
            await tx.employeeProfile.deleteMany({ where: { userId: { in: userIds } } });
            await tx.customerProfile.deleteMany({ where: { userId: { in: userIds } } });
            await tx.user.deleteMany({ where: { id: { in: userIds } } });
            await tx.service.deleteMany({ where: { id: ids.service } });
            await tx.serviceCategory.deleteMany({ where: { id: ids.category } });
            await tx.branch.deleteMany({ where: { id: ids.branch } });
          },
          { timeout: 60_000 },
        );
        assert.equal(await database.invoice.count({ where: { branchId: ids.branch } }), 0);
        assert.equal(await database.branch.count({ where: { id: ids.branch } }), 0);
        assert.equal(await database.discount.count({ where: { id: { in: programIds } } }), 0);
      } finally {
        await database.$disconnect();
      }
    }
  },
);
