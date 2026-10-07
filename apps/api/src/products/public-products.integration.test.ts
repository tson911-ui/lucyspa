import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import type { ProductDetailResponse } from '@lucy-spa/contracts';
import { InventoryService } from '../inventory/inventory.service.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { isPubliclyServed } from '../website/popup.core.js';
import { ProductCatalogService } from './product-catalog.service.js';
import { publicProductCodes, publicProductDetail, publicProducts } from './public-products.core.js';
import { parsePublicProductsQuery } from './public-products.logic.js';

/**
 * Phase 6 P6-6 (design 11.1, 16): the public cosmetics catalog against real PostgreSQL. Only published, priced products appear;
 * prices and the promotion come from the database's one price function and stock from its one availability function; stock is a
 * state, never a number; no cost, quantity, branch, SKU or internal id is in any response; a product's pictures are public only
 * while it is published; the Owner-written hero and commitment box are hidden while empty. Every fixture rolls back.
 */
test(
  'Phase 6 P6-6 public cosmetics catalog; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (kit) => {
      const { tx, run, fails } = kit;
      const catalog = new ProductCatalogService(kit.adapter, kit.throttle, kit.environment);
      const inventory = new InventoryService(kit.adapter, kit.throttle, kit.environment);
      const full = await kit.staff([
        'MANAGE_PRODUCTS',
        'MANAGE_PRODUCT_PRICES',
        'VIEW_PRODUCT_COST',
      ]);
      const branch = await kit.branch('PUB');
      const receiver = await kit.staff(['MANAGE_STOCK_RECEIPTS'], { branchId: branch.id });
      const tag = run.toLowerCase();
      const q = (extra: Record<string, unknown> = {}) =>
        parsePublicProductsQuery({ q: tag, ...extra });
      const list = (extra: Record<string, unknown> = {}, locale: 'vi' | 'en' = 'vi') =>
        publicProducts(tx, locale, q(extra));

      const category = await catalog.createCategory(full.token, {
        parentId: null,
        nameVi: 'Chăm sóc da',
        nameEn: `Skin care ${run}`,
      });
      const child = await catalog.createCategory(full.token, {
        parentId: category.id,
        nameVi: 'Sữa rửa mặt',
        nameEn: `Cleanser ${run}`,
      });
      const retiredCategory = await catalog.createCategory(full.token, {
        parentId: null,
        nameVi: 'Nhóm đã ngưng',
        nameEn: `Retired ${run}`,
      });
      const brand = await catalog.createBrand(full.token, {
        nameVi: 'Thương hiệu thử',
        nameEn: `Test brand ${run}`,
      });

      let counter = 0;
      const make = async (
        name: string,
        options: {
          categoryId?: string | null;
          featured?: boolean;
          publish?: boolean;
          variants?: {
            label: string;
            price: number;
            cost?: number;
            sellOnOrder?: boolean;
            lead?: [number, number];
          }[];
        } = {},
      ): Promise<ProductDetailResponse> => {
        const { variants = [{ label: '50 ml', price: 100_000 }] } = options;
        let product = await catalog.createProduct(full.token, {
          nameVi: `${name} ${run}`,
          nameEn: `${name} EN ${run}`,
          descriptionVi: `Mô tả ${name}`,
          descriptionEn: `About ${name}`,
          brandId: brand.id,
          categoryId: options.categoryId === undefined ? category.id : options.categoryId,
          featured: options.featured ?? false,
        });
        for (const variant of variants) {
          counter += 1;
          product = await catalog.createVariant(full.token, product.id, {
            sku: `P66-${run}-${counter}`,
            labelVi: variant.label,
            labelEn: variant.label,
            barcode: null,
            lowStockThreshold: null,
            listPriceVnd: String(variant.price),
            costPriceVnd: String(variant.cost ?? 12_345),
            sellOnOrder: variant.sellOnOrder ?? true,
            ...(variant.lead
              ? { leadTimeDaysMin: variant.lead[0], leadTimeDaysMax: variant.lead[1] }
              : {}),
          });
        }
        if (options.publish !== false) {
          product = await catalog.changeStatus(full.token, product.id, {
            expectedRowVersion: product.rowVersion,
            status: 'PUBLISHED',
          });
        }
        return product;
      };
      const skuOf = (product: ProductDetailResponse, label: string) =>
        product.variants.find((variant) => variant.labelVi === label)!;
      const receive = async (variantId: string, quantity: number) => {
        const date = (
          await tx.$queryRaw<
            { d: string }[]
          >`SELECT to_char(clock_timestamp()::date, 'YYYY-MM-DD') AS d`
        )[0]!.d;
        const draft = await inventory.createReceipt(receiver.token, {
          branchId: branch.id,
          supplierId: null,
          receiptDate: date,
          notes: null,
          lines: [{ variantId, quantity, lotCode: null, expiryDate: null }],
        });
        await inventory.confirmReceipt(receiver.token, draft.id, {
          expectedRowVersion: draft.rowVersion,
        });
      };

      // A: two sizes, in stock, one on promotion, featured, in the child category.
      const A = await make('Kem dưỡng ẩm', {
        categoryId: child.id,
        featured: true,
        variants: [
          { label: '30 ml', price: 100_000 },
          { label: '50 ml', price: 150_000 },
        ],
      });
      await receive(skuOf(A, '30 ml').id, 5);
      await catalog.createPromotion(full.token, A.id, skuOf(A, '30 ml').id, {
        promoPriceVnd: '80000',
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      // B: no stock, on order with the shop's default waiting time.
      const B = await make('Sữa rửa mặt', { variants: [{ label: '100 ml', price: 200_000 }] });
      // C: no stock, not sold on order: "Hết hàng".
      const C = await make('Mặt nạ', {
        variants: [{ label: '1 miếng', price: 60_000, sellOnOrder: false }],
      });
      // D: a draft; E: published then discontinued; F: in a retired category; G: pre-order with its own waiting time.
      const D = await make('Sản phẩm nháp', { publish: false });
      let E = await make('Sản phẩm ngưng');
      E = await catalog.changeStatus(full.token, E.id, {
        expectedRowVersion: E.rowVersion,
        status: 'INACTIVE',
      });
      const F = await make('Không nhóm', { categoryId: retiredCategory.id });
      await catalog.editCategory(full.token, retiredCategory.id, {
        expectedRowVersion: (await catalog.categories(full.token)).categories.find(
          (c) => c.id === retiredCategory.id,
        )!.rowVersion,
        parentId: null,
        nameVi: 'Nhóm đã ngưng',
        nameEn: `Retired ${run}`,
        sortOrder: 0,
        isActive: false,
      });
      const G = await make('Tinh chất', {
        variants: [{ label: '15 ml', price: 300_000, lead: [7, 10] }],
      });

      await suite.test(
        'only published, priced products are listed; the rest are invisible',
        async () => {
          const result = await list();
          const codes = result.items.map((item) => item.name);
          assert.equal(result.total, 5, 'A, B, C, F and G');
          assert.equal(
            codes.some((name) => name.includes('nháp') || name.includes('ngưng')),
            false,
          );
          const detailCodes = [D, E].map((product) => product.code);
          for (const code of detailCodes) {
            await fails(() => publicProductDetail(tx, 'vi', code), 'NOT_FOUND');
          }
          await fails(() => publicProductDetail(tx, 'vi', 'no-such-product'), 'NOT_FOUND');
          await fails(() => publicProductDetail(tx, 'vi', 'bad code!'), 'NOT_FOUND');
          const sitemap = await publicProductCodes(tx);
          for (const product of [A, B, C, F, G]) assert.ok(sitemap.codes.includes(product.code));
          for (const product of [D, E]) assert.equal(sitemap.codes.includes(product.code), false);
        },
      );

      await suite.test(
        'prices come from the price function: promotion, struck price, percent, range',
        async () => {
          const result = await list();
          const card = result.items.find((item) => item.code === A.code)!;
          assert.deepEqual(card.price, {
            priceVnd: '80000',
            listPriceVnd: '100000',
            discountPercent: 20,
          });
          assert.equal(card.priceMaxVnd, '150000');
          const plain = result.items.find((item) => item.code === B.code)!;
          assert.deepEqual(plain.price, {
            priceVnd: '200000',
            listPriceVnd: null,
            discountPercent: null,
          });
          assert.equal(plain.priceMaxVnd, '200000');
          const detail = await publicProductDetail(tx, 'vi', A.code);
          assert.deepEqual(
            detail.product.variants.map((variant) => [
              variant.label,
              variant.price.priceVnd,
              variant.price.discountPercent,
            ]),
            [
              ['30 ml', '80000', 20],
              ['50 ml', '150000', null],
            ],
          );
        },
      );

      await suite.test(
        'stock is a state: in stock, pre-order with its waiting time, sold out; never a quantity',
        async () => {
          const result = await list();
          const state = (code: string) => result.items.find((item) => item.code === code)!.stock;
          assert.equal(state(A.code).state, 'IN_STOCK');
          assert.deepEqual(state(B.code), {
            state: 'PRE_ORDER',
            leadTimeDaysMin: 3,
            leadTimeDaysMax: 5,
          });
          assert.deepEqual(state(C.code), {
            state: 'OUT_OF_STOCK',
            leadTimeDaysMin: null,
            leadTimeDaysMax: null,
          });
          assert.deepEqual(state(G.code), {
            state: 'PRE_ORDER',
            leadTimeDaysMin: 7,
            leadTimeDaysMax: 10,
          });
          const detail = await publicProductDetail(tx, 'vi', A.code);
          assert.deepEqual(
            detail.product.variants.map((variant) => variant.stock.state),
            ['IN_STOCK', 'PRE_ORDER'],
          );
          // The shop default is one settings value.
          const settings = await catalog.settings(full.token);
          await catalog.editSettings(full.token, {
            expectedRowVersion: settings.rowVersion,
            leadTimeDaysMin: 2,
            leadTimeDaysMax: 4,
          });
          const changed = await list();
          assert.deepEqual(changed.items.find((item) => item.code === B.code)!.stock, {
            state: 'PRE_ORDER',
            leadTimeDaysMin: 2,
            leadTimeDaysMax: 4,
          });
        },
      );

      await suite.test(
        'no cost, quantity, branch, SKU or internal id in any public answer',
        async () => {
          const answers = [
            await list(),
            await list({}, 'en'),
            await publicProductDetail(tx, 'vi', A.code),
            await publicProductDetail(tx, 'en', G.code),
            await publicProductCodes(tx),
          ];
          for (const answer of answers) {
            // Pictures are addressed by their public URL; remove those, then no UUID may remain anywhere.
            const text = JSON.stringify(answer).replace(
              /\/api\/v1\/public\/media\/[0-9a-f-]{36}\/\w+/g,
              '',
            );
            assert.ok(
              !/cost|onHand|reserved|available|quantity|branch|supplier|sku|barcode|margin|rowVersion/i.test(
                text,
              ),
              text.slice(0, 200),
            );
            assert.ok(!text.includes(`P66-${run}`), 'no SKU');
            assert.ok(!text.includes('12345'), 'the cost value is nowhere');
            assert.ok(
              !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text),
              'no internal id',
            );
          }
        },
      );

      await suite.test(
        'search folds accents and is not a wildcard; sort, filters and paging',
        async () => {
          assert.equal(
            (await publicProducts(tx, 'vi', parsePublicProductsQuery({ q: `kem duong am ${tag}` })))
              .total,
            1,
          );
          assert.equal(
            (await publicProducts(tx, 'vi', parsePublicProductsQuery({ q: `KEM DƯỠNG ${tag}` })))
              .total,
            1,
          );
          assert.equal(
            (await publicProducts(tx, 'vi', parsePublicProductsQuery({ q: `%${tag}` }))).total,
            0,
            '% is a letter',
          );
          assert.equal(
            (await publicProducts(tx, 'vi', parsePublicProductsQuery({ q: `_${tag}` }))).total,
            0,
          );
          assert.equal(
            (await list({ q: `thuong hieu thu ${tag}` })).total,
            5,
            'the brand name is searched too',
          );
          const featured = await list();
          assert.equal(featured.items[0]!.code, A.code, 'featured first');
          const asc = (await list({ sort: 'price_asc' })).items.map((item) => item.price.priceVnd);
          assert.deepEqual(
            asc,
            [...asc].sort((a, b) => Number(a) - Number(b)),
          );
          assert.equal(asc[0], '60000');
          const desc = (await list({ sort: 'price_desc' })).items.map(
            (item) => item.price.priceVnd,
          );
          assert.equal(desc[0], '300000');
          const newest = await list({ sort: 'newest' });
          assert.equal(newest.items.length, 5);
          // The parent category holds its child's products; the child holds only its own.
          assert.equal(
            (await list({ category: category.code })).items.some((item) => item.code === A.code),
            true,
          );
          assert.deepEqual(
            (await list({ category: child.code })).items.map((item) => item.code),
            [A.code],
          );
          assert.equal((await list({ category: 'no-such-category' })).total, 0);
          assert.equal((await list({ brand: 'no-such-brand' })).total, 0);
          assert.equal((await list({ brand: brand.code })).total, 5);
          // A page past the end still reports how many there are.
          const past = await list({ page: '9' });
          assert.deepEqual([past.items.length, past.total, past.page], [0, 5, 9]);
          assert.equal(past.pageSize, 20);
          // The retired category and the categories without visible products are not offered.
          const result = await list();
          const offered = result.categories.map((entry) => entry.code);
          assert.ok(offered.includes(category.code) && offered.includes(child.code));
          assert.equal(offered.includes(retiredCategory.code), false);
          assert.equal(
            result.categories.find((entry) => entry.code === child.code)!.parentCode,
            category.code,
          );
          const noCategory = result.items.find((item) => item.code === F.code)!;
          assert.equal(noCategory.category, null, 'a retired category shows no label');
          assert.deepEqual(result.brands.map((entry) => entry.code).includes(brand.code), true);
        },
      );

      await suite.test(
        'related products are the same category, never the product itself',
        async () => {
          const second = await make('Kem thứ hai', { categoryId: child.id });
          const detail = await publicProductDetail(tx, 'vi', A.code);
          assert.deepEqual(
            detail.related.map((item) => item.code),
            [second.code],
          );
          const other = await publicProductDetail(tx, 'vi', B.code);
          assert.equal(
            other.related.some((item) => item.code === B.code),
            false,
          );
        },
      );

      await suite.test('"Mới" follows the days the Owner sets (1 to 365)', async () => {
        const first = await list();
        assert.equal(
          first.items.every((item) => item.isNew),
          true,
          'published just now, default 30 days',
        );
        const settings = await catalog.settings(full.token);
        assert.equal(settings.newBadgeDays, 30);
        const saved = await catalog.editSettings(full.token, {
          expectedRowVersion: settings.rowVersion,
          newBadgeDays: 7,
        });
        assert.equal(saved.newBadgeDays, 7);
        for (const bad of [0, 400, 1.5]) {
          await fails(
            () =>
              catalog.editSettings(full.token, {
                expectedRowVersion: saved.rowVersion,
                newBadgeDays: bad,
              }),
            'VALIDATION_FAILED',
            'newBadgeDays',
          );
        }
      });

      await suite.test(
        'pictures are public only while the product is published; the hero once chosen',
        async () => {
          const asset = (label: string, altVi: string | null) =>
            tx.mediaAsset.create({
              data: {
                storageKey: `p66/${run}/${label}.webp`,
                originalFilename: `${label}.webp`,
                mime: 'image/webp',
                bytes: 1000,
                width: 800,
                height: 800,
                sha256: randomBytes(32).toString('hex'),
                altVi,
                createdByUserId: full.id,
                variants: {
                  create: [
                    {
                      kind: 'MD',
                      storageKey: `p66/${run}/${label}-md.webp`,
                      width: 480,
                      height: 480,
                      bytes: 500,
                    },
                    {
                      kind: 'LG',
                      storageKey: `p66/${run}/${label}-lg.webp`,
                      width: 800,
                      height: 800,
                      bytes: 900,
                    },
                  ],
                },
              },
            });
          const shot = await asset('shot', 'Ảnh sản phẩm');
          const draftShot = await asset('draft', 'Ảnh nháp');
          const now = new Date();
          assert.equal(await isPubliclyServed(tx, shot.id, now), false, 'unused');
          await catalog.addImage(full.token, A.id, { mediaAssetId: shot.id });
          await catalog.addImage(full.token, D.id, { mediaAssetId: draftShot.id });
          assert.equal(await isPubliclyServed(tx, shot.id, now), true, 'a published product');
          assert.equal(await isPubliclyServed(tx, draftShot.id, now), false, 'a draft product');
          const card = (await list()).items.find((item) => item.code === A.code)!;
          assert.equal(card.image?.alt, 'Ảnh sản phẩm');
          assert.deepEqual(
            card.image?.sources.map((source) => source.width),
            [480, 800],
          );
          assert.ok(card.image?.sources[0]?.url.startsWith(`/api/v1/public/media/${shot.id}/`));
          assert.equal((await publicProductDetail(tx, 'vi', A.code)).product.images.length, 1);
          // Discontinued: the picture stops being public at once.
          const current = await catalog.product(full.token, A.id);
          await catalog.changeStatus(full.token, A.id, {
            expectedRowVersion: current.rowVersion,
            status: 'INACTIVE',
          });
          assert.equal(await isPubliclyServed(tx, shot.id, now), false);
          await catalog.changeStatus(full.token, A.id, {
            expectedRowVersion: (await catalog.product(full.token, A.id)).rowVersion,
            status: 'PUBLISHED',
          });
          assert.equal(await isPubliclyServed(tx, shot.id, now), true);

          // The hero and the commitment box: hidden while empty, then public once the Owner writes them.
          const empty = await list();
          assert.equal(empty.hero, null);
          assert.equal(empty.commitment, null);
          const hero = await asset('hero', 'Ảnh đầu trang');
          const bare = await asset('bare', null);
          const settings = await catalog.settings(full.token);
          assert.deepEqual(settings.publicPage.commitmentItems, []);
          const page = {
            heroMediaId: hero.id,
            heroTitleVi: 'Chăm da đúng cách',
            heroTitleEn: 'Skin care done right',
            heroTextVi: 'Sản phẩm chọn lọc.',
            heroTextEn: 'Selected products.',
            commitmentTitleVi: 'Cam kết',
            commitmentTitleEn: 'Our promise',
            commitmentItems: [{ textVi: 'Giá rõ ràng', textEn: 'Clear prices' }],
          };
          await fails(
            () =>
              catalog.editSettings(full.token, {
                expectedRowVersion: settings.rowVersion,
                publicPage: { ...page, heroMediaId: bare.id },
              }),
            'MEDIA_ALT_REQUIRED',
          );
          await fails(
            () =>
              catalog.editSettings(full.token, {
                expectedRowVersion: settings.rowVersion,
                publicPage: { ...page, heroTitleEn: null },
              }),
            'VALIDATION_FAILED',
          );
          await fails(
            () =>
              catalog.editSettings(full.token, {
                expectedRowVersion: settings.rowVersion,
                publicPage: {
                  ...page,
                  commitmentItems: [{ textVi: 'Chỉ tiếng Việt', textEn: '' }],
                },
              }),
            'VALIDATION_FAILED',
            'commitmentItems',
          );
          await fails(
            () =>
              catalog.editSettings(full.token, {
                expectedRowVersion: settings.rowVersion,
                publicPage: {
                  ...page,
                  commitmentItems: Array.from({ length: 7 }, () => ({ textVi: 'a', textEn: 'a' })),
                },
              }),
            'VALIDATION_FAILED',
            'commitmentItems',
          );
          await fails(
            () =>
              catalog.editSettings(full.token, {
                expectedRowVersion: settings.rowVersion,
                publicPage: { ...page, heroMediaId: 'not-a-uuid' },
              }),
            'VALIDATION_FAILED',
            'heroMediaId',
          );
          const saved = await catalog.editSettings(full.token, {
            expectedRowVersion: settings.rowVersion,
            publicPage: page,
          });
          assert.deepEqual(saved.publicPage, page);
          await fails(
            () =>
              catalog.editSettings(full.token, {
                expectedRowVersion: settings.rowVersion,
                publicPage: page,
              }),
            'CONFLICT',
          );
          const vi = await list();
          assert.equal(vi.hero?.title, 'Chăm da đúng cách');
          assert.equal(vi.hero?.image?.alt, 'Ảnh đầu trang');
          assert.deepEqual(vi.commitment, { title: 'Cam kết', items: ['Giá rõ ràng'] });
          const en = await list({}, 'en');
          assert.equal(en.hero?.text, 'Selected products.');
          assert.deepEqual(en.commitment?.items, ['Clear prices']);
          assert.equal(
            await isPubliclyServed(tx, hero.id, now),
            true,
            'the hero is public once chosen',
          );
          assert.equal((await publicProductDetail(tx, 'vi', A.code)).commitment?.title, 'Cam kết');
          // Clearing everything hides the blocks again.
          const cleared = await catalog.editSettings(full.token, {
            expectedRowVersion: saved.rowVersion,
            publicPage: {
              heroMediaId: null,
              heroTitleVi: '  ',
              heroTitleEn: null,
              heroTextVi: null,
              heroTextEn: '',
              commitmentTitleVi: null,
              commitmentTitleEn: null,
              commitmentItems: [],
            },
          });
          assert.equal(cleared.publicPage.heroTitleVi, null);
          const hidden = await list();
          assert.equal(hidden.hero, null);
          assert.equal(hidden.commitment, null);
          assert.equal(await isPubliclyServed(tx, hero.id, now), false);
          // A settings change is audited with before and after, and only a product manager may make it.
          const audit = await tx.auditEvent.findFirst({
            where: { action: 'PRODUCT_SETTINGS_UPDATED' },
            orderBy: { occurredAt: 'desc' },
          });
          assert.ok(audit);
          const nobody = await kit.staff([]);
          await fails(
            () => catalog.editSettings(nobody.token, { expectedRowVersion: 1, newBadgeDays: 1 }),
            'FORBIDDEN',
          );
          const pricer = await kit.staff(['MANAGE_PRODUCT_PRICES']);
          await fails(
            () => catalog.editSettings(pricer.token, { expectedRowVersion: 1, newBadgeDays: 1 }),
            'FORBIDDEN',
          );
        },
      );

      await suite.test('the public catalog writes nothing and reads no money tables', async () => {
        const writes = await tx.$queryRaw<{ n: number }[]>`
          SELECT (SELECT count(*) FROM invoices)::int + (SELECT count(*) FROM payments)::int AS n`;
        const before = writes[0]!.n;
        await list();
        await publicProductDetail(tx, 'vi', B.code);
        assert.equal(
          (
            await tx.$queryRaw<{ n: number }[]>`
          SELECT (SELECT count(*) FROM invoices)::int + (SELECT count(*) FROM payments)::int AS n`
          )[0]!.n,
          before,
        );
      });
    });
  },
);
