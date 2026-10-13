import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AI_DRAFT_LIMITS, type AiDraftContent } from '@lucy-spa/contracts';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { AiService } from './ai.service.js';

/**
 * Claude integration Wave A (CI-R2) against real PostgreSQL: the review of AI drafts. Authority (USE_AI_CONTENT for the review, plus
 * MANAGE_PRODUCTS to apply), the list and the detail next to the current text, view, edit with new checks, apply (blocking warnings
 * refuse, quality notes need an acknowledgement, a changed product is STALE, the origin follows the edit, the audit keeps the full
 * before and after), reject, regenerate (three times at most) and retry. The catalog changes only on apply. Fixtures roll back.
 */
const SNAPSHOT = {
  nameVi: 'Sữa Rửa Mặt Cấp Ẩm The Whoo Hồng Gongjinhyang 180ml',
  brand: 'The Whoo',
  category: 'Làm sạch',
  variantLabels: ['180ml'],
  supplierText:
    'Sữa rửa mặt cấp ẩm The Whoo Hồng Gongjinhyang 180ml giúp làm sạch sâu mà vẫn giữ độ ẩm tự nhiên cho làn da khô.\nThành phần nổi bật\n- Chiết xuất hoa sen: làm dịu da.\n- Glycerin: giữ ẩm.\nHướng dẫn sử dụng\nLấy một lượng vừa đủ, tạo bọt với nước, massage nhẹ nhàng rồi rửa sạch lại với nước mát.\nDung tích: 180ml',
  attributes: [{ name: 'Dung tích', values: ['180ml'] }],
};

