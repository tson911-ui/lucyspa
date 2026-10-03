import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  type WebsitePopupInput,
  type WebsiteSeasonInput,
  type WebsiteSlideInput,
} from '@lucy-spa/contracts';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { takeSharedAuthGraphLock } from '../auth/auth-store.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { appointForFixture } from '../testing/organization-fixture.js';
import { POPUP_LOCK } from './popup.core.js';
import { PopupService } from './popup.service.js';
import { followsEnabledSeason, SEASON_LOCK } from './season.link.js';
import { SeasonService } from './season.service.js';
import { SLIDE_LOCK } from './slide.core.js';
import { SlideService } from './slide.service.js';

const DAY = 86_400_000;
/** Far-future windows keep every case independent of the content already in the database. */
const far = (from: number, to: number) => ({
  startsAt: new Date(Date.UTC(2090, 0, 1) + from * DAY).toISOString(),
  endsAt: new Date(Date.UTC(2090, 0, 1) + to * DAY).toISOString(),
});

const seasonDraft = (patch: Partial<WebsiteSeasonInput> = {}): WebsiteSeasonInput => ({
  presetKey: 'tet',
  label: 'Race season',
  ...far(0, 10),
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
  titleVi: 'Race popup',
  titleEn: null,
  bodyVi: null,
  bodyEn: null,
  ctaLabelVi: null,
  ctaLabelEn: null,
  ctaUrl: null,
  ...far(0, 10),
  isEnabled: false,
  ...patch,
});

const slideDraft = (
  mediaId: string,
  patch: Partial<WebsiteSlideInput> = {},
): WebsiteSlideInput => ({
  mediaId,
  mobileMediaId: null,
  titleVi: 'Race slide',
  titleEn: null,
  subtitleVi: null,
  subtitleEn: null,
  linkUrl: null,
  linkLabelVi: null,
  linkLabelEn: null,
  altVi: null,
  altEn: null,
  ...far(0, 10),
  isEnabled: false,
  ...patch,
});

/**
 * UX/UI Step 14: the deferred two-connection races of the website content locks (S3 seasons, Step 12 popup, Step 13
 * slider) on separate committed PostgreSQL connections with real production service calls. A two-party latch
 * releases only after both transactions hold the shared auth-graph lock; the season, popup and slide advisory
 * locks are taken by production code. Content uses far-future windows and is removed again by exact id; needs the
 * same opted-in local superuser validation database as the other race suites (replica-role cleanup).
 */
