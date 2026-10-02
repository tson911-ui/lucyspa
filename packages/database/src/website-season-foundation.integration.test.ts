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

// UX/UI Step S3: the seasonal theme table, its constraints and the popup/slide link (all fixtures roll back).
test('website season foundation: constrained seasons, restricted links from popups and slides', async () => {
  const database = createDatabaseClient(databaseUrl);
  const rollback = new Error('Intentional website season rollback');
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
              assert.match(`${String((error as Error).message)}`, pattern);
              return;
            }
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
            assert.fail(`Expected rejection matching ${String(pattern)}`);
          };
          const user = await tx.user.create({
            data: {
              kind: 'EMPLOYEE',
              status: 'ACTIVE',
              fullName: 'Season fixture',
              preferredLocale: 'vi',
              emailCanonical: `wsn-${run}@example.com`,
              emailDelivery: `wsn-${run}@example.com`,
              normalizationVersion: 1,
              passwordHash: '$argon2id$fixture',
              phoneCanonical: `+84918${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`,
              employeeProfile: {
                create: {
                  employeeCodeCanonical: `WSN-${run}`.toUpperCase(),
                  dateOfBirth: new Date('1990-01-01'),
                  address: 'Fixture',
                },
              },
            },
          });
          const startsAt = new Date('2090-01-01T00:00:00Z');
          const endsAt = new Date('2090-01-08T00:00:00Z');
          const season = (change: Record<string, unknown> = {}) => ({
            presetKey: 'tet',
            label: 'Tết 2090',
            startsAt,
            endsAt,
            createdByUserId: user.id,
            updatedByUserId: user.id,
            ...change,
          });

          const created = await tx.websiteSeason.create({ data: season() });
          assert.equal(created.isEnabled, false, 'a new season is a draft');
          assert.equal(created.rowVersion, 1);
          assert.equal(created.applyCustomer, true);
          assert.equal(created.applyAdmin, true);
          assert.equal(created.particlesEnabled, true);
          assert.equal(created.greetingVi, null);
          await tx.websiteSeason.create({
            data: season({ greetingVi: 'x'.repeat(80), greetingEn: 'Happy New Year' }),
          });
          // A new preset needs no migration: only the key's format is checked here.
          await tx.websiteSeason.create({ data: season({ presetKey: 'new-preset-2' }) });

          await rejects(
            () => tx.websiteSeason.create({ data: season({ startsAt: endsAt, endsAt: startsAt }) }),
            /website_seasons_window/,
          );
          await rejects(
            () => tx.websiteSeason.create({ data: season({ endsAt: startsAt }) }),
            /website_seasons_window/,
          );
          for (const presetKey of ['', 'Tet', '1tet', 'tet_', 'tet season', 'a'.repeat(41)]) {
            await rejects(
              () => tx.websiteSeason.create({ data: season({ presetKey }) }),
              /website_seasons_preset_key/,
            );
          }
          await rejects(
            () => tx.websiteSeason.create({ data: season({ label: '' }) }),
            /website_seasons_label/,
          );
          await rejects(
            () => tx.websiteSeason.create({ data: season({ label: 'x'.repeat(81) }) }),
            /website_seasons_label/,
          );
          await rejects(
            () => tx.websiteSeason.create({ data: season({ greetingVi: 'x'.repeat(81) }) }),
            /website_seasons_greetings/,
          );
          await rejects(
            () => tx.websiteSeason.create({ data: season({ greetingEn: '' }) }),
            /website_seasons_greetings/,
          );
          await rejects(
            () => tx.websiteSeason.create({ data: season({ rowVersion: 0 }) }),
            /website_seasons_row_version/,
          );

          // Popups and slides may follow a season; the season cannot be removed while one does.
          const asset = await tx.mediaAsset.create({
            data: {
              storageKey: `2026/10/${randomUUID()}.png`,
              originalFilename: 'season.png',
              mime: 'image/png',
              bytes: 1_000,
              width: 800,
              height: 600,
              sha256: randomUUID().replaceAll('-', '').repeat(2),
              createdByUserId: user.id,
            },
          });
          const popup = await tx.websitePopup.create({
            data: {
              titleVi: 'Tết',
              startsAt,
              endsAt,
              seasonId: created.id,
              createdByUserId: user.id,
              updatedByUserId: user.id,
            },
          });
          const slide = await tx.websiteSlide.create({
            data: {
              mediaId: asset.id,
              sortOrder: 0,
              seasonId: created.id,
              createdByUserId: user.id,
              updatedByUserId: user.id,
            },
          });
          assert.equal(popup.seasonId, created.id);
          assert.equal(slide.seasonId, created.id);
          assert.equal(
            (await tx.websiteSeason.findUniqueOrThrow({ where: { id: created.id } })).rowVersion,
            1,
          );
          await rejects(
            () => tx.websiteSeason.delete({ where: { id: created.id } }),
            /website_(popups|slides)_season_id_fkey|foreign key/,
          );
          await rejects(
            () =>
              tx.websitePopup.create({
                data: {
                  titleVi: 'x',
                  startsAt,
                  endsAt,
                  seasonId: randomUUID(),
                  createdByUserId: user.id,
                  updatedByUserId: user.id,
                },
              }),
            /website_popups_season_id_fkey|foreign key/,
          );
          await rejects(
            () =>
              tx.websiteSlide.create({
                data: {
                  mediaId: asset.id,
                  sortOrder: 1,
                  seasonId: randomUUID(),
                  createdByUserId: user.id,
                  updatedByUserId: user.id,
                },
              }),
            /website_slides_season_id_fkey|foreign key/,
          );
          // Unlinked, the season can go (the API does exactly this first).
          await tx.websitePopup.update({ where: { id: popup.id }, data: { seasonId: null } });
          await tx.websiteSlide.update({ where: { id: slide.id }, data: { seasonId: null } });
          await tx.websiteSeason.delete({ where: { id: created.id } });

          // S6b decoration: a season saved without it means everything on, medium density, no images.
          const decorated = await tx.websiteSeason.create({ data: season() });
          assert.deepEqual(
            [
              decorated.slotHeader,
              decorated.slotLogo,
              decorated.slotCorners,
              decorated.slotDividers,
              decorated.slotFooter,
              decorated.slotTint,
              decorated.greetingStrip,
              decorated.greetingFooter,
              decorated.particleDensity,
            ],
            [true, true, true, true, true, true, true, true, 'medium'],
          );
          for (const particleDensity of ['', 'huge', 'LOW', 'medium ']) {
            await rejects(
              () => tx.websiteSeason.create({ data: season({ particleDensity }) }),
              /website_seasons_particle_density/,
            );
          }
          await tx.websiteSeason.create({ data: season({ particleDensity: 'high' }) });
          // One image per slot per season; the slot is one of the seven names; the image is restricted.
          await tx.websiteSeasonSlotMedia.create({
            data: { seasonId: decorated.id, slot: 'header', mediaId: asset.id },
          });
          await rejects(
            () =>
              tx.websiteSeasonSlotMedia.create({
                data: { seasonId: decorated.id, slot: 'header', mediaId: asset.id },
              }),
            /Unique constraint|website_season_slot_media_pkey/,
          );
          await rejects(
            () =>
              tx.websiteSeasonSlotMedia.create({
                data: { seasonId: decorated.id, slot: 'nowhere', mediaId: asset.id },
              }),
            /website_season_slot_media_slot/,
          );
          await rejects(
            () =>
              tx.websiteSeasonSlotMedia.create({
                data: { seasonId: decorated.id, slot: 'footer', mediaId: randomUUID() },
              }),
            /website_season_slot_media_media_id_fkey|foreign key/,
          );
          await rejects(
            () => tx.mediaAsset.delete({ where: { id: asset.id } }),
            /website_season_slot_media_media_id_fkey|website_slides_media_id_fkey|foreign key/,
          );
          // Deleting the season removes its image rows (cascade) and frees the image.
          await tx.websiteSeason.delete({ where: { id: decorated.id } });
          assert.equal(
            await tx.websiteSeasonSlotMedia.count({ where: { seasonId: decorated.id } }),
            0,
          );
          await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
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
