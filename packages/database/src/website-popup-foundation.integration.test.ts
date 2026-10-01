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

// UX/UI Step 12: the promotional popup table and its constraints (all fixtures roll back).
test('website popup foundation: constrained popups, link rule, image reference restricted', async () => {
  const database = createDatabaseClient(databaseUrl);
  const rollback = new Error('Intentional website popup rollback');
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
              fullName: 'Popup fixture',
              preferredLocale: 'vi',
              emailCanonical: `wp-${run}@example.com`,
              emailDelivery: `wp-${run}@example.com`,
              normalizationVersion: 1,
              passwordHash: '$argon2id$fixture',
              phoneCanonical: `+84918${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`,
              employeeProfile: {
                create: {
                  employeeCodeCanonical: `WP-${run}`.toUpperCase(),
                  dateOfBirth: new Date('1990-01-01'),
                  address: 'Fixture',
                },
              },
            },
          });
          const asset = await tx.mediaAsset.create({
            data: {
              storageKey: `2026/10/${randomUUID()}.png`,
              originalFilename: 'popup.png',
              mime: 'image/png',
              bytes: 1_000,
              width: 800,
              height: 600,
              sha256: randomUUID().replaceAll('-', '').repeat(2),
              createdByUserId: user.id,
            },
          });
          const startsAt = new Date('2090-01-01T00:00:00Z');
          const endsAt = new Date('2090-01-02T00:00:00Z');
          const popup = (change: Record<string, unknown> = {}) => ({
            titleVi: 'Tết',
            startsAt,
            endsAt,
            createdByUserId: user.id,
            updatedByUserId: user.id,
            ...change,
          });

          const created = await tx.websitePopup.create({ data: popup({ mediaId: asset.id }) });
          assert.equal(created.isEnabled, false, 'a new popup is a draft');
          assert.equal(created.rowVersion, 1);
          // An image alone is enough content; a title alone too.
          await tx.websitePopup.create({ data: popup({ titleVi: null, mediaId: asset.id }) });
          await tx.websitePopup.create({ data: popup({ titleVi: null, titleEn: 'Tet' }) });

          await rejects(
            () => tx.websitePopup.create({ data: popup({ titleVi: null }) }),
            /website_popups_content/,
          );
          await rejects(
            () => tx.websitePopup.create({ data: popup({ endsAt: startsAt }) }),
            /website_popups_window/,
          );
          await rejects(
            () => tx.websitePopup.create({ data: popup({ titleVi: 'x'.repeat(121) }) }),
            /website_popups_texts/,
          );
          await rejects(
            () => tx.websitePopup.create({ data: popup({ bodyVi: 'x'.repeat(301) }) }),
            /website_popups_texts/,
          );
          await rejects(
            () => tx.websitePopup.create({ data: popup({ titleVi: '' }) }),
            /website_popups_texts/,
          );
          await rejects(
            () => tx.websitePopup.create({ data: popup({ rowVersion: 0 }) }),
            /website_popups_row_version/,
          );

          // The link rule: internal locale paths or https only, and a link needs a label (and vice versa).
          for (const ctaUrl of [
            '/vi',
            '/en/account/book',
            '/{locale}/x',
            'https://example.com/a?b=1',
          ]) {
            await tx.websitePopup.create({ data: popup({ ctaUrl, ctaLabelVi: 'Go' }) });
          }
          for (const ctaUrl of [
            'javascript:alert(1)',
            'data:text/html,x',
            'http://example.com',
            '//evil.example',
            '/vimeo',
            '/vi/a b',
            'https://',
            `/vi/${'a'.repeat(500)}`,
          ]) {
            await rejects(
              () => tx.websitePopup.create({ data: popup({ ctaUrl, ctaLabelVi: 'Go' }) }),
              /website_popups_cta_url/,
            );
          }
          await rejects(
            () => tx.websitePopup.create({ data: popup({ ctaUrl: '/vi' }) }),
            /website_popups_cta_pair/,
          );
          await rejects(
            () => tx.websitePopup.create({ data: popup({ ctaLabelEn: 'Go' }) }),
            /website_popups_cta_pair/,
          );

          // A referenced image cannot be removed; a popup without an image is not a reference.
          await rejects(
            () => tx.mediaAsset.delete({ where: { id: asset.id } }),
            /website_popups_media_id_fkey|foreign key/,
          );
          await rejects(
            () => tx.websitePopup.create({ data: popup({ mediaId: randomUUID() }) }),
            /website_popups_media_id_fkey|foreign key/,
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
