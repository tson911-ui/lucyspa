import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildZip, LocalDiskMediaStorage } from '@lucy-spa/server';
import { patternPicture } from '../testing/supplier-site-fake.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { ProductImageZipService } from './image-zip.service.js';
import { ProductImportService } from './import.service.js';

const strToU8 = (text: string) => new TextEncoder().encode(text);
const BOM = String.fromCharCode(0xfeff);
const csv = (lines: string[]) => ({
  buffer: Buffer.from(`${BOM}${lines.join('\r\n')}\r\n`, 'utf8'),
  originalname: 'gia.csv',
});

/**
 * Phase 9 P9-8 against real PostgreSQL: the bulk price update (export, edit, re-import, preview of the differences, confirm) and the
 * bulk pictures from a ZIP named after the SKU. Prices change only after a preview and an explicit confirm by a holder of
 * MANAGE_PRODUCT_PRICES; pictures are only added. Fixtures roll back.
 */
test(
  'Phase 9 P9-8 bulk prices and bulk pictures: authority, preview before apply, stale refusal, add-only pictures; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (kit) => {
      const { tx, run, fails } = kit;
      const imports = new ProductImportService(kit.adapter, kit.throttle, kit.environment);
      const storage = new LocalDiskMediaStorage(mkdtempSync(path.join(tmpdir(), 'lucy-p98-')));
      const zips = new ProductImageZipService(kit.adapter, kit.throttle, storage);
      const plain = await kit.staff(['IMPORT_PRODUCT_DATA']);
      const pricer = await kit.staff(['IMPORT_PRODUCT_DATA', 'MANAGE_PRODUCT_PRICES']);
      const manager = await kit.staff(['MANAGE_PRODUCTS']);
      const importer = await kit.staff(['IMPORT_PRODUCT_DATA', 'MANAGE_PRODUCTS']);
      const owner = await kit.staff([
        'IMPORT_PRODUCT_DATA',
        'MANAGE_PRODUCTS',
        'MANAGE_PRODUCT_PRICES',
      ]);
      const sku = (suffix: string) => `P98${run}${suffix}`;

      const make = async (
        suffix: string,
        price: bigint | null,
        status: 'DRAFT' | 'PUBLISHED' = 'DRAFT',
      ) => {
        const product = await tx.product.create({
          data: {
            code: `p98-${suffix.toLowerCase()}-${run.toLowerCase()}`,
            nameVi: `Sản phẩm ${suffix} ${run}`,
            nameEn: `Product ${suffix} ${run}`,
            createdByUserId: manager.id,
            variants: { create: [{ sku: sku(suffix), labelVi: null }] },
          },
          include: { variants: true },
        });
        const variant = product.variants[0]!;
        if (price !== null) {
          await tx.productPriceVersion.create({
            data: {
              variantId: variant.id,
              versionNo: 1,
              listPriceVnd: price,
              createdByUserId: manager.id,
            },
          });
        }
        // A product starts as a draft; the published one is published afterwards.
        if (status === 'PUBLISHED') {
          await tx.product.update({
            where: { id: product.id },
            data: { status: 'PUBLISHED', rowVersion: 2 },
          });
        }
        return { product, variant };
      };
      const A = await make('A', 100_000n);
      const B = await make('B', 200_000n);
      const C = await make('C', 300_000n);
      const D = await make('D', null);
      const latest = async (variantId: string) =>
        tx.productPriceVersion.findFirst({
          where: { variantId },
          orderBy: { versionNo: 'desc' },
          select: { versionNo: true, listPriceVnd: true },
        });

      await suite.test(
        'the price export needs both the import and the price permission and lists the current prices; the price kind is refused without price authority',
        async () => {
          await fails(() => imports.exportPrices(plain.token, 'csv', 'vi'), 'FORBIDDEN');
          await fails(() => imports.exportPrices(manager.token, 'csv', 'vi'), 'FORBIDDEN');
          await fails(
            () => imports.exportPrices(pricer.token, 'pdf', 'vi'),
            'VALIDATION_FAILED',
            'format',
          );
          const file = await imports.exportPrices(pricer.token, 'csv', 'vi');
          assert.equal(file.filename, 'bang-gia.csv');
          const text = Buffer.from(file.bytes).toString('utf8').replace(BOM, '');
          const lines = text.trim().split('\r\n');
          assert.equal(lines[0], 'Mã SKU,Tên sản phẩm,Giá bán (₫)');
          assert.ok(lines.includes(`${sku('A')},Sản phẩm A ${run},100000`));
          assert.ok(
            lines.includes(`${sku('D')},Sản phẩm D ${run},`),
            'no price yet: an empty cell',
          );
          const xlsx = await imports.exportPrices(pricer.token, 'xlsx', 'en');
          assert.equal(xlsx.filename, 'price-list.xlsx');
          assert.ok(xlsx.bytes.length > 500);
          // Without the price permission not even a preview is made.
          await fails(
            () =>
              imports.upload(plain.token, csv(['sku,price', `${sku('A')},120000`]), {
                kind: 'PRICE_UPDATE',
              }),
            'FORBIDDEN',
          );
          await fails(
            () =>
              imports.upload(pricer.token, csv(['sku,name', `${sku('A')},x`]), {
                kind: 'PRICE_UPDATE',
              }),
            'IMPORT_FILE_INVALID',
            'missingPrice',
          );
        },
      );

      await suite.test(
        'preview shows only differences and writes nothing; apply makes numbered price versions with the old ones kept; a price changed in between makes the preview stale',
        async () => {
          const before = await tx.productPriceVersion.count();
          const job = await imports.upload(
            pricer.token,
            csv([
              'sku,name,price',
              `${sku('A')},ignored,120000`, // changes
              `${sku('B')},ignored,200000`, // unchanged
              `${sku('C')},ignored,abc`, // invalid
              `${sku('D')},ignored,50000`, // first price
              `NOPE${run},ignored,10000`, // unknown SKU
              `${sku('A')},ignored,130000`, // duplicate in file
            ]),
            { kind: 'PRICE_UPDATE' },
          );
          assert.equal(await tx.productPriceVersion.count(), before, 'a preview writes nothing');
          assert.deepEqual(
            [job.rowCount, job.validCount, job.invalidCount, job.updateCount, job.unchangedCount],
            [6, 3, 3, 2, 1],
          );
          const row = (n: number) => job.rows.find((r) => r.rowNo === n)!;
          assert.deepEqual(row(2).changes, ['price']);
          assert.equal(row(2).cells['current_price'], '100000');
          assert.equal(row(3).action, 'NONE');
          assert.equal(row(4).errors[0]?.code, 'PRICE_INVALID');
          assert.equal(row(6).errors[0]?.code, 'VARIANT_NOT_FOUND');
          assert.equal(row(7).errors[0]?.code, 'SKU_DUPLICATE_IN_FILE');
          // Invalid rows are skipped only on request.
          await fails(
            () =>
              imports.apply(pricer.token, job.id, {
                expectedRowVersion: job.rowVersion,
                skipInvalid: false,
              }),
            'VALIDATION_FAILED',
            'skipInvalid',
          );
          // Another person changes the price of A after the preview.
          await tx.productPriceVersion.create({
            data: {
              variantId: A.variant.id,
              versionNo: 2,
              listPriceVnd: 110_000n,
              createdByUserId: manager.id,
            },
          });
          await fails(
            () =>
              imports.apply(pricer.token, job.id, {
                expectedRowVersion: job.rowVersion,
                skipInvalid: true,
              }),
            'IMPORT_PREVIEW_STALE',
          );
          assert.equal((await latest(A.variant.id))?.listPriceVnd, 110_000n, 'nothing was written');

          // A fresh preview and a confirm by a person without the price permission is refused.
          const again = await imports.upload(
            pricer.token,
            csv(['sku,price', `${sku('A')},120000`, `${sku('D')},50000`, `${sku('B')},200000`]),
            { kind: 'PRICE_UPDATE' },
          );
          assert.deepEqual(
            [again.updateCount, again.unchangedCount, again.invalidCount],
            [2, 1, 0],
          );
          await fails(
            () =>
              imports.apply(plain.token, again.id, {
                expectedRowVersion: again.rowVersion,
                skipInvalid: false,
              }),
            'FORBIDDEN',
          );
          const applied = await imports.apply(pricer.token, again.id, {
            expectedRowVersion: again.rowVersion,
            skipInvalid: false,
          });
          assert.equal(applied.status, 'APPLIED');
          assert.deepEqual(
            [(await latest(A.variant.id))?.versionNo, (await latest(A.variant.id))?.listPriceVnd],
            [3, 120_000n],
          );
          assert.deepEqual(
            [(await latest(D.variant.id))?.versionNo, (await latest(D.variant.id))?.listPriceVnd],
            [1, 50_000n],
          );
          assert.equal(
            (await latest(B.variant.id))?.versionNo,
            1,
            'an unchanged price makes no version',
          );
          assert.equal(
            await tx.productPriceVersion.count({ where: { variantId: A.variant.id } }),
            3,
            'the history is kept',
          );
          const audit = await tx.auditEvent.count({
            where: {
              action: 'PRODUCT_PRICE_CHANGED',
              entityId: { in: [A.variant.id, D.variant.id] },
            },
          });
          assert.ok(audit >= 2);
          // A price at or below a running promotion is refused in the preview.
          await tx.productPromotion.create({
            data: {
              variantId: C.variant.id,
              promoPriceVnd: 250_000n,
              startsAt: new Date(Date.now() - 86_400_000),
              endsAt: new Date(Date.now() + 86_400_000 * 5),
              createdByUserId: manager.id,
            },
          });
          const low = await imports.upload(pricer.token, csv(['sku,price', `${sku('C')},240000`]), {
            kind: 'PRICE_UPDATE',
          });
          assert.equal(low.rows[0]!.errors[0]?.code, 'PRICE_BELOW_PROMOTION');
        },
      );

      const png = async (seed: number) => Buffer.from(await patternPicture(seed));
      const archive = (files: Record<string, Uint8Array>) => ({
        buffer: Buffer.from(buildZip(files)),
      });

      await suite.test(
        'ZIP pictures: preview then apply with the same file; named after the SKU; ambiguous and unknown names are skipped, never guessed',
        async () => {
          const E = await make('E', 10_000n);
          const F = await make('F', 10_000n, 'PUBLISHED');
          // A SKU that itself ends in "-2": its file name has two readings, only one of which exists.
          const G = await make('G-2', 10_000n);
          const H = await make('G', 10_000n);
          const files = {
            [`${sku('E')}-1.png`]: await png(11),
            [`${sku('E')}-2.png`]: await png(12),
            [`${sku('F')}.png`]: await png(13),
            [`folder/${sku('A')}-1.png`]: await png(14),
            [`${sku('G-2')}.png`]: await png(15),
            [`UNKNOWN${run}-1.png`]: await png(16),
            'notes.txt': strToU8('hello'),
            '__MACOSX/._x.png': await png(17),
            [`${sku('E')}-3.png`]: strToU8('this is not a picture'),
          };
          const zip = archive(files);
          await fails(() => zips.preview(plain.token, zip), 'FORBIDDEN');
          await fails(() => zips.preview(manager.token, zip), 'FORBIDDEN');
          await fails(() => zips.preview(importer.token, undefined), 'VALIDATION_FAILED', 'file');
          await fails(
            () => zips.preview(importer.token, { buffer: Buffer.from('not a zip') }),
            'IMPORT_FILE_INVALID',
            'corrupt',
          );
          const imagesBefore = await tx.productImage.count();
          const preview = await zips.preview(importer.token, zip);
          assert.equal(await tx.productImage.count(), imagesBefore, 'a preview saves nothing');
          const by = (name: string) => preview.items.find((item) => item.fileName === name)!;
          assert.equal(by(`${sku('E')}-1.png`).status, 'READY');
          assert.equal(by(`${sku('E')}-2.png`).position, 2);
          assert.equal(by(`${sku('E')}-3.png`).reason, 'NOT_AN_IMAGE');
          assert.equal(by(`UNKNOWN${run}-1.png`).reason, 'SKU_NOT_FOUND');
          assert.equal(by(`${sku('F')}.png`).product?.published, true);
          assert.equal(by(`${sku('A')}-1.png`).sku, sku('A'), 'a folder in the archive is ignored');
          // "<run>G-2": the reading SKU "G" position 2 exists, and so does the SKU "G-2": two products, never guessed.
          assert.equal(by(`${sku('G-2')}.png`).reason, 'SKU_AMBIGUOUS');
          assert.equal(
            preview.items.some(
              (item) => item.fileName.includes('notes') || item.fileName.includes('._x'),
            ),
            false,
          );
          assert.equal(preview.publishedPictures, 1);
          assert.equal(preview.ready, 4);
          assert.equal(preview.sha256.length, 64);
          void G;
          void H;

          // The apply needs the same file and an explicit word about published products.
          await fails(
            () =>
              zips.apply(importer.token, zip, { sha256: '0'.repeat(64), allowPublished: 'false' }),
            'IMPORT_PREVIEW_STALE',
          );
          await fails(
            () =>
              zips.apply(importer.token, zip, { sha256: preview.sha256, allowPublished: 'maybe' }),
            'VALIDATION_FAILED',
            'allowPublished',
          );
          const applied = await zips.apply(importer.token, zip, {
            sha256: preview.sha256,
            allowPublished: 'false',
          });
          assert.equal(
            applied.added,
            3,
            'two for E and one for A; the published product is left alone',
          );
          assert.equal(
            applied.items.find((item) => item.fileName === `${sku('F')}.png`)?.reason,
            'PUBLISHED_NOT_ALLOWED',
          );
          const imagesOf = (productId: string) =>
            tx.productImage.findMany({
              where: { productId },
              orderBy: { sortOrder: 'asc' },
              select: { sortOrder: true, mediaAsset: { select: { altVi: true, width: true } } },
            });
          assert.deepEqual(
            (await imagesOf(E.product.id)).map((i) => i.sortOrder),
            [0, 1],
          );
          assert.equal((await imagesOf(E.product.id))[0]!.mediaAsset.altVi, `Sản phẩm E ${run}`);
          assert.equal((await imagesOf(F.product.id)).length, 0);
          assert.equal((await imagesOf(A.product.id)).length, 1);

          // Add-only: the same archive again adds nothing and removes nothing; a published product only with the explicit word.
          const second = await zips.preview(importer.token, zip);
          assert.equal(
            second.items.find((item) => item.fileName === `${sku('E')}-1.png`)?.reason,
            'ALREADY_ON_PRODUCT',
          );
          const again = await zips.apply(importer.token, zip, {
            sha256: second.sha256,
            allowPublished: 'true',
          });
          assert.equal(again.added, 1, 'only the published product is new this time');
          assert.equal((await imagesOf(F.product.id)).length, 1);
          assert.equal((await imagesOf(E.product.id)).length, 2);
          // The next picture lands after the existing ones.
          const third = archive({ [`${sku('E')}-1.png`]: await png(21) });
          const t = await zips.preview(importer.token, third);
          await zips.apply(importer.token, third, { sha256: t.sha256, allowPublished: 'false' });
          assert.deepEqual(
            (await imagesOf(E.product.id)).map((i) => i.sortOrder),
            [0, 1, 2],
          );
          void owner;
        },
      );

      await suite.test(
        'ZIP limits: too many pictures, an archive that declares too much inside and an empty one are refused before anything is inflated',
        async () => {
          const tiny = await png(31);
          const many: Record<string, Uint8Array> = {};
          for (let index = 0; index < 401; index += 1) many[`X${index}-1.png`] = tiny;
          await fails(
            () => zips.preview(importer.token, archive(many)),
            'IMPORT_FILE_INVALID',
            'tooManyFiles',
          );
          await fails(
            () => zips.preview(importer.token, archive({ 'a.txt': strToU8('only text') })),
            'IMPORT_FILE_INVALID',
            'empty',
          );
          // A picture over 10 MB is named and skipped, never inflated into the result.
          const big = archive({
            'BIG-1.png': new Uint8Array(11 * 1024 * 1024).fill(7),
            [`${sku('A')}-9.png`]: tiny,
          });
          const preview = await zips.preview(importer.token, big);
          assert.equal(
            preview.items.find((item) => item.fileName === 'BIG-1.png')?.reason,
            'TOO_BIG',
          );
        },
      );
    });
  },
);
