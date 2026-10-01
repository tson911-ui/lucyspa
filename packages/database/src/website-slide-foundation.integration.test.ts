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

// UX/UI Step 13: the homepage slider table and its constraints (all fixtures roll back).
test('website slide foundation: constrained slides, link rule, optional window, images restricted', async () => {
  const database = createDatabaseClient(databaseUrl);
  const rollback = new Error('Intentional website slide rollback');
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
              fullName: 'Slide fixture',
              preferredLocale: 'vi',
              emailCanonical: `ws-${run}@example.com`,
              emailDelivery: `ws-${run}@example.com`,
              normalizationVersion: 1,
              passwordHash: '$argon2id$fixture',
              phoneCanonical: `+84918${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`,
              employeeProfile: {
                create: {
                  employeeCodeCanonical: `WS-${run}`.toUpperCase(),
                  dateOfBirth: new Date('1990-01-01'),
                  address: 'Fixture',
                },
              },
            },
          });
          const asset = async (name: string) =>
            tx.mediaAsset.create({
              data: {
                storageKey: `2026/10/${randomUUID()}.png`,
                originalFilename: name,
                mime: 'image/png',
                bytes: 1_000,
                width: 800,
                height: 600,
                sha256: randomUUID().replaceAll('-', '').repeat(2),
                createdByUserId: user.id,
              },
            });
          const desktop = await asset('desktop.png');
          const phone = await asset('phone.png');
          const startsAt = new Date('2090-01-01T00:00:00Z');
          const endsAt = new Date('2090-01-02T00:00:00Z');
          let order = 0;
          const slide = (change: Record<string, unknown> = {}) => ({
            mediaId: desktop.id,
            sortOrder: order++,
            createdByUserId: user.id,
            updatedByUserId: user.id,
            ...change,
          });

          const created = await tx.websiteSlide.create({
            data: slide({ mobileMediaId: phone.id, titleVi: 'Tết' }),
          });
          assert.equal(created.isEnabled, false, 'a new slide is hidden');
          assert.equal(created.rowVersion, 1);
          assert.equal(created.startsAt, null);
          assert.equal(created.endsAt, null);
          // Either end of the window may be open; closed windows need a length.
          await tx.websiteSlide.create({ data: slide({ startsAt }) });
          await tx.websiteSlide.create({ data: slide({ endsAt }) });
          await tx.websiteSlide.create({ data: slide({ startsAt, endsAt }) });
          // The order is not unique: a rewrite never trips over itself.
          await tx.websiteSlide.create({ data: slide({ sortOrder: 0 }) });

          await rejects(
            () => tx.websiteSlide.create({ data: slide({ startsAt: endsAt, endsAt: startsAt }) }),
            /website_slides_window/,
          );
          await rejects(
            () => tx.websiteSlide.create({ data: slide({ startsAt, endsAt: startsAt }) }),
            /website_slides_window/,
          );
          await rejects(
            () => tx.websiteSlide.create({ data: slide({ titleVi: 'x'.repeat(121) }) }),
            /website_slides_texts/,
          );
          await rejects(
            () => tx.websiteSlide.create({ data: slide({ subtitleVi: 'x'.repeat(201) }) }),
            /website_slides_texts/,
          );
          await rejects(
            () => tx.websiteSlide.create({ data: slide({ altVi: 'x'.repeat(301) }) }),
            /website_slides_texts/,
          );
          await rejects(
            () => tx.websiteSlide.create({ data: slide({ titleVi: '' }) }),
            /website_slides_texts/,
          );
          await rejects(
            () => tx.websiteSlide.create({ data: slide({ sortOrder: -1 }) }),
            /website_slides_sort_order/,
          );
          await rejects(
            () => tx.websiteSlide.create({ data: slide({ rowVersion: 0 }) }),
            /website_slides_row_version/,
          );

          // The link rule: internal locale paths or https only, and a link needs a label (and vice versa).
          for (const linkUrl of [
            '/vi',
            '/en/account/book',
            '/{locale}/x',
            'https://example.com/a?b=1',
          ]) {
            await tx.websiteSlide.create({ data: slide({ linkUrl, linkLabelVi: 'Go' }) });
          }
          for (const linkUrl of [
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
              () => tx.websiteSlide.create({ data: slide({ linkUrl, linkLabelVi: 'Go' }) }),
              /website_slides_link_url/,
            );
          }
          await rejects(
            () => tx.websiteSlide.create({ data: slide({ linkUrl: '/vi' }) }),
            /website_slides_link_pair/,
          );
          await rejects(
            () => tx.websiteSlide.create({ data: slide({ linkLabelEn: 'Go' }) }),
            /website_slides_link_pair/,
          );

          // A referenced image cannot be removed, desktop or phone; a slide needs a real main image.
          await rejects(
            () => tx.mediaAsset.delete({ where: { id: desktop.id } }),
            /website_slides_media_id_fkey|foreign key/,
          );
          await rejects(
            () => tx.mediaAsset.delete({ where: { id: phone.id } }),
            /website_slides_mobile_media_id_fkey|foreign key/,
          );
          await rejects(
            () => tx.websiteSlide.create({ data: slide({ mediaId: randomUUID() }) }),
            /website_slides_media_id_fkey|foreign key/,
          );
          await rejects(
            () => tx.websiteSlide.create({ data: slide({ mobileMediaId: randomUUID() }) }),
            /website_slides_mobile_media_id_fkey|foreign key/,
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
