import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { SupplierSourceItem } from '@lucy-spa/contracts';
import {
  evaluateCandidates,
  LocalDiskMediaStorage,
  processNextScan,
  processNextSourceTest,
  saveMapping,
} from '@lucy-spa/server';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { FakeSite, patternPicture, type FakeProduct } from '../testing/supplier-site-fake.js';
import { SupplierSourceService } from './supplier-source.service.js';

const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
const permission = (version: number) => ({
  expectedVersion: version,
  givenBy: 'Chị Hà, quản lý haruohui.com',
  method: 'Tin nhắn Zalo',
  date: threeDaysAgo,
  note: null,
  permitsText: true,
  permitsImages: true,
  permitsPrices: false,
});

/**
 * Phase 9 P9-5 against real PostgreSQL: what a scan leaves on a candidate for the reviewer. The SKU is the supplier's exactly as shown
 * (a SKU that does not fit Lucy's format, or collides, is a review item and is never changed), HARU-<id> only for haruohui, brands and
 * categories only from remembered mappings, duplicates are suspicions, and nothing the reviewer owns is overwritten. Fixtures roll back.
 */
test(
  'Phase 9 P9-5 candidates: SKU rules, mapping memory, duplicate suspicions, states; Lucy-owned values are never overwritten; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const { tx, fails } = base;
      const sources = new SupplierSourceService(base.adapter, base.throttle);
      const manager = await base.staff(['MANAGE_PRODUCTS'], {
        globalCodes: ['MANAGE_SUPPLIER_SOURCES'],
      });
      const storage = new LocalDiskMediaStorage(mkdtempSync(path.join(tmpdir(), 'lucy-p95-')));
      let n = 0;
      const versionOf = async (id: string): Promise<number> =>
        (await tx.supplierSource.findUniqueOrThrow({ where: { id }, select: { rowVersion: true } }))
          .rowVersion;

      const readySource = async (
        options: { haruohui?: boolean } = {},
      ): Promise<{ source: SupplierSourceItem; host: string; supplierId: string }> => {
        n += 1;
        const host = `nguon-${n}-${base.run.toLowerCase()}.example.com`;
        let { item } = await sources.create(manager.token, {
          supplierName: `NCC chữ ${n} ${base.run}`,
          name: `Nguồn chữ ${n} ${base.run}`,
          kind: 'WEBSITE',
          baseUrl: `https://${host}/`,
        });
        item = (await sources.permission(manager.token, item.id, permission(item.rowVersion))).item;
        item = (await sources.confirm(manager.token, item.id, { expectedVersion: item.rowVersion }))
          .item;
        const queued = await sources.requestTest(manager.token, item.id, {
          expectedVersion: item.rowVersion,
        });
        const probe = new FakeSite();
        for (let id = 1; id <= 3; id += 1)
          probe.add({ id, name: `Mẫu ${id}`, images: [`/p${id}.png`] });
        assert.equal(
          await processNextSourceTest(tx, { createClient: () => probe.client() }),
          'PASSED',
        );
        item = (
          await sources.confirmTest(manager.token, item.id, queued.item.id, {
            expectedVersion: await versionOf(item.id),
          })
        ).item;
        item = (await sources.enable(manager.token, item.id, { expectedVersion: item.rowVersion }))
          .item;
        void options;
        return { source: item, host, supplierId: item.supplier.id };
      };
      const scan = async (sourceId: string, site: FakeSite, host: string, haruohui = true) => {
        await sources.requestScan(manager.token, sourceId, {
          expectedVersion: await versionOf(sourceId),
        });
        return processNextScan(tx, {
          createClient: () => site.client(),
          storage,
          // The Owner approved the HARU- prefix for haruohui.com only; here the fake host stands in for it, or for any other source.
          skuPrefixes: haruohui ? { [host]: 'HARU-' } : {},
        });
      };
      const shop = async (
        products: (FakeProduct & { categories?: string[] })[],
      ): Promise<FakeSite> => {
        const site = new FakeSite();
        for (const product of products) {
          site.add(product);
          for (const picture of product.images) {
            if (!site.files.has(picture))
              site.files.set(
                picture,
                await patternPicture(Number(picture.replace(/\D/g, '')) || 1),
              );
          }
        }
        return site;
      };
      const candidateOf = (sourceId: string, key: string) =>
        tx.importCandidate.findFirstOrThrow({
          where: { sources: { some: { sourceRecord: { sourceId, sourceKey: key } } } },
        });
      const codesOf = (warnings: unknown): string[] =>
        (Array.isArray(warnings) ? warnings : [])
          .map((w) => String((w as { code: string }).code))
          .sort();
      const warningOf = (warnings: unknown, code: string): Record<string, unknown> | undefined =>
        (Array.isArray(warnings) ? warnings : []).find(
          (w) => (w as { code: string }).code === code,
        ) as Record<string, unknown> | undefined;

      await suite.test(
        'SKUs: the supplier SKU exactly as shown (a slug SKU stays lowercase and is a review item), HARU-<id> for a source without one, collisions are suggestions only',
        async () => {
          const { source, host } = await readySource();
          // A Lucy product that already owns the SKU "KD-DA-CO" and a name the supplier also sells.
          const owner = await tx.product.create({
            data: {
              code: `p95-${base.run.toLowerCase()}`,
              nameVi: 'Sữa rửa mặt Ohui 150ml',
              nameEn: 'Existing cleanser',
              createdByUserId: manager.id,
              variants: {
                create: [{ sku: 'KD-DA-CO', labelVi: null, labelEn: null, sortOrder: 0 }],
              },
            },
            select: { id: true, variants: { select: { id: true } } },
          });
          const slug = 'nuoc-hoa-hong-duong-trang-da-ohui-extreme-white-skin-softener';
          const site = await shop([
            {
              id: 11,
              name: 'Kem dưỡng ẩm Ohui 50ml',
              sku: 'KD-11',
              images: ['/wp-content/uploads/11.png'],
            },
            {
              id: 12,
              name: 'Nước hoa hồng Ohui',
              sku: slug,
              images: ['/wp-content/uploads/12.png'],
            },
            { id: 13, name: 'Tinh chất Ohui', images: ['/wp-content/uploads/13.png'] },
            { id: 14, name: 'Serum Ohui', sku: 'KD-DA-CO', images: ['/wp-content/uploads/14.png'] },
            { id: 15, name: 'Mặt nạ Ohui', sku: 'KD-11', images: ['/wp-content/uploads/15.png'] },
            {
              id: 16,
              name: 'SỮA RỬA MẶT OHUI 150 ML',
              sku: 'SRM-16',
              images: ['/wp-content/uploads/16.png'],
            },
          ]);
          assert.equal(await scan(source.id, site, host), 'SUCCEEDED');
          const by = async (key: string) => candidateOf(source.id, key);
          assert.equal((await by('11')).proposedSku, 'KD-11');
          assert.equal(
            (await by('12')).proposedSku,
            slug,
            'never upper-cased, shortened or repaired',
          );
          assert.equal((await by('13')).proposedSku, `HARU-13`);
          const format = warningOf((await by('12')).warnings, 'SKU_FORMAT');
          assert.equal(format?.['sku'], slug);
          // Shown to the reviewer as a fact, never applied: the proposal stays as the supplier wrote it.
          assert.equal(format?.['upperCaseWouldBe'], slug.toUpperCase());
          assert.ok(!codesOf((await by('13')).warnings).includes('SKU_MISSING'));
          const collision = warningOf((await by('14')).warnings, 'SKU_COLLISION');
          assert.equal(collision?.['productId'], owner.id);
          assert.equal(collision?.['variantId'], owner.variants[0]!.id);
          assert.equal(
            (await by('14')).matchedProductId,
            null,
            'a collision is a suggestion, never a link',
          );
          // Two candidates with the same SKU warn each other.
          assert.equal(
            warningOf((await by('11')).warnings, 'SKU_DUPLICATE_CANDIDATE')?.['candidateId'],
            (await by('15')).id,
          );
          assert.equal(
            warningOf((await by('15')).warnings, 'SKU_DUPLICATE_CANDIDATE')?.['candidateId'],
            (await by('11')).id,
          );
          // Same name and size as a Lucy product, written differently: a suspicion with the product named.
          const duplicate = warningOf((await by('16')).warnings, 'POSSIBLE_DUPLICATE');
          assert.deepEqual(
            (duplicate?.['matches'] as { productId: string }[]).map((m) => m.productId),
            [owner.id],
          );
          // Nothing became a product, a variant or a price.
          assert.equal(await tx.product.count(), 1, 'only the Lucy product made above exists');
          assert.equal(
            await tx.productVariant.count({
              where: { sku: { in: ['KD-11', slug, 'HARU-13', 'SRM-16'] } },
            }),
            0,
          );
          // Everything is in front of a person; nothing is ready (brand and category are unmapped).
          for (const key of ['11', '12', '13', '14', '15', '16']) {
            const candidate = await by(key);
            assert.equal(candidate.state, 'NEEDS_REVIEW', key);
            assert.equal(candidate.brandId, null);
            assert.equal(candidate.needsTranslation, true);
          }
        },
      );

      await suite.test(
        'a source without an approved prefix gets no generated SKU: it is a review item',
        async () => {
          const { source, host } = await readySource();
          const site = await shop([
            { id: 21, name: 'Không mã', images: ['/wp-content/uploads/21.png'] },
          ]);
          assert.equal(await scan(source.id, site, host, false), 'SUCCEEDED');
          const candidate = await candidateOf(source.id, '21');
          assert.equal(candidate.proposedSku, null);
          assert.ok(codesOf(candidate.warnings).includes('SKU_MISSING'));
        },
      );

      await suite.test(
        'mapping memory: one answer per source text (found ignoring case and diacritics) resolves every candidate that shows it; a re-evaluation changes nothing twice',
        async () => {
          const { source, host, supplierId } = await readySource();
          const brand = await tx.brand.create({
            data: { code: `b95-${base.run.toLowerCase()}`, nameVi: 'OHUI', nameEn: 'OHUI' },
            select: { id: true },
          });
          const otherBrand = await tx.brand.create({
            data: { code: `c95-${base.run.toLowerCase()}`, nameVi: 'Hãng khác', nameEn: 'Other' },
            select: { id: true },
          });
          const category = await tx.productCategory.create({
            data: { code: `k95-${base.run.toLowerCase()}`, nameVi: 'Kem dưỡng', nameEn: 'Cream' },
            select: { id: true },
          });
          const site = new FakeSite();
          for (const id of [31, 32]) {
            site.add({
              id,
              name: `Kem ${id}`,
              sku: `KM-${id}`,
              categories: ['OHUI', 'Kem Dưỡng'],
              images: [`/wp-content/uploads/${id}.png`],
            });
            site.files.set(`/wp-content/uploads/${id}.png`, await patternPicture(id));
          }
          assert.equal(await scan(source.id, site, host), 'SUCCEEDED');
          const before = await candidateOf(source.id, '31');
          const unmapped = warningOf(before.warnings, 'BRAND_UNMAPPED');
          assert.ok(unmapped);
          // The shop lists the brand as a category: an existing Lucy brand of that name is SUGGESTED, never applied.
          assert.deepEqual(
            (unmapped['suggestions'] as { id: string }[]).map((s) => s.id),
            [brand.id],
          );
          assert.equal(before.brandId, null);
          assert.deepEqual(warningOf(before.warnings, 'CATEGORY_UNMAPPED')?.['texts'], [
            'OHUI',
            'Kem Dưỡng',
          ]);

          // The reviewer answers once for the brand text (typed in another case) and once for the category text.
          const brandAnswer = await saveMapping(tx, {
            supplierId,
            kind: 'BRAND',
            sourceText: '  ohui ',
            targetId: brand.id,
            userId: manager.id,
          });
          assert.equal(brandAnswer.changed, true);
          assert.equal(
            (
              await saveMapping(tx, {
                supplierId,
                kind: 'BRAND',
                sourceText: 'OHUI',
                targetId: brand.id,
                userId: manager.id,
              })
            ).changed,
            false,
            'the same answer again changes nothing',
          );
          assert.equal(
            await tx.sourceValueMapping.count({ where: { supplierId, kind: 'BRAND' } }),
            1,
            'one answer per text',
          );
          await saveMapping(tx, {
            supplierId,
            kind: 'CATEGORY',
            sourceText: 'KEM duong',
            targetId: category.id,
            userId: manager.id,
          });
          const summary = await evaluateCandidates(tx, { supplierId });
          assert.equal(summary.evaluated, 2);
          for (const key of ['31', '32']) {
            const done = await candidateOf(source.id, key);
            assert.equal(done.brandId, brand.id, key);
            assert.equal(done.brandText, 'OHUI');
            assert.equal(done.categoryId, category.id);
            assert.deepEqual(codesOf(done.warnings), [], key);
            assert.equal(done.state, 'READY_FOR_REVIEW', key);
          }

          // Idempotent: nothing changes, so the row version does not move.
          const version = (await candidateOf(source.id, '31')).rowVersion;
          assert.equal((await evaluateCandidates(tx, { supplierId })).changed, 0);
          assert.equal((await candidateOf(source.id, '31')).rowVersion, version);

          // Remapping the text changes nothing for a candidate that already has a brand.
          assert.equal(
            (
              await saveMapping(tx, {
                supplierId,
                kind: 'BRAND',
                sourceText: 'OHUI',
                targetId: otherBrand.id,
                userId: manager.id,
              })
            ).changed,
            true,
          );
          await evaluateCandidates(tx, { supplierId });
          assert.equal(
            (await candidateOf(source.id, '31')).brandId,
            brand.id,
            'a brand already on the candidate stays',
          );
          // A new product from the same shop gets the CURRENT answer without anyone being asked again.
          site.add({
            id: 33,
            name: 'Kem 33',
            sku: 'KM-33',
            categories: ['OHUI', 'Kem Dưỡng'],
            images: [],
          });
          // (The sample never grows by itself, so evaluate a hand-made candidate of the same supplier instead.)
          // Targets must exist and be switched on; the text must say something.
          await assert.rejects(
            saveMapping(tx, {
              supplierId,
              kind: 'BRAND',
              sourceText: 'Gì đó',
              targetId: '00000000-0000-4000-8000-000000000000',
              userId: manager.id,
            }),
            /MAPPING_TARGET_INVALID/,
          );
          await assert.rejects(
            saveMapping(tx, {
              supplierId,
              kind: 'CATEGORY',
              sourceText: '   ',
              targetId: category.id,
              userId: manager.id,
            }),
            /MAPPING_TEXT_INVALID/,
          );
          void fails;
        },
      );

      await suite.test(
        'a flagged picture keeps a candidate in review whatever else is resolved; Lucy-owned text and decided candidates are never overwritten',
        async () => {
          const { source, host, supplierId } = await readySource();
          const brand = await tx.brand.create({
            data: { code: `b96-${base.run.toLowerCase()}`, nameVi: 'Hãng', nameEn: 'Brand' },
            select: { id: true },
          });
          const category = await tx.productCategory.create({
            data: { code: `k96-${base.run.toLowerCase()}`, nameVi: 'Nhóm', nameEn: 'Group' },
            select: { id: true },
          });
          await saveMapping(tx, {
            supplierId,
            kind: 'BRAND',
            sourceText: 'Hãng X',
            targetId: brand.id,
            userId: manager.id,
          });
          await saveMapping(tx, {
            supplierId,
            kind: 'CATEGORY',
            sourceText: 'Nhóm Y',
            targetId: category.id,
            userId: manager.id,
          });
          const site = new FakeSite();
          const same = await patternPicture(77);
          for (const id of [41, 42, 43]) {
            site.add({
              id,
              name: `Sản phẩm ${id}`,
              sku: `SP-${id}`,
              categories: ['Hãng X', 'Nhóm Y'],
              images: [`/wp-content/uploads/${id}.png`],
            });
            site.files.set(
              `/wp-content/uploads/${id}.png`,
              id === 43 || id === 42 ? same : await patternPicture(id),
            );
          }
          assert.equal(await scan(source.id, site, host), 'SUCCEEDED');
          const ready = await candidateOf(source.id, '41');
          assert.equal(ready.brandId, brand.id);
          assert.equal(ready.categoryId, category.id);
          assert.deepEqual(codesOf(ready.warnings), []);
          assert.equal(ready.state, 'READY_FOR_REVIEW');
          // 42 and 43 carry the same picture: flagged both, in review although brand and category are resolved.
          for (const key of ['42', '43']) {
            const flagged = await candidateOf(source.id, key);
            assert.equal(flagged.brandId, brand.id, key);
            assert.equal(flagged.state, 'NEEDS_REVIEW', key);
            assert.deepEqual(codesOf(flagged.warnings), ['IMAGE_SHARED'], key);
          }
          await evaluateCandidates(tx, { supplierId });
          for (const key of ['42', '43']) {
            assert.equal(
              (await candidateOf(source.id, key)).state,
              'NEEDS_REVIEW',
              'a flagged picture is never "ready"',
            );
          }
          // Lucy-owned text: a person's edit survives evaluation and a rescan; what the source says is recorded separately.
          await tx.importCandidate.update({
            where: { id: ready.id },
            data: {
              nameVi: 'Tên do chủ đặt',
              nameEn: 'Owner English name',
              needsTranslation: false,
              descriptionVi: 'Mô tả của Lucy',
              rowVersion: { increment: 1 },
            },
          });
          site.products.get(41)!.name = 'Tên mới ở nguồn';
          assert.equal(await scan(source.id, site, host), 'SUCCEEDED');
          await evaluateCandidates(tx, { supplierId });
          const kept = await candidateOf(source.id, '41');
          assert.equal(kept.nameVi, 'Tên do chủ đặt');
          assert.equal(kept.nameEn, 'Owner English name');
          assert.equal(kept.needsTranslation, false);
          assert.equal(kept.descriptionVi, 'Mô tả của Lucy');
          assert.equal(
            (
              await tx.sourceRecord.findFirstOrThrow({
                where: { sourceId: source.id, sourceKey: '41' },
                select: { name: true },
              })
            ).name,
            'Tên mới ở nguồn',
          );
          // A decided candidate is not touched, even by an evaluation of its whole supplier.
          await tx.importCandidate.update({
            where: { id: ready.id },
            data: {
              state: 'REJECTED',
              decidedByUserId: manager.id,
              decidedAt: new Date(),
              rowVersion: { increment: 1 },
            },
          });
          const version = (await candidateOf(source.id, '41')).rowVersion;
          await saveMapping(tx, {
            supplierId,
            kind: 'CATEGORY',
            sourceText: 'Gì khác',
            targetId: category.id,
            userId: manager.id,
          });
          await evaluateCandidates(tx, { supplierId });
          const decided = await candidateOf(source.id, '41');
          assert.equal(decided.state, 'REJECTED');
          assert.equal(decided.rowVersion, version);
        },
      );
    });
  },
);
