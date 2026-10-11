import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { SupplierSourceItem } from '@lucy-spa/contracts';
import { LocalDiskMediaStorage, processNextScan, processNextSourceTest } from '@lucy-spa/server';
import { SupplierImportService } from '../supplier-imports/supplier-import.service.js';
import { FakeSite, patternPicture, type FakeProduct } from '../testing/supplier-site-fake.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
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
 * Phase 9 P9-9b against real PostgreSQL (Owner, docs/PHASE9_PRODUCT_IMPORT.md section 17): the full scan of a source (every product, in
 * pages), a product that was rejected or ignored coming back when its content at the source changes, and "Nhập và đăng tất cả": the
 * brand and category chosen automatically, the selling price taken from the supplier's price (rounded to 1,000 VND, recorded as a normal
 * price version), the product published in the same step, the unticked ones ignored, real blockers skipped and listed, and the same
 * safety underneath (three permissions, versions, audit, no cost). Fixtures roll back.
 */
test(
  'Phase 9 P9-9b full scan and import-and-publish-all: scope, pages, reopening, automatic brand and category, price, publishing, blockers; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const { tx, fails } = base;
      const sources = new SupplierSourceService(base.adapter, base.throttle);
      const storage = new LocalDiskMediaStorage(mkdtempSync(path.join(tmpdir(), 'lucy-p99b-')));
      const imports = new SupplierImportService(base.adapter, base.throttle, storage);
      const manager = await base.staff(['MANAGE_PRODUCTS'], {
        globalCodes: ['MANAGE_SUPPLIER_SOURCES'],
      });
      const reviewer = await base.staff([], { globalCodes: ['REVIEW_SUPPLIER_IMPORTS'] });
      const owner = await base.staff([], {
        globalCodes: ['REVIEW_SUPPLIER_IMPORTS', 'MANAGE_PRODUCTS', 'MANAGE_PRODUCT_PRICES'],
      });
      let n = 0;
      const versionOf = async (id: string): Promise<number> =>
        (await tx.supplierSource.findUniqueOrThrow({ where: { id }, select: { rowVersion: true } }))
          .rowVersion;

      const readySource = async (hostName?: string): Promise<{ source: SupplierSourceItem }> => {
        n += 1;
        const host = hostName ?? `nguon-${n}-${base.run.toLowerCase()}.example.com`;
        let { item } = await sources.create(manager.token, {
          supplierName: `NCC một chạm ${base.run}`,
          name: `Nguồn một chạm ${n} ${base.run}`,
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
          probe.add({ id, name: `Mẫu ${id}`, images: [`/wp-content/uploads/p${id}.png`] });
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
        return { source: item };
      };
      const shop = async (products: FakeProduct[]): Promise<FakeSite> => {
        const site = new FakeSite();
        for (const product of products) {
          site.add(product);
          for (const picture of product.images) {
            if (!site.files.has(picture)) {
              site.files.set(
                picture,
                await patternPicture(Number(picture.replace(/\D/g, '')) || 1),
              );
            }
          }
        }
        return site;
      };
      const scan = async (sourceId: string, site: FakeSite, scope: 'SAMPLE' | 'FULL') => {
        const queued = await sources.requestScan(manager.token, sourceId, {
          expectedVersion: await versionOf(sourceId),
          ...(scope === 'FULL' ? { scope } : {}),
        });
        const outcome = await processNextScan(tx, { createClient: () => site.client(), storage });
        const item = (await sources.scans(manager.token, sourceId)).items.find(
          (entry) => entry.id === queued.item.id,
        )!;
        return { outcome, item, queued: queued.item };
      };
      const candidateOf = (sourceId: string, key: string) =>
        tx.importCandidate.findFirstOrThrow({
          where: { sources: { some: { sourceRecord: { sourceId, sourceKey: key } } } },
          select: {
            id: true,
            state: true,
            rowVersion: true,
            decisionNote: true,
            proposedSku: true,
            brandId: true,
            categoryId: true,
          },
        });

      await suite.test(
        'a full scan reads every product in pages of 100, compares only with scans of its own scope, and a plain request stays a sample',
        async () => {
          const { source } = await readySource();
          const products: FakeProduct[] = Array.from({ length: 105 }, (_, index) => ({
            id: 1000 + index,
            name: `Sản phẩm ${1000 + index}`,
            images: index < 25 ? [`/wp-content/uploads/${1000 + index}.png`] : [],
            priceVnd: 350_000,
          }));
          const site = await shop(products);
          // The default request is the sample: at most 20 products, nothing more.
          const first = await scan(source.id, site, 'SAMPLE');
          assert.equal(first.queued.scope, 'SAMPLE');
          assert.equal(first.queued.sampleLimit, 20);
          assert.equal(first.item.counts.discovered, 20);
          // A full scan reads them all (2 list pages), keeps the 20 it knows and creates the other 85.
          const full = await scan(source.id, site, 'FULL');
          assert.equal(full.queued.scope, 'FULL');
          assert.equal(full.queued.sampleLimit, 2000);
          assert.equal(full.item.status === 'SUCCEEDED' || full.item.status === 'PARTIAL', true);
          assert.deepEqual(
            [full.item.counts.discovered, full.item.counts.created, full.item.counts.unchanged],
            [105, 85, 20],
          );
          assert.equal(await tx.sourceRecord.count({ where: { sourceId: source.id } }), 105);
          assert.ok(
            site.urls.filter(
              (url) => url.startsWith('/wp-json/wc/store/v1/products?') && url.includes('page='),
            ).length >= 2,
            'the list was read page by page',
          );
          // A sample after a full scan re-reads the first 20 known products and compares with the earlier SAMPLE (20), not with 105.
          const again = await scan(source.id, site, 'SAMPLE');
          assert.equal(again.item.status, 'SUCCEEDED');
          assert.equal(again.item.counts.discovered, 20);
          // A scan of an unknown scope is refused.
          await fails(
            () =>
              sources.requestScan(manager.token, source.id, {
                expectedVersion: 0 + 1,
                scope: 'EVERYTHING' as never,
              }),
            'VALIDATION_FAILED',
            'scope',
          );
        },
      );

      await suite.test(
        'a rejected or ignored product comes back for review only when its content at the source changes (not for a price or a picture)',
        async () => {
          const { source } = await readySource();
          const site = await shop(
            [1, 2, 3].map((index) => ({
              id: 2000 + index,
              name: `Sản phẩm ${2000 + index}`,
              images: [`/wp-content/uploads/${2000 + index}.png`],
              priceVnd: 100_000,
            })),
          );
          await scan(source.id, site, 'SAMPLE');
          const c1 = await candidateOf(source.id, '2001');
          const c2 = await candidateOf(source.id, '2002');
          await imports.ignore(reviewer.token, c1.id, {
            expectedVersion: c1.rowVersion,
            note: 'không cần',
          });
          await imports.reject(reviewer.token, c2.id, {
            expectedVersion: c2.rowVersion,
            note: null,
          });
          // A price change and a picture change leave both decisions in place.
          site.products.get(2001)!.priceVnd = 120_000;
          site.products.get(2002)!.images = [
            '/wp-content/uploads/2002.png',
            '/wp-content/uploads/22002.png',
          ];
          site.files.set('/wp-content/uploads/22002.png', await patternPicture(22002));
          await scan(source.id, site, 'SAMPLE');
          assert.equal((await candidateOf(source.id, '2001')).state, 'IGNORED');
          assert.equal((await candidateOf(source.id, '2002')).state, 'REJECTED');
          // The content changes: both are open again, with the decision cleared.
          site.products.get(2001)!.name = 'Sản phẩm 2001 (tên mới)';
          site.products.get(2002)!.name = 'Sản phẩm 2002 (tên mới)';
          await scan(source.id, site, 'SAMPLE');
          for (const key of ['2001', '2002']) {
            const back = await candidateOf(source.id, key);
            assert.notEqual(back.state, 'IGNORED');
            assert.notEqual(back.state, 'REJECTED');
            assert.equal(back.decisionNote, null);
          }
        },
      );

      const ohui = (
        id: number,
        name: string,
        categories: string[],
        extra: Partial<FakeProduct> = {},
      ): FakeProduct => ({
        id,
        name,
        images: [`/wp-content/uploads/${id}.png`],
        priceVnd: 350_400,
        categories: ['Chăm Sóc Da Mặt', 'OHUI', 'Ohui Dòng Thử', ...categories],
        sku: String(50_700_000 + id),
        ...extra,
      });

      await suite.test(
        'import and publish all: the system chooses brand, category and price; ticked products are imported and published, unticked ones ignored, blockers skipped and listed',
        async () => {
          const { source } = await readySource('haruohui.com');
          const site = await shop([
            ohui(3001, 'Nước hoa hồng Ohui The First', ['Nước Hoa Hồng']),
            // The Owner's real case: regular 750.000, on sale for 580.000. The selling price is the REGULAR price.
            ohui(3002, 'Sữa rửa mặt Ohui Foam', ['Sữa rửa mặt'], {
              priceVnd: 750_000,
              salePriceVnd: 580_000,
            }),
            ohui(3003, 'Tinh chất Ohui Essence', ['Tinh Chất']),
            ohui(3004, 'Kem dưỡng Ohui Cream', ['Kem Dưỡng']),
            ohui(3005, 'Mặt nạ Ohui Mask', ['Mặt Nạ']),
            // A source SKU that is not usable (a URL slug) gets HARU-<id> and imports like the rest (Owner, 2026-10-11).
            ohui(3006, 'Sản phẩm sku sai dạng', ['Tinh Chất'], { sku: 'sku-sai-dang-slug' }),
            // No usable price at the source: it cannot be published.
            ohui(3007, 'Sản phẩm không giá', ['Tinh Chất'], { priceVnd: 0 }),
            ohui(3008, 'Sản phẩm bị bỏ chọn', ['Tinh Chất']),
            // A supplier SKU longer than a Lucy SKU can be: stored as none by an older scan, HARU-<id> now.
            ohui(3010, 'Sản phẩm sku dài', ['Tinh Chất'], { sku: 'x'.repeat(80) }),
            // Supplements have their own (13th) category.
            {
              id: 3009,
              name: 'Viên uống Collagen TPCN Test',
              images: ['/wp-content/uploads/3009.png'],
              priceVnd: 900_000,
              categories: ['Thực phẩm chức năng'],
              sku: String(50_700_000 + 3009),
            },
          ]);
          // The earlier tests of this file left open candidates too: every count below is relative to what was open before.
          const open = (await imports.importAllPreview(owner.token)).total;
          await scan(source.id, site, 'FULL');
          // A candidate scanned BEFORE the HARU-<id> rule still holds the slug as the source gave it: put 3006 back in that state.
          const old = await candidateOf(source.id, '3006');
          assert.equal(old.proposedSku, 'HARU-3006', 'a new scan already uses the generated SKU');
          await tx.importCandidate.update({
            where: { id: old.id },
            data: { proposedSku: 'sku-sai-dang-slug', rowVersion: { increment: 1 } },
          });
          const longOne = await candidateOf(source.id, '3010');
          assert.equal(longOne.proposedSku, 'HARU-3010');
          await tx.importCandidate.update({
            where: { id: longOne.id },
            data: { proposedSku: null, rowVersion: { increment: 1 } },
          });
          // Two authorities are missing: the reviewer cannot even open the preview, and neither can the manager.
          await fails(() => imports.importAllPreview(reviewer.token), 'FORBIDDEN');
          await fails(() => imports.importAllPreview(manager.token), 'FORBIDDEN');

          const preview = await imports.importAllPreview(owner.token);
          assert.equal(preview.total - open, 10);
          const row = (key: string) =>
            preview.rows.find(
              (entry) =>
                entry.sku ===
                (key === '3006' || key === '3010'
                  ? `HARU-${key}`
                  : String(50_700_000 + Number(key))),
            )!;
          assert.deepEqual(row('3001').category, { key: 'TONER', name: 'Nước hoa hồng/Toner' });
          assert.deepEqual(row('3002').category, { key: 'CLEANSE', name: 'Làm sạch' });
          assert.deepEqual(row('3003').category, { key: 'SERUM', name: 'Serum/Tinh chất' });
          assert.deepEqual(row('3004').category, { key: 'MOISTURE', name: 'Dưỡng ẩm/Kem dưỡng' });
          assert.deepEqual(row('3005').category, { key: 'MASK', name: 'Mặt nạ' });
          assert.deepEqual(
            row('3001').brand,
            { name: 'OHUI', isNew: true },
            'the brand the lines start with, new to Lucy Spa',
          );
          assert.equal(row('3001').priceVnd, '350000', '350,400 rounded to 1,000');
          assert.equal(
            row('3002').priceVnd,
            '750000',
            'the REGULAR price, never the sale price of 580,000',
          );
          assert.deepEqual(row('3009').category, {
            key: 'SUPPLEMENT',
            name: 'Thực phẩm chức năng',
          });
          // The candidate that still holds the slug is shown and checked with HARU-<id>: no blocker, nothing stored by the preview.
          assert.deepEqual(row('3006').blockers, []);
          assert.equal(
            (await tx.importCandidate.findUniqueOrThrow({ where: { id: old.id } })).proposedSku,
            'sku-sai-dang-slug',
          );
          // The sale price stays as a reference observation on the source record.
          const observed = await tx.sourceRecord.findFirstOrThrow({
            where: { sourceId: source.id, sourceKey: '3002' },
            select: { priceObservations: { select: { priceVnd: true, promoPriceVnd: true } } },
          });
          assert.equal(observed.priceObservations[0]!.priceVnd, 750_000n);
          assert.equal(observed.priceObservations[0]!.promoPriceVnd, 580_000n);
          // The sale is mirrored as the shop's own promotion: the preview shows both prices, the product without a sale shows one.
          assert.equal(row('3002').promoPriceVnd, '580000');
          assert.equal(row('3001').promoPriceVnd, null);
          assert.deepEqual(
            preview.rows.find((entry) => entry.nameVi === 'Sản phẩm không giá')!.blockers,
            ['PRICE_MISSING'],
          );
          // This source's ten: nine can go, one is a real blocker (the earlier tests' candidates are not counted here).
          const mine = preview.rows.filter((entry) =>
            /Ohui|sku sai|sku dài|không giá|bỏ chọn|TPCN/.test(entry.nameVi),
          );
          assert.equal(mine.length, 10);
          assert.equal(mine.filter((entry) => entry.blockers.length === 0).length, 9);
          assert.equal(mine.filter((entry) => entry.blockers.length > 0).length, 1);
          assert.deepEqual(preview.newBrands, [{ name: 'OHUI', count: 8 }]);
          assert.deepEqual(row('3010').blockers, []);
          assert.equal(
            preview.categoriesToCreate.length,
            13,
            'none of the thirteen exists yet: all are created when the import runs',
          );
          assert.equal(preview.categories.find((entry) => entry.key === 'TONER')!.count, 1);
          // The preview wrote nothing.
          assert.equal(
            await tx.product.count({
              where: { source: { path: ['sourceId'], equals: source.id } },
            }),
            0,
          );
          assert.equal(await tx.brand.count({ where: { nameVi: 'OHUI' } }), 0);

          // The Owner ticks five products and unticks one; the two blockers are never offered.
          const named = (name: string) => preview.rows.find((entry) => entry.nameVi === name)!;
          const ids = (keys: string[]) =>
            keys.map((key) => ({ id: row(key).id, expectedVersion: row(key).rowVersion }));
          const unticked = ids(['3008']);
          assert.ok(named('Sản phẩm sku sai dạng'));
          const stale = { id: row('3004').id, expectedVersion: row('3004').rowVersion + 5 };
          await fails(
            () => imports.importAll(reviewer.token, { import: ids(['3001']), ignore: [] }),
            'FORBIDDEN',
          );
          await fails(
            () => imports.importAll(owner.token, { import: [], ignore: [] }),
            'VALIDATION_FAILED',
            'import',
          );
          const result = await imports.importAll(owner.token, {
            import: [
              ...ids(['3001', '3002', '3003', '3005', '3006', '3009', '3010']),
              stale,
              ...ids(['3007']),
            ],
            ignore: unticked,
          });
          assert.equal(result.imported, 7);
          assert.equal(result.ignored, 1);
          assert.equal(result.newBrands, 1, 'OHUI is created once, for all of them');
          assert.equal(result.createdCategories, 13);
          const skipped = new Map(result.skipped.map((entry) => [entry.id, entry.reasons]));
          assert.deepEqual(skipped.get(stale.id), ['CONFLICT']);
          assert.deepEqual(skipped.get(row('3007').id), ['PRICE_MISSING']);

          // The products: published, with the supplier's price (rounded) as a normal numbered price version, brand, category, pictures.
          const made = await tx.product.findMany({
            where: { source: { path: ['sourceId'], equals: source.id } },
            orderBy: { code: 'asc' },
            select: {
              status: true,
              nameVi: true,
              brand: { select: { nameVi: true } },
              category: { select: { nameVi: true } },
              images: { select: { id: true } },
              variants: {
                select: {
                  sku: true,
                  costPriceVnd: true,
                  priceVersions: { select: { versionNo: true, listPriceVnd: true, reason: true } },
                },
              },
            },
          });
          assert.equal(made.length, 7);
          for (const product of made) {
            assert.equal(product.status, 'PUBLISHED');
            if (!/TPCN/.test(product.nameVi)) assert.equal(product.brand?.nameVi, 'OHUI');
            assert.equal(product.images.length, 1);
            assert.equal(
              product.variants[0]!.costPriceVnd,
              null,
              'the supplier price is never a cost',
            );
            assert.equal(product.variants[0]!.priceVersions.length, 1);
            assert.equal(product.variants[0]!.priceVersions[0]!.versionNo, 1);
          }
          const byName = (name: string) => made.find((product) => product.nameVi === name)!;
          assert.equal(
            byName('Nước hoa hồng Ohui The First').category?.nameVi,
            'Nước hoa hồng/Toner',
          );
          assert.equal(
            byName('Nước hoa hồng Ohui The First').variants[0]!.priceVersions[0]!.listPriceVnd,
            350_000n,
          );
          assert.equal(
            byName('Sữa rửa mặt Ohui Foam').variants[0]!.priceVersions[0]!.listPriceVnd,
            750_000n,
            'the regular price, not the sale price',
          );
          // The slug candidate was stored with HARU-<id> by the import, and the product's SKU is that.
          assert.equal(byName('Sản phẩm sku sai dạng').variants[0]!.sku, 'HARU-3006');
          assert.equal((await candidateOf(source.id, '3006')).proposedSku, 'HARU-3006');
          assert.equal(
            byName('Viên uống Collagen TPCN Test').category?.nameVi,
            'Thực phẩm chức năng',
          );
          assert.equal(byName('Mặt nạ Ohui Mask').category?.nameVi, 'Mặt nạ');
          // The promotion of the sale: 580.000 from now, open-ended (the Store API gives no end date), only for the product that is on sale;
          // the shop's own price function now says 580.000 against the list price of 750.000, and 350.000 for the product without a sale.
          const promotions = await tx.productPromotion.findMany({
            where: { variant: { product: { source: { path: ['sourceId'], equals: source.id } } } },
            select: {
              promoPriceVnd: true,
              startsAt: true,
              endsAt: true,
              variant: { select: { sku: true, id: true } },
            },
          });
          assert.equal(promotions.length, 1);
          assert.equal(promotions[0]!.promoPriceVnd, 580_000n);
          assert.equal(promotions[0]!.variant.sku, String(50_700_000 + 3002));
          assert.ok(
            promotions[0]!.endsAt.getTime() - promotions[0]!.startsAt.getTime() >
              5 * 365 * 86_400_000,
          );
          const priceOf = async (variantId: string) =>
            (
              await tx.$queryRaw<
                { list: bigint; effective: bigint }[]
              >`SELECT list_price_vnd AS list, effective_price_vnd AS effective FROM lucy_variant_price_at(${variantId}::uuid, clock_timestamp() + interval '1 minute')`
            )[0]!;
          assert.deepEqual(await priceOf(promotions[0]!.variant.id), {
            list: 750_000n,
            effective: 580_000n,
          });
          assert.ok(
            (await tx.auditEvent.count({ where: { action: 'PRODUCT_PROMOTION_CREATED' } })) > 0,
          );
          // One brand, twelve categories, and the unticked one is ignored (with the note), the blocked ones are still open.
          assert.equal(await tx.brand.count({ where: { nameVi: 'OHUI' } }), 1);
          for (const category of ['Làm sạch', 'Khác', 'Bộ sản phẩm/Set', 'Thực phẩm chức năng']) {
            assert.equal(await tx.productCategory.count({ where: { nameVi: category } }), 1);
          }
          const ignored = await candidateOf(source.id, '3008');
          assert.equal(ignored.state, 'IGNORED');
          assert.match(ignored.decisionNote ?? '', /Bỏ chọn/);
          assert.equal((await candidateOf(source.id, '3006')).state, 'IMPORTED');
          assert.notEqual((await candidateOf(source.id, '3007')).state, 'IMPORTED');
          // Remembered: the supplier's brand text and its type categories now map to Lucy's brand and categories.
          const mappings = await tx.sourceValueMapping.findMany({
            where: { supplier: { sources: { some: { id: source.id } } } },
            select: { kind: true, sourceText: true },
          });
          assert.ok(
            mappings.some((entry) => entry.kind === 'BRAND' && entry.sourceText === 'OHUI'),
          );
          assert.ok(
            mappings.some(
              (entry) => entry.kind === 'CATEGORY' && entry.sourceText === 'Nước Hoa Hồng',
            ),
          );
          // Audit underneath: the brand, the categories, the products, the prices and the publication.
          for (const action of [
            'PRODUCT_BRAND_CREATED',
            'PRODUCT_CATEGORY_CREATED',
            'PRODUCT_CREATED',
            'PRODUCT_PRICE_CHANGED',
            'PRODUCT_STATUS_CHANGED',
            'SUPPLIER_CANDIDATE_APPROVED',
            'SUPPLIER_CANDIDATE_IGNORED',
          ]) {
            assert.ok((await tx.auditEvent.count({ where: { action } })) > 0, action);
          }

          // The source changes its sale later: a review note, never a silent change of the shop's promotion or price.
          site.products.get(3002)!.salePriceVnd = 500_000;
          await scan(source.id, site, 'FULL');
          const note = await tx.sourceChange.findFirst({
            where: {
              kind: 'PRICE_CHANGED',
              sourceRecord: { sourceId: source.id, sourceKey: '3002' },
            },
            select: { id: true },
          });
          assert.ok(note, 'the new sale price is a change note for a person');
          const still = await tx.productPromotion.findMany({
            where: { variant: { sku: String(50_700_000 + 3002) } },
            select: { promoPriceVnd: true, endedEarlyAt: true },
          });
          assert.deepEqual(still, [{ promoPriceVnd: 580_000n, endedEarlyAt: null }]);
          assert.equal(
            await tx.productPriceVersion.count({
              where: { variant: { sku: String(50_700_000 + 3002) } },
            }),
            1,
            'no new price version',
          );

          // Again with the same ids: nothing happens twice (they are decided now); the version moved for the others.
          const second = await imports.importAll(owner.token, {
            import: ids(['3001']),
            ignore: [],
          });
          assert.equal(second.imported, 0);
          assert.deepEqual(second.skipped[0]?.reasons, ['CONFLICT']);
          // The preview now lists only what is still open: the one blocker and the stale one.
          const after = await imports.importAllPreview(owner.token);
          assert.equal(after.total - open, 2);
          assert.equal(after.newBrands.length, 0);
          assert.equal(after.categoriesToCreate.length, 0);
        },
      );
    });
  },
);
