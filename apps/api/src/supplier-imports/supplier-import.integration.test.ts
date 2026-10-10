import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { SupplierCandidateDetail, SupplierSourceItem } from '@lucy-spa/contracts';
import { LocalDiskMediaStorage, processNextScan, processNextSourceTest } from '@lucy-spa/server';
import { SupplierSourceService } from '../supplier-sources/supplier-source.service.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { FakeSite, patternPicture, type FakeProduct } from '../testing/supplier-site-fake.js';
import { SupplierImportService } from './supplier-import.service.js';

const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
const permission = (version: number) => ({
  expectedVersion: version,
  givenBy: 'Chị Hà, quản lý haruohui.com',
  method: 'Tin nhắn Zalo',
  date: threeDaysAgo,
  note: null,
  permitsText: true,
  permitsImages: true,
  permitsPrices: false,
});

/**
 * Phase 9 P9-6 against real PostgreSQL: the review of supplier candidates and the approval. A reviewer (REVIEW_SUPPLIER_IMPORTS only)
 * edits, maps, decides about flagged pictures and approves; the approval creates ONE DRAFT product with the SKU exactly as reviewed,
 * copies the kept pictures, never writes a cost, and creates a selling price only for a holder of MANAGE_PRODUCT_PRICES. Supplier
 * prices are removed by the server for everyone else. Fixtures roll back.
 */
