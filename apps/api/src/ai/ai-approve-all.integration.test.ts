import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AI_RUN_LIMITS, type AiDraftContent } from '@lucy-spa/contracts';
import { buildProductSnapshot } from '@lucy-spa/server';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { AiService } from './ai.service.js';

/**
 * Claude integration Wave B ("Chọn tất cả" and "Duyệt các bài đã chọn", Owner 2026-10-13) against real PostgreSQL: the list of every
 * pending product draft and one confirm for the selected ones. Needs three single approvals first and `MANAGE_PRODUCTS`; the confirm
 * applies exactly the sent list and re-checks each draft (ready, same row version, product unchanged); notes never skip a draft; a draft
 * that became ready after the list is never picked up; applied in chunks, each product audited, one summary event per request. Fixtures roll back.
 */
const CLEAN: AiDraftContent = {
  descriptionVi:
    'Một lớp bọt mịn giúp bạn rửa sạch bụi bẩn nhẹ nhàng, để da khô vẫn còn cảm giác mềm và đủ ẩm sau khi rửa. Sản phẩm dung tích 180ml, phù hợp cho thói quen chăm sóc da mỗi ngày tại Lucy Spa.',
  sectionsVi: {
    benefits: 'Làm sạch sâu và giữ độ ẩm tự nhiên cho da khô.',
    ingredients: 'Chiết xuất hoa sen, Glycerin.',
    usage: null,
    suitableFor: 'Phù hợp với hầu hết các loại da.',
  },
  descriptionEn:
    'A soft, creamy foam that lifts away dirt gently and leaves dry skin feeling soft and comfortably hydrated. The 180ml size fits a daily skincare routine.',
  sectionsEn: {
    benefits: 'Deep cleansing that keeps the skin’s natural moisture.',
    ingredients: 'Lotus extract, Glycerin.',
    usage: null,
    suitableFor: 'Suitable for most skin types.',
  },
  nameEn: 'The Whoo Gongjinhyang Soo Hydrating Cleansing Foam 180ml',
  seoTitleVi: 'Sữa rửa mặt Gongjinhyang The Whoo 180ml | Lucy Spa',
  seoTitleEn: 'The Whoo Hydrating Cleansing Foam 180ml | Lucy Spa',
  seoDescriptionVi:
    'Sữa rửa mặt cấp ẩm The Whoo Gongjinhyang 180ml cho da khô, mua tại Lucy Spa, Đà Nẵng.',
  seoDescriptionEn:
    'The Whoo hydrating cleansing foam, 180ml, for dry skin. Available at Lucy Spa in Da Nang.',
};

