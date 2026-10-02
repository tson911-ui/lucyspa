import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  getSeasonPreset,
  type WebsitePopupInput,
  type WebsiteSeasonInput,
  type WebsiteSlideInput,
} from '@lucy-spa/contracts';
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
import { SeasonService } from './season.service.js';
import { SlideService } from './slide.service.js';

const png = (shade: number) =>
  sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: shade, g: 90, b: 50 } },
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

const draft = (patch: Partial<WebsiteSeasonInput> = {}): WebsiteSeasonInput => ({
  presetKey: 'tet',
  label: 'Tết thử',
  startsAt: at(-1),
  endsAt: at(1),
  greetingVi: null,
  greetingEn: null,
  applyCustomer: true,
  applyAdmin: true,
  particlesEnabled: true,
  isEnabled: false,
  ...patch,
});

const popupDraft = (patch: Partial<WebsitePopupInput> = {}): WebsitePopupInput => ({
  mediaId: null,
  titleVi: 'Khuyến mãi mùa lễ',
  titleEn: null,
  bodyVi: null,
  bodyEn: null,
  ctaLabelVi: null,
  ctaLabelEn: null,
  ctaUrl: null,
  startsAt: at(-5),
  endsAt: at(-4),
  isEnabled: false,
  ...patch,
});

