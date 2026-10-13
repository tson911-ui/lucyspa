import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ClaudeClient, FakeAnthropic, fixPendingDrafts } from '@lucy-spa/server';
import { phase6Fixture } from '../testing/phase6-fixture.js';

/**
 * Claude integration CI-F1 (Owner decision of 2026-10-13, item 5) against real PostgreSQL and a fake Anthropic server: the drafts that
 * already wait for review get the free fixes (no model, no cost), then, only when asked and only where a real problem is left, the one
 * targeted repair call. A draft a person edited is never touched; a second run changes nothing; nothing is published. Fixtures roll back.
 */
const SUPPLIER_TEXT = [
  'Sữa rửa mặt cấp ẩm The Whoo Hồng Gongjinhyang 180ml giúp làm sạch sâu mà vẫn giữ độ ẩm tự nhiên cho làn da khô.',
  'Thành phần: Chiết xuất hoa sen, Glycerin',
  'Hướng dẫn sử dụng: lấy một lượng vừa đủ, tạo bọt với nước, massage nhẹ nhàng rồi rửa sạch lại với nước mát.',
  'Dung tích: 180ml',
].join('\n');
const SNAPSHOT = {
  nameVi: 'Sữa Rửa Mặt Cấp Ẩm The Whoo Hồng Gongjinhyang 180ml',
  brand: 'The Whoo',
  category: 'Làm sạch',
  variantLabels: ['180ml'],
  supplierText: SUPPLIER_TEXT,
  attributes: [{ name: 'Dung tích', values: ['180ml'] }],
};
const CLEAN = {
  descriptionVi:
    'Một lớp bọt mịn giúp bạn rửa sạch bụi bẩn nhẹ nhàng, để da khô vẫn còn cảm giác mềm và đủ ẩm sau khi rửa. Sản phẩm dung tích 180ml, phù hợp cho thói quen chăm sóc da mỗi ngày tại Lucy Spa.',
  sectionsVi: {
    benefits: 'Làm sạch sâu và giữ độ ẩm tự nhiên cho da khô.',
    ingredients: 'Chiết xuất hoa sen, Glycerin.',
    usage: 'Tạo bọt với một lượng vừa đủ, massage nhẹ rồi rửa lại với nước mát.',
    suitableFor: 'Phù hợp với hầu hết các loại da.',
  },
  descriptionEn:
    'A soft, creamy foam that lifts away dirt gently and leaves dry skin feeling soft and comfortably hydrated. The 180ml size fits a daily skincare routine.',
  sectionsEn: {
    benefits: 'Deep cleansing that keeps the skin’s natural moisture.',
    ingredients: 'Lotus extract, Glycerin.',
    usage: 'Work a small amount into a foam with water, massage gently and rinse with cool water.',
    suitableFor: 'Suitable for most skin types.',
  },
  nameEn: 'The Whoo Gongjinhyang Soo Hydrating Cleansing Foam 180ml',
  nameViSuggestion: null,
  seoTitleVi: 'Sữa rửa mặt Gongjinhyang The Whoo 180ml | Lucy Spa',
  seoTitleEn: 'The Whoo Hydrating Cleansing Foam 180ml | Lucy Spa',
  seoDescriptionVi:
    'Sữa rửa mặt cấp ẩm The Whoo Gongjinhyang 180ml cho da khô, mua tại Lucy Spa, Đà Nẵng.',
  seoDescriptionEn:
    'The Whoo hydrating cleansing foam, 180ml, for dry skin. Available at Lucy Spa in Da Nang.',
  suitableForInferred: false,
  factsKept: [],
  uncertain: [],
};