test(
  'Claude integration Wave B approve selected: every pending draft listed (notes never block), the sent list only, checked again, chunked, audited; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const { tx, fails } = base;
      const ai = new AiService(base.adapter, base.throttle);
      const worker = await base.staff([], { globalCodes: ['USE_AI_CONTENT', 'MANAGE_PRODUCTS'] });
      const reader = await base.staff([], { globalCodes: ['USE_AI_CONTENT'] });
      const nobody = await base.staff([]);
      const rows = async <T>(sql: string, ...values: unknown[]) =>
        tx.$queryRawUnsafe<T[]>(sql, ...values);
      const audit = (action: string) => tx.auditEvent.findMany({ where: { action } });
      // The database may hold other drafts (it is shared): they are set aside so the counts below are exactly ours.
      await tx.$executeRawUnsafe(
        `UPDATE ai_items SET status = 'REJECTED', row_version = row_version + 1 WHERE status NOT IN ('APPLIED', 'REJECTED')`,
      );
      const [run] = await rows<{ id: string }>(
        `INSERT INTO ai_runs (kind, scope, status, model, effort, prompt_version, started_by_user_id)
         VALUES ('PRODUCT_TEXT', 'SELECTION', 'DONE', 'claude-opus-5-5', 'medium', 'product-rewrite.v2', $1::uuid) RETURNING id`,
        worker.id,
      );
      const runId = run!.id;
      let counter = 0;
      const draftJson = JSON.stringify({
        ...CLEAN,
        nameViSuggestion: null,
        factsKept: [],
        uncertain: [],
      });
      /** A product with an item in the given state (a ready draft by default). */
      const make = async (
        state: {
          status?: string;
          warnings?: unknown[];
          via?: string;
          /** Fields of the draft replaced (an empty required field, a name the catalogue refuses, ...). */
          draftPatch?: Partial<AiDraftContent>;
          /** Store the product's real source snapshot with the draft (a draft written from that text). */
          snapshot?: boolean;
          /** A person edited the draft. */
          edited?: boolean;
        } = {},
      ): Promise<{ productId: string; itemId: string }> => {
        counter += 1;
        const product = await tx.product.create({
          data: {
            code: `ai-all-${base.run.toLowerCase()}-${counter}`,
            nameVi: `Sản phẩm duyệt ${counter}`,
            nameEn: `Approve product ${counter}`,
            descriptionVi: 'Mô tả của nhà cung cấp, đủ dài để được viết lại tại Lucy Spa.',
            contentOrigin: 'SUPPLIER_COPY',
            createdAt: new Date(Date.UTC(2026, 0, 1) + counter * 1000),
            createdByUserId: worker.id,
          },
          select: { id: true, rowVersion: true },
        });
        const built = state.snapshot ? await buildProductSnapshot(tx, product.id) : null;
        const content = { ...CLEAN, ...state.draftPatch };
        const status = state.status ?? 'DRAFT_READY';
        const applied = status === 'APPLIED';
        const [item] = await rows<{ id: string }>(
          `INSERT INTO ai_items (run_id, kind, target_type, target_id, status, base_row_version, base_snapshot, draft, edited, warnings, created_at,
                                 applied_at, applied_by_user_id, applied_via)
           VALUES ($1::uuid, 'PRODUCT_TEXT', 'PRODUCT', $2::uuid, $3, $10, $11::jsonb, $4::jsonb, $12::jsonb, $5::jsonb, $6::timestamptz,
                   CASE WHEN $7 THEN now() END, CASE WHEN $7 THEN $8::uuid END, CASE WHEN $7 THEN $9 END)
           RETURNING id`,
          runId,
          product.id,
          status,
          JSON.stringify({ ...JSON.parse(draftJson), ...content }),
          JSON.stringify(state.warnings ?? []),
          new Date(Date.UTC(2026, 0, 1) + counter * 1000).toISOString(),
          applied,
          worker.id,
          state.via ?? 'SINGLE',
          built ? built.rowVersion : 1,
          JSON.stringify(built ? built.snapshot : {}),
          state.edited ? JSON.stringify({ content, useNameSuggestion: false }) : null,
        );
        return { productId: product.id, itemId: item!.id };
      };
      const asList = (preview: { items: { id: string; rowVersion: number }[] }) =>
        preview.items.map((entry) => ({ id: entry.id, rowVersion: entry.rowVersion }));

      await suite.test(
        'before three single approvals the preview says so and the confirm is refused; permissions are checked',
        async () => {
          await fails(() => ai.previewApproveAll(undefined), 'AUTHENTICATION_REQUIRED');
          await fails(() => ai.previewApproveAll(nobody.token), 'FORBIDDEN');
          const first = await make();
          await make({ status: 'APPLIED', via: 'SINGLE' });
          await make({ status: 'APPLIED', via: 'PAGE' });
          const early = await ai.previewApproveAll(worker.token);
          assert.equal(early.eligible, 1);
          assert.equal(early.singleApplied, 1);
          assert.equal(early.canApprove, false);
          await fails(
            () => ai.approveAll(worker.token, { items: [{ id: first.itemId, rowVersion: 1 }] }),
            'VALIDATION_FAILED',
            'singleApprovals',
          );
          // A page-approved draft does not count as one by one.
          assert.equal((await ai.previewApproveAll(worker.token)).singleApplied, 1);
          await tx.$executeRawUnsafe(
            `UPDATE ai_items SET status = 'REJECTED', row_version = row_version + 1 WHERE id = '${first.itemId}'`,
          );
          await make({ status: 'APPLIED', via: 'SINGLE' });
          await make({ status: 'APPLIED', via: 'SINGLE' });
        },
      );

      await suite.test(
        'the list holds every pending draft whose product is unchanged, with or without notes; a reader may look but not confirm',
        async () => {
          const clean = [await make(), await make(), await make()];
          const noted = await make({
            warnings: [{ code: 'FACT_MISSING', field: 'descriptionVi' }],
          });
          const changed = await make();
          await tx.$executeRawUnsafe(
            `UPDATE products SET description_vi = description_vi || ' (sửa)', row_version = row_version + 1 WHERE id = '${changed.productId}'`,
          );
          const preview = await ai.previewApproveAll(worker.token);
          assert.equal(preview.ready, 5);
          assert.equal(preview.eligible, 4);
          assert.equal(preview.changed, 1);
          assert.equal(preview.singleApplied >= AI_RUN_LIMITS.singleApprovalsNeeded, true);
          assert.equal(preview.canApprove, true);
          assert.deepEqual(
            preview.items.map((entry) => entry.id),
            [...clean, noted].map((entry) => entry.itemId),
          );
          assert.equal(
            preview.items.every((entry) => entry.rowVersion >= 1),
            true,
          );
          const readerView = await ai.previewApproveAll(reader.token);
          assert.equal(readerView.canApprove, false);
          await fails(() => ai.approveAll(reader.token, { items: asList(preview) }), 'FORBIDDEN');
          // Nothing changed by looking.
          assert.equal(
            (
              await rows<{ n: bigint }>(
                `SELECT count(*) AS n FROM ai_items WHERE status = 'DRAFT_READY'`,
              )
            )[0]!.n,
            5n,
          );
        },
      );

      await suite.test(
        'the confirm applies exactly the previewed list: later drafts are untouched, a changed draft is skipped, every product is audited',
        async () => {
          const preview = await ai.previewApproveAll(worker.token);
          const list = asList(preview);
          // A draft that became ready after the preview is never picked up.
          const late = await make();
          // A draft a person edited after the preview (its row version moved) is skipped: it is no longer what the list showed.
          await tx.$executeRawUnsafe(
            `UPDATE ai_items SET edited = $1::jsonb, row_version = row_version + 1 WHERE id = '${list[0]!.id}'`,
            JSON.stringify({ content: CLEAN, useNameSuggestion: false }),
          );
          // The last draft of the list carries a note: a note never skips a draft.
          const result = await ai.approveAll(worker.token, { items: list });
          assert.equal(result.applied, 3);
          assert.deepEqual(result.skipped, [{ id: list[0]!.id, reason: 'CHANGED' }]);
          const [done] = await rows<{ status: string; applied_via: string }>(
            `SELECT status, applied_via FROM ai_items WHERE id = $1::uuid`,
            list[2]!.id,
          );
          assert.deepEqual(done, { status: 'APPLIED', applied_via: 'ALL' });
          const [lateRow] = await rows<{ status: string }>(
            `SELECT status FROM ai_items WHERE id = $1::uuid`,
            late.itemId,
          );
          assert.equal(lateRow!.status, 'DRAFT_READY');
          const events = (await audit('AI_DRAFT_APPLIED')).filter(
            (event) => (event.after as Record<string, unknown>)['appliedVia'] === 'ALL',
          );
          assert.equal(events.length, 3);
          assert.equal((await audit('AI_APPROVE_ALL')).length, 1);
          // The single approvals still number three or more by singles only; "all" is not one of them.
          assert.equal(
            (
              await rows<{ n: bigint }>(
                `SELECT count(*) AS n FROM ai_items WHERE applied_via = 'ALL'`,
              )
            )[0]!.n,
            3n,
          );
          // The same list again changes nothing (the draft is applied already).
          const again = await ai.approveAll(worker.token, { items: [list[2]!] });
          assert.deepEqual(again, {
            applied: 0,
            skipped: [{ id: list[2]!.id, reason: 'NOT_READY' }],
          });
          assert.equal((await audit('AI_APPROVE_ALL')).length, 1);
        },
      );

      await suite.test(
        'a product that changed since its draft is marked STALE and never overwritten; a long list is applied in chunks',
        async () => {
          await tx.$executeRawUnsafe(
            `UPDATE ai_items SET status = 'REJECTED', row_version = row_version + 1 WHERE status = 'DRAFT_READY'`,
          );
          const batch = [];
          for (let n = 0; n < 25; n += 1) batch.push(await make());
          const preview = await ai.previewApproveAll(worker.token);
          assert.equal(preview.eligible, 25);
          const list = asList(preview);
          // Changed between preview and confirm.
          await tx.$executeRawUnsafe(
            `UPDATE products SET description_vi = description_vi || ' (sửa)', row_version = row_version + 1 WHERE id = '${batch[7]!.productId}'`,
          );
          const before = await audit('AI_DRAFT_APPLIED');
          const result = await ai.approveAll(worker.token, { items: list });
          assert.equal(result.applied, 24);
          assert.deepEqual(result.skipped, [{ id: batch[7]!.itemId, reason: 'STALE' }]);
          const [stale] = await rows<{ status: string }>(
            `SELECT status FROM ai_items WHERE id = $1::uuid`,
            batch[7]!.itemId,
          );
          assert.equal(stale!.status, 'STALE');
          const [product] = await rows<{ description_vi: string }>(
            `SELECT description_vi FROM products WHERE id = $1::uuid`,
            batch[7]!.productId,
          );
          assert.match(product!.description_vi, /\(sửa\)$/);
          assert.equal((await audit('AI_DRAFT_APPLIED')).length - before.length, 24);
          const summaries = await audit('AI_APPROVE_ALL');
          assert.equal(summaries.length, 2);
          const last = summaries.at(-1)!.after as Record<string, unknown>;
          assert.equal(last['applied'], 24);
          assert.equal(last['requested'], 25);
        },
      );

      await suite.test('limits of one confirm', async () => {
        await fails(() => ai.approveAll(worker.token, { items: [] }), 'VALIDATION_FAILED', 'items');
        await fails(
          () =>
            ai.approveAll(worker.token, {
              items: Array.from({ length: AI_RUN_LIMITS.approveBatchMax + 1 }, (_, n) => ({
                id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
                rowVersion: 1,
              })),
            }),
          'VALIDATION_FAILED',
          'items',
        );
        const id = '00000000-0000-4000-8000-000000000001';
        await fails(
          () =>
            ai.approveAll(worker.token, {
              items: [
                { id, rowVersion: 1 },
                { id, rowVersion: 1 },
              ],
            }),
          'VALIDATION_FAILED',
          'items',
        );
        await fails(
          () => ai.approveAll(worker.token, { items: [{ id: 'abc', rowVersion: 1 }] }),
          'VALIDATION_FAILED',
          'items',
        );
        await fails(
          () => ai.approveAll(worker.token, { items: [{ id, rowVersion: 0 }] }),
          'VALIDATION_FAILED',
          'items',
        );
        // An id that is not a draft of product text is reported as skipped, never as an error for the whole confirm.
        assert.deepEqual(await ai.approveAll(worker.token, { items: [{ id, rowVersion: 1 }] }), {
          applied: 0,
          skipped: [{ id, reason: 'NOT_READY' }],
        });
      });

      await suite.test(
        'a draft that cannot be applied is reported with its reason and never fails the others (Owner, 2026-10-13)',
        async () => {
          await tx.$executeRawUnsafe(
            `UPDATE ai_items SET status = 'REJECTED', row_version = row_version + 1 WHERE status = 'DRAFT_READY'`,
          );
          const good = [await make(), await make(), await make()];
          const emptyName = await make({ draftPatch: { nameEn: '' } });
          const emptyTitle = await make({ draftPatch: { seoTitleEn: '' } });
          const emptyDescription = await make({ draftPatch: { descriptionEn: '   ' } });
          const longTitle = await make({ draftPatch: { seoTitleVi: 'x'.repeat(201) } });
          const refused = await make({ draftPatch: { nameEn: 'Refuse me' } });
          // A catalogue rule the pre-checks do not know: this one write is refused by the database.
          await tx.$executeRawUnsafe(
            `CREATE FUNCTION ai_test_refuse() RETURNS trigger AS $$ BEGIN
               IF NEW.name_en = 'Refuse me' THEN RAISE EXCEPTION 'refused by the catalogue' USING ERRCODE = '23514'; END IF;
               RETURN NEW; END; $$ LANGUAGE plpgsql`,
          );
          await tx.$executeRawUnsafe(
            `CREATE TRIGGER ai_test_refuse BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION ai_test_refuse()`,
          );
          const preview = await ai.previewApproveAll(worker.token);
          assert.equal(preview.ready, 8);
          assert.equal(preview.blocked, 4, 'empty fields and a too-long title are not offered');
          assert.equal(preview.eligible, 4);
          // The confirm is sent with every draft, blocked ones too (a stale tab, another reviewer): the server decides again.
          const sent = [
            good[0],
            emptyName,
            good[1],
            emptyTitle,
            emptyDescription,
            longTitle,
            refused,
            good[2],
          ].map((entry) => ({ id: entry!.itemId, rowVersion: 1 }));
          const result = await ai.approveAll(worker.token, { items: sent });
          assert.equal(result.applied, 3);
          assert.deepEqual(
            result.skipped,
            [
              [emptyName, 'EMPTY_FIELD'],
              [emptyTitle, 'EMPTY_FIELD'],
              [emptyDescription, 'EMPTY_FIELD'],
              [longTitle, 'TOO_LONG'],
              [refused, 'REJECTED'],
            ].map(([entry, reason]) => ({ id: (entry as { itemId: string }).itemId, reason })),
          );
          for (const entry of good) {
            const [row] = await rows<{ status: string }>(
              `SELECT status FROM ai_items WHERE id = $1::uuid`,
              entry.itemId,
            );
            assert.equal(row!.status, 'APPLIED');
          }
          const [still] = await rows<{ status: string }>(
            `SELECT status FROM ai_items WHERE id = $1::uuid`,
            refused.itemId,
          );
          assert.equal(still!.status, 'DRAFT_READY', 'a refused write leaves the draft as it was');
          const [untouched] = await rows<{ name_en: string }>(
            `SELECT name_en FROM products WHERE id = $1::uuid`,
            emptyName.productId,
          );
          assert.notEqual(untouched!.name_en, '');
          const summaries = await audit('AI_APPROVE_ALL');
          const last = summaries.at(-1)!.after as Record<string, unknown>;
          assert.equal(last['applied'], 3);
          assert.equal(last['skipped'], 5);
          assert.deepEqual(last['skippedByReason'], { EMPTY_FIELD: 3, TOO_LONG: 1, REJECTED: 1 });
          await tx.$executeRawUnsafe(`DROP TRIGGER ai_test_refuse ON products`);
          await tx.$executeRawUnsafe(`DROP FUNCTION ai_test_refuse()`);
        },
      );

      await suite.test(
        'one draft with an empty field fails alone with a plain message, not a conflict',
        async () => {
          const blank = await make({ draftPatch: { nameEn: '' } });
          await fails(
            () => ai.applyDraft(worker.token, blank.itemId, { expectedRowVersion: 1 }),
            'VALIDATION_FAILED',
            'emptyFields',
          );
          const long = await make({ draftPatch: { seoDescriptionEn: 'y'.repeat(401) } });
          await fails(
            () => ai.applyDraft(worker.token, long.itemId, { expectedRowVersion: 1 }),
            'VALIDATION_FAILED',
            'tooLong',
          );
          const [row] = await rows<{ status: string }>(
            `SELECT status FROM ai_items WHERE id = $1::uuid`,
            blank.itemId,
          );
          assert.equal(row!.status, 'DRAFT_READY');
        },
      );

      await suite.test(
        'a product changed only by a system pass is still approvable; one whose source text changed is stale',
        async () => {
          await tx.$executeRawUnsafe(
            `UPDATE ai_items SET status = 'REJECTED', row_version = row_version + 1 WHERE status = 'DRAFT_READY'`,
          );
          const bumped = await make({ snapshot: true });
          const bumpedTwice = await make({ snapshot: true });
          const reworded = await make({ snapshot: true });
          // A pass that does not touch the source text moves the version (a price edit, a stock note, a re-save).
          for (const entry of [bumped, bumpedTwice, reworded]) {
            await tx.$executeRawUnsafe(
              `UPDATE products SET row_version = row_version + 1 WHERE id = '${entry.productId}'`,
            );
          }
          await tx.$executeRawUnsafe(
            `UPDATE products SET row_version = row_version + 1 WHERE id = '${bumpedTwice.productId}'`,
          );
          await tx.$executeRawUnsafe(
            `UPDATE products SET description_vi = description_vi || ' Câu mới của nhà cung cấp.', row_version = row_version + 1 WHERE id = '${reworded.productId}'`,
          );
          const preview = await ai.previewApproveAll(worker.token);
          assert.equal(preview.changed, 1);
          assert.equal(preview.eligible, 2);
          assert.equal((await ai.getDraft(worker.token, bumped.itemId)).stale, false);
          const single = await ai.applyDraft(worker.token, bumped.itemId, {
            expectedRowVersion: 1,
          });
          assert.equal(single.result, 'APPLIED');
          const result = await ai.approveAll(worker.token, {
            items: [bumpedTwice, reworded].map((entry) => ({ id: entry.itemId, rowVersion: 1 })),
          });
          assert.equal(result.applied, 1);
          assert.deepEqual(result.skipped, [{ id: reworded.itemId, reason: 'STALE' }]);
          const [product] = await rows<{ description_vi: string }>(
            `SELECT description_vi FROM products WHERE id = $1::uuid`,
            reworded.productId,
          );
          assert.match(product!.description_vi, /Câu mới của nhà cung cấp\.$/);
        },
      );
    });
  },
);