const CLEAN: AiDraftContent = {
  descriptionVi:
    'Một lớp bọt mịn giúp bạn rửa sạch bụi bẩn nhẹ nhàng, để da khô vẫn còn cảm giác mềm và đủ ẩm sau khi rửa. Sản phẩm dung tích 180ml, phù hợp cho thói quen chăm sóc da mỗi ngày tại Lucy Spa.',
  sectionsVi: {
    benefits: 'Làm sạch sâu và giữ độ ẩm tự nhiên cho da khô.',
    ingredients: 'Chiết xuất hoa sen, Glycerin.',
    usage: 'Tạo bọt với một lượng vừa đủ, massage nhẹ rồi rửa lại với nước mát.',
    suitableFor: null,
  },
  descriptionEn:
    'A soft, creamy foam that lifts away dirt gently and leaves dry skin feeling soft and comfortably hydrated. The 180ml size fits a daily skincare routine.',
  sectionsEn: {
    benefits: 'Deep cleansing that keeps the skin’s natural moisture.',
    ingredients: 'Lotus extract, Glycerin.',
    usage: 'Work a small amount into a foam with water, massage gently and rinse with cool water.',
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
  'Claude integration Wave A AI drafts review: authority, list, detail, edit, apply, stale, reject, regenerate, retry; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const { tx, fails } = base;
      const ai = new AiService(base.adapter, base.throttle);
      const reviewer = await base.staff([], { globalCodes: ['USE_AI_CONTENT'] });
      const editor = await base.staff([], { globalCodes: ['USE_AI_CONTENT', 'MANAGE_PRODUCTS'] });
      const productsOnly = await base.staff([], { globalCodes: ['MANAGE_PRODUCTS'] });
      const rows = async <T>(sql: string, ...values: unknown[]) =>
        tx.$queryRawUnsafe<T[]>(sql, ...values);
      let counter = 0;
      const [run] = await rows<{ id: string }>(
        `INSERT INTO ai_runs (kind, scope, model, effort, prompt_version, started_by_user_id, status)
         VALUES ('PRODUCT_TEXT', 'SELECTION', 'claude-opus-5-5', 'medium', 'product-rewrite.v1', $1::uuid, 'DONE') RETURNING id`,
        editor.id,
      );
      const make = async (
        patch: {
          status?: string;
          draft?: Record<string, unknown> | null;
          nameViSuggestion?: string | null;
          inferred?: boolean;
          warnings?: unknown[];
        } = {},
      ) => {
        counter += 1;
        const product = await tx.product.create({
          data: {
            code: `ai-drv-${base.run.toLowerCase()}-${counter}`,
            nameVi: `Sữa rửa mặt thử ${counter}`,
            nameEn: `Test cleanser ${counter}`,
            descriptionVi: 'Mô tả cũ của nhà cung cấp',
            contentOrigin: 'SUPPLIER_COPY',
            createdByUserId: editor.id,
          },
          select: { id: true, rowVersion: true },
        });
        const draft =
          patch.draft === undefined
            ? {
                ...CLEAN,
                nameViSuggestion: patch.nameViSuggestion ?? null,
                suitableForInferred: patch.inferred ?? false,
                factsKept: ['180ml'],
                uncertain: [],
              }
            : patch.draft;
        const [item] = await rows<{ id: string }>(
          `INSERT INTO ai_items (run_id, kind, target_type, target_id, base_row_version, base_snapshot, status, draft, warnings)
           VALUES ($1::uuid, 'PRODUCT_TEXT', 'PRODUCT', $2::uuid, $3, $4::jsonb, $5, $6::jsonb, $7::jsonb) RETURNING id`,
          run!.id,
          product.id,
          product.rowVersion,
          JSON.stringify(SNAPSHOT),
          patch.status ?? 'DRAFT_READY',
          draft === null ? null : JSON.stringify(draft),
          JSON.stringify(patch.warnings ?? []),
        );
        return { id: item!.id, productId: product.id };
      };
      const product = (id: string) =>
        tx.product.findUniqueOrThrow({
          where: { id },
          select: {
            nameVi: true,
            nameEn: true,
            descriptionVi: true,
            descriptionEn: true,
            seoTitleVi: true,
            seoDescriptionEn: true,
            descriptionSectionsVi: true,
            contentOrigin: true,
            contentOriginAt: true,
            rowVersion: true,
          },
        });
      const audit = (action: string, entityId: string) =>
        tx.auditEvent.findMany({ where: { action, entityId } });

      await suite.test(
        'authority: the review needs USE_AI_CONTENT; apply also needs MANAGE_PRODUCTS',
        async () => {
          const { id } = await make();
          for (const token of [productsOnly.token, undefined]) {
            await fails(
              () => ai.listDrafts(token, {}),
              token ? 'FORBIDDEN' : 'AUTHENTICATION_REQUIRED',
            );
            await fails(
              () => ai.getDraft(token, id),
              token ? 'FORBIDDEN' : 'AUTHENTICATION_REQUIRED',
            );
          }
          assert.equal((await ai.getDraft(reviewer.token, id)).id, id);
          assert.equal((await ai.getDraft(base.ownerToken, id)).id, id);
          await fails(
            () => ai.applyDraft(reviewer.token, id, { expectedRowVersion: 1 }),
            'FORBIDDEN',
          );
          await fails(
            () => ai.applyDraft(productsOnly.token, id, { expectedRowVersion: 1 }),
            'FORBIDDEN',
          );
          await fails(() => ai.getDraft(reviewer.token, 'not-an-id'), 'NOT_FOUND');
          await fails(
            () => ai.getDraft(reviewer.token, '00000000-0000-4000-8000-000000000000'),
            'NOT_FOUND',
          );
        },
      );

      await suite.test(
        'list: counts per status, 20 per page, a status filter; the detail shows old next to new',
        async () => {
          const before = await ai.listDrafts(reviewer.token, {});
          const made = await make();
          await make({ status: 'FAILED', draft: null });
          const list = await ai.listDrafts(reviewer.token, {});
          assert.equal(list.total, before.total + 2);
          assert.equal(list.pageSize, AI_DRAFT_LIMITS.pageSize);
          assert.equal(list.counts.byStatus.FAILED, before.counts.byStatus.FAILED + 1);
          assert.equal(list.counts.byStatus.DRAFT_READY, before.counts.byStatus.DRAFT_READY + 1);
          const onlyFailed = await ai.listDrafts(reviewer.token, { status: 'FAILED' });
          assert.ok(onlyFailed.items.every((row) => row.status === 'FAILED'));
          await fails(
            () => ai.listDrafts(reviewer.token, { status: 'NOPE' }),
            'VALIDATION_FAILED',
            'status',
          );
          const detail = await ai.getDraft(reviewer.token, made.id);
          assert.equal(detail.status, 'DRAFT_READY');
          assert.equal(detail.stale, false);
          assert.equal(detail.blocking, false);
          assert.equal(detail.current.descriptionVi, 'Mô tả cũ của nhà cung cấp');
          assert.equal(detail.current.seoTitleVi, '');
          assert.equal(detail.draft?.seoTitleVi, CLEAN.seoTitleVi);
          assert.equal(detail.edited, null);
          assert.equal(detail.canRegenerate, true);
          assert.equal(detail.product.contentOrigin, 'SUPPLIER_COPY');
          const row = (await ai.listDrafts(reviewer.token, {})).items.find(
            (entry) => entry.id === made.id,
          );
          assert.equal(row?.viewed, false);
          assert.equal(row?.productId, made.productId);
        },
      );

      await suite.test(
        'view: the first view is recorded once and moves the row version once',
        async () => {
          const { id } = await make();
          const first = await ai.viewDraft(reviewer.token, id);
          assert.ok(first.viewedAt);
          const again = await ai.viewDraft(reviewer.token, id);
          assert.equal(again.rowVersion, first.rowVersion);
          assert.equal(again.viewedAt, first.viewedAt);
        },
      );

      await suite.test(
        'edit: saved, checked again (a clinic word blocks), refused when too long, stale, or not a draft',
        async () => {
          const { id } = await make();
          const detail = await ai.getDraft(reviewer.token, id);
          const edited = await ai.editDraft(reviewer.token, id, {
            expectedRowVersion: detail.rowVersion,
            content: { ...CLEAN, descriptionVi: `${CLEAN.descriptionVi}  Rất nhẹ nhàng.` },
          });
          assert.equal(edited.edited?.descriptionVi.endsWith('Rất nhẹ nhàng.'), true);
          assert.equal(edited.blocking, false);
          assert.equal(edited.rowVersion, detail.rowVersion + 1);
          // A stale version, a bad value, a clinic word.
          await fails(
            () =>
              ai.editDraft(reviewer.token, id, {
                expectedRowVersion: detail.rowVersion,
                content: CLEAN,
              }),
            'CONFLICT',
          );
          await fails(
            () =>
              ai.editDraft(reviewer.token, id, {
                expectedRowVersion: edited.rowVersion,
                content: { ...CLEAN, seoTitleVi: 'x'.repeat(AI_DRAFT_LIMITS.seoTitle + 1) },
              }),
            'VALIDATION_FAILED',
            'seoTitleVi',
          );
          await fails(
            () =>
              ai.editDraft(reviewer.token, id, {
                expectedRowVersion: edited.rowVersion,
                content: { ...CLEAN, descriptionVi: 'Có \u0007 ký tự lạ' },
              }),
            'VALIDATION_FAILED',
            'descriptionVi',
          );
          const flagged = await ai.editDraft(reviewer.token, id, {
            expectedRowVersion: edited.rowVersion,
            content: {
              ...CLEAN,
              descriptionVi: `${CLEAN.descriptionVi} Đặt lịch khám da miễn phí.`,
            },
          });
          assert.equal(flagged.blocking, true);
          assert.ok(
            flagged.warnings.some((warning) => warning.code === 'CLINIC_WORD' && warning.blocking),
          );
          // Only a draft can be edited.
          const failed = await make({ status: 'FAILED', draft: null });
          await fails(
            () =>
              ai.editDraft(reviewer.token, failed.id, { expectedRowVersion: 1, content: CLEAN }),
            'CONFLICT',
          );
          assert.equal((await audit('AI_DRAFT_EDITED', id)).length, 2);
        },
      );

      await suite.test(
        'apply: blocking warnings refuse, quality notes need an acknowledgement, the product changes only here',
        async () => {
          const { id, productId } = await make();
          let detail = await ai.getDraft(editor.token, id);
          // A blocking edit refuses.
          detail = await ai.editDraft(editor.token, id, {
            expectedRowVersion: detail.rowVersion,
            content: { ...CLEAN, descriptionVi: `${CLEAN.descriptionVi} Gọi 0905 123 456.` },
          });
          await fails(
            () => ai.applyDraft(editor.token, id, { expectedRowVersion: detail.rowVersion }),
            'VALIDATION_FAILED',
            'warnings',
          );
          assert.equal((await product(productId)).descriptionVi, 'Mô tả cũ của nhà cung cấp');
          // A quality note (a title over 60 characters) needs the acknowledgement.
          detail = await ai.editDraft(editor.token, id, {
            expectedRowVersion: detail.rowVersion,
            content: {
              ...CLEAN,
              seoTitleVi: `${CLEAN.seoTitleVi} - chăm sóc da mặt mỗi ngày tại Đà Nẵng`,
            },
          });
          assert.ok(
            detail.warnings.some(
              (warning) => warning.code === 'SEO_TITLE_LONG' && !warning.blocking,
            ),
          );
          await fails(
            () => ai.applyDraft(editor.token, id, { expectedRowVersion: detail.rowVersion }),
            'VALIDATION_FAILED',
            'acknowledgeWarnings',
          );
          const result = await ai.applyDraft(editor.token, id, {
            expectedRowVersion: detail.rowVersion,
            acknowledgeWarnings: true,
          });
          assert.equal(result.result, 'APPLIED');
          assert.equal(result.detail.status, 'APPLIED');
          assert.ok(result.detail.appliedAt);
          const after = await product(productId);
          assert.equal(after.descriptionVi, CLEAN.descriptionVi);
          assert.equal(after.descriptionEn, CLEAN.descriptionEn);
          assert.equal(after.nameEn, CLEAN.nameEn);
          assert.equal(
            after.seoTitleVi?.includes('chăm sóc da mặt'),
            true,
            'the edit is what was applied',
          );
          assert.deepEqual(after.descriptionSectionsVi, CLEAN.sectionsVi);
          assert.equal(after.contentOrigin, 'LUCY_MANUAL', 'edited by a person');
          assert.ok(after.contentOriginAt);
          assert.equal(
            after.nameVi.startsWith('Sữa rửa mặt thử'),
            true,
            'the Vietnamese name is never changed by default',
          );
          const [item] = await rows<{
            applied_via: string;
            applied_by_user_id: string;
            status: string;
          }>(
            `SELECT applied_via, applied_by_user_id, status FROM ai_items WHERE id = $1::uuid`,
            id,
          );
          assert.deepEqual(item, {
            applied_via: 'SINGLE',
            applied_by_user_id: editor.id,
            status: 'APPLIED',
          });
          const events = await audit('AI_DRAFT_APPLIED', productId);
          assert.equal(events.length, 1);
          const before = events[0]!.before as Record<string, unknown>;
          const afterJson = events[0]!.after as Record<string, unknown>;
          assert.equal(before['descriptionVi'], 'Mô tả cũ của nhà cung cấp');
          assert.equal(before['contentOrigin'], 'SUPPLIER_COPY');
          assert.equal(afterJson['descriptionVi'], CLEAN.descriptionVi);
          assert.equal(afterJson['aiItemId'], id);
          assert.deepEqual(afterJson['acknowledgedWarnings'], ['SEO_TITLE_LONG']);
          // Applied is history.
          await fails(
            () => ai.applyDraft(editor.token, id, { expectedRowVersion: result.detail.rowVersion }),
            'CONFLICT',
          );
          await fails(
            () =>
              ai.rejectDraft(editor.token, id, { expectedRowVersion: result.detail.rowVersion }),
            'CONFLICT',
          );
          assert.ok((await ai.listDrafts(editor.token, {})).appliedCount >= 1);
        },
      );

      await suite.test(
        'apply of an unedited draft is LUCY_AI; the suggested Vietnamese name is used only when chosen',
        async () => {
          const plain = await make();
          const detail = await ai.getDraft(editor.token, plain.id);
          const result = await ai.applyDraft(editor.token, plain.id, {
            expectedRowVersion: detail.rowVersion,
          });
          assert.equal(result.result, 'APPLIED');
          assert.equal((await product(plain.productId)).contentOrigin, 'LUCY_AI');
          // A suggestion that is never ticked changes nothing: the official name stays, and the box starts off.
          const untouched = await make({ nameViSuggestion: 'Tên gợi ý chưa được chọn' });
          const seen = await ai.getDraft(editor.token, untouched.id);
          assert.equal(seen.nameViSuggestion, 'Tên gợi ý chưa được chọn');
          assert.equal(seen.useNameSuggestion, false);
          assert.equal(seen.suitableForInferred, false);
          const guessed = await make({ inferred: true });
          assert.equal((await ai.getDraft(editor.token, guessed.id)).suitableForInferred, true);
          const official = (await product(untouched.productId)).nameVi;
          await ai.applyDraft(editor.token, untouched.id, { expectedRowVersion: seen.rowVersion });
          assert.equal((await product(untouched.productId)).nameVi, official);
          const named = await make({
            nameViSuggestion: 'Sữa Rửa Mặt Cấp Ẩm The Whoo Gongjinhyang 180ml',
          });
          let view = await ai.getDraft(editor.token, named.id);
          assert.equal(view.useNameSuggestion, false);
          assert.equal(view.nameViSuggestion, 'Sữa Rửa Mặt Cấp Ẩm The Whoo Gongjinhyang 180ml');
          view = await ai.editDraft(editor.token, named.id, {
            expectedRowVersion: view.rowVersion,
            content: CLEAN,
            useNameSuggestion: true,
          });
          assert.equal(view.useNameSuggestion, true);
          await ai.applyDraft(editor.token, named.id, { expectedRowVersion: view.rowVersion });
          assert.equal(
            (await product(named.productId)).nameVi,
            'Sữa Rửa Mặt Cấp Ẩm The Whoo Gongjinhyang 180ml',
          );
        },
      );

      await suite.test(
        'a product that changed since the draft is STALE: nothing is written; retry reads the product again',
        async () => {
          const { id, productId } = await make();
          const current = await product(productId);
          await tx.product.update({
            where: { id: productId },
            data: { descriptionVi: 'Mô tả mới do người sửa', rowVersion: current.rowVersion + 1 },
          });
          const detail = await ai.getDraft(editor.token, id);
          assert.equal(detail.stale, true);
          const result = await ai.applyDraft(editor.token, id, {
            expectedRowVersion: detail.rowVersion,
          });
          assert.equal(result.result, 'STALE');
          assert.equal(result.detail.status, 'STALE');
          const unchanged = await product(productId);
          assert.equal(unchanged.descriptionVi, 'Mô tả mới do người sửa');
          assert.equal(unchanged.seoTitleVi, null);
          assert.equal((await audit('AI_DRAFT_STALE', id)).length, 1);
          // Retry: queued again from the product as it is now.
          const retried = await ai.retryDraft(editor.token, id, {
            expectedRowVersion: result.detail.rowVersion,
          });
          assert.equal(retried.status, 'QUEUED');
          assert.equal(retried.draft, null);
          assert.equal(retried.stale, false);
          const [row] = await rows<{
            base_row_version: number;
            base_snapshot: { supplierText: string };
          }>(`SELECT base_row_version, base_snapshot FROM ai_items WHERE id = $1::uuid`, id);
          assert.equal(row!.base_row_version, current.rowVersion + 1);
          assert.match(row!.base_snapshot.supplierText, /Mô tả mới do người sửa/);
          const [runRow] = await rows<{ status: string }>(
            `SELECT status FROM ai_runs WHERE id = $1::uuid`,
            run!.id,
          );
          assert.equal(runRow!.status, 'RUNNING', 'a finished run works again for the queued item');
          await tx.$executeRawUnsafe(
            `UPDATE ai_runs SET status = 'DONE', row_version = row_version + 1 WHERE id = '${run!.id}'`,
          );
        },
      );

      await suite.test(
        'reject: the draft is history, the product is unchanged, the reason is audited',
        async () => {
          const { id, productId } = await make();
          const detail = await ai.getDraft(reviewer.token, id);
          const result = await ai.rejectDraft(reviewer.token, id, {
            expectedRowVersion: detail.rowVersion,
            reason: 'Văn phong chưa đúng',
          });
          assert.equal(result.status, 'REJECTED');
          assert.equal((await product(productId)).descriptionVi, 'Mô tả cũ của nhà cung cấp');
          const events = await audit('AI_DRAFT_REJECTED', id);
          assert.equal(events.length, 1);
          assert.equal(events[0]!.reason, 'Văn phong chưa đúng');
          await fails(
            () => ai.rejectDraft(reviewer.token, id, { expectedRowVersion: result.rowVersion }),
            'CONFLICT',
          );
          // The product may have a new draft once the old one is history.
          await make();
        },
      );

      await suite.test(
        'regenerate: one line of guidance, three times at most, not for a finished or applied draft',
        async () => {
          const { id } = await make();
          let detail = await ai.getDraft(reviewer.token, id);
          await fails(
            () =>
              ai.regenerateDraft(reviewer.token, id, {
                expectedRowVersion: detail.rowVersion,
                instruction: 'x'.repeat(AI_DRAFT_LIMITS.instruction + 1),
              }),
            'VALIDATION_FAILED',
            'instruction',
          );
          for (let n = 1; n <= AI_DRAFT_LIMITS.regenerationsMax; n += 1) {
            detail = await ai.regenerateDraft(reviewer.token, id, {
              expectedRowVersion: detail.rowVersion,
              ...(n === 1 ? { instruction: 'Viết ngắn hơn, giọng ấm áp' } : {}),
            });
            assert.equal(detail.status, 'QUEUED');
            assert.equal(detail.regenerations, n);
            assert.equal(detail.instruction, n === 1 ? 'Viết ngắn hơn, giọng ấm áp' : null);
            // The worker would write the new draft; here the item goes back to ready.
            await tx.$executeRawUnsafe(
              `UPDATE ai_items SET status = 'DRAFT_READY', row_version = row_version + 1 WHERE id = '${id}'`,
            );
            detail = await ai.getDraft(reviewer.token, id);
          }
          assert.equal(detail.canRegenerate, false);
          await fails(
            () => ai.regenerateDraft(reviewer.token, id, { expectedRowVersion: detail.rowVersion }),
            'VALIDATION_FAILED',
            'regenerations',
          );
          const queued = await make({ status: 'QUEUED', draft: null });
          await fails(
            () => ai.regenerateDraft(reviewer.token, queued.id, { expectedRowVersion: 1 }),
            'CONFLICT',
          );
          assert.equal((await audit('AI_DRAFT_REGENERATED', id)).length, 3);
        },
      );

      await suite.test(
        'retry: a failed or refused item goes back in the queue with its attempts reset',
        async () => {
          const failed = await make({ status: 'FAILED', draft: null });
          await tx.$executeRawUnsafe(
            `UPDATE ai_items SET attempts = 3, error_code = 'SERVER', row_version = row_version + 1 WHERE id = '${failed.id}'`,
          );
          const detail = await ai.getDraft(reviewer.token, failed.id);
          assert.equal(detail.errorCode, 'SERVER');
          const retried = await ai.retryDraft(reviewer.token, failed.id, {
            expectedRowVersion: detail.rowVersion,
          });
          assert.equal(retried.status, 'QUEUED');
          assert.equal(retried.errorCode, null);
          const [row] = await rows<{ attempts: number }>(
            `SELECT attempts FROM ai_items WHERE id = $1::uuid`,
            failed.id,
          );
          assert.equal(row!.attempts, 0);
          const ready = await make();
          await fails(
            () => ai.retryDraft(reviewer.token, ready.id, { expectedRowVersion: 1 }),
            'CONFLICT',
          );
        },
      );
    });
  },
);
