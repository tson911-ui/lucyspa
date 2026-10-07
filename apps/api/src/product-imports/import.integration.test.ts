import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProductImportDetailResponse } from '@lucy-spa/contracts';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { ProductImportService } from './import.service.js';

/**
 * Phase 6 P6-5 Excel/CSV import against real PostgreSQL: authority per permission (price and cost columns need their own), the
 * preview that writes nothing, row-level codes (duplicates in the file and in the catalog, missing names, unknown brand, a price under
 * a running promotion), the explicit confirmation (invalid rows only with `skipInvalid`), the second planning that refuses a stale
 * preview, price and cost cells absent for a viewer without the authority, opening stock once per variant and branch. Rolls back.
 */
const csv = (lines: string[]) => ({
  buffer: Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8'),
  originalname: 'file.csv',
});

test(
  'Phase 6 P6-5 import: authority, preview, apply, stale refusal, cost privacy, opening stock; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (kit) => {
      const { tx, run, fails } = kit;
      const imports = new ProductImportService(kit.adapter, kit.throttle, kit.environment);
      const A = await kit.branch('A');

      const plain = await kit.staff(['IMPORT_PRODUCT_DATA']);
      const pricer = await kit.staff(['IMPORT_PRODUCT_DATA', 'MANAGE_PRODUCT_PRICES']);
      const costly = await kit.staff([
        'IMPORT_PRODUCT_DATA',
        'MANAGE_PRODUCT_PRICES',
        'VIEW_PRODUCT_COST',
      ]);
      const nobody = await kit.staff([]);
      const manager = await kit.staff(['MANAGE_PRODUCTS']);

      const brand = await tx.brand.create({
        data: { code: `br-${run.toLowerCase()}`, nameVi: `Hãng ${run}`, nameEn: `Brand ${run}` },
      });
      const category = await tx.productCategory.create({
        data: { code: `ct-${run.toLowerCase()}`, nameVi: `Nhóm ${run}`, nameEn: `Group ${run}` },
      });
      const sku = (suffix: string) => `IMP-${run}-${suffix}`;
      const head =
        'sku,product_key,name_vi,name_en,brand,category,label_vi,barcode,sell_on_order,lead_time_min,lead_time_max,price,cost';

      const existing = await tx.product.create({
        data: {
          code: `imp-old-${run.toLowerCase()}`,
          nameVi: `Sản phẩm cũ ${run}`,
          nameEn: `Old product ${run}`,
          createdByUserId: manager.id,
          variants: { create: [{ sku: sku('OLD'), labelVi: '50 ml' }] },
        },
        include: { variants: true },
      });
      const oldVariant = existing.variants[0]!;
      await tx.productPriceVersion.create({
        data: {
          variantId: oldVariant.id,
          versionNo: 1,
          listPriceVnd: 100000n,
          createdByUserId: manager.id,
        },
      });

      const upload = (
        token: string,
        lines: string[],
        kind: 'CATALOG' | 'OPENING_STOCK' = 'CATALOG',
        branchId?: string,
      ) => imports.upload(token, csv(lines), { kind, branchId });
      const productCount = () => tx.product.count();
      const byRow = (job: ProductImportDetailResponse, rowNo: number) =>
        job.rows.find((row) => row.rowNo === rowNo)!;
      const codes = (job: ProductImportDetailResponse, rowNo: number) =>
        byRow(job, rowNo).errors.map((entry) => `${entry.code}:${entry.field ?? ''}`);

      await suite.test(
        'nothing opens without IMPORT_PRODUCT_DATA; the template downloads',
        async () => {
          await fails(() => imports.list(nobody.token), 'FORBIDDEN');
          await fails(() => imports.template(nobody.token, 'CATALOG', 'xlsx', 'vi'), 'FORBIDDEN');
          await fails(() => imports.template(manager.token, 'CATALOG', 'xlsx', 'vi'), 'FORBIDDEN');
          const file = await imports.template(plain.token, 'CATALOG', 'xlsx', 'vi');
          assert.equal(file.filename, 'mau-san-pham.xlsx');
          await fails(
            () => imports.template(plain.token, 'PRICE_UPDATE', 'xlsx', 'vi'),
            'VALIDATION_FAILED',
            'kind',
          );
          await fails(() => upload(nobody.token, [head, 'A']), 'FORBIDDEN');
          const list = await imports.list(plain.token);
          assert.deepEqual(list.access, { prices: false, cost: false });
          assert.ok(list.branches.some((branch) => branch.id === A.id));
        },
      );

      await suite.test(
        'the file rules: kind and branch, unreadable files, missing columns',
        async () => {
          await fails(
            () => upload(plain.token, [head, 'A'], 'OPENING_STOCK'),
            'VALIDATION_FAILED',
            'branchId',
          );
          await fails(
            () => upload(plain.token, [head, 'A'], 'CATALOG', A.id),
            'VALIDATION_FAILED',
            'branchId',
          );
          await fails(
            () => upload(plain.token, ['name_vi,name_en', 'a,b']),
            'IMPORT_FILE_INVALID',
            'missingSku',
          );
          await fails(
            () =>
              imports.upload(
                plain.token,
                { buffer: Buffer.from('x'), originalname: 'a.xls' },
                { kind: 'CATALOG' },
              ),
            'IMPORT_FILE_INVALID',
            'xls',
          );
          await fails(
            () =>
              imports.upload(
                plain.token,
                { buffer: Buffer.from('sku\n'), originalname: 'a.csv' },
                { kind: 'CATALOG' },
              ),
            'IMPORT_FILE_INVALID',
            'empty',
          );
          await fails(() => upload(plain.token, [head]), 'IMPORT_FILE_INVALID', 'empty');
        },
      );

      let previewed!: ProductImportDetailResponse;
      await suite.test(
        'the preview classifies every row and writes nothing to the catalog',
        async () => {
          const before = await productCount();
          previewed = await upload(costly.token, [
            head,
            // 2-3: a new product with two variants (a group), brand and category by name
            `${sku('K50')},KEM,Kem dưỡng ${run},Cream ${run},Hãng ${run},nhom ${run},50 ml,,không,3,5,250.000,120000`,
            `${sku('K100')},KEM,,,,,100 ml,,,,,400000,`,
            // 4: a new product without an English name
            `${sku('NOEN')},,Chỉ tên Việt,,,,,,,,,,`,
            // 5: duplicate SKU in the file
            `${sku('K50')},,Trùng,Dup,,,,,,,,,`,
            // 6: update of a stored variant: label and price change
            `${sku('OLD')},,,,,,100 ml,,,,,120000,`,
            // 7: unknown brand
            `${sku('BAD')},,Tên,Name,Hãng không có,,,,,,,,`,
            // 8: price down to or under nothing: not a number
            `${sku('PRICE')},,Tên giá,Price name,,,,,,,,abc,`,
            // 9: unchanged stored variant
            `${sku('OLD')},,,,,,,,,,,,`,
          ]);
          assert.equal(await productCount(), before, 'a preview creates no product');
          assert.equal(previewed.status, 'PREVIEWED');
          assert.equal(previewed.rowCount, 8);
          assert.deepEqual(codes(previewed, 4), ['NAME_REQUIRED:name_en']);
          assert.deepEqual(codes(previewed, 5), ['SKU_DUPLICATE_IN_FILE:sku']);
          assert.deepEqual(codes(previewed, 7), ['BRAND_NOT_FOUND:brand']);
          assert.deepEqual(codes(previewed, 8), ['PRICE_INVALID:price']);
          assert.deepEqual(
            [2, 3, 6].map((n) => [byRow(previewed, n).status, byRow(previewed, n).action]),
            [
              ['VALID', 'CREATE'],
              ['VALID', 'CREATE'],
              ['VALID', 'UPDATE'],
            ],
          );
          assert.deepEqual(byRow(previewed, 6).changes.sort(), ['label_vi', 'price']);
          // The second SKU of a stored variant that changes nothing is a duplicate in the file (row 9 repeats row 6).
          assert.deepEqual(codes(previewed, 9), ['SKU_DUPLICATE_IN_FILE:sku']);
          assert.equal(previewed.invalidCount, 5);
          assert.equal(previewed.createCount, 2);
          assert.equal(previewed.updateCount, 1);
          assert.equal(previewed.canApply, true);
          assert.equal(await tx.productVariant.count({ where: { sku: sku('K50') } }), 0);
        },
      );

      await suite.test(
        'price and cost cells exist only for a viewer who may see them',
        async () => {
          const secret = JSON.stringify(await imports.detail(plain.token, previewed.id));
          assert.ok(
            !/250\.000|120000|400000|"price":|"cost":/.test(secret),
            'no price or cost for a plain importer',
          );
          const withPrices = await imports.detail(pricer.token, previewed.id);
          assert.equal(byRow(withPrices, 2).cells['price'], '250.000');
          assert.equal(byRow(withPrices, 2).cells['cost'], undefined);
          assert.ok(
            !JSON.stringify(withPrices).includes('120000') ||
              byRow(withPrices, 6).cells['price'] === '120000',
          );
          const full = await imports.detail(costly.token, previewed.id);
          assert.equal(byRow(full, 2).cells['cost'], '120000');
          // A file with a price cell, uploaded by someone without the price authority, says so per row.
          const refused = await upload(plain.token, [
            head,
            `${sku('P1')},,Tên,Name,,,,,,,,5000,100`,
          ]);
          assert.deepEqual(codes(refused, 2).sort(), [
            'COST_NOT_ALLOWED:cost',
            'PRICE_NOT_ALLOWED:price',
          ]);
        },
      );

      await suite.test(
        'apply needs the explicit skip of invalid rows, then writes once',
        async () => {
          await fails(
            () =>
              imports.apply(costly.token, previewed.id, {
                expectedRowVersion: previewed.rowVersion,
                skipInvalid: false,
              }),
            'VALIDATION_FAILED',
            'skipInvalid',
          );
          await fails(
            () =>
              imports.apply(costly.token, previewed.id, {
                expectedRowVersion: previewed.rowVersion + 1,
                skipInvalid: true,
              }),
            'CONFLICT',
          );
          const done = await imports.apply(costly.token, previewed.id, {
            expectedRowVersion: previewed.rowVersion,
            skipInvalid: true,
          });
          assert.equal(done.status, 'APPLIED');
          const k50 = await tx.productVariant.findUniqueOrThrow({
            where: { sku: sku('K50') },
            include: { product: true, priceVersions: true },
          });
          const k100 = await tx.productVariant.findUniqueOrThrow({
            where: { sku: sku('K100') },
            include: { priceVersions: true },
          });
          assert.equal(k50.product.status, 'DRAFT');
          assert.equal(k50.product.brandId, brand.id);
          assert.equal(k50.product.categoryId, category.id);
          assert.equal(k100.productId, k50.productId, 'the group is one product with two variants');
          assert.equal(k50.sellOnOrder, false);
          assert.deepEqual([k50.leadTimeDaysMin, k50.leadTimeDaysMax], [3, 5]);
          assert.equal(k50.costPriceVnd, 120000n);
          assert.deepEqual(
            [k50.priceVersions[0]?.listPriceVnd, k100.priceVersions[0]?.listPriceVnd],
            [250000n, 400000n],
          );
          assert.equal(k100.sellOnOrder, true, 'pre-order is on by default');
          assert.equal(
            await tx.productVariant.count({
              where: { sku: { in: [sku('NOEN'), sku('BAD'), sku('PRICE')] } },
            }),
            0,
          );
          const old = await tx.productVariant.findUniqueOrThrow({
            where: { id: oldVariant.id },
            include: { priceVersions: { orderBy: { versionNo: 'asc' } } },
          });
          assert.equal(old.labelVi, '100 ml');
          assert.deepEqual(
            old.priceVersions.map((version) => version.listPriceVnd),
            [100000n, 120000n],
          );
          // Valid rows are stamped, invalid rows are not.
          const rows = await tx.productImportRow.findMany({ where: { jobId: previewed.id } });
          assert.deepEqual(
            rows
              .filter((row) => row.appliedAt !== null)
              .map((row) => row.rowNo)
              .sort((a, b) => a - b),
            [2, 3, 6],
          );
          const events = await tx.auditEvent.findMany({
            where: {
              action: {
                in: ['PRODUCT_IMPORT_APPLIED', 'PRODUCT_PRICE_CHANGED', 'PRODUCT_CREATED'],
              },
            },
          });
          assert.ok(events.some((event) => event.action === 'PRODUCT_IMPORT_APPLIED'));
          await fails(
            () =>
              imports.apply(costly.token, previewed.id, {
                expectedRowVersion: done.rowVersion,
                skipInvalid: true,
              }),
            'IMPORT_JOB_NOT_PREVIEWED',
          );
          await fails(
            () =>
              imports.cancel(costly.token, previewed.id, { expectedRowVersion: done.rowVersion }),
            'IMPORT_JOB_NOT_PREVIEWED',
          );
        },
      );

      await suite.test(
        'the same file again warns, and a stale preview is refused with nothing written',
        async () => {
          const lines = [head, `${sku('LATE')},,Muộn,Late,,,,,,,,,`];
          const first = await upload(plain.token, lines);
          const again = await upload(plain.token, lines);
          assert.ok(first.rows.every((row) => row.status === 'VALID'));
          // Someone creates the same SKU after the preview.
          await tx.productVariant.create({ data: { productId: existing.id, sku: sku('LATE') } });
          await fails(
            () =>
              imports.apply(plain.token, first.id, {
                expectedRowVersion: first.rowVersion,
                skipInvalid: false,
              }),
            'IMPORT_PREVIEW_STALE',
          );
          assert.equal((await imports.detail(plain.token, first.id)).status, 'PREVIEWED');
          assert.equal(await tx.product.count({ where: { nameEn: 'Late' } }), 0);
          // A job the applier cannot finish (a price cell without the price authority) is refused the same way.
          const priced = await upload(pricer.token, [
            head,
            `${sku('P2')},,Tên hai,Name two,,,,,,,,9000,`,
          ]);
          await fails(
            () =>
              imports.apply(plain.token, priced.id, {
                expectedRowVersion: priced.rowVersion,
                skipInvalid: false,
              }),
            'IMPORT_PREVIEW_STALE',
          );
          const cancelled = await imports.cancel(plain.token, again.id, {
            expectedRowVersion: again.rowVersion,
          });
          assert.equal(cancelled.status, 'CANCELLED');
          await fails(
            () =>
              imports.apply(plain.token, again.id, {
                expectedRowVersion: cancelled.rowVersion,
                skipInvalid: false,
              }),
            'IMPORT_JOB_NOT_PREVIEWED',
          );
        },
      );

      await suite.test('a price under a running promotion is refused for that row', async () => {
        const promoVariant = await tx.productVariant.create({
          data: { productId: existing.id, sku: sku('PROMO') },
        });
        await tx.productPriceVersion.create({
          data: {
            variantId: promoVariant.id,
            versionNo: 1,
            listPriceVnd: 90000n,
            createdByUserId: manager.id,
          },
        });
        const start = new Date(Date.now() - 3_600_000);
        const end = new Date(Date.now() + 86_400_000);
        await tx.productPromotion.create({
          data: {
            variantId: promoVariant.id,
            promoPriceVnd: 70000n,
            startsAt: start,
            endsAt: end,
            createdByUserId: manager.id,
          },
        });
        const job = await upload(pricer.token, [head, `${sku('PROMO')},,,,,,,,,,,60000,`]);
        assert.deepEqual(codes(job, 2), ['PRICE_BELOW_PROMOTION:price']);
      });

      await suite.test(
        'opening stock: once per variant and branch, lots, expiry, cost privacy',
        async () => {
          const open = await tx.productVariant.create({
            data: { productId: existing.id, sku: sku('OPEN') },
          });
          const header = 'sku,quantity,lot_code,expiry_date,cost';
          const job = await upload(
            costly.token,
            [
              header,
              `${sku('OPEN')},10,L1,31/12/2099,5000`,
              `${sku('OPEN')},5,L2,,`,
              `${sku('OPEN')},5,L2,,`,
              `${sku('NOPE')},3,,,`,
              `${sku('OLD')},0,,,`,
              `${sku('OLD')},4,,2000-01-01,`,
            ],
            'OPENING_STOCK',
            A.id,
          );
          assert.deepEqual(codes(job, 4), ['LOT_DUPLICATE_IN_FILE:lot_code']);
          assert.deepEqual(codes(job, 5), ['VARIANT_NOT_FOUND:sku']);
          assert.deepEqual(codes(job, 6), ['QUANTITY_INVALID:quantity']);
          assert.deepEqual(codes(job, 7), ['EXPIRY_PAST:expiry_date']);
          assert.equal(job.createCount, 2);
          assert.ok(!JSON.stringify(await imports.detail(plain.token, job.id)).includes('5000'));
          await imports.apply(costly.token, job.id, {
            expectedRowVersion: job.rowVersion,
            skipInvalid: true,
          });
          const level = await tx.stockLevel.findUniqueOrThrow({
            where: { branchId_variantId: { branchId: A.id, variantId: open.id } },
          });
          assert.equal(level.onHand, 15);
          const lots = await tx.inventoryLot.findMany({
            where: { variantId: open.id },
            orderBy: { lotCode: 'asc' },
          });
          assert.deepEqual(
            lots.map((lot) => [lot.lotCode, lot.quantityOnHand, lot.unitCostVnd]),
            [
              ['L1', 10, 5000n],
              ['L2', 5, null],
            ],
          );
          const movements = await tx.stockMovement.findMany({ where: { variantId: open.id } });
          assert.ok(
            movements.every((move) => move.kind === 'OPENING' && move.importJobId === job.id),
          );
          // A second opening file for the same variant and branch is refused at the preview.
          const second = await upload(
            plain.token,
            [header, `${sku('OPEN')},1,,,`],
            'OPENING_STOCK',
            A.id,
          );
          assert.deepEqual(codes(second, 2), ['ALREADY_STOCKED:sku']);
          await fails(
            () =>
              imports.apply(plain.token, second.id, {
                expectedRowVersion: second.rowVersion,
                skipInvalid: true,
              }),
            'IMPORT_NOTHING_TO_APPLY',
          );
          const list = await imports.list(plain.token);
          assert.ok(list.jobs.length >= 5);
        },
      );
    });
  },
);