const slideDraft = (
  mediaId: string,
  patch: Partial<WebsiteSlideInput> = {},
): WebsiteSlideInput => ({
  mediaId,
  mobileMediaId: null,
  titleVi: 'Slide mùa lễ',
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

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'season: permission, validation, one enabled at a time, public read, holiday links; all fixtures roll back',
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
    const root = await mkdtemp(path.join(tmpdir(), 'lucy-season-it-'));
    const rollback = new Error('Intentional season integration rollback');
    try {
      await database.$connect();
      const seasonCount = await database.websiteSeason.count();
      const popupCount = await database.websitePopup.count();
      const slideCount = await database.websiteSlide.count();
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
            const seasons = new SeasonService(runner, throttle);
            const popups = new PopupService(runner, throttle);
            const slides = new SlideService(runner, throttle);
            const site = new PublicWebsiteService(runner, throttle, storage);
            // A dev database may hold live content; none of it may influence these cases.
            await tx.websiteSeason.updateMany({ data: { isEnabled: false } });
            await tx.websitePopup.updateMany({ data: { isEnabled: false } });
            await tx.websiteSlide.updateMany({ data: { isEnabled: false } });
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
                  emailCanonical: `season-${sequence}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `season-${sequence}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: kind === 'CUSTOMER' ? new Date() : null,
                  phoneCanonical: `+84918${randomInt(0, 1_000_000).toString().padStart(6, '0')}`,
                  normalizationVersion: 1,
                  passwordHash: hash,
                  ...(kind === 'EMPLOYEE'
                    ? {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `SN-${sequence}-${run}`,
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
                  code: `SN_${run}_${sequence}`,
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

            const branch = (
              await tx.branch.create({
                data: { code: `SN-${run}`, name: 'Season branch' },
                select: { id: true },
              })
            ).id;
            const editor = await actor(['MANAGE_WEBSITE_CONTENT']);
            const nobody = await actor(['VIEW_EMPLOYEES']);
            const branchOnly = await actor(['MANAGE_WEBSITE_CONTENT'], branch);
            const customer = await login(await principal('CUSTOMER'));
            const picture = (
              await media.upload(
                editor.session,
                { buffer: await png(61), originalname: 'season.png' },
                { altVi: 'Ảnh mùa lễ', altEn: 'Season image' },
              )
            ).asset;

            await context.test(
              'MANAGE_WEBSITE_CONTENT is GLOBAL only: nobody else reaches any season command',
              async () => {
                const id = randomUUID();
                for (const session of [nobody.session, branchOnly.session, customer]) {
                  await fails(seasons.list(session), 'FORBIDDEN');
                  await fails(seasons.get(session, id), 'FORBIDDEN');
                  await fails(seasons.create(session, draft()), 'FORBIDDEN');
                  await fails(
                    seasons.update(session, id, { ...draft(), expectedVersion: 1 }),
                    'FORBIDDEN',
                  );
                  await fails(
                    seasons.setEnabled(session, id, { expectedVersion: 1, isEnabled: true }),
                    'FORBIDDEN',
                  );
                  await fails(seasons.remove(session, id), 'FORBIDDEN');
                }
                await fails(seasons.list(undefined), 'AUTHENTICATION_REQUIRED');
                await fails(seasons.create(undefined, draft()), 'AUTHENTICATION_REQUIRED');
                assert.equal(
                  await tx.websiteSeason.count({ where: { createdByUserId: nobody.id } }),
                  0,
                );
              },
            );

            await context.test(
              'create, read, update, version conflict: text is normalized, status is derived, every write is audited',
              async () => {
                const created = await seasons.create(
                  editor.session,
                  draft({
                    label: '  Tết   thử ',
                    greetingVi: '  Chúc  mừng   năm mới ',
                    greetingEn: '   ',
                    ...far(0, 7),
                  }),
                );
                assert.equal(created.label, 'Tết thử');
                assert.equal(created.greetingVi, 'Chúc mừng năm mới');
                assert.equal(created.greetingEn, null);
                assert.equal(created.status, 'DRAFT');
                assert.equal(created.rowVersion, 1);
                assert.deepEqual([created.popupIds, created.slideIds], [[], []]);
                const row = await tx.websiteSeason.findUniqueOrThrow({ where: { id: created.id } });
                assert.equal(row.createdByUserId, editor.id);
                assert.equal(row.updatedByUserId, editor.id);
                const [made] = await audit(created.id, 'SEASON_CREATED');
                assert.equal(made?.actorUserId, editor.id);
                assert.equal(made?.entityType, 'WebsiteSeason');
                assert.equal((made?.after as { label: string }).label, 'Tết thử');

                const list = await seasons.list(editor.session);
                assert.ok(list.items.some((item) => item.id === created.id));
                assert.ok(!Number.isNaN(Date.parse(list.now)));
                assert.equal((await seasons.get(editor.session, created.id)).id, created.id);
                await fails(seasons.get(editor.session, randomUUID()), 'NOT_FOUND');
                await fails(seasons.get(editor.session, 'not-a-uuid'), 'NOT_FOUND');

                const updated = await seasons.update(editor.session, created.id, {
                  ...draft({ presetKey: 'christmas', label: 'Giáng sinh thử', ...far(0, 7) }),
                  expectedVersion: created.rowVersion,
                });
                assert.equal(updated.presetKey, 'christmas');
                assert.equal(updated.rowVersion, 2);
                assert.equal(updated.greetingVi, null, 'a save replaces every field');
                const [changed] = await audit(created.id, 'SEASON_UPDATED');
                assert.equal((changed?.before as { presetKey: string }).presetKey, 'tet');
                assert.equal((changed?.after as { presetKey: string }).presetKey, 'christmas');
                await fails(
                  seasons.update(editor.session, created.id, {
                    ...draft(),
                    expectedVersion: created.rowVersion,
                  }),
                  'CONFLICT',
                );
                await fails(
                  seasons.update(editor.session, randomUUID(), { ...draft(), expectedVersion: 1 }),
                  'NOT_FOUND',
                );
                await fails(
                  seasons.update(editor.session, created.id, { ...draft(), expectedVersion: 0 }),
                  'VALIDATION_FAILED',
                  'expectedVersion',
                );

                const on = await seasons.setEnabled(editor.session, created.id, {
                  expectedVersion: updated.rowVersion,
                  isEnabled: true,
                });
                assert.equal(on.status, 'SCHEDULED');
                assert.equal(on.rowVersion, 3);
                assert.equal((await audit(created.id, 'SEASON_ENABLED')).length, 1);
                const same = await seasons.setEnabled(editor.session, created.id, {
                  expectedVersion: on.rowVersion,
                  isEnabled: true,
                });
                assert.equal(same.rowVersion, on.rowVersion, 'no change, no new version');
                await fails(
                  seasons.setEnabled(editor.session, created.id, {
                    expectedVersion: updated.rowVersion,
                    isEnabled: false,
                  }),
                  'CONFLICT',
                );
                const off = await seasons.setEnabled(editor.session, created.id, {
                  expectedVersion: on.rowVersion,
                  isEnabled: false,
                });
                assert.equal(off.status, 'DRAFT');
                assert.equal((await audit(created.id, 'SEASON_DISABLED')).length, 1);
              },
            );

            await context.test(
              'validation: preset, label, greetings, window, switches, zone-less times',
              async () => {
                const bad: [Partial<WebsiteSeasonInput>, string][] = [
                  [{ presetKey: 'unknown' }, 'presetKey'],
                  [{ presetKey: '' }, 'presetKey'],
                  [{ label: '   ' }, 'label'],
                  [{ label: 'x'.repeat(81) }, 'label'],
                  [{ greetingVi: 'x'.repeat(81) }, 'greetingVi'],
                  [{ greetingEn: 'x'.repeat(81) }, 'greetingEn'],
                  [{ startsAt: '2090-02-01T00:00:00Z', endsAt: '2090-02-01T00:00:00Z' }, 'endsAt'],
                  [{ startsAt: at(2), endsAt: at(1) }, 'endsAt'],
                  [{ startsAt: '2090-01-01T10:00:00' }, 'startsAt'],
                  [{ endsAt: 'tomorrow' }, 'endsAt'],
                  [{ applyAdmin: 'yes' as unknown as boolean }, 'applyAdmin'],
                ];
                for (const [patch, field] of bad) {
                  await fails(
                    seasons.create(editor.session, draft(patch)),
                    'VALIDATION_FAILED',
                    field,
                  );
                }
                for (const presetKey of ['tet', 'christmas', 'valentine']) {
                  await seasons.create(editor.session, draft({ presetKey, ...far(100, 101) }));
                }
                const full = await seasons.create(
                  editor.session,
                  draft({ greetingVi: 'x'.repeat(80), label: 'x'.repeat(80), ...far(100, 101) }),
                );
                assert.equal(full.greetingVi?.length, 80);
              },
            );

            await context.test(
              'one enabled season at a time: overlap refused naming the other, touching and drafts allowed, disabling frees',
              async () => {
                const first = await seasons.create(
                  editor.session,
                  draft({ ...far(200, 210), isEnabled: true }),
                );
                assert.equal(first.status, 'SCHEDULED');
                const clash = (patch: Partial<WebsiteSeasonInput>) =>
                  fails(
                    seasons.create(editor.session, draft({ isEnabled: true, ...patch })),
                    'SEASON_OVERLAP',
                    first.id,
                  );
                await clash(far(205, 215));
                await clash(far(195, 201));
                await clash(far(201, 209));
                await clash(far(190, 220));
                // Touching windows are fine (the end is exclusive), and so is a draft anywhere.
                const after = await seasons.create(
                  editor.session,
                  draft({ ...far(210, 220), isEnabled: true }),
                );
                const before = await seasons.create(
                  editor.session,
                  draft({ ...far(190, 200), isEnabled: true }),
                );
                const idle = await seasons.create(editor.session, draft({ ...far(202, 209) }));
                assert.equal(idle.status, 'DRAFT');
                // Enabling the draft, or moving an enabled season onto another, is refused the same way.
                await fails(
                  seasons.setEnabled(editor.session, idle.id, {
                    expectedVersion: idle.rowVersion,
                    isEnabled: true,
                  }),
                  'SEASON_OVERLAP',
                );
                await fails(
                  seasons.update(editor.session, after.id, {
                    ...draft({ ...far(205, 225), isEnabled: true }),
                    expectedVersion: after.rowVersion,
                  }),
                  'SEASON_OVERLAP',
                );
                // A season does not conflict with itself.
                const moved = await seasons.update(editor.session, first.id, {
                  ...draft({ ...far(201, 209), isEnabled: true }),
                  expectedVersion: first.rowVersion,
                });
                assert.equal(moved.rowVersion, 2);
                // Disabling the first frees its slot.
                await seasons.setEnabled(editor.session, first.id, {
                  expectedVersion: moved.rowVersion,
                  isEnabled: false,
                });
                const enabled = await seasons.setEnabled(editor.session, idle.id, {
                  expectedVersion: idle.rowVersion,
                  isEnabled: true,
                });
                assert.equal(enabled.status, 'SCHEDULED');
                assert.equal(before.status, 'SCHEDULED');
              },
            );

            await context.test(
              'public season: only the live, enabled season; the visitor language, or the preset default',
              async () => {
                const preset = getSeasonPreset('valentine');
                assert.equal(await site.season('vi'), null);
                const created = await seasons.create(
                  editor.session,
                  draft({ presetKey: 'valentine', ...{ startsAt: at(-1), endsAt: at(1) } }),
                );
                assert.equal(await site.season('vi'), null, 'a draft is not public');
                const live = await seasons.setEnabled(editor.session, created.id, {
                  expectedVersion: created.rowVersion,
                  isEnabled: true,
                });
                assert.equal(live.status, 'ACTIVE');
                assert.deepEqual(await site.season('vi'), {
                  presetKey: 'valentine',
                  greeting: preset.greeting.vi,
                  endsAt: live.endsAt,
                  particles: true,
                  customer: true,
                  admin: true,
                  // The S6b decoration of a season saved without any: everything on, medium, no images.
                  slots: {
                    particles: true,
                    header: true,
                    logo: true,
                    corners: true,
                    dividers: true,
                    footer: true,
                    tint: true,
                  },
                  density: 'medium',
                  greetingStrip: true,
                  greetingFooter: true,
                  media: {},
                });
                assert.equal((await site.season('en'))?.greeting, preset.greeting.en);

                // The Owner's greeting wins per language; the other language keeps the default.
                const own = await seasons.update(editor.session, created.id, {
                  ...draft({
                    presetKey: 'valentine',
                    greetingVi: 'Lời chúc riêng',
                    isEnabled: true,
                    particlesEnabled: false,
                  }),
                  expectedVersion: live.rowVersion,
                });
                const vi = await site.season('vi');
                assert.equal(vi?.greeting, 'Lời chúc riêng');
                assert.equal(vi?.particles, false);
                assert.equal((await site.season('en'))?.greeting, preset.greeting.en);

                // One side only; particles are customer decoration, so they follow the customer switch.
                const adminOnly = await seasons.update(editor.session, created.id, {
                  ...draft({
                    presetKey: 'valentine',
                    applyCustomer: false,
                    isEnabled: true,
                    particlesEnabled: true,
                  }),
                  expectedVersion: own.rowVersion,
                });
                const side = await site.season('vi');
                assert.deepEqual(
                  [side?.customer, side?.admin, side?.particles],
                  [false, true, false],
                );
                // Both sides off: nothing to show, so no season.
                await seasons.update(editor.session, created.id, {
                  ...draft({
                    presetKey: 'valentine',
                    applyCustomer: false,
                    applyAdmin: false,
                    isEnabled: true,
                  }),
                  expectedVersion: adminOnly.rowVersion,
                });
                assert.equal(await site.season('vi'), null);

                // Not live: disabled, not started yet, already ended.
                for (const patch of [
                  { isEnabled: false },
                  { isEnabled: true, startsAt: at(1), endsAt: at(2) },
                  { isEnabled: true, startsAt: at(-3), endsAt: at(-2) },
                ]) {
                  const current = await seasons.get(editor.session, created.id);
                  await seasons.update(editor.session, created.id, {
                    ...draft({ presetKey: 'valentine', ...patch }),
                    expectedVersion: current.rowVersion,
                  });
                  assert.equal(await site.season('vi'), null);
                }
              },
            );

            await context.test(
              'public season: a registry preset that no longer exists answers none; overlapping bad data picks the latest start',
              async () => {
                await tx.websiteSeason.updateMany({ data: { isEnabled: false } });
                const row = (change: Record<string, unknown>) =>
                  tx.websiteSeason.create({
                    data: {
                      presetKey: 'tet',
                      label: 'Bad data',
                      startsAt: new Date(Date.now() - 3 * DAY),
                      endsAt: new Date(Date.now() + 3 * DAY),
                      isEnabled: true,
                      createdByUserId: editor.id,
                      updatedByUserId: editor.id,
                      ...change,
                    },
                  });
                const retired = await row({ presetKey: 'retired-preset' });
                assert.equal(await site.season('vi'), null);
                await tx.websiteSeason.delete({ where: { id: retired.id } });
                await row({ presetKey: 'christmas', startsAt: new Date(Date.now() - 2 * DAY) });
                await row({ presetKey: 'valentine', startsAt: new Date(Date.now() - 1 * DAY) });
                assert.equal((await site.season('vi'))?.presetKey, 'valentine');
                await tx.websiteSeason.updateMany({ data: { isEnabled: false } });
              },
            );

            await context.test(
              'holiday links: a linked popup takes the season window and goes public only while the season is on',
              async () => {
                const season = await seasons.create(
                  editor.session,
                  draft({ label: 'Lễ có popup', startsAt: at(-1), endsAt: at(1) }),
                );
                // The dates sent are ignored: the season's window is stored.
                const popup = await popups.create(
                  editor.session,
                  popupDraft({
                    seasonId: season.id,
                    isEnabled: true,
                    startsAt: at(-30),
                    endsAt: at(-29),
                  }),
                );
                assert.equal(popup.seasonId, season.id);
                assert.equal(popup.startsAt, season.startsAt);
                assert.equal(popup.endsAt, season.endsAt);
                assert.equal(popup.status, 'DRAFT', 'the season is off, so the popup is not live');
                assert.equal(await site.popup('vi'), null);
                assert.deepEqual((await seasons.get(editor.session, season.id)).popupIds, [
                  popup.id,
                ]);

                // Switching the season on makes the popup public; switching it off hides it again.
                const on = await seasons.setEnabled(editor.session, season.id, {
                  expectedVersion: season.rowVersion,
                  isEnabled: true,
                });
                assert.equal((await popups.get(editor.session, popup.id)).status, 'ACTIVE');
                assert.equal((await site.popup('vi'))?.id, popup.id);
                const off = await seasons.setEnabled(editor.session, season.id, {
                  expectedVersion: on.rowVersion,
                  isEnabled: false,
                });
                assert.equal(await site.popup('vi'), null);
                assert.equal((await popups.get(editor.session, popup.id)).status, 'DRAFT');

                // A season edit moves the popup's window and its version (an open form gets a conflict).
                const moved = await seasons.update(editor.session, season.id, {
                  ...draft({ label: 'Lễ có popup', ...far(300, 310) }),
                  expectedVersion: off.rowVersion,
                });
                const synced = await popups.get(editor.session, popup.id);
                assert.equal(synced.startsAt, moved.startsAt);
                assert.equal(synced.endsAt, moved.endsAt);
                assert.equal(synced.rowVersion, popup.rowVersion + 1);
                const [event] = await audit(season.id, 'SEASON_UPDATED');
                assert.deepEqual((event?.after as { syncedPopupIds: string[] }).syncedPopupIds, [
                  popup.id,
                ]);
                await fails(
                  popups.update(editor.session, popup.id, {
                    ...popupDraft({ seasonId: season.id, isEnabled: true }),
                    expectedVersion: popup.rowVersion,
                  }),
                  'CONFLICT',
                );

                // Unlinking returns the popup to its own dates.
                const own = await popups.update(editor.session, popup.id, {
                  ...popupDraft({ seasonId: null, ...far(400, 401) }),
                  expectedVersion: synced.rowVersion,
                });
                assert.equal(own.seasonId, null);
                assert.equal(own.startsAt, far(400, 401).startsAt);
                assert.deepEqual((await seasons.get(editor.session, season.id)).popupIds, []);

                // An unknown or malformed season is refused.
                await fails(
                  popups.create(editor.session, popupDraft({ seasonId: randomUUID() })),
                  'VALIDATION_FAILED',
                  'seasonId',
                );
                await fails(
                  popups.create(editor.session, popupDraft({ seasonId: 'nope' })),
                  'VALIDATION_FAILED',
                  'seasonId',
                );
                await fails(
                  slides.create(editor.session, slideDraft(picture.id, { seasonId: randomUUID() })),
                  'VALIDATION_FAILED',
                  'seasonId',
                );
              },
            );

            await context.test(
              'holiday links: popup overlap counts a linked popup only while its season is enabled; a season save re-checks',
              async () => {
                const window = far(500, 510);
                const season = await seasons.create(
                  editor.session,
                  draft({ label: 'Lễ xung đột', ...window }),
                );
                const outsider = await popups.create(
                  editor.session,
                  popupDraft({ ...window, isEnabled: true }),
                );
                // While the season is off, a linked popup does not clash with the outsider.
                const linked = await popups.create(
                  editor.session,
                  popupDraft({ seasonId: season.id, isEnabled: true }),
                );
                const sibling = await popups.create(
                  editor.session,
                  popupDraft({ seasonId: season.id, isEnabled: true, titleVi: 'Anh em' }),
                );
                assert.equal(linked.status, 'DRAFT');
                // Enabling the season would put three popups on screen: the save names a conflicting popup.
                await assert.rejects(
                  seasons.setEnabled(editor.session, season.id, {
                    expectedVersion: season.rowVersion,
                    isEnabled: true,
                  }),
                  (error: unknown) =>
                    error instanceof AuthError &&
                    error.code === 'POPUP_OVERLAP' &&
                    [outsider.id, linked.id, sibling.id].includes(error.field ?? ''),
                );
                assert.equal(
                  (await seasons.get(editor.session, season.id)).isEnabled,
                  false,
                  'the failed save rolled back',
                );
                // Hide the outsider and the sibling: now the season can go live.
                await popups.setEnabled(editor.session, outsider.id, {
                  expectedVersion: outsider.rowVersion,
                  isEnabled: false,
                });
                await popups.setEnabled(editor.session, sibling.id, {
                  expectedVersion: sibling.rowVersion,
                  isEnabled: false,
                });
                const on = await seasons.setEnabled(editor.session, season.id, {
                  expectedVersion: season.rowVersion,
                  isEnabled: true,
                });
                assert.equal(on.status, 'SCHEDULED');
                // With the season on, the linked popup counts: showing the outsider again is refused.
                await fails(
                  popups.setEnabled(editor.session, outsider.id, {
                    expectedVersion: outsider.rowVersion + 1,
                    isEnabled: true,
                  }),
                  'POPUP_OVERLAP',
                  linked.id,
                );
                await fails(
                  popups.setEnabled(editor.session, sibling.id, {
                    expectedVersion: sibling.rowVersion + 1,
                    isEnabled: true,
                  }),
                  'POPUP_OVERLAP',
                  linked.id,
                );
                await seasons.setEnabled(editor.session, season.id, {
                  expectedVersion: on.rowVersion,
                  isEnabled: false,
                });
                // Off again: the outsider is free to show (the linked popup is not live).
                const shown = await popups.setEnabled(editor.session, outsider.id, {
                  expectedVersion: outsider.rowVersion + 1,
                  isEnabled: true,
                });
                assert.equal(shown.isEnabled, true);
                await popups.setEnabled(editor.session, outsider.id, {
                  expectedVersion: shown.rowVersion,
                  isEnabled: false,
                });
              },
            );

            await context.test(
              'holiday links: a linked slide takes the season window, follows the season switch and counts toward the limit only when shown',
              async () => {
                const season = await seasons.create(
                  editor.session,
                  draft({ label: 'Lễ có slide', startsAt: at(-1), endsAt: at(1) }),
                );
                const slide = await slides.create(
                  editor.session,
                  slideDraft(picture.id, {
                    seasonId: season.id,
                    isEnabled: true,
                    startsAt: at(-30),
                    endsAt: at(-29),
                  }),
                );
                assert.equal(slide.seasonId, season.id);
                assert.equal(slide.startsAt, season.startsAt);
                assert.equal(slide.endsAt, season.endsAt);
                assert.equal(slide.status, 'HIDDEN', 'the season is off, so the slide is hidden');
                assert.equal((await site.slides('vi')).length, 0);
                assert.deepEqual((await seasons.get(editor.session, season.id)).slideIds, [
                  slide.id,
                ]);

                const on = await seasons.setEnabled(editor.session, season.id, {
                  expectedVersion: season.rowVersion,
                  isEnabled: true,
                });
                assert.equal((await slides.get(editor.session, slide.id)).status, 'VISIBLE');
                assert.deepEqual(
                  (await site.slides('vi')).map((item) => item.id),
                  [slide.id],
                );
                // Its image is served while it is shown, and not once the season is off.
                assert.ok(await site.variant(picture.id, 'MD'));
                const off = await seasons.setEnabled(editor.session, season.id, {
                  expectedVersion: on.rowVersion,
                  isEnabled: false,
                });
                assert.equal((await site.slides('vi')).length, 0);
                await fails(site.variant(picture.id, 'MD'), 'NOT_FOUND');

                // Eight other slides are shown in the same window: the ninth (ours) cannot join them.
                const window = far(600, 610);
                const moved = await seasons.update(editor.session, season.id, {
                  ...draft({ label: 'Lễ có slide', ...window }),
                  expectedVersion: off.rowVersion,
                });
                const others: string[] = [];
                for (let index = 0; index < 8; index += 1) {
                  const created = await slides.create(
                    editor.session,
                    slideDraft(picture.id, {
                      ...window,
                      isEnabled: true,
                      titleVi: `Khác ${index}`,
                    }),
                  );
                  others.push(created.id);
                }
                await fails(
                  seasons.setEnabled(editor.session, season.id, {
                    expectedVersion: moved.rowVersion,
                    isEnabled: true,
                  }),
                  'SLIDE_LIMIT',
                );
                assert.equal((await seasons.get(editor.session, season.id)).isEnabled, false);
                // Hide one of the others and the season fits; a ninth slide is then refused for the usual reason.
                const first = await slides.get(editor.session, others[0]!);
                await slides.setEnabled(editor.session, first.id, {
                  expectedVersion: first.rowVersion,
                  isEnabled: false,
                });
                const live = await seasons.setEnabled(editor.session, season.id, {
                  expectedVersion: moved.rowVersion,
                  isEnabled: true,
                });
                assert.equal(live.isEnabled, true);
                const again = await slides.get(editor.session, first.id);
                await fails(
                  slides.setEnabled(editor.session, first.id, {
                    expectedVersion: again.rowVersion,
                    isEnabled: true,
                  }),
                  'SLIDE_LIMIT',
                );
                await seasons.setEnabled(editor.session, season.id, {
                  expectedVersion: live.rowVersion,
                  isEnabled: false,
                });
                for (const id of others) await slides.remove(editor.session, id);
              },
            );

            await context.test(
              'delete (rule A): the items that follow are unlinked and hidden, the audit keeps what happened; any state can be deleted',
              async () => {
                const season = await seasons.create(
                  editor.session,
                  draft({ label: 'Lễ bị xóa', startsAt: at(-1), endsAt: at(1), isEnabled: true }),
                );
                const popup = await popups.create(
                  editor.session,
                  popupDraft({ seasonId: season.id, isEnabled: true }),
                );
                const slide = await slides.create(
                  editor.session,
                  slideDraft(picture.id, { seasonId: season.id, isEnabled: true }),
                );
                const resting = await slides.create(
                  editor.session,
                  slideDraft(picture.id, { seasonId: season.id, isEnabled: false }),
                );
                assert.equal((await site.popup('vi'))?.id, popup.id);
                assert.equal((await site.slides('vi')).length, 1);
                await fails(seasons.remove(nobody.session, season.id), 'FORBIDDEN');

                await seasons.remove(editor.session, season.id);
                assert.equal(await tx.websiteSeason.count({ where: { id: season.id } }), 0);
                // Nothing stays public by surprise.
                assert.equal(await site.popup('vi'), null);
                assert.equal((await site.slides('vi')).length, 0);
                assert.equal(await site.season('vi'), null);
                const after = await popups.get(editor.session, popup.id);
                assert.deepEqual([after.seasonId, after.isEnabled], [null, false]);
                assert.equal(after.rowVersion, popup.rowVersion + 1);
                for (const id of [slide.id, resting.id]) {
                  const kept = await slides.get(editor.session, id);
                  assert.equal(kept.seasonId, null);
                  assert.equal(kept.isEnabled, false);
                }
                const [event] = await audit(season.id, 'SEASON_DELETED');
                assert.equal(event?.actorUserId, editor.id);
                const note = event?.before as {
                  label: string;
                  unlinkedPopupIds: string[];
                  unlinkedSlideIds: string[];
                };
                assert.equal(note.label, 'Lễ bị xóa');
                assert.deepEqual(note.unlinkedPopupIds, [popup.id]);
                assert.deepEqual(note.unlinkedSlideIds, [slide.id, resting.id].sort());
                assert.equal((await audit(popup.id, 'POPUP_DISABLED')).length, 1);
                assert.equal((await audit(slide.id, 'SLIDE_DISABLED')).length, 1);
                assert.equal(
                  (await audit(resting.id, 'SLIDE_DISABLED')).length,
                  0,
                  'a slide that was already hidden changes nothing',
                );
                await fails(seasons.remove(editor.session, season.id), 'NOT_FOUND');
                await fails(seasons.remove(editor.session, 'not-a-uuid'), 'NOT_FOUND');

                // A draft and an ended season go the same way.
                const ended = await seasons.create(
                  editor.session,
                  draft({ startsAt: at(-3), endsAt: at(-2), isEnabled: true }),
                );
                await seasons.remove(editor.session, ended.id);
                const idle = await seasons.create(editor.session, draft(far(700, 701)));
                await seasons.remove(editor.session, idle.id);
              },
            );

            await context.test(
              'decoration (S6b): defaults, per-slot switches, density, images per slot, audit, protection and public serving',
              async () => {
                // A season saved without any decoration field means everything on, medium, no images.
                const plain = await seasons.create(editor.session, draft(far(800, 802)));
                assert.deepEqual(
                  [
                    plain.slotHeader,
                    plain.slotLogo,
                    plain.slotCorners,
                    plain.slotDividers,
                    plain.slotFooter,
                    plain.slotTint,
                    plain.greetingStrip,
                    plain.greetingFooter,
                    plain.particleDensity,
                  ],
                  [true, true, true, true, true, true, true, true, 'medium'],
                );
                assert.deepEqual(plain.slotMedia, {});

                // The celebration kit is a base kit like any other.
                const party = await seasons.create(
                  editor.session,
                  draft({
                    ...far(810, 812),
                    presetKey: 'celebration',
                    label: 'Khai trương',
                    slotHeader: false,
                    slotTint: false,
                    greetingFooter: false,
                    particleDensity: 'high',
                    slotMedia: { header: picture.id, logo: picture.id.toUpperCase() },
                  }),
                );
                assert.equal(party.presetKey, 'celebration');
                assert.deepEqual(
                  [party.slotHeader, party.slotTint, party.greetingFooter, party.particleDensity],
                  [false, false, false, 'high'],
                );
                assert.deepEqual(party.slotMedia, { header: picture.id, logo: picture.id });
                const [created] = await audit(party.id, 'SEASON_CREATED');
                const recorded = created?.after as Record<string, unknown>;
                assert.equal(recorded['particleDensity'], 'high');
                assert.equal(recorded['slotHeader'], false);
                assert.deepEqual(recorded['slotMedia'], { header: picture.id, logo: picture.id });

                // An update that leaves the decoration out keeps it; one that sends it replaces it.
                const kept = await seasons.update(editor.session, party.id, {
                  ...draft({ ...far(810, 812), presetKey: 'celebration', label: 'Khai trương 2' }),
                  expectedVersion: party.rowVersion,
                });
                assert.equal(kept.label, 'Khai trương 2');
                assert.deepEqual(kept.slotMedia, party.slotMedia);
                assert.equal(kept.particleDensity, 'high');
                const changed = await seasons.update(editor.session, party.id, {
                  ...draft({
                    ...far(810, 812),
                    presetKey: 'celebration',
                    label: 'Khai trương 2',
                    slotFooter: false,
                    particleDensity: 'low',
                    slotMedia: { footer: picture.id },
                  }),
                  expectedVersion: kept.rowVersion,
                });
                assert.deepEqual(changed.slotMedia, { footer: picture.id });
                assert.deepEqual([changed.slotFooter, changed.particleDensity], [false, 'low']);
                const [updated] = await audit(party.id, 'SEASON_UPDATED');
                assert.deepEqual(
                  (updated?.before as Record<string, unknown>)['slotMedia'],
                  { header: picture.id, logo: picture.id },
                  'the audit keeps what the images were',
                );
                const cleared = await seasons.update(editor.session, party.id, {
                  ...draft({
                    ...far(810, 812),
                    presetKey: 'celebration',
                    label: 'Khai trương 2',
                    slotMedia: {},
                  }),
                  expectedVersion: changed.rowVersion,
                });
                assert.deepEqual(cleared.slotMedia, {}, 'an empty map removes every image');

                // Bad decoration never reaches the database.
                for (const [patch, field] of [
                  [{ slotMedia: { header: randomUUID() } }, 'slotMedia'],
                  [{ slotMedia: { nowhere: picture.id } }, 'slotMedia'],
                  [{ slotMedia: { header: 'x' } }, 'slotMedia'],
                  [{ particleDensity: 'huge' }, 'particleDensity'],
                  [{ slotLogo: 'no' }, 'slotLogo'],
                ] as const) {
                  await fails(
                    seasons.create(
                      editor.session,
                      draft({
                        ...far(820, 821),
                        ...(patch as unknown as Partial<WebsiteSeasonInput>),
                      }),
                    ),
                    'VALIDATION_FAILED',
                    field,
                  );
                }
                assert.equal(
                  await tx.websiteSeason.count({
                    where: { label: 'Tết thử', startsAt: new Date(far(820, 821).startsAt) },
                  }),
                  0,
                );

                // The image is protected while a season uses it, and the media detail names the season.
                const using = await seasons.update(editor.session, party.id, {
                  ...draft({
                    ...far(810, 812),
                    presetKey: 'celebration',
                    label: 'Khai trương 2',
                    slotMedia: { header: picture.id },
                  }),
                  expectedVersion: cleared.rowVersion,
                });
                const detail = await media.get(editor.session, picture.id);
                assert.ok(
                  detail.usedIn.some((use) => use.kind === 'SEASON' && use.id === using.id),
                  'the library lists the season as a place the image is used',
                );
                await fails(media.remove(editor.session, picture.id), 'MEDIA_IN_USE');

                // Public serving: the live, enabled, customer-side season shows its images; nobody else does.
                const live = await seasons.create(
                  editor.session,
                  draft({
                    presetKey: 'celebration',
                    label: 'Đang diễn ra',
                    isEnabled: true,
                    slotCorners: false,
                    slotMedia: { footer: picture.id, particles: picture.id },
                  }),
                );
                const shown = await site.season('vi');
                assert.ok(shown);
                assert.equal(shown.presetKey, 'celebration');
                assert.deepEqual(shown.slots, {
                  particles: true,
                  header: true,
                  logo: true,
                  corners: false,
                  dividers: true,
                  footer: true,
                  tint: true,
                });
                assert.equal(shown.density, 'medium');
                assert.deepEqual(shown.media, {
                  footer: `/api/v1/public/media/${picture.id}/lg`,
                  particles: `/api/v1/public/media/${picture.id}/md`,
                });
                const served = await site.variant(picture.id, 'LG');
                assert.ok(served.bytes > 0);
                served.stream.destroy();
                await seasons.setEnabled(editor.session, live.id, {
                  expectedVersion: live.rowVersion,
                  isEnabled: false,
                });
                await fails(site.variant(picture.id, 'LG'), 'NOT_FOUND');
                const hidden = await seasons.update(editor.session, live.id, {
                  ...draft({
                    presetKey: 'celebration',
                    label: 'Đang diễn ra',
                    slotMedia: { footer: picture.id },
                    isEnabled: true,
                    applyCustomer: false,
                  }),
                  expectedVersion: live.rowVersion + 1,
                });
                assert.equal(hidden.applyCustomer, false);
                const adminOnly = await site.season('vi');
                assert.deepEqual(
                  adminOnly?.media,
                  {},
                  'the admin-side touch never carries image URLs',
                );
                await fails(site.variant(picture.id, 'LG'), 'NOT_FOUND');

                // Deleting a season removes its image rows and frees the image.
                await seasons.remove(editor.session, live.id);
                await seasons.remove(editor.session, party.id);
                await seasons.remove(editor.session, plain.id);
                assert.equal(
                  await tx.websiteSeasonSlotMedia.count({ where: { mediaId: picture.id } }),
                  0,
                );
                assert.equal(
                  (await media.get(editor.session, picture.id)).usedIn.some(
                    (use) => use.kind === 'SEASON',
                  ),
                  false,
                );
              },
            );

            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            throw rollback;
          },
          { timeout: 240_000 },
        ),
        (error: unknown) => error === rollback,
      );
      assert.equal(await database.websiteSeason.count(), seasonCount);
      assert.equal(await database.websitePopup.count(), popupCount);
      assert.equal(await database.websiteSlide.count(), slideCount);
      assert.equal(await database.user.count({ where: { id: { in: userIds } } }), 0);
    } finally {
      await database.$disconnect();
      await rm(root, { recursive: true, force: true });
    }
  },
);
