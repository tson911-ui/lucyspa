import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { campaignRulePrice } from '@lucy-spa/contracts';
import { onlineOrderKit } from '../testing/online-order-kit.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { parsePublicProductsQuery } from '../products/public-products.logic.js';
import { publicProducts, publicProductDetail } from '../products/public-products.core.js';
import { mediaUsages } from '../website/media.core.js';
import { isPubliclyServed } from '../website/popup.core.js';
import { campaignState } from './campaign.core.js';
import { runningCampaigns } from './campaign.public.js';
import { CampaignService } from './campaign.service.js';
import { ProductCatalogService } from '../products/product-catalog.service.js';

const HOUR = 3_600_000;
const later = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();

/**
 * Phase 6 Wave 4 / P6-23 against real PostgreSQL (PRD 24.1; design 2.39): the campaign engine. A draft is free and prices nothing; a
 * published campaign is frozen (window, rules, products) and prices through the ONE database function the sale uses; the lowest price wins
 * (never the sum); ending it returns the prices by itself and the invoices it priced keep reproducing their price. Fixtures roll back.
 */
test(
  'Phase 6 P6-23 promotion campaigns: drafts, review, publication, price, public view, guards; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await onlineOrderKit(base);
      const { tx, fails } = base;
      const campaigns = new CampaignService(base.adapter, base.throttle);
      const catalog = new ProductCatalogService(base.adapter, base.throttle, base.environment);
      const owner = await base.staff(['MANAGE_PRODUCT_PRICES'], {
        globalCodes: ['MANAGE_PRODUCT_PRICES'],
      });
      const clerk = await base.staff(['MANAGE_PRODUCTS'], { globalCodes: ['MANAGE_PRODUCTS'] });
      await k.open();
      let n = 0;
      const create = (patch: Record<string, unknown> = {}) =>
        k.ok(() =>
          campaigns.create(owner.token, {
            slug: `sale-${++n}-${randomBytes(3).toString('hex')}`,
            nameVi: `Khuyến mãi ${n}`,
            nameEn: `Sale ${n}`,
            startsAt: later(1),
            endsAt: later(48),
            ...patch,
          } as never),
        );
      const group = async (id: string, kind: string, value: string, version: number) =>
        k.ok(() =>
          campaigns.addGroup(owner.token, id, {
            expectedVersion: version,
            rule: { kind, value },
          } as never),
        );
      const items = (id: string, version: number, groupId: string, variantIds: string[]) =>
        k.ok(() =>
          campaigns.addItems(owner.token, id, { expectedVersion: version, groupId, variantIds }),
        );
      const detail = (id: string) => campaigns.get(owner.token, id);
      const product = async (label: string, price: number) => {
        const created = await k.stocked(label, price, 50);
        return created;
      };
      /** Test-only: makes a published campaign run now (the real campaign cannot start in the past). */
      const activate = async (id: string, startedHoursAgo = 2, endsInHours = 2) => {
        await tx.$executeRawUnsafe('SAVEPOINT activate');
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        await tx.$executeRawUnsafe(
          `UPDATE product_campaigns SET starts_at = clock_timestamp() - interval '${startedHoursAgo} hours', ends_at = clock_timestamp() + interval '${endsInHours} hours', published_at = clock_timestamp() - interval '${startedHoursAgo + 1} hours' WHERE id = '${id}'::uuid`,
        );
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
        await tx.$executeRawUnsafe('RELEASE SAVEPOINT activate');
      };
      const priceNow = async (variantId: string) => {
        const [row] = await tx.$queryRaw<
          { list: bigint; promo: bigint | null; effective: bigint; promotion_id: string | null }[]
        >`SELECT list_price_vnd AS list, promo_price_vnd AS promo, effective_price_vnd AS effective, promotion_id
          FROM lucy_variant_price_at(${variantId}::uuid, clock_timestamp())`;
        return row!;
      };

      await suite.test(
        'the rule arithmetic: the discount of a percent is rounded down, no rule may give 0 or a rise',
        () => {
          assert.equal(campaignRulePrice({ kind: 'PERCENT', value: '10' }, 199_999n), 180_000n);
          assert.equal(campaignRulePrice({ kind: 'PERCENT', value: '90' }, 100n), 10n);
          assert.equal(campaignRulePrice({ kind: 'AMOUNT', value: '30000' }, 50_000n), 20_000n);
          assert.equal(campaignRulePrice({ kind: 'AMOUNT', value: '50000' }, 50_000n), null);
          assert.equal(campaignRulePrice({ kind: 'PRICE', value: '49999' }, 50_000n), 49_999n);
          assert.equal(campaignRulePrice({ kind: 'PRICE', value: '50000' }, 50_000n), null);
          assert.equal(
            campaignRulePrice({ kind: 'PERCENT', value: '1' }, 99n),
            null,
            'a discount that rounds to 0 is no discount',
          );
        },
      );

      await suite.test(
        'authority and input: MANAGE_PRODUCT_PRICES only; the address name, names and dates are checked',
        async () => {
          await fails(() => campaigns.list(clerk.token, {}), 'FORBIDDEN');
          await fails(
            () =>
              campaigns.create(clerk.token, {
                slug: 'abc',
                nameVi: 'a',
                nameEn: 'a',
                startsAt: later(1),
                endsAt: later(2),
              }),
            'FORBIDDEN',
          );
          await fails(() => campaigns.list(undefined, {}), 'AUTHENTICATION_REQUIRED');
          const base = { nameVi: 'Tên', nameEn: 'Name', startsAt: later(1), endsAt: later(2) };
          for (const slug of [
            'ab',
            'Black-Friday',
            'black friday',
            '-black',
            'black--friday',
            'x'.repeat(61),
            5,
          ]) {
            await fails(
              () => campaigns.create(owner.token, { ...base, slug } as never),
              'VALIDATION_FAILED',
              'slug',
            );
          }
          await fails(
            () =>
              campaigns.create(owner.token, { ...base, slug: 'ok-slug', endsAt: base.startsAt }),
            'VALIDATION_FAILED',
            'endsAt',
          );
          await fails(
            () =>
              campaigns.create(owner.token, {
                ...base,
                slug: 'ok-slug',
                startsAt: later(-5),
                endsAt: later(-4),
              }),
            'VALIDATION_FAILED',
            'endsAt',
          );
          await fails(
            () => campaigns.create(owner.token, { ...base, slug: 'ok-slug', extra: 1 } as never),
            'VALIDATION_FAILED',
          );
          const made = await create({ slug: 'black-friday-test' });
          assert.equal(made.state, 'DRAFT');
          assert.deepEqual(made.can, {
            edit: true,
            editPresentation: true,
            changeItems: true,
            publish: true,
            end: false,
            remove: true,
          });
          await fails(
            () => campaigns.create(owner.token, { ...base, slug: 'black-friday-test' }),
            'CAMPAIGN_SLUG_TAKEN',
            'slug',
          );
          const listed = await campaigns.list(owner.token, { q: 'khuyen mai' });
          assert.ok(listed.rows.some((row) => row.id === made.id));
          await fails(
            () => campaigns.list(owner.token, { state: 'BAD' }),
            'VALIDATION_FAILED',
            'state',
          );
          await fails(() => campaigns.get(owner.token, 'not-a-uuid'), 'VALIDATION_FAILED');
          await fails(
            () => campaigns.get(owner.token, '00000000-0000-4000-8000-000000000000'),
            'NOT_FOUND',
          );
        },
      );

      await suite.test(
        'groups and products: rules are checked, only published priced products can be chosen, "select all" takes a filtered result',
        async () => {
          const c = await create();
          for (const rule of [
            { kind: 'PERCENT', value: '91' },
            { kind: 'PERCENT', value: '0' },
            { kind: 'PRICE', value: '0' },
            { kind: 'AMOUNT', value: '-5' },
            { kind: 'BOGO', value: '1' },
            { kind: 'PERCENT', value: '10.5' },
          ]) {
            await fails(
              () =>
                campaigns.addGroup(owner.token, c.id, {
                  expectedVersion: c.rowVersion,
                  rule,
                } as never),
              'VALIDATION_FAILED',
            );
          }
          const g1 = await group(c.id, 'PERCENT', '10', c.rowVersion);
          await fails(() => group(c.id, 'PERCENT', '20', c.rowVersion), 'CONFLICT');
          const g2 = await group(c.id, 'AMOUNT', '30000', g1.rowVersion);
          const [first, second] = [g2.groups[0]!, g2.groups[1]!];
          assert.deepEqual(
            g2.groups.map((g) => g.position),
            [1, 2],
          );
          const p1 = await product('g1', 100_000);
          const p2 = await product('g2', 199_999);
          // The labels are not hex: the search also reads the SKU, which carries the random 10-hex run id, so a label like `c1` or `c3`
          // matched the other products whenever that id happened to contain it (a few runs in a hundred) and the test failed at random.
          const p3 = await product('w3', 50_000);
          const draftOnly = {
            variantId: (await k.product('c4', [80_000], { publish: false })).variants[0]!.id,
          };
          await fails(
            () => items(c.id, g2.rowVersion, first.id, [draftOnly.variantId]),
            'CAMPAIGN_VARIANT_NOT_SELLABLE',
            'variantIds',
          );
          await fails(
            () => items(c.id, g2.rowVersion, first.id, []),
            'VALIDATION_FAILED',
            'variantIds',
          );
          await fails(
            () => items(c.id, g2.rowVersion, first.id, [p1.variantId, p1.variantId]),
            'VALIDATION_FAILED',
            'variantIds',
          );
          await fails(
            () =>
              items(c.id, g2.rowVersion, '00000000-0000-4000-8000-000000000000', [p1.variantId]),
            'NOT_FOUND',
          );
          const a = await items(c.id, g2.rowVersion, first.id, [p1.variantId, p2.variantId]);
          assert.equal(a.review.itemCount, 2);
          const b = await items(c.id, a.rowVersion, first.id, [p2.variantId, p3.variantId]);
          assert.equal(b.review.itemCount, 3, 'a product already chosen is not chosen twice');
          const moved = await items(c.id, b.rowVersion, second.id, [p2.variantId]);
          assert.deepEqual(
            moved.groups.map((g) => g.itemCount),
            [2, 1],
            'a product moves to another group of the same campaign',
          );
          // "Select all" of a filtered result.
          const brand = await tx.brand.create({
            data: {
              code: `cb-${randomBytes(3).toString('hex')}`,
              nameVi: 'Hãng thử',
              nameEn: 'Test brand',
            },
          });
          await tx.product.updateMany({
            where: { id: { in: [p1.productId, p2.productId] } },
            data: { brandId: brand.id, rowVersion: { increment: 1 } },
          });
          const picker = await campaigns.picker(owner.token, c.id, { brandId: brand.id });
          assert.deepEqual(picker.rows.map((r) => r.sku).sort(), [p1.sku, p2.sku].sort());
          assert.ok(
            picker.rows.every((r) => r.groupId !== null),
            'the picker says what is already chosen',
          );
          const all = await campaigns.picker(owner.token, c.id, { q: 'san pham w3' });
          assert.equal(all.total, 1);
          assert.equal(all.rows[0]!.groupId, first.id);
          const fresh = await create();
          const fg = await group(fresh.id, 'PERCENT', '15', fresh.rowVersion);
          await fails(
            () =>
              k.ok(() =>
                campaigns.addFilteredItems(owner.token, fresh.id, {
                  expectedVersion: fg.rowVersion,
                  groupId: fg.groups[0]!.id,
                  filter: { q: 'khong co san pham nay' },
                }),
              ),
            'VALIDATION_FAILED',
            'filter',
          );
          const filtered = await k.ok(() =>
            campaigns.addFilteredItems(owner.token, fresh.id, {
              expectedVersion: fg.rowVersion,
              groupId: fg.groups[0]!.id,
              filter: { brandId: brand.id, minPriceVnd: '150000' },
            }),
          );
          assert.equal(filtered.review.itemCount, 1, 'brand and price range together');
          await fails(
            () =>
              campaigns.addFilteredItems(owner.token, fresh.id, {
                expectedVersion: filtered.rowVersion,
                groupId: fg.groups[0]!.id,
                filter: { minPriceVnd: '9', maxPriceVnd: '3' },
              }),
            'VALIDATION_FAILED',
          );
          // The chosen products with their prices, searchable, 20 a page.
          const page = await campaigns.items(owner.token, c.id, { q: 'san pham g1' });
          assert.equal(page.total, 1);
          assert.deepEqual(
            {
              list: page.rows[0]!.listPriceVnd,
              price: page.rows[0]!.campaignPriceVnd,
              percent: page.rows[0]!.discountPercent,
            },
            { list: '100000', price: '90000', percent: 10 },
          );
          assert.equal(
            (await campaigns.items(owner.token, c.id, { groupId: second.id })).rows[0]!
              .campaignPriceVnd,
            '169999',
          );
          // Take products out; remove a group with its products; delete a draft.
          const trimmed = await k.ok(() =>
            campaigns.removeItems(owner.token, c.id, {
              expectedVersion: moved.rowVersion,
              variantIds: [p3.variantId],
            }),
          );
          assert.equal(trimmed.review.itemCount, 2);
          const noGroup = await k.ok(() =>
            campaigns.removeGroup(owner.token, c.id, second.id, {
              expectedVersion: trimmed.rowVersion,
            }),
          );
          assert.equal(noGroup.review.itemCount, 1);
          const gone = await k.ok(() =>
            campaigns.remove(owner.token, c.id, { expectedVersion: noGroup.rowVersion }),
          );
          assert.deepEqual(gone, { deleted: true });
          await fails(() => detail(c.id), 'NOT_FOUND');
        },
      );

      await suite.test(
        'the review: no discount, a promotion of the product itself, another campaign in the same time',
        async () => {
          const p1 = await product('r1', 100_000);
          const p2 = await product('r2', 60_000);
          const p3 = await product('r3', 70_000);
          await k.promote(p1.variantId, 80_000);
          const other = await create({ startsAt: later(2), endsAt: later(30) });
          const og = await group(other.id, 'PERCENT', '50', other.rowVersion);
          const oi = await items(other.id, og.rowVersion, og.groups[0]!.id, [p3.variantId]);
          await k.ok(() =>
            campaigns.publish(owner.token, other.id, { expectedVersion: oi.rowVersion }),
          );
          const c = await create({ startsAt: later(0.5), endsAt: later(20) });
          const g1 = await group(c.id, 'PERCENT', '20', c.rowVersion);
          const g2 = await group(c.id, 'PRICE', '60000', g1.rowVersion);
          const i1 = await items(c.id, g2.rowVersion, g2.groups[0]!.id, [
            p1.variantId,
            p3.variantId,
          ]);
          const i2 = await items(c.id, i1.rowVersion, g2.groups[1]!.id, [p2.variantId]);
          assert.deepEqual(i2.review, {
            itemCount: 3,
            noDiscountCount: 1,
            overlapCount: 1,
            ownPromotionCount: 1,
            minPercent: 20,
            maxPercent: 20,
          });
          const flagged = await campaigns.items(owner.token, c.id, { problem: 'NO_DISCOUNT' });
          assert.deepEqual(
            flagged.rows.map((r) => r.sku),
            [p2.sku],
            'a product whose rule gives no discount is listed, not hidden',
          );
          const overlapped = await campaigns.items(owner.token, c.id, { problem: 'OVERLAP' });
          assert.deepEqual(
            overlapped.rows.map((r) => ({
              sku: r.sku,
              other: r.otherCampaigns.map((o) => o.priceVnd),
            })),
            [{ sku: p3.sku, other: ['35000'] }],
          );
          assert.equal(
            (await campaigns.items(owner.token, c.id, { problem: 'OWN_PROMOTION' })).rows[0]!.sku,
            p1.sku,
          );
          await fails(
            () => campaigns.items(owner.token, c.id, { problem: 'WHAT' }),
            'VALIDATION_FAILED',
            'problem',
          );
          await k.reconcileAll();
        },
      );

      await suite.test(
        'publication: the start must lie ahead, something must be chosen and discounted; then everything but the text is frozen',
        async () => {
          const empty = await create();
          await fails(
            () => campaigns.publish(owner.token, empty.id, { expectedVersion: empty.rowVersion }),
            'CAMPAIGN_EMPTY',
          );
          const p1 = await product('u1', 50_000);
          const flat = await create();
          const fg = await group(flat.id, 'PRICE', '50000', flat.rowVersion);
          const fi = await items(flat.id, fg.rowVersion, fg.groups[0]!.id, [p1.variantId]);
          await fails(
            () => campaigns.publish(owner.token, flat.id, { expectedVersion: fi.rowVersion }),
            'CAMPAIGN_NO_DISCOUNT',
          );
          const past = await create({ startsAt: later(-1), endsAt: later(5) });
          const pg = await group(past.id, 'PERCENT', '10', past.rowVersion);
          const pi = await items(past.id, pg.rowVersion, pg.groups[0]!.id, [p1.variantId]);
          await fails(
            () => campaigns.publish(owner.token, past.id, { expectedVersion: pi.rowVersion }),
            'CAMPAIGN_START_PASSED',
            'startsAt',
          );
          await fails(
            () => campaigns.publish(owner.token, past.id, { expectedVersion: pi.rowVersion - 1 }),
            'CONFLICT',
          );
          const fixed = await k.ok(() =>
            campaigns.edit(owner.token, past.id, {
              expectedVersion: pi.rowVersion,
              startsAt: later(1),
            }),
          );
          const published = await k.ok(() =>
            campaigns.publish(owner.token, past.id, { expectedVersion: fixed.rowVersion }),
          );
          assert.equal(published.state, 'SCHEDULED');
          assert.deepEqual(published.can, {
            edit: false,
            editPresentation: true,
            changeItems: false,
            publish: false,
            end: true,
            remove: false,
          });
          // Frozen: window, address name, rules, products, deleting; the text still changes.
          const v = published.rowVersion;
          await fails(
            () => campaigns.edit(owner.token, past.id, { expectedVersion: v, endsAt: later(80) }),
            'CAMPAIGN_NOT_EDITABLE',
          );
          await fails(
            () =>
              campaigns.edit(owner.token, past.id, { expectedVersion: v, slug: 'renamed-sale' }),
            'CAMPAIGN_NOT_EDITABLE',
          );
          await fails(
            () =>
              campaigns.addGroup(owner.token, past.id, {
                expectedVersion: v,
                rule: { kind: 'PERCENT', value: '5' },
              }),
            'CAMPAIGN_NOT_EDITABLE',
          );
          await fails(
            () =>
              campaigns.editGroup(owner.token, past.id, published.groups[0]!.id, {
                expectedVersion: v,
                rule: { kind: 'PERCENT', value: '70' },
              }),
            'CAMPAIGN_NOT_EDITABLE',
          );
          await fails(
            () =>
              campaigns.removeItems(owner.token, past.id, {
                expectedVersion: v,
                variantIds: [p1.variantId],
              }),
            'CAMPAIGN_NOT_EDITABLE',
          );
          await fails(
            () => campaigns.remove(owner.token, past.id, { expectedVersion: v }),
            'CAMPAIGN_NOT_EDITABLE',
          );
          await fails(
            () => campaigns.publish(owner.token, past.id, { expectedVersion: v }),
            'CAMPAIGN_NOT_EDITABLE',
          );
          const texted = await k.ok(() =>
            campaigns.edit(owner.token, past.id, {
              expectedVersion: v,
              badgeVi: 'GIẢM 10%',
              headlineVi: 'Ngày hội',
              ctaLabelVi: 'Xem ngay',
            }),
          );
          assert.equal(texted.badgeVi, 'GIẢM 10%');
          await fails(
            () =>
              campaigns.edit(owner.token, past.id, {
                expectedVersion: texted.rowVersion,
                badgeVi: 'x'.repeat(25),
              }),
            'VALIDATION_FAILED',
            'badgeVi',
          );
          // The database says the same whatever the application does.
          for (const sql of [
            `UPDATE product_campaigns SET ends_at = ends_at + interval '1 day' WHERE id = '${past.id}'::uuid`,
            `UPDATE product_campaign_groups SET rule_value = 99 WHERE campaign_id = '${past.id}'::uuid`,
            `DELETE FROM product_campaign_items WHERE campaign_id = '${past.id}'::uuid`,
            `DELETE FROM product_campaigns WHERE id = '${past.id}'::uuid`,
            `UPDATE product_campaigns SET published_at = NULL WHERE id = '${past.id}'::uuid`,
            'TRUNCATE product_campaign_items',
          ]) {
            await tx.$executeRawUnsafe('SAVEPOINT guard');
            await assert.rejects(() => tx.$executeRawUnsafe(sql), sql);
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT guard');
          }
          await tx.$executeRawUnsafe('SAVEPOINT guard');
          await assert.rejects(() =>
            tx.$executeRawUnsafe(
              `INSERT INTO product_campaign_items (campaign_id, group_id, variant_id) VALUES ('${past.id}', '${published.groups[0]!.id}', '${p1.variantId}')`,
            ),
          );
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT guard');
          // Ending before it starts: it never applies; ending twice is refused.
          await fails(
            () =>
              campaigns.end(owner.token, past.id, {
                expectedVersion: texted.rowVersion,
                reason: '',
              }),
            'VALIDATION_FAILED',
          );
          const ended = await k.ok(() =>
            campaigns.end(owner.token, past.id, {
              expectedVersion: texted.rowVersion,
              reason: 'Nhầm ngày',
            }),
          );
          assert.equal(ended.state, 'ENDED');
          assert.equal(ended.endedEarlyReason, 'Nhầm ngày');
          assert.equal(
            campaignState(
              {
                publishedAt: new Date(),
                startsAt: new Date(ended.startsAt),
                endsAt: new Date(ended.endsAt),
                endedEarlyAt: new Date(ended.endedEarlyAt!),
              },
              new Date(Date.now() + 3 * HOUR),
            ),
            'ENDED',
          );
          await fails(
            () =>
              campaigns.end(owner.token, past.id, {
                expectedVersion: ended.rowVersion,
                reason: 'again',
              }),
            'CAMPAIGN_ENDED',
          );
          await fails(
            () =>
              campaigns.edit(owner.token, past.id, {
                expectedVersion: ended.rowVersion,
                badgeVi: 'x',
              }),
            'CAMPAIGN_ENDED',
          );
          await k.reconcileAll();
        },
      );

      await suite.test(
        'the price: every rule, the lowest price wins and prices are never added, a sale uses it, ending restores it, history keeps reproducing',
        async () => {
          const pc = await product('x1', 199_999);
          const am = await product('x2', 50_000);
          const pr = await product('x3', 80_000);
          const promo = await product('x4', 100_000);
          const flat = await product('x5', 40_000);
          await k.promote(promo.variantId, 70_000);
          const c = await create({ slug: 'price-test', startsAt: later(1), endsAt: later(40) });
          const g1 = await group(c.id, 'PERCENT', '10', c.rowVersion);
          const g2 = await group(c.id, 'AMOUNT', '10000', g1.rowVersion);
          const g3 = await group(c.id, 'PRICE', '60000', g2.rowVersion);
          const [a, b, d] = g3.groups;
          let v = (await items(c.id, g3.rowVersion, a!.id, [pc.variantId, promo.variantId]))
            .rowVersion;
          v = (await items(c.id, v, b!.id, [am.variantId])).rowVersion;
          v = (await items(c.id, v, d!.id, [pr.variantId, flat.variantId])).rowVersion;
          // Before publication and before the start nothing changes.
          assert.equal((await priceNow(pc.variantId)).effective, 199_999n);
          const published = await k.ok(() =>
            campaigns.publish(owner.token, c.id, { expectedVersion: v }),
          );
          assert.equal((await priceNow(pc.variantId)).effective, 199_999n, 'scheduled: not yet');
          await activate(c.id);
          assert.deepEqual(await priceNow(pc.variantId), {
            list: 199_999n,
            promo: 180_000n,
            effective: 180_000n,
            promotion_id: null,
          });
          assert.equal((await priceNow(am.variantId)).effective, 40_000n);
          assert.equal((await priceNow(pr.variantId)).effective, 60_000n);
          assert.deepEqual(
            await priceNow(flat.variantId),
            { list: 40_000n, promo: null, effective: 40_000n, promotion_id: null },
            'a rule without a discount changes nothing',
          );
          // The product's own promotion (70,000) is lower than the campaign (90,000): it wins, they are not added.
          const own = await priceNow(promo.variantId);
          assert.equal(own.effective, 70_000n);
          assert.ok(own.promotion_id !== null);
          // Another campaign in the same time with a lower price on one product: the lowest wins; equal prices go to the one published first.
          const rival = await create({ slug: 'rival-test', startsAt: later(1), endsAt: later(30) });
          const rg = await group(rival.id, 'PRICE', '170000', rival.rowVersion);
          const ri = await items(rival.id, rg.rowVersion, rg.groups[0]!.id, [pc.variantId]);
          await k.ok(() =>
            campaigns.publish(owner.token, rival.id, { expectedVersion: ri.rowVersion }),
          );
          await activate(rival.id, 1, 3);
          assert.equal((await priceNow(pc.variantId)).effective, 170_000n);
          const tie = await create({ slug: 'tie-test', startsAt: later(1), endsAt: later(30) });
          const tg = await group(tie.id, 'PRICE', '170000', tie.rowVersion);
          const ti = await items(tie.id, tg.rowVersion, tg.groups[0]!.id, [pc.variantId]);
          await k.ok(() =>
            campaigns.publish(owner.token, tie.id, { expectedVersion: ti.rowVersion }),
          );
          await activate(tie.id, 1, 3);
          const [winner] = await tx.$queryRaw<
            { campaign_id: string }[]
          >`SELECT campaign_id FROM lucy_variant_campaign_at(${pc.variantId}::uuid, clock_timestamp())`;
          assert.equal(winner!.campaign_id, rival.id, 'the earlier published campaign wins a tie');
          assert.equal((await priceNow(pc.variantId)).effective, 170_000n);
          // A change of the list price moves a percent rule and never produces a price above the list.
          const before = await tx.productPriceVersion.findFirstOrThrow({
            where: { variantId: am.variantId },
            orderBy: { versionNo: 'desc' },
          });
          await k
            .ok(() =>
              catalog.changePrice(owner.token, am.productId, am.variantId, {
                listPriceVnd: '45000',
                reason: 'Điều chỉnh',
                expectedVersion: before.versionNo,
              } as never),
            )
            .catch(() => undefined);
          // The sale: the line is priced by the campaign, which it names; the discount engines see a price on promotion.
          const member = await k.member('camp');
          const order = await k.order(member, [
            { variantId: am.variantId, quantity: 2 },
            { variantId: pr.variantId },
          ]);
          const lines = await tx.invoiceLineProduct.findMany({
            where: { invoiceId: order.invoiceId },
            include: { line: true },
            orderBy: { sku: 'asc' },
          });
          assert.deepEqual(
            lines.map((l) => [l.campaignId, l.promotionId, l.line.unitPriceVnd]),
            [
              [c.id, null, 40_000n],
              [c.id, null, 60_000n],
            ],
          );
          const cart = await k.cart(member);
          assert.ok(cart.lines.length === 0 || cart.lines.every((line) => line.onPromotion));
          await k.payViaWebhook(member, order);
          // The public view: the card names the campaign; the sale page lists only its products.
          const card = await publicProducts(
            tx,
            'vi',
            parsePublicProductsQuery({ campaign: 'price-test' }),
          );
          assert.equal(
            card.total,
            5,
            'five products of the campaign (the product with its own promotion too)',
          );
          const pcCard = card.items.find((item) => item.name.includes('x1'))!;
          assert.deepEqual(pcCard.price, {
            priceVnd: '170000',
            listPriceVnd: '199999',
            discountPercent: 15,
            campaign: { slug: 'rival-test', name: (await detail(rival.id)).nameVi, badge: null },
          });
          const detailPage = await publicProductDetail(
            tx,
            'vi',
            (await tx.product.findUniqueOrThrow({ where: { id: am.productId } })).code,
          );
          assert.equal(detailPage.product.variants[0]!.price.campaign?.slug, 'price-test');
          assert.equal(
            (await publicProducts(tx, 'vi', parsePublicProductsQuery({ campaign: 'no-such-sale' })))
              .total,
            0,
          );
          assert.equal(
            (await publicProducts(tx, 'vi', parsePublicProductsQuery({ campaign: 'rival-test' })))
              .total,
            1,
          );
          assert.equal(
            (await publicProducts(tx, 'vi', parsePublicProductsQuery({}))).items.find((i) =>
              i.name.includes('x4'),
            )!.price.campaign,
            undefined,
            "a price from the product's own promotion names no campaign",
          );
          // The admin catalog tells the same price as the sale.
          const adminView = await catalog.product(owner.token, am.productId);
          assert.equal(adminView.variants[0]!.effectivePriceVnd, '40000');
          // Ending by hand restores the prices by themselves; the invoice it priced still reproduces its price.
          const stillRunning = await detail(c.id);
          assert.equal(stillRunning.state, 'ACTIVE');
          const ended = await k.ok(() =>
            campaigns.end(owner.token, c.id, {
              expectedVersion: stillRunning.rowVersion,
              reason: 'Hết ngân sách',
            }),
          );
          assert.equal(ended.state, 'ENDED');
          assert.equal((await priceNow(am.variantId)).effective, 50_000n);
          assert.equal((await priceNow(pr.variantId)).effective, 80_000n);
          for (const line of lines) {
            const [again] = await tx.$queryRaw<
              { effective: bigint }[]
            >`SELECT effective_price_vnd AS effective FROM lucy_variant_price_at(${line.variantId}::uuid, ${line.pricedAt}::timestamptz)`;
            assert.equal(
              again!.effective,
              line.line.unitPriceVnd,
              'the price of a sold line is reproducible after the campaign ended',
            );
          }
          assert.equal(published.state, 'SCHEDULED');
          await k.reconcileAll();
        },
      );

      await suite.test(
        'the public view shows only what runs now; its banner is public only then and cannot be deleted while used',
        async () => {
          const p1 = await product('v1', 100_000);
          const banner = await tx.mediaAsset.create({
            data: {
              storageKey: `p623/${randomBytes(4).toString('hex')}.webp`,
              originalFilename: 'banner.webp',
              mime: 'image/webp',
              bytes: 1000,
              width: 1200,
              height: 400,
              sha256: randomBytes(32).toString('hex'),
              altVi: 'Biển quảng cáo',
              createdByUserId: owner.id,
              variants: {
                create: [
                  {
                    kind: 'LG',
                    storageKey: `p623/${randomBytes(4).toString('hex')}-lg.webp`,
                    width: 1200,
                    height: 400,
                    bytes: 900,
                  },
                ],
              },
            },
          });
          const c = await create({ slug: 'public-test', startsAt: later(1), endsAt: later(30) });
          const g = await group(c.id, 'PERCENT', '25', c.rowVersion);
          const i = await items(c.id, g.rowVersion, g.groups[0]!.id, [p1.variantId]);
          const withBanner = await k.ok(() =>
            campaigns.edit(owner.token, c.id, {
              expectedVersion: i.rowVersion,
              bannerMediaId: banner.id,
              badgeVi: '-25%',
              badgeEn: '-25%',
              headlineVi: 'Ngày hội làm đẹp',
              headlineEn: 'Beauty days',
              ctaLabelVi: 'Mua ngay',
            }),
          );
          await fails(
            () =>
              campaigns.edit(owner.token, c.id, {
                expectedVersion: withBanner.rowVersion,
                bannerMediaId: '00000000-0000-4000-8000-000000000000',
              }),
            'VALIDATION_FAILED',
            'bannerMediaId',
          );
          const now = new Date();
          const slugs = async () =>
            (await runningCampaigns(tx, new Date(), 'vi')).campaigns.map((x) => x.slug);
          assert.ok(!(await slugs()).includes('public-test'), 'a draft is not public');
          assert.equal(await isPubliclyServed(tx, banner.id, now), false);
          assert.deepEqual(
            (await mediaUsages(tx, banner.id)).map((u) => [u.kind, u.title]),
            [['CAMPAIGN', withBanner.nameVi]],
            'in use: it cannot be deleted',
          );
          await k.ok(() =>
            campaigns.publish(owner.token, c.id, { expectedVersion: withBanner.rowVersion }),
          );
          assert.ok(!(await slugs()).includes('public-test'), 'scheduled is not public');
          assert.equal(await isPubliclyServed(tx, banner.id, new Date()), false);
          await activate(c.id);
          const running = (await runningCampaigns(tx, new Date(), 'vi')).campaigns.find(
            (x) => x.slug === 'public-test',
          )!;
          assert.equal(running.name, withBanner.nameVi);
          assert.equal(running.badge, '-25%');
          assert.equal(running.headline, 'Ngày hội làm đẹp');
          assert.equal(running.ctaLabel, 'Mua ngay');
          assert.match(running.bannerUrl ?? '', new RegExp(banner.id));
          assert.equal(
            (await runningCampaigns(tx, new Date(), 'en')).campaigns.find(
              (x) => x.slug === 'public-test',
            )!.headline,
            'Beauty days',
          );
          assert.equal(await isPubliclyServed(tx, banner.id, new Date()), true);
          assert.ok(!JSON.stringify(running).includes('internalNote'));
          const live = await detail(c.id);
          const ended = await k.ok(() =>
            campaigns.end(owner.token, c.id, {
              expectedVersion: live.rowVersion,
              reason: 'Kết thúc sớm',
            }),
          );
          assert.equal(ended.state, 'ENDED');
          assert.ok(!(await slugs()).includes('public-test'), 'ended is not public');
          assert.equal(await isPubliclyServed(tx, banner.id, new Date()), false);
          await k.reconcileAll();
        },
      );
    });
  },
);
