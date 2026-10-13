import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AI_RUN_LIMITS, type AiDraftContent } from '@lucy-spa/contracts';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { AiService } from './ai.service.js';

/**
 * Claude integration Wave B ("Duyệt tất cả", Owner 2026-10-13) against real PostgreSQL: one preview and one confirm for every ready
 * product draft with zero warnings. Needs three single approvals first and `MANAGE_PRODUCTS`; the confirm applies exactly the previewed
 * list and re-checks each draft (ready, same row version, no note, product unchanged); a draft that became ready after the preview is
 * never picked up; applied in chunks, each product audited, one summary event. Fixtures roll back.
 */
const CLEAN: AiDraftContent = {
  descriptionVi:
    'Một lớp bọt mịn giúp bạn rửa sạch bụi bẩn nhẹ nhàng, để da khô vẫn còn cảm giác mềm và đủ ẩm sau khi rửa. Sản phẩm dung tích 180ml, phù hợp cho thói quen chăm sóc da mỗi ngày tại Lucy Spa.',
  sectionsVi: {
    benefits: 'Làm sạch sâu và giữ độ ẩm tự nhiên cho da khô.',
    ingredients: 'Chiết xuất hoa sen, Glycerin.',
    usage: null,
    suitableFor: null,
  },
  descriptionEn:
    'A soft, creamy foam that lifts away dirt gently and leaves dry skin feeling soft and comfortably hydrated. The 180ml size fits a daily skincare routine.',
  sectionsEn: {
    benefits: 'Deep cleansing that keeps the skin’s natural moisture.',
    ingredients: 'Lotus extract, Glycerin.',
    usage: null,
    suitableFor: null,
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
  'Claude integration Wave B approve all: zero-warning drafts only, previewed list only, checked again, chunked, audited; fixtures roll back',
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
        state: { status?: string; warnings?: unknown[]; via?: string } = {},
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
          select: { id: true },
        });
        const status = state.status ?? 'DRAFT_READY';
        const applied = status === 'APPLIED';
        const [item] = await rows<{ id: string }>(
          `INSERT INTO ai_items (run_id, kind, target_type, target_id, status, base_row_version, draft, warnings, created_at,
                                 applied_at, applied_by_user_id, applied_via)
           VALUES ($1::uuid, 'PRODUCT_TEXT', 'PRODUCT', $2::uuid, $3, 1, $4::jsonb, $5::jsonb, $6::timestamptz,
                   CASE WHEN $7 THEN now() END, CASE WHEN $7 THEN $8::uuid END, CASE WHEN $7 THEN $9 END)
           RETURNING id`,
          runId,
          product.id,
          status,
          draftJson,
          JSON.stringify(state.warnings ?? []),
          new Date(Date.UTC(2026, 0, 1) + counter * 1000).toISOString(),
          applied,
          worker.id,
          state.via ?? 'SINGLE',
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
        'the preview lists only clean, fresh drafts and counts the rest; a reader may look but not confirm',
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
          assert.equal(preview.eligible, 3);
          assert.equal(preview.withWarnings, 1);
          assert.equal(preview.changed, 1);
          assert.equal(preview.singleApplied >= AI_RUN_LIMITS.singleApprovalsNeeded, true);
          assert.equal(preview.canApprove, true);
          assert.deepEqual(
            preview.items.map((entry) => entry.id),
            clean.map((entry) => entry.itemId),
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
          void noted;
        },
      );

      await suite.test(
        'the confirm applies exactly the previewed list: later drafts are untouched, a changed draft is skipped, every product is audited',
        async () => {
          const preview = await ai.previewApproveAll(worker.token);
          const list = asList(preview);
          // A draft that became ready after the preview is never picked up.
          const late = await make();
          // A draft edited after the preview (its row version moved) is skipped.
          await tx.$executeRawUnsafe(
            `UPDATE ai_items SET row_version = row_version + 1 WHERE id = '${list[0]!.id}'`,
          );
          // A draft that gained a note after the preview is skipped by the fresh check.
          await tx.$executeRawUnsafe(
            `UPDATE ai_items SET warnings = '[{"code":"FACT_MISSING"}]'::jsonb, row_version = row_version + 1 WHERE id = '${list[1]!.id}'`,
          );
          const result = await ai.approveAll(worker.token, { items: list });
          assert.equal(result.applied, 1);
          assert.deepEqual(
            result.skipped.map((entry) => [entry.id, entry.reason]).sort(),
            [
              [list[0]!.id, 'CHANGED'],
              [list[1]!.id, 'CHANGED'],
            ].sort(),
          );
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
          assert.equal(events.length, 1);
          assert.equal((await audit('AI_APPROVE_ALL')).length, 1);
          // The single approvals still number three or more by singles only; "all" is not one of them.
          assert.equal(
            (
              await rows<{ n: bigint }>(
                `SELECT count(*) AS n FROM ai_items WHERE applied_via = 'ALL'`,
              )
            )[0]!.n,
            1n,
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
              items: Array.from({ length: AI_RUN_LIMITS.approveAllMax + 1 }, (_, n) => ({
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
        // An id that is not a draft of product text is refused, not skipped silently.
        await fails(
          () => ai.approveAll(worker.token, { items: [{ id, rowVersion: 1 }] }),
          'NOT_FOUND',
        );
      });
    });
  },
);
