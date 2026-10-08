import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import { LocalDiskMediaStorage, parseApiEnvironment } from '@lucy-spa/server';
import { pino } from 'pino';
import sharp from 'sharp';
import { AuthError } from '../auth/auth.error.js';
import { takeSharedAuthGraphLock } from '../auth/auth-store.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { InvoiceService } from '../pos/invoice.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { validVnMobile } from '../testing/phone.js';
import { ProductReturnService } from './return.service.js';

/**
 * Phase 6 P6-12 races on separate committed PostgreSQL connections with real production service calls (the latch of the Phase 4
 * and Phase 6 races: it releases only after both transactions hold the shared auth-graph lock; every other lock is taken by
 * production code). Whatever the interleaving: the units claimed on a line never exceed the units sold, a case is decided exactly
 * once, the history agrees with the state, a photo is never added to a closed case, a wrong or damaged product is never accepted
 * without a present photo, and opening cases while others do the same (every staff member holds REFUND_PRODUCTS, so the notice
 * recipients overlap) or while a payment is reversed never deadlocks. Requires an explicitly opted-in local validation database
 * (replica-role cleanup of permanent history); cleanup is bounded to this invocation's exact UUIDs.
 */
test(
  'Phase 6 P6-12 PostgreSQL races keep return cases, their history and their evidence consistent',
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
    const folder = await mkdtemp(path.join(tmpdir(), 'lucy-returns-race-'));
    const storage = new LocalDiskMediaStorage(folder);
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
      resolve: (token: string | undefined, tx: Prisma.TransactionClient) =>
        sessions.resolve(token, tx),
    };
    const throttle = new AuthThrottleService(environment);
    const invoices = new InvoiceService(adapter as never, throttle, environment);
    const inventory = new InventoryService(adapter as never, throttle, environment);
    const returns = new ProductReturnService(
      adapter as never,
      throttle,
      storage,
      pino({ level: 'silent' }),
    );
    const ids = { branch: randomUUID(), role: randomUUID() };
    const userIds: string[] = [];
    const sessionIds: string[] = [];
    const productIds: string[] = [];
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    let serial = 0;
    let createdOwner: string | null = null;
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
            code: `PRR_${run}`,
            name: 'Return race',
            timezone: 'Asia/Ho_Chi_Minh',
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
                'MANAGE_STOCK_RECEIPTS',
                'ADJUST_STOCK',
                'VIEW_INVENTORY',
                'MANAGE_PRODUCT_RETURNS',
                'REFUND_PRODUCTS',
              ],
            },
          },
          select: { id: true },
        });
        assert.equal(permissions.length, 11);
        await tx.role.create({
          data: {
            id: ids.role,
            code: `PRR_${run}`,
            displayNameVi: 'Race',
            displayNameEn: 'Race',
            permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
          },
        });
      });
      const login = async (
        tx: Prisma.TransactionClient,
        user: {
          id: string;
          passwordHash: string | null;
          credentialVersion: number;
          authzVersion: number;
        },
        reauthenticated: boolean,
      ) => {
        const principal = {
          userId: user.id,
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
        return issued.token;
      };
      const staff = (reauthenticated: boolean) =>
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
                  employeeCodeCanonical: `PRR_${run}_${++serial}`,
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
          return { id, token: await login(tx, user, reauthenticated) };
        });
      const a = await staff(false);
      const b = await staff(false);
      const boss = await staff(true);
      const owner = await database.$transaction(async (tx) => {
        let row = await tx.user.findFirst({ where: { kind: 'OWNER' } });
        if (!row) {
          row = await tx.user.create({
            data: {
              kind: 'OWNER',
              status: 'ACTIVE',
              fullName: 'Chủ spa race',
              preferredLocale: 'vi',
              emailCanonical: `prr-owner-${run.toLowerCase()}@example.com`,
              emailDelivery: `prr-owner-${run.toLowerCase()}@example.com`,
              normalizationVersion: 1,
              passwordHash: '$argon2id$fixture',
            },
          });
          createdOwner = row.id;
          userIds.push(row.id);
        }
        return { id: row.id, token: await login(tx, row, false) };
      });

      const today = async () =>
        (
          await database.$queryRaw<
            { d: string }[]
          >`SELECT to_char((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') AS d`
        )[0]!.d;
      /** A paid counter sale of `quantity` units of a fresh product. */
      const sale = async (quantity: number) => {
        const created = await database.$transaction(async (tx) => {
          const product = await tx.product.create({
            data: {
              code: `prr-${run.toLowerCase()}-${++serial}`,
              nameVi: 'Kem race',
              nameEn: 'Race cream',
              createdByUserId: a.id,
              variants: { create: [{ sku: `PRR-${run}-${serial}` }] },
            },
            include: { variants: true },
          });
          productIds.push(product.id);
          const variantRow = product.variants[0]!;
          await tx.productPriceVersion.create({
            data: {
              variantId: variantRow.id,
              versionNo: 1,
              listPriceVnd: 90_000n,
              createdByUserId: a.id,
            },
          });
          await tx.product.update({
            where: { id: product.id },
            data: { status: 'PUBLISHED', rowVersion: { increment: 1 } },
          });
          return variantRow.id;
        });
        const draftReceipt = await inventory.createReceipt(a.token, {
          branchId: ids.branch,
          supplierId: null,
          receiptDate: await today(),
          notes: null,
          lines: [{ variantId: created, quantity: quantity + 2, lotCode: null, expiryDate: null }],
        });
        await inventory.confirmReceipt(a.token, draftReceipt.id, {
          expectedRowVersion: draftReceipt.rowVersion,
        });
        let invoice = (await invoices.openProductSale(a.token, ids.branch, { payerUserId: null }))
          .invoice;
        invoice = await invoices.addProductLine(a.token, invoice.id, {
          expectedVersion: invoice.version,
          variantId: created,
          quantity,
        });
        invoice = await invoices.finalize(a.token, invoice.id, {
          expectedVersion: invoice.version,
        });
        const paid = await invoices.recordPayment(a.token, invoice.id, {
          method: 'CASH',
          amountVnd: String(invoice.totalVnd),
          tenderedVnd: String(invoice.totalVnd),
          idempotencyKey: randomUUID(),
        });
        const view = await invoices.get(a.token, invoice.id);
        return {
          invoiceId: invoice.id,
          lineId: view.productLines[0]!.id,
          paymentId: paid.payment.id,
        };
      };
      const open = (
        actor: { token: string },
        line: { lineId: string },
        patch: Record<string, unknown> = {},
      ) =>
        returns.open(actor.token, {
          branchId: ids.branch,
          invoiceLineId: line.lineId,
          reason: 'PERSONAL_PREFERENCE',
          requestedOutcome: 'EXCHANGE',
          quantity: 1,
          sealIntact: true,
          notes: null,
          clientRequestId: randomUUID(),
          ...patch,
        } as never);
      const photo = async (color: string) =>
        sharp({ create: { width: 16, height: 16, channels: 3, background: color } })
          .png()
          .toBuffer();
      const caseRow = (id: string) =>
        database.productReturnCase.findUniqueOrThrow({
          where: { id },
          include: { events: true, photos: true },
        });

      /** The invariants of the whole run, after every race. */
      const audit = async () => {
        const claims = await database.$queryRaw<{ line: string; sold: number; claimed: bigint }[]>`
          SELECT c.invoice_line_id AS line, l.quantity AS sold, SUM(c.quantity) AS claimed
          FROM product_return_cases c JOIN invoice_lines l ON l.id = c.invoice_line_id
          WHERE c.branch_id = ${ids.branch}::uuid AND c.status IN ('OPEN', 'ACCEPTED')
          GROUP BY c.invoice_line_id, l.quantity`;
        for (const claim of claims) {
          assert.ok(
            claim.claimed <= BigInt(claim.sold),
            `claimed ${claim.claimed} of ${claim.sold}`,
          );
        }
        const cases = await database.productReturnCase.findMany({
          where: { branchId: ids.branch },
          include: { events: true, photos: true },
        });
        for (const row of cases) {
          const kinds = row.events.map((event) => event.kind);
          assert.equal(kinds.filter((kind) => kind === 'OPENED').length, 1, `opened ${row.code}`);
          const closing = kinds.filter((kind) =>
            ['ACCEPTED', 'DECLINED', 'CANCELLED'].includes(kind),
          );
          if (row.status === 'OPEN')
            assert.equal(closing.length, 0, `open ${row.code} has a decision`);
          else assert.deepEqual(closing, [row.status], `history agrees with state ${row.code}`);
          for (const evidence of row.photos) {
            if (row.closedAt !== null) {
              assert.ok(evidence.uploadedAt <= row.closedAt, `photo after the close ${row.code}`);
            }
          }
          if (row.status === 'ACCEPTED' && row.reason === 'WRONG_OR_DAMAGED') {
            const present = row.photos.filter(
              (evidence) =>
                evidence.uploadedAt <= row.windowEndsAt! &&
                (evidence.removedAt === null || evidence.removedAt > row.closedAt!),
            );
            assert.ok(present.length >= 1, `accepted without a present photo ${row.code}`);
          }
        }
      };

      await suite.test(
        'two clerks claim more units than were sold at once: the line is never over-claimed',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const s = await sale(3);
            const results = await race(
              () => open(a, s, { quantity: 2 }),
              () => open(b, s, { quantity: 2 }),
            );
            const codes = results.map(outcome).sort();
            assert.deepEqual(codes, ['OK', 'RETURN_QUANTITY_EXCEEDED'], `round ${round}`);
            const rows = await database.productReturnCase.findMany({
              where: { invoiceLineId: s.lineId },
            });
            assert.equal(rows.length, 1);
            // The remaining unit can still be claimed.
            await open(a, s, { quantity: 1 });
          }
          await audit();
        },
      );

      await suite.test(
        'the same request sent twice at once opens one case; the repeat gets that case or a retryable conflict',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const s = await sale(2);
            const clientRequestId = randomUUID();
            const results = await race(
              () => open(a, s, { clientRequestId }),
              () => open(a, s, { clientRequestId }),
            );
            const codes = results.map(outcome);
            assert.ok(codes.includes('OK'), codes.join());
            assert.ok(
              codes.every((code) => ['OK', 'CONFLICT'].includes(code)),
              codes.join(),
            );
            assert.equal(
              await database.productReturnCase.count({ where: { invoiceLineId: s.lineId } }),
              1,
            );
            // The retry after a conflict returns the case that exists.
            const again = await open(a, s, { clientRequestId });
            const [only] = await database.productReturnCase.findMany({
              where: { invoiceLineId: s.lineId },
            });
            assert.equal(again.id, only!.id);
          }
          await audit();
        },
      );

      await suite.test(
        'every staff member holds REFUND_PRODUCTS, so the notice recipients overlap: concurrent openings never deadlock and each is told once',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const first = await sale(2);
            const second = await sale(2);
            const results = await race(
              () => open(a, first),
              () => open(b, second),
            );
            assert.deepEqual(results.map(outcome), ['OK', 'OK'], `round ${round}`);
            const opened = await database.productReturnCase.findMany({
              where: { invoiceLineId: { in: [first.lineId, second.lineId] } },
              select: { id: true, openedByUserId: true },
            });
            for (const row of opened) {
              const told = await database.notification.findMany({
                where: { type: 'PRODUCT_RETURN_OPENED', entityId: row.id },
                select: { recipientUserId: true },
              });
              const recipients = told.map((entry) => entry.recipientUserId).sort();
              assert.equal(new Set(recipients).size, recipients.length, 'told once each');
              assert.ok(!recipients.includes(row.openedByUserId), 'not the opener');
              assert.ok(recipients.includes(boss.id));
            }
          }
          await audit();
        },
      );

      await suite.test(
        'accept against decline, decline against cancel: a case is decided exactly once',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const s = await sale(2);
            const c = await open(a, s);
            const results =
              round % 2 === 0
                ? await race(
                    () =>
                      returns.accept(b.token, c.id, {
                        expectedRowVersion: c.rowVersion,
                        outcome: 'REFUND',
                        note: null,
                      }),
                    () =>
                      returns.decline(boss.token, c.id, {
                        expectedRowVersion: c.rowVersion,
                        note: 'Không đủ điều kiện',
                      }),
                  )
                : await race(
                    () =>
                      returns.decline(b.token, c.id, {
                        expectedRowVersion: c.rowVersion,
                        note: 'Không đủ điều kiện',
                      }),
                    () =>
                      returns.cancel(a.token, c.id, {
                        expectedRowVersion: c.rowVersion,
                        note: 'Mở nhầm',
                      }),
                  );
            const codes = results.map(outcome).sort();
            assert.deepEqual(codes, ['OK', 'RETURN_CLOSED'], `round ${round}: ${codes.join()}`);
            const stored = await caseRow(c.id);
            assert.notEqual(stored.status, 'OPEN');
            assert.equal(stored.rowVersion, c.rowVersion + 1);
            assert.equal(
              stored.events.filter((event) =>
                ['ACCEPTED', 'DECLINED', 'CANCELLED'].includes(event.kind),
              ).length,
              1,
            );
          }
          await audit();
        },
      );

      await suite.test(
        'opening a case while the payment is reversed: no deadlock; a case exists only if it opened first',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const s = await sale(2);
            const results = await race(
              () => open(a, s),
              () =>
                invoices.reversePayment(boss.token, s.invoiceId, s.paymentId, {
                  reason: 'Nhập nhầm',
                }),
            );
            const [opening, reversing] = results.map(outcome);
            const stored = await database.invoice.findUniqueOrThrow({ where: { id: s.invoiceId } });
            const cases = await database.productReturnCase.count({
              where: { invoiceLineId: s.lineId },
            });
            assert.equal(reversing, 'OK', `${opening}/${reversing}`);
            assert.equal(stored.status, 'PENDING_PAYMENT');
            if (opening === 'OK') assert.equal(cases, 1);
            else {
              assert.equal(opening, 'RETURN_NOT_ELIGIBLE');
              assert.equal(cases, 0);
            }
          }
          await audit();
        },
      );

      await suite.test(
        'a photo against a cancellation: evidence is never added to a closed case',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const s = await sale(2);
            const c = await open(a, s);
            const results = await race(
              async () =>
                returns.uploadPhoto(a.token, c.id, {
                  buffer: await photo(`#${round}0${round}0${round}0`),
                  originalname: 'a.png',
                }),
              () =>
                returns.cancel(b.token, c.id, {
                  expectedRowVersion: c.rowVersion,
                  note: 'Mở nhầm',
                }),
            );
            const [upload, cancel] = results.map(outcome);
            assert.equal(cancel, 'OK', `${upload}/${cancel}`);
            assert.ok(['OK', 'RETURN_CLOSED'].includes(upload!), upload);
            const stored = await caseRow(c.id);
            assert.equal(stored.status, 'CANCELLED');
            if (upload === 'OK') {
              assert.equal(stored.photos.length, 1);
              assert.ok(stored.photos[0]!.uploadedAt <= stored.closedAt!);
            } else {
              assert.equal(stored.photos.length, 0);
            }
          }
          await audit();
        },
      );

      await suite.test(
        'the Owner removes the only photo while a wrong or damaged product is accepted: accepted only with a present photo',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const s = await sale(2);
            const c = await open(a, s, { reason: 'WRONG_OR_DAMAGED', sealIntact: false });
            const withPhoto = await returns.uploadPhoto(a.token, c.id, {
              buffer: await photo(`#${round}1${round}2${round}3`),
              originalname: 'a.png',
            });
            const photoId = withPhoto.photos[0]!.id;
            const results = await race(
              () =>
                returns.accept(b.token, c.id, {
                  expectedRowVersion: c.rowVersion,
                  outcome: 'EXCHANGE',
                  note: null,
                }),
              () => returns.removePhoto(owner.token, c.id, photoId, { note: 'Khách yêu cầu xóa' }),
            );
            const [accept, removal] = results.map(outcome);
            assert.equal(removal, 'OK', `${accept}/${removal}`);
            const stored = await caseRow(c.id);
            if (accept === 'OK') assert.equal(stored.status, 'ACCEPTED');
            else {
              assert.equal(accept, 'RETURN_PHOTO_REQUIRED');
              assert.equal(stored.status, 'OPEN');
            }
            assert.ok(stored.photos[0]!.removedAt, 'the photo is removed either way');
            await assert.rejects(storage.get(stored.photos[0]!.originalKey));
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
            const cases = (
              await tx.productReturnCase.findMany({
                where: { branchId: ids.branch },
                select: { id: true },
              })
            ).map((row) => row.id);
            await tx.notification.deleteMany({
              where: { OR: [{ branchId: ids.branch }, { recipientUserId: { in: userIds } }] },
            });
            await tx.productReturnEvent.deleteMany({ where: { caseId: { in: cases } } });
            await tx.productReturnPhoto.deleteMany({ where: { caseId: { in: cases } } });
            await tx.productReturnCase.deleteMany({ where: { id: { in: cases } } });
            await tx.outboxEvent.deleteMany({
              where: {
                OR: [
                  { branchId: ids.branch },
                  { aggregateId: { in: [...invoiceRows, ...paymentRows, ...cases] } },
                ],
              },
            });
            await tx.auditEvent.deleteMany({
              where: { OR: [{ branchId: ids.branch }, { actorUserId: { in: userIds } }] },
            });
            await tx.paymentAnomaly.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.paymentAttempt.deleteMany({ where: { paymentId: { in: paymentRows } } });
            await tx.paymentCorrection.deleteMany({ where: { paymentId: { in: paymentRows } } });
            await tx.paymentSideAllocation.deleteMany({
              where: { invoiceId: { in: invoiceRows } },
            });
            await tx.payment.deleteMany({ where: { id: { in: paymentRows } } });
            await tx.stockReservation.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoiceLineAllocation.deleteMany({
              where: { invoiceId: { in: invoiceRows } },
            });
            await tx.invoiceLineProduct.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoice.deleteMany({ where: { id: { in: invoiceRows } } });
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
            await tx.rolePermission.deleteMany({ where: { roleId: ids.role } });
            await tx.role.deleteMany({ where: { id: ids.role } });
            await tx.employeeBranchAssignment.deleteMany({
              where: { employeeUserId: { in: userIds } },
            });
            await tx.employmentClassificationChange.deleteMany({
              where: { employeeUserId: { in: userIds } },
            });
            await tx.employeeProfile.deleteMany({ where: { userId: { in: userIds } } });
            await tx.user.deleteMany({ where: { id: { in: userIds } } });
            await tx.branch.deleteMany({ where: { id: ids.branch } });
          },
          { timeout: 60_000 },
        );
        assert.equal(await database.invoice.count({ where: { branchId: ids.branch } }), 0);
        assert.equal(
          await database.productReturnCase.count({ where: { branchId: ids.branch } }),
          0,
        );
        assert.equal(await database.branch.count({ where: { id: ids.branch } }), 0);
        assert.equal(
          createdOwner === null ||
            (await database.user.count({ where: { id: createdOwner } })) === 0,
          true,
        );
      } finally {
        await database.$disconnect();
        await rm(folder, { recursive: true, force: true });
      }
    }
  },
);
