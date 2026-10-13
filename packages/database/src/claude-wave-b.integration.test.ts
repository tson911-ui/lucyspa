import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  appendOutboxEvent,
  createDatabaseClient,
  PERMISSION_CATALOG,
  syncPermissionCatalog,
} from './index.js';

const environmentPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(environmentPath)) loadEnvFile(environmentPath);
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests.');

/**
 * Claude integration Waves B to D database foundation (migrations 129 to 130): the three new permissions (two global, the customer brief
 * branch-capable, all standard, granted to nobody), the per-feature switches of the AI settings (everything off, the chat capped at 300 a
 * day), the callback request table and its rules, and the notification type that tells the inbox holders. All fixtures roll back.
 */
test('Claude integration Waves B-D permissions, switches, callback requests and notice type (all fixtures roll back)', async (context) => {
  const database = createDatabaseClient(databaseUrl);
  const rollback = new Error('Intentional Claude wave B rollback');
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
          const rows = <T>(sql: string, ...params: unknown[]) =>
            tx.$queryRawUnsafe<T[]>(sql, ...params);
          const exec = (sql: string, ...params: unknown[]) => tx.$executeRawUnsafe(sql, ...params);
          await syncPermissionCatalog(tx);

          await context.test(
            'the three permissions have the right scope, are standard and granted to nobody',
            async () => {
              const expected = [
                ['MANAGE_CHAT_REQUESTS', 'GLOBAL_ONLY'],
                ['USE_AI_ASSISTANT', 'GLOBAL_ONLY'],
                ['VIEW_CUSTOMER_BRIEF', 'BRANCH_CAPABLE'],
              ] as const;
              for (const [code, scope] of expected) {
                assert.ok(
                  PERMISSION_CATALOG.some((entry) => entry.code === code),
                  code,
                );
                const stored = await tx.permission.findFirstOrThrow({
                  where: { code },
                  select: { scopeCapability: true, dataClassification: true, id: true },
                });
                assert.equal(stored.scopeCapability, scope, code);
                assert.equal(stored.dataClassification, 'STANDARD', code);
                const granted = await rows<{ n: number }>(
                  `SELECT count(*)::int AS n FROM role_permissions WHERE permission_id = $1::uuid`,
                  stored.id,
                );
                assert.equal(granted[0]!.n, 0, `${code} is granted to nobody`);
              }
              await rejects(
                () =>
                  exec(
                    `UPDATE permissions SET scope_capability = 'BRANCH_CAPABLE' WHERE code = 'MANAGE_CHAT_REQUESTS'`,
                  ),
                /code-owned and immutable|permissions_catalog_semantics/,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE permissions SET scope_capability = 'GLOBAL_ONLY' WHERE code = 'VIEW_CUSTOMER_BRIEF'`,
                  ),
                /code-owned and immutable|permissions_catalog_semantics/,
              );
              // The semantics of the older codes did not move.
              const profit = await rows<{ scope_capability: string }>(
                `SELECT scope_capability::text AS scope_capability FROM permissions WHERE code::text = 'VIEW_PROFIT'`,
              );
              assert.equal(profit[0]!.scope_capability, 'GLOBAL_ONLY');
            },
          );

          await context.test(
            'the switches start off, the chat is capped at 300 a day, and the limits hold',
            async () => {
              const [row] = await rows<Record<string, unknown>>(`SELECT * FROM ai_settings`);
              assert.equal(row!['chat_enabled'], false);
              assert.equal(row!['chat_daily_cap'], 300);
              assert.equal(row!['seo_enabled'], false);
              assert.equal(row!['assistant_enabled'], false);
              assert.equal(row!['brief_enabled'], false);
              assert.equal(row!['seo_model'], 'claude-opus-5-5');
              assert.equal(row!['assistant_model'], 'claude-sonnet-5-5');
              assert.equal(row!['brief_model'], 'claude-sonnet-5-5');
              await rejects(
                () =>
                  exec(
                    `UPDATE ai_settings SET chat_daily_cap = 5001, row_version = row_version + 1`,
                  ),
                /ai_settings_chat_cap/,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE ai_settings SET assistant_model = 'gpt-4', row_version = row_version + 1`,
                  ),
                /ai_settings_models/,
              );
            },
          );

          await context.test('callback requests: their rules and the purge', async () => {
            const insert = (phone: string) =>
              rows<{ id: string }>(
                `INSERT INTO chat_callback_requests (reason, phone) VALUES ('N8N_DOWN', $1) RETURNING id`,
                phone,
              );
            const [first] = await insert('0905123456');
            const [stored] = await rows<{ status: string; locale: string; row_version: number }>(
              `SELECT status, locale, row_version FROM chat_callback_requests WHERE id = $1::uuid`,
              first!.id,
            );
            assert.deepEqual(stored, { status: 'NEW', locale: 'vi', row_version: 1 });
            await rejects(() => insert('123'), /chat_callback_requests_phone/);
            await rejects(
              () =>
                exec(
                  `INSERT INTO chat_callback_requests (reason, phone) VALUES ('SPAM', '0905123456')`,
                ),
              /chat_callback_requests_reason/,
            );
            await rejects(
              () =>
                exec(
                  `INSERT INTO chat_callback_requests (reason, phone, note) VALUES ('VISITOR', '0905123456', repeat('x', 501))`,
                ),
              /chat_callback_requests_note/,
            );
            // A change must advance the row version by one.
            await rejects(
              () =>
                exec(
                  `UPDATE chat_callback_requests SET status = 'CALLED' WHERE id = '${first!.id}'`,
                ),
              /advance the row version/,
            );
            // CLOSED needs a closing time; a handler needs a time and the other way round.
            await rejects(
              () =>
                exec(
                  `UPDATE chat_callback_requests SET status = 'CLOSED', row_version = 2 WHERE id = '${first!.id}'`,
                ),
              /chat_callback_requests_closed/,
            );
            await rejects(
              () =>
                exec(
                  `UPDATE chat_callback_requests SET handled_at = now(), row_version = 2 WHERE id = '${first!.id}'`,
                ),
              /chat_callback_requests_handled/,
            );
            // The purge clears the phone, name and note together and stamps `purged_at`; one without the other is refused.
            await rejects(
              () =>
                exec(
                  `UPDATE chat_callback_requests SET phone = NULL, row_version = 2 WHERE id = '${first!.id}'`,
                ),
              /chat_callback_requests_purge/,
            );
            await exec(
              `UPDATE chat_callback_requests SET status = 'CLOSED', closed_at = now(), phone = NULL, name = NULL, note = NULL,
                      purged_at = now(), row_version = 2 WHERE id = '${first!.id}'`,
            );
            const [purged] = await rows<{ phone: string | null; purged: boolean }>(
              `SELECT phone, purged_at IS NOT NULL AS purged FROM chat_callback_requests WHERE id = $1::uuid`,
              first!.id,
            );
            assert.deepEqual(purged, { phone: null, purged: true });
          });

          await context.test(
            'the notice type is paired with its entity and needs no branch',
            async () => {
              const owner = await tx.user.findFirst({
                where: { kind: 'OWNER' },
                select: { id: true },
              });
              const recipient =
                owner ??
                (await tx.user.create({
                  data: {
                    kind: 'OWNER',
                    status: 'ACTIVE',
                    fullName: 'Chủ spa fixture',
                    preferredLocale: 'vi',
                    emailCanonical: `claude-b-owner-${Date.now()}@example.com`,
                    emailDelivery: `claude-b-owner-${Date.now()}@example.com`,
                    normalizationVersion: 1,
                    passwordHash: '$argon2id$fixture',
                  },
                  select: { id: true },
                }));
              const [request] = await rows<{ id: string }>(
                `INSERT INTO chat_callback_requests (reason, phone) VALUES ('CAP_REACHED', '0905123456') RETURNING id`,
              );
              const event = await appendOutboxEvent(tx, {
                aggregateType: 'ChatCallbackRequest',
                aggregateId: request!.id,
                eventType: 'CHAT_CALLBACK_REQUEST',
                schemaVersion: 1,
                payload: { entityId: request!.id },
              });
              const make = (type: string, entityType: string) =>
                tx.notification.create({
                  data: {
                    recipientUserId: recipient.id,
                    sourceEventId: event.id,
                    branchId: null,
                    type,
                    entityType,
                    entityId: request!.id,
                    contextCode: 'chat',
                    actionAt: event.occurredAt,
                  },
                });
              await make('CHAT_CALLBACK_REQUEST', 'ChatCallbackRequest');
              await rejects(
                () => make('CHAT_CALLBACK_REQUEST', 'SupplierSource'),
                /notifications_type_entity|notifications_/,
              );
              await rejects(
                () => make('SUPPLIER_IMPORT_CHANGES', 'ChatCallbackRequest'),
                /notifications_type_entity|notifications_/,
              );
            },
          );
          throw rollback;
        },
        { timeout: 60_000 },
      ),
      rollback,
    );
  } finally {
    await database.$disconnect();
  }
});
