import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AI_RUN_LIMITS, type AiDraftContent } from '@lucy-spa/contracts';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { AiService } from './ai.service.js';

/**
 * Claude integration Wave A (CI-R3) against real PostgreSQL: the runs and the Owner's rules. The first run is exactly three products;
 * more than three at once is locked until three drafts were judged and the Owner presses "Cho phép chạy tiếp"; only supplier-copy
 * products with text and no open draft are taken; one run at a time; pause, resume and cancel; a page of drafts is approved at once
 * only after three were applied one by one, only for drafts without warnings that the reviewer has seen. Starting a run changes no
 * product and calls nothing. Fixtures roll back.
 */
const SUPPLIER = [
  'Sữa rửa mặt cấp ẩm The Whoo Hồng Gongjinhyang 180ml giúp làm sạch sâu mà vẫn giữ độ ẩm tự nhiên cho làn da khô.',
  'Thành phần nổi bật',
  '- Chiết xuất hoa sen: làm dịu da.',
  '- Glycerin: giữ ẩm.',
  'Hướng dẫn sử dụng',
  'Lấy một lượng vừa đủ, tạo bọt với nước, massage nhẹ nhàng rồi rửa sạch lại với nước mát.',
  'Dung tích: 180ml',
].join('\n');

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
  'Claude integration Wave A runs: first three, unlock, selection, one at a time, pause/resume/cancel, page approval; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const { tx, fails } = base;
      const ai = new AiService(base.adapter, base.throttle);
      const worker = await base.staff([], { globalCodes: ['USE_AI_CONTENT', 'MANAGE_PRODUCTS'] });
      const reader = await base.staff([], { globalCodes: ['USE_AI_CONTENT'] });
      const nobody = await base.staff([]);
      const settingsManager = await base.staff([], {
        globalCodes: ['USE_AI_CONTENT', 'MANAGE_PRODUCTS', 'MANAGE_AI_SETTINGS'],
      });
      const rows = async <T>(sql: string, ...values: unknown[]) =>
        tx.$queryRawUnsafe<T[]>(sql, ...values);
      const settings = (assignments: string) =>
        tx.$executeRawUnsafe(
          `UPDATE ai_settings SET ${assignments}, row_version = row_version + 1 WHERE id = 1`,
        );
      // The database may hold other supplier products (it is shared): they are set aside so the counts below are exactly ours.
      await tx.$executeRawUnsafe(
        `UPDATE products SET content_origin = 'LUCY_MANUAL', row_version = row_version + 1 WHERE content_origin = 'SUPPLIER_COPY'`,
      );
      let counter = 0;
      const make = async (patch: { origin?: string; text?: string } = {}) => {
        counter += 1;
        return tx.product.create({
          data: {
            code: `ai-run-${base.run.toLowerCase()}-${counter}`,
            nameVi: `Sản phẩm chạy ${counter}`,
            nameEn: `Run product ${counter}`,
            descriptionVi: patch.text ?? SUPPLIER,
            contentOrigin: patch.origin ?? 'SUPPLIER_COPY',
            createdByUserId: worker.id,
          },
          select: { id: true },
        });
      };
      const products = [] as { id: string }[];
      for (let n = 0; n < 8; n += 1) products.push(await make());
      const thin = await make({ text: 'ngắn' });
      const manual = await make({ origin: 'LUCY_MANUAL' });
      const itemsOf = (runId: string) =>
        rows<{ id: string; target_id: string; status: string; error_code: string | null }>(
          `SELECT id, target_id, status, error_code FROM ai_items WHERE run_id = $1::uuid ORDER BY created_at, id`,
          runId,
        );
      const audit = (action: string) => tx.auditEvent.findMany({ where: { action } });
      const closeRuns = () =>
        tx.$executeRawUnsafe(
          `UPDATE ai_runs SET status = 'DONE', row_version = row_version + 1 WHERE status IN ('QUEUED','RUNNING','PAUSED_CAP','PAUSED_USER','PAUSED_ERROR')`,
        );

      await suite.test(
        'authority and the switches: nothing runs while AI is off or no rate is typed; the preview says why',
        async () => {
          await fails(() => ai.listRuns(undefined), 'AUTHENTICATION_REQUIRED');
          await fails(() => ai.previewRun(nobody.token, { scope: 'FIRST_THREE' }), 'FORBIDDEN');
          await fails(() => ai.createRun(nobody.token, { scope: 'FIRST_THREE' }), 'FORBIDDEN');
          await fails(
            () => ai.previewRun(worker.token, { scope: 'EVERYTHING' }),
            'VALIDATION_FAILED',
            'scope',
          );
          const off = await ai.previewRun(worker.token, { scope: 'FIRST_THREE' });
          assert.deepEqual(off.blocked, ['OFF', 'NO_RATE']);
          await fails(
            () => ai.createRun(worker.token, { scope: 'FIRST_THREE' }),
            'CONFLICT',
            'OFF',
          );
          await settings('enabled = true');
          assert.deepEqual((await ai.previewRun(worker.token, { scope: 'FIRST_THREE' })).blocked, [
            'REWRITE_OFF',
            'NO_RATE',
          ]);
          await settings('rewrite_enabled = true');
          assert.deepEqual((await ai.previewRun(worker.token, { scope: 'FIRST_THREE' })).blocked, [
            'NO_RATE',
          ]);
          await settings('vnd_per_usd = 26000');
          const ready = await ai.previewRun(worker.token, { scope: 'FIRST_THREE' });
          assert.deepEqual(ready.blocked, []);
          assert.equal(ready.count, 3);
          assert.equal(ready.pending, 8, 'the thin and the manual product are not pending');
          assert.equal(ready.model, 'claude-opus-5-5');
          assert.ok(Number(ready.estimateVnd) > 0);
          assert.ok(Number(ready.capLeftVnd) > Number(ready.estimateVnd));
          assert.equal(ready.unlocked, false);
        },
      );

      let firstRunId = '';
      await suite.test(
        'the first run is exactly three products, writes no change and calls nothing; a second first run is refused',
        async () => {
          const before = await tx.product.count({ where: { contentOrigin: 'SUPPLIER_COPY' } });
          const run = await ai.createRun(worker.token, { scope: 'FIRST_THREE' });
          firstRunId = run.id;
          assert.equal(run.status, 'QUEUED');
          assert.equal(run.scope, 'FIRST_THREE');
          assert.equal(run.counts.total, 3);
          assert.equal(run.counts.queued, 3);
          assert.equal(run.model, 'claude-opus-5-5');
          assert.ok(run.startedByName !== undefined);
          const items = await itemsOf(run.id);
          assert.deepEqual(
            items.map((item) => item.target_id),
            products.slice(0, 3).map((product) => product.id),
            'the first three in the order they were added',
          );
          // Each item holds the product's text as it is now.
          const [snap] = await rows<{ base_snapshot: { nameVi: string; supplierText: string } }>(
            `SELECT base_snapshot FROM ai_items WHERE id = $1::uuid`,
            items[0]!.id,
          );
          assert.equal(snap!.base_snapshot.nameVi, 'Sản phẩm chạy 1');
          assert.match(snap!.base_snapshot.supplierText, /Sữa rửa mặt cấp ẩm/);
          assert.equal(
            await tx.product.count({ where: { contentOrigin: 'SUPPLIER_COPY' } }),
            before,
          );
          assert.equal((await audit('AI_RUN_CREATED')).length, 1);
          // One run at a time; the first run happens once.
          assert.deepEqual((await ai.previewRun(worker.token, { scope: 'FIRST_THREE' })).blocked, [
            'RUN_ACTIVE',
            'FIRST_THREE_DONE',
          ]);
          await fails(() => ai.createRun(worker.token, { scope: 'FIRST_THREE' }), 'CONFLICT');
          const list = await ai.listRuns(reader.token);
          assert.equal(list.runs[0]!.id, run.id);
          assert.equal(list.unlocked, false);
          assert.equal(list.canUnlock, false);
        },
      );

      await suite.test(
        'pause, resume and cancel: versions, states, and a cancelled run frees its queued products',
        async () => {
          const run = (await ai.listRuns(reader.token)).runs[0]!;
          await fails(
            () =>
              ai.commandRun(reader.token, run.id, 'pause', {
                expectedRowVersion: run.rowVersion + 1,
              }),
            'CONFLICT',
          );
          const paused = await ai.commandRun(reader.token, run.id, 'pause', {
            expectedRowVersion: run.rowVersion,
          });
          assert.equal(paused.status, 'PAUSED_USER');
          assert.equal(paused.pauseReason, 'USER');
          await fails(
            () =>
              ai.commandRun(reader.token, run.id, 'pause', {
                expectedRowVersion: paused.rowVersion,
              }),
            'CONFLICT',
          );
          const resumed = await ai.commandRun(reader.token, run.id, 'resume', {
            expectedRowVersion: paused.rowVersion,
          });
          assert.equal(resumed.status, 'QUEUED');
          assert.equal(resumed.pauseReason, null);
          const cancelled = await ai.commandRun(reader.token, run.id, 'cancel', {
            expectedRowVersion: resumed.rowVersion,
          });
          assert.equal(cancelled.status, 'CANCELLED');
          assert.ok(cancelled.finishedAt);
          assert.equal(cancelled.counts.rejected, 3);
          assert.deepEqual(
            (await itemsOf(run.id)).map((item) => item.error_code),
            ['RUN_CANCELLED', 'RUN_CANCELLED', 'RUN_CANCELLED'],
          );
          await fails(
            () =>
              ai.commandRun(reader.token, run.id, 'cancel', {
                expectedRowVersion: cancelled.rowVersion,
              }),
            'CONFLICT',
          );
          assert.equal((await audit('AI_RUN_CANCELLED')).length, 1);
          // The same three are free again, and a cancelled first run does not count as done.
          const again = await ai.previewRun(worker.token, { scope: 'FIRST_THREE' });
          assert.deepEqual(again.blocked, []);
          assert.equal(again.count, 3);
        },
      );

      await suite.test(
        'selection: at most three before the unlock, only products a run may take',
        async () => {
          const four = products.slice(0, 4).map((product) => product.id);
          const thinId = thin.id;
          await fails(
            () => ai.createRun(worker.token, { scope: 'SELECTION', productIds: [thinId] }),
            'VALIDATION_FAILED',
            'productIds',
          );
          await fails(
            () => ai.createRun(worker.token, { scope: 'SELECTION', productIds: [manual.id] }),
            'VALIDATION_FAILED',
            'productIds',
          );
          await fails(
            () => ai.createRun(worker.token, { scope: 'SELECTION', productIds: [] }),
            'VALIDATION_FAILED',
            'productIds',
          );
          await fails(
            () => ai.createRun(worker.token, { scope: 'SELECTION', productIds: ['x'] }),
            'VALIDATION_FAILED',
            'productIds',
          );
          await fails(
            () => ai.createRun(worker.token, { scope: 'SELECTION', productIds: four }),
            'CONFLICT',
            'LOCKED',
          );
          await fails(
            () => ai.createRun(worker.token, { scope: 'ALL_PENDING' }),
            'CONFLICT',
            'LOCKED',
          );
          const one = await ai.createRun(worker.token, {
            scope: 'SELECTION',
            productIds: [products[0]!.id],
          });
          assert.equal(one.counts.total, 1);
          // A product with an open draft is not taken again.
          await closeRuns();
          await fails(
            () => ai.createRun(worker.token, { scope: 'SELECTION', productIds: [products[0]!.id] }),
            'VALIDATION_FAILED',
            'productIds',
          );
          // Leave the product free for the later steps.
          await tx.$executeRawUnsafe(
            `UPDATE ai_items SET status = 'REJECTED', error_code = 'RUN_CANCELLED', row_version = row_version + 1 WHERE run_id = '${one.id}'`,
          );
        },
      );

      await suite.test(
        'the unlock: needs three drafts judged and MANAGE_AI_SETTINGS; then the rest may run, with a limit',
        async () => {
          let list = await ai.listRuns(settingsManager.token);
          await fails(
            () => ai.unlockRuns(worker.token, { expectedRowVersion: list.settingsRowVersion }),
            'FORBIDDEN',
          );
          // Three drafts are written and judged one by one (here: the worker's results are written directly).
          const run = await ai.createRun(worker.token, { scope: 'FIRST_THREE' });
          const items = await itemsOf(run.id);
          const draft = { ...CLEAN, nameViSuggestion: null, factsKept: ['180ml'], uncertain: [] };
          for (const item of items) {
            await tx.$executeRawUnsafe(
              `UPDATE ai_items SET status = 'DRAFT_READY', draft = $1::jsonb, row_version = row_version + 1 WHERE id = $2::uuid`,
              JSON.stringify(draft),
              item.id,
            );
          }
          await fails(
            () =>
              ai.unlockRuns(settingsManager.token, { expectedRowVersion: list.settingsRowVersion }),
            'VALIDATION_FAILED',
            'reviewed',
          );
          // Applied one by one (the review's own command).
          for (const item of items) {
            const detail = await ai.getDraft(worker.token, item.id);
            await ai.applyDraft(worker.token, item.id, { expectedRowVersion: detail.rowVersion });
          }
          // The worker closes a run when nothing is queued any more; here the drafts were written by hand.
          await closeRuns();
          list = await ai.listRuns(settingsManager.token);
          assert.equal(list.singleApplied, 3);
          assert.equal(list.reviewed, 3);
          assert.equal(list.canUnlock, true);
          assert.equal(
            (await ai.listRuns(worker.token)).canUnlock,
            false,
            'only the settings manager may unlock',
          );
          await fails(
            () =>
              ai.unlockRuns(settingsManager.token, {
                expectedRowVersion: list.settingsRowVersion + 1,
              }),
            'CONFLICT',
          );
          const unlocked = await ai.unlockRuns(settingsManager.token, {
            expectedRowVersion: list.settingsRowVersion,
          });
          assert.equal(unlocked.unlocked, true);
          assert.ok(unlocked.unlockedAt);
          assert.equal(unlocked.canUnlock, false);
          assert.equal((await audit('AI_RUNS_UNLOCKED')).length, 1);
          await fails(
            () =>
              ai.unlockRuns(settingsManager.token, {
                expectedRowVersion: unlocked.settingsRowVersion,
              }),
            'CONFLICT',
          );
          // The three applied are no longer the supplier's copy: five are pending.
          const preview = await ai.previewRun(worker.token, { scope: 'ALL_PENDING' });
          assert.deepEqual(preview.blocked, []);
          assert.equal(preview.count, 5);
          assert.equal(
            (await ai.previewRun(worker.token, { scope: 'ALL_PENDING', limit: 2 })).count,
            2,
          );
          await fails(
            () => ai.createRun(worker.token, { scope: 'ALL_PENDING', limit: 0 }),
            'VALIDATION_FAILED',
            'limit',
          );
          await fails(
            () =>
              ai.createRun(worker.token, { scope: 'ALL_PENDING', limit: AI_RUN_LIMITS.runMax + 1 }),
            'VALIDATION_FAILED',
            'limit',
          );
          const rest = await ai.createRun(worker.token, { scope: 'ALL_PENDING', limit: 4 });
          assert.equal(rest.counts.total, 4);
          assert.equal(
            (await ai.previewRun(worker.token, { scope: 'ALL_PENDING' })).blocked.includes(
              'RUN_ACTIVE',
            ),
            true,
          );
          firstRunId = rest.id;
        },
      );

      await suite.test(
        'page approval: needs three applied singly, drafts without warnings that this reviewer saw, fresh products; skipped ones say why',
        async () => {
          const run = (await ai.listRuns(worker.token)).runs.find(
            (entry) => entry.id === firstRunId,
          )!;
          const items = await itemsOf(run.id);
          assert.equal(items.length, 4);
          const draft = { ...CLEAN, nameViSuggestion: null, factsKept: [], uncertain: [] };
          const withWarning = [{ code: 'FACT_MISSING', field: 'descriptionVi' }];
          for (const [index, item] of items.entries()) {
            await tx.$executeRawUnsafe(
              `UPDATE ai_items SET status = 'DRAFT_READY', draft = $1::jsonb, warnings = $2::jsonb, row_version = row_version + 1 WHERE id = $3::uuid`,
              JSON.stringify(draft),
              JSON.stringify(index === 1 ? withWarning : []),
              item.id,
            );
          }
          const page = await ai.pageOfDrafts(worker.token, {});
          assert.equal(page.canApprove, true);
          assert.equal(page.singleApplied, 3);
          assert.equal(page.items.length, 4);
          assert.deepEqual(
            page.items.map((item) => item.eligible),
            [true, false, true, true],
          );
          await fails(() => ai.pageOfDrafts(nobody.token, {}), 'FORBIDDEN');
          const ids = items.map((item) => item.id);
          // Not seen yet: nothing is applied.
          const unseen = await ai.approvePage(worker.token, { itemIds: ids });
          assert.equal(unseen.applied, 0);
          assert.deepEqual(
            unseen.skipped.map((entry) => entry.reason),
            ['NOT_VIEWED', 'NOT_VIEWED', 'NOT_VIEWED', 'NOT_VIEWED'],
          );
          assert.deepEqual(await ai.viewPage(worker.token, { itemIds: ids }), {
            marked: 4,
          } as never);
          // The reader (no MANAGE_PRODUCTS) cannot apply; someone else's view does not count for the worker.
          await fails(() => ai.approvePage(reader.token, { itemIds: ids }), 'FORBIDDEN');
          // One product changes after its draft was written: stale.
          const staleTarget = items[3]!.target_id;
          await tx.$executeRawUnsafe(
            `UPDATE products SET description_vi = description_vi || ' (sửa)', row_version = row_version + 1 WHERE id = '${staleTarget}'`,
          );
          const approved = await ai.approvePage(worker.token, { itemIds: ids });
          assert.equal(approved.applied, 2);
          assert.deepEqual(
            approved.skipped.map((entry) => [entry.id, entry.reason]),
            [
              [ids[1]!, 'WARNINGS'],
              [ids[3]!, 'STALE'],
            ].sort((a, b) => ids.indexOf(a[0]!) - ids.indexOf(b[0]!)),
          );
          const [applied] = await rows<{ applied_via: string; status: string }>(
            `SELECT applied_via, status FROM ai_items WHERE id = $1::uuid`,
            ids[0]!,
          );
          assert.deepEqual(applied, { applied_via: 'PAGE', status: 'APPLIED' });
          const product = await tx.product.findUniqueOrThrow({
            where: { id: items[0]!.target_id },
            select: { descriptionVi: true, contentOrigin: true },
          });
          assert.equal(product.descriptionVi, CLEAN.descriptionVi);
          assert.equal(product.contentOrigin, 'LUCY_AI');
          const events = await audit('AI_DRAFT_APPLIED');
          assert.equal(
            events.filter(
              (event) => (event.after as Record<string, unknown>)['appliedVia'] === 'PAGE',
            ).length,
            2,
          );
          assert.equal((await audit('AI_PAGE_APPROVED')).length, 1);
          // The single approvals still number three (a page approval is not one of them).
          assert.equal((await ai.pageOfDrafts(worker.token, {})).singleApplied, 3);
          // Limits of one approval.
          await fails(
            () => ai.approvePage(worker.token, { itemIds: [] }),
            'VALIDATION_FAILED',
            'itemIds',
          );
          await fails(
            () =>
              ai.approvePage(worker.token, {
                itemIds: Array.from(
                  { length: 21 },
                  (_, n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
                ),
              }),
            'VALIDATION_FAILED',
            'itemIds',
          );
          await fails(
            () => ai.approvePage(worker.token, { itemIds: [ids[0]!, ids[0]!] }),
            'VALIDATION_FAILED',
            'itemIds',
          );
        },
      );

      await suite.test(
        'a page cannot be approved before three drafts were applied one by one',
        async () => {
          await tx.$executeRawUnsafe(
            `UPDATE ai_items SET applied_via = 'PAGE', row_version = row_version + 1 WHERE applied_via = 'SINGLE'`,
          );
          await fails(
            () =>
              ai.approvePage(worker.token, { itemIds: ['00000000-0000-4000-8000-000000000001'] }),
            'VALIDATION_FAILED',
            'singleApprovals',
          );
          assert.equal((await ai.pageOfDrafts(worker.token, {})).canApprove, false);
        },
      );
    });
  },
);
