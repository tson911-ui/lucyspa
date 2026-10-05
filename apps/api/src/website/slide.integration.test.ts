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
import type { WebsiteSlideInput } from '@lucy-spa/contracts';
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
import { SlideService } from './slide.service.js';
import { validVnMobile } from '../testing/phone.js';

const png = (shade: number, size = 8) =>
  sharp({
    create: { width: size, height: size, channels: 3, background: { r: shade, g: 70, b: 50 } },
  })
    .png()
    .toBuffer();

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();
/** Far-future windows keep the limit cases independent of today's date. */
const far = (from: number, to: number) => ({
  startsAt: new Date(Date.UTC(2090, 0, 1) + from * DAY).toISOString(),
  endsAt: new Date(Date.UTC(2090, 0, 1) + to * DAY).toISOString(),
});

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'slider: permission, validation, order, image rules, visible limit, public reads; all fixtures roll back',
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
    const root = await mkdtemp(path.join(tmpdir(), 'lucy-slide-it-'));
    const rollback = new Error('Intentional slider integration rollback');
    try {
      await database.$connect();
      const slideCount = await database.websiteSlide.count();
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
            const slides = new SlideService(runner, throttle);
            const site = new PublicWebsiteService(runner, throttle, storage);
            // A dev database may hold slides; none of them may influence these cases (rolled back with the rest).
            await tx.websiteSlide.deleteMany();
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
                  emailCanonical: `slide-${sequence}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `slide-${sequence}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: kind === 'CUSTOMER' ? new Date() : null,
                  phoneCanonical: validVnMobile(),
                  normalizationVersion: 1,
                  passwordHash: hash,
                  ...(kind === 'EMPLOYEE'
                    ? {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `SL-${sequence}-${run}`,
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
                  code: `SL_${run}_${sequence}`,
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
            /** A library image; `alt` false leaves it without Vietnamese alt text. */
            const image = async (shade: number, alt = true) =>
              (
                await media.upload(
                  editor.session,
                  { buffer: await png(shade), originalname: `slide-${shade}.png` },
                  alt ? { altVi: `Ảnh ${shade}`, altEn: `Image ${shade}` } : {},
                )
              ).asset;

            const branch = (
              await tx.branch.create({
                data: { code: `SL-${run}`, name: 'Slider branch' },
                select: { id: true },
              })
            ).id;
            const editor = await actor(['MANAGE_WEBSITE_CONTENT']);
            const nobody = await actor(['VIEW_EMPLOYEES']);
            const branchOnly = await actor(['MANAGE_WEBSITE_CONTENT'], branch);
            const customer = await login(await principal('CUSTOMER'));
            const pic = await image(11);
            const draft = (patch: Partial<WebsiteSlideInput> = {}): WebsiteSlideInput => ({
              mediaId: pic.id,
              mobileMediaId: null,
              titleVi: 'Khuyến mãi Tết',
              titleEn: null,
              subtitleVi: null,
              subtitleEn: null,
              linkUrl: null,
              linkLabelVi: null,
              linkLabelEn: null,
              altVi: null,
              altEn: null,
              startsAt: null,
              endsAt: null,
              isEnabled: false,
              ...patch,
            });
            const ids = async () => (await slides.list(editor.session)).items.map((s) => s.id);
            const clear = async () => {
              await tx.websiteSlide.deleteMany();
            };

            await context.test(
              'MANAGE_WEBSITE_CONTENT is GLOBAL only: nobody else reaches any slider command',
              async () => {
                const id = randomUUID();
                for (const session of [nobody.session, branchOnly.session, customer]) {
                  await fails(slides.list(session), 'FORBIDDEN');
                  await fails(slides.get(session, id), 'FORBIDDEN');
                  await fails(slides.create(session, draft()), 'FORBIDDEN');
                  await fails(
                    slides.update(session, id, { ...draft(), expectedVersion: 1 }),
                    'FORBIDDEN',
                  );
                  await fails(
                    slides.setEnabled(session, id, { expectedVersion: 1, isEnabled: true }),
                    'FORBIDDEN',
                  );
                  await fails(slides.reorder(session, { orderedIds: [] }), 'FORBIDDEN');
                  await fails(slides.remove(session, id), 'FORBIDDEN');
                }
                await fails(slides.list(undefined), 'AUTHENTICATION_REQUIRED');
                await fails(slides.create(undefined, draft()), 'AUTHENTICATION_REQUIRED');
                assert.equal(
                  await tx.websiteSlide.count({ where: { createdByUserId: nobody.id } }),
                  0,
                );
              },
            );

            await context.test(
              'create: appended at the end, text normalized, status derived, audit records it',
              async () => {
                await clear();
                const first = await slides.create(
                  editor.session,
                  draft({
                    titleVi: '  Khuyến   mãi  Tết ',
                    subtitleVi: ' Giảm 20% ',
                    linkLabelVi: 'Đặt lịch',
                    linkUrl: '/{locale}/account/book',
                  }),
                );
                assert.equal(first.titleVi, 'Khuyến mãi Tết');
                assert.equal(first.titleEn, null);
                assert.equal(first.subtitleVi, 'Giảm 20%');
                assert.equal(first.position, 1);
                assert.equal(first.status, 'HIDDEN');
                assert.equal(first.rowVersion, 1);
                assert.equal(first.media.id, pic.id);
                assert.equal(first.mobileMedia, null);
                const second = await slides.create(editor.session, draft({ titleVi: 'Hai' }));
                const third = await slides.create(
                  editor.session,
                  draft({ titleVi: 'Ba', isEnabled: true }),
                );
                assert.deepEqual([second.position, third.position], [2, 3]);
                assert.equal(third.status, 'VISIBLE', 'enabled with no window is visible now');
                const row = await tx.websiteSlide.findUniqueOrThrow({ where: { id: first.id } });
                assert.equal(row.createdByUserId, editor.id);
                assert.equal(row.sortOrder, 0);
                const [event] = await audit(first.id, 'SLIDE_CREATED');
                assert.equal(event?.actorUserId, editor.id);
                assert.equal(event?.entityType, 'WebsiteSlide');
                assert.equal((event?.after as { titleVi: string }).titleVi, 'Khuyến mãi Tết');
                const list = await slides.list(editor.session);
                assert.deepEqual(
                  list.items.map((item) => item.id),
                  [first.id, second.id, third.id],
                );
                assert.equal(list.maxVisible, 8);
                assert.ok(!Number.isNaN(Date.parse(list.now)));
                assert.equal((await slides.get(editor.session, first.id)).id, first.id);
                await fails(slides.get(editor.session, randomUUID()), 'NOT_FOUND');
                await fails(slides.get(editor.session, 'not-a-uuid'), 'NOT_FOUND');
                // A window in the future makes an enabled slide Scheduled; a past one Ended.
                const later = await slides.create(
                  editor.session,
                  draft({ isEnabled: true, startsAt: at(1), endsAt: at(2) }),
                );
                const gone = await slides.create(
                  editor.session,
                  draft({ isEnabled: true, startsAt: at(-3), endsAt: at(-2) }),
                );
                assert.equal(later.status, 'SCHEDULED');
                assert.equal(gone.status, 'ENDED');
              },
            );

            await context.test(
              'validation: link rule, link+label pairing, window, lengths, images',
              async () => {
                await clear();
                const noAlt = await image(12, false);
                const bad: [Partial<WebsiteSlideInput>, string, string?][] = [
                  [{ mediaId: 'nope' }, 'VALIDATION_FAILED', 'mediaId'],
                  [{ mediaId: randomUUID() }, 'VALIDATION_FAILED', 'mediaId'],
                  [{ mediaId: noAlt.id }, 'MEDIA_ALT_REQUIRED', 'mediaId'],
                  [{ mobileMediaId: noAlt.id }, 'MEDIA_ALT_REQUIRED', 'mediaId'],
                  [{ mobileMediaId: pic.id }, 'VALIDATION_FAILED', 'mobileMediaId'],
                  [{ mobileMediaId: randomUUID() }, 'VALIDATION_FAILED', 'mediaId'],
                  [{ titleVi: 'x'.repeat(121) }, 'VALIDATION_FAILED', 'titleVi'],
                  [{ subtitleVi: 'x'.repeat(201) }, 'VALIDATION_FAILED', 'subtitleVi'],
                  [{ altVi: 'x'.repeat(301) }, 'VALIDATION_FAILED', 'altVi'],
                  [{ linkLabelVi: 'L' }, 'VALIDATION_FAILED', 'linkUrl'],
                  [{ linkUrl: '/vi/book' }, 'VALIDATION_FAILED', 'linkLabel'],
                  [
                    { linkLabelVi: 'Go', linkUrl: 'javascript:alert(1)' },
                    'VALIDATION_FAILED',
                    'linkUrl',
                  ],
                  [
                    { linkLabelVi: 'Go', linkUrl: 'http://example.com' },
                    'VALIDATION_FAILED',
                    'linkUrl',
                  ],
                  [
                    { linkLabelVi: 'Go', linkUrl: '//evil.example/x' },
                    'VALIDATION_FAILED',
                    'linkUrl',
                  ],
                  [{ startsAt: at(2), endsAt: at(1) }, 'VALIDATION_FAILED', 'endsAt'],
                  [{ startsAt: at(1), endsAt: at(1) }, 'VALIDATION_FAILED', 'endsAt'],
                  [{ startsAt: '2090-01-01T10:00:00' }, 'VALIDATION_FAILED', 'startsAt'],
                ];
                for (const [patch, code, field] of bad) {
                  await fails(slides.create(editor.session, draft(patch)), code, field);
                }
                assert.equal(await tx.websiteSlide.count(), 0);
                for (const linkUrl of ['/vi', '/en/account/book?x=1', 'https://example.com/a']) {
                  const ok = await slides.create(
                    editor.session,
                    draft({ linkLabelVi: 'Go', linkUrl }),
                  );
                  assert.equal(ok.linkUrl, linkUrl);
                }
                // Open ends are fine: from now on, until further notice.
                const open = await slides.create(editor.session, draft({ startsAt: at(1) }));
                assert.equal(open.endsAt, null);
                // The database refuses the same shapes even if the API were bypassed.
                await assert.rejects(
                  isolated(
                    () =>
                      tx.$executeRaw`INSERT INTO website_slides (media_id, link_label_vi, link_url, sort_order, created_by_user_id, updated_by_user_id)
                      VALUES (${pic.id}::uuid, 'y', 'javascript:alert(1)', 99, ${editor.id}::uuid, ${editor.id}::uuid)`,
                  ),
                );
              },
            );

            await context.test(
              'update and enable: versioned, the order does not move, audit before/after',
              async () => {
                await clear();
                const a = await slides.create(editor.session, draft({ titleVi: 'A' }));
                const b = await slides.create(editor.session, draft({ titleVi: 'B' }));
                const updated = await slides.update(editor.session, a.id, {
                  ...draft({ titleVi: 'A2', subtitleEn: 'Sub', altVi: 'Mô tả riêng' }),
                  expectedVersion: 1,
                });
                assert.equal(updated.rowVersion, 2);
                assert.equal(updated.position, 1);
                assert.equal(updated.altVi, 'Mô tả riêng');
                await fails(
                  slides.update(editor.session, a.id, { ...draft(), expectedVersion: 1 }),
                  'CONFLICT',
                );
                await fails(
                  slides.update(editor.session, randomUUID(), { ...draft(), expectedVersion: 1 }),
                  'NOT_FOUND',
                );
                const [event] = await audit(a.id, 'SLIDE_UPDATED');
                assert.equal((event?.before as { titleVi: string }).titleVi, 'A');
                assert.equal((event?.after as { titleVi: string }).titleVi, 'A2');
                const shown = await slides.setEnabled(editor.session, b.id, {
                  expectedVersion: 1,
                  isEnabled: true,
                });
                assert.equal(shown.status, 'VISIBLE');
                assert.equal(shown.rowVersion, 2);
                await fails(
                  slides.setEnabled(editor.session, b.id, { expectedVersion: 1, isEnabled: false }),
                  'CONFLICT',
                );
                // Same value: no new version, no audit event.
                const same = await slides.setEnabled(editor.session, b.id, {
                  expectedVersion: 2,
                  isEnabled: true,
                });
                assert.equal(same.rowVersion, 2);
                assert.equal((await audit(b.id, 'SLIDE_ENABLED')).length, 1);
                const hidden = await slides.setEnabled(editor.session, b.id, {
                  expectedVersion: 2,
                  isEnabled: false,
                });
                assert.equal(hidden.status, 'HIDDEN');
                assert.equal((await audit(b.id, 'SLIDE_DISABLED')).length, 1);
                assert.deepEqual(await ids(), [a.id, b.id]);
              },
            );

            await context.test(
              'reorder: one transaction, exact id set, dense positions, audited; stale lists conflict',
              async () => {
                await clear();
                const [a, b, c, d] = [
                  await slides.create(editor.session, draft({ titleVi: 'A' })),
                  await slides.create(editor.session, draft({ titleVi: 'B' })),
                  await slides.create(editor.session, draft({ titleVi: 'C' })),
                  await slides.create(editor.session, draft({ titleVi: 'D' })),
                ] as const;
                const result = await slides.reorder(editor.session, {
                  orderedIds: [c.id, a.id, d.id, b.id],
                });
                assert.deepEqual(
                  result.items.map((item) => [item.id, item.position]),
                  [
                    [c.id, 1],
                    [a.id, 2],
                    [d.id, 3],
                    [b.id, 4],
                  ],
                );
                assert.deepEqual(
                  (await tx.websiteSlide.findMany({ orderBy: { sortOrder: 'asc' } })).map(
                    (row) => row.sortOrder,
                  ),
                  [0, 1, 2, 3],
                );
                const events = await tx.auditEvent.findMany({
                  where: { action: 'SLIDES_REORDERED', actorUserId: editor.id },
                });
                assert.equal(events.length, 1);
                assert.deepEqual((events[0]?.after as { orderedIds: string[] }).orderedIds, [
                  c.id,
                  a.id,
                  d.id,
                  b.id,
                ]);
                // The same order again changes nothing and is not audited.
                await slides.reorder(editor.session, { orderedIds: [c.id, a.id, d.id, b.id] });
                assert.equal(
                  (
                    await tx.auditEvent.findMany({
                      where: { action: 'SLIDES_REORDERED', actorUserId: editor.id },
                    })
                  ).length,
                  1,
                );
                // A slide added or deleted meanwhile, duplicates and strangers are refused whole.
                await fails(
                  slides.reorder(editor.session, { orderedIds: [c.id, a.id, d.id] }),
                  'CONFLICT',
                );
                await fails(
                  slides.reorder(editor.session, {
                    orderedIds: [c.id, a.id, d.id, b.id, randomUUID()],
                  }),
                  'CONFLICT',
                );
                await fails(
                  slides.reorder(editor.session, { orderedIds: [c.id, a.id, d.id, randomUUID()] }),
                  'CONFLICT',
                );
                await fails(
                  slides.reorder(editor.session, { orderedIds: [c.id, c.id, d.id, b.id] }),
                  'VALIDATION_FAILED',
                  'orderedIds',
                );
                await fails(
                  slides.reorder(editor.session, { orderedIds: ['nope'] }),
                  'VALIDATION_FAILED',
                  'orderedIds',
                );
                assert.deepEqual(await ids(), [c.id, a.id, d.id, b.id]);
              },
            );

            await context.test(
              'delete: any time, the order closes up, the audit event keeps it',
              async () => {
                await clear();
                const a = await slides.create(editor.session, draft({ titleVi: 'A' }));
                const b = await slides.create(
                  editor.session,
                  draft({ titleVi: 'Gone', isEnabled: true }),
                );
                const c = await slides.create(editor.session, draft({ titleVi: 'C' }));
                assert.equal(b.status, 'VISIBLE');
                await fails(slides.remove(nobody.session, b.id), 'FORBIDDEN');
                await slides.remove(editor.session, b.id);
                assert.equal(await tx.websiteSlide.count({ where: { id: b.id } }), 0);
                const list = await slides.list(editor.session);
                assert.deepEqual(
                  list.items.map((item) => [item.id, item.position]),
                  [
                    [a.id, 1],
                    [c.id, 2],
                  ],
                );
                const [event] = await audit(b.id, 'SLIDE_DELETED');
                assert.equal(event?.actorUserId, editor.id);
                assert.equal((event?.before as { titleVi: string }).titleVi, 'Gone');
                await fails(slides.remove(editor.session, b.id), 'NOT_FOUND');
                // The next slide goes after the last one, not into the gap.
                const d = await slides.create(editor.session, draft({ titleVi: 'D' }));
                assert.equal(d.position, 3);
              },
            );

            await context.test(
              'images: desktop and phone show in "used in", block delete and alt removal, free up on delete',
              async () => {
                await clear();
                const desktop = await image(21);
                const phone = await image(22);
                const unused = await image(23);
                const slide = await slides.create(
                  editor.session,
                  draft({ mediaId: desktop.id, mobileMediaId: phone.id, titleVi: 'Có ảnh' }),
                );
                assert.equal(slide.mobileMedia?.id, phone.id);
                for (const asset of [desktop, phone]) {
                  const detail = await media.get(editor.session, asset.id);
                  assert.deepEqual(
                    detail.usedIn.map((usage) => [usage.kind, usage.id, usage.title]),
                    [['SLIDE', slide.id, 'Có ảnh']],
                  );
                  await fails(media.remove(editor.session, asset.id), 'MEDIA_IN_USE');
                  await fails(
                    media.updateAlt(editor.session, asset.id, {
                      altVi: null,
                      altEn: null,
                      expectedVersion: detail.rowVersion,
                    }),
                    'MEDIA_ALT_REQUIRED',
                    'altVi',
                  );
                }
                // The key itself refuses too (the last line of defence).
                await assert.rejects(
                  isolated(() => tx.mediaAsset.delete({ where: { id: desktop.id } })),
                );
                await media.remove(editor.session, unused.id);
                // Swapping the phone image frees the old one.
                await slides.update(editor.session, slide.id, {
                  ...draft({ mediaId: desktop.id, mobileMediaId: null, titleVi: 'Có ảnh' }),
                  expectedVersion: 1,
                });
                assert.deepEqual((await media.get(editor.session, phone.id)).usedIn, []);
                await media.remove(editor.session, phone.id);
                await slides.remove(editor.session, slide.id);
                await media.remove(editor.session, desktop.id);
              },
            );

            await context.test(
              'visible limit: at most 8 at once; hidden, touching and ended windows do not count',
              async () => {
                await clear();
                const always: string[] = [];
                for (let n = 0; n < 8; n += 1) {
                  always.push(
                    (
                      await slides.create(
                        editor.session,
                        draft({ titleVi: `S${n}`, isEnabled: true }),
                      )
                    ).id,
                  );
                }
                await fails(
                  slides.create(editor.session, draft({ isEnabled: true })),
                  'SLIDE_LIMIT',
                );
                // A hidden ninth is fine; showing it is not.
                const ninth = await slides.create(editor.session, draft({ titleVi: 'Nine' }));
                await fails(
                  slides.setEnabled(editor.session, ninth.id, {
                    expectedVersion: 1,
                    isEnabled: true,
                  }),
                  'SLIDE_LIMIT',
                );
                await fails(
                  slides.update(editor.session, ninth.id, {
                    ...draft({ isEnabled: true, ...far(0, 1) }),
                    expectedVersion: 1,
                  }),
                  'SLIDE_LIMIT',
                );
                // Already ended: it can never be visible again, so it does not count.
                const ended = await slides.create(
                  editor.session,
                  draft({ isEnabled: true, startsAt: at(-3), endsAt: at(-2) }),
                );
                assert.equal(ended.status, 'ENDED');
                // Hiding one frees a place.
                await slides.setEnabled(editor.session, always[0]!, {
                  expectedVersion: 1,
                  isEnabled: false,
                });
                const shown = await slides.setEnabled(editor.session, ninth.id, {
                  expectedVersion: 1,
                  isEnabled: true,
                });
                assert.equal(shown.status, 'VISIBLE');
                // Editing a full set in place keeps working (the slide's own place is not double counted).
                await slides.update(editor.session, ninth.id, {
                  ...draft({ titleVi: 'Nine!', isEnabled: true }),
                  expectedVersion: shown.rowVersion,
                });

                // Windows: eight that run together, a ninth that only touches them, and one that overlaps by a day.
                await clear();
                for (let n = 0; n < 8; n += 1) {
                  await slides.create(
                    editor.session,
                    draft({ titleVi: `W${n}`, isEnabled: true, ...far(0, 10) }),
                  );
                }
                await slides.create(editor.session, draft({ isEnabled: true, ...far(10, 20) }));
                await fails(
                  slides.create(editor.session, draft({ isEnabled: true, ...far(9, 20) })),
                  'SLIDE_LIMIT',
                );
                await slides.create(editor.session, draft({ isEnabled: true, ...far(-5, 0) }));
                await slides.create(editor.session, draft({ isEnabled: false, ...far(9, 20) }));
              },
            );

            await context.test(
              'public slides: visible ones in order and language, link resolved, alt override, at most 8',
              async () => {
                await clear();
                const phone = await image(41);
                const only = await image(42);
                const a = await slides.create(
                  editor.session,
                  draft({
                    mediaId: only.id,
                    mobileMediaId: phone.id,
                    titleVi: 'Một',
                    titleEn: 'One',
                    subtitleVi: 'Phụ đề',
                    linkLabelVi: 'Đặt lịch',
                    linkLabelEn: 'Book',
                    linkUrl: '/{locale}/account/book',
                    altVi: 'Mô tả của slide',
                    isEnabled: true,
                  }),
                );
                const b = await slides.create(
                  editor.session,
                  draft({ titleEn: 'Only English', titleVi: null, isEnabled: true }),
                );
                await slides.create(editor.session, draft({ titleVi: 'Hidden' }));
                await slides.create(
                  editor.session,
                  draft({ titleVi: 'Later', isEnabled: true, startsAt: at(1), endsAt: at(2) }),
                );
                await slides.create(
                  editor.session,
                  draft({ titleVi: 'Over', isEnabled: true, startsAt: at(-3), endsAt: at(-2) }),
                );
                const vi = await site.slides('vi');
                assert.deepEqual(
                  vi.map((slide) => slide.id),
                  [a.id, b.id],
                );
                assert.equal(vi[0]?.title, 'Một');
                assert.equal(vi[0]?.subtitle, 'Phụ đề');
                assert.equal(vi[0]?.linkLabel, 'Đặt lịch');
                assert.equal(vi[0]?.linkUrl, '/vi/account/book');
                assert.equal(vi[0]?.image.alt, 'Mô tả của slide');
                assert.equal(vi[0]?.mobileImage?.width, 8);
                assert.match(
                  vi[0]?.image.sources[0]?.url ?? '',
                  /^\/api\/v1\/public\/media\/[0-9a-f-]+\/(md|lg)$/,
                );
                assert.equal(vi[1]?.title, 'Only English', 'falls back to the other language');
                assert.equal(
                  vi[1]?.image.alt,
                  'Ảnh 11',
                  'the image own description when the slide has none',
                );
                assert.equal(vi[1]?.mobileImage, null);
                assert.equal(vi[1]?.linkUrl, null);
                const en = await site.slides('en');
                assert.equal(en[0]?.title, 'One');
                assert.equal(en[0]?.linkLabel, 'Book');
                assert.equal(en[0]?.linkUrl, '/en/account/book');
                assert.equal(
                  en[0]?.image.alt,
                  'Mô tả của slide',
                  'the slide description serves both languages',
                );
                // Nothing leaks that is not public: no ids of drafts, no versions, no times.
                assert.deepEqual(Object.keys(vi[0]!).sort(), [
                  'id',
                  'image',
                  'linkLabel',
                  'linkUrl',
                  'mobileImage',
                  'subtitle',
                  'title',
                ]);
                // No visible slide: an empty list, never an error.
                await tx.websiteSlide.updateMany({ data: { isEnabled: false } });
                assert.deepEqual(await site.slides('vi'), []);
              },
            );

            await context.test(
              'public images: served only while a visible slide uses them (desktop or phone)',
              async () => {
                await clear();
                const desktop = await image(51);
                const phone = await image(52);
                const other = await image(53);
                const slide = await slides.create(
                  editor.session,
                  draft({ mediaId: desktop.id, mobileMediaId: phone.id }),
                );
                const refused = async (id: string) => {
                  for (const kind of ['THUMB', 'MD', 'LG'] as const) {
                    await fails(site.variant(id, kind), 'NOT_FOUND');
                  }
                };
                await refused(desktop.id);
                await refused(phone.id);
                const shown = await slides.setEnabled(editor.session, slide.id, {
                  expectedVersion: 1,
                  isEnabled: true,
                });
                for (const id of [desktop.id, phone.id]) {
                  const served = await site.variant(id, 'MD');
                  assert.equal(
                    (await sharp(await streamBytes(served.stream)).metadata()).format,
                    'webp',
                  );
                }
                await refused(other.id);
                // Scheduled for later: not public yet.
                const later = await slides.update(editor.session, slide.id, {
                  ...draft({
                    mediaId: desktop.id,
                    mobileMediaId: phone.id,
                    isEnabled: true,
                    startsAt: at(1),
                    endsAt: at(2),
                  }),
                  expectedVersion: shown.rowVersion,
                });
                await refused(desktop.id);
                await refused(phone.id);
                await slides.setEnabled(editor.session, slide.id, {
                  expectedVersion: later.rowVersion,
                  isEnabled: false,
                });
                await refused(desktop.id);
                // A popup showing the image keeps serving it (the rule is "any live use").
                await popups.create(editor.session, {
                  mediaId: other.id,
                  titleVi: 'P',
                  titleEn: null,
                  bodyVi: null,
                  bodyEn: null,
                  ctaLabelVi: null,
                  ctaLabelEn: null,
                  ctaUrl: null,
                  ...far(0, 1),
                  isEnabled: false,
                });
                await refused(other.id);
              },
            );

            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            throw rollback;
          },
          { timeout: 240_000 },
        ),
        (error: unknown) => error === rollback,
      );
      assert.equal(await database.websiteSlide.count(), slideCount);
      assert.equal(await database.mediaAsset.count(), assetCount);
      assert.equal(await database.user.count({ where: { id: { in: userIds } } }), 0);
    } finally {
      await database.$disconnect();
      await rm(root, { recursive: true, force: true });
    }
  },
);

async function streamBytes(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  for await (const part of stream) parts.push(part);
  return Buffer.concat(parts);
}
