import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { SupplierSourceItem } from '@lucy-spa/contracts';
import {
  LocalDiskMediaStorage,
  processNextScan,
  processNextSourceTest,
  queueScheduledScans,
  type HttpClient,
} from '@lucy-spa/server';
import { SupplierImportService } from '../supplier-imports/supplier-import.service.js';
import { FakeSite, patternPicture, type FakeProduct } from '../testing/supplier-site-fake.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { SupplierSourceService } from './supplier-source.service.js';

const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
/** The next 02:30 in Vietnam (19:30 UTC): inside the off-hours window of the schedule. */
const NIGHT = (() => {
  const at = new Date();
  at.setUTCHours(19, 30, 0, 0);
  if (at.getTime() < Date.now()) at.setUTCDate(at.getUTCDate() + 1);
  return at;
})();
/** 12:00 in Vietnam, the same day. */
const NOON = new Date(NIGHT.getTime() - 14.5 * 3_600_000);

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
 * Phase 9 P9-7 against real PostgreSQL: re-sync and change detection, the removal guard (three healthy scans), suspect scans, the
 * per-source schedule, the in-app summary notice, and the Owner's rule that a picture never moves between products on a rescan. The
 * scans read a fake WooCommerce shop (no real site is contacted). Fixtures roll back.
 */
