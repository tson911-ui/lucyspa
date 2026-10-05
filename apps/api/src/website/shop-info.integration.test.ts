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
import type { WebsiteShopInfoInput } from '@lucy-spa/contracts';
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
import { PublicWebsiteService } from './popup.service.js';
import { ShopInfoService } from './shop-info.service.js';
import { validVnMobile } from '../testing/phone.js';

const png = (shade: number) =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: { r: shade, g: 90, b: 50 } } })
    .png()
    .toBuffer();

const input = (patch: Partial<WebsiteShopInfoInput> = {}): WebsiteShopInfoInput => ({
  taglineVi: 'Thư Giãn Tận Tâm – Nâng Tầm Nhan Sắc',
  taglineEn: 'Heartfelt Relaxation – Elevated Beauty',
  introVi: null,
  introEn: null,
  address: '04 Nguyễn Quang Bích, Đà Nẵng',
  hotline: '0934 936 101',
  mapUrl: null,
  hoursBranchId: null,
  heroMediaId: null,
  factsVisible: true,
  facts: [],
  featuredGroups: [],
  whyVisible: false,
  whyTitleVi: null,
  whyTitleEn: null,
  whyCards: [],
  footerBlocks: [],
  ...patch,
});

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'shop info and public catalogue: permission, validation, hours from the branch, hero image rules, hidden services; all fixtures roll back',
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
    const root = await mkdtemp(path.join(tmpdir(), 'lucy-shop-it-'));
    const rollback = new Error('Intentional shop info integration rollback');
    try {
      await database.$connect();
      const before = await database.websiteShopInfo.findUniqueOrThrow({ where: { id: 'shop' } });
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
            const shop = new ShopInfoService(runner, throttle);
            const site = new PublicWebsiteService(runner, throttle, storage);
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
                  emailCanonical: `shop-${sequence}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `shop-${sequence}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: kind === 'CUSTOMER' ? new Date() : null,
                  phoneCanonical: validVnMobile(),
                  normalizationVersion: 1,
                  passwordHash: hash,
                  ...(kind === 'EMPLOYEE'
                    ? {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `SH-${sequence}-${run}`,
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
                  code: `SH_${run}_${sequence}`,
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

            const branch = await tx.branch.create({
              data: { code: `SH-${run}`, name: 'Shop info branch' },
              select: { id: true },
            });
            // Mon-Fri 09:00-21:00, Sat 10:00-20:00, Sun closed.
            await tx.branchOperatingHours.createMany({
              data: [
                ...[1, 2, 3, 4, 5].map((isoWeekday) => ({
                  branchId: branch.id,
                  isoWeekday,
                  isClosed: false,
                  opensAtMinute: 540,
                  closesAtMinute: 1260,
                })),
                {
                  branchId: branch.id,
                  isoWeekday: 6,
                  isClosed: false,
                  opensAtMinute: 600,
                  closesAtMinute: 1200,
                },
                {
                  branchId: branch.id,
                  isoWeekday: 7,
                  isClosed: true,
                  opensAtMinute: null,
                  closesAtMinute: null,
                },
              ],
            });
            const editor = await actor(['MANAGE_WEBSITE_CONTENT']);
            const nobody = await actor(['VIEW_EMPLOYEES']);
            const branchOnly = await actor(['MANAGE_WEBSITE_CONTENT'], branch.id);
            const customer = await login(await principal('CUSTOMER'));

            await context.test(
              'MANAGE_WEBSITE_CONTENT is GLOBAL only: nobody else reads or edits the shop profile',
              async () => {
                for (const session of [nobody.session, branchOnly.session, customer]) {
                  await fails(shop.get(session), 'FORBIDDEN');
                  await fails(
                    shop.update(session, { ...input(), expectedVersion: 1 }),
                    'FORBIDDEN',
                  );
                }
                await fails(shop.get(undefined), 'AUTHENTICATION_REQUIRED');
                await fails(
                  shop.update(undefined, { ...input(), expectedVersion: 1 }),
                  'AUTHENTICATION_REQUIRED',
                );
              },
            );

            await context.test(
              'the seeded profile is public, anonymous and carries the Owner values',
              async () => {
                const vi = await site.site('vi');
                assert.equal(vi.tagline, 'Thư Giãn Tận Tâm – Nâng Tầm Nhan Sắc');
                assert.equal(vi.address, '04 Nguyễn Quang Bích, Đà Nẵng');
                assert.equal(vi.hotline, '0934 936 101');
                assert.equal(vi.hotlineTel, '+84934936101');
                assert.equal(vi.heroImage, null);
                assert.equal(vi.intro, null, 'no introduction set: the site uses its own sentence');
                const en = await site.site('en');
                assert.equal(en.tagline, 'Heartfelt Relaxation – Elevated Beauty');
                const admin = await shop.get(editor.session);
                assert.ok(admin.rowVersion >= 1);
                assert.ok(admin.branches.some((option) => option.id === branch.id));
              },
            );

            await context.test(
              'update: text is normalized, hours come from the chosen branch grouped, the audit event records the change',
              async () => {
                const current = await shop.get(editor.session);
                const saved = await shop.update(editor.session, {
                  ...input({
                    taglineVi: '  Thư   Giãn   Tận Tâm ',
                    hotline: ' +84 934 936 101 ',
                    mapUrl: 'https://maps.example.com/?q=Lucy+Spa',
                    hoursBranchId: branch.id,
                  }),
                  expectedVersion: current.rowVersion,
                });
                assert.equal(saved.rowVersion, current.rowVersion + 1);
                assert.equal(saved.taglineVi, 'Thư Giãn Tận Tâm');
                assert.equal(saved.hotline, '+84 934 936 101');
                assert.equal(saved.hoursBranch?.id, branch.id);
                assert.deepEqual(saved.hours, [
                  { weekdays: [1, 2, 3, 4, 5], closed: false, opensAt: '09:00', closesAt: '21:00' },
                  { weekdays: [6], closed: false, opensAt: '10:00', closesAt: '20:00' },
                  { weekdays: [7], closed: true, opensAt: null, closesAt: null },
                ]);
                assert.equal(saved.timezone, 'Asia/Ho_Chi_Minh');
                const publicSite = await site.site('vi');
                assert.equal(publicSite.hotlineTel, '+84934936101');
                assert.equal(publicSite.mapUrl, 'https://maps.example.com/?q=Lucy+Spa');
                assert.equal(publicSite.hours.length, 3);
                const events = await tx.auditEvent.findMany({
                  where: { action: 'SHOP_INFO_UPDATED', actorUserId: editor.id },
                });
                assert.equal(events.length, 1);
                assert.equal(
                  (events[0]?.after as { hoursBranchId: string }).hoursBranchId,
                  branch.id,
                );
              },
            );

            await context.test(
              'home introduction: optional, per language, never borrowed from the other language, 200 characters at most',
              async () => {
                const current = await shop.get(editor.session);
                const keep = (patch: Partial<WebsiteShopInfoInput>) =>
                  input({
                    taglineVi: current.taglineVi,
                    taglineEn: current.taglineEn,
                    address: current.address,
                    hotline: current.hotline,
                    mapUrl: current.mapUrl,
                    hoursBranchId: current.hoursBranchId,
                    heroMediaId: current.heroMediaId,
                    ...patch,
                  });
                const withIntro = await shop.update(editor.session, {
                  ...keep({ introVi: '  Mở cửa mỗi ngày  ', introEn: null }),
                  expectedVersion: current.rowVersion,
                });
                assert.equal(withIntro.introVi, 'Mở cửa mỗi ngày');
                assert.equal(withIntro.introEn, null);
                assert.equal((await site.site('vi')).intro, 'Mở cửa mỗi ngày');
                assert.equal((await site.site('en')).intro, null);
                await fails(
                  shop.update(editor.session, {
                    ...keep({ introEn: 'x'.repeat(201) }),
                    expectedVersion: withIntro.rowVersion,
                  }),
                  'VALIDATION_FAILED',
                  'introEn',
                );
                const cleared = await shop.update(editor.session, {
                  ...keep({ introVi: '   ' }),
                  expectedVersion: withIntro.rowVersion,
                });
                assert.equal(cleared.introVi, null);
                assert.equal((await site.site('vi')).intro, null);
              },
            );

            await context.test(
              'facts strip, featured groups and the why section: defaults, saved lists, per-language public view, refusals by name',
              async () => {
                const current = await shop.get(editor.session);
                // Defaults: the three built-in facts, every group, no why section (nothing is seeded).
                assert.equal(current.factsVisible, true);
                assert.deepEqual(
                  current.facts.map((fact) => [fact.id, fact.visible]),
                  [
                    ['hours', true],
                    ['address', true],
                    ['hotline', true],
                  ],
                );
                assert.deepEqual(current.featuredGroups, []);
                assert.equal(current.whyVisible, false);
                assert.deepEqual(current.whyCards, []);
                assert.ok(Array.isArray(current.groupOptions));
                const fresh = await site.site('vi');
                assert.deepEqual(
                  fresh.facts.map((fact) => fact.kind),
                  ['HOURS', 'ADDRESS', 'HOTLINE'],
                );
                assert.deepEqual(fresh.featuredGroups, []);
                assert.equal(fresh.why, null);

                const live = await tx.serviceCategory.create({
                  data: {
                    code: `LIST_${run}_A`,
                    nameVi: 'Nhóm A',
                    nameEn: 'Group A',
                    sortOrder: 0,
                  },
                  select: { code: true },
                });
                const off = await tx.serviceCategory.create({
                  data: {
                    code: `LIST_${run}_B`,
                    nameVi: 'Nhóm B',
                    nameEn: 'Group B',
                    sortOrder: 0,
                    isActive: false,
                  },
                  select: { code: true },
                });
                const keep = (patch: Partial<WebsiteShopInfoInput>) =>
                  input({
                    taglineVi: current.taglineVi,
                    taglineEn: current.taglineEn,
                    address: current.address,
                    hotline: current.hotline,
                    mapUrl: current.mapUrl,
                    hoursBranchId: current.hoursBranchId,
                    heroMediaId: current.heroMediaId,
                    ...patch,
                  });
                const factId = '8f6f2a4e-5b0c-4a53-9f4e-2f9a4a1c7d10';
                const cardId = '3b1d6c0a-7a5e-4e55-8a0b-0c4b0b6b9a11';
                const builtIn = (
                  id: string,
                  kind: 'HOURS' | 'ADDRESS' | 'HOTLINE',
                  visible = true,
                ) => ({
                  id,
                  kind,
                  visible,
                  icon: null,
                  textVi: null,
                  textEn: null,
                });
                const saved = await shop.update(editor.session, {
                  ...keep({
                    facts: [
                      { ...builtIn('hotline', 'HOTLINE') },
                      {
                        id: factId,
                        kind: 'CUSTOM',
                        visible: true,
                        icon: 'sparkles',
                        textVi: '  Miễn phí gửi xe ',
                        textEn: 'Free parking',
                      },
                      builtIn('hours', 'HOURS', false),
                    ],
                    featuredGroups: [
                      { code: live.code, descriptionVi: 'Mô tả A', descriptionEn: null },
                    ],
                    whyVisible: true,
                    whyTitleVi: 'Vì sao',
                    whyTitleEn: 'Why',
                    whyCards: [
                      {
                        id: cardId,
                        icon: 'leaf',
                        headingVi: 'Sạch',
                        headingEn: 'Clean',
                        descriptionVi: 'Dụng cụ sạch.',
                        descriptionEn: 'Clean tools.',
                      },
                    ],
                  }),
                  expectedVersion: current.rowVersion,
                });
                // The Owner's order is kept; the missing built-in (address) comes back visible at the end.
                assert.deepEqual(
                  saved.facts.map((fact) => [fact.id.slice(0, 7), fact.visible]),
                  [
                    ['hotline', true],
                    ['8f6f2a4', true],
                    ['hours', false],
                    ['address', true],
                  ],
                );
                assert.equal(saved.facts[1]?.textVi, 'Miễn phí gửi xe');
                const vi = await site.site('vi');
                assert.deepEqual(
                  vi.facts.map((fact) => fact.text ?? fact.kind),
                  ['HOTLINE', 'Miễn phí gửi xe', 'ADDRESS'],
                );
                assert.deepEqual(vi.featuredGroups, [{ code: live.code, description: 'Mô tả A' }]);
                assert.equal(vi.why?.title, 'Vì sao');
                const en = await site.site('en');
                assert.equal(en.facts[1]?.text, 'Free parking');
                assert.equal(
                  en.featuredGroups[0]?.description,
                  null,
                  'never the Vietnamese description',
                );
                assert.equal(en.why?.cards[0]?.heading, 'Clean');

                // Refusals name their field; nothing half-saved.
                const attempt = (patch: Partial<WebsiteShopInfoInput>) =>
                  shop.update(editor.session, {
                    ...keep(patch),
                    expectedVersion: saved.rowVersion,
                  });
                await fails(
                  attempt({ facts: [{ ...builtIn('hours', 'HOURS'), id: 'x' }] }),
                  'VALIDATION_FAILED',
                  'facts',
                );
                await fails(
                  attempt({
                    featuredGroups: [{ code: off.code, descriptionVi: null, descriptionEn: null }],
                  }),
                  'VALIDATION_FAILED',
                  'featuredGroups',
                );
                await fails(
                  attempt({
                    featuredGroups: [
                      { code: 'NO_SUCH_GROUP', descriptionVi: null, descriptionEn: null },
                    ],
                  }),
                  'VALIDATION_FAILED',
                  'featuredGroups',
                );
                await fails(
                  attempt({
                    whyVisible: true,
                    whyTitleVi: null,
                    whyTitleEn: 'Why',
                    whyCards: saved.whyCards,
                  }),
                  'VALIDATION_FAILED',
                  'whyTitleVi',
                );
                await fails(
                  attempt({
                    whyVisible: true,
                    whyTitleVi: 'Vì sao',
                    whyTitleEn: 'Why',
                    whyCards: [],
                  }),
                  'VALIDATION_FAILED',
                  'whyCards',
                );
                await fails(
                  attempt({
                    whyCards: [
                      {
                        id: cardId,
                        icon: 'leaf',
                        headingVi: 'x',
                        headingEn: '',
                        descriptionVi: 'y',
                        descriptionEn: 'z',
                      },
                    ],
                  }),
                  'VALIDATION_FAILED',
                  'whyCards',
                );
                assert.equal((await shop.get(editor.session)).rowVersion, saved.rowVersion);

                // A group deactivated later just drops out of the public list; hiding the strip and the section empties them.
                await tx.serviceCategory.update({
                  where: { code: live.code },
                  data: { isActive: false },
                });
                assert.deepEqual((await site.site('vi')).featuredGroups, []);
                const hidden = await shop.update(editor.session, {
                  ...keep({
                    factsVisible: false,
                    facts: saved.facts,
                    whyVisible: false,
                    whyTitleVi: 'Vì sao',
                    whyTitleEn: 'Why',
                    whyCards: saved.whyCards,
                  }),
                  expectedVersion: saved.rowVersion,
                });
                const quiet = await site.site('vi');
                assert.deepEqual(quiet.facts, []);
                assert.equal(quiet.why, null);
                assert.equal(hidden.whyCards.length, 1, 'a hidden section keeps what was written');
                // Back to the defaults for the tests that follow.
                await shop.update(editor.session, {
                  ...keep({}),
                  expectedVersion: hidden.rowVersion,
                });
              },
            );

            await context.test(
              'update: a stale version is a CONFLICT and every invalid field is refused by name',
              async () => {
                const current = await shop.get(editor.session);
                const attempt = (patch: Partial<WebsiteShopInfoInput>) =>
                  shop.update(editor.session, {
                    ...input({ hoursBranchId: branch.id, ...patch }),
                    expectedVersion: current.rowVersion,
                  });
                await fails(
                  shop.update(editor.session, {
                    ...input(),
                    expectedVersion: current.rowVersion - 1 || 99,
                  }),
                  'CONFLICT',
                );
                await fails(attempt({ taglineVi: '   ' }), 'VALIDATION_FAILED', 'taglineVi');
                await fails(attempt({ hotline: 'call us' }), 'VALIDATION_FAILED', 'hotline');
                await fails(
                  attempt({ mapUrl: 'http://maps.example.com/x' }),
                  'VALIDATION_FAILED',
                  'mapUrl',
                );
                await fails(
                  attempt({ hoursBranchId: randomUUID() }),
                  'VALIDATION_FAILED',
                  'hoursBranchId',
                );
                await fails(
                  attempt({ heroMediaId: randomUUID() }),
                  'VALIDATION_FAILED',
                  'heroMediaId',
                );
                assert.equal((await shop.get(editor.session)).rowVersion, current.rowVersion);
              },
            );

            await context.test(
              'an inactive chosen branch stops being the hours source and never breaks the page',
              async () => {
                await tx.branch.update({ where: { id: branch.id }, data: { isActive: false } });
                try {
                  const publicSite = await site.site('vi');
                  assert.ok(Array.isArray(publicSite.hours));
                  const admin = await shop.get(editor.session);
                  assert.ok(!admin.branches.some((option) => option.id === branch.id));
                  assert.notEqual(admin.hoursBranch?.id, branch.id);
                } finally {
                  await tx.branch.update({ where: { id: branch.id }, data: { isActive: true } });
                }
              },
            );

            await context.test(
              'hero image: needs Vietnamese alt text, is served publicly while chosen, counts as a use and blocks deletion',
              async () => {
                const upload = async (shade: number, alt: boolean) =>
                  (
                    await media.upload(
                      editor.session,
                      { buffer: await png(shade), originalname: `shop-${shade}.png` },
                      alt ? { altVi: `Ảnh ${shade}`, altEn: `Image ${shade}` } : {},
                    )
                  ).asset;
                const bare = await upload(11, false);
                const pic = await upload(22, true);
                const current = await shop.get(editor.session);
                await fails(
                  shop.update(editor.session, {
                    ...input({ hoursBranchId: branch.id, heroMediaId: bare.id }),
                    expectedVersion: current.rowVersion,
                  }),
                  'MEDIA_ALT_REQUIRED',
                  'heroMediaId',
                );
                await fails(site.variant(pic.id, 'MD'), 'NOT_FOUND');
                const saved = await shop.update(editor.session, {
                  ...input({ hoursBranchId: branch.id, heroMediaId: pic.id }),
                  expectedVersion: current.rowVersion,
                });
                assert.equal(saved.heroMediaId, pic.id);
                const publicSite = await site.site('en');
                assert.equal(publicSite.heroImage?.alt, 'Image 22');
                assert.ok((publicSite.heroImage?.sources.length ?? 0) >= 1);
                assert.match(
                  publicSite.heroImage?.sources[0]?.url ?? '',
                  /^\/api\/v1\/public\/media\//,
                );
                const served = await site.variant(pic.id, 'MD');
                assert.ok(served.bytes > 0);
                served.stream.destroy();
                const detail = await media.get(editor.session, pic.id);
                assert.deepEqual(
                  detail.usedIn.map((use) => use.kind),
                  ['SHOP_INFO'],
                );
                await fails(media.remove(editor.session, pic.id), 'MEDIA_IN_USE');
                // Clearing the image releases it again.
                const cleared = await shop.update(editor.session, {
                  ...input({ hoursBranchId: branch.id, heroMediaId: null }),
                  expectedVersion: saved.rowVersion,
                });
                assert.equal(cleared.heroMediaId, null);
                await fails(site.variant(pic.id, 'MD'), 'NOT_FOUND');
              },
            );

            await context.test(
              'footer blocks: empty by default; a picture block needs alt text, is served only while visible, counts as a use and blocks deletion',
              async () => {
                const upload = async (shade: number, alt: boolean) =>
                  (
                    await media.upload(
                      editor.session,
                      { buffer: await png(shade), originalname: `footer-${shade}.png` },
                      alt ? { altVi: `Ảnh ${shade}`, altEn: `Image ${shade}` } : {},
                    )
                  ).asset;
                const bare = await upload(33, false);
                const pic = await upload(44, true);
                const current = await shop.get(editor.session);
                assert.deepEqual(current.footerBlocks, [], 'nothing is seeded');
                assert.deepEqual((await site.site('vi')).footerBlocks, [], 'only the logo');
                const picture = (patch: { mediaId?: string; visible?: boolean } = {}) => ({
                  id: randomUUID(),
                  type: 'IMAGE' as const,
                  visible: patch.visible ?? true,
                  mediaId: patch.mediaId ?? pic.id,
                  linkUrl: null,
                });
                const slogan = { id: randomUUID(), type: 'SLOGAN' as const, visible: true };
                const save = (
                  footerBlocks: WebsiteShopInfoInput['footerBlocks'],
                  version: number,
                ) =>
                  shop.update(editor.session, {
                    ...input({ hoursBranchId: branch.id, footerBlocks }),
                    expectedVersion: version,
                  });
                await fails(
                  save([picture({ mediaId: bare.id })], current.rowVersion),
                  'MEDIA_ALT_REQUIRED',
                  'footerBlocks',
                );
                await fails(
                  save([picture({ mediaId: randomUUID() })], current.rowVersion),
                  'VALIDATION_FAILED',
                  'footerBlocks',
                );
                await fails(site.variant(pic.id, 'MD'), 'NOT_FOUND');
                const block = picture();
                const saved = await save([block, slogan], current.rowVersion);
                assert.deepEqual(
                  saved.footerBlocks.map((entry) => entry.type),
                  ['IMAGE', 'SLOGAN'],
                );
                const publicSite = await site.site('en');
                const shown = publicSite.footerBlocks[0];
                assert.equal(shown?.type === 'IMAGE' ? shown.image.alt : '', 'Image 44');
                assert.match(
                  shown?.type === 'IMAGE' ? (shown.image.sources[0]?.url ?? '') : '',
                  /^\/api\/v1\/public\/media\//,
                );
                const served = await site.variant(pic.id, 'MD');
                assert.ok(served.bytes > 0);
                served.stream.destroy();
                assert.deepEqual(
                  (await media.get(editor.session, pic.id)).usedIn.map((use) => use.kind),
                  ['SHOP_INFO'],
                );
                await fails(media.remove(editor.session, pic.id), 'MEDIA_IN_USE');
                // Hidden: no longer drawn or served, but still a use (the Owner may show it again), so it cannot be deleted.
                const hidden = await save([{ ...block, visible: false }, slogan], saved.rowVersion);
                assert.deepEqual(
                  (await site.site('en')).footerBlocks.map((entry) => entry.type),
                  ['SLOGAN'],
                );
                await fails(site.variant(pic.id, 'MD'), 'NOT_FOUND');
                await fails(media.remove(editor.session, pic.id), 'MEDIA_IN_USE');
                // An unchanged picture is not re-checked, so an old block never blocks an unrelated save.
                await save([{ ...block, visible: false }], hidden.rowVersion);
                const cleared = await save([], (await shop.get(editor.session)).rowVersion);
                assert.deepEqual(cleared.footerBlocks, []);
                assert.deepEqual((await media.get(editor.session, pic.id)).usedIn, []);
              },
            );

            await context.test(
              'public catalogue: only active services of active categories offered by an active branch, cheapest first, no internal duration',
              async () => {
                const category = (suffix: string, patch: { isActive?: boolean } = {}) =>
                  tx.serviceCategory.create({
                    data: {
                      code: `SHOP_${run}_${suffix}`,
                      nameVi: `Nhóm ${suffix}`,
                      nameEn: `Group ${suffix}`,
                      sortOrder: 0,
                      ...patch,
                    },
                    select: { id: true, code: true },
                  });
                const service = async (
                  categoryId: string,
                  suffix: string,
                  patch: Partial<{
                    priceVnd: bigint;
                    priceMaxVnd: bigint;
                    pricingUnit: 'PER_SERVICE' | 'PER_NAIL';
                    isActive: boolean;
                    offered: boolean;
                    descriptionVi: string | null;
                  }> = {},
                ) => {
                  const created = await tx.service.create({
                    data: {
                      code: `SHOPSVC_${run}_${suffix}`,
                      categoryId,
                      nameVi: `Dịch vụ ${suffix}`,
                      nameEn: `Service ${suffix}`,
                      descriptionVi: patch.descriptionVi ?? null,
                      priceVnd: patch.priceVnd ?? 100_000n,
                      priceMaxVnd: patch.priceMaxVnd ?? patch.priceVnd ?? 100_000n,
                      pricingUnit: patch.pricingUnit ?? 'PER_SERVICE',
                      maxQuantity: patch.pricingUnit === 'PER_NAIL' ? 10 : 1,
                      durationMinutes: 90,
                      estimatedMinMinutes: 60,
                      estimatedMaxMinutes: 90,
                      isActive: patch.isActive ?? true,
                    },
                    select: { id: true, code: true },
                  });
                  if (patch.offered !== false) {
                    await tx.serviceBranchAvailability.create({
                      data: { serviceId: created.id, branchId: branch.id, isActive: true },
                    });
                  }
                  return created;
                };
                const shown = await category('A');
                const emptyOnes = await category('B');
                const retired = await category('C', { isActive: false });
                const dear = await service(shown.id, 'DEAR', { priceVnd: 200_000n });
                const cheap = await service(shown.id, 'CHEAP', {
                  priceVnd: 50_000n,
                  descriptionVi: 'Nhẹ nhàng',
                });
                const nails = await service(shown.id, 'NAILS', {
                  priceVnd: 5_000n,
                  priceMaxVnd: 30_000n,
                  pricingUnit: 'PER_NAIL',
                });
                await service(shown.id, 'OFF', { isActive: false });
                await service(shown.id, 'UNOFFERED', { offered: false });
                await service(emptyOnes.id, 'ONLYOFF', { isActive: false });
                await service(retired.id, 'INRETIRED');

                const catalogue = await site.services('vi');
                const group = catalogue.groups.find((entry) => entry.code === shown.code);
                assert.ok(group, 'the group with visible services is listed');
                assert.equal(group.name, 'Nhóm A');
                assert.deepEqual(
                  group.services.map((entry) => entry.code),
                  [nails.code, cheap.code, dear.code],
                  'cheapest first',
                );
                assert.ok(!catalogue.groups.some((entry) => entry.code === emptyOnes.code));
                assert.ok(!catalogue.groups.some((entry) => entry.code === retired.code));
                const [first] = group.services;
                assert.deepEqual(first, {
                  code: nails.code,
                  name: 'Dịch vụ NAILS',
                  description: null,
                  priceMinVnd: '5000',
                  priceMaxVnd: '30000',
                  pricingUnit: 'PER_NAIL',
                  estimatedMinMinutes: 60,
                  estimatedMaxMinutes: 90,
                });
                assert.equal(group.services[1]?.description, 'Nhẹ nhàng');
                const wire = JSON.stringify(catalogue);
                assert.doesNotMatch(wire, /durationMinutes|duration_minutes|"id"|skill/i);
                const en = await site.services('en');
                assert.equal(en.groups.find((entry) => entry.code === shown.code)?.name, 'Group A');

                const detail = await site.serviceDetail('vi', cheap.code);
                assert.equal(detail.service.code, cheap.code);
                assert.equal(detail.group.code, shown.code);
                assert.deepEqual(
                  detail.related.map((entry) => entry.code),
                  [nails.code, dear.code],
                );
                for (const hidden of ['OFF', 'UNOFFERED', 'INRETIRED']) {
                  await fails(site.serviceDetail('vi', `SHOPSVC_${run}_${hidden}`), 'NOT_FOUND');
                }
                await fails(site.serviceDetail('vi', 'NO_SUCH_SERVICE'), 'NOT_FOUND');
                await fails(site.serviceDetail('vi', "x'; drop table services; --"), 'NOT_FOUND');
              },
            );

            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            throw rollback;
          },
          { timeout: 180_000 },
        ),
        (error: unknown) => error === rollback,
      );
      const after = await database.websiteShopInfo.findUniqueOrThrow({ where: { id: 'shop' } });
      assert.equal(after.rowVersion, before.rowVersion);
      assert.equal(after.hotline, before.hotline);
      assert.equal(await database.user.count({ where: { id: { in: userIds } } }), 0);
    } finally {
      await database.$disconnect();
      await rm(root, { recursive: true, force: true });
    }
  },
);
