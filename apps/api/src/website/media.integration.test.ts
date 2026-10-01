import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createDatabaseClient,
  syncPermissionCatalog,
  type PermissionCode,
  type Prisma,
} from '@lucy-spa/database';
import { LocalDiskMediaStorage, parseApiEnvironment } from '@lucy-spa/server';
import { pino } from 'pino';
import sharp from 'sharp';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { PasswordService } from '../auth/password.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand } from '../authorization/admin-command.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { appointForFixture, isAdministrative } from '../testing/organization-fixture.js';
import { deleteMedia } from './media.core.js';
import { MediaService } from './media.service.js';

const png = (shade: number, size = 4) =>
  sharp({
    create: { width: size, height: size, channels: 3, background: { r: shade, g: 40, b: 50 } },
  })
    .png()
    .toBuffer();

async function countFiles(directory: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    total += entry.isDirectory() ? await countFiles(path.join(directory, entry.name)) : 1;
  }
  return total;
}

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'media library: permission, upload, dedupe, list, alt text, delete, serving; all fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (context) => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl, 'DATABASE_URL required for explicit auth integration tests.');
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
    const userIds: string[] = [];
    const root = await mkdtemp(path.join(tmpdir(), 'lucy-media-it-'));
    const rollback = new Error('Intentional media integration rollback');
    try {
      await database.$connect();
      const existingOwner = await database.user.findFirst({
        where: { kind: 'OWNER' },
        select: { id: true },
      });
      const assetCount = await database.mediaAsset.count();
      const hash = await new PasswordService().hashForSetting('a calm lotus evening 2026');
      await assert.rejects(
        database.$transaction(
          async (tx) => {
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
              withExclusiveTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) =>
                isolated(() => work(tx)),
              resolveForMutation: (token: string) => sessions.resolveForMutation(token, tx),
              resolve: (token: string | undefined) => sessions.resolve(token, tx),
            };
            const throttle = new AuthThrottleService(environment);
            const logger = pino({ level: 'silent' });
            const storage = new LocalDiskMediaStorage(root);
            const media = new MediaService(runner, throttle, storage, logger);
            await syncPermissionCatalog(tx);
            const permissions = new Map(
              (await tx.permission.findMany({ select: { id: true, code: true } })).map((row) => [
                row.code as string,
                row.id,
              ]),
            );
            let sequence = 0;
            const principal = async (kind: 'EMPLOYEE' | 'CUSTOMER' | 'OWNER') => {
              const id = randomUUID();
              userIds.push(id);
              sequence += 1;
              await tx.user.create({
                data: {
                  id,
                  kind,
                  status: 'ACTIVE',
                  fullName: `Fixture ${sequence}`,
                  preferredLocale: 'vi',
                  emailCanonical: `media-${sequence}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `media-${sequence}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: kind === 'CUSTOMER' ? new Date() : null,
                  phoneCanonical:
                    kind === 'OWNER'
                      ? null
                      : `+84918${randomInt(0, 1_000_000).toString().padStart(6, '0')}`,
                  normalizationVersion: 1,
                  passwordHash: hash,
                  ...(kind === 'EMPLOYEE'
                    ? {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `ME-${sequence}-${run}`,
                            dateOfBirth: new Date('1994-01-01'),
                            address: 'Fixture',
                          },
                        },
                      }
                    : {}),
                  ...(kind === 'CUSTOMER'
                    ? {
                        customerProfile: {
                          create: { dateOfBirth: new Date('1994-01-01'), address: 'Fixture' },
                        },
                      }
                    : {}),
                },
                select: { id: true },
              });
              return id;
            };
            const grantRole = async (
              userId: string,
              codes: PermissionCode[],
              branchId?: string,
            ) => {
              sequence += 1;
              const role = await tx.role.create({
                data: {
                  code: `MD_${run}_${sequence}`,
                  displayNameVi: 'Vai trò',
                  displayNameEn: 'Role',
                  permissions: {
                    create: codes.map((code) => ({ permissionId: permissions.get(code)! })),
                  },
                },
                select: { id: true },
              });
              await tx.userRoleAssignment.create({
                data: {
                  userId,
                  roleId: role.id,
                  scopeKind: branchId ? 'BRANCH' : 'GLOBAL',
                  branchId: branchId ?? null,
                },
              });
              if (isAdministrative(codes)) await appointForFixture(tx, userId, branchId);
            };
            const login = async (userId: string) => {
              const user = await tx.user.findUniqueOrThrow({
                where: { id: userId },
                select: { credentialVersion: true, authzVersion: true },
              });
              const anonymous = await sessions.createAnonymous(tx);
              return (
                await sessions.rotateAuthenticated(
                  anonymous.token,
                  {
                    userId,
                    passwordHash: hash,
                    credentialVersion: user.credentialVersion,
                    authzVersion: user.authzVersion,
                  },
                  { reauthenticated: false },
                  tx,
                )
              ).token;
            };
            const actor = async (codes: PermissionCode[], branchScope?: string) => {
              const id = await principal('EMPLOYEE');
              if (codes.length > 0) await grantRole(id, codes, branchScope);
              return { id, session: await login(id) };
            };
            const fails = (work: Promise<unknown>, code: string) =>
              assert.rejects(
                work,
                (error: unknown) => error instanceof AuthError && error.code === code,
              );
            const audit = (entityId: string, action: string) =>
              tx.auditEvent.findMany({ where: { entityId, action } });
            const read = async (stream: AsyncIterable<Uint8Array>) => {
              const parts: Uint8Array[] = [];
              for await (const part of stream) parts.push(part);
              return Buffer.concat(parts);
            };

            const branch = (
              await tx.branch.create({
                data: { code: `MD-${run}`, name: 'Media branch' },
                select: { id: true },
              })
            ).id;
            const editor = await actor(['MANAGE_WEBSITE_CONTENT']);
            const nobody = await actor(['VIEW_EMPLOYEES']);
            const branchOnly = await actor(['MANAGE_WEBSITE_CONTENT'], branch);
            const customer = await login(await principal('CUSTOMER'));
            const filesAtStart = await countFiles(root);

            await context.test(
              'MANAGE_WEBSITE_CONTENT is GLOBAL only: nobody else reaches any command',
              async () => {
                const file = { buffer: await png(1), originalname: 'a.png' };
                for (const session of [nobody.session, branchOnly.session, customer]) {
                  await fails(media.upload(session, file, {}), 'FORBIDDEN');
                  await fails(media.list(session, {}), 'FORBIDDEN');
                }
                await fails(media.upload(undefined, file, {}), 'AUTHENTICATION_REQUIRED');
                await fails(media.get(nobody.session, randomUUID()), 'FORBIDDEN');
                await fails(media.remove(branchOnly.session, randomUUID()), 'FORBIDDEN');
                assert.equal(
                  await countFiles(root),
                  filesAtStart,
                  'a refused upload stores nothing',
                );
                assert.equal(
                  await tx.mediaAsset.count({ where: { createdByUserId: nobody.id } }),
                  0,
                );
              },
            );

            let first: Awaited<ReturnType<typeof media.upload>>;
            await context.test(
              'upload: original and three WebP renditions stored, rows and audit written, opaque keys',
              async () => {
                const bytes = await png(10, 64);
                first = await media.upload(
                  editor.session,
                  { buffer: bytes, originalname: 'C:\\fakepath\\Spa  Hero.PNG' },
                  { altVi: '  Ảnh   spa  ', altEn: '' },
                );
                assert.equal(first.duplicate, false);
                const asset = first.asset;
                assert.equal(asset.originalFilename, 'Spa  Hero.PNG', 'base name only');
                assert.equal(asset.mime, 'image/png');
                assert.equal(asset.bytes, bytes.length);
                assert.deepEqual([asset.width, asset.height], [64, 64]);
                assert.equal(asset.altVi, 'Ảnh spa', 'trimmed, whitespace collapsed');
                assert.equal(asset.altEn, null, 'empty alt becomes null');
                assert.equal(asset.rowVersion, 1);
                assert.deepEqual(asset.usedIn, []);
                const row = await tx.mediaAsset.findUniqueOrThrow({
                  where: { id: asset.id },
                  include: { variants: true },
                });
                assert.equal(row.createdByUserId, editor.id);
                assert.equal(row.variants.length, 3);
                assert.match(row.storageKey, /^\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
                assert.ok(
                  !row.storageKey.includes('Spa'),
                  'a key is never derived from the filename',
                );
                for (const variant of row.variants) {
                  assert.match(
                    variant.storageKey,
                    /^\d{4}\/\d{2}\/[0-9a-f-]{36}-(thumb|md|lg)\.webp$/,
                  );
                  const stored = await read((await storage.get(variant.storageKey)).stream);
                  assert.equal(stored.length, variant.bytes);
                }
                assert.deepEqual(await read((await storage.get(row.storageKey)).stream), bytes);
                assert.equal(await countFiles(root), filesAtStart + 4);
                const [event] = await audit(asset.id, 'MEDIA_UPLOADED');
                assert.equal(event?.actorUserId, editor.id);
                assert.equal(event?.entityType, 'MediaAsset');
                assert.ok(!JSON.stringify(event?.after).includes('Ảnh'), 'no content in the audit');
              },
            );

            await context.test(
              'the same bytes again return the existing image: no new rows, files or audit',
              async () => {
                const before = await countFiles(root);
                const again = await media.upload(
                  editor.session,
                  { buffer: await png(10, 64), originalname: 'other-name.png' },
                  { altVi: 'Khác' },
                );
                assert.equal(again.duplicate, true);
                assert.equal(again.asset.id, first.asset.id);
                assert.equal(again.asset.altVi, 'Ảnh spa', 'the existing alt is kept');
                assert.equal(await countFiles(root), before);
                assert.equal((await audit(first.asset.id, 'MEDIA_UPLOADED')).length, 1);
              },
            );

            await context.test(
              'rejected files leave nothing behind and answer with a typed code',
              async () => {
                const before = { files: await countFiles(root), rows: await tx.mediaAsset.count() };
                const bad: [string, Buffer, string][] = [
                  [
                    'svg',
                    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
                    'MEDIA_TYPE_UNSUPPORTED',
                  ],
                  ['gif', Buffer.from('GIF89a......'), 'MEDIA_TYPE_UNSUPPORTED'],
                  ['truncated', (await png(20, 64)).subarray(0, 40), 'MEDIA_INVALID_IMAGE'],
                  [
                    'too wide',
                    await sharp({
                      create: { width: 6001, height: 1, channels: 3, background: '#fff' },
                    })
                      .png()
                      .toBuffer(),
                    'MEDIA_DIMENSIONS_TOO_LARGE',
                  ],
                  ['too big', Buffer.alloc(10 * 1024 * 1024 + 1, 0xff), 'MEDIA_TOO_LARGE'],
                ];
                for (const [name, buffer, code] of bad) {
                  await assert.rejects(
                    media.upload(editor.session, { buffer, originalname: `${name}.png` }, {}),
                    (error: unknown) => error instanceof AuthError && error.code === code,
                    name,
                  );
                }
                await fails(media.upload(editor.session, undefined, {}), 'VALIDATION_FAILED');
                assert.deepEqual(
                  { files: await countFiles(root), rows: await tx.mediaAsset.count() },
                  before,
                );
              },
            );

            await context.test(
              'a failure after the objects are stored removes them again (no rows, no orphans)',
              async () => {
                const before = { files: await countFiles(root), rows: await tx.mediaAsset.count() };
                // Invalid alt text is only judged when the rows are written, after the files exist.
                await fails(
                  media.upload(
                    editor.session,
                    { buffer: await png(30, 32), originalname: 'late.png' },
                    { altVi: 'x'.repeat(301) },
                  ),
                  'VALIDATION_FAILED',
                );
                // A storage failure on the third object.
                let puts = 0;
                const flaky = new LocalDiskMediaStorage(root);
                const realPut = flaky.put.bind(flaky);
                flaky.put = (key: string, bytes: Uint8Array) => {
                  puts += 1;
                  return puts === 3 ? Promise.reject(new Error('disk full')) : realPut(key, bytes);
                };
                const broken = new MediaService(runner, throttle, flaky, logger);
                await fails(
                  broken.upload(
                    editor.session,
                    { buffer: await png(31, 32), originalname: 'x.png' },
                    {},
                  ),
                  'SERVICE_UNAVAILABLE',
                );
                assert.deepEqual(
                  { files: await countFiles(root), rows: await tx.mediaAsset.count() },
                  before,
                );
              },
            );

            await context.test('list: search, newest first, 24 per page', async () => {
              // A user of its own: 25 uploads stay under the 30-a-minute limit that the editor shares with other tests.
              const bulk = await actor(['MANAGE_WEBSITE_CONTENT']);
              for (let shade = 100; shade < 125; shade += 1) {
                await media.upload(
                  bulk.session,
                  { buffer: await png(shade, 8), originalname: `batch-${shade}.png` },
                  { altVi: shade === 110 ? 'Phòng xông hơi' : null },
                );
              }
              const total = await tx.mediaAsset.count();
              const page1 = await media.list(editor.session, {});
              const page2 = await media.list(editor.session, { page: 2 });
              assert.equal(page1.total, total);
              assert.equal(page1.pageSize, 24);
              assert.equal(page1.items.length, 24);
              assert.equal(page2.items.length, total - 24);
              const seen = new Set([...page1.items, ...page2.items].map((item) => item.id));
              assert.equal(seen.size, total, 'pages never overlap');
              const found = await media.list(editor.session, { search: 'BATCH-117' });
              assert.deepEqual(
                found.items.map((item) => item.originalFilename),
                ['batch-117.png'],
              );
              const byAlt = await media.list(editor.session, { search: 'xông hơi' });
              assert.equal(byAlt.items.length, 1);
              assert.equal(
                (await media.list(editor.session, { search: 'no-such-image' })).total,
                0,
              );
              await fails(media.list(editor.session, { page: 0 }), 'VALIDATION_FAILED');
              await fails(
                media.list(editor.session, { search: 'x'.repeat(101) }),
                'VALIDATION_FAILED',
              );
              // `%` and `_` are plain characters in a search, never wildcards.
              assert.equal((await media.list(editor.session, { search: '%' })).total, 0);
            });

            await context.test('alt text: versioned, plain text, audited', async () => {
              const id = first.asset.id;
              await fails(
                media.updateAlt(editor.session, id, {
                  expectedVersion: 5,
                  altVi: 'x',
                  altEn: null,
                }),
                'CONFLICT',
              );
              const same = await media.updateAlt(editor.session, id, {
                expectedVersion: 1,
                altVi: 'Ảnh spa',
                altEn: null,
              });
              assert.equal(same.rowVersion, 1, 'no change, no new version');
              const changed = await media.updateAlt(editor.session, id, {
                expectedVersion: 1,
                altVi: ' Phòng   trị liệu ',
                altEn: 'Treatment room',
              });
              assert.equal(changed.rowVersion, 2);
              assert.equal(changed.altVi, 'Phòng trị liệu');
              await fails(
                media.updateAlt(editor.session, id, {
                  expectedVersion: 1,
                  altVi: 'stale',
                  altEn: null,
                }),
                'CONFLICT',
              );
              for (const altVi of ['a\u0000b', 'x'.repeat(301), 5 as unknown as string]) {
                await fails(
                  media.updateAlt(editor.session, id, { expectedVersion: 2, altVi, altEn: null }),
                  'VALIDATION_FAILED',
                );
              }
              const cleared = await media.updateAlt(editor.session, id, {
                expectedVersion: 2,
                altVi: '   ',
                altEn: null,
              });
              assert.equal(cleared.altVi, null);
              const events = await audit(id, 'MEDIA_UPDATED');
              assert.equal(events.length, 2);
              assert.deepEqual(events[0]?.before, { altVi: 'Ảnh spa', altEn: null });
              await fails(
                media.updateAlt(nobody.session, id, {
                  expectedVersion: 3,
                  altVi: 'x',
                  altEn: null,
                }),
                'FORBIDDEN',
              );
              await fails(
                media.updateAlt(editor.session, randomUUID(), {
                  expectedVersion: 1,
                  altVi: 'x',
                  altEn: null,
                }),
                'NOT_FOUND',
              );
            });

            await context.test(
              'serving: only a permitted admin, only the three renditions',
              async () => {
                const id = first.asset.id;
                const thumb = await media.variant(editor.session, id, 'THUMB');
                const bytes = await read(thumb.stream);
                assert.equal(bytes.length, thumb.bytes);
                assert.equal((await sharp(bytes).metadata()).format, 'webp');
                assert.match(thumb.etag, /^"[0-9a-f]{32}-thumb"$/);
                assert.notEqual((await media.variant(editor.session, id, 'LG')).etag, thumb.etag);
                await fails(media.variant(nobody.session, id, 'THUMB'), 'FORBIDDEN');
                await fails(media.variant(branchOnly.session, id, 'THUMB'), 'FORBIDDEN');
                await fails(media.variant(customer, id, 'THUMB'), 'FORBIDDEN');
                await fails(media.variant(undefined, id, 'THUMB'), 'AUTHENTICATION_REQUIRED');
                await fails(media.variant('not-a-session', id, 'THUMB'), 'AUTHENTICATION_REQUIRED');
                await fails(media.variant(editor.session, randomUUID(), 'THUMB'), 'NOT_FOUND');
                await fails(media.variant(editor.session, 'not-a-uuid', 'THUMB'), 'NOT_FOUND');
              },
            );

            await context.test(
              'upload attempts are rate limited per user (30 a minute)',
              async () => {
                const limited = await actor(['MANAGE_WEBSITE_CONTENT']);
                const file = { buffer: await png(10, 64), originalname: 'dup.png' };
                for (let attempt = 0; attempt < 30; attempt += 1) {
                  assert.equal((await media.upload(limited.session, file, {})).duplicate, true);
                }
                await fails(media.upload(limited.session, file, {}), 'RATE_LIMITED');
                // Another user is not affected.
                assert.equal((await media.upload(editor.session, file, {})).duplicate, true);
              },
            );

            await context.test(
              'delete: refused while referenced; otherwise rows and every file go, audited',
              async () => {
                const doomed = await media.upload(
                  editor.session,
                  { buffer: await png(200, 16), originalname: 'doomed.png' },
                  {},
                );
                const keys = (
                  await tx.mediaAsset.findUniqueOrThrow({
                    where: { id: doomed.asset.id },
                    include: { variants: true },
                  })
                ).variants.map((variant) => variant.storageKey);
                // Steps 12 and 13 add the popup and slider lookups; the protection is exercised with a stand-in.
                await fails(
                  runAdminCommand(
                    { sessions: runner, throttle },
                    editor.session,
                    { exclusive: false },
                    (ctx) =>
                      deleteMedia(ctx, doomed.asset.id, async () => [
                        { kind: 'POPUP', id: randomUUID(), title: 'Tet' },
                      ]),
                  ),
                  'MEDIA_IN_USE',
                );
                assert.equal(await tx.mediaAsset.count({ where: { id: doomed.asset.id } }), 1);
                const before = await countFiles(root);

                await fails(media.remove(nobody.session, doomed.asset.id), 'FORBIDDEN');
                await media.remove(editor.session, doomed.asset.id);
                assert.equal(await tx.mediaAsset.count({ where: { id: doomed.asset.id } }), 0);
                assert.equal(
                  await tx.mediaVariant.count({ where: { assetId: doomed.asset.id } }),
                  0,
                );
                assert.equal(await countFiles(root), before - 4);
                for (const key of keys) await assert.rejects(storage.get(key));
                const [event] = await audit(doomed.asset.id, 'MEDIA_DELETED');
                assert.equal(event?.actorUserId, editor.id);
                await fails(media.remove(editor.session, doomed.asset.id), 'NOT_FOUND');
                await fails(media.get(editor.session, doomed.asset.id), 'NOT_FOUND');
                // The same bytes can be uploaded again as a new asset.
                const reborn = await media.upload(
                  editor.session,
                  { buffer: await png(200, 16), originalname: 'doomed.png' },
                  {},
                );
                assert.equal(reborn.duplicate, false);
                assert.notEqual(reborn.asset.id, doomed.asset.id);
              },
            );

            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            throw rollback;
          },
          { timeout: 180_000 },
        ),
        (error: unknown) => error === rollback,
      );
      assert.equal(await database.mediaAsset.count(), assetCount);
      assert.equal(await database.user.count({ where: { id: { in: userIds } } }), 0);
      assert.equal(
        (await database.user.findFirst({ where: { kind: 'OWNER' }, select: { id: true } }))?.id,
        existingOwner?.id,
        'no Owner created',
      );
    } finally {
      await database.$disconnect();
      await rm(root, { recursive: true, force: true });
    }
  },
);
