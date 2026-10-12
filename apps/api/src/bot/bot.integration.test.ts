import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DiscountCreateRequest } from '@lucy-spa/contracts';
import pino from 'pino';
import { DiscountService } from '../discounts/discount.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { ProductCatalogService } from '../products/product-catalog.service.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { PublicWebsiteService } from '../website/popup.service.js';
import { foreignKeys } from './bot.serializers.js';
import { BotDataService, BotError } from './bot.service.js';

/**
 * Claude integration Wave A (CI-B1) against real PostgreSQL: what the chat bot may read. A program is mentioned only when the Owner
 * ticked it, it has no code, it is active, not terminated and inside its dates; the tick is MANAGE_DISCOUNTS, audited, refused for a
 * code program; products come from the public catalog (published and priced only, stock as a state); every answer carries only
 * allow-listed keys and no cost, SKU, quantity or internal id; the availability endpoint refuses bad input before reading anything.
 * Fixtures roll back.
 */
test(
  'Claude integration Wave A bot data: promotions rules, the tick, products, allow-listed answers, availability input; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (kit) => {
      const { tx, run, fails } = kit;
      const discounts = new DiscountService(kit.adapter, kit.throttle);
      const catalog = new ProductCatalogService(kit.adapter, kit.throttle, kit.environment);
      const inventory = new InventoryService(kit.adapter, kit.throttle, kit.environment);
      const website = new PublicWebsiteService(kit.adapter, kit.throttle, {} as never);
      const prisma = { client: tx } as unknown as PrismaService;
      const bot = new BotDataService(kit.environment, pino({ level: 'silent' }), prisma, website);
      const manager = await kit.staff(['MANAGE_DISCOUNTS']);
      const nobody = await kit.staff([]);
      const full = await kit.staff([
        'MANAGE_PRODUCTS',
        'MANAGE_PRODUCT_PRICES',
        'VIEW_PRODUCT_COST',
      ]);
      await kit.branch('BOT');
      void inventory;
      const q = (entries: Record<string, string> = {}) => new URLSearchParams(entries);
      const day = 86_400_000;
      const version = (from: number, until: number) => ({
        kind: 'PERCENT' as const,
        percentBp: 1000,
        validFrom: new Date(Date.now() + from * day).toISOString(),
        validUntil: new Date(Date.now() + until * day).toISOString(),
        minSpendVnd: '500000',
        scopeMode: 'ALL_SERVICES' as const,
        serviceIds: [],
        categoryIds: [],
        usageLimitTotal: null,
        usageLimitPerCustomer: null,
      });
      const program = (
        code: string,
        requiresCode: boolean,
        from = -1,
        until = 30,
      ): DiscountCreateRequest => ({
        code: `${code}_${run}`,
        nameVi: `Chương trình ${code}`,
        nameEn: `Program ${code}`,
        requiresCode,
        version: version(from, until),
      });

      await suite.test(
        'nothing is mentioned until the Owner ticks a program; the default is off',
        async () => {
          const open = await discounts.create(manager.token, program('OPEN', false));
          assert.equal(open.botVisible, false);
          assert.deepEqual((await bot.promotions(q())).promotions, []);
        },
      );

      let openId = '';
      await suite.test(
        'the tick: MANAGE_DISCOUNTS, a code program is refused, audited, idempotent',
        async () => {
          const list = await discounts.list(manager.token);
          const open = list.discounts.find((entry) => entry.code === `OPEN_${run}`)!;
          openId = open.id;
          await fails(
            () =>
              discounts.setBotVisible(nobody.token, open.id, {
                expectedVersion: open.version,
                botVisible: true,
              }),
            'FORBIDDEN',
          );
          const coded = await discounts.create(manager.token, program('CODED', true));
          await fails(
            () =>
              discounts.setBotVisible(manager.token, coded.id, {
                expectedVersion: coded.version,
                botVisible: true,
              }),
            'VALIDATION_FAILED',
            'botVisible',
          );
          await fails(
            () =>
              discounts.setBotVisible(manager.token, open.id, {
                expectedVersion: open.version + 1,
                botVisible: true,
              }),
            'CONFLICT',
          );
          const ticked = await discounts.setBotVisible(manager.token, open.id, {
            expectedVersion: open.version,
            botVisible: true,
          });
          assert.equal(ticked.botVisible, true);
          assert.equal(ticked.version, open.version + 1);
          const same = await discounts.setBotVisible(manager.token, open.id, {
            expectedVersion: ticked.version,
            botVisible: true,
          });
          assert.equal(same.version, ticked.version, 'no change, no new version');
          const events = await tx.auditEvent.findMany({
            where: { action: 'DISCOUNT_BOT_VISIBLE_CHANGED', entityId: open.id },
          });
          assert.equal(events.length, 1);
          assert.deepEqual(events[0]!.before, { code: `OPEN_${run}`, botVisible: false });
          assert.deepEqual(events[0]!.after, { code: `OPEN_${run}`, botVisible: true });
        },
      );

      await suite.test(
        'the bot sees only ticked, code-free, active, current programs, with words and no code',
        async () => {
          // Programs that must stay hidden although they look similar: not ticked, expired, not started, paused, terminated, a code program ticked by hand.
          const hidden = await discounts.create(manager.token, program('HIDDEN', false));
          const expired = await discounts.create(
            manager.token,
            program('EXPIRED', false, -40, -10),
          );
          const future = await discounts.create(manager.token, program('FUTURE', false, 10, 40));
          const paused = await discounts.create(manager.token, program('PAUSED', false));
          const ended = await discounts.create(manager.token, program('ENDED', false));
          const coded = await discounts.create(manager.token, program('HANDCODE', true));
          for (const entry of [expired, future, paused, ended]) {
            await discounts.setBotVisible(manager.token, entry.id, {
              expectedVersion: entry.version,
              botVisible: true,
            });
          }
          const pausedNow = (await discounts.get(manager.token, paused.id)).version;
          await discounts.setActive(manager.token, paused.id, {
            expectedVersion: pausedNow,
            isActive: false,
          });
          const endedNow = (await discounts.get(manager.token, ended.id)).version;
          await discounts.terminate(manager.token, ended.id, {
            expectedVersion: endedNow,
            reason: 'Kết thúc sớm để thử',
          });
          await tx.$executeRawUnsafe(
            `UPDATE discounts SET bot_visible = true, row_version = row_version + 1 WHERE id = '${coded.id}'`,
          );
          void hidden;
          const answer = await bot.promotions(q());
          assert.equal(answer.promotions.length, 1);
          const [only] = answer.promotions;
          assert.equal(only!.name, 'Chương trình OPEN');
          assert.match(
            only!.conditions,
            /^Giảm 10% cho dịch vụ, cho hóa đơn từ 500\.000 ₫\. Từ \d{2}\/\d{2}\/\d{4} đến \d{2}\/\d{2}\/\d{4}\.$/,
          );
          assert.deepEqual(foreignKeys(answer), []);
          assert.ok(!JSON.stringify(answer).includes(run), 'a program code never appears');
          const english = await bot.promotions(q({ locale: 'en' }));
          assert.equal(english.promotions[0]!.name, 'Program OPEN');
          assert.match(
            english.promotions[0]!.conditions,
            /^10% off on services, on a bill from 500,000 ₫\. From /,
          );
          // Switching the tick off takes it away at once.
          const current = await discounts.get(manager.token, openId);
          await discounts.setBotVisible(manager.token, openId, {
            expectedVersion: current.version,
            botVisible: false,
          });
          assert.deepEqual((await bot.promotions(q())).promotions, []);
          await bot.promotions(q({ locale: 'vi' }));
          await assert.rejects(
            () => bot.promotions(q({ locale: 'fr' })),
            (error: unknown) => error instanceof BotError && error.code === 'LOCALE',
          );
        },
      );

      await suite.test(
        'shop, services, products and the bundle: allow-listed keys only, public price, stock as a state',
        async () => {
          const brand = await catalog.createBrand(full.token, {
            nameVi: 'Hãng bot',
            nameEn: 'Bot brand',
          });
          let product = await catalog.createProduct(full.token, {
            nameVi: `Kem bot ${run}`,
            nameEn: `Bot cream ${run}`,
            descriptionVi: 'Mô tả',
            descriptionEn: 'About',
            brandId: brand.id,
            categoryId: null,
            featured: true,
          });
          product = await catalog.createVariant(full.token, product.id, {
            sku: `BOT-${run}-1`,
            labelVi: '50 ml',
            labelEn: '50 ml',
            barcode: null,
            lowStockThreshold: null,
            listPriceVnd: '250000',
            costPriceVnd: '99999',
            sellOnOrder: true,
          });
          await catalog.changeStatus(full.token, product.id, {
            expectedRowVersion: product.rowVersion,
            status: 'PUBLISHED',
          });
          const products = await bot.products(q({ q: run.toLowerCase() }));
          assert.equal(products.products.items.length, 1);
          const item = products.products.items[0]!;
          assert.equal(item.name, `Kem bot ${run}`);
          assert.equal(item.priceVnd, '250000');
          assert.equal(item.inStock, false);
          assert.equal(item.preOrder, true);
          assert.match(item.url, /\/vi\/products\//);
          assert.deepEqual(foreignKeys(products), []);
          const text = JSON.stringify(products);
          for (const secret of [
            '99999',
            `BOT-${run}`,
            'costPrice',
            'margin',
            'barcode',
            'onHand',
          ]) {
            assert.ok(!text.includes(secret), secret);
          }
          // A draft product is invisible to the bot, as to the public.
          await catalog.createProduct(full.token, {
            nameVi: `Nháp ${run}`,
            nameEn: `Draft ${run}`,
            descriptionVi: null,
            descriptionEn: null,
            brandId: null,
            categoryId: null,
            featured: false,
          });
          assert.equal(
            (await bot.products(q({ q: `nháp ${run.toLowerCase()}` }))).products.items.length,
            0,
          );
          const shop = await bot.shop(q());
          assert.deepEqual(foreignKeys(shop), []);
          assert.equal(shop.shop.name, 'Lucy Spa');
          const services = await bot.services(q());
          assert.deepEqual(foreignKeys(services), []);
          const knowledge = await bot.knowledge(q());
          assert.deepEqual(foreignKeys(knowledge), []);
          assert.deepEqual(Object.keys(knowledge).sort(), [
            'groups',
            'locale',
            'products',
            'promotions',
            'shop',
          ]);
          assert.deepEqual(bot.health(), { ok: true, version: 'bot-v1' });
        },
      );

      await suite.test(
        'availability refuses bad input before reading anything: date, services, unknown branch or service',
        async () => {
          const code = (error: unknown) =>
            error instanceof BotError ? `${error.status}:${error.code}` : `other:${String(error)}`;
          const bad = async (params: Record<string, string>) => {
            try {
              await bot.availability(q(params));
              return 'no error';
            } catch (error) {
              return code(error);
            }
          };
          assert.equal(await bad({ services: 'goi-dau' }), '400:DATE');
          assert.equal(await bad({ date: '12/10/2026', services: 'goi-dau' }), '400:DATE');
          assert.equal(
            await bad({ date: '2020-01-01', services: 'goi-dau' }),
            '400:DATE',
            'a past date',
          );
          assert.equal(
            await bad({ date: '2099-01-01', services: 'goi-dau' }),
            '400:DATE',
            'too far ahead',
          );
          const soon = new Date(Date.now() + 2 * day).toISOString().slice(0, 10);
          assert.equal(await bad({ date: soon }), '400:SERVICES');
          assert.equal(await bad({ date: soon, services: 'a,b,c,d' }), '400:SERVICES');
          assert.equal(
            await bad({ date: soon, services: 'khong-co-dich-vu-nay', branch: 'KHONG-CO' }),
            '404:BRANCH',
          );
          assert.equal(await bad({ date: soon, services: 'khong-co-dich-vu-nay' }), '404:SERVICE');
        },
      );
    });
  },
);
