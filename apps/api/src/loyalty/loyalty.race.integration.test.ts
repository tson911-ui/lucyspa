import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient } from '@lucy-spa/database';
import { appendLedgerEntry, processLoyaltyEvent } from '@lucy-spa/server';

/**
 * Phase 5 P5-3 ledger races on separate committed PostgreSQL connections (real production functions, no
 * mocks): concurrent deductions never take a balance below 0, a repeated key writes one entry, one entry is
 * corrected once, and two workers never process one event. The fixtures are committed and removed afterwards
 * with replica-role cleanup of permanent history, so the suite runs only on a throw-away validation database
 * (its name must say so) with a loyalty go-live row that it creates itself when none exists.
 */
test(
  'Phase 5 P5-3 loyalty ledger races keep balances, keys and events consistent',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl);
    const databaseName = new URL(databaseUrl).pathname.slice(1);
    if (!/validation|scratch|uxaudit/.test(databaseName)) {
      suite.skip('committed fixtures run only on a throw-away validation database');
      return;
    }
    const database = createDatabaseClient(databaseUrl);
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    const userIds: string[] = [];
    const eventIds: string[] = [];
    let installedGoLive = false;
    let n = 0;
    const customer = async () => {
      const id = randomUUID();
      userIds.push(id);
      await database.user.create({
        data: {
          id,
          kind: 'CUSTOMER',
          status: 'ACTIVE',
          fullName: `Race ${++n}`,
          preferredLocale: 'vi',
          emailCanonical: `l53race-${n}-${run.toLowerCase()}@example.com`,
          emailDelivery: `l53race-${n}-${run.toLowerCase()}@example.com`,
          emailVerifiedAt: new Date(),
          phoneCanonical: `+849${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`,
          normalizationVersion: 1,
          passwordHash: '$argon2id$fixture',
          customerProfile: { create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' } },
        },
      });
      return id;
    };
    const entry = (
      userId: string,
      key: string,
      points: number,
      extra: { correctsEntryId?: string } = {},
    ) =>
      database.$transaction(
        (tx) =>
          appendLedgerEntry(tx, {
            userId,
            wallet: 'SPA',
            kind: extra.correctsEntryId ? 'MANUAL_CORRECTION' : 'MANUAL_ADJUSTMENT',
            points,
            idempotencyKey: key,
            reason: 'Race',
            actorUserId: userId,
            ...extra,
          }),
        { timeout: 30_000, maxWait: 10_000 },
      );
    try {
      if ((await database.loyaltyGoLive.count()) === 0) {
        const owner = await database.user.findFirstOrThrow({
          where: { kind: 'OWNER' },
          select: { id: true },
        });
        await database.loyaltyGoLive.create({ data: { activatedByUserId: owner.id } });
        installedGoLive = true;
      }

      await suite.test('concurrent deductions never take the balance below 0', async () => {
        const id = await customer();
        await entry(id, `RACE:${id}:seed`, 100);
        const results = await Promise.all(
          Array.from({ length: 8 }, (_, i) => entry(id, `RACE:${id}:debit${i}`, -30)),
        );
        const applied = results.reduce((sum, result) => sum + result.applied, 0);
        const shortfall = results.reduce((sum, result) => sum + result.shortfall, 0);
        assert.equal(applied, -100, 'exactly the balance was taken');
        assert.equal(shortfall, 8 * 30 - 100, 'the rest is recorded as shortfall');
        const wallet = await database.loyaltyWalletAccount.findUniqueOrThrow({
          where: { userId_wallet: { userId: id, wallet: 'SPA' } },
        });
        assert.equal(wallet.balancePoints, 0);
        const ledger = await database.loyaltyLedgerEntry.findMany({ where: { userId: id } });
        assert.equal(
          ledger.reduce((sum, row) => sum + row.points, 0),
          0,
          'the balance equals the sum of the ledger',
        );
        assert.equal(ledger.filter((row) => row.shortfallPoints > 0).length >= 4, true);
      });

      await suite.test('one idempotency key writes one entry', async () => {
        const id = await customer();
        const key = `RACE:${id}:same`;
        const results = await Promise.all(Array.from({ length: 6 }, () => entry(id, key, 40)));
        assert.equal(results.filter((result) => result.created).length, 1);
        assert.equal(new Set(results.map((result) => result.entryId)).size, 1);
        assert.equal(await database.loyaltyLedgerEntry.count({ where: { userId: id } }), 1);
        const wallet = await database.loyaltyWalletAccount.findUniqueOrThrow({
          where: { userId_wallet: { userId: id, wallet: 'SPA' } },
        });
        assert.equal(wallet.balancePoints, 40);
      });

      await suite.test('one entry can be corrected only once', async () => {
        const id = await customer();
        const original = await entry(id, `RACE:${id}:orig`, 100);
        const results = await Promise.allSettled([
          entry(id, `RACE:${id}:fix1`, -100, { correctsEntryId: original.entryId }),
          entry(id, `RACE:${id}:fix2`, -100, { correctsEntryId: original.entryId }),
        ]);
        assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
        const rejected = results.find((result) => result.status === 'rejected');
        assert.ok(rejected, 'the second correction of one entry is refused by the unique link');
        const wallet = await database.loyaltyWalletAccount.findUniqueOrThrow({
          where: { userId_wallet: { userId: id, wallet: 'SPA' } },
        });
        assert.equal(wallet.balancePoints, 0);
      });

      await suite.test('two workers never process one event', async () => {
        const event = await database.outboxEvent.create({
          data: {
            aggregateType: 'Invoice',
            aggregateId: randomUUID(),
            eventType: 'INVOICE_REOPENED',
            schemaVersion: 1,
            payload: { invoiceId: randomUUID(), paidSeq: 1 },
          },
        });
        eventIds.push(event.id);
        const outcomes = await Promise.all(
          [1, 2, 3, 4].map(() =>
            database.$transaction((tx) => processLoyaltyEvent(tx, event.id), { timeout: 30_000 }),
          ),
        );
        assert.equal(outcomes.filter((outcome) => outcome === 'NOOP').length, 1);
        assert.equal(outcomes.filter((outcome) => outcome === 'NOT_CLAIMED').length, 3);
        assert.equal(
          await database.outboxConsumption.count({
            where: { eventId: event.id, consumer: 'loyalty' },
          }),
          1,
        );
      });
    } finally {
      try {
        await database.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
            const entryIds = (
              await tx.loyaltyLedgerEntry.findMany({
                where: { userId: { in: userIds } },
                select: { id: true },
              })
            ).map((row) => row.id);
            await tx.outboxConsumption.deleteMany({ where: { eventId: { in: eventIds } } });
            await tx.outboxEvent.deleteMany({
              where: { OR: [{ id: { in: eventIds } }, { aggregateId: { in: entryIds } }] },
            });
            await tx.auditEvent.deleteMany({
              where: {
                OR: [
                  { actorUserId: { in: userIds } },
                  { subjectUserId: { in: userIds } },
                  { entityId: { in: entryIds } },
                ],
              },
            });
            await tx.loyaltyLedgerEntry.deleteMany({ where: { userId: { in: userIds } } });
            await tx.loyaltyWalletAccount.deleteMany({ where: { userId: { in: userIds } } });
            await tx.customerProfile.deleteMany({ where: { userId: { in: userIds } } });
            await tx.user.deleteMany({ where: { id: { in: userIds } } });
            if (installedGoLive) await tx.loyaltyGoLive.deleteMany({});
          },
          { timeout: 60_000 },
        );
      } finally {
        await database.$disconnect();
      }
    }
  },
);
