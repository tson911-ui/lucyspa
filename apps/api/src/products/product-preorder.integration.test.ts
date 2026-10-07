import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProductDetailResponse, ProductVariantResponse } from '@lucy-spa/contracts';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { ProductCatalogService } from './product-catalog.service.js';

/**
 * Phase 6 P6-3b (Owner decisions of 2026-10-07, design 2.8): a variant may be sold on order (on by default, OQ-P6-30) and may carry
 * its own waiting time; the default waiting time is one settings value (OQ-P6-31). No weight exists. Proves the defaults, the
 * optional-field semantics on edit, the validation (both bounds or neither, 1..90, min <= max), the database rule behind it, the
 * settings row (authority, versions, validation, audit) and that a price-only caller reads but never writes. Rolls back.
 */
test(
  'Phase 6 P6-3b pre-order flag, waiting time and product settings; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (kit) => {
      const { tx, run, fails } = kit;
      const catalog = new ProductCatalogService(kit.adapter, kit.throttle, kit.environment);
      const manager = await kit.staff(['MANAGE_PRODUCTS']);
      const pricer = await kit.staff(['MANAGE_PRODUCT_PRICES']);
      const nobody = await kit.staff([]);
      const costOnly = await kit.staff(['VIEW_PRODUCT_COST']);
      const variantOf = (product: ProductDetailResponse, sku: string): ProductVariantResponse => {
        const found = product.variants.find((variant) => variant.sku === sku);
        assert.ok(found, `variant ${sku}`);
        return found;
      };

      const brand = await catalog.createBrand(manager.token, {
        nameVi: 'Thương hiệu',
        nameEn: `Brand ${run}`,
      });
      let product = await catalog.createProduct(manager.token, {
        nameVi: 'Kem mẫu',
        nameEn: `Cream ${run}`,
        descriptionVi: null,
        descriptionEn: null,
        brandId: brand.id,
        categoryId: null,
        featured: false,
      });
      const base = { labelVi: '30 ml', labelEn: '30 ml', barcode: null, lowStockThreshold: null };

      await suite.test(
        'a new variant is on order by default and has no own waiting time',
        async () => {
          product = await catalog.createVariant(manager.token, product.id, {
            ...base,
            sku: `PRE-${run}-A`,
          });
          const created = variantOf(product, `PRE-${run}-A`);
          assert.equal(created.sellOnOrder, true, 'OQ-P6-30: on by default');
          assert.equal(created.leadTimeDaysMin, null);
          assert.equal(created.leadTimeDaysMax, null);
          product = await catalog.createVariant(manager.token, product.id, {
            ...base,
            sku: `PRE-${run}-B`,
            sellOnOrder: false,
            leadTimeDaysMin: 2,
            leadTimeDaysMax: 4,
          });
          const kept = variantOf(product, `PRE-${run}-B`);
          assert.equal(kept.sellOnOrder, false);
          assert.deepEqual([kept.leadTimeDaysMin, kept.leadTimeDaysMax], [2, 4]);
          // Both explicit nulls are the same as absent.
          product = await catalog.createVariant(manager.token, product.id, {
            ...base,
            sku: `PRE-${run}-C`,
            leadTimeDaysMin: null,
            leadTimeDaysMax: null,
          });
          assert.equal(variantOf(product, `PRE-${run}-C`).leadTimeDaysMin, null);
        },
      );

      await suite.test(
        'an edit that does not mention the new fields leaves them unchanged',
        async () => {
          const target = variantOf(product, `PRE-${run}-B`);
          product = await catalog.editVariant(manager.token, product.id, target.id, {
            expectedRowVersion: target.rowVersion,
            ...base,
            labelVi: '30 ml (mới)',
            sortOrder: target.sortOrder,
            isActive: true,
          });
          const after = variantOf(product, `PRE-${run}-B`);
          assert.equal(after.labelVi, '30 ml (mới)');
          assert.equal(after.sellOnOrder, false);
          assert.deepEqual([after.leadTimeDaysMin, after.leadTimeDaysMax], [2, 4]);
        },
      );

      await suite.test(
        'an edit changes the flag and the waiting time, and can clear it',
        async () => {
          const target = variantOf(product, `PRE-${run}-A`);
          product = await catalog.editVariant(manager.token, product.id, target.id, {
            expectedRowVersion: target.rowVersion,
            ...base,
            sortOrder: target.sortOrder,
            isActive: true,
            sellOnOrder: false,
            leadTimeDaysMin: 5,
            leadTimeDaysMax: 7,
          });
          let after = variantOf(product, `PRE-${run}-A`);
          assert.equal(after.sellOnOrder, false);
          assert.deepEqual([after.leadTimeDaysMin, after.leadTimeDaysMax], [5, 7]);
          assert.equal(after.rowVersion, target.rowVersion + 1);
          product = await catalog.editVariant(manager.token, product.id, target.id, {
            expectedRowVersion: after.rowVersion,
            ...base,
            sortOrder: target.sortOrder,
            isActive: true,
            leadTimeDaysMin: null,
            leadTimeDaysMax: null,
          });
          after = variantOf(product, `PRE-${run}-A`);
          assert.deepEqual([after.leadTimeDaysMin, after.leadTimeDaysMax], [null, null]);
          assert.equal(after.sellOnOrder, false, 'clearing the waiting time keeps the flag');
          // The audit event carries the new fields.
          const audit = await tx.auditEvent.findFirst({
            where: { action: 'PRODUCT_VARIANT_UPDATED', entityId: target.id },
            orderBy: { occurredAt: 'desc' },
          });
          assert.ok(audit);
          assert.equal(Reflect.get(Object(audit.after), 'sellOnOrder'), false);
        },
      );

      await suite.test(
        'the waiting time is validated: both or neither, 1 to 90, min <= max',
        async () => {
          const target = variantOf(product, `PRE-${run}-A`);
          const edit = (extra: object) => () =>
            catalog.editVariant(manager.token, product.id, target.id, {
              expectedRowVersion: variantOf(product, `PRE-${run}-A`).rowVersion,
              ...base,
              sortOrder: target.sortOrder,
              isActive: true,
              ...extra,
            });
          await fails(edit({ leadTimeDaysMin: 3 }), 'VALIDATION_FAILED', 'leadTimeDays');
          await fails(edit({ leadTimeDaysMax: 3 }), 'VALIDATION_FAILED', 'leadTimeDays');
          await fails(
            edit({ leadTimeDaysMin: 3, leadTimeDaysMax: null }),
            'VALIDATION_FAILED',
            'leadTimeDays',
          );
          await fails(
            edit({ leadTimeDaysMin: 6, leadTimeDaysMax: 5 }),
            'VALIDATION_FAILED',
            'leadTimeDays',
          );
          await fails(
            edit({ leadTimeDaysMin: 0, leadTimeDaysMax: 5 }),
            'VALIDATION_FAILED',
            'leadTimeDaysMin',
          );
          await fails(
            edit({ leadTimeDaysMin: 1, leadTimeDaysMax: 91 }),
            'VALIDATION_FAILED',
            'leadTimeDaysMax',
          );
          await fails(
            edit({ leadTimeDaysMin: 1.5, leadTimeDaysMax: 3 }),
            'VALIDATION_FAILED',
            'leadTimeDaysMin',
          );
          await fails(
            edit({ leadTimeDaysMin: '3', leadTimeDaysMax: 5 }),
            'VALIDATION_FAILED',
            'leadTimeDaysMin',
          );
          await fails(edit({ sellOnOrder: 'yes' }), 'VALIDATION_FAILED', 'sellOnOrder');
          await fails(
            () =>
              catalog.createVariant(manager.token, product.id, {
                ...base,
                sku: `PRE-${run}-X`,
                leadTimeDaysMin: 4,
              }),
            'VALIDATION_FAILED',
            'leadTimeDays',
          );
          // Edges that are allowed.
          product = await edit({ leadTimeDaysMin: 1, leadTimeDaysMax: 90 })();
          product = await edit({ leadTimeDaysMin: 7, leadTimeDaysMax: 7 })();
          assert.equal(
            variantOf(await catalog.product(manager.token, product.id), `PRE-${run}-A`)
              .leadTimeDaysMax,
            7,
          );
        },
      );

      await suite.test('the database refuses a half waiting time or a reversed one', async () => {
        const target = variantOf(product, `PRE-${run}-A`);
        for (const sql of [
          `UPDATE product_variants SET lead_time_days_min = NULL, lead_time_days_max = 5 WHERE id = '${target.id}'`,
          `UPDATE product_variants SET lead_time_days_min = 9, lead_time_days_max = 3 WHERE id = '${target.id}'`,
          `UPDATE product_variants SET lead_time_days_min = 1, lead_time_days_max = 91 WHERE id = '${target.id}'`,
          `UPDATE product_settings SET lead_time_days_min = 5, lead_time_days_max = 2`,
          `UPDATE product_settings SET lead_time_days_min = 0`,
        ]) {
          await tx.$executeRawUnsafe('SAVEPOINT rule');
          await assert.rejects(tx.$executeRawUnsafe(sql), /23514|check constraint|violates/i);
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT rule');
        }
      });

      await suite.test('reading and writing the product settings', async () => {
        const initial = await catalog.settings(manager.token);
        assert.deepEqual(
          [initial.leadTimeDaysMin, initial.leadTimeDaysMax, initial.expiryWarningDays],
          [3, 5, 90],
          'the Owner approved 3 to 5 days and 90 days',
        );
        assert.deepEqual(initial.access, { manage: true, prices: false, cost: false });
        // The price permission reads but never writes; cost alone and nothing at all read nothing.
        assert.deepEqual((await catalog.settings(pricer.token)).access, {
          manage: false,
          prices: true,
          cost: false,
        });
        await fails(
          () =>
            catalog.editSettings(pricer.token, {
              expectedRowVersion: initial.rowVersion,
              expiryWarningDays: 60,
            }),
          'FORBIDDEN',
        );
        for (const who of [nobody, costOnly]) {
          await fails(() => catalog.settings(who.token), 'FORBIDDEN');
          await fails(
            () =>
              catalog.editSettings(who.token, {
                expectedRowVersion: initial.rowVersion,
                expiryWarningDays: 60,
              }),
            'FORBIDDEN',
          );
        }
        await fails(() => catalog.settings(undefined), 'AUTHENTICATION_REQUIRED');

        const changed = await catalog.editSettings(manager.token, {
          expectedRowVersion: initial.rowVersion,
          leadTimeDaysMin: 2,
          leadTimeDaysMax: 6,
        });
        assert.deepEqual(
          [changed.leadTimeDaysMin, changed.leadTimeDaysMax, changed.expiryWarningDays],
          [2, 6, 90],
        );
        assert.equal(changed.rowVersion, initial.rowVersion + 1);
        // A stale version is a conflict; a change of nothing keeps the version and writes no audit event.
        await fails(
          () =>
            catalog.editSettings(manager.token, {
              expectedRowVersion: initial.rowVersion,
              expiryWarningDays: 100,
            }),
          'CONFLICT',
        );
        const audits = () => tx.auditEvent.count({ where: { action: 'PRODUCT_SETTINGS_UPDATED' } });
        const before = await audits();
        const same = await catalog.editSettings(manager.token, {
          expectedRowVersion: changed.rowVersion,
          leadTimeDaysMin: 2,
          leadTimeDaysMax: 6,
        });
        assert.equal(same.rowVersion, changed.rowVersion);
        assert.equal(await audits(), before);
        const expiry = await catalog.editSettings(manager.token, {
          expectedRowVersion: same.rowVersion,
          expiryWarningDays: 120,
        });
        assert.deepEqual(
          [expiry.leadTimeDaysMin, expiry.leadTimeDaysMax, expiry.expiryWarningDays],
          [2, 6, 120],
        );
        assert.equal(await audits(), before + 1);
        const audit = await tx.auditEvent.findFirst({
          where: { action: 'PRODUCT_SETTINGS_UPDATED' },
          orderBy: { occurredAt: 'desc' },
        });
        assert.deepEqual(Reflect.get(Object(audit?.before), 'expiryWarningDays'), 90);
        assert.deepEqual(Reflect.get(Object(audit?.after), 'expiryWarningDays'), 120);
        assert.equal(audit?.actorUserId, manager.id);
        // Validation.
        const send = (extra: object) => () =>
          catalog.editSettings(manager.token, { expectedRowVersion: expiry.rowVersion, ...extra });
        await fails(send({ leadTimeDaysMin: 3 }), 'VALIDATION_FAILED', 'leadTimeDays');
        await fails(
          send({ leadTimeDaysMin: 8, leadTimeDaysMax: 3 }),
          'VALIDATION_FAILED',
          'leadTimeDays',
        );
        await fails(
          send({ leadTimeDaysMin: 0, leadTimeDaysMax: 3 }),
          'VALIDATION_FAILED',
          'leadTimeDaysMin',
        );
        await fails(
          send({ leadTimeDaysMin: null, leadTimeDaysMax: null }),
          'VALIDATION_FAILED',
          'leadTimeDays',
        );
        await fails(send({ expiryWarningDays: 0 }), 'VALIDATION_FAILED', 'expiryWarningDays');
        await fails(send({ expiryWarningDays: 731 }), 'VALIDATION_FAILED', 'expiryWarningDays');
        await fails(send({ expiryWarningDays: 12.5 }), 'VALIDATION_FAILED', 'expiryWarningDays');
        await fails(
          () =>
            catalog.editSettings(manager.token, { expectedRowVersion: 0, expiryWarningDays: 30 }),
          'VALIDATION_FAILED',
          'expectedRowVersion',
        );
      });
    });
  },
);