test(
  'website races: one enabled season, one enabled popup overlap, the slide limit and the season lock order hold',
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
    const runner = {
      withTransaction,
      withExclusiveTransaction: withTransaction,
      resolveForMutation: (token: string, tx: Prisma.TransactionClient) =>
        sessions.resolveForMutation(token, tx),
    };
    const throttle = new AuthThrottleService(environment);
    const seasons = new SeasonService(runner, throttle);
    const popups = new PopupService(runner, throttle);
    const slides = new SlideService(runner, throttle);

    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    const userIds: string[] = [];
    const sessionIds: string[] = [];
    const roleId = randomUUID();
    const seasonIds: string[] = [];
    const popupIds: string[] = [];
    const slideIds: string[] = [];
    const mediaIds: string[] = [];
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
      meet = async () => {
        if (++count === 2) release();
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
    const sorted = (results: PromiseSettledResult<unknown>[]) => results.map(outcome).sort();
    /**
     * Deterministic proof that a command takes an advisory lock: a separate connection holds it, both commands start,
     * and neither may finish while it is held. After the release exactly one of two overlapping saves wins. Without
     * the lock in the production code both would pass the overlap check at once and finish early.
     */
    const raceHeld = async <A, B>(
      lockKey: bigint,
      first: () => Promise<A>,
      second: () => Promise<B>,
    ) => {
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const ready = new Promise<void>((resolve) => (locked = resolve));
      const holder = database.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lockKey}::bigint)::text`;
          locked();
          await released;
        },
        { timeout: 30_000 },
      );
      await ready;
      try {
        const both = Promise.allSettled([first(), second()] as const);
        const early = await Promise.race([
          both.then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500)),
        ]);
        assert.equal(early, false, 'both commands wait for the advisory lock');
        release();
        await holder;
        return await both;
      } finally {
        release();
        await holder;
      }
    };

    try {
      await database.$transaction(async (tx) => {
        await syncPermissionCatalog(tx);
        const permission = await tx.permission.findUniqueOrThrow({
          where: { code: 'MANAGE_WEBSITE_CONTENT' },
          select: { id: true },
        });
        await tx.role.create({
          data: {
            id: roleId,
            code: `WSR_${run}`,
            displayNameVi: 'Race',
            displayNameEn: 'Race',
            permissions: { create: [{ permissionId: permission.id }] },
          },
        });
      });
      let serial = 0;
      const editor = () =>
        database.$transaction(async (tx) => {
          const id = randomUUID();
          userIds.push(id);
          const user = await tx.user.create({
            data: {
              id,
              kind: 'EMPLOYEE',
              status: 'ACTIVE',
              fullName: 'Race editor',
              preferredLocale: 'vi',
              normalizationVersion: 1,
              passwordHash: '$argon2id$fixture',
              phoneCanonical: `+849${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`,
              employeeProfile: {
                create: {
                  employeeCodeCanonical: `WSR_${run}_${++serial}`,
                  dateOfBirth: new Date('1990-01-01'),
                  address: 'Fixture',
                },
              },
            },
          });
          await tx.userRoleAssignment.create({
            data: { userId: id, roleId, scopeKind: 'GLOBAL', branchId: null },
          });
          await appointForFixture(tx, id);
          const anonymous = await sessions.createAnonymous(tx);
          sessionIds.push(anonymous.session.id);
          const issued = await sessions.rotateAuthenticated(
            anonymous.token,
            {
              userId: id,
              passwordHash: user.passwordHash!,
              credentialVersion: user.credentialVersion,
              authzVersion: user.authzVersion,
            },
            { reauthenticated: false },
            tx,
          );
          sessionIds.push(issued.session.id);
          return { id, token: issued.token };
        });
      const a = await editor();
      const b = await editor();
      const picture = await database.mediaAsset.create({
        data: {
          storageKey: `wsr-${run}-${randomUUID()}`,
          originalFilename: 'race.png',
          mime: 'image/png',
          bytes: 100,
          width: 8,
          height: 8,
          sha256: randomBytes(32).toString('hex'),
          altVi: 'Ảnh thử',
          createdByUserId: a.id,
        },
        select: { id: true },
      });
      mediaIds.push(picture.id);

      const season = async (patch: Partial<WebsiteSeasonInput> = {}) => {
        const created = await seasons.create(a.token, seasonDraft(patch));
        seasonIds.push(created.id);
        return created;
      };

      await suite.test('two saves enabling overlapping seasons: exactly one wins', async () => {
        const [first, second] = [await season(), await season(far(5, 15))];
        const results = await raceHeld(
          SEASON_LOCK,
          () => seasons.setEnabled(a.token, first.id, { isEnabled: true, expectedVersion: 1 }),
          () => seasons.setEnabled(b.token, second.id, { isEnabled: true, expectedVersion: 1 }),
        );
        assert.deepEqual(sorted(results), ['OK', 'SEASON_OVERLAP']);
        const enabled = await database.websiteSeason.count({
          where: { id: { in: [first.id, second.id] }, isEnabled: true },
        });
        assert.equal(enabled, 1);
        // The loser is told which season it collides with.
        const loser = results.find((result) => result.status === 'rejected');
        assert.ok(loser?.status === 'rejected' && loser.reason instanceof AuthError);
        assert.ok([first.id, second.id].includes(String(loser.reason.field ?? '')));
      });

      await suite.test(
        'two creates that are both enabled and overlap: exactly one wins',
        async () => {
          const created: string[] = [];
          const make = async (token: string) => {
            const result = await seasons.create(
              token,
              seasonDraft({ ...far(30, 40), isEnabled: true }),
            );
            created.push(result.id);
            seasonIds.push(result.id);
            return result;
          };
          const results = await race(
            () => make(a.token),
            () => make(b.token),
          );
          assert.deepEqual(sorted(results), ['OK', 'SEASON_OVERLAP']);
          assert.equal(await database.websiteSeason.count({ where: { id: { in: created } } }), 1);
        },
      );

      await suite.test('touching season windows both enable', async () => {
        const first = await season(far(50, 60));
        const second = await season(far(60, 70));
        const results = await race(
          () => seasons.setEnabled(a.token, first.id, { isEnabled: true, expectedVersion: 1 }),
          () => seasons.setEnabled(b.token, second.id, { isEnabled: true, expectedVersion: 1 }),
        );
        assert.deepEqual(sorted(results), ['OK', 'OK']);
      });

      await suite.test('two saves enabling overlapping popups: exactly one wins', async () => {
        const first = await popups.create(a.token, popupDraft(far(100, 110)));
        const second = await popups.create(a.token, popupDraft(far(105, 115)));
        popupIds.push(first.id, second.id);
        const results = await raceHeld(
          POPUP_LOCK,
          () => popups.setEnabled(a.token, first.id, { isEnabled: true, expectedVersion: 1 }),
          () => popups.setEnabled(b.token, second.id, { isEnabled: true, expectedVersion: 1 }),
        );
        assert.deepEqual(sorted(results), ['OK', 'POPUP_OVERLAP']);
        assert.equal(
          await database.websitePopup.count({
            where: { id: { in: [first.id, second.id] }, isEnabled: true },
          }),
          1,
        );
      });

      await suite.test(
        'two creates that are both enabled and overlap popups: one wins',
        async () => {
          const created: string[] = [];
          const make = async (token: string) => {
            const result = await popups.create(
              token,
              popupDraft({ ...far(130, 140), isEnabled: true }),
            );
            created.push(result.id);
            popupIds.push(result.id);
            return result;
          };
          const results = await race(
            () => make(a.token),
            () => make(b.token),
          );
          assert.deepEqual(sorted(results), ['OK', 'POPUP_OVERLAP']);
          assert.equal(await database.websitePopup.count({ where: { id: { in: created } } }), 1);
        },
      );

      await suite.test(
        'the ninth slide on screen is refused even when two saves race',
        async (t) => {
          const window = far(200, 210);
          const shown = (
            await database.websiteSlide.findMany({
              where: { isEnabled: true, ...followsEnabledSeason },
              select: { startsAt: true, endsAt: true },
            })
          ).filter(
            (slide) =>
              slide.startsAt === null ||
              slide.endsAt === null ||
              (slide.startsAt < new Date(window.endsAt) &&
                slide.endsAt > new Date(window.startsAt)),
          ).length;
          if (shown > 6) {
            t.skip(`${shown} slides already cover the race window`);
            return;
          }
          for (let index = 0; index < 7 - shown; index += 1) {
            const filler = await slides.create(
              a.token,
              slideDraft(picture.id, { ...window, isEnabled: true }),
            );
            slideIds.push(filler.id);
          }
          const first = await slides.create(a.token, slideDraft(picture.id, window));
          const second = await slides.create(a.token, slideDraft(picture.id, window));
          slideIds.push(first.id, second.id);
          const results = await raceHeld(
            SLIDE_LOCK,
            () => slides.setEnabled(a.token, first.id, { isEnabled: true, expectedVersion: 1 }),
            () => slides.setEnabled(b.token, second.id, { isEnabled: true, expectedVersion: 1 }),
          );
          assert.deepEqual(sorted(results), ['OK', 'SLIDE_LIMIT']);
          assert.equal(
            await database.websiteSlide.count({
              where: { id: { in: [first.id, second.id] }, isEnabled: true },
            }),
            1,
          );
        },
      );

      await suite.test(
        'a season edit and a save of the popup that follows it never deadlock',
        async () => {
          const followed = await season(far(300, 310));
          const popup = await popups.create(
            a.token,
            popupDraft({ seasonId: followed.id, isEnabled: true }),
          );
          popupIds.push(popup.id);
          const results = await race(
            () =>
              seasons.update(a.token, followed.id, {
                ...seasonDraft(far(300, 320)),
                expectedVersion: followed.rowVersion,
              }),
            () =>
              popups.update(b.token, popup.id, {
                ...popupDraft({ seasonId: followed.id, isEnabled: true, titleVi: 'Race popup 2' }),
                expectedVersion: popup.rowVersion,
              }),
          );
          // Either order is fine; a stale version is a CONFLICT, never a database deadlock.
          for (const code of sorted(results)) assert.ok(['OK', 'CONFLICT'].includes(code), code);
          assert.ok(results.some((result) => result.status === 'fulfilled'));
        },
      );

      await suite.test(
        'enabling a season while a linked slide is enabled keeps the slide limit',
        async () => {
          const followed = await season(far(400, 410));
          const slide = await slides.create(
            a.token,
            slideDraft(picture.id, { seasonId: followed.id, isEnabled: true }),
          );
          slideIds.push(slide.id);
          const results = await race(
            () =>
              seasons.setEnabled(a.token, followed.id, {
                isEnabled: true,
                expectedVersion: followed.rowVersion,
              }),
            () =>
              slides.update(b.token, slide.id, {
                ...slideDraft(picture.id, {
                  seasonId: followed.id,
                  isEnabled: true,
                  titleVi: 'Race slide 2',
                }),
                expectedVersion: slide.rowVersion,
              }),
          );
          for (const code of sorted(results)) assert.ok(['OK', 'CONFLICT'].includes(code), code);
          assert.ok(results.some((result) => result.status === 'fulfilled'));
        },
      );
    } finally {
      meet = null;
      try {
        await database.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
            const authored = { createdByUserId: { in: userIds } };
            await tx.websitePopup.deleteMany({
              where: { OR: [{ id: { in: popupIds } }, authored] },
            });
            await tx.websiteSlide.deleteMany({
              where: { OR: [{ id: { in: slideIds } }, authored] },
            });
            await tx.websiteSeason.deleteMany({
              where: { OR: [{ id: { in: seasonIds } }, authored] },
            });
            await tx.mediaAsset.deleteMany({ where: { id: { in: mediaIds } } });
            await tx.auditEvent.deleteMany({ where: { actorUserId: { in: userIds } } });
            await tx.session.deleteMany({
              where: { OR: [{ id: { in: sessionIds } }, { userId: { in: userIds } }] },
            });
            await tx.organizationAssignment.deleteMany({
              where: { employeeUserId: { in: userIds } },
            });
            await tx.userRoleAssignment.deleteMany({ where: { userId: { in: userIds } } });
            await tx.rolePermission.deleteMany({ where: { roleId } });
            await tx.role.deleteMany({ where: { id: roleId } });
            await tx.employeeProfile.deleteMany({ where: { userId: { in: userIds } } });
            await tx.user.deleteMany({ where: { id: { in: userIds } } });
          },
          { timeout: 30_000 },
        );
        assert.equal(await database.user.count({ where: { id: { in: userIds } } }), 0);
        assert.equal(await database.websiteSeason.count({ where: { id: { in: seasonIds } } }), 0);
        assert.equal(await database.websitePopup.count({ where: { id: { in: popupIds } } }), 0);
        assert.equal(await database.websiteSlide.count({ where: { id: { in: slideIds } } }), 0);
      } finally {
        await database.$disconnect();
      }
    }
  },
);