test(
  'Phase 9 P9-6 review and approval: authority, price stripping, edits, mappings, decisions, the approval and the bulk approval; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const { tx, fails } = base;
      const storage = new LocalDiskMediaStorage(mkdtempSync(path.join(tmpdir(), 'lucy-p96-')));
      const sources = new SupplierSourceService(base.adapter, base.throttle);
      const imports = new SupplierImportService(base.adapter, base.throttle, storage);
      const manager = await base.staff(['MANAGE_PRODUCTS'], {
        globalCodes: ['MANAGE_SUPPLIER_SOURCES'],
      });
      const reviewer = await base.staff(['MANAGE_PRODUCTS'], {
        globalCodes: ['REVIEW_SUPPLIER_IMPORTS'],
      });
      const pricer = await base.staff(['MANAGE_PRODUCTS'], {
        globalCodes: ['REVIEW_SUPPLIER_IMPORTS', 'MANAGE_PRODUCT_PRICES'],
      });
      const nobody = await base.staff(['MANAGE_PRODUCTS'], { globalCodes: ['MANAGE_PRODUCTS'] });
      let n = 0;
      const versionOf = async (id: string): Promise<number> =>
        (await tx.supplierSource.findUniqueOrThrow({ where: { id }, select: { rowVersion: true } }))
          .rowVersion;

      const readySource = async (): Promise<{
        source: SupplierSourceItem;
        host: string;
        supplierId: string;
      }> => {
        n += 1;
        const host = `nguon-${n}-${base.run.toLowerCase()}.example.com`;
        let { item } = await sources.create(manager.token, {
          supplierName: `NCC duyệt ${n} ${base.run}`,
          name: `Nguồn duyệt ${n} ${base.run}`,
          kind: 'WEBSITE',
          baseUrl: `https://${host}/`,
        });
        item = (await sources.permission(manager.token, item.id, permission(item.rowVersion))).item;
        item = (await sources.confirm(manager.token, item.id, { expectedVersion: item.rowVersion }))
          .item;
        const queued = await sources.requestTest(manager.token, item.id, {
          expectedVersion: item.rowVersion,
        });
        const probe = new FakeSite();
        for (let id = 1; id <= 3; id += 1)
          probe.add({ id, name: `Mẫu ${id}`, images: [`/p${id}.png`] });
        assert.equal(
          await processNextSourceTest(tx, { createClient: () => probe.client() }),
          'PASSED',
        );
        item = (
          await sources.confirmTest(manager.token, item.id, queued.item.id, {
            expectedVersion: await versionOf(item.id),
          })
        ).item;
        item = (await sources.enable(manager.token, item.id, { expectedVersion: item.rowVersion }))
          .item;
        return { source: item, host, supplierId: item.supplier.id };
      };
      const scan = async (sourceId: string, site: FakeSite) => {
        await sources.requestScan(manager.token, sourceId, {
          expectedVersion: await versionOf(sourceId),
        });
        return processNextScan(tx, { createClient: () => site.client(), storage, skuPrefixes: {} });
      };
      const shop = async (products: FakeProduct[]): Promise<FakeSite> => {
        const site = new FakeSite();
        for (const product of products) {
          site.add(product);
          for (const picture of product.images) {
            if (!site.files.has(picture)) {
              site.files.set(
                picture,
                await patternPicture(Number(picture.replace(/\D/g, '')) || 1),
              );
            }
          }
        }
        return site;
      };
      const candidateId = async (sourceId: string, key: string) =>
        (
          await tx.importCandidate.findFirstOrThrow({
            where: { sources: { some: { sourceRecord: { sourceId, sourceKey: key } } } },
            select: { id: true },
          })
        ).id;
      const detail = async (token: string, id: string): Promise<SupplierCandidateDetail> =>
        (await imports.get(token, id)).item;
      const codesOf = (item: SupplierCandidateDetail) => item.warnings.map((w) => w.code).sort();
      /** A brand and a category (named like the texts the fake shop lists) and the two mappings, so candidates can become ready. */
      const resolveTexts = async (supplierId: string, candidate: string) => {
        const brand = await tx.brand.create({
          data: {
            code: `b96-${n}-${base.run.toLowerCase()}`,
            nameVi: `Hãng ${n}`,
            nameEn: `Brand ${n}`,
          },
          select: { id: true },
        });
        const category = await tx.productCategory.create({
          data: {
            code: `k96-${n}-${base.run.toLowerCase()}`,
            nameVi: `Nhóm ${n}`,
            nameEn: `Group ${n}`,
          },
          select: { id: true },
        });
        await imports.mapping(reviewer.token, {
          candidateId: candidate,
          kind: 'BRAND',
          sourceText: `Hãng X${n}`,
          targetId: brand.id,
        });
        await imports.mapping(reviewer.token, {
          candidateId: candidate,
          kind: 'CATEGORY',
          sourceText: `Nhóm Y${n}`,
          targetId: category.id,
        });
        void supplierId;
        return { brand: brand.id, category: category.id };
      };
      const catalog = (
        extra: Partial<FakeProduct> & { id: number; name: string },
      ): FakeProduct => ({
        sku: `SP-${extra.id}`,
        categories: [`Hãng X${n}`, `Nhóm Y${n}`],
        images: [`/wp-content/uploads/${extra.id}.png`],
        priceVnd: 350_000,
        ...extra,
      });

      await suite.test(
        'authority and prices: only REVIEW_SUPPLIER_IMPORTS sees candidates; supplier prices reach only MANAGE_PRODUCT_PRICES holders, removed by the server',
        async () => {
          const { source } = await readySource();
          const site = await shop([
            catalog({ id: 101, name: 'Kem A' }),
            catalog({ id: 102, name: 'Kem B' }),
          ]);
          assert.equal(await scan(source.id, site), 'SUCCEEDED');
          await fails(() => imports.list(nobody.token, {}), 'FORBIDDEN');
          await fails(() => imports.list(manager.token, {}), 'FORBIDDEN');
          const id = await candidateId(source.id, '101');
          await fails(() => imports.get(nobody.token, id), 'FORBIDDEN');
          const plain = await imports.list(reviewer.token, {});
          assert.equal(plain.canSeePrices, false);
          assert.ok(plain.items.length >= 2);
          assert.ok(!JSON.stringify(plain).includes('sourcePriceVnd'));
          assert.ok(!JSON.stringify(plain).includes('350000'));
          const withPrices = await imports.list(pricer.token, {});
          assert.equal(withPrices.canSeePrices, true);
          assert.equal(withPrices.items.find((item) => item.id === id)?.sourcePriceVnd, 350_000);
          const hidden = await detail(reviewer.token, id);
          assert.equal(hidden.canSeePrices, false);
          assert.equal('sourcePrice' in hidden, false);
          assert.ok(!JSON.stringify(hidden).includes('350000'));
          const shown = await detail(pricer.token, id);
          assert.equal(shown.sourcePrice?.priceVnd, 350_000);
          assert.equal(shown.source.url.endsWith('/san-pham/101/'), true);
          assert.equal(shown.source.sourceKey, '101');
          assert.equal(shown.images.length, 1);
          assert.equal(shown.images[0]!.sourceProductKey, '101');
          // Filters and paging.
          const open = await imports.list(reviewer.token, { state: 'OPEN' });
          assert.ok(
            open.items.every((item) =>
              ['NEEDS_REVIEW', 'READY_FOR_REVIEW', 'EXTRACTED'].includes(item.state),
            ),
          );
          await fails(
            () => imports.list(reviewer.token, { state: 'WHATEVER' }),
            'VALIDATION_FAILED',
            'state',
          );
          await fails(
            () => imports.list(reviewer.token, { warning: 'bad code' }),
            'VALIDATION_FAILED',
            'warning',
          );
          await fails(() => imports.list(reviewer.token, { page: 0 }), 'VALIDATION_FAILED', 'page');
          const byWarning = await imports.list(reviewer.token, { warning: 'BRAND_UNMAPPED' });
          assert.ok(
            byWarning.items.length >= 2 &&
              byWarning.items.every((item) => item.warnings.includes('BRAND_UNMAPPED')),
          );
          // The picture route: the reviewer needs no media-library access, only the candidate's own picture.
          const image = shown.images[0]!;
          const thumb = await imports.picture(reviewer.token, id, image.id, 'THUMB');
          assert.ok(thumb.bytes > 0);
          thumb.stream.destroy();
          const otherId = await candidateId(source.id, '102');
          await fails(
            () => imports.picture(reviewer.token, otherId, image.id, 'THUMB'),
            'NOT_FOUND',
          );
          await fails(() => imports.picture(nobody.token, id, image.id, 'THUMB'), 'FORBIDDEN');
        },
      );

      await suite.test(
        'editing: Lucy-owned fields only, SKU exactly in Lucy shape (nothing is upper-cased for the reviewer), versions, brands and categories must exist',
        async () => {
          const { source } = await readySource();
          const slug = 'ten-san-pham-viet-thuong';
          const site = await shop([catalog({ id: 201, name: 'Sản phẩm 201', sku: slug })]);
          await scan(source.id, site);
          const id = await candidateId(source.id, '201');
          let item = await detail(reviewer.token, id);
          assert.equal(item.proposedSku, slug);
          assert.ok(codesOf(item).includes('SKU_FORMAT'));
          assert.deepEqual(item.approval.blockers, ['SKU_INVALID']);
          // A SKU that is not in Lucy's shape is refused, even when upper-casing would fix it.
          await fails(
            () =>
              imports.edit(reviewer.token, id, {
                expectedVersion: item.rowVersion,
                proposedSku: slug.toUpperCase().replace(/-/g, ' '),
              }),
            'VALIDATION_FAILED',
            'proposedSku',
          );
          await fails(
            () =>
              imports.edit(reviewer.token, id, {
                expectedVersion: item.rowVersion,
                proposedSku: slug,
              }),
            'VALIDATION_FAILED',
            'proposedSku',
          );
          await fails(
            () =>
              imports.edit(reviewer.token, id, {
                expectedVersion: item.rowVersion - 1,
                nameVi: 'X',
              }),
            'CONFLICT',
          );
          await fails(
            () =>
              imports.edit(reviewer.token, id, { expectedVersion: item.rowVersion, nameVi: '   ' }),
            'VALIDATION_FAILED',
            'nameVi',
          );
          await fails(
            () =>
              imports.edit(reviewer.token, id, {
                expectedVersion: item.rowVersion,
                brandId: '00000000-0000-4000-8000-000000000000',
              }),
            'VALIDATION_FAILED',
            'brandId',
          );
          await fails(
            () =>
              imports.edit(reviewer.token, id, {
                expectedVersion: item.rowVersion,
                source: 'x',
              } as never),
            'VALIDATION_FAILED',
            'body',
          );
          const brand = await tx.brand.create({
            data: { code: `b97-${base.run.toLowerCase()}`, nameVi: 'Hãng chọn', nameEn: 'Brand' },
            select: { id: true },
          });
          const edited = await imports.edit(reviewer.token, id, {
            expectedVersion: item.rowVersion,
            nameVi: '  Tên do người duyệt  ',
            nameEn: 'Reviewed name',
            needsTranslation: false,
            descriptionVi: 'Mô tả mới',
            brandId: brand.id,
            proposedSku: 'TEN-SAN-PHAM-01',
          });
          item = edited.item;
          assert.equal(item.nameVi, 'Tên do người duyệt');
          assert.equal(item.needsTranslation, false);
          assert.equal(item.proposedSku, 'TEN-SAN-PHAM-01');
          assert.equal(item.brandId, brand.id);
          assert.ok(
            !codesOf(item).includes('SKU_FORMAT'),
            'the SKU warning is gone once the SKU fits',
          );
          assert.ok(!codesOf(item).includes('BRAND_UNMAPPED'));
          // What the source says is untouched.
          assert.equal(item.source.name, 'Sản phẩm 201');
          assert.equal(item.source.sku, slug);
          // Nothing changed means nothing is written.
          const same = await imports.edit(reviewer.token, id, {
            expectedVersion: item.rowVersion,
            nameVi: 'Tên do người duyệt',
          });
          assert.equal(same.item.rowVersion, item.rowVersion);
          const audit = await tx.auditEvent.findMany({
            where: { entityType: 'ImportCandidate', entityId: id },
            select: { action: true, actorUserId: true },
          });
          assert.ok(
            audit.some(
              (event) =>
                event.action === 'SUPPLIER_CANDIDATE_EDITED' && event.actorUserId === reviewer.id,
            ),
          );
        },
      );

      await suite.test(
        'mapping: one answer makes every candidate with that text ready; the target must exist; a flagged picture needs a decision, look-alikes need "keep separate"',
        async () => {
          const { source, supplierId } = await readySource();
          const same = await patternPicture(88);
          const site = await shop([
            catalog({ id: 301, name: 'Kem 301 50ml' }),
            catalog({ id: 302, name: 'Kem 302', images: ['/wp-content/uploads/302.png'] }),
            catalog({ id: 303, name: 'Kem 303', images: ['/wp-content/uploads/303.png'] }),
            catalog({ id: 304, name: 'Kem 301 50 ML' }),
          ]);
          site.files.set('/wp-content/uploads/302.png', same);
          site.files.set('/wp-content/uploads/303.png', same);
          assert.equal(await scan(source.id, site), 'SUCCEEDED');
          const first = await candidateId(source.id, '301');
          const before = await detail(reviewer.token, first);
          assert.ok(codesOf(before).includes('BRAND_UNMAPPED'));
          const brand = await tx.brand.create({
            data: { code: `b98-${base.run.toLowerCase()}`, nameVi: 'Hãng', nameEn: 'Brand' },
            select: { id: true },
          });
          const category = await tx.productCategory.create({
            data: { code: `k98-${base.run.toLowerCase()}`, nameVi: 'Nhóm', nameEn: 'Group' },
            select: { id: true },
          });
          await fails(
            () =>
              imports.mapping(reviewer.token, {
                candidateId: first,
                kind: 'BRAND',
                sourceText: `Hãng X${n}`,
                targetId: '00000000-0000-4000-8000-000000000000',
              }),
            'VALIDATION_FAILED',
            'targetId',
          );
          await fails(
            () =>
              imports.mapping(nobody.token, {
                candidateId: first,
                kind: 'BRAND',
                sourceText: 'x',
                targetId: brand.id,
              }),
            'FORBIDDEN',
          );
          const mapped = await imports.mapping(reviewer.token, {
            candidateId: first,
            kind: 'BRAND',
            sourceText: `hãng x${n}`,
            targetId: brand.id,
          });
          assert.equal(mapped.changed, true);
          assert.ok(mapped.evaluated >= 4 && mapped.updated >= 4);
          const again = await imports.mapping(reviewer.token, {
            candidateId: first,
            kind: 'BRAND',
            sourceText: `HANG X${n}`,
            targetId: brand.id,
          });
          assert.equal(again.changed, false, 'found ignoring case and diacritics');
          await imports.mapping(reviewer.token, {
            candidateId: first,
            kind: 'CATEGORY',
            sourceText: `Nhóm Y${n}`,
            targetId: category.id,
          });
          // 301 and 304 are look-alikes (same name, size written differently): a suspicion with the other one named.
          let c301 = await detail(reviewer.token, first);
          const duplicate = c301.warnings.find((w) => w.code === 'POSSIBLE_DUPLICATE');
          assert.ok(duplicate);
          const other = (duplicate['matches'] as { kind: string; candidateId: string }[])[0]!;
          assert.equal(other.candidateId, await candidateId(source.id, '304'));
          assert.deepEqual(c301.approval.blockers, ['DUPLICATE_UNRESOLVED']);
          await fails(
            () =>
              imports.keepSeparate(reviewer.token, first, {
                expectedVersion: c301.rowVersion,
                ref: 'PRODUCT:00000000-0000-4000-8000-000000000000',
              }),
            'VALIDATION_FAILED',
            'ref',
          );
          c301 = (
            await imports.keepSeparate(reviewer.token, first, {
              expectedVersion: c301.rowVersion,
              ref: `CANDIDATE:${other.candidateId}`,
            })
          ).item;
          assert.ok(!codesOf(c301).includes('POSSIBLE_DUPLICATE'));
          assert.equal(c301.state, 'READY_FOR_REVIEW');
          assert.equal(c301.approval.canApprove, true);
          // 302 and 303 share a picture: both flagged, each needs its own decision before approval.
          const c302 = await candidateId(source.id, '302');
          let item = await detail(reviewer.token, c302);
          assert.equal(item.state, 'NEEDS_REVIEW');
          assert.deepEqual(item.approval.blockers, ['IMAGE_DECISION_REQUIRED']);
          const flagged = item.images[0]!;
          assert.equal(flagged.flag, 'SAME_FILE');
          assert.deepEqual(
            flagged.sharedWith.map((entry) => [entry.kind, entry.name, entry.sku]),
            [['CANDIDATE', 'Kem 303', 'SP-303']],
          );
          await fails(
            () => imports.approve(reviewer.token, c302, { expectedVersion: item.rowVersion }),
            'CANDIDATE_BLOCKED',
            'IMAGE_DECISION_REQUIRED',
          );
          // A picture of ANOTHER candidate cannot be decided here.
          const foreignImage = (await detail(reviewer.token, first)).images[0]!.id;
          await fails(
            () =>
              imports.imageDecision(reviewer.token, c302, {
                expectedVersion: item.rowVersion,
                imageId: foreignImage,
                decision: 'KEEP',
              }),
            'NOT_FOUND',
          );
          item = (
            await imports.imageDecision(reviewer.token, c302, {
              expectedVersion: item.rowVersion,
              imageId: flagged.id,
              decision: 'KEEP',
            })
          ).item;
          assert.equal(item.images[0]!.decision, 'KEEP');
          assert.deepEqual(item.approval.blockers, []);
          assert.equal(item.state, 'READY_FOR_REVIEW');
          // The other side still has its own flag.
          const c303 = await detail(reviewer.token, await candidateId(source.id, '303'));
          assert.deepEqual(c303.approval.blockers, ['IMAGE_DECISION_REQUIRED']);
          // A later decision replaces the earlier one (history stays).
          item = (
            await imports.imageDecision(reviewer.token, c302, {
              expectedVersion: item.rowVersion,
              imageId: flagged.id,
              decision: 'DROP',
            })
          ).item;
          assert.equal(item.images[0]!.decision, 'DROP');
          assert.ok(codesOf(item).includes('IMAGE_MISSING'), 'the only picture was dropped');
          assert.equal(await tx.candidateReviewDecision.count({ where: { candidateId: c302 } }), 2);
          void supplierId;
        },
      );

      await suite.test(
        'approval: one DRAFT product with the SKU exactly as reviewed, kept pictures in order, provenance, no cost; a selling price only for the price permission',
        async () => {
          const { source, host } = await readySource();
          const site = await shop([
            catalog({
              id: 401,
              name: 'Kem 401',
              images: [
                '/wp-content/uploads/401.png',
                '/wp-content/uploads/4011.png',
                '/wp-content/uploads/4012.png',
              ],
            }),
            catalog({ id: 402, name: 'Kem 402', sku: 'bad-sku-lowercase' }),
            catalog({ id: 403, name: 'Kem 403', sku: 'TAKEN-SKU' }),
          ]);
          await tx.product.create({
            data: {
              code: `p99-${base.run.toLowerCase()}`,
              nameVi: 'Đã có',
              nameEn: 'Existing',
              createdByUserId: manager.id,
              variants: { create: [{ sku: 'TAKEN-SKU', sortOrder: 0 }] },
            },
            select: { id: true },
          });
          await scan(source.id, site);
          const id = await candidateId(source.id, '401');
          const { brand, category } = await resolveTexts('', id);
          let item = await detail(reviewer.token, id);
          assert.equal(item.state, 'READY_FOR_REVIEW');
          assert.equal(item.images.length, 3);
          // Drop the middle picture of three: the others keep their order.
          const middle = item.images[1]!;
          item = (
            await imports.imageDecision(reviewer.token, id, {
              expectedVersion: item.rowVersion,
              imageId: middle.id,
              decision: 'DROP',
            })
          ).item;
          const productsBefore = await tx.product.count();
          // A reviewer without the price permission cannot set one, and nothing is written when refused.
          await fails(
            () =>
              imports.approve(reviewer.token, id, {
                expectedVersion: item.rowVersion,
                listPriceVnd: '500000',
              }),
            'FORBIDDEN',
          );
          await fails(
            () =>
              imports.approve(pricer.token, id, {
                expectedVersion: item.rowVersion,
                listPriceVnd: '12.5',
              }),
            'VALIDATION_FAILED',
            'listPriceVnd',
          );
          await fails(
            () =>
              imports.approve(pricer.token, id, {
                expectedVersion: item.rowVersion,
                listPriceVnd: '0',
              }),
            'VALIDATION_FAILED',
            'listPriceVnd',
          );
          await fails(
            () => imports.approve(reviewer.token, id, { expectedVersion: item.rowVersion - 1 }),
            'CONFLICT',
          );
          assert.equal(await tx.product.count(), productsBefore);
          const done = await imports.approve(pricer.token, id, {
            expectedVersion: item.rowVersion,
            listPriceVnd: '480000',
          });
          assert.equal(done.sku, item.proposedSku);
          assert.equal(done.images, 2);
          const product = await tx.product.findUniqueOrThrow({
            where: { id: done.productId },
            select: {
              status: true,
              nameVi: true,
              brandId: true,
              categoryId: true,
              source: true,
              createdByUserId: true,
              variants: {
                select: {
                  sku: true,
                  costPriceVnd: true,
                  priceVersions: { select: { listPriceVnd: true, createdByUserId: true } },
                },
              },
              images: {
                orderBy: { sortOrder: 'asc' },
                select: { sortOrder: true, mediaAsset: { select: { sha256: true } } },
              },
            },
          });
          assert.equal(product.status, 'DRAFT');
          assert.equal(product.brandId, brand);
          assert.equal(product.categoryId, category);
          assert.equal(product.createdByUserId, pricer.id);
          assert.equal(product.variants.length, 1);
          assert.equal(product.variants[0]!.sku, 'SP-401', 'the SKU exactly as reviewed');
          assert.equal(
            product.variants[0]!.costPriceVnd,
            null,
            'the supplier price is never a cost',
          );
          assert.deepEqual(
            product.variants[0]!.priceVersions.map((v) => [
              Number(v.listPriceVnd),
              v.createdByUserId,
            ]),
            [[480_000, pricer.id]],
          );
          // The kept pictures, in their order; the dropped one is not copied.
          const candidatePictures = await tx.candidateImage.findMany({
            where: { candidateId: id, retiredAt: null, NOT: { id: middle.id } },
            orderBy: { sortOrder: 'asc' },
            select: { mediaAssetId: true },
          });
          const productPictures = await tx.productImage.findMany({
            where: { productId: done.productId },
            orderBy: { sortOrder: 'asc' },
            select: { mediaAssetId: true },
          });
          assert.deepEqual(
            productPictures.map((entry) => entry.mediaAssetId),
            candidatePictures.map((entry) => entry.mediaAssetId),
          );
          const prov = product.source as Record<string, string>;
          assert.equal(prov['sourceKey'], '401');
          assert.equal(prov['url'], `https://${host}/san-pham/401/`);
          assert.equal(prov['candidateId'], id);
          assert.ok(prov['importedAt']);
          const closed = await detail(reviewer.token, id);
          assert.equal(closed.state, 'IMPORTED');
          assert.equal(closed.decided?.productId, done.productId);
          assert.equal(closed.approval.canApprove, false);
          await fails(
            () => imports.approve(reviewer.token, id, { expectedVersion: closed.rowVersion }),
            'CANDIDATE_DECIDED',
          );
          await fails(
            () =>
              imports.edit(reviewer.token, id, { expectedVersion: closed.rowVersion, nameVi: 'x' }),
            'CANDIDATE_DECIDED',
          );
          const audit = (
            await tx.auditEvent.findMany({
              where: { entityId: id, entityType: 'ImportCandidate' },
              select: { action: true },
            })
          ).map((e) => e.action);
          assert.ok(audit.includes('SUPPLIER_CANDIDATE_APPROVED'));
          // A rescan never touches the product that came out of it.
          const stored = await tx.productVariant.findFirstOrThrow({
            where: { sku: 'SP-401' },
            select: { costPriceVnd: true },
          });
          assert.equal(stored.costPriceVnd, null);

          // Blockers: a SKU that does not fit, a SKU another product owns.
          const bad = await candidateId(source.id, '402');
          const badVersion = (await detail(reviewer.token, bad)).rowVersion;
          await fails(
            () => imports.approve(reviewer.token, bad, { expectedVersion: badVersion }),
            'CANDIDATE_BLOCKED',
            'SKU_INVALID',
          );
          const taken = await candidateId(source.id, '403');
          const takenItem = await detail(reviewer.token, taken);
          assert.deepEqual(takenItem.approval.blockers, ['SKU_TAKEN']);
          await fails(
            () => imports.approve(reviewer.token, taken, { expectedVersion: takenItem.rowVersion }),
            'CANDIDATE_BLOCKED',
            'SKU_TAKEN',
          );
          assert.equal(
            await tx.product.count(),
            productsBefore + 1,
            'only the approved one became a product',
          );
        },
      );

      await suite.test(
        'reject and ignore close a candidate with a person and a note; the bulk approval takes only the ready ones and reports the rest',
        async () => {
          const { source } = await readySource();
          const site = await shop([
            catalog({ id: 501, name: 'Sẵn sàng 501' }),
            catalog({ id: 502, name: 'Sẵn sàng 502' }),
            catalog({ id: 503, name: 'Chưa sẵn sàng 503', sku: 'khong-hop-le' }),
            catalog({ id: 504, name: 'Bị loại 504' }),
            catalog({ id: 505, name: 'Bỏ qua 505' }),
          ]);
          await scan(source.id, site);
          const ids = Object.fromEntries(
            await Promise.all(
              ['501', '502', '503', '504', '505'].map(async (k) => [
                k,
                await candidateId(source.id, k),
              ]),
            ),
          );
          await resolveTexts('', ids['501']!);
          const version = async (k: string) => (await detail(reviewer.token, ids[k]!)).rowVersion;
          assert.equal((await detail(reviewer.token, ids['501']!)).state, 'READY_FOR_REVIEW');
          assert.equal((await detail(reviewer.token, ids['503']!)).state, 'NEEDS_REVIEW');
          // Reject and ignore.
          const rejected = await imports.reject(reviewer.token, ids['504']!, {
            expectedVersion: await version('504'),
            note: 'Không bán dòng này',
          });
          assert.deepEqual(rejected, { id: ids['504'], state: 'REJECTED' });
          const ignored = await imports.ignore(reviewer.token, ids['505']!, {
            expectedVersion: await version('505'),
          });
          assert.equal(ignored.state, 'IGNORED');
          const closed = await detail(reviewer.token, ids['504']!);
          assert.equal(closed.decided?.note, 'Không bán dòng này');
          assert.ok(closed.decided?.by);
          await fails(
            () =>
              imports.reject(reviewer.token, ids['504']!, { expectedVersion: closed.rowVersion }),
            'CANDIDATE_DECIDED',
          );
          const readyVersion = await version('501');
          await fails(
            () => imports.reject(nobody.token, ids['501']!, { expectedVersion: readyVersion }),
            'FORBIDDEN',
          );
          // Bulk: ready ones are approved, the rest is reported; a stale version and a rejected one are skipped, nothing else breaks.
          const productsBefore = await tx.product.count();
          const result = await imports.approveReady(reviewer.token, {
            candidates: [
              { id: ids['501']!, expectedVersion: await version('501') },
              { id: ids['503']!, expectedVersion: await version('503') },
              { id: ids['504']!, expectedVersion: await version('504') },
              { id: ids['502']!, expectedVersion: 1 },
            ],
          });
          assert.equal(result.approved, 1);
          assert.deepEqual(
            result.skipped
              .map((s) => [
                s.id === ids['503'] ? '503' : s.id === ids['504'] ? '504' : '502',
                s.reason,
              ])
              .sort(),
            [
              ['502', 'CONFLICT'],
              ['503', 'CANDIDATE_NOT_READY'],
              ['504', 'CANDIDATE_NOT_READY'],
            ].sort(),
          );
          assert.equal(await tx.product.count(), productsBefore + 1);
          assert.equal((await detail(reviewer.token, ids['501']!)).state, 'IMPORTED');
          // The bulk approval never sets a price and never touches a cost.
          const made = await tx.productVariant.findFirstOrThrow({
            where: { sku: 'SP-501' },
            select: { costPriceVnd: true, priceVersions: { select: { id: true } } },
          });
          assert.equal(made.costPriceVnd, null);
          assert.equal(made.priceVersions.length, 0, 'the Owner sets the price');
          await fails(
            () => imports.approveReady(reviewer.token, { candidates: [] }),
            'VALIDATION_FAILED',
            'candidates',
          );
          const otherVersion = await version('502');
          await fails(
            () =>
              imports.approveReady(nobody.token, {
                candidates: [{ id: ids['502']!, expectedVersion: otherVersion }],
              }),
            'FORBIDDEN',
          );
          const list = await imports.list(reviewer.token, { state: 'IMPORTED' });
          assert.ok(list.items.some((item) => item.id === ids['501']));
          assert.equal(list.stateCounts.REJECTED !== undefined, true);
        },
      );
    });
  },
);
