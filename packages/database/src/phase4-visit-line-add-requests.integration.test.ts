import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient } from './index.js';

const environmentPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(environmentPath)) loadEnvFile(environmentPath);
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests.');

// Phase 4 Step 3: the append-only replay table (all fixtures roll back).
test('visit_line_add_requests is unique per actor key, restrictive and append-only', async () => {
  const database = createDatabaseClient(databaseUrl);
  const rollback = new Error('Intentional visit line add request rollback');
  const run = randomUUID().replaceAll('-', '').slice(0, 8).toLowerCase();
  try {
    await assert.rejects(
      database.$transaction(
        async (tx) => {
          let savepoints = 0;
          const rejects = async (work: () => Promise<unknown>, pattern: RegExp) => {
            const name = `sp_${++savepoints}`;
            await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
            try {
              await work();
            } catch (error) {
              await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
              assert.match(String((error as Error).message), pattern);
              return;
            }
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
            assert.fail(`Expected rejection matching ${String(pattern)}`);
          };
          const user = await tx.user.create({
            data: {
              kind: 'CUSTOMER',
              status: 'ACTIVE',
              fullName: 'Add request fixture',
              preferredLocale: 'vi',
              emailCanonical: `ar-${run}@example.com`,
              emailDelivery: `ar-${run}@example.com`,
              emailVerifiedAt: new Date(),
              normalizationVersion: 1,
              passwordHash: '$argon2id$fixture',
              phoneCanonical: `+84918${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`,
              customerProfile: {
                create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
              },
            },
          });
          const branch = await tx.branch.create({
            data: { code: `AR-${run}`, name: 'AR', timezone: 'UTC' },
          });
          const category = await tx.serviceCategory.create({
            data: { code: `AR_${run.toUpperCase()}`, nameVi: 'x', nameEn: 'x' },
          });
          const service = await tx.service.create({
            data: {
              code: `AR_${run.toUpperCase()}`,
              categoryId: category.id,
              nameVi: 'x',
              nameEn: 'x',
              priceVnd: 1n,
              priceMaxVnd: 1n,
              durationMinutes: 10,
              estimatedMinMinutes: 10,
              estimatedMaxMinutes: 10,
            },
          });
          const visit = await tx.visit.create({
            data: {
              code: `AR-${run.toUpperCase()}`,
              branchId: branch.id,
              origin: 'WALK_IN',
              serviceDate: new Date(new Date().toISOString().slice(0, 10)),
              arrivedAt: new Date(),
              createdByUserId: user.id,
            },
          });
          const participant = await tx.visitParticipant.create({
            data: { visitId: visit.id, kind: 'GUEST', displayName: 'Guest' },
          });
          const line = async (sequence: number) =>
            tx.visitServiceLine.create({
              data: {
                visitId: visit.id,
                participantId: participant.id,
                sequence,
                serviceId: service.id,
                status: 'WAITING',
                assignmentMode: 'ANY',
                durationMinutes: 10,
                serviceCode: service.code,
                serviceNameVi: 'x',
                serviceNameEn: 'x',
                catalogPriceMinVnd: 1n,
                catalogPriceMaxVnd: 1n,
                catalogPricingUnit: 'PER_SERVICE',
                addedOnBehalf: true,
                addedByUserId: user.id,
                addedAt: new Date(),
              },
            });
          const first = await line(1);
          const second = await line(2);
          const key = randomUUID();
          const created = await tx.visitLineAddRequest.create({
            data: { actorUserId: user.id, idempotencyKey: key, visitServiceLineId: first.id },
          });
          // One outcome per (actor, key) and one key per line.
          await rejects(
            () =>
              tx.visitLineAddRequest.create({
                data: { actorUserId: user.id, idempotencyKey: key, visitServiceLineId: second.id },
              }),
            /visit_line_add_requests_actor_key|Unique constraint/,
          );
          await rejects(
            () =>
              tx.visitLineAddRequest.create({
                data: {
                  actorUserId: user.id,
                  idempotencyKey: randomUUID(),
                  visitServiceLineId: first.id,
                },
              }),
            /visit_line_add_requests_line_key|Unique constraint/,
          );
          // Restrictive references: the line and the actor cannot disappear from under a stored key.
          await rejects(
            () => tx.$executeRaw`DELETE FROM visit_service_lines WHERE id = ${first.id}::uuid`,
            /never deleted|foreign key|violates/i,
          );
          // Permanent history: no update, delete or truncate.
          await rejects(
            () =>
              tx.$executeRaw`UPDATE visit_line_add_requests SET idempotency_key = gen_random_uuid() WHERE id = ${created.id}::uuid`,
            /append-only|permanent|cannot be/i,
          );
          await rejects(
            () =>
              tx.$executeRaw`DELETE FROM visit_line_add_requests WHERE id = ${created.id}::uuid`,
            /append-only|permanent|cannot be/i,
          );
          await rejects(
            () => tx.$executeRawUnsafe('TRUNCATE visit_line_add_requests'),
            /append-only|permanent|cannot be/i,
          );
          assert.equal(await tx.visitLineAddRequest.count({ where: { id: created.id } }), 1);
          throw rollback;
        },
        { timeout: 60_000 },
      ),
      (error: unknown) => error === rollback,
    );
  } finally {
    await database.$disconnect();
  }
});
