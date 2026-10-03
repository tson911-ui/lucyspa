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

// UX/UI Part 2 (P2-2): the single shop profile row, its constraints and its restricted references (fixtures roll back).
test('website shop info foundation: seeded single row, constrained texts, https map link, restricted references', async () => {
  const database = createDatabaseClient(databaseUrl);
  const rollback = new Error('Intentional shop info rollback');
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

          const seeded = await tx.websiteShopInfo.findUniqueOrThrow({ where: { id: 'shop' } });
          assert.equal(seeded.taglineVi, 'Thư Giãn Tận Tâm – Nâng Tầm Nhan Sắc');
          assert.equal(seeded.address, '04 Nguyễn Quang Bích, Đà Nẵng');
          assert.equal(seeded.hotline, '0934 936 101');
          assert.equal(seeded.rowVersion, 1);
          assert.equal(await tx.websiteShopInfo.count(), 1);

          const base = {
            taglineVi: 'a',
            taglineEn: 'b',
            address: 'c',
            hotline: '0934 936 101',
          };
          await rejects(
            () => tx.websiteShopInfo.create({ data: { id: 'second', ...base } }),
            /website_shop_info_single|violates check constraint/i,
          );
          await rejects(
            () =>
              tx.websiteShopInfo.update({ where: { id: 'shop' }, data: { hotline: 'call us' } }),
            /website_shop_info_hotline|violates check constraint/i,
          );
          await rejects(
            () => tx.websiteShopInfo.update({ where: { id: 'shop' }, data: { taglineVi: '' } }),
            /website_shop_info_texts|violates check constraint/i,
          );
          // The home introduction is optional: absent by default, 1-200 characters when present, never empty.
          assert.equal(seeded.introVi, null);
          assert.equal(seeded.introEn, null);
          for (const data of [
            { introVi: '' },
            { introEn: '' },
            { introVi: 'x'.repeat(201) },
            { introEn: 'x'.repeat(201) },
          ]) {
            await rejects(
              () => tx.websiteShopInfo.update({ where: { id: 'shop' }, data }),
              /website_shop_info_intro|violates check constraint/i,
            );
          }
          await tx.websiteShopInfo.update({
            where: { id: 'shop' },
            data: { introVi: 'x'.repeat(200), introEn: 'Welcome' },
          });
          // The facts strip, featured groups and the why section: defaults need no row change, the lists are arrays of a
          // bounded size, the two why titles are 1-80 characters or absent.
          assert.equal(seeded.factsVisible, true);
          assert.deepEqual(seeded.factsItems, []);
          assert.deepEqual(seeded.featuredGroups, []);
          assert.equal(seeded.whyVisible, false);
          assert.equal(seeded.whyTitleVi, null);
          assert.deepEqual(seeded.whyCards, []);
          for (const data of [
            { factsItems: { not: 'a list' } },
            { factsItems: Array.from({ length: 17 }, () => 1) },
            { featuredGroups: 'x' },
            { featuredGroups: Array.from({ length: 13 }, () => 1) },
            { whyCards: {} },
            { whyCards: Array.from({ length: 13 }, () => 1) },
            { whyTitleVi: '' },
            { whyTitleEn: 'x'.repeat(81) },
          ]) {
            await rejects(
              () => tx.websiteShopInfo.update({ where: { id: 'shop' }, data }),
              /website_shop_info_lists|violates check constraint/i,
            );
          }
          await tx.websiteShopInfo.update({
            where: { id: 'shop' },
            data: {
              factsItems: Array.from({ length: 16 }, () => 1),
              featuredGroups: Array.from({ length: 12 }, () => 1),
              whyCards: Array.from({ length: 12 }, () => 1),
              whyTitleVi: 'x'.repeat(80),
            },
          });
          for (const mapUrl of [
            'http://maps.example.com/x',
            'javascript:alert(1)',
            '//evil.example/x',
            'https://a b',
          ]) {
            await rejects(
              () => tx.websiteShopInfo.update({ where: { id: 'shop' }, data: { mapUrl } }),
              /website_shop_info_map_url|violates check constraint/i,
            );
          }
          await tx.websiteShopInfo.update({
            where: { id: 'shop' },
            data: { mapUrl: 'https://maps.example.com/?q=Lucy+Spa' },
          });
          await rejects(
            () => tx.websiteShopInfo.update({ where: { id: 'shop' }, data: { rowVersion: 0 } }),
            /website_shop_info_row_version|violates check constraint/i,
          );

          const user = await tx.user.create({
            data: {
              kind: 'EMPLOYEE',
              status: 'ACTIVE',
              fullName: 'Shop info fixture',
              preferredLocale: 'vi',
              emailCanonical: `si-${run}@example.com`,
              emailDelivery: `si-${run}@example.com`,
              normalizationVersion: 1,
              passwordHash: '$argon2id$fixture',
              phoneCanonical: `+84917${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`,
              employeeProfile: {
                create: {
                  employeeCodeCanonical: `SI-${run}`.toUpperCase(),
                  dateOfBirth: new Date('1990-01-01'),
                  address: 'Fixture',
                },
              },
            },
          });
          const asset = await tx.mediaAsset.create({
            data: {
              storageKey: `2026/10/${randomUUID()}.png`,
              originalFilename: 'shop.png',
              mime: 'image/png',
              bytes: 1_000,
              width: 800,
              height: 600,
              sha256: randomUUID().replaceAll('-', '').repeat(2),
              createdByUserId: user.id,
            },
          });
          const branch = await tx.branch.create({
            data: { code: `SI${run}`.toUpperCase(), name: 'Shop info branch' },
          });
          await tx.websiteShopInfo.update({
            where: { id: 'shop' },
            data: { heroMediaId: asset.id, hoursBranchId: branch.id, updatedByUserId: user.id },
          });
          // A referenced image and a referenced branch cannot be deleted.
          await rejects(
            () => tx.mediaAsset.delete({ where: { id: asset.id } }),
            /website_shop_info_hero_media_id_fkey|foreign key/i,
          );
          await rejects(
            () => tx.branch.delete({ where: { id: branch.id } }),
            /website_shop_info_hours_branch_id_fkey|foreign key/i,
          );
          throw rollback;
        },
        { timeout: 60_000 },
      ),
      (error) => error === rollback,
    );
  } finally {
    await database.$disconnect();
  }
});
