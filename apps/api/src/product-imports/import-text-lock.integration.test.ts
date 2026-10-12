import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProductImportDetailResponse } from '@lucy-spa/contracts';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { ProductImportService } from './import.service.js';

/**
 * Claude integration Wave A (CI-R2) against real PostgreSQL: the Excel/CSV import never overwrites text Lucy wrote. For a product whose
 * origin is not the supplier's copy the preview shows the text columns as skipped (TEXT_LOCKED) while the other columns still import;
 * overwriting needs MANAGE_PRODUCTS, the SKUs of locked rows only and a reason, and is audited per product. Fixtures roll back.
 */
const csv = (lines: string[]) => ({
  buffer: Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8'),
  originalname: 'file.csv',
});

test(
  'Claude integration Wave A import text lock: skipped by default, explicit override with reason, audit; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (kit) => {
      const { tx, run, fails } = kit;
      const imports = new ProductImportService(kit.adapter, kit.throttle, kit.environment);
      const importer = await kit.staff(['IMPORT_PRODUCT_DATA']);
      const manager = await kit.staff(['IMPORT_PRODUCT_DATA', 'MANAGE_PRODUCTS']);
      const sku = (suffix: string) => `LOCK-${run}-${suffix}`;
      const head = 'sku,name_vi,name_en,description_vi,label_vi';
      const make = async (suffix: string, origin: string) => {
        const product = await tx.product.create({
          data: {
            code: `lock-${suffix.toLowerCase()}-${run.toLowerCase()}`,
            nameVi: `Tên cũ ${suffix}`,
            nameEn: `Old name ${suffix}`,
            descriptionVi: `Mô tả cũ ${suffix}`,
            contentOrigin: origin,
            seoTitleVi: origin === 'LUCY_AI' ? 'Tiêu đề SEO' : null,
            createdByUserId: manager.id,
            variants: { create: [{ sku: sku(suffix), labelVi: 'nhãn cũ' }] },
          },
          select: { id: true },
        });
        return product.id;
      };
      const supplier = await make('SUP', 'SUPPLIER_COPY');
      const ai = await make('AI', 'LUCY_AI');
      const manual = await make('MAN', 'LUCY_MANUAL');
      const read = (id: string) =>
        tx.product.findUniqueOrThrow({
          where: { id },
          select: {
            nameVi: true,
            nameEn: true,
            descriptionVi: true,
            seoTitleVi: true,
            contentOrigin: true,
            rowVersion: true,
            variants: { select: { labelVi: true } },
          },
        });
      const resetGuard = () =>
        tx.$executeRaw`SELECT set_config('lucy.text_change_source', '', true), set_config('lucy.text_lock_override', '', true)`;
      const lines = [
        head,
        `${sku('SUP')},Tên mới SUP,New name SUP,Mô tả mới SUP,nhãn mới`,
        `${sku('AI')},Tên mới AI,New name AI,Mô tả mới AI,nhãn mới`,
        `${sku('MAN')},Tên mới MAN,New name MAN,Mô tả mới MAN,nhãn mới`,
      ];
      const byRow = (job: ProductImportDetailResponse, rowNo: number) =>
        job.rows.find((row) => row.rowNo === rowNo)!;
      const codes = (job: ProductImportDetailResponse, rowNo: number) =>
        byRow(job, rowNo).warnings.map((warning) => warning.code);

      await suite.test(
        'preview: the supplier copy changes text; Lucy-written products show TEXT_LOCKED and keep importing the other columns',
        async () => {
          const job = await imports.upload(manager.token, csv(lines), { kind: 'CATALOG' });
          assert.deepEqual(byRow(job, 2).changes.sort(), [
            'description_vi',
            'label_vi',
            'name_en',
            'name_vi',
          ]);
          assert.deepEqual(codes(job, 2), []);
          for (const rowNo of [3, 4]) {
            assert.deepEqual(byRow(job, rowNo).changes, ['label_vi'], `row ${rowNo}`);
            assert.deepEqual(codes(job, rowNo), ['TEXT_LOCKED']);
            assert.equal(byRow(job, rowNo).action, 'UPDATE');
            assert.equal(byRow(job, rowNo).status, 'VALID');
          }
          // The preview writes nothing.
          assert.equal((await read(ai)).nameVi, 'Tên cũ AI');
        },
      );

      await suite.test(
        'apply without an override: only the supplier copy changes text; labels import everywhere; origins stay',
        async () => {
          const job = await imports.upload(manager.token, csv(lines), { kind: 'CATALOG' });
          await imports.apply(importer.token, job.id, {
            expectedRowVersion: job.rowVersion,
            skipInvalid: false,
          });
          await resetGuard();
          const after = {
            supplier: await read(supplier),
            ai: await read(ai),
            manual: await read(manual),
          };
          assert.equal(after.supplier.nameVi, 'Tên mới SUP');
          assert.equal(after.supplier.descriptionVi, 'Mô tả mới SUP');
          assert.equal(after.supplier.contentOrigin, 'SUPPLIER_COPY');
          for (const lucy of [after.ai, after.manual]) {
            assert.match(lucy.nameVi, /^Tên cũ/);
            assert.match(lucy.descriptionVi ?? '', /^Mô tả cũ/);
            assert.equal(lucy.variants[0]!.labelVi, 'nhãn mới', 'the other columns still import');
          }
          assert.equal(after.ai.contentOrigin, 'LUCY_AI');
          assert.equal(after.ai.seoTitleVi, 'Tiêu đề SEO');
        },
      );

      await suite.test(
        'override: needs MANAGE_PRODUCTS, a reason, and only locked rows; it writes the ticked product only and is audited with the reason',
        async () => {
          const job = await imports.upload(manager.token, csv(lines), { kind: 'CATALOG' });
          const body = (skus: string[], reason: string) => ({
            expectedRowVersion: job.rowVersion,
            skipInvalid: false,
            textOverride: { skus, reason },
          });
          await fails(
            () =>
              imports.apply(importer.token, job.id, body([sku('AI')], 'Cập nhật theo bảng mới')),
            'FORBIDDEN',
          );
          await fails(
            () => imports.apply(manager.token, job.id, body([sku('AI')], 'ab')),
            'VALIDATION_FAILED',
            'reason',
          );
          await fails(
            () => imports.apply(manager.token, job.id, body([sku('AI')], 'x'.repeat(301))),
            'VALIDATION_FAILED',
            'reason',
          );
          await fails(
            () => imports.apply(manager.token, job.id, body([], 'Cập nhật theo bảng mới')),
            'VALIDATION_FAILED',
            'textOverride',
          );
          // The supplier copy is not locked: its SKU cannot be ticked.
          await fails(
            () =>
              imports.apply(manager.token, job.id, body([sku('SUP')], 'Cập nhật theo bảng mới')),
            'VALIDATION_FAILED',
            'textOverride',
          );
          await resetGuard();
          assert.match((await read(ai)).nameVi, /^Tên cũ/, 'a refused apply changed nothing');
          const before = await read(ai);
          await imports.apply(manager.token, job.id, body([sku('ai')], 'Cập nhật theo bảng mới'));
          await resetGuard();
          const after = await read(ai);
          assert.equal(after.nameVi, 'Tên mới AI');
          assert.equal(after.nameEn, 'New name AI');
          assert.equal(after.descriptionVi, 'Mô tả mới AI');
          assert.equal(after.contentOrigin, 'LUCY_AI', 'the origin is not changed by an import');
          assert.equal(after.rowVersion, before.rowVersion + 1);
          assert.match((await read(manual)).nameVi, /^Tên cũ/, 'only the ticked product changed');
          const events = await tx.auditEvent.findMany({
            where: { action: 'PRODUCT_UPDATED', entityId: ai },
            orderBy: { occurredAt: 'desc' },
          });
          const last = events[0]!;
          assert.equal(last.reason, 'Cập nhật theo bảng mới');
          const afterJson = last.after as Record<string, unknown>;
          assert.equal(afterJson['nameVi'], 'Tên mới AI');
          assert.equal(afterJson['textOverride'], 'name_vi,name_en,description_vi');
          assert.equal((last.before as Record<string, unknown>)['nameVi'], 'Tên cũ AI');
        },
      );

      await suite.test(
        'the database guard: a file import that declares itself cannot touch Lucy-written text, even by a bug',
        async () => {
          await tx.$executeRaw`SELECT set_config('lucy.text_change_source', 'FILE_IMPORT', true)`;
          const current = await read(manual);
          await assert.rejects(
            () =>
              tx.$transaction(async (inner) =>
                inner.product.update({
                  where: { id: manual },
                  data: { nameVi: 'Bị ghi đè', rowVersion: current.rowVersion + 1 },
                }),
              ),
            /not overwritten by an import|23514/,
          );
          await resetGuard();
          assert.match((await read(manual)).nameVi, /^Tên cũ/);
        },
      );
    });
  },
);
