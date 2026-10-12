import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sha256Text } from '@lucy-spa/server';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { ProductTextCleanupService } from './product-text-cleanup.service.js';

const FACTS = 'Làm sạch da nhẹ nhàng.\nDung tích: 100ml';
const COMMENTS = [
  'Đánh giá người dùng Việt Nam',
  '- Minh Thư (35 tuổi) 🌸: Chất kem rất đặc, da mình căng mướt.',
  '- Ngọc Lan (42 tuổi) ✨: Mùi thơm dễ chịu, da mình bớt khô.',
  '- Hồng Hạnh (29 tuổi) 💖: Mua cả set dùng rất hời.',
].join('\n');
const CLOSING = 'Sở hữu ngay hôm nay.';
const MARKERS = ['Minh Thư', 'Ngọc Lan', 'tuổi', '🌸', 'Đánh giá'];

/**
 * Claude integration CI-0b against real PostgreSQL: the cleanup of the supplier's customer comments inside product descriptions.
 * Authority (MANAGE_PRODUCTS, GLOBAL), a read-only preview, an apply that touches only `description_vi` of a product that has not
 * changed since the preview, one audit event per product with the full before and after text, idempotence, validation. Fixtures
 * roll back.
 */
test(
  'Claude integration CI-0b supplier review text cleanup; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const { tx, fails } = base;
      const cleanup = new ProductTextCleanupService(base.adapter, base.throttle);
      const manager = await base.staff(['MANAGE_PRODUCTS']);
      const nobody = await base.staff([], { globalCodes: ['MANAGE_PRODUCT_PRICES'] });
      let n = 0;
      const product = async (descriptionVi: string | null) => {
        n += 1;
        return tx.product.create({
          data: {
            code: `ci0b-${n}-${base.run.toLowerCase()}`,
            nameVi: `Kem ci0b ${n} ${base.run}`,
            nameEn: `Cream ${n}`,
            descriptionVi,
            createdByUserId: manager.id,
          },
          select: { id: true, code: true, rowVersion: true },
        });
      };
      const mine = (items: { code: string }[]) =>
        items.filter((item) => item.code.endsWith(`-${base.run.toLowerCase()}`));
      const audits = (entityId: string, action: string) =>
        tx.auditEvent.findMany({
          where: { entityId, action },
          select: { before: true, after: true },
        });

      const dirtyA = await product(`${FACTS}\n${COMMENTS}\n${CLOSING}`);
      const dirtyB = await product(`${FACTS}\n${COMMENTS}`);
      const clean = await product(`${FACTS}\n${CLOSING}`);
      const noText = await product(null);
      const dirtyC = await product(`${FACTS}\n${COMMENTS}`);

      await suite.test('authority: only MANAGE_PRODUCTS, every endpoint', async () => {
        await fails(() => cleanup.preview(nobody.token), 'FORBIDDEN');
        await fails(() => cleanup.detail(nobody.token, dirtyA.id), 'FORBIDDEN');
        await fails(
          () =>
            cleanup.apply(nobody.token, {
              items: [{ id: dirtyA.id, rowVersion: 1, textHash: 'a'.repeat(64) }],
            }),
          'FORBIDDEN',
        );
        await fails(() => cleanup.preview(undefined), 'AUTHENTICATION_REQUIRED');
        const row = await tx.product.findUniqueOrThrow({
          where: { id: dirtyA.id },
          select: { descriptionVi: true },
        });
        assert.ok(row.descriptionVi?.includes('Minh Thư'), 'nothing was written');
      });

      await suite.test(
        'the preview lists only the products that carry comments, read only',
        async () => {
          const preview = await cleanup.preview(manager.token);
          const codes = mine(preview.items).map((item) => item.code);
          assert.deepEqual(
            codes.sort(),
            [dirtyA.code, dirtyB.code, dirtyC.code].sort(),
            'clean, empty and unrelated products are not listed',
          );
          const item = preview.items.find((entry) => entry.id === dirtyA.id)!;
          assert.equal(item.removedEntries, 3);
          assert.equal(item.rowVersion, dirtyA.rowVersion);
          assert.equal(item.textHash, sha256Text(`${FACTS}\n${COMMENTS}\n${CLOSING}`));
          assert.ok(item.removedChars > 200);
          const detail = await cleanup.detail(manager.token, dirtyA.id);
          assert.equal(detail.before, `${FACTS}\n${COMMENTS}\n${CLOSING}`);
          assert.equal(detail.after, `${FACTS}\n${CLOSING}`);
          assert.equal(detail.removedLines.length, 4, 'the heading and the three entries');
          const same = await cleanup.detail(manager.token, clean.id);
          assert.equal(same.after, same.before);
          assert.deepEqual(same.removedLines, []);
          await fails(
            () => cleanup.detail(manager.token, '00000000-0000-4000-8000-000000000000'),
            'NOT_FOUND',
          );
          const unchanged = await tx.product.findUniqueOrThrow({
            where: { id: dirtyA.id },
            select: { rowVersion: true },
          });
          assert.equal(unchanged.rowVersion, dirtyA.rowVersion, 'the preview wrote nothing');
        },
      );

      await suite.test('validation: 1 to 100 distinct entries with a real hash', async () => {
        const entry = { id: dirtyA.id, rowVersion: 1, textHash: 'a'.repeat(64) };
        await fails(
          () => cleanup.apply(manager.token, { items: [] }),
          'VALIDATION_FAILED',
          'items',
        );
        await fails(
          () =>
            cleanup.apply(manager.token, {
              items: Array.from({ length: 101 }, (_, k) => ({
                ...entry,
                id: `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`,
              })),
            }),
          'VALIDATION_FAILED',
          'items',
        );
        await fails(
          () => cleanup.apply(manager.token, { items: [entry, entry] }),
          'VALIDATION_FAILED',
          'items.id',
        );
        await fails(
          () => cleanup.apply(manager.token, { items: [{ ...entry, textHash: 'nope' }] }),
          'VALIDATION_FAILED',
          'items.textHash',
        );
        await fails(
          () => cleanup.apply(manager.token, { items: [{ ...entry, id: 'not-a-uuid' }] }),
          'VALIDATION_FAILED',
          'items.id',
        );
      });

      await suite.test(
        'apply: cleans only description_vi, bumps the version, audits before and after; a changed product is skipped; a second click finds nothing',
        async () => {
          const preview = await cleanup.preview(manager.token);
          const take = (id: string) => {
            const found = preview.items.find((entry) => entry.id === id)!;
            return { id: found.id, rowVersion: found.rowVersion, textHash: found.textHash };
          };
          // dirtyC is edited by a person after the preview: it must be skipped and left exactly as that person wrote it.
          const edited = `${FACTS}\n${COMMENTS}\nNgười dùng đã sửa tay.`;
          await tx.product.update({
            where: { id: dirtyC.id },
            data: { descriptionVi: edited, rowVersion: { increment: 1 } },
          });
          const result = await cleanup.apply(manager.token, {
            items: [take(dirtyA.id), take(dirtyB.id), take(dirtyC.id)],
          });
          assert.equal(result.cleaned, 2);
          assert.deepEqual(result.skipped, [{ id: dirtyC.id, reason: 'CHANGED' }]);
          const a = await tx.product.findUniqueOrThrow({
            where: { id: dirtyA.id },
            select: {
              descriptionVi: true,
              rowVersion: true,
              nameVi: true,
              nameEn: true,
              status: true,
            },
          });
          assert.equal(a.descriptionVi, `${FACTS}\n${CLOSING}`);
          assert.equal(a.rowVersion, dirtyA.rowVersion + 1);
          assert.equal(a.nameEn, 'Cream 1', 'nothing else changed');
          const b = await tx.product.findUniqueOrThrow({
            where: { id: dirtyB.id },
            select: { descriptionVi: true },
          });
          assert.equal(b.descriptionVi, FACTS);
          for (const marker of MARKERS) {
            assert.ok(!a.descriptionVi?.includes(marker), marker);
            assert.ok(!b.descriptionVi?.includes(marker), marker);
          }
          const c = await tx.product.findUniqueOrThrow({
            where: { id: dirtyC.id },
            select: { descriptionVi: true },
          });
          assert.equal(
            c.descriptionVi,
            edited,
            'the product edited after the preview is untouched',
          );
          // One audit event per cleaned product with the full text before and after, and one summary event.
          const trail = await audits(dirtyA.id, 'PRODUCT_SUPPLIER_REVIEW_TEXT_REMOVED');
          assert.equal(trail.length, 1);
          assert.equal(
            (trail[0]!.before as { descriptionVi: string }).descriptionVi,
            `${FACTS}\n${COMMENTS}\n${CLOSING}`,
          );
          assert.equal(
            (trail[0]!.after as { descriptionVi: string }).descriptionVi,
            `${FACTS}\n${CLOSING}`,
          );
          assert.equal((trail[0]!.after as { removedEntries: number }).removedEntries, 3);
          assert.equal((await audits(dirtyC.id, 'PRODUCT_SUPPLIER_REVIEW_TEXT_REMOVED')).length, 0);
          const summary = await tx.auditEvent.findMany({
            where: {
              action: 'PRODUCT_SUPPLIER_REVIEW_TEXT_CLEANUP_RUN',
              entityType: 'ProductTextCleanup',
            },
            orderBy: { occurredAt: 'desc' },
            take: 1,
            select: { after: true },
          });
          assert.equal((summary[0]!.after as { cleaned: number }).cleaned, 2);
          // A second click with the same (now stale) entries cleans nothing and breaks nothing.
          const again = await cleanup.apply(manager.token, {
            items: [take(dirtyA.id), take(dirtyB.id)],
          });
          assert.equal(again.cleaned, 0);
          assert.deepEqual(
            again.skipped.map((entry) => entry.reason),
            ['CHANGED', 'CHANGED'],
          );
          // With fresh numbers the product is simply clean.
          const fresh = await cleanup.detail(manager.token, dirtyA.id);
          const nothing = await cleanup.apply(manager.token, {
            items: [{ id: fresh.id, rowVersion: fresh.rowVersion, textHash: fresh.textHash }],
          });
          assert.deepEqual(nothing, {
            cleaned: 0,
            skipped: [{ id: dirtyA.id, reason: 'NOTHING_TO_REMOVE' }],
          });
          // The preview no longer lists the cleaned products; the person-edited one is still listed.
          const after = mine((await cleanup.preview(manager.token)).items).map((item) => item.code);
          assert.deepEqual(after, [dirtyC.code]);
          // A product that does not exist is reported, not an error.
          const missing = await cleanup.apply(manager.token, {
            items: [
              {
                id: '00000000-0000-4000-8000-000000000001',
                rowVersion: 1,
                textHash: 'b'.repeat(64),
              },
            ],
          });
          assert.deepEqual(missing.skipped, [
            { id: '00000000-0000-4000-8000-000000000001', reason: 'NOT_FOUND' },
          ]);
          void noText;
        },
      );
    });
  },
);
