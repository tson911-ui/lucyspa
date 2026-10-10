import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { SupplierSourceItem } from '@lucy-spa/contracts';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { SupplierSourceService } from './supplier-source.service.js';

/** A few days ago, in the shop's calendar: a permission is never dated in the future. */
const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);

const record = (version: number, patch: Record<string, unknown> = {}) => ({
  expectedVersion: version,
  givenBy: 'Chị Hà, quản lý haruohui.com',
  method: 'Tin nhắn Zalo',
  date: threeDaysAgo,
  note: 'Cho dùng ảnh và nội dung; giá chưa nói',
  permitsText: true,
  permitsImages: true,
  permitsPrices: false,
  ...patch,
});

/**
 * Phase 9 P9-2 against real PostgreSQL (design PHASE9_PRODUCT_IMPORT.md sections 11 and 12; P9-T8, P9-T9): supplier sources and the
 * permission gate. A source cannot be enabled until a complete, confirmed permission record covers text or images; recording a new
 * record clears the confirmation and disables the source; the database says the same as constraints and guards. Fixtures roll back.
 */
test(
  'Phase 9 P9-2 supplier sources: authority, input, the permission gate, audit and the database guards; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const { tx, fails } = base;
      const sources = new SupplierSourceService(base.adapter, base.throttle);
      const manager = await base.staff(['MANAGE_PRODUCTS'], {
        globalCodes: ['MANAGE_SUPPLIER_SOURCES'],
      });
      const reviewer = await base.staff(['MANAGE_PRODUCTS'], {
        globalCodes: ['REVIEW_SUPPLIER_IMPORTS'],
      });
      const nobody = await base.staff(['MANAGE_PRODUCTS'], { globalCodes: ['MANAGE_PRODUCTS'] });
      let n = 0;
      const create = async (patch: Record<string, unknown> = {}): Promise<SupplierSourceItem> => {
        const { item } = await sources.create(manager.token, {
          supplierName: `Nhà cung cấp ${base.run}`,
          name: `Nguồn ${++n} ${base.run}`,
          kind: 'WEBSITE',
          baseUrl: `https://nguon-${n}-${base.run}.example.com/`,
          ...patch,
        } as never);
        return item;
      };
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
      const audit = (id: string) =>
        tx.auditEvent.findMany({
          where: { entityType: 'SupplierSource', entityId: id },
          orderBy: { occurredAt: 'asc' },
          select: { action: true, actorUserId: true },
        });

      await suite.test(
        'authority: MANAGE_SUPPLIER_SOURCES changes, REVIEW_SUPPLIER_IMPORTS only reads, nobody else sees anything',
        async () => {
          await fails(() => sources.list(nobody.token), 'FORBIDDEN');
          const read = await sources.list(reviewer.token);
          assert.equal(read.canManage, false);
          assert.equal((await sources.list(manager.token)).canManage, true);
          await fails(
            () =>
              sources.create(reviewer.token, {
                supplierName: 'X',
                name: 'Y',
                kind: 'WEBSITE',
                baseUrl: 'https://x.example.com/',
              }),
            'FORBIDDEN',
          );
          const made = await create();
          for (const act of [
            () => sources.edit(reviewer.token, made.id, { expectedVersion: 1, name: 'Z' }),
            () => sources.permission(reviewer.token, made.id, record(1)),
            () => sources.confirm(reviewer.token, made.id, { expectedVersion: 1 }),
            () => sources.enable(reviewer.token, made.id, { expectedVersion: 1 }),
            () => sources.disable(reviewer.token, made.id, { expectedVersion: 1 }),
          ]) {
            await fails(act, 'FORBIDDEN');
          }
        },
      );

      await suite.test(
        'a new source starts disabled with no permission; the supplier is found by name (any case) or by id, never twice',
        async () => {
          const first = await create();
          assert.equal(first.isEnabled, false);
          assert.equal(first.status, 'PENDING_VALIDATION');
          assert.deepEqual(first.gaps, [
            'PERMISSION_RECORD',
            'PERMISSION_COVERAGE',
            'PERMISSION_CONFIRMATION',
          ]);
          assert.equal(first.permission.confirmedAt, null);
          assert.equal(first.rowVersion, 1);
          const second = await create({ supplierName: `NHÀ CUNG CẤP ${base.run}`.toUpperCase() });
          assert.equal(second.supplier.id, first.supplier.id, 'the same supplier, found by name');
          const byId = await create({ supplierName: undefined, supplierId: first.supplier.id });
          assert.equal(byId.supplier.id, first.supplier.id);
          const listed = await sources.list(manager.token);
          assert.ok(listed.suppliers.some((supplier) => supplier.id === first.supplier.id));
          assert.equal(
            await tx.supplier.count({ where: { name: { equals: first.supplier.name } } }),
            1,
          );
          await fails(
            () => create({ supplierId: first.supplier.id, supplierName: 'both' }),
            'VALIDATION_FAILED',
            'supplierId',
          );
          await fails(
            () => create({ supplierName: undefined, supplierId: undefined }),
            'VALIDATION_FAILED',
            'supplierId',
          );
          await fails(
            () => create({ supplierName: undefined, supplierId: randomUUID() }),
            'VALIDATION_FAILED',
            'supplierId',
          );
          const trail = await audit(first.id);
          assert.deepEqual(
            trail.map((event) => event.action),
            ['SUPPLIER_SOURCE_CREATED'],
          );
          assert.equal(trail[0]?.actorUserId, manager.id);
        },
      );

      await suite.test(
        'input: https addresses only, no address literal, port, credentials, query or fragment; a FILE source has no address',
        async () => {
          for (const baseUrl of [
            'http://haruohui.example.com/',
            'https://127.0.0.1/',
            'https://[::1]/',
            'https://localhost/',
            'https://intranet/',
            'https://user:pw@shop.example.com/',
            'https://shop.example.com:8443/',
            'https://shop.example.com/?a=1',
            'https://shop.example.com/#top',
            'ftp://shop.example.com/',
            'not a url',
            '',
          ]) {
            await fails(() => create({ baseUrl }), 'VALIDATION_FAILED', 'baseUrl');
          }
          await fails(() => create({ baseUrl: null }), 'VALIDATION_FAILED', 'baseUrl');
          await fails(() => create({ kind: 'FILE' }), 'VALIDATION_FAILED', 'baseUrl');
          await fails(() => create({ kind: 'CRAWLER' }), 'VALIDATION_FAILED', 'kind');
          await fails(() => create({ name: '   ' }), 'VALIDATION_FAILED', 'name');
          await fails(() => create({ name: 'x'.repeat(121) }), 'VALIDATION_FAILED', 'name');
          await fails(() => create({ colour: 'red' }), 'VALIDATION_FAILED');
          const file = await create({ kind: 'FILE', baseUrl: null, name: `Tệp ${base.run}` });
          assert.equal(file.baseUrl, null);
          const normalized = await create({ baseUrl: 'HTTPS://Shop-X.Example.COM/danh-muc' });
          assert.equal(normalized.baseUrl, 'https://shop-x.example.com/danh-muc/');
        },
      );

      await suite.test('a source name and a source address are unique per supplier', async () => {
        const first = await create();
        await fails(
          () =>
            create({ supplierId: first.supplier.id, supplierName: undefined, name: first.name }),
          'SUPPLIER_SOURCE_NAME_TAKEN',
          'name',
        );
        await fails(
          () =>
            create({
              supplierId: first.supplier.id,
              supplierName: undefined,
              baseUrl: first.baseUrl,
            }),
          'SUPPLIER_SOURCE_URL_TAKEN',
          'baseUrl',
        );
        const other = await create();
        await fails(
          () => sources.edit(manager.token, other.id, { expectedVersion: 1, name: first.name }),
          'SUPPLIER_SOURCE_NAME_TAKEN',
          'name',
        );
        await fails(
          () =>
            sources.edit(manager.token, other.id, {
              expectedVersion: 1,
              baseUrl: first.baseUrl ?? '',
            }),
          'SUPPLIER_SOURCE_URL_TAKEN',
          'baseUrl',
        );
      });

      await suite.test(
        'the gate: record, coverage, confirmation, in that order; only then it can be enabled',
        async () => {
          const source = await create();
          await fails(
            () => sources.enable(manager.token, source.id, { expectedVersion: 1 }),
            'SUPPLIER_SOURCE_PERMISSION_INCOMPLETE',
          );
          await fails(
            () => sources.confirm(manager.token, source.id, { expectedVersion: 1 }),
            'SUPPLIER_SOURCE_PERMISSION_INCOMPLETE',
          );
          // A record that covers neither text nor images can be confirmed, but never enabled.
          const bare = await sources.permission(
            manager.token,
            source.id,
            record(1, { permitsText: false, permitsImages: false, permitsPrices: true }),
          );
          assert.equal(bare.item.rowVersion, 2);
          assert.deepEqual(bare.item.gaps, ['PERMISSION_COVERAGE', 'PERMISSION_CONFIRMATION']);
          await fails(
            () => sources.enable(manager.token, source.id, { expectedVersion: 2 }),
            'SUPPLIER_SOURCE_NOT_COVERED',
          );
          const covered = await sources.permission(manager.token, source.id, record(2));
          assert.deepEqual(covered.item.gaps, ['PERMISSION_CONFIRMATION']);
          assert.equal(covered.item.permission.date, threeDaysAgo);
          assert.equal(covered.item.permission.permitsPrices, false);
          await fails(
            () => sources.enable(manager.token, source.id, { expectedVersion: 3 }),
            'SUPPLIER_SOURCE_PERMISSION_UNCONFIRMED',
          );
          const confirmed = await sources.confirm(manager.token, source.id, { expectedVersion: 3 });
          assert.deepEqual(confirmed.item.gaps, []);
          assert.equal(confirmed.item.permission.confirmedBy?.id, manager.id);
          assert.ok(confirmed.item.permission.confirmedAt);
          const enabled = await sources.enable(manager.token, source.id, { expectedVersion: 4 });
          assert.equal(enabled.item.isEnabled, true);
          assert.equal(enabled.item.rowVersion, 5);
          assert.deepEqual(enabled.item.gaps, []);
          // Enabling again, or disabling a disabled source, is a no-op that writes nothing.
          assert.equal(
            (await sources.enable(manager.token, source.id, { expectedVersion: 5 })).item
              .rowVersion,
            5,
          );
          const off = await sources.disable(manager.token, source.id, { expectedVersion: 5 });
          assert.equal(off.item.isEnabled, false);
          assert.equal(off.item.rowVersion, 6);
          assert.equal(
            (await sources.disable(manager.token, source.id, { expectedVersion: 6 })).item
              .rowVersion,
            6,
          );
          // Every change left one audit entry by the acting person (compared without regard to order: they share one millisecond clock).
          const trail = await audit(source.id);
          assert.deepEqual(trail.map((event) => event.action).sort(), [
            'SUPPLIER_SOURCE_CREATED',
            'SUPPLIER_SOURCE_DISABLED',
            'SUPPLIER_SOURCE_ENABLED',
            'SUPPLIER_SOURCE_PERMISSION_CONFIRMED',
            'SUPPLIER_SOURCE_PERMISSION_RECORDED',
            'SUPPLIER_SOURCE_PERMISSION_RECORDED',
          ]);
          assert.ok(trail.every((event) => event.actorUserId === manager.id));
        },
      );

      await suite.test(
        'a new permission record clears the confirmation and disables the source; the same record changes nothing',
        async () => {
          const source = await create();
          let version = (await sources.permission(manager.token, source.id, record(1))).item
            .rowVersion;
          version = (await sources.confirm(manager.token, source.id, { expectedVersion: version }))
            .item.rowVersion;
          version = (await sources.enable(manager.token, source.id, { expectedVersion: version }))
            .item.rowVersion;
          const same = await sources.permission(manager.token, source.id, record(version));
          assert.equal(same.item.rowVersion, version, 'the same record is a no-op');
          assert.equal(same.item.isEnabled, true);
          const changed = await sources.permission(
            manager.token,
            source.id,
            record(version, { permitsImages: false }),
          );
          assert.equal(changed.item.isEnabled, false);
          assert.equal(changed.item.permission.confirmedAt, null);
          assert.equal(changed.item.permission.confirmedBy, null);
          assert.deepEqual(changed.item.gaps, ['PERMISSION_CONFIRMATION']);
          assert.equal(changed.item.rowVersion, version + 1);
        },
      );

      await suite.test(
        'the permission record is checked: who, how, a real date that is not in the future, a short note',
        async () => {
          const source = await create();
          for (const [patch, field] of [
            [{ givenBy: '  ' }, 'givenBy'],
            [{ method: undefined }, 'method'],
            [{ date: '2026-02-30' }, 'date'],
            [{ date: '01/10/2026' }, 'date'],
            [{ date: '2999-01-01' }, 'date'],
            [{ note: 'x'.repeat(501) }, 'note'],
            [{ permitsText: 'yes' }, 'permitsText'],
            [{ permitsPrices: undefined }, 'permitsPrices'],
            [{ confirmed: true }, 'body'],
          ] as const) {
            await fails(
              () => sources.permission(manager.token, source.id, record(1, patch) as never),
              'VALIDATION_FAILED',
              field,
            );
          }
          const noNote = await sources.permission(
            manager.token,
            source.id,
            record(1, { note: null }),
          );
          assert.equal(noNote.item.permission.note, null);
        },
      );

      await suite.test(
        'stale versions are refused; the address of an enabled source is fixed; changing it clears the permission',
        async () => {
          const source = await create();
          await fails(
            () => sources.edit(manager.token, source.id, { expectedVersion: 7, name: 'Mới' }),
            'CONFLICT',
          );
          await fails(() => sources.permission(manager.token, source.id, record(7)), 'CONFLICT');
          await fails(
            () => sources.enable(manager.token, source.id, { expectedVersion: 7 }),
            'CONFLICT',
          );
          await fails(
            () => sources.edit(manager.token, randomUUID(), { expectedVersion: 1 }),
            'NOT_FOUND',
          );
          await fails(
            () => sources.edit(manager.token, 'not-a-uuid', { expectedVersion: 1 }),
            'VALIDATION_FAILED',
            'id',
          );
          let version = (await sources.permission(manager.token, source.id, record(1))).item
            .rowVersion;
          version = (await sources.confirm(manager.token, source.id, { expectedVersion: version }))
            .item.rowVersion;
          version = (await sources.enable(manager.token, source.id, { expectedVersion: version }))
            .item.rowVersion;
          await fails(
            () =>
              sources.edit(manager.token, source.id, {
                expectedVersion: version,
                baseUrl: 'https://khac.example.com/',
              }),
            'SUPPLIER_SOURCE_ENABLED',
            'baseUrl',
          );
          // The name and the cadence may change while enabled; the address may not.
          const renamed = await sources.edit(manager.token, source.id, {
            expectedVersion: version,
            name: `Đổi tên ${base.run}`,
            scanCadence: 'WEEKLY',
          });
          assert.equal(renamed.item.scanCadence, 'WEEKLY');
          assert.equal(renamed.item.isEnabled, true);
          version = (
            await sources.disable(manager.token, source.id, {
              expectedVersion: renamed.item.rowVersion,
            })
          ).item.rowVersion;
          const moved = await sources.edit(manager.token, source.id, {
            expectedVersion: version,
            baseUrl: 'https://khac.example.com/',
          });
          assert.equal(moved.item.baseUrl, 'https://khac.example.com/');
          assert.equal(moved.item.status, 'PENDING_VALIDATION');
          assert.equal(
            moved.item.permission.confirmedAt,
            null,
            'the permission was for the old address',
          );
          assert.deepEqual(moved.item.gaps, ['PERMISSION_CONFIRMATION']);
          const nothing = await sources.edit(manager.token, source.id, {
            expectedVersion: moved.item.rowVersion,
          });
          assert.equal(nothing.item.rowVersion, moved.item.rowVersion, 'no change, no write');
          await fails(
            () =>
              sources.edit(manager.token, source.id, {
                expectedVersion: moved.item.rowVersion,
                scanCadence: 'HOURLY' as never,
              }),
            'VALIDATION_FAILED',
            'scanCadence',
          );
        },
      );

      await suite.test(
        'the database says the same: no enabled source without a confirmed record, a confirmed record is fixed, history is never deleted',
        async () => {
          const source = await create();
          const id = source.id;
          assert.match(
            (await sql(
              `UPDATE supplier_sources SET is_enabled = true, row_version = 2 WHERE id = '${id}'`,
            )) ?? '',
            /enabled_gate|supplier_sources/,
            'enabling without a confirmed record is refused',
          );
          assert.match(
            (await sql(
              `UPDATE supplier_sources SET permission_confirmed_at = clock_timestamp(), permission_confirmed_by_user_id = '${manager.id}', row_version = 2 WHERE id = '${id}'`,
            )) ?? '',
            /confirmed_complete|supplier_sources/,
            'a confirmation needs a complete record',
          );
          let version = (await sources.permission(manager.token, id, record(1))).item.rowVersion;
          version = (await sources.confirm(manager.token, id, { expectedVersion: version })).item
            .rowVersion;
          assert.match(
            (await sql(
              `UPDATE supplier_sources SET permits_images = false, row_version = ${version + 1} WHERE id = '${id}'`,
            )) ?? '',
            /cannot change without clearing the confirmation/,
          );
          assert.match(
            (await sql(
              `UPDATE supplier_sources SET permits_text = false, permits_images = false, permission_confirmed_at = NULL, permission_confirmed_by_user_id = NULL, is_enabled = true, row_version = ${version + 1} WHERE id = '${id}'`,
            )) ?? '',
            /enabled_gate|supplier_sources/,
          );
          version = (await sources.enable(manager.token, id, { expectedVersion: version })).item
            .rowVersion;
          assert.match(
            (await sql(
              `UPDATE supplier_sources SET base_url = 'https://doi.example.com/', row_version = ${version + 1} WHERE id = '${id}'`,
            )) ?? '',
            /address of an enabled source cannot change/,
          );
          assert.match(
            (await sql(`DELETE FROM supplier_sources WHERE id = '${id}'`)) ?? '',
            /never deleted/,
          );
          assert.match(
            (await sql(
              `INSERT INTO supplier_sources (supplier_id, name, kind, is_enabled, created_by_user_id) VALUES ('${source.supplier.id}', 'Bật ngay', 'FILE', true, '${manager.id}')`,
            )) ?? '',
            /starts disabled/,
          );
        },
      );

      await suite.test(
        'scans, records and prices: one running scan per source, price observations are append-only, history is never deleted',
        async () => {
          const source = await create();
          const id = source.id;
          assert.equal(
            await sql(
              `INSERT INTO import_scans (id, source_id, trigger, actor_user_id) VALUES ('11111111-1111-4111-8111-111111111111', '${id}', 'MANUAL', '${manager.id}')`,
            ),
            null,
          );
          assert.match(
            (await sql(
              `INSERT INTO import_scans (source_id, trigger, actor_user_id) VALUES ('${id}', 'MANUAL', '${manager.id}')`,
            )) ?? '',
            /import_scans_one_running_key|unique/i,
            'a second running scan of the same source is refused',
          );
          assert.match(
            (await sql(
              `INSERT INTO import_scans (source_id, trigger, status, finished_at) VALUES ('${id}', 'MANUAL', 'SUCCEEDED', clock_timestamp())`,
            )) ?? '',
            /import_scans_actor/,
            'a manual scan names who ran it',
          );
          assert.equal(
            await sql(
              `INSERT INTO source_records (id, source_id, source_key, url, name, content_hash, first_seen_scan_id, last_seen_scan_id) VALUES ('22222222-2222-4222-8222-222222222222', '${id}', '6259', 'https://x.example.com/p/', 'Kem chống nắng', '${'a'.repeat(64)}', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111')`,
            ),
            null,
          );
          assert.match(
            (await sql(
              `INSERT INTO source_records (source_id, source_key, url, name, content_hash, first_seen_scan_id, last_seen_scan_id) VALUES ('${id}', '6259', 'https://x.example.com/q/', 'Trùng khóa', '${'b'.repeat(64)}', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111')`,
            )) ?? '',
            /source_records_source_key_key|unique/i,
            'one record per source key',
          );
          assert.equal(
            await sql(
              `INSERT INTO source_price_observations (id, source_record_id, scan_id, price_vnd, promo_price_vnd) VALUES ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 1150000, 880000)`,
            ),
            null,
          );
          assert.match(
            (await sql(
              `UPDATE source_price_observations SET price_vnd = 1 WHERE id = '33333333-3333-4333-8333-333333333333'`,
            )) ?? '',
            /append-only/,
          );
          assert.match(
            (await sql(
              `DELETE FROM source_price_observations WHERE id = '33333333-3333-4333-8333-333333333333'`,
            )) ?? '',
            /append-only/,
          );
          assert.match(
            (await sql(
              `INSERT INTO source_price_observations (source_record_id, scan_id, price_vnd, promo_price_vnd) VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 1, 2)`,
            )) ?? '',
            /source_price_observations_scan_key|unique/i,
            'one observation per record and scan',
          );
          assert.equal(
            await sql(
              `INSERT INTO import_scans (id, source_id, trigger, status, finished_at) VALUES ('99999999-9999-4999-8999-999999999999', '${id}', 'SCHEDULE', 'SUCCEEDED', clock_timestamp())`,
            ),
            null,
          );
          assert.match(
            (await sql(
              `INSERT INTO source_price_observations (source_record_id, scan_id, price_vnd, currency) VALUES ('22222222-2222-4222-8222-222222222222', '99999999-9999-4999-8999-999999999999', 5, 'USD')`,
            )) ?? '',
            /source_price_observations_vnd/,
            'integer VND is only claimed for VND',
          );
          assert.equal(
            await sql(
              `INSERT INTO source_price_observations (source_record_id, scan_id, currency, original_amount) VALUES ('22222222-2222-4222-8222-222222222222', '99999999-9999-4999-8999-999999999999', 'USD', 49.9)`,
            ),
            null,
            'another currency keeps its original amount',
          );
          assert.match(
            (await sql(
              `DELETE FROM import_scans WHERE id = '11111111-1111-4111-8111-111111111111'`,
            )) ?? '',
            /never deleted/,
          );
          assert.match(
            (await sql(
              `DELETE FROM source_records WHERE id = '22222222-2222-4222-8222-222222222222'`,
            )) ?? '',
            /never deleted/,
          );
        },
      );

      await suite.test(
        'candidates: at most six images by position, one candidate per source record, a manual match names a person',
        async () => {
          const source = await create();
          const supplierId = source.supplier.id;
          assert.equal(
            await sql(
              `INSERT INTO import_scans (id, source_id, trigger, actor_user_id) VALUES ('44444444-4444-4444-8444-444444444444', '${source.id}', 'MANUAL', '${manager.id}')`,
            ),
            null,
          );
          assert.equal(
            await sql(
              `INSERT INTO source_records (id, source_id, source_key, url, name, content_hash, first_seen_scan_id, last_seen_scan_id) VALUES ('55555555-5555-4555-8555-555555555555', '${source.id}', '1', 'https://x.example.com/1/', 'Sản phẩm', '${'c'.repeat(64)}', '44444444-4444-4444-8444-444444444444', '44444444-4444-4444-8444-444444444444')`,
            ),
            null,
          );
          assert.equal(
            await sql(
              `INSERT INTO import_candidates (id, supplier_id, name_vi, name_en) VALUES ('66666666-6666-4666-8666-666666666666', '${supplierId}', 'Sản phẩm', 'Sản phẩm')`,
            ),
            null,
          );
          const flagged = await tx.$queryRaw<{ needs_translation: boolean }[]>`
            SELECT needs_translation FROM import_candidates WHERE id = '66666666-6666-4666-8666-666666666666'::uuid`;
          assert.equal(
            flagged[0]?.needs_translation,
            true,
            'the English name starts flagged for translation',
          );
          assert.equal(
            await sql(
              `INSERT INTO candidate_sources (candidate_id, source_record_id, match_kind) VALUES ('66666666-6666-4666-8666-666666666666', '55555555-5555-4555-8555-555555555555', 'EXACT')`,
            ),
            null,
          );
          assert.equal(
            await sql(
              `INSERT INTO import_candidates (id, supplier_id, name_vi, name_en) VALUES ('77777777-7777-4777-8777-777777777777', '${supplierId}', 'Khác', 'Khác')`,
            ),
            null,
          );
          assert.match(
            (await sql(
              `INSERT INTO candidate_sources (candidate_id, source_record_id, match_kind) VALUES ('77777777-7777-4777-8777-777777777777', '55555555-5555-4555-8555-555555555555', 'EXACT')`,
            )) ?? '',
            /candidate_sources_record_key|unique/i,
            'a source record belongs to one candidate',
          );
          assert.match(
            (await sql(
              `INSERT INTO candidate_sources (candidate_id, source_record_id, match_kind) VALUES ('77777777-7777-4777-8777-777777777777', '55555555-5555-4555-8555-555555555555', 'MANUAL')`,
            )) ?? '',
            /candidate_sources_manual|candidate_sources/,
            'a manual match names a person',
          );
          assert.match(
            (await sql(
              `DELETE FROM import_candidates WHERE id = '77777777-7777-4777-8777-777777777777'`,
            )) ?? '',
            /never deleted/,
          );
          assert.match(
            (await sql(
              `INSERT INTO candidate_images (candidate_id, media_asset_id, source_url, sort_order, sha256) VALUES ('66666666-6666-4666-8666-666666666666', gen_random_uuid(), 'https://x.example.com/a.jpg', 6, '${'d'.repeat(64)}')`,
            )) ?? '',
            /candidate_images_position/,
            'at most six images: positions 0 to 5',
          );
        },
      );
    });
  },
);
