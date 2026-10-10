import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { SupplierSourceItem } from '@lucy-spa/contracts';
import {
  LocalDiskMediaStorage,
  processNextScan,
  processNextSourceTest,
  putProcessedImage,
  processImage,
  recordMediaAsset,
  type HttpClient,
} from '@lucy-spa/server';
import { mediaUsages } from '../website/media.core.js';
import { FakeSite, patternPicture, type FakeProduct } from '../testing/supplier-site-fake.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { SupplierSourceService } from './supplier-source.service.js';

const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);

const permission = (version: number, patch: Record<string, unknown> = {}) => ({
  expectedVersion: version,
  givenBy: 'Chị Hà, quản lý haruohui.com',
  method: 'Tin nhắn Zalo',
  date: threeDaysAgo,
  note: null,
  permitsText: true,
  permitsImages: true,
  permitsPrices: false,
  ...patch,
});

/**
 * Phase 9 P9-4 against real PostgreSQL: the sample scan and the supplier pictures. Owner requirement: a picture is NEVER mixed between
 * products. The scan reads a fake WooCommerce shop (no real site is contacted), keeps each picture with the product id and address it
 * was read from, flags the same file or a near-identical one on another product (both sides, never reassigned), and the database
 * refuses a picture on a candidate that does not own the product it names. Fixtures roll back.
 */
