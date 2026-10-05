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
import type { WebsitePopupInput } from '@lucy-spa/contracts';
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
import type { PrismaService } from '../platform/prisma.service.js';
import { appointForFixture, isAdministrative } from '../testing/organization-fixture.js';
import { MediaService } from './media.service.js';
import { PopupService, PublicWebsiteService } from './popup.service.js';
import { validVnMobile } from '../testing/phone.js';

const png = (shade: number, size = 8) =>
  sharp({
    create: { width: size, height: size, channels: 3, background: { r: shade, g: 90, b: 50 } },
  })
    .png()
    .toBuffer();

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();
/** Far-future windows keep the overlap cases independent of today's date. */
const far = (from: number, to: number) => ({
  startsAt: new Date(Date.UTC(2090, 0, 1) + from * DAY).toISOString(),
  endsAt: new Date(Date.UTC(2090, 0, 1) + to * DAY).toISOString(),
});

const draft = (patch: Partial<WebsitePopupInput> = {}): WebsitePopupInput => ({
  mediaId: null,
  titleVi: 'Khuyến mãi Tết',
  titleEn: null,
  bodyVi: null,
  bodyEn: null,
  ctaLabelVi: null,
  ctaLabelEn: null,
  ctaUrl: null,
  startsAt: at(-1),
  endsAt: at(1),
  isEnabled: false,
  ...patch,
});

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'popup: permission, validation, image rules, one active at a time, public reads; all fixtures roll back',
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
    const root = await mkdtemp(path.join(tmpdir(), 'lucy-popup-it-'));
    const rollback = new Error('Intentional popup integration rollback');
    try {
      await database.$connect();
      const popupCount = await database.websitePopup.count();
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
            const storage = new LocalDiskMediaStorage(root);
            const media = new MediaService(runner, throttle, storage, pino({ level: 'silent' }));
            const popups = new PopupService(runner, throttle);
            const site = new PublicWebsiteService(runner, throttle, storage);
            // A dev database may hold live popups; none of them may influence these cases.
            await tx.websitePopup.updateMany({ data: { isEnabled: false } });
            await syncPermissionCatalog(tx);
            const permissions = new Map(
              (await tx.permission.findMany({ select: { id: true, code: true } })).map((row) => [
                row.code as string,
                row.id,
              ]),
            );
            let sequence = 0;
            const principal = async (kind: 'EMPLOYEE' | 'CUSTOMER') => {
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
                  emailCanonical: `popup-${sequence}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `popup-${sequence}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: kind === 'CUSTOMER' ? new Date() : null,
                  phoneCanonical: validVnMobile(),
                  normalizationVersion: 1,
                  passwordHash: hash,
                  ...(kind === 'EMPLOYEE'
                    ? {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `PU-${sequence}-${run}`,
                            dateOfBirth: new Date('1994-01-01'),
                            address: 'Fixture',
                          },
                        },
                      }
                    : {
                        customerProfile: {
                          create: { dateOfBirth: new Date('1994-01-01'), address: 'Fixture' },
                        },
                      }),
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
                  code: `PU_${run}_${sequence}`,
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
            const fails = (work: Promise<unknown>, code: string, field?: string) =>
              assert.rejects(
                work,
                (error: unknown) =>
                  error instanceof AuthError &&
                  error.code === code &&
                  (field === undefined || error.field === field),
              );
            const audit = (entityId: string, action: string) =>
              tx.auditEvent.findMany({ where: { entityId, action } });
            const read = async (stream: AsyncIterable<Uint8Array>) => {
              const parts: Uint8Array[] = [];
              for await (const part of stream) parts.push(part);
              return Buffer.concat(parts);
            };
            /** A library image; `alt` false leaves it without Vietnamese alt text. */
            const image = async (shade: number, alt = true, size = 8) =>
              (
                await media.upload(
                  editor.session,
                  { buffer: await png(shade, size), originalname: `popup-${shade}.png` },
                  alt ? { altVi: `Ảnh ${shade}`, altEn: `Image ${shade}` } : {},
                )
              ).asset;

            const branch = (
              await tx.branch.create({
                data: { code: `PU-${run}`, name: 'Popup branch' },
                select: { id: true },
              })
            ).id;
            const editor = await actor(['MANAGE_WEBSITE_CONTENT']);
            const nobody = await actor(['VIEW_EMPLOYEES']);
            const branchOnly = await actor(['MANAGE_WEBSITE_CONTENT'], branch);
            const customer = await login(await principal('CUSTOMER'));

            await context.test(
              'MANAGE_WEBSITE_CONTENT is GLOBAL only: nobody else reaches any popup command',
              async () => {
                const id = randomUUID();
                for (const session of [nobody.session, branchOnly.session, customer]) {
                  await fails(popups.list(session), 'FORBIDDEN');
                  await fails(popups.get(session, id), 'FORBIDDEN');
                  await fails(popups.create(session, draft()), 'FORBIDDEN');
                  await fails(
                    popups.update(session, id, { ...draft(), expectedVersion: 1 }),
                    'FORBIDDEN',
                  );
                  await fails(
                    popups.setEnabled(session, id, { expectedVersion: 1, isEnabled: true }),
                    'FORBIDDEN',
                  );
                  await fails(popups.remove(session, id), 'FORBIDDEN');
                }
                await fails(popups.list(undefined), 'AUTHENTICATION_REQUIRED');
                await fails(popups.create(undefined, draft()), 'AUTHENTICATION_REQUIRED');
                assert.equal(
                  await tx.websitePopup.count({ where: { createdByUserId: nobody.id } }),
                  0,
                );
              },
            );

            await context.test(
              'create: text is normalized, status is derived, the audit event records the content',
              async () => {
                const created = await popups.create(
                  editor.session,
                  draft({
                    titleVi: '  Khuyến   mãi  Tết ',
                    bodyVi: ' Giảm 20%  \r\n\r\n\r\n\r\n cho mọi dịch vụ ',
                    ctaLabelVi: 'Đặt lịch',
                    ctaUrl: '/{locale}/account/book',
                  }),
                );
                assert.equal(created.titleVi, 'Khuyến mãi Tết');
                assert.equal(created.titleEn, null);
                assert.equal(created.bodyVi, 'Giảm 20%\n\ncho mọi dịch vụ');
                assert.equal(created.status, 'DRAFT');
                assert.equal(created.rowVersion, 1);
                assert.equal(created.media, null);
                const row = await tx.websitePopup.findUniqueOrThrow({ where: { id: created.id } });
                assert.equal(row.createdByUserId, editor.id);
                assert.equal(row.updatedByUserId, editor.id);
                const [event] = await audit(created.id, 'POPUP_CREATED');
                assert.equal(event?.actorUserId, editor.id);
                assert.equal(event?.entityType, 'WebsitePopup');
                assert.equal((event?.after as { titleVi: string }).titleVi, 'Khuyến mãi Tết');
                const list = await popups.list(editor.session);
                assert.ok(list.items.some((item) => item.id === created.id));
                assert.ok(!Number.isNaN(Date.parse(list.now)));
                assert.equal((await popups.get(editor.session, created.id)).id, created.id);
                await fails(popups.get(editor.session, randomUUID()), 'NOT_FOUND');
                await fails(popups.get(editor.session, 'not-a-uuid'), 'NOT_FOUND');
              },
            );

            await context.test(
              'validation: link rule, link+label pairing, window, content, lengths, zone-less times',
              async () => {
                const bad: [Partial<WebsitePopupInput>, string][] = [
                  [{ titleVi: null, titleEn: null }, 'title'],
                  [{ titleVi: '   ', titleEn: '' }, 'title'],
                  [{ titleVi: 'x'.repeat(121) }, 'titleVi'],
                  [{ bodyVi: 'x'.repeat(301) }, 'bodyVi'],
                  [{ ctaLabelVi: 'L', ctaLabelEn: null, ctaUrl: null }, 'ctaUrl'],
                  [{ ctaLabelVi: null, ctaUrl: '/vi/book' }, 'ctaLabel'],
                  [{ ctaLabelVi: 'Go', ctaUrl: 'javascript:alert(1)' }, 'ctaUrl'],
                  [{ ctaLabelVi: 'Go', ctaUrl: 'data:text/html,hi' }, 'ctaUrl'],
                  [{ ctaLabelVi: 'Go', ctaUrl: 'http://example.com' }, 'ctaUrl'],
                  [{ ctaLabelVi: 'Go', ctaUrl: '//evil.example/x' }, 'ctaUrl'],
                  [{ ctaLabelVi: 'Go', ctaUrl: '/vimeo' }, 'ctaUrl'],
                  [{ ctaLabelVi: 'Go', ctaUrl: '/vi/a b' }, 'ctaUrl'],
                  [{ ctaLabelVi: 'Go', ctaUrl: 'https://user:pw@example.com/' }, 'ctaUrl'],
                  [{ startsAt: at(1), endsAt: at(1) }, 'endsAt'],
                  [{ startsAt: at(2), endsAt: at(1) }, 'endsAt'],
                  [{ startsAt: '2090-01-01T10:00:00' }, 'startsAt'],
                  [{ endsAt: 'tomorrow' }, 'endsAt'],
                  [{ mediaId: 'nope' }, 'mediaId'],
                  [{ mediaId: randomUUID() }, 'mediaId'],
                ];
                for (const [patch, field] of bad) {
                  await fails(
                    popups.create(editor.session, draft(patch)),
                    'VALIDATION_FAILED',
                    field,
                  );
                }
                for (const ctaUrl of [
                  '/vi',
                  '/en/account/book?x=1',
                  '/{locale}/account/book',
                  'https://example.com/promo?utm=1',
                ]) {
                  const ok = await popups.create(
                    editor.session,
                    draft({ ctaLabelVi: 'Go', ctaUrl, ...far(0, 1) }),
                  );
                  assert.equal(ok.ctaUrl, ctaUrl);
                }
                // The database refuses the same shapes even if the API were bypassed.
                await assert.rejects(
                  isolated(
                    () =>
                      tx.$executeRaw`INSERT INTO website_popups (title_vi, cta_label_vi, cta_url, starts_at, ends_at, created_by_user_id, updated_by_user_id)
                      VALUES ('x', 'y', 'javascript:alert(1)', now(), now() + interval '1 day', ${editor.id}::uuid, ${editor.id}::uuid)`,
                  ),
                );
              },
            );

            await context.test(
              'image: needs Vietnamese alt text, shows in "used in", blocks delete and alt removal',
              async () => {
                const noAlt = await image(31, false);
                await fails(
                  popups.create(editor.session, draft({ mediaId: noAlt.id })),
                  'MEDIA_ALT_REQUIRED',
                  'mediaId',
                );
                const pic = await image(32);
                const created = await popups.create(
                  editor.session,
                  draft({ mediaId: pic.id, titleVi: null, ...far(10, 11) }),
                );
                assert.equal(created.mediaId, pic.id);
                assert.deepEqual(created.media, {
                  id: pic.id,
                  filename: 'popup-32.png',
                  width: 8,
                  height: 8,
                  altVi: 'Ảnh 32',
                  altEn: 'Image 32',
                });

                const detail = await media.get(editor.session, pic.id);
                assert.deepEqual(detail.usedIn, [{ kind: 'POPUP', id: created.id, title: '' }]);

                const files = await tx.mediaVariant.count({ where: { assetId: pic.id } });
                await fails(media.remove(editor.session, pic.id), 'MEDIA_IN_USE');
                assert.equal(await tx.mediaAsset.count({ where: { id: pic.id } }), 1);
                assert.equal(await tx.mediaVariant.count({ where: { assetId: pic.id } }), files);
                // The key itself refuses the delete as the last line of defence.
                await assert.rejects(
                  isolated(() => tx.mediaAsset.delete({ where: { id: pic.id } })),
                );

                await fails(
                  media.updateAlt(editor.session, pic.id, {
                    expectedVersion: detail.rowVersion,
                    altVi: null,
                    altEn: 'Image 32',
                  }),
                  'MEDIA_ALT_REQUIRED',
                  'altVi',
                );
                const edited = await media.updateAlt(editor.session, pic.id, {
                  expectedVersion: detail.rowVersion,
                  altVi: 'Ảnh mới',
                  altEn: null,
                });
                assert.equal(edited.altVi, 'Ảnh mới');

                await popups.remove(editor.session, created.id);
                assert.deepEqual((await media.get(editor.session, pic.id)).usedIn, []);
                await media.remove(editor.session, pic.id);
                assert.equal(await tx.mediaAsset.count({ where: { id: pic.id } }), 0);
              },
            );

            await context.test(
              'one active at a time: an overlapping enabled save names the other popup',
              async () => {
                const a = await popups.create(
                  editor.session,
                  draft({ titleVi: 'A', isEnabled: true, ...far(100, 110) }),
                );
                assert.equal(a.status, 'SCHEDULED');
                const b = draft({ titleVi: 'B', ...far(103, 108) });
                // A disabled popup may overlap.
                const disabled = await popups.create(editor.session, b);
                // An enabled one may not, in either direction, nor when contained or containing.
                for (const window of [far(105, 115), far(100, 110), far(102, 104), far(90, 120)]) {
                  await fails(
                    popups.create(editor.session, draft({ isEnabled: true, ...window })),
                    'POPUP_OVERLAP',
                    a.id,
                  );
                }
                await fails(
                  popups.setEnabled(editor.session, disabled.id, {
                    expectedVersion: disabled.rowVersion,
                    isEnabled: true,
                  }),
                  'POPUP_OVERLAP',
                  a.id,
                );
                await fails(
                  popups.update(editor.session, disabled.id, {
                    ...b,
                    isEnabled: true,
                    expectedVersion: disabled.rowVersion,
                  }),
                  'POPUP_OVERLAP',
                  a.id,
                );
                // The refused saves changed nothing.
                const unchanged = await popups.get(editor.session, disabled.id);
                assert.equal(unchanged.isEnabled, false);
                assert.equal(unchanged.rowVersion, disabled.rowVersion);
                // Windows that only touch are fine; so is a popup next to itself.
                const next = await popups.create(
                  editor.session,
                  draft({ titleVi: 'C', isEnabled: true, ...far(110, 120) }),
                );
                const before = await popups.create(
                  editor.session,
                  draft({ titleVi: 'D', isEnabled: true, ...far(90, 100) }),
                );
                assert.equal(next.status, 'SCHEDULED');
                assert.equal(before.status, 'SCHEDULED');
                const resaved = await popups.update(editor.session, a.id, {
                  ...draft({ titleVi: 'A renamed', isEnabled: true, ...far(100, 110) }),
                  expectedVersion: a.rowVersion,
                });
                assert.equal(resaved.titleVi, 'A renamed');
                // Stretching an enabled popup over another enabled one is refused too.
                await fails(
                  popups.update(editor.session, a.id, {
                    ...draft({ isEnabled: true, ...far(100, 115) }),
                    expectedVersion: resaved.rowVersion,
                  }),
                  'POPUP_OVERLAP',
                  next.id,
                );
                // Freeing the slot lets the overlapping popup go live.
                const off = await popups.setEnabled(editor.session, a.id, {
                  expectedVersion: resaved.rowVersion,
                  isEnabled: false,
                });
                assert.equal(off.status, 'DRAFT');
                const on = await popups.setEnabled(editor.session, disabled.id, {
                  expectedVersion: disabled.rowVersion,
                  isEnabled: true,
                });
                assert.equal(on.status, 'SCHEDULED');
                assert.equal(on.rowVersion, disabled.rowVersion + 1);
                assert.equal((await audit(disabled.id, 'POPUP_ENABLED')).length, 1);
                assert.equal((await audit(a.id, 'POPUP_DISABLED')).length, 1);
                const [updated] = await audit(a.id, 'POPUP_UPDATED');
                assert.equal((updated?.before as { titleVi: string }).titleVi, 'A');
                assert.equal((updated?.after as { titleVi: string }).titleVi, 'A renamed');
              },
            );

            await context.test(
              'versions: a stale save is a conflict and changes nothing; a repeated toggle is a no-op',
              async () => {
                const popup = await popups.create(
                  editor.session,
                  draft({ titleVi: 'V', ...far(200, 201) }),
                );
                const saved = await popups.update(editor.session, popup.id, {
                  ...draft({ titleVi: 'V2', ...far(200, 201) }),
                  expectedVersion: popup.rowVersion,
                });
                assert.equal(saved.rowVersion, 2);
                await fails(
                  popups.update(editor.session, popup.id, {
                    ...draft({ titleVi: 'stale', ...far(200, 201) }),
                    expectedVersion: popup.rowVersion,
                  }),
                  'CONFLICT',
                );
                await fails(
                  popups.setEnabled(editor.session, popup.id, {
                    expectedVersion: 1,
                    isEnabled: true,
                  }),
                  'CONFLICT',
                );
                assert.equal((await popups.get(editor.session, popup.id)).titleVi, 'V2');
                const same = await popups.setEnabled(editor.session, popup.id, {
                  expectedVersion: 2,
                  isEnabled: false,
                });
                assert.equal(same.rowVersion, 2, 'no change, no new version');
                await fails(
                  popups.update(editor.session, randomUUID(), {
                    ...draft(),
                    expectedVersion: 1,
                  }),
                  'NOT_FOUND',
                );
                await fails(
                  popups.update(editor.session, popup.id, {
                    ...draft(),
                    expectedVersion: 0,
                  }),
                  'VALIDATION_FAILED',
                  'expectedVersion',
                );
              },
            );

            await context.test(
              'public: only the live popup, in the visitor language with fallback; drafts, scheduled and ended never',
              async () => {
                assert.equal(await site.popup('vi'), null, 'nothing is live yet');
                const pic = await image(41, true, 2000);
                const live = await popups.create(
                  editor.session,
                  draft({
                    mediaId: pic.id,
                    titleVi: 'Chào mừng',
                    titleEn: null,
                    bodyVi: 'Nội dung',
                    bodyEn: 'Body',
                    ctaLabelVi: 'Đặt lịch',
                    ctaLabelEn: null,
                    ctaUrl: '/{locale}/account/book',
                    isEnabled: true,
                    startsAt: at(-1),
                    endsAt: at(1),
                  }),
                );
                assert.equal(live.status, 'ACTIVE');
                const vi = await site.popup('vi');
                assert.deepEqual(
                  { ...vi, image: undefined },
                  {
                    id: live.id,
                    rowVersion: 1,
                    title: 'Chào mừng',
                    body: 'Nội dung',
                    ctaLabel: 'Đặt lịch',
                    ctaUrl: '/vi/account/book',
                    image: undefined,
                  },
                );
                assert.equal(vi?.image?.alt, 'Ảnh 41');
                assert.equal(vi?.image?.width, 2000);
                assert.deepEqual(
                  vi?.image?.sources,
                  [
                    { url: `/api/v1/public/media/${pic.id}/md`, width: 960 },
                    { url: `/api/v1/public/media/${pic.id}/lg`, width: 1920 },
                  ],
                  'public URLs only, never the admin route',
                );
                const en = await site.popup('en');
                assert.equal(en?.title, 'Chào mừng', 'falls back to the other language');
                assert.equal(en?.body, 'Body');
                assert.equal(en?.ctaLabel, 'Đặt lịch');
                assert.equal(en?.ctaUrl, '/en/account/book');
                assert.equal(en?.image?.alt, 'Image 41');

                // An edit is a new version (the "seen" key changes, so the popup shows again).
                const edited = await popups.update(editor.session, live.id, {
                  ...draft({
                    mediaId: pic.id,
                    titleVi: 'Chào mừng 2',
                    isEnabled: true,
                    startsAt: at(-1),
                    endsAt: at(1),
                  }),
                  expectedVersion: live.rowVersion,
                });
                const after = await site.popup('vi');
                assert.equal(after?.rowVersion, edited.rowVersion);
                assert.equal(after?.ctaUrl, null, 'no label and link left on the popup');
                assert.equal(after?.ctaLabel, null);

                // Not live: disabled, not started yet, already ended.
                for (const patch of [
                  { isEnabled: false },
                  { isEnabled: true, startsAt: at(1), endsAt: at(2) },
                  { isEnabled: true, startsAt: at(-3), endsAt: at(-2) },
                ]) {
                  const current = await popups.get(editor.session, live.id);
                  await popups.update(editor.session, live.id, {
                    ...draft({
                      mediaId: pic.id,
                      titleVi: 'x',
                      startsAt: current.startsAt,
                      endsAt: current.endsAt,
                      ...patch,
                    }),
                    expectedVersion: current.rowVersion,
                  });
                  assert.equal(await site.popup('vi'), null);
                  assert.equal(await site.popup('en'), null);
                }
              },
            );

            await context.test(
              'public images: served only while an enabled, in-window popup uses them',
              async () => {
                const pic = await image(51);
                const other = await image(52);
                const popup = await popups.create(
                  editor.session,
                  draft({ mediaId: pic.id, isEnabled: false, startsAt: at(-1), endsAt: at(1) }),
                );
                const refused = async (id: string) => {
                  for (const kind of ['THUMB', 'MD', 'LG'] as const) {
                    await fails(site.variant(id, kind), 'NOT_FOUND');
                  }
                };
                await refused(pic.id);
                await refused(other.id);
                await fails(site.variant('not-a-uuid', 'MD'), 'NOT_FOUND');
                await fails(site.variant(randomUUID(), 'MD'), 'NOT_FOUND');

                const live = await popups.setEnabled(editor.session, popup.id, {
                  expectedVersion: popup.rowVersion,
                  isEnabled: true,
                });
                for (const kind of ['THUMB', 'MD', 'LG'] as const) {
                  const served = await site.variant(pic.id, kind);
                  const bytes = await read(served.stream);
                  assert.equal(bytes.length, served.bytes);
                  assert.equal((await sharp(bytes).metadata()).format, 'webp');
                  assert.match(served.etag, new RegExp(`^"[0-9a-f]{32}-${kind.toLowerCase()}"$`));
                }
                await refused(other.id);

                // Scheduled for later: still not public.
                const later = await popups.update(editor.session, popup.id, {
                  ...draft({
                    mediaId: pic.id,
                    isEnabled: true,
                    startsAt: at(1),
                    endsAt: at(2),
                  }),
                  expectedVersion: live.rowVersion,
                });
                await refused(pic.id);
                await popups.setEnabled(editor.session, popup.id, {
                  expectedVersion: later.rowVersion,
                  isEnabled: false,
                });
                await refused(pic.id);
              },
            );

            await context.test(
              'delete: a live popup can be deleted at any time; the audit event keeps it',
              async () => {
                const popup = await popups.create(
                  editor.session,
                  draft({ titleVi: 'Gone', isEnabled: true, startsAt: at(-1), endsAt: at(1) }),
                );
                assert.equal(popup.status, 'ACTIVE');
                await fails(popups.remove(nobody.session, popup.id), 'FORBIDDEN');
                await popups.remove(editor.session, popup.id);
                assert.equal(await tx.websitePopup.count({ where: { id: popup.id } }), 0);
                assert.equal(await site.popup('vi'), null);
                const [event] = await audit(popup.id, 'POPUP_DELETED');
                assert.equal(event?.actorUserId, editor.id);
                assert.equal((event?.before as { titleVi: string }).titleVi, 'Gone');
                await fails(popups.remove(editor.session, popup.id), 'NOT_FOUND');
              },
            );

            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            throw rollback;
          },
          { timeout: 180_000 },
        ),
        (error: unknown) => error === rollback,
      );
      assert.equal(await database.websitePopup.count(), popupCount);
      assert.equal(await database.mediaAsset.count(), assetCount);
      assert.equal(await database.user.count({ where: { id: { in: userIds } } }), 0);
    } finally {
      await database.$disconnect();
      await rm(root, { recursive: true, force: true });
    }
  },
);