test(
  'Phase 9 P9-7 re-sync: change notes, removal guard, suspect scans, schedule, summary notice, pictures stay with their product; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const { tx, fails } = base;
      const sources = new SupplierSourceService(base.adapter, base.throttle);
      const storage = new LocalDiskMediaStorage(mkdtempSync(path.join(tmpdir(), 'lucy-p97-')));
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
      const both = await base.staff(['MANAGE_PRODUCTS'], {
        globalCodes: ['REVIEW_SUPPLIER_IMPORTS', 'MANAGE_SUPPLIER_SOURCES'],
      });
      let n = 0;
      const sql = async (statement: string): Promise<string | null> => {
        await tx.$executeRawUnsafe('SAVEPOINT guard');
        try {
          await tx.$executeRawUnsafe(statement);
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT guard');
          return null;
        } catch (error) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT guard');
          return String(Reflect.get(Object(error), 'message') ?? error);
        }
      };
      const versionOf = async (id: string): Promise<number> =>
        (await tx.supplierSource.findUniqueOrThrow({ where: { id }, select: { rowVersion: true } }))
          .rowVersion;

      const readySource = async (
        options: { enable?: boolean } = {},
      ): Promise<{ source: SupplierSourceItem; host: string }> => {
        n += 1;
        const host = `nguon-${n}-${base.run.toLowerCase()}.example.com`;
        let { item } = await sources.create(manager.token, {
          supplierName: `NCC đồng bộ ${base.run}`,
          name: `Nguồn đồng bộ ${n} ${base.run}`,
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
          probe.add({ id, name: `Mẫu ${id}`, images: [`/wp-content/uploads/p${id}.png`] });
        assert.equal(
          await processNextSourceTest(tx, { createClient: () => probe.client() }),
          'PASSED',
        );
        item = (
          await sources.confirmTest(manager.token, item.id, queued.item.id, {
            expectedVersion: await versionOf(item.id),
          })
        ).item;
        if (options.enable !== false) {
          item = (
            await sources.enable(manager.token, item.id, { expectedVersion: item.rowVersion })
          ).item;
        }
        return { source: item, host };
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
      const catalog = (from: number, count: number): FakeProduct[] =>
        Array.from({ length: count }, (_, index) => ({
          id: from + index,
          name: `Sản phẩm ${from + index}`,
          images: [`/wp-content/uploads/${from + index}.png`],
          priceVnd: 350_000,
        }));
      /** A manual scan by `actor` (default: the manager), run by the worker function against the shop. */
      const manual = async (
        sourceId: string,
        site: FakeSite,
        actor: { token: string } = manager,
        client: HttpClient = site.client(),
      ) => {
        const queued = await sources.requestScan(actor.token, sourceId, {
          expectedVersion: await versionOf(sourceId),
        });
        const outcome = await processNextScan(tx, { createClient: () => client, storage });
        const item = (await sources.scans(manager.token, sourceId)).items.find(
          (entry) => entry.id === queued.item.id,
        )!;
        return { outcome, item };
      };
      /** Makes every scan of the source start `hours` before the night the schedule looks at (the tests never depend on the real clock). */
      const ageScans = (sourceId: string, hours: number) =>
        tx.$executeRawUnsafe(
          `UPDATE import_scans SET started_at = '${NIGHT.toISOString()}'::timestamptz - interval '${hours} hours' WHERE source_id = '${sourceId}'`,
        );
      const setCadence = async (sourceId: string, cadence: 'MANUAL' | 'DAILY' | 'WEEKLY') =>
        sources.edit(manager.token, sourceId, {
          expectedVersion: await versionOf(sourceId),
          scanCadence: cadence,
        });
      /** The schedule queues a scan at night; the worker function runs it. Returns the finished scan row. */
      const scheduled = async (sourceId: string, site: FakeSite) => {
        await ageScans(sourceId, 8 * 24);
        assert.equal(await queueScheduledScans(tx, NIGHT), 1);
        const outcome = await processNextScan(tx, {
          createClient: () => site.client(),
          storage,
        });
        const row = await tx.importScan.findFirstOrThrow({
          where: { sourceId },
          orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        });
        return { outcome, row };
      };
      const changesOf = (sourceId: string) =>
        tx.sourceChange.findMany({
          where: { sourceRecord: { sourceId } },
          orderBy: { seq: 'asc' },
          select: {
            id: true,
            kind: true,
            detail: true,
            sourceRecord: { select: { sourceKey: true } },
          },
        });
      const recordOf = (sourceId: string, key: string) =>
        tx.sourceRecord.findUniqueOrThrow({
          where: { sourceId_sourceKey: { sourceId, sourceKey: key } },
        });
      const activePictures = async (sourceId: string) => {
        const rows = await tx.candidateImage.findMany({
          where: { retiredAt: null, owner: { sourceRecord: { sourceId } } },
          orderBy: [{ sourceProductKey: 'asc' }, { sortOrder: 'asc' }],
          select: { id: true, sourceProductKey: true, sha256: true, flag: true },
        });
        return rows;
      };
      const notices = (userId: string) =>
        tx.notification.findMany({
          where: { recipientUserId: userId, type: 'SUPPLIER_IMPORT_CHANGES' },
          orderBy: { createdAt: 'asc' },
          select: {
            params: true,
            contextCode: true,
            entityType: true,
            entityId: true,
            branchId: true,
          },
        });

      await suite.test(
        'a rescan leaves a note per change with its before and after; unchanged products leave nothing; Lucy-owned text is never overwritten',
        async () => {
          const { source } = await readySource();
          const products = catalog(201, 10);
          const site = await shop(products);
          const first = await manual(source.id, site);
          assert.equal(first.outcome, 'SUCCEEDED');
          assert.equal(first.item.counts.created, 10);
          assert.equal((await changesOf(source.id)).length, 0, 'a first read changes nothing');

          // The shop changes three products.
          site.products.get(201)!.priceVnd = 400_000;
          site.products.get(202)!.name = 'Sản phẩm 202 (tên mới)';
          site.products.get(203)!.images = [
            '/wp-content/uploads/203.png',
            '/wp-content/uploads/2030.png',
          ];
          site.files.set('/wp-content/uploads/2030.png', await patternPicture(2030));
          const second = await manual(source.id, site);
          assert.equal(second.outcome, 'SUCCEEDED');
          assert.deepEqual(
            [
              second.item.counts.priceChanged,
              second.item.counts.contentChanged,
              second.item.counts.imageChanged,
              second.item.counts.unchanged,
              second.item.counts.created,
              second.item.counts.removed,
            ],
            [1, 1, 1, 7, 0, 0],
          );
          const changes = await changesOf(source.id);
          assert.deepEqual(
            changes.map((entry) => [entry.sourceRecord.sourceKey, entry.kind]),
            [
              ['201', 'PRICE_CHANGED'],
              ['202', 'CONTENT_CHANGED'],
              ['203', 'IMAGE_CHANGED'],
            ],
          );
          assert.deepEqual(changes[0]!.detail, {
            before: { priceVnd: 350_000, promoPriceVnd: null },
            after: { priceVnd: 400_000, promoPriceVnd: null },
          });
          const content = changes[1]!.detail as { fields: string[]; before: object; after: object };
          assert.deepEqual(content.fields, ['name']);
          assert.deepEqual(content.after, { name: 'Sản phẩm 202 (tên mới)' });
          const images = changes[2]!.detail as { before: number; after: number; added: string[] };
          assert.deepEqual([images.before, images.after, images.added.length], [1, 2, 1]);

          // The source record follows the shop, the Lucy-side draft does not: the candidate keeps its name.
          assert.equal((await recordOf(source.id, '202')).name, 'Sản phẩm 202 (tên mới)');
          const candidate = await tx.importCandidate.findFirstOrThrow({
            where: {
              sources: { some: { sourceRecord: { sourceId: source.id, sourceKey: '202' } } },
            },
            select: { nameVi: true },
          });
          assert.equal(candidate.nameVi, 'Sản phẩm 202');

          // A third scan with nothing new leaves no new note.
          const third = await manual(source.id, site);
          assert.equal(third.item.counts.unchanged, 10);
          assert.equal((await changesOf(source.id)).length, 3);

          // The queue: a reviewer sees the notes (no price), a price holder sees the price, nobody else sees anything.
          const list = await imports.listChanges(reviewer.token, {});
          assert.equal(list.total, 3);
          assert.equal(list.openCount, 3);
          assert.equal(list.canSeePrices, false);
          const price = list.items.find((item) => item.kind === 'PRICE_CHANGED')!;
          assert.deepEqual(
            price.detail,
            {},
            'the supplier price is cut for a reviewer without price authority',
          );
          assert.equal(price.productName, 'Sản phẩm 201');
          assert.equal(price.candidate?.nameVi, 'Sản phẩm 201');
          const priced = await imports.listChanges(pricer.token, { kind: 'PRICE_CHANGED' });
          assert.equal(priced.canSeePrices, true);
          assert.equal(priced.items[0]!.detail.price?.after.priceVnd, 400_000);
          await fails(() => imports.listChanges(manager.token, {}), 'FORBIDDEN');
          await fails(
            () => imports.listChanges(reviewer.token, { status: 'ALL' }),
            'VALIDATION_FAILED',
          );
          await fails(
            () => imports.listChanges(reviewer.token, { kind: 'NOPE' }),
            'VALIDATION_FAILED',
          );

          // Acknowledging changes only the note.
          const ids = list.items.slice(0, 2).map((item) => item.id);
          await fails(() => imports.acknowledgeChanges(manager.token, { ids }), 'FORBIDDEN');
          assert.deepEqual(await imports.acknowledgeChanges(reviewer.token, { ids }), {
            acknowledged: 2,
            alreadyDone: 0,
          });
          assert.deepEqual(await imports.acknowledgeChanges(reviewer.token, { ids }), {
            acknowledged: 0,
            alreadyDone: 2,
          });
          await fails(
            () => imports.acknowledgeChanges(reviewer.token, { ids: [crypto.randomUUID()] }),
            'NOT_FOUND',
          );
          await fails(
            () => imports.acknowledgeChanges(reviewer.token, { ids: [] }),
            'VALIDATION_FAILED',
          );
          const open = await imports.listChanges(reviewer.token, {});
          assert.equal(open.total, 1);
          assert.equal((await imports.listChanges(reviewer.token, { status: 'DONE' })).total, 2);
          // History: a note is never edited or deleted, and acknowledged once.
          assert.match(
            (await sql(
              `UPDATE source_changes SET kind = 'SOURCE_REMOVED' WHERE id = '${ids[0]}'`,
            )) ?? '',
            /cannot be edited|acknowledged once/,
          );
          assert.match(
            (await sql(`DELETE FROM source_changes WHERE id = '${ids[0]}'`)) ?? '',
            /never deleted/,
          );
          assert.match(
            (await sql(
              `UPDATE source_changes SET acknowledged_at = now() WHERE id = '${ids[0]}'`,
            )) ?? '',
            /acknowledged once/,
          );
        },
      );

      await suite.test(
        'removal guard: missing from three healthy scans in a row raises one note and nothing is deleted, hidden or moved; coming back resets it',
        async () => {
          const { source } = await readySource();
          const site = await shop(catalog(401, 10));
          await manual(source.id, site);
          const before = await activePictures(source.id);
          assert.equal(before.length, 10);
          const candidatesBefore = await tx.importCandidate.findMany({
            where: { sources: { some: { sourceRecord: { sourceId: source.id } } } },
            select: { id: true, state: true, nameVi: true, rowVersion: true },
            orderBy: { id: 'asc' },
          });
          const gone = site.products.get(405)!;
          site.products.delete(405);

          const second = await manual(source.id, site);
          assert.equal(second.outcome, 'PARTIAL', 'the product is reported as not returned');
          assert.deepEqual(
            [
              (await recordOf(source.id, '405')).missingScans,
              (await recordOf(source.id, '405')).state,
            ],
            [1, 'MISSING'],
          );
          assert.equal((await changesOf(source.id)).length, 0);
          await manual(source.id, site);
          assert.equal((await recordOf(source.id, '405')).missingScans, 2);
          assert.equal((await changesOf(source.id)).length, 0, 'two scans are not enough');
          const fourth = await manual(source.id, site);
          assert.equal((await recordOf(source.id, '405')).missingScans, 3);
          assert.equal(fourth.item.counts.removed, 1);
          const removed = await changesOf(source.id);
          assert.deepEqual(
            removed.map((entry) => [entry.sourceRecord.sourceKey, entry.kind, entry.detail]),
            [['405', 'SOURCE_REMOVED', { missingScans: 3 }]],
          );
          const fifth = await manual(source.id, site);
          assert.equal(fifth.item.counts.removed, 0, 'raised once, not on every later scan');
          assert.equal((await recordOf(source.id, '405')).missingScans, 4);
          assert.equal((await changesOf(source.id)).length, 1);

          // Nothing was deleted, hidden, renamed or moved: the draft and its picture are as they were.
          assert.deepEqual(
            await tx.importCandidate.findMany({
              where: { sources: { some: { sourceRecord: { sourceId: source.id } } } },
              select: { id: true, state: true, nameVi: true, rowVersion: true },
              orderBy: { id: 'asc' },
            }),
            candidatesBefore,
          );
          assert.deepEqual(await activePictures(source.id), before);

          // It comes back: the count starts over and the return is noted because it had been raised.
          site.add(gone);
          const sixth = await manual(source.id, site);
          assert.equal(sixth.outcome, 'SUCCEEDED');
          const back = await recordOf(source.id, '405');
          assert.deepEqual([back.missingScans, back.state], [0, 'PRESENT']);
          assert.deepEqual(
            (await changesOf(source.id)).map((entry) => entry.kind),
            ['SOURCE_REMOVED', 'SOURCE_RETURNED'],
          );
          assert.deepEqual(await activePictures(source.id), before);
        },
      );

      await suite.test(
        'a product that is back before the third scan resets the count and raises nothing',
        async () => {
          const { source } = await readySource();
          const site = await shop(catalog(501, 10));
          await manual(source.id, site);
          const gone = site.products.get(503)!;
          site.products.delete(503);
          await manual(source.id, site);
          await manual(source.id, site);
          assert.equal((await recordOf(source.id, '503')).missingScans, 2);
          site.add(gone);
          await manual(source.id, site);
          assert.deepEqual(
            [(await recordOf(source.id, '503')).missingScans, (await changesOf(source.id)).length],
            [0, 0],
          );
        },
      );

      await suite.test(
        'a suspect scan (under 70% of the last healthy one) writes only its own row: no record change, nothing missing, no pictures, no notice; a failed scan too',
        async () => {
          const { source } = await readySource();
          const site = await shop(catalog(601, 10));
          await manual(source.id, site);
          const successBefore = (
            await tx.supplierSource.findUniqueOrThrow({
              where: { id: source.id },
              select: { lastSuccessAt: true },
            })
          ).lastSuccessAt;
          const recordsBefore = await tx.sourceRecord.findMany({
            where: { sourceId: source.id },
            orderBy: { sourceKey: 'asc' },
            select: {
              sourceKey: true,
              name: true,
              updatedAt: true,
              missingScans: true,
              state: true,
            },
          });
          const picturesBefore = await activePictures(source.id);
          const noticesBefore = (await notices(reviewer.id)).length;

          // The shop answers with 3 of the 10 products, all renamed, and a new picture for one.
          const half = await shop(catalog(601, 3));
          for (const product of half.products.values()) product.name = `${product.name} (đổi)`;
          half.products.get(601)!.images = ['/wp-content/uploads/9601.png'];
          half.files.set('/wp-content/uploads/9601.png', await patternPicture(9601));
          const suspect = await manual(source.id, half);
          assert.equal(suspect.outcome, 'SUSPECT');
          assert.equal(suspect.item.status, 'SUSPECT');
          assert.equal(
            suspect.item.errors.some((entry) => entry.code === 'SCAN_SUSPECT'),
            true,
          );
          assert.equal(suspect.item.counts.discovered, 3);
          assert.equal(suspect.item.counts.removed, 0);
          assert.deepEqual(
            await tx.sourceRecord.findMany({
              where: { sourceId: source.id },
              orderBy: { sourceKey: 'asc' },
              select: {
                sourceKey: true,
                name: true,
                updatedAt: true,
                missingScans: true,
                state: true,
              },
            }),
            recordsBefore,
          );
          assert.deepEqual(await activePictures(source.id), picturesBefore);
          assert.equal((await changesOf(source.id)).length, 0);
          assert.equal(
            half.urls.some((url) => url.startsWith('/wp-content/uploads/')),
            false,
            'no picture was requested',
          );
          const source2 = await tx.supplierSource.findUniqueOrThrow({
            where: { id: source.id },
            select: { lastSuccessAt: true, isEnabled: true, status: true },
          });
          assert.deepEqual(
            [source2.lastSuccessAt?.getTime(), source2.isEnabled, source2.status],
            [successBefore?.getTime(), true, 'READY'],
            'the source is not marked read, and is neither disabled nor flagged',
          );
          assert.equal(
            (await notices(reviewer.id)).length,
            noticesBefore,
            'a suspect scan says nothing',
          );

          // A failed read changes no count either.
          const broken: HttpClient = {
            ...site.client(),
            get: async () => {
              throw new Error('connection reset');
            },
          };
          const failed = await manual(source.id, site, manager, broken);
          assert.equal(failed.outcome, 'FAILED');
          assert.deepEqual(
            (await recordOf(source.id, '605')).missingScans,
            0,
            'an outage never counts as missing',
          );

          // Neither a suspect nor a failed scan is the baseline: the next healthy read of 10 is healthy and nothing was lost.
          const healthy = await manual(source.id, site);
          assert.equal(healthy.outcome, 'SUCCEEDED');
          assert.equal(healthy.item.counts.unchanged, 10);
          assert.equal((await changesOf(source.id)).length, 0);
        },
      );

      await suite.test(
        'a product the shop answers with a fatal problem for is unreadable, not missing',
        async () => {
          const { source } = await readySource();
          const site = await shop(catalog(701, 10));
          await manual(source.id, site);
          site.rereadOverride = (product) =>
            product.id === 703 ? { ...product, name: '' } : product;
          const scan = await manual(source.id, site);
          assert.equal(scan.outcome, 'PARTIAL');
          assert.equal(
            scan.item.errors.some((entry) => entry.code === 'PRODUCT_NAME_MISSING'),
            true,
          );
          assert.equal((await recordOf(source.id, '703')).missingScans, 0);
          assert.equal((await changesOf(source.id)).length, 0);
        },
      );

      await suite.test(
        'the summary notice: only for a healthy scan that found something, to the holders of the review permission, counts only, never to the person who asked',
        async () => {
          const { source } = await readySource();
          const site = await shop(catalog(801, 10));
          const sinceBefore = (await notices(reviewer.id)).length;
          const bothBefore = (await notices(both.id)).length;
          const first = await manual(source.id, site, both);
          assert.equal(first.item.counts.created, 10);
          // The first read made 10 new products; the reviewer is told, the person who ran the scan is not.
          const afterFirst = await notices(reviewer.id);
          assert.equal(afterFirst.length, sinceBefore + 1);
          const notice = afterFirst.at(-1)!;
          assert.deepEqual(notice.params, {
            created: 10,
            priceChanged: 0,
            contentChanged: 0,
            imageChanged: 0,
            removed: 0,
          });
          assert.equal(notice.entityType, 'SupplierSource');
          assert.equal(notice.entityId, source.id);
          assert.equal(notice.branchId, null);
          assert.equal(notice.contextCode, source.name);
          assert.equal((await notices(both.id)).length, bothBefore, 'not to the person who asked');
          assert.deepEqual(
            await notices(manager.id),
            [],
            'MANAGE_SUPPLIER_SOURCES alone is not a reviewer',
          );

          // Nothing changed: no message.
          const quiet = await manual(source.id, site);
          assert.equal(quiet.item.counts.unchanged, 10);
          assert.equal((await notices(reviewer.id)).length, sinceBefore + 1);

          // A price change is announced with counts, never with the price or the name.
          site.products.get(801)!.priceVnd = 999_000;
          site.products.get(802)!.name = 'Tên rất riêng 802';
          await manual(source.id, site);
          const all = await notices(reviewer.id);
          assert.equal(all.length, sinceBefore + 2);
          const last = all.at(-1)!;
          assert.deepEqual(last.params, {
            created: 0,
            priceChanged: 1,
            contentChanged: 1,
            imageChanged: 0,
            removed: 0,
          });
          const text = JSON.stringify(last);
          assert.equal(text.includes('999'), false);
          assert.equal(text.includes('riêng'), false);
          // The price holder, who also reviews, is told the same.
          assert.equal((await notices(pricer.id)).length >= 2, true);

          // A suspect scan says nothing.
          const small = await shop(catalog(801, 2));
          const suspect = await manual(source.id, small);
          assert.equal(suspect.outcome, 'SUSPECT');
          assert.equal((await notices(reviewer.id)).length, sinceBefore + 2);
          // The inbox row passes the closed type and entity checks the database keeps.
          assert.match(
            (await sql(
              `UPDATE notifications SET entity_type = 'Branch' WHERE type = 'SUPPLIER_IMPORT_CHANGES' AND entity_id = '${source.id}'`,
            )) ?? '',
            /notifications_/,
          );
        },
      );

      await suite.test(
        'the schedule: MANUAL is never scheduled; WEEKLY only at night, only after a week, one at a time, only for a source already read; DAILY after 20 hours; the manual-scan gates apply',
        async () => {
          const { source } = await readySource();
          const site = await shop(catalog(901, 6));

          // A source that was never read is never scheduled, whatever its cadence.
          await setCadence(source.id, 'WEEKLY');
          assert.equal(await queueScheduledScans(tx, NIGHT), 0);
          await manual(source.id, site);

          // Just read: not due. Default MANUAL is never queued, however old its last scan.
          assert.equal(await queueScheduledScans(tx, NIGHT), 0);
          await setCadence(source.id, 'MANUAL');
          await ageScans(source.id, 30 * 24);
          assert.equal(await queueScheduledScans(tx, NIGHT), 0);

          await setCadence(source.id, 'WEEKLY');
          await ageScans(source.id, 3 * 24);
          assert.equal(await queueScheduledScans(tx, NIGHT), 0, 'three days old is not a week');
          await ageScans(source.id, 8 * 24);
          assert.equal(await queueScheduledScans(tx, NOON), 0, 'not in the middle of the day');
          assert.equal(await queueScheduledScans(tx, NIGHT), 1);
          assert.equal(await queueScheduledScans(tx, NIGHT), 0, 'one scan at a time');
          const queued = await tx.importScan.findFirstOrThrow({
            where: { sourceId: source.id, trigger: 'SCHEDULE' },
          });
          assert.deepEqual(
            [queued.status, queued.actorUserId, queued.sampleLimit],
            ['RUNNING', null, 20],
          );
          const shown = (await sources.scans(manager.token, source.id)).items.find(
            (entry) => entry.id === queued.id,
          )!;
          assert.deepEqual(
            [shown.trigger, shown.requestedBy, shown.queued],
            ['SCHEDULE', null, true],
          );
          assert.equal(
            await processNextScan(tx, { createClient: () => site.client(), storage }),
            'SUCCEEDED',
          );
          assert.equal(
            await queueScheduledScans(tx, NIGHT),
            0,
            'a scan that just ran is not repeated',
          );

          // DAILY comes after 20 hours.
          await setCadence(source.id, 'DAILY');
          await ageScans(source.id, 12);
          assert.equal(await queueScheduledScans(tx, NIGHT), 0);
          await ageScans(source.id, 21);
          assert.equal(await queueScheduledScans(tx, NIGHT), 1);
          assert.equal(
            await processNextScan(tx, { createClient: () => site.client(), storage }),
            'SUCCEEDED',
          );

          // A disabled source and a source that fell back from READY are not scheduled.
          await ageScans(source.id, 30 * 24);
          await sources.disable(manager.token, source.id, {
            expectedVersion: await versionOf(source.id),
          });
          assert.equal(await queueScheduledScans(tx, NIGHT), 0);
          const other = (await readySource()).source;
          await manual(other.id, site);
          await setCadence(other.id, 'WEEKLY');
          await ageScans(other.id, 30 * 24);
          assert.equal(
            await sql(
              `UPDATE supplier_sources SET status = 'SOURCE_ERROR', row_version = row_version + 1 WHERE id = '${other.id}'`,
            ),
            null,
          );
          assert.equal(await queueScheduledScans(tx, NIGHT), 0);
        },
      );

      await suite.test(
        'a picture never moves between products on a scheduled rescan; a decided candidate keeps its pictures; new pictures belong to the person who confirmed the permission',
        async () => {
          const { source } = await readySource();
          const site = await shop(catalog(1001, 8));
          await manual(source.id, site);
          await setCadence(source.id, 'WEEKLY');
          const before = await activePictures(source.id);
          const shaOf = (key: string) => before.find((row) => row.sourceProductKey === key)!.sha256;
          assert.equal(before.length, 8);

          // 1001 now lists the file of 1002; 1003 gets a new file but its draft was rejected; 1004 gets a second, genuinely new file.
          site.products.get(1001)!.images = ['/wp-content/uploads/1002.png'];
          site.products.get(1003)!.images = ['/wp-content/uploads/3333.png'];
          site.files.set('/wp-content/uploads/3333.png', await patternPicture(3333));
          site.products.get(1004)!.images = [
            '/wp-content/uploads/1004.png',
            '/wp-content/uploads/4444.png',
          ];
          site.files.set('/wp-content/uploads/4444.png', await patternPicture(4444));
          const decided = await tx.importCandidate.findFirstOrThrow({
            where: {
              sources: { some: { sourceRecord: { sourceId: source.id, sourceKey: '1003' } } },
            },
            select: { id: true, rowVersion: true },
          });
          await imports.reject(reviewer.token, decided.id, {
            expectedVersion: decided.rowVersion,
            note: null,
          });
          const decidedBefore = before.filter((row) => row.sourceProductKey === '1003');

          const { outcome, row } = await scheduled(source.id, site);
          assert.ok(outcome === 'SUCCEEDED' || outcome === 'PARTIAL');
          assert.equal(row.trigger, 'SCHEDULE');
          assert.equal(row.actorUserId, null);
          assert.equal(row.imageChangedCount, 3);

          const after = await activePictures(source.id);
          // Every active picture still names the product its candidate owns (the database also guarantees this).
          const owners = await tx.candidateImage.findMany({
            where: { retiredAt: null, owner: { sourceRecord: { sourceId: source.id } } },
            select: {
              sourceProductKey: true,
              owner: { select: { sourceRecord: { select: { sourceKey: true } } } },
            },
          });
          for (const owner of owners)
            assert.equal(owner.owner.sourceRecord.sourceKey, owner.sourceProductKey);
          // 1002 kept its own picture (same row, same file); 1001 got the file of 1002 as ITS picture, flagged on both sides, never reassigned.
          const b = after.filter((entry) => entry.sourceProductKey === '1002');
          assert.deepEqual(
            b.map((entry) => [entry.id, entry.sha256]),
            before
              .filter((entry) => entry.sourceProductKey === '1002')
              .map((entry) => [entry.id, entry.sha256]),
          );
          assert.equal(b[0]!.flag, 'SAME_FILE');
          const a = after.filter((entry) => entry.sourceProductKey === '1001');
          assert.equal(a.length, 1);
          assert.equal(a[0]!.sha256, shaOf('1002'));
          assert.equal(a[0]!.flag, 'SAME_FILE');
          assert.notEqual(a[0]!.id, b[0]!.id);
          const candidate1001 = await tx.importCandidate.findFirstOrThrow({
            where: {
              sources: { some: { sourceRecord: { sourceId: source.id, sourceKey: '1001' } } },
            },
            select: { state: true },
          });
          assert.equal(candidate1001.state, 'NEEDS_REVIEW', 'a shared picture waits for a person');

          // The rejected draft keeps what it had: same rows, nothing retired, the new file was not even requested.
          assert.deepEqual(
            after.filter((entry) => entry.sourceProductKey === '1003'),
            decidedBefore,
          );
          assert.equal(
            site.urls.some((url) => url.startsWith('/wp-content/uploads/3333.png')),
            false,
          );

          // 1004 gained a picture; the library asset is owned by the person who confirmed the permission (a schedule has no person).
          const gained = await tx.candidateImage.findFirstOrThrow({
            where: { sourceUrl: { endsWith: '/wp-content/uploads/4444.png' }, retiredAt: null },
            select: { sourceProductKey: true, mediaAsset: { select: { createdByUserId: true } } },
          });
          assert.equal(gained.sourceProductKey, '1004');
          assert.equal(gained.mediaAsset.createdByUserId, manager.id);

          // The reviewers are told with counts only.
          const told = (await notices(reviewer.id)).at(-1)!;
          assert.deepEqual(told.params, {
            created: 0,
            priceChanged: 0,
            contentChanged: 0,
            imageChanged: 3,
            removed: 0,
          });
        },
      );
    });
  },
);