test(
  'Phase 9 P9-4 sample scan and pictures: pictures stay with their product across rescans; flags, limits, permissions and database guards; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const { tx, fails } = base;
      const sources = new SupplierSourceService(base.adapter, base.throttle);
      const manager = await base.staff(['MANAGE_PRODUCTS'], {
        globalCodes: ['MANAGE_SUPPLIER_SOURCES'],
      });
      const reviewer = await base.staff(['MANAGE_PRODUCTS'], {
        globalCodes: ['REVIEW_SUPPLIER_IMPORTS'],
      });
      const storage = new LocalDiskMediaStorage(mkdtempSync(path.join(tmpdir(), 'lucy-p94-')));
      let n = 0;
      const sql = async (statement: string): Promise<string | null> => {
        await tx.$executeRawUnsafe('SAVEPOINT guard');
        try {
          await tx.$executeRawUnsafe(statement);
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT guard');
          return null;
        } catch (error) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT guard');
          return String(Reflect.get(Object(error), 'message') ?? error);
        }
      };
      const versionOf = async (id: string): Promise<number> =>
        (await tx.supplierSource.findUniqueOrThrow({ where: { id }, select: { rowVersion: true } }))
          .rowVersion;
      const healthy = (site: FakeSite): HttpClient => site.client();

      /** A source that is READY and enabled (permission recorded and confirmed, sample tested and confirmed). */
      const readySource = async (
        options: { permits?: Record<string, unknown>; enable?: boolean } = {},
      ): Promise<{ source: SupplierSourceItem; host: string; supplierId: string }> => {
        n += 1;
        const host = `nguon-${n}-${base.run.toLowerCase()}.example.com`;
        let { item } = await sources.create(manager.token, {
          supplierName: `NCC quét ${base.run}`,
          name: `Nguồn quét ${n} ${base.run}`,
          kind: 'WEBSITE',
          baseUrl: `https://${host}/`,
        });
        item = (
          await sources.permission(
            manager.token,
            item.id,
            permission(item.rowVersion, options.permits),
          )
        ).item;
        item = (await sources.confirm(manager.token, item.id, { expectedVersion: item.rowVersion }))
          .item;
        const queued = await sources.requestTest(manager.token, item.id, {
          expectedVersion: item.rowVersion,
        });
        // The Test Source needs a healthy shop with usable products and pictures; any small shop does.
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
        if (options.enable !== false) {
          item = (
            await sources.enable(manager.token, item.id, { expectedVersion: item.rowVersion })
          ).item;
        }
        return { source: item, host, supplierId: item.supplier.id };
      };
      /** Queues a scan, lets the worker function run it against the shop, and returns the finished scan row. */
      const scan = async (sourceId: string, site: FakeSite) => {
        const queued = await sources.requestScan(manager.token, sourceId, {
          expectedVersion: await versionOf(sourceId),
        });
        const outcome = await processNextScan(tx, { createClient: () => healthy(site), storage });
        const rows = await sources.scans(manager.token, sourceId);
        const item = rows.items.find((entry) => entry.id === queued.item.id)!;
        return { outcome, item };
      };
      const shopWith = async (host: string, products: FakeProduct[]): Promise<FakeSite> => {
        const site = new FakeSite();
        for (const product of products) {
          site.add(product);
          for (const picture of [
            ...product.images,
            ...(product.variations ?? []).flatMap((v) => v.images),
          ]) {
            if (!site.files.has(picture))
              site.files.set(
                picture,
                await patternPicture(Number(picture.replace(/\D/g, '')) || 1),
              );
          }
        }
        void host;
        return site;
      };
      /** key -> [sha256 list] of the active pictures of each candidate, by the WooCommerce product id the picture names. */
      const picturesByProduct = async (sourceId: string): Promise<Record<string, string[]>> => {
        const rows = await tx.candidateImage.findMany({
          where: { retiredAt: null, owner: { sourceRecord: { sourceId } } },
          orderBy: [{ sourceProductKey: 'asc' }, { sortOrder: 'asc' }],
          select: { sourceProductKey: true, sha256: true },
        });
        const out: Record<string, string[]> = {};
        for (const row of rows) (out[row.sourceProductKey] ??= []).push(row.sha256);
        return out;
      };
      const candidateOf = async (sourceId: string, key: string) =>
        tx.importCandidate.findFirstOrThrow({
          where: { sources: { some: { sourceRecord: { sourceId, sourceKey: key } } } },
          select: {
            id: true,
            state: true,
            warnings: true,
            nameVi: true,
            nameEn: true,
            needsTranslation: true,
            descriptionVi: true,
          },
        });

      await suite.test(
        'a scan needs authority, an enabled READY source with a confirmed permission, and one scan at a time; the worker re-checks before any request',
        async () => {
          const { source } = await readySource({ enable: false });
          await fails(
            () =>
              sources.requestScan(reviewer.token, source.id, {
                expectedVersion: source.rowVersion,
              }),
            'FORBIDDEN',
          );
          await fails(
            () =>
              sources.requestScan(manager.token, source.id, { expectedVersion: source.rowVersion }),
            'SUPPLIER_SOURCE_NOT_ENABLED',
          );
          await fails(
            () =>
              sources.requestScan(manager.token, source.id, {
                expectedVersion: source.rowVersion - 1,
              }),
            'CONFLICT',
          );
          const enabled = (
            await sources.enable(manager.token, source.id, { expectedVersion: source.rowVersion })
          ).item;
          const queued = await sources.requestScan(manager.token, source.id, {
            expectedVersion: enabled.rowVersion,
          });
          assert.equal(queued.item.status, 'RUNNING');
          assert.equal(queued.item.queued, true);
          assert.equal(queued.item.sampleLimit, 20);
          await fails(
            () =>
              sources.requestScan(manager.token, source.id, {
                expectedVersion: enabled.rowVersion,
              }),
            'SUPPLIER_SOURCE_SCAN_ACTIVE',
          );
          // The source is switched off before the worker looks: no request leaves, the scan fails.
          await sources.disable(manager.token, source.id, { expectedVersion: enabled.rowVersion });
          const site = new FakeSite();
          assert.equal(
            await processNextScan(tx, { createClient: () => site.client(), storage }),
            'FAILED',
          );
          assert.equal(site.urls.length, 0, 'no request left');
          const row = (await sources.scans(manager.token, source.id)).items[0]!;
          assert.equal(row.status, 'FAILED');
          assert.equal(row.errors[0]?.code, 'SOURCE_NOT_READY');
          assert.equal(row.queued, false);
          // A source whose status fell back from READY (a failed re-test) is refused at request time.
          assert.equal(
            await sql(
              `UPDATE supplier_sources SET status = 'SOURCE_ERROR', row_version = row_version + 1 WHERE id = '${source.id}'`,
            ),
            null,
          );
          const faulty = await versionOf(source.id);
          await fails(
            () => sources.requestScan(manager.token, source.id, { expectedVersion: faulty }),
            'SUPPLIER_SOURCE_NOT_READY',
          );
        },
      );

      await suite.test(
        'the first scan: records, reference prices, minimal candidates (English name = Vietnamese, flagged) and each picture with its own product id and address',
        async () => {
          const { source, host, supplierId } = await readySource();
          const site = await shopWith(host, [
            {
              id: 101,
              name: 'Kem dưỡng A',
              sku: 'KD-A',
              images: ['/wp-content/uploads/101.png'],
              priceVnd: 350_000,
            },
            {
              id: 102,
              name: 'Serum B',
              images: ['/wp-content/uploads/102.png'],
              priceVnd: 500_000,
            },
            { id: 103, name: 'Mặt nạ C', images: [] },
          ]);
          const productsBefore = await tx.product.count();
          const { outcome, item } = await scan(source.id, site);
          assert.equal(outcome, 'SUCCEEDED');
          assert.equal(item.counts.discovered, 3);
          assert.equal(item.counts.created, 3);
          assert.equal(item.counts.images, 2);
          assert.equal(item.counts.imageFlags, 0);
          assert.equal(item.queued, false);
          assert.equal(await tx.product.count(), productsBefore, 'nothing becomes a product');
          const a = await candidateOf(source.id, '101');
          assert.equal(a.nameVi, 'Kem dưỡng A');
          assert.equal(a.nameEn, 'Kem dưỡng A');
          assert.equal(a.needsTranslation, true);
          assert.equal(a.state, 'EXTRACTED');
          const record = await tx.sourceRecord.findUniqueOrThrow({
            where: { sourceId_sourceKey: { sourceId: source.id, sourceKey: '101' } },
            select: {
              sku: true,
              url: true,
              priceObservations: {
                select: { priceVnd: true, promoPriceVnd: true, currency: true },
              },
            },
          });
          assert.equal(record.sku, 'KD-A');
          assert.equal(record.url, `https://${host}/san-pham/101/`);
          assert.equal(Number(record.priceObservations[0]?.priceVnd), 350_000);
          const none = await candidateOf(source.id, '103');
          assert.ok(JSON.stringify(none.warnings).includes('IMAGE_MISSING'));
          const images = await tx.candidateImage.findMany({
            where: { owner: { sourceRecord: { sourceId: source.id } } },
            select: {
              sourceProductKey: true,
              sourceUrl: true,
              sha256: true,
              phash: true,
              flag: true,
              variantKey: true,
              sortOrder: true,
              verifiedAt: true,
              mediaAsset: { select: { sha256: true, originalFilename: true, altVi: true } },
              owner: { select: { sourceRecord: { select: { sourceKey: true } } } },
            },
            orderBy: { sourceProductKey: 'asc' },
          });
          assert.equal(images.length, 2);
          assert.deepEqual(
            images.map((i) => i.sourceProductKey),
            ['101', '102'],
          );
          for (const image of images) {
            assert.equal(image.owner.sourceRecord.sourceKey, image.sourceProductKey);
            assert.equal(
              image.sourceUrl,
              `https://${host}/wp-content/uploads/${image.sourceProductKey}.png`,
            );
            assert.equal(image.sha256, image.mediaAsset.sha256);
            assert.match(image.phash ?? '', /^[0-9a-f]{64}$/);
            assert.equal(image.flag, null);
            assert.equal(image.variantKey, null);
            assert.equal(image.sortOrder, 0);
            assert.ok(image.verifiedAt);
          }
          assert.match(images[0]!.mediaAsset.originalFilename, /^kem-duong-a-101-01$/);
          assert.equal(images[0]!.mediaAsset.altVi, 'Kem dưỡng A');
          // Each picture was read from the product's own record, after a second read of the same ids: robots, list, include, two files.
          assert.deepEqual(
            site.urls.map((u) => u.split('?')[0]),
            [
              '/robots.txt',
              '/wp-json/wc/store/v1/products',
              '/wp-json/wc/store/v1/products',
              '/wp-content/uploads/101.png',
              '/wp-content/uploads/102.png',
            ],
          );
          assert.match(site.urls[2] ?? '', /include=101%2C102%2C103/);
          const last = await tx.supplierSource.findUniqueOrThrow({
            where: { id: source.id },
            select: { lastSuccessAt: true },
          });
          assert.ok(last.lastSuccessAt);
          void supplierId;
        },
      );

      await suite.test(
        'rescans: the listing order changes, a rescan reads only the known products, and every picture stays with the product it came from',
        async () => {
          const { source, host } = await readySource();
          const site = await shopWith(host, [
            { id: 201, name: 'Sản phẩm 201', images: ['/wp-content/uploads/201.png'] },
            { id: 202, name: 'Sản phẩm 202', images: ['/wp-content/uploads/202.png'] },
            { id: 203, name: 'Sản phẩm 203', images: ['/wp-content/uploads/203.png'] },
          ]);
          assert.equal((await scan(source.id, site)).outcome, 'SUCCEEDED');
          const before = await picturesByProduct(source.id);
          assert.deepEqual(Object.keys(before), ['201', '202', '203']);
          const rowsBefore = await tx.candidateImage.count({
            where: { owner: { sourceRecord: { sourceId: source.id } } },
          });
          // The shop lists the products the other way round and a new product appears; the rescan ignores the new one (sample only).
          site.reversed = true;
          site.add({ id: 204, name: 'Sản phẩm 204', images: ['/wp-content/uploads/204.png'] });
          site.files.set('/wp-content/uploads/204.png', await patternPicture(204));
          site.urls.length = 0;
          const second = await scan(source.id, site);
          assert.equal(second.outcome, 'SUCCEEDED');
          assert.equal(second.item.counts.discovered, 3);
          assert.equal(second.item.counts.created, 0);
          assert.equal(second.item.counts.unchanged, 3);
          assert.ok(
            site.urls.every((u) => !u.includes('204')),
            'the new product is not read',
          );
          assert.deepEqual(await picturesByProduct(source.id), before, 'no picture moved');
          assert.equal(
            await tx.candidateImage.count({
              where: { owner: { sourceRecord: { sourceId: source.id } } },
            }),
            rowsBefore,
            'no picture was downloaded or added again',
          );
          assert.equal(
            site.urls.filter((u) => u.startsWith('/wp-content')).length,
            0,
            'known pictures are not downloaded twice',
          );
          // A product that stops being returned changes nothing (a removal is a later, guarded decision).
          site.products.delete(202);
          const third = await scan(source.id, site);
          assert.equal(third.item.counts.discovered, 2);
          assert.ok(
            third.item.errors.some((e) => e.code === 'PRODUCT_NOT_RETURNED' && e.key === '202'),
          );
          assert.deepEqual(await picturesByProduct(source.id), before);
          assert.equal(
            (await tx.sourceRecord.findMany({ where: { sourceId: source.id } })).length,
            3,
          );
        },
      );

      await suite.test(
        'two products swap their picture addresses on the shop: nothing moves, the new reading lands on the right product and both sides are flagged as the same file',
        async () => {
          const { source, host } = await readySource();
          const site = await shopWith(host, [
            { id: 301, name: 'Sản phẩm 301', images: ['/wp-content/uploads/301.png'] },
            { id: 302, name: 'Sản phẩm 302', images: ['/wp-content/uploads/302.png'] },
          ]);
          assert.equal((await scan(source.id, site)).outcome, 'SUCCEEDED');
          const before = await picturesByProduct(source.id);
          const originalFor302 = before['302']![0]!;
          site.products.get(301)!.images = ['/wp-content/uploads/302.png'];
          site.products.get(302)!.images = ['/wp-content/uploads/301.png'];
          const after = await scan(source.id, site);
          assert.equal(after.outcome, 'SUCCEEDED');
          assert.equal(after.item.counts.imageChanged, 2);
          // Product 302's ORIGINAL row is untouched on 302 (until the source retires it); nothing was reassigned across products.
          const kept = await tx.candidateImage.findMany({
            where: { owner: { sourceRecord: { sourceId: source.id } } },
            select: {
              sourceProductKey: true,
              sourceUrl: true,
              sha256: true,
              retiredAt: true,
              flag: true,
              owner: { select: { sourceRecord: { select: { sourceKey: true } } } },
            },
            orderBy: [{ sourceProductKey: 'asc' }, { createdAt: 'asc' }],
          });
          for (const row of kept)
            assert.equal(row.owner.sourceRecord.sourceKey, row.sourceProductKey);
          const of301 = kept.filter((row) => row.sourceProductKey === '301');
          const of302 = kept.filter((row) => row.sourceProductKey === '302');
          assert.equal(of301.length, 2);
          assert.equal(of302.length, 2);
          assert.ok(
            of301[0]!.retiredAt !== null && of301[1]!.retiredAt === null,
            'the old picture of 301 is retired, the new one is active',
          );
          assert.ok(of302[0]!.retiredAt !== null && of302[1]!.retiredAt === null);
          assert.equal(of301[1]!.sourceUrl, `https://${host}/wp-content/uploads/302.png`);
          assert.equal(
            of301[1]!.sha256,
            originalFor302,
            'the file is the very file product 302 had',
          );
          // Whichever product is read second, both sides are flagged: a file another product held a moment ago (even a retired
          // picture) is the clearest sign of a mix-up, so every one of the four pictures carries the flag.
          for (const row of [...of301, ...of302]) assert.equal(row.flag, 'SAME_FILE');
          for (const key of ['301', '302']) {
            const candidate = await candidateOf(source.id, key);
            assert.equal(candidate.state, 'NEEDS_REVIEW');
            assert.ok(JSON.stringify(candidate.warnings).includes('IMAGE_SHARED'));
          }
        },
      );

      await suite.test(
        'the same file on two products of one scan, and a near-identical copy: both products are flagged, nothing is merged or reassigned',
        async () => {
          const { source, host } = await readySource();
          const site = new FakeSite();
          site.add({ id: 401, name: 'Sản phẩm 401', images: ['/wp-content/uploads/a-401.png'] });
          site.add({ id: 402, name: 'Sản phẩm 402', images: ['/wp-content/uploads/a-402.png'] });
          site.add({ id: 403, name: 'Sản phẩm 403', images: ['/wp-content/uploads/a-403.jpg'] });
          site.add({ id: 404, name: 'Sản phẩm 404', images: ['/wp-content/uploads/a-404.png'] });
          const same = await patternPicture(7);
          site.files.set('/wp-content/uploads/a-401.png', same);
          site.files.set('/wp-content/uploads/a-402.png', same);
          site.files.set('/wp-content/uploads/a-403.jpg', await patternPicture(7, 'jpeg'));
          site.files.set('/wp-content/uploads/a-404.png', await patternPicture(99));
          void host;
          const { outcome } = await scan(source.id, site);
          assert.equal(outcome, 'SUCCEEDED');
          const pics = await picturesByProduct(source.id);
          assert.deepEqual(Object.keys(pics), ['401', '402', '403', '404']);
          assert.equal(pics['401']![0], pics['402']![0], 'the identical file is one library asset');
          const flags = Object.fromEntries(
            (
              await tx.candidateImage.findMany({
                where: { owner: { sourceRecord: { sourceId: source.id } } },
                select: { sourceProductKey: true, flag: true },
              })
            ).map((row) => [row.sourceProductKey, row.flag]),
          );
          assert.equal(flags['401'], 'SAME_FILE');
          assert.equal(flags['402'], 'SAME_FILE');
          assert.equal(flags['403'], 'SIMILAR', 'a near-identical copy of the same photo');
          assert.equal(flags['404'], null, 'a different picture is not flagged');
          // The scan counts distinct pictures that were flagged, not flag events.
          const row = (await sources.scans(manager.token, source.id)).items[0]!;
          assert.equal(row.counts.imageFlags, 3);
          for (const key of ['401', '402', '403']) {
            assert.equal((await candidateOf(source.id, key)).state, 'NEEDS_REVIEW', key);
          }
          assert.equal((await candidateOf(source.id, '404')).state, 'EXTRACTED');
          // Every picture still belongs to the product that listed it.
          const rows = await tx.candidateImage.findMany({
            where: { owner: { sourceRecord: { sourceId: source.id } } },
            select: { sourceProductKey: true, sourceUrl: true },
          });
          for (const row of rows)
            assert.ok(
              row.sourceUrl.endsWith(
                `-${row.sourceProductKey}.${row.sourceUrl.endsWith('.jpg') ? 'jpg' : 'png'}`,
              ),
            );
        },
      );

      await suite.test(
        'a picture already used by a Lucy catalog product is flagged on the candidate, and the media library says the picture is in use',
        async () => {
          const { source, host } = await readySource();
          const bytes = await patternPicture(55);
          const image = await processImage(bytes);
          const stored = await putProcessedImage(storage, image);
          const recorded = await recordMediaAsset(tx, {
            image,
            stored,
            filename: 'catalog',
            altVi: null,
            altEn: null,
            createdByUserId: manager.id,
          });
          const product = await tx.product.create({
            data: {
              code: `p94-${base.run.toLowerCase()}`,
              nameVi: 'Hàng có sẵn',
              nameEn: 'Existing',
              createdByUserId: manager.id,
            },
            select: { id: true },
          });
          await tx.productImage.create({
            data: { productId: product.id, mediaAssetId: recorded.id, createdByUserId: manager.id },
          });
          const site = new FakeSite();
          site.add({ id: 501, name: 'Sản phẩm 501', images: ['/wp-content/uploads/501.png'] });
          site.files.set('/wp-content/uploads/501.png', bytes);
          void host;
          assert.equal((await scan(source.id, site)).outcome, 'SUCCEEDED');
          const row = await tx.candidateImage.findFirstOrThrow({
            where: { sourceProductKey: '501' },
            select: { flag: true, mediaAssetId: true },
          });
          assert.equal(row.flag, 'CATALOG_SAME_FILE');
          assert.equal(row.mediaAssetId, recorded.id, 'the library file is reused, not copied');
          assert.equal((await candidateOf(source.id, '501')).state, 'NEEDS_REVIEW');
          const usage = await mediaUsages(tx, recorded.id);
          assert.deepEqual(usage.map((entry) => entry.kind).sort(), [
            'IMPORT_CANDIDATE',
            'PRODUCT',
          ]);
        },
      );

      await suite.test(
        'the second read of the product disagrees with the list: no picture is downloaded for it and the scan says why',
        async () => {
          const { source, host } = await readySource();
          const site = await shopWith(host, [
            { id: 601, name: 'Sản phẩm 601', images: ['/wp-content/uploads/601.png'] },
            { id: 602, name: 'Sản phẩm 602', images: ['/wp-content/uploads/602.png'] },
          ]);
          site.files.set('/wp-content/uploads/999.png', await patternPicture(999));
          // The by-id/include read of 601 lists another picture than the list did.
          site.rereadOverride = (product) =>
            product.id === 601 ? { ...product, images: ['/wp-content/uploads/999.png'] } : product;
          const { outcome, item } = await scan(source.id, site);
          assert.equal(outcome, 'PARTIAL');
          assert.ok(
            item.errors.some((e) => e.code === 'IMAGE_PROVENANCE_MISMATCH' && e.key === '601'),
          );
          assert.equal(
            (await picturesByProduct(source.id))['601'],
            undefined,
            'nothing downloaded for 601',
          );
          assert.equal(
            (await picturesByProduct(source.id))['602']?.length,
            1,
            'the other product is unaffected',
          );
          assert.ok(!site.urls.some((u) => u.includes('601.png')));
          // A product the second read does not return at all gets no picture either.
          const { source: other, host: otherHost } = await readySource();
          const site2 = await shopWith(otherHost, [
            { id: 611, name: 'Sản phẩm 611', images: ['/wp-content/uploads/611.png'] },
          ]);
          site2.rereadOverride = () => null;
          const second = await scan(other.id, site2);
          assert.ok(
            second.item.errors.some(
              (e) => e.code === 'IMAGE_PROVENANCE_UNVERIFIED' && e.key === '611',
            ),
          );
          assert.deepEqual(await picturesByProduct(other.id), {});
        },
      );

      await suite.test(
        'variants: a variation picture stays on its variant, a variation that reuses the product picture adds nothing, a variation of another product is refused',
        async () => {
          const { source, host } = await readySource();
          const site = await shopWith(host, [
            {
              id: 701,
              name: 'Sản phẩm biến thể',
              type: 'variable',
              images: ['/wp-content/uploads/701.png'],
              variations: [
                { id: 7011, images: ['/wp-content/uploads/7011.png'] },
                { id: 7012, images: ['/wp-content/uploads/701.png'] },
                { id: 7013, images: ['/wp-content/uploads/7013.png'], parent: 999 },
              ],
            },
          ]);
          const { outcome, item } = await scan(source.id, site);
          assert.equal(outcome, 'PARTIAL');
          const rows = await tx.candidateImage.findMany({
            where: { owner: { sourceRecord: { sourceId: source.id } }, retiredAt: null },
            select: { sourceUrl: true, variantKey: true, sourceProductKey: true, sortOrder: true },
            orderBy: { sortOrder: 'asc' },
          });
          assert.deepEqual(
            rows.map((row) => [
              row.sourceUrl.split('/').pop(),
              row.variantKey,
              row.sourceProductKey,
            ]),
            [
              ['701.png', null, '701'],
              ['7011.png', '7011', '701'],
            ],
          );
          assert.ok(
            item.errors.some((e) => e.code === 'VARIATION_MISMATCH' && e.detail === '7013'),
          );
        },
      );

      await suite.test(
        'at most six pictures a product, placeholders are not pictures, a failed file is reported and does not stop the others',
        async () => {
          const { source, host } = await readySource();
          const many = Array.from({ length: 8 }, (_, i) => `/wp-content/uploads/m${i + 1}.png`);
          const site = await shopWith(host, [
            { id: 801, name: 'Nhiều ảnh', images: many },
            {
              id: 802,
              name: 'Ảnh giả',
              images: ['/wp-content/uploads/woocommerce-placeholder.png'],
            },
            {
              id: 803,
              name: 'Ảnh hỏng',
              images: [
                '/wp-content/uploads/broken.png',
                '/wp-content/uploads/gone.png',
                '/wp-content/uploads/good.png',
              ],
            },
          ]);
          site.files.set(
            '/wp-content/uploads/woocommerce-placeholder.png',
            await patternPicture(1),
          );
          site.files.set(
            '/wp-content/uploads/broken.png',
            Buffer.from('<html>not a picture</html>'),
          );
          site.files.set('/wp-content/uploads/gone.png', { status: 404, body: Buffer.from('') });
          site.files.set('/wp-content/uploads/good.png', await patternPicture(808));
          const { outcome, item } = await scan(source.id, site);
          assert.equal(outcome, 'PARTIAL');
          const pics = await picturesByProduct(source.id);
          assert.equal(pics['801']?.length, 6);
          assert.equal(pics['802'], undefined, 'a placeholder is never stored');
          assert.equal(pics['803']?.length, 1);
          assert.ok(!site.urls.some((u) => u.includes('placeholder')));
          assert.ok(
            item.errors.some((e) => e.code === 'MEDIA_TYPE_UNSUPPORTED' && e.key === '803'),
          );
          assert.ok(item.errors.some((e) => e.code === 'IMAGE_HTTP_STATUS' && e.detail === '404'));
          const failed = await candidateOf(source.id, '803');
          assert.ok(JSON.stringify(failed.warnings).includes('IMAGE_FAILED'));
          assert.ok(
            JSON.stringify((await candidateOf(source.id, '802')).warnings).includes(
              'IMAGE_MISSING',
            ),
          );
          assert.equal(
            await tx.candidateImage.count({
              where: { sourceProductKey: '801', retiredAt: null, sortOrder: { gt: 5 } },
            }),
            0,
          );
        },
      );

      await suite.test(
        'the permission decides what is kept: without picture permission no picture is requested; without text permission only the name and identifiers are stored',
        async () => {
          const textOnly = await readySource({ permits: { permitsImages: false } });
          const siteA = await shopWith(textOnly.host, [
            { id: 901, name: 'Chỉ chữ', images: ['/wp-content/uploads/901.png'] },
          ]);
          assert.equal((await scan(textOnly.source.id, siteA)).outcome, 'SUCCEEDED');
          assert.ok(
            !siteA.urls.some((u) => u.startsWith('/wp-content')),
            'no picture was requested',
          );
          assert.deepEqual(await picturesByProduct(textOnly.source.id), {});
          const record = await tx.sourceRecord.findFirstOrThrow({
            where: { sourceId: textOnly.source.id },
            select: { descriptionText: true },
          });
          assert.equal(record.descriptionText, 'Mô tả');
          const imagesOnly = await readySource({ permits: { permitsText: false } });
          const siteB = await shopWith(imagesOnly.host, [
            { id: 902, name: 'Chỉ ảnh', images: ['/wp-content/uploads/902.png'] },
          ]);
          assert.equal((await scan(imagesOnly.source.id, siteB)).outcome, 'SUCCEEDED');
          const bare = await tx.sourceRecord.findFirstOrThrow({
            where: { sourceId: imagesOnly.source.id },
            select: { name: true, descriptionText: true, brandText: true, categoryPath: true },
          });
          assert.equal(bare.name, 'Chỉ ảnh');
          assert.equal(bare.descriptionText, null);
          assert.deepEqual(bare.categoryPath, []);
          assert.equal((await candidateOf(imagesOnly.source.id, '902')).descriptionVi, null);
          assert.equal((await picturesByProduct(imagesOnly.source.id))['902']?.length, 1);
        },
      );

      await suite.test(
        'the sample is at most 20 products, a decided candidate keeps its pictures, a robots.txt that disallows stops everything, a lost worker fails after its lease',
        async () => {
          const { source, host } = await readySource();
          const products: FakeProduct[] = Array.from({ length: 25 }, (_, i) => ({
            id: 1000 + i,
            name: `Hàng ${i}`,
            images: [],
          }));
          const site = await shopWith(host, products);
          const first = await scan(source.id, site);
          assert.equal(first.item.counts.discovered, 20);
          assert.equal(await tx.sourceRecord.count({ where: { sourceId: source.id } }), 20);
          assert.match(site.urls[1] ?? '', /per_page=20/);
          // The database refuses a 21st product whatever the code does.
          const scanRow = await tx.importScan.findFirstOrThrow({
            where: { sourceId: source.id },
            select: { id: true },
          });
          assert.match(
            (await sql(
              `INSERT INTO source_records (source_id, source_key, url, name, content_hash, first_seen_scan_id, last_seen_scan_id) VALUES ('${source.id}', 'x21', 'https://${host}/x/', 'Thứ 21', '${'a'.repeat(64)}', '${scanRow.id}', '${scanRow.id}')`,
            )) ?? '',
            /at most 20 sampled products/,
          );
          // A decided candidate keeps its pictures.
          const imageSource = await readySource();
          const imageSite = await shopWith(imageSource.host, [
            { id: 1101, name: 'Đã duyệt', images: ['/wp-content/uploads/1101.png'] },
          ]);
          await scan(imageSource.source.id, imageSite);
          const decided = await candidateOf(imageSource.source.id, '1101');
          await tx.importCandidate.update({
            where: { id: decided.id },
            data: {
              state: 'APPROVED',
              decidedByUserId: manager.id,
              decidedAt: new Date(),
              rowVersion: { increment: 1 },
            },
          });
          const before = await picturesByProduct(imageSource.source.id);
          imageSite.products.get(1101)!.images = ['/wp-content/uploads/1102.png'];
          imageSite.files.set('/wp-content/uploads/1102.png', await patternPicture(1102));
          await scan(imageSource.source.id, imageSite);
          assert.deepEqual(await picturesByProduct(imageSource.source.id), before);
          assert.ok(!imageSite.urls.some((u) => u.includes('1102.png')), 'not even downloaded');
          // robots.txt that disallows: the scan fails after reading it, nothing else is requested.
          const closed = await readySource();
          const closedSite = new FakeSite();
          closedSite.robots = 'User-agent: *\nDisallow: /';
          const blocked = await scan(closed.source.id, closedSite);
          assert.equal(blocked.outcome, 'FAILED');
          assert.deepEqual(closedSite.urls, ['/robots.txt']);
          assert.equal(blocked.item.errors[0]?.code, 'ROBOTS_DISALLOWED');
          // A lost worker: the claimed scan's lease ran out.
          const lost = await readySource();
          const queued = await sources.requestScan(manager.token, lost.source.id, {
            expectedVersion: await versionOf(lost.source.id),
          });
          await sql(
            `UPDATE import_scans SET claimed_at = clock_timestamp(), lease_expires_at = clock_timestamp() - interval '1 minute' WHERE id = '${queued.item.id}'`,
          );
          assert.equal(
            await processNextScan(tx, { createClient: () => new FakeSite().client(), storage }),
            null,
          );
          const row = (await sources.scans(manager.token, lost.source.id)).items[0]!;
          assert.equal(row.status, 'FAILED');
          assert.equal(row.errors[0]?.code, 'WORKER_LOST');
        },
      );

      await suite.test(
        'the database keeps a picture on its own product: a foreign source record, a wrong product key, six positions, immutability and history',
        async () => {
          const { source, host } = await readySource();
          const site = await shopWith(host, [
            { id: 1201, name: 'Sản phẩm 1201', images: ['/wp-content/uploads/1201.png'] },
            { id: 1202, name: 'Sản phẩm 1202', images: ['/wp-content/uploads/1202.png'] },
          ]);
          await scan(source.id, site);
          const records = Object.fromEntries(
            (
              await tx.sourceRecord.findMany({
                where: { sourceId: source.id },
                select: {
                  id: true,
                  sourceKey: true,
                  candidateLink: { select: { candidateId: true } },
                },
              })
            ).map((row) => [row.sourceKey, row]),
          );
          const a = records['1201']!;
          const b = records['1202']!;
          const asset = await tx.candidateImage.findFirstOrThrow({
            where: { sourceProductKey: '1201' },
            select: { mediaAssetId: true, id: true },
          });
          const spare = await processImage(await patternPicture(4242));
          const spareAsset = await recordMediaAsset(tx, {
            image: spare,
            stored: await putProcessedImage(storage, spare),
            filename: 'spare',
            altVi: null,
            altEn: null,
            createdByUserId: manager.id,
          });
          const insert = (
            candidateId: string,
            recordId: string,
            key: string,
            position: number,
            extra = '',
            assetId = spareAsset.id,
          ) =>
            `INSERT INTO candidate_images (candidate_id, media_asset_id, source_url, sort_order, sha256, source_record_id, source_product_key${extra ? ', ' + extra.split('=')[0] : ''}) VALUES ('${candidateId}', '${assetId}', 'https://${host}/x.png', ${position}, '${'e'.repeat(64)}', '${recordId}', '${key}'${extra ? ', ' + extra.split('=')[1] : ''})`;
          // A picture of product 1202's record on candidate 1201 is impossible: the pair is not a link.
          assert.match(
            (await sql(insert(a.candidateLink!.candidateId, b.id, '1202', 3))) ?? '',
            /candidate_images_owner_fkey/,
          );
          // The product key must be the record's own.
          assert.match(
            (await sql(insert(a.candidateLink!.candidateId, a.id, '1202', 3))) ?? '',
            /names a product other than the source record/,
          );
          // Position and file are unique among the active pictures; the position is 0..5.
          assert.match(
            (await sql(insert(a.candidateLink!.candidateId, a.id, '1201', 0))) ?? '',
            /candidate_images_position_key/,
          );
          assert.match(
            (await sql(
              insert(a.candidateLink!.candidateId, a.id, '1201', 3, '', asset.mediaAssetId),
            )) ?? '',
            /candidate_images_asset_key/,
          );
          assert.match(
            (await sql(insert(a.candidateLink!.candidateId, a.id, '1201', 6))) ?? '',
            /candidate_images_position/,
          );
          // History: no delete, nothing but the flag and the retirement changes, a retired picture stays retired.
          assert.match(
            (await sql(`DELETE FROM candidate_images WHERE id = '${asset.id}'`)) ?? '',
            /retired, never deleted/,
          );
          assert.match(
            (await sql(`UPDATE candidate_images SET sort_order = 4 WHERE id = '${asset.id}'`)) ??
              '',
            /only its flag and its retirement/,
          );
          assert.match(
            (await sql(
              `UPDATE candidate_images SET source_url = 'https://${host}/other.png' WHERE id = '${asset.id}'`,
            )) ?? '',
            /only its flag and its retirement/,
          );
          assert.equal(
            await sql(`UPDATE candidate_images SET flag = 'SIMILAR' WHERE id = '${asset.id}'`),
            null,
          );
          assert.match(
            (await sql(`UPDATE candidate_images SET flag = 'WHATEVER' WHERE id = '${asset.id}'`)) ??
              '',
            /candidate_images_flag/,
          );
          assert.equal(
            await sql(
              `UPDATE candidate_images SET retired_at = clock_timestamp() WHERE id = '${asset.id}'`,
            ),
            null,
          );
          assert.match(
            (await sql(`UPDATE candidate_images SET retired_at = NULL WHERE id = '${asset.id}'`)) ??
              '',
            /stays retired/,
          );
          // A media asset a candidate picture keeps cannot be deleted from the library.
          assert.match(
            (await sql(`DELETE FROM media_assets WHERE id = '${asset.mediaAssetId}'`)) ?? '',
            /candidate_images_media_asset_id_fkey|violates foreign key/,
          );
          // The address must be https.
          assert.match(
            (await sql(
              insert(b.candidateLink!.candidateId, b.id, '1202', 5).replace(
                `https://${host}/x.png`,
                'http://x.test/x.png',
              ),
            )) ?? '',
            /candidate_images_url/,
          );
          void randomUUID;
        },
      );
    });
  },
);
