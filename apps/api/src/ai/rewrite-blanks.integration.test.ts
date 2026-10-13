import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixBlankedFields } from '@lucy-spa/server';
import { phase6Fixture } from '../testing/phase6-fixture.js';

/**
 * Claude integration (Owner decision 2026-10-13, item 6) against real PostgreSQL: the data fix for products whose applied draft left a
 * field empty. A dry run only counts; the apply restores each empty field from the value before the apply (kept in the audit trail) or,
 * for a description, from the official name, with no model; one audited transaction per product; never a draft a person edited, a product
 * that is not marked as written by the AI, or a product changed after the apply; a second run changes nothing. Fixtures roll back.
 */
const SECTIONS = {
  benefits: 'Làm sạch nhẹ.',
  ingredients: null,
  usage: null,
  suitableFor: 'Phù hợp với da thường.',
};

test(
  'Claude integration blank-field data fix: dry run counts, apply restores from the audit before-values or the official name, edited and changed products are left alone, a second run changes nothing; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const { tx } = base;
      const actor = await base.staff(['MANAGE_PRODUCTS']);
      const rows = async <T>(sql: string, ...values: unknown[]) =>
        tx.$queryRawUnsafe<T[]>(sql, ...values);
      // Other applied drafts of a shared database are set aside so the counts below are exactly ours.
      await tx.$executeRawUnsafe(
        `UPDATE ai_items SET status = 'REJECTED', row_version = row_version + 1 WHERE status = 'APPLIED'`,
      );
      const [run] = await rows<{ id: string }>(
        `INSERT INTO ai_runs (kind, scope, status, model, effort, prompt_version, started_by_user_id)
         VALUES ('PRODUCT_TEXT', 'SELECTION', 'DONE', 'claude-opus-5-5', 'medium', 'product-rewrite.v2', $1::uuid) RETURNING id`,
        actor.id,
      );
      let counter = 0;
      /**
       * A product as the old bug left it: an applied draft (row version moved by exactly one) with the given fields empty now, and the audit
       * event of that apply holding the values before.
       */
      const applied = async (options: {
        before?: Record<string, unknown>;
        edited?: boolean;
        origin?: 'LUCY_AI' | 'LUCY_MANUAL';
        changedAfter?: boolean;
        sectionsNow?: Record<string, unknown> | null;
        descriptionEn?: string | null;
        descriptionVi?: string | null;
      }) => {
        counter += 1;
        const product = await tx.product.create({
          data: {
            code: `ai-blank-${base.run.toLowerCase()}-${counter}`,
            nameVi: `Kem blank ${counter}`,
            nameEn: `Blank cream ${counter}`,
            descriptionVi: 'Mô tả của nhà cung cấp',
            createdByUserId: actor.id,
          },
          select: { id: true, rowVersion: true },
        });
        const [item] = await rows<{ id: string }>(
          `INSERT INTO ai_items (run_id, kind, target_type, target_id, status, base_row_version, draft, edited, applied_at, applied_by_user_id, applied_via)
           VALUES ($1::uuid, 'PRODUCT_TEXT', 'PRODUCT', $2::uuid, 'APPLIED', $3, '{}'::jsonb, $4::jsonb, now(), $5::uuid, 'ALL')
           RETURNING id`,
          run!.id,
          product.id,
          product.rowVersion,
          options.edited ? JSON.stringify({ content: {}, useNameSuggestion: false }) : null,
          actor.id,
        );
        await tx.$executeRawUnsafe(
          `UPDATE products SET description_vi = $2, description_en = $3, description_sections_vi = $4::jsonb, description_sections_en = $6::jsonb,
                  content_origin = $5, row_version = row_version + 1 WHERE id = $1::uuid`,
          product.id,
          options.descriptionVi === undefined ? 'Mô tả mới' : options.descriptionVi,
          options.descriptionEn === undefined ? 'New description' : options.descriptionEn,
          JSON.stringify(options.sectionsNow === undefined ? SECTIONS : options.sectionsNow),
          options.origin ?? 'LUCY_AI',
          JSON.stringify(SECTIONS),
        );
        await tx.auditEvent.create({
          data: {
            action: 'AI_DRAFT_APPLIED',
            actorKind: 'USER',
            actorUserId: actor.id,
            entityType: 'Product',
            entityId: product.id,
            before: (options.before ?? {}) as never,
            after: { aiItemId: item!.id } as never,
            dataClassification: 'STANDARD',
          },
          select: { id: true },
        });
        if (options.changedAfter) {
          await tx.$executeRawUnsafe(
            `UPDATE products SET row_version = row_version + 1 WHERE id = $1::uuid`,
            product.id,
          );
        }
        return { productId: product.id, itemId: item!.id };
      };
      const read = async (productId: string) =>
        (
          await rows<{
            description_vi: string | null;
            description_en: string | null;
            description_sections_vi: Record<string, unknown> | null;
            name_vi: string;
            name_en: string;
            row_version: number;
          }>(
            `SELECT description_vi, description_en, description_sections_vi, name_vi, name_en, row_version FROM products WHERE id = $1::uuid`,
            productId,
          )
        )[0]!;

      const fromBefore = await applied({
        descriptionEn: '',
        before: {
          descriptionEn: 'The English text before.',
          // An older benefits text is not restored (that section may be empty on purpose); "who it suits" is.
          sectionsVi: { suitableFor: 'Cho da khô.', benefits: 'Older benefits text.' },
        },
        sectionsNow: { ...SECTIONS, suitableFor: null, benefits: null },
      });
      const fromName = await applied({ descriptionVi: null, descriptionEn: '   ', before: {} });
      const unrestorable = await applied({
        sectionsNow: {
          benefits: 'Làm sạch nhẹ.',
          ingredients: null,
          usage: null,
          suitableFor: null,
        },
        before: {},
      });
      const edited = await applied({
        edited: true,
        descriptionEn: '',
        before: { descriptionEn: 'Before.' },
      });
      const manual = await applied({
        origin: 'LUCY_MANUAL',
        descriptionEn: '',
        before: { descriptionEn: 'Before.' },
      });
      const changed = await applied({
        changedAfter: true,
        descriptionEn: '',
        before: { descriptionEn: 'Before.' },
      });
      const healthy = await applied({ before: { descriptionEn: 'Before.' } });
      const versions = new Map<string, number>();
      for (const entry of [fromBefore, fromName, unrestorable, edited, manual, changed, healthy]) {
        versions.set(entry.productId, (await read(entry.productId)).row_version);
      }
      const events = async () =>
        tx.auditEvent.count({ where: { action: 'AI_BLANK_FIELDS_RESTORED' } });

      await suite.test(
        'the dry run only counts, changes nothing and writes no audit event',
        async () => {
          const report = await fixBlankedFields(tx, { apply: false });
          assert.equal(report.appliedItems, 7);
          assert.equal(report.productsWithBlank, 6, 'the healthy product is not counted');
          assert.equal(report.fromBefore, 2, 'one English description and one "who it suits"');
          assert.equal(report.fromName, 2, 'two descriptions from the official name');
          assert.equal(report.unrestorable, 1);
          assert.equal(report.skippedEdited, 1);
          assert.equal(report.skippedManual, 1);
          assert.equal(report.skippedChanged, 1);
          assert.equal(report.restoredProducts, 0);
          assert.deepEqual(report.blankByField, {
            descriptionEn: 5,
            descriptionVi: 1,
            'sectionsVi.suitableFor': 2,
          });
          for (const [productId, version] of versions) {
            assert.equal((await read(productId)).row_version, version);
          }
          assert.equal(await events(), 0);
        },
      );

      await suite.test(
        'the apply restores from the value before the apply or the official name; people’s and changed products are left; one audit event each',
        async () => {
          const report = await fixBlankedFields(tx, { apply: true });
          assert.equal(report.restoredProducts, 2);
          assert.equal(report.restoredFields, 4);
          assert.equal(report.skippedEdited, 1);
          assert.equal(report.skippedManual, 1);
          assert.equal(report.skippedChanged, 1);
          const one = await read(fromBefore.productId);
          assert.equal(one.description_en, 'The English text before.');
          assert.equal(
            one.description_vi,
            'Mô tả mới',
            'a field that was not empty is not touched',
          );
          assert.deepEqual(one.description_sections_vi, {
            ...SECTIONS,
            benefits: null,
            suitableFor: 'Cho da khô.',
          });
          assert.equal(one.row_version, versions.get(fromBefore.productId)! + 1);
          const two = await read(fromName.productId);
          assert.equal(two.description_vi, two.name_vi);
          assert.equal(two.description_en, two.name_en);
          for (const left of [unrestorable, edited, manual, changed, healthy]) {
            assert.equal(
              (await read(left.productId)).row_version,
              versions.get(left.productId),
              'left untouched',
            );
          }
          assert.equal((await read(edited.productId)).description_en, '');
          assert.equal(
            (await read(unrestorable.productId)).description_sections_vi?.['suitableFor'],
            null,
          );
          assert.equal(await events(), 2);
          const event = await tx.auditEvent.findFirstOrThrow({
            where: { action: 'AI_BLANK_FIELDS_RESTORED', entityId: fromBefore.productId },
          });
          assert.equal(event.actorKind, 'SYSTEM');
          assert.equal((event.after as Record<string, unknown>)['aiItemId'], fromBefore.itemId);
          assert.ok(event.before && event.after);
        },
      );

      await suite.test('a second run changes nothing', async () => {
        const again = await fixBlankedFields(tx, { apply: true });
        assert.equal(again.restoredProducts, 0);
        assert.equal(again.restoredFields, 0);
        assert.equal(await events(), 2);
        const dry = await fixBlankedFields(tx, { apply: false });
        assert.equal(dry.fromBefore + dry.fromName, 0, 'nothing is left to restore');
      });
    });
  },
);
