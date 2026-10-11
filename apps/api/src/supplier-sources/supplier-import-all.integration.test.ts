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

      const readySource = async (): Promise<{ source: SupplierSourceItem }> => {
        n += 1;
        const host = `nguon-${n}-${base.run.toLowerCase()}.example.com`;
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
          const { source } = await readySource();
          const site = await shop([
            ohui(3001, 'Nước hoa hồng Ohui The First', ['Nước Hoa Hồng']),
            ohui(3002, 'Sữa rửa mặt Ohui Foam', ['Sữa rửa mặt'], { salePriceVnd: 299_600 }),
            ohui(3003, 'Tinh chất Ohui Essence', ['Tinh Chất']),
            ohui(3004, 'Kem dưỡng Ohui Cream', ['Kem Dưỡng']),
            ohui(3005, 'Mặt nạ Ohui Mask', ['Mặt Nạ']),
            // A SKU that does not fit Lucy's format is a real blocker, never changed silently.
            ohui(3006, 'Sản phẩm sku sai dạng', ['Tinh Chất'], { sku: 'sku sai dạng' }),
            // No usable price at the source: it cannot be published.
            ohui(3007, 'Sản phẩm không giá', ['Tinh Chất'], { priceVnd: 0 }),
            ohui(3008, 'Sản phẩm bị bỏ chọn', ['Tinh Chất']),
          ]);
          // The earlier tests of this file left open candidates too: every count below is relative to what was open before.
          const open = (await imports.importAllPreview(owner.token)).total;
          await scan(source.id, site, 'FULL');
          // Two authorities are missing: the reviewer cannot even open the preview, and neither can the manager.
          await fails(() => imports.importAllPreview(reviewer.token), 'FORBIDDEN');
          await fails(() => imports.importAllPreview(manager.token), 'FORBIDDEN');

          const preview = await imports.importAllPreview(owner.token);
          assert.equal(preview.total - open, 8);
          const row = (key: string) =>
            preview.rows.find((entry) => entry.sku === String(50_700_000 + Number(key)))!;
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
            '300000',
            'the sale price is what a buyer pays: 299,600 rounds to 300,000',
          );
          assert.deepEqual(
            preview.rows.find((entry) => entry.nameVi === 'Sản phẩm sku sai dạng')!.blockers,
            ['SKU_INVALID'],
          );
          assert.deepEqual(
            preview.rows.find((entry) => entry.nameVi === 'Sản phẩm không giá')!.blockers,
            ['PRICE_MISSING'],
          );
          // This source's eight: six can go, two are real blockers (the earlier tests' candidates are not counted here).
          const mine = preview.rows.filter((entry) =>
            /Ohui|sku sai|không giá|bỏ chọn/.test(entry.nameVi),
          );
          assert.equal(mine.length, 8);
          assert.equal(mine.filter((entry) => entry.blockers.length === 0).length, 6);
          assert.equal(mine.filter((entry) => entry.blockers.length > 0).length, 2);
          assert.deepEqual(preview.newBrands, [{ name: 'OHUI', count: 6 }]);
          assert.equal(
            preview.categoriesToCreate.length,
            12,
            'none of the twelve exists yet: all are created when the import runs',
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
          const wrongSku = named('Sản phẩm sku sai dạng');
          const ids = (keys: string[]) =>
            keys.map((key) => ({ id: row(key).id, expectedVersion: row(key).rowVersion }));
          const unticked = ids(['3008']);
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
              ...ids(['3001', '3002', '3003', '3005']),
              stale,
              { id: wrongSku.id, expectedVersion: wrongSku.rowVersion },
              ...ids(['3007']),
            ],
            ignore: unticked,
          });
          assert.equal(result.imported, 4);
          assert.equal(result.ignored, 1);
          assert.equal(result.newBrands, 1, 'OHUI is created once, for all of them');
          assert.equal(result.createdCategories, 12);
          const skipped = new Map(result.skipped.map((entry) => [entry.id, entry.reasons]));
          assert.deepEqual(skipped.get(stale.id), ['CONFLICT']);
          assert.deepEqual(skipped.get(wrongSku.id), ['SKU_INVALID']);
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
          assert.equal(made.length, 4);
          for (const product of made) {
            assert.equal(product.status, 'PUBLISHED');
            assert.equal(product.brand?.nameVi, 'OHUI');
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
            300_000n,
          );
          assert.equal(byName('Mặt nạ Ohui Mask').category?.nameVi, 'Mặt nạ');
          // One brand, twelve categories, and the unticked one is ignored (with the note), the blocked ones are still open.
          assert.equal(await tx.brand.count({ where: { nameVi: 'OHUI' } }), 1);
          for (const category of ['Làm sạch', 'Khác', 'Bộ sản phẩm/Set']) {
            assert.equal(await tx.productCategory.count({ where: { nameVi: category } }), 1);
          }
          const ignored = await candidateOf(source.id, '3008');
          assert.equal(ignored.state, 'IGNORED');
          assert.match(ignored.decisionNote ?? '', /Bỏ chọn/);
          assert.notEqual((await candidateOf(source.id, '3006')).state, 'IMPORTED');
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

          // Again with the same ids: nothing happens twice (they are decided now); the version moved for the others.
          const second = await imports.importAll(owner.token, {
            import: ids(['3001']),
            ignore: [],
          });
          assert.equal(second.imported, 0);
          assert.deepEqual(second.skipped[0]?.reasons, ['CONFLICT']);
          // The preview now lists only what is still open: the two blockers and the stale one.
          const after = await imports.importAllPreview(owner.token);
          assert.equal(after.total - open, 3);
          assert.equal(after.newBrands.length, 0);
          assert.equal(after.categoriesToCreate.length, 0);
        },
      );
    });
  },
);