test(
  'Claude integration CI-F1 pending drafts: free fixes for all, repair only where a real problem is left, edited drafts untouched, a second run changes nothing; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    const fake = new FakeAnthropic();
    const baseUrl = await fake.start();
    try {
      await phase6Fixture(async (base) => {
        const { tx } = base;
        const actor = await base.staff(['MANAGE_PRODUCTS']);
        const client = new ClaudeClient({ apiKey: 'sk-ant-test-key-never-real', baseUrl });
        const rows = async <T>(sql: string, ...values: unknown[]) =>
          tx.$queryRawUnsafe<T[]>(sql, ...values);
        await tx.$executeRawUnsafe(
          `UPDATE ai_items SET status = 'REJECTED', row_version = row_version + 1 WHERE status NOT IN ('APPLIED', 'REJECTED')`,
        );
        await tx.$executeRawUnsafe(
          `UPDATE ai_settings SET enabled = true, rewrite_enabled = true, vnd_per_usd = 26000, row_version = row_version + 1 WHERE id = 1`,
        );
        const [run] = await rows<{ id: string }>(
          `INSERT INTO ai_runs (kind, scope, status, model, effort, prompt_version, started_by_user_id)
           VALUES ('PRODUCT_TEXT', 'SELECTION', 'DONE', 'claude-opus-5-5', 'medium', 'product-rewrite.v2', $1::uuid) RETURNING id`,
          actor.id,
        );
        let counter = 0;
        const make = async (draft: Record<string, unknown>, edited = false) => {
          counter += 1;
          const product = await tx.product.create({
            data: {
              code: `ai-pend-${base.run.toLowerCase()}-${counter}`,
              nameVi: `Sản phẩm chờ ${counter}`,
              nameEn: `Pending product ${counter}`,
              descriptionVi: 'Mô tả cũ',
              createdByUserId: actor.id,
            },
            select: { id: true, rowVersion: true },
          });
          const [item] = await rows<{ id: string }>(
            `INSERT INTO ai_items (run_id, kind, target_type, target_id, base_row_version, base_snapshot, status, draft, warnings, edited, created_at)
             VALUES ($1::uuid, 'PRODUCT_TEXT', 'PRODUCT', $2::uuid, $3, $4::jsonb, 'DRAFT_READY', $5::jsonb, '[]'::jsonb, $6::jsonb, $7::timestamptz)
             RETURNING id`,
            run!.id,
            product.id,
            product.rowVersion,
            JSON.stringify(SNAPSHOT),
            JSON.stringify(draft),
            edited ? JSON.stringify({ content: CLEAN, useNameSuggestion: false }) : null,
            new Date(Date.UTC(2026, 0, 1) + counter * 1000).toISOString(),
          );
          return item!.id;
        };
        const read = async (id: string) =>
          (
            await rows<{
              status: string;
              draft: Record<string, unknown>;
              warnings: { code: string }[];
              row_version: number;
              cost_micro_usd: bigint;
            }>(
              `SELECT status, draft, warnings, row_version, cost_micro_usd FROM ai_items WHERE id = $1::uuid`,
              id,
            )
          )[0]!;
        const dirty = {
          ...CLEAN,
          descriptionVi: `${CLEAN.descriptionVi} Minh Thư (35 tuổi) nói rất thích. Không cần khám da trước khi dùng.`,
          seoTitleVi:
            'Sữa rửa mặt cấp ẩm chuyên sâu Gongjinhyang The Whoo 180ml cho da khô | Lucy Spa',
        };
        // Every sentence is a comment or a claim: the free fixes cannot drop it without leaving the field empty (they never do that).
        const HOPELESS_TEXT = 'Minh Thư (35 tuổi) nói rất thích. Cam kết hiệu quả vĩnh viễn.';
        const hopeless = { ...CLEAN, descriptionVi: HOPELESS_TEXT };
        const fixable = await make(dirty);
        const clean = await make(CLEAN);
        const editedDirty = await make({ ...dirty }, true);
        const needsRepair = await make(hopeless);
        const catalogBefore = await tx.product.count({ where: { contentOrigin: 'SUPPLIER_COPY' } });

        await suite.test(
          'free fixes only: the fixable draft is cleaned, the clean one is left, the edited one is skipped, the hopeless one is counted for repair; no call, no cost',
          async () => {
            const before = await read(needsRepair);
            const report = await fixPendingDrafts(tx, client, { repair: false });
            assert.equal(report.pending, 4);
            assert.equal(report.skippedEdited, 1);
            assert.equal(report.skippedBusy, 0);
            assert.equal(report.fixedFree, 1);
            assert.equal(report.alreadyClean, 1);
            assert.equal(report.needRepair, 1);
            assert.equal(report.repairSkipped, 1);
            assert.equal(report.repairCalls, 0);
            assert.equal(report.repairCostMicroUsd, '0');
            assert.equal(fake.requests.length, 0, 'nothing was sent to the model');
            const fixed = await read(fixable);
            assert.equal(fixed.status, 'DRAFT_READY', 'a draft stays a draft');
            assert.doesNotMatch(String(fixed.draft['descriptionVi']), /Minh Thư|khám/);
            assert.match(String(fixed.draft['descriptionVi']), /^Một lớp bọt mịn/);
            assert.ok([...String(fixed.draft['seoTitleVi'])].length <= 60);
            assert.deepEqual(fixed.warnings, []);
            assert.ok(
              (fixed.draft['autoFixes'] as { how: string }[]).every((fix) => fix.how === 'CODE'),
            );
            assert.equal(fixed.row_version, 2, 'the row version advanced by one');
            assert.equal((await read(clean)).row_version, 1, 'a clean draft is not rewritten');
            const kept = await read(editedDirty);
            assert.match(
              String(kept.draft['descriptionVi']),
              /Minh Thư/,
              'an edited draft is the Owner’s text',
            );
            assert.equal(kept.row_version, 1);
            const hopelessNow = await read(needsRepair);
            assert.equal(
              hopelessNow.draft['descriptionVi'],
              HOPELESS_TEXT,
              'a required field is never emptied',
            );
            assert.ok(hopelessNow.warnings.some((warning) => warning.code === 'TESTIMONIAL'));
            assert.ok(!hopelessNow.warnings.some((warning) => warning.code === 'EMPTY_FIELD'));
            assert.equal(report.blankedDrafts, 0);
            assert.equal(report.notesRefreshed, 1, 'the hopeless draft had no notes stored');
            assert.ok((report.needRepairByCode['TESTIMONIAL'] ?? 0) >= 1);
            assert.equal(report.needRepairAfter, 1);
            assert.equal(before.cost_micro_usd, hopelessNow.cost_micro_usd);
            assert.equal(
              await tx.product.count({ where: { contentOrigin: 'SUPPLIER_COPY' } }),
              catalogBefore,
              'the catalog is never touched',
            );
          },
        );

        await suite.test('a second free run changes nothing', async () => {
          const report = await fixPendingDrafts(tx, client, { repair: false });
          assert.equal(report.fixedFree, 0);
          assert.equal(report.alreadyClean, 2);
          assert.equal(report.needRepair, 1);
          assert.equal((await read(fixable)).row_version, 2);
        });

        await suite.test(
          'repair on request: one call for the hopeless draft only, ledger row REPAIRED, the cost is reported and stored; then nothing is left to repair',
          async () => {
            fake.enqueue({
              kind: 'message',
              text: JSON.stringify({ description_vi: CLEAN.descriptionVi }),
              usage: { input: 1500, output: 400 },
              requestId: 'req_pending_repair',
            });
            const report = await fixPendingDrafts(tx, client, { repair: true });
            assert.equal(report.repairCalls, 1);
            assert.equal(report.repaired, 1);
            assert.equal(report.fixedFree, 0);
            assert.equal(fake.requests.length, 1);
            assert.ok(BigInt(report.repairCostMicroUsd) > 0n);
            const after = await read(needsRepair);
            assert.equal(after.draft['descriptionVi'], CLEAN.descriptionVi);
            assert.deepEqual(after.warnings, []);
            assert.equal(after.status, 'DRAFT_READY');
            assert.equal(after.cost_micro_usd, BigInt(report.repairCostMicroUsd));
            const ledger = await rows<{ outcome: string; cost_micro_usd: bigint }>(
              `SELECT outcome, cost_micro_usd FROM ai_usage_ledger WHERE item_id = $1::uuid`,
              needsRepair,
            );
            assert.deepEqual(ledger, [
              { outcome: 'REPAIRED', cost_micro_usd: BigInt(report.repairCostMicroUsd) },
            ]);
            const again = await fixPendingDrafts(tx, client, { repair: true });
            assert.equal(again.needRepair, 0);
            assert.equal(again.repairCalls, 0);
            assert.equal(fake.requests.length, 1);
            assert.equal(report.needRepairAfter, 0);
            assert.deepEqual(report.remainingByCode, {});
          },
        );

        await suite.test(
          'stored notes are brought up to date without a change to the draft; a product named with a banned word is not flagged or emptied',
          async () => {
            const stale = await make(CLEAN);
            await tx.$executeRawUnsafe(
              `UPDATE ai_items SET warnings = '[{"code":"TESTIMONIAL","field":"descriptionVi"}]'::jsonb, row_version = row_version + 1 WHERE id = $1::uuid`,
              stale,
            );
            // The product is named with words that only look like claims: manicure, semi-permanent, 100%.
            const named = await make({
              ...CLEAN,
              nameEn: 'The Whoo Manicure Set Semi-permanent Gel 100% Pure 180ml',
              seoTitleEn: 'The Whoo Manicure Set 180ml | Lucy Spa',
            });
            await tx.$executeRawUnsafe(
              `UPDATE ai_items SET base_snapshot = jsonb_set(base_snapshot, '{nameVi}', '"The Whoo Manicure Set Semi-permanent Gel 100% Pure 180ml"'), row_version = row_version + 1 WHERE id = $1::uuid`,
              named,
            );
            const before = await read(stale);
            const report = await fixPendingDrafts(tx, client, { repair: false });
            assert.equal(report.notesRefreshed, 1);
            assert.equal(report.fixedFree, 0);
            assert.equal(report.needRepair, 0);
            const after = await read(stale);
            assert.deepEqual(after.draft, before.draft, 'the draft text is untouched');
            assert.deepEqual(after.warnings, []);
            assert.equal(after.row_version, before.row_version + 1);
            const keptName = await read(named);
            assert.equal(
              keptName.draft['nameEn'],
              'The Whoo Manicure Set Semi-permanent Gel 100% Pure 180ml',
            );
            assert.deepEqual(keptName.warnings, []);
          },
        );

        await suite.test(
          'a blank required field is counted, repaired for that field only, and no longer blank afterwards',
          async () => {
            const blank = await make({ ...CLEAN, nameEn: '' });
            fake.enqueue({
              kind: 'message',
              text: JSON.stringify({ name_en: 'The Whoo Gongjinhyang Cleansing Foam 180ml' }),
              usage: { input: 1200, output: 300 },
              requestId: 'req_blank_repair',
            });
            const free = await fixPendingDrafts(tx, client, { repair: false });
            assert.equal(free.blankedDrafts, 1);
            assert.equal(free.needRepairByCode['EMPTY_FIELD'], 1);
            const sent = fake.requests.length;
            const report = await fixPendingDrafts(tx, client, { repair: true });
            assert.equal(report.repairCalls, 1);
            assert.equal(fake.requests.length, sent + 1);
            assert.equal(report.blankedDrafts, 1, 'counted at the start of the run');
            assert.equal(report.needRepairAfter, 0);
            assert.equal(
              (await read(blank)).draft['nameEn'],
              'The Whoo Gongjinhyang Cleansing Foam 180ml',
            );
            assert.equal((await fixPendingDrafts(tx, client, { repair: false })).blankedDrafts, 0);
          },
        );

        await suite.test(
          'the repair stops before a call that could pass the spending limit; what is left is counted per code',
          async () => {
            await make({ ...CLEAN, descriptionVi: HOPELESS_TEXT });
            await make({ ...CLEAN, descriptionVi: HOPELESS_TEXT });
            const sent = fake.requests.length;
            const capped = await fixPendingDrafts(tx, client, { repair: true, maxSpendVnd: 1 });
            assert.equal(capped.stoppedByBudget, true);
            assert.equal(capped.repairCalls, 0);
            assert.equal(capped.repairSkipped, 2);
            assert.equal(fake.requests.length, sent, 'no call was made');
            assert.equal(capped.needRepairAfter, 2);
            assert.ok((capped.remainingByCode['TESTIMONIAL'] ?? 0) >= 2);
            // A limit that fits both calls: both are made. The answers still hold a claim, so the codes stay in the report.
            for (const requestId of ['req_cap_1', 'req_cap_2']) {
              fake.enqueue({
                kind: 'message',
                text: JSON.stringify({ description_vi: 'Khách Lan (40 tuổi) nói dùng rất thích.' }),
                usage: { input: 1200, output: 200 },
                requestId,
              });
            }
            const open = await fixPendingDrafts(tx, client, {
              repair: true,
              maxSpendVnd: 1_000_000,
            });
            assert.equal(open.stoppedByBudget, false);
            assert.equal(open.repairCalls, 2);
            assert.equal(open.needRepairAfter, 2);
            assert.ok((open.remainingByCode['TESTIMONIAL'] ?? 0) >= 2);
          },
        );
      });
    } finally {
      await fake.stop();
    }
  },
);
