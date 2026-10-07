import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ProductDetailResponse, ProductVariantResponse } from '@lucy-spa/contracts';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import { LocalDiskMediaStorage, parseApiEnvironment } from '@lucy-spa/server';
import { pino } from 'pino';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { mediaUsages } from '../website/media.core.js';
import { validVnMobile } from '../testing/phone.js';
import { MediaService } from '../website/media.service.js';
import { ProductCatalogService } from './product-catalog.service.js';

/**
 * Phase 6 P6-3: the product catalog administration against real PostgreSQL (design 3; the Owner's request of 2026-10-07).
 * Proves: authority per permission (GLOBAL only), cost and margin cut at the API on EVERY endpoint for anyone without
 * VIEW_PRODUCT_COST, price authority, the six approved database rules as precise errors, status moves, optimistic versions,
 * audit, images and the media-library protection. Every fixture rolls back with the outer transaction.
 */
test(
  'Phase 6 P6-3 product catalog administration; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl);
    const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
    const environment = parseApiEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      REDIS_URL: 'redis://localhost:6379',
      WEB_ORIGIN: 'http://localhost:3000',
      AUTH_ALLOW_INSECURE_LOCAL_COOKIE: 'true',
      AUTH_CSRF_KEYS: ring(),
      AUTH_CSRF_ACTIVE_VERSION: '1',
      AUTH_THROTTLE_KEYS: ring(),
      AUTH_THROTTLE_ACTIVE_VERSION: '1',
    });
    const database = createDatabaseClient(databaseUrl);
    const sessions = new SessionService({ client: database } as PrismaService, environment);
    const rollback = new Error('Phase 6 P6-3 fixture rollback');
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    const root = await mkdtemp(path.join(tmpdir(), 'lucy-p63-it-'));
    try {
      await assert.rejects(
        database.$transaction(
          async (tx: Prisma.TransactionClient) => {
            let n = 0;
            let savepoint = 0;
            const isolated = async <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => {
              const name = `catalog_${++savepoint}`;
              await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
              try {
                const result = await work(tx);
                await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
                return result;
              } catch (error) {
                await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
                throw error;
              }
            };
            const adapter = {
              withTransaction: isolated,
              withExclusiveTransaction: isolated,
              resolveForMutation: (token: string) => sessions.resolveForMutation(token, tx),
              resolve: (token: string | undefined) => sessions.resolve(token, tx),
            };
            const throttle = new AuthThrottleService(environment);
            const catalog = new ProductCatalogService(adapter, throttle, environment);
            const media = new MediaService(
              adapter,
              throttle,
              new LocalDiskMediaStorage(root),
              pino({ level: 'silent' }),
            );
            const fails = async (work: () => Promise<unknown>, code: string, field?: string) => {
              await assert.rejects(work, (error: unknown) => {
                assert.equal(Reflect.get(Object(error), 'code'), code);
                if (field !== undefined) assert.equal(Reflect.get(Object(error), 'field'), field);
                return true;
              });
            };

            await syncPermissionCatalog(tx);
            const login = async (user: {
              id: string;
              passwordHash: string | null;
              credentialVersion: number;
              authzVersion: number;
            }) => {
              const principal = {
                userId: user.id,
                passwordHash: user.passwordHash!,
                credentialVersion: user.credentialVersion,
                authzVersion: user.authzVersion,
              };
              const first = (
                await sessions.rotateAuthenticated(
                  (await sessions.createAnonymous(tx)).token,
                  principal,
                  { reauthenticated: false },
                  tx,
                )
              ).token;
              return (
                await sessions.rotateAuthenticated(first, principal, { reauthenticated: true }, tx)
              ).token;
            };
            const ownerRow =
              (await tx.user.findFirst({ where: { kind: 'OWNER' } })) ??
              (await tx.user.create({
                data: {
                  kind: 'OWNER',
                  status: 'ACTIVE',
                  fullName: 'Chủ spa fixture',
                  preferredLocale: 'vi',
                  emailCanonical: `p63-owner-${run.toLowerCase()}@example.com`,
                  emailDelivery: `p63-owner-${run.toLowerCase()}@example.com`,
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                },
              }));
            const ownerToken = await login(ownerRow);
            const branch = await tx.branch.create({
              data: { code: `P63_${run}`, name: 'Catalog', timezone: 'Asia/Ho_Chi_Minh' },
            });
            type Code = 'MANAGE_PRODUCTS' | 'MANAGE_PRODUCT_PRICES' | 'VIEW_PRODUCT_COST';
            const makeRole = async (name: string, codes: Code[]) =>
              tx.role.create({
                data: {
                  code: `P63_${name}_${run}`,
                  displayNameVi: name,
                  displayNameEn: name,
                  permissions: {
                    create: await Promise.all(
                      codes.map(async (code) => ({
                        permissionId: (await tx.permission.findUniqueOrThrow({ where: { code } }))
                          .id,
                      })),
                    ),
                  },
                },
              });
            const staff = async (codes: Code[], deny: Code[] = []) => {
              n++;
              const role = await makeRole(`R${n}`, codes);
              const user = await tx.user.create({
                data: {
                  kind: 'EMPLOYEE',
                  status: 'ACTIVE',
                  fullName: `Nhân viên ${n}`,
                  preferredLocale: 'vi',
                  phoneCanonical: validVnMobile(),
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                  employeeProfile: {
                    create: {
                      employeeCodeCanonical: `P63_${run}_${n}`,
                      dateOfBirth: new Date('1990-01-01'),
                      address: 'Fixture',
                    },
                  },
                },
              });
              await tx.employmentClassificationChange.create({
                data: {
                  employeeUserId: user.id,
                  classification: 'OFFICIAL_EMPLOYEE',
                  effectiveDate: new Date('2020-01-01'),
                },
              });
              await tx.employeeBranchAssignment.create({
                data: { employeeUserId: user.id, branchId: branch.id, grantedByUserId: user.id },
              });
              await tx.userRoleAssignment.create({
                data: { userId: user.id, roleId: role.id, scopeKind: 'GLOBAL' },
              });
              for (const code of deny) {
                await tx.userPermissionOverride.create({
                  data: {
                    userId: user.id,
                    permissionId: (await tx.permission.findUniqueOrThrow({ where: { code } })).id,
                    effect: 'DENY',
                    scopeKind: 'GLOBAL',
                  },
                });
              }
              return { id: user.id, token: await login(user) };
            };
            const actors = {
              manager: await staff(['MANAGE_PRODUCTS']),
              pricer: await staff(['MANAGE_PRODUCT_PRICES']),
              managerPricer: await staff(['MANAGE_PRODUCTS', 'MANAGE_PRODUCT_PRICES']),
              managerCost: await staff(['MANAGE_PRODUCTS', 'VIEW_PRODUCT_COST']),
              full: await staff(['MANAGE_PRODUCTS', 'MANAGE_PRODUCT_PRICES', 'VIEW_PRODUCT_COST']),
              costOnly: await staff(['VIEW_PRODUCT_COST']),
              none: await staff([]),
              denied: await staff(
                ['MANAGE_PRODUCTS', 'MANAGE_PRODUCT_PRICES', 'VIEW_PRODUCT_COST'],
                ['VIEW_PRODUCT_COST'],
              ),
            };
            const money = (value: number) => String(value);
            const variantOf = (
              product: ProductDetailResponse,
              sku: string,
            ): ProductVariantResponse => {
              const found = product.variants.find((variant) => variant.sku === sku);
              assert.ok(found, `variant ${sku}`);
              return found;
            };
            /** The cost may not exist anywhere in a response built for a caller without the cost permission. */
            const noCost = (response: unknown) => {
              const json = JSON.stringify(response);
              assert.ok(!/costPrice|margin/i.test(json), 'no cost or margin key anywhere');
            };
            const rowCount = (
              table: 'product_variants' | 'product_price_versions' | 'product_promotions',
            ) =>
              tx
                .$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*) FROM ${table}`)
                .then((rows) => Number(rows[0]?.count ?? 0));

            // Shared fixture: a brand, a category and one product with a priced, costed variant.
            const brand = await catalog.createBrand(actors.manager.token, {
              nameVi: 'Thương hiệu Đẹp',
              nameEn: `Brand ${run}`,
            });
            const category = await catalog.createCategory(actors.manager.token, {
              parentId: null,
              nameVi: 'Chăm sóc da',
              nameEn: `Skin care ${run}`,
            });
            const baseProduct = {
              nameVi: 'Kem dưỡng ẩm',
              nameEn: `Moisturizer ${run}`,
              descriptionVi: 'Mô tả',
              descriptionEn: null,
              brandId: brand.id,
              categoryId: category.id,
              featured: false,
            };
            let product = await catalog.createProduct(actors.manager.token, baseProduct);
            product = await catalog.createVariant(actors.full.token, product.id, {
              sku: `P63-${run}-A`,
              labelVi: '50 ml',
              labelEn: '50 ml',
              barcode: null,
              lowStockThreshold: 3,
              listPriceVnd: money(100_000),
              costPriceVnd: money(40_000),
            });
            const skuA = `P63-${run}-A`;
            const variantA = variantOf(product, skuA);

            // ================================================================= authority and cost privacy
            await suite.test(
              'authority is GLOBAL, per permission; nothing opens without it',
              async () => {
                // Reading the catalog: MANAGE_PRODUCTS or MANAGE_PRODUCT_PRICES only; cost alone and nothing at all are refused.
                for (const who of [actors.costOnly, actors.none]) {
                  await fails(() => catalog.products(who.token), 'FORBIDDEN');
                  await fails(() => catalog.brands(who.token), 'FORBIDDEN');
                  await fails(() => catalog.categories(who.token), 'FORBIDDEN');
                  await fails(() => catalog.product(who.token, product.id), 'FORBIDDEN');
                }
                await fails(() => catalog.products(undefined), 'AUTHENTICATION_REQUIRED');
                for (const who of [
                  actors.manager,
                  actors.pricer,
                  actors.managerPricer,
                  actors.full,
                ]) {
                  assert.equal((await catalog.products(who.token)).products.length >= 1, true);
                }
                // The price permission alone reads but writes no catalog data.
                const pricerView = await catalog.product(actors.pricer.token, product.id);
                assert.deepEqual(pricerView.access, { manage: false, prices: true, cost: false });
                await fails(
                  () =>
                    catalog.editProduct(actors.pricer.token, product.id, {
                      ...baseProduct,
                      expectedRowVersion: product.rowVersion,
                    }),
                  'FORBIDDEN',
                );
                await fails(
                  () => catalog.createBrand(actors.pricer.token, { nameVi: 'X', nameEn: 'X' }),
                  'FORBIDDEN',
                );
                // The catalog permission alone writes no price.
                const before = await rowCount('product_price_versions');
                await fails(
                  () =>
                    catalog.changePrice(actors.manager.token, product.id, variantA.id, {
                      expectedVersionNo: 1,
                      listPriceVnd: money(120_000),
                      reason: null,
                    }),
                  'FORBIDDEN',
                );
                await fails(
                  () =>
                    catalog.createPromotion(actors.manager.token, product.id, variantA.id, {
                      promoPriceVnd: money(90_000),
                      startsAt: new Date(Date.now() - 60_000).toISOString(),
                      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
                    }),
                  'FORBIDDEN',
                );
                assert.equal(await rowCount('product_price_versions'), before, 'nothing written');
                assert.equal(await rowCount('product_promotions'), 0, 'nothing written');
                const noPrice = await catalog.createVariant(actors.manager.token, product.id, {
                  sku: `P63-${run}-NOPRICE`,
                  labelVi: null,
                  labelEn: null,
                  barcode: null,
                  lowStockThreshold: null,
                });
                assert.equal(variantOf(noPrice, `P63-${run}-NOPRICE`).listPriceVnd, null);
                assert.equal(variantOf(noPrice, `P63-${run}-NOPRICE`).effectivePriceVnd, null);
                product = noPrice;
                // A deny override beats the role.
                assert.equal(
                  (await catalog.product(actors.denied.token, product.id)).access.cost,
                  false,
                );
                assert.equal(
                  (await catalog.product(actors.full.token, product.id)).access.cost,
                  true,
                );
              },
            );

            await suite.test(
              'cost and margin exist only for VIEW_PRODUCT_COST, on every endpoint',
              async () => {
                const withCost = [actors.full, actors.managerCost];
                const withoutCost = [
                  actors.manager,
                  actors.pricer,
                  actors.managerPricer,
                  actors.denied,
                ];
                // Reads.
                for (const who of withoutCost) {
                  noCost(await catalog.products(who.token));
                  const detail = await catalog.product(who.token, product.id);
                  noCost(detail);
                  for (const variant of detail.variants) {
                    assert.ok(!('costPriceVnd' in variant), 'the key is absent, never null');
                    assert.ok(!('marginVnd' in variant));
                  }
                }
                const costed = await catalog.product(actors.full.token, product.id);
                assert.equal(variantOf(costed, skuA).costPriceVnd, '40000');
                assert.equal(
                  variantOf(costed, skuA).marginVnd,
                  '60000',
                  'margin = effective price - cost',
                );
                assert.equal(variantOf(costed, `P63-${run}-NOPRICE`).marginVnd, null);
                const costedList = await catalog.products(actors.managerCost.token);
                noCost(costedList); // a list row never carries a cost, whoever asks
                assert.equal(withCost.length, 2);
                assert.equal(
                  variantOf(await catalog.product(actors.managerCost.token, product.id), skuA)
                    .costPriceVnd,
                  '40000',
                );
                // Every mutation answers with the same presenter: no cost for the callers without the permission.
                let current = await catalog.product(actors.managerPricer.token, product.id);
                const a = variantOf(current, skuA);
                current = await catalog.editVariant(actors.managerPricer.token, product.id, a.id, {
                  expectedRowVersion: a.rowVersion,
                  labelVi: '50 ml',
                  labelEn: '50 ml',
                  barcode: null,
                  lowStockThreshold: 5,
                  sortOrder: a.sortOrder,
                  isActive: true,
                });
                noCost(current);
                assert.equal(variantOf(current, skuA).lowStockThreshold, 5);
                // The omitted cost stayed: it was not wiped by an edit from someone who cannot see it.
                const stored = await tx.productVariant.findUniqueOrThrow({ where: { id: a.id } });
                assert.equal(stored.costPriceVnd, 40_000n);
                current = await catalog.changePrice(actors.managerPricer.token, product.id, a.id, {
                  expectedVersionNo: variantOf(current, skuA).priceVersionNo,
                  listPriceVnd: money(110_000),
                  reason: 'Giá mới',
                });
                noCost(current);
                current = await catalog.createPromotion(
                  actors.managerPricer.token,
                  product.id,
                  a.id,
                  {
                    promoPriceVnd: money(99_000),
                    startsAt: new Date(Date.now() - 60_000).toISOString(),
                    endsAt: new Date(Date.now() + 3_600_000).toISOString(),
                  },
                );
                noCost(current);
                current = await catalog.endPromotion(
                  actors.managerPricer.token,
                  product.id,
                  variantOf(current, skuA).promotions[0]!.id,
                );
                noCost(current);
                current = await catalog.editProduct(actors.managerPricer.token, product.id, {
                  ...baseProduct,
                  featured: true,
                  expectedRowVersion: current.rowVersion,
                });
                noCost(current);
                current = await catalog.changeStatus(actors.managerPricer.token, product.id, {
                  expectedRowVersion: current.rowVersion,
                  status: 'PUBLISHED',
                });
                noCost(current);
                noCost(
                  await catalog.createVariant(actors.managerPricer.token, product.id, {
                    sku: `P63-${run}-B`,
                    labelVi: null,
                    labelEn: null,
                    barcode: null,
                    lowStockThreshold: null,
                  }),
                );
                // Sending a cost without the permission is refused outright and writes nothing.
                const beforeVariants = await rowCount('product_variants');
                await fails(
                  () =>
                    catalog.createVariant(actors.managerPricer.token, product.id, {
                      sku: `P63-${run}-C`,
                      labelVi: null,
                      labelEn: null,
                      barcode: null,
                      lowStockThreshold: null,
                      costPriceVnd: money(1),
                    }),
                  'FORBIDDEN',
                );
                assert.equal(await rowCount('product_variants'), beforeVariants);
                const afterPrice = await catalog.product(actors.managerPricer.token, product.id);
                const a2 = variantOf(afterPrice, skuA);
                await fails(
                  () =>
                    catalog.editVariant(actors.denied.token, product.id, a2.id, {
                      expectedRowVersion: a2.rowVersion,
                      labelVi: '50 ml',
                      labelEn: '50 ml',
                      barcode: null,
                      lowStockThreshold: 5,
                      sortOrder: a2.sortOrder,
                      isActive: true,
                      costPriceVnd: money(1),
                    }),
                  'FORBIDDEN',
                );
                const unchanged = await tx.productVariant.findUniqueOrThrow({
                  where: { id: a2.id },
                });
                assert.equal(unchanged.costPriceVnd, 40_000n);
                assert.equal(unchanged.rowVersion, a2.rowVersion, 'nothing written');
                // A cost holder may change and clear it; the change is audited FINANCIAL, the ordinary audit has no cost.
                const changed = await catalog.editVariant(
                  actors.managerCost.token,
                  product.id,
                  a2.id,
                  {
                    expectedRowVersion: a2.rowVersion,
                    labelVi: '50 ml',
                    labelEn: '50 ml',
                    barcode: null,
                    lowStockThreshold: 5,
                    sortOrder: a2.sortOrder,
                    isActive: true,
                    costPriceVnd: money(45_000),
                  },
                );
                assert.equal(variantOf(changed, skuA).costPriceVnd, '45000');
                const costAudit = await tx.auditEvent.findFirstOrThrow({
                  where: { action: 'PRODUCT_COST_CHANGED', entityId: a2.id },
                });
                assert.equal(costAudit.dataClassification, 'FINANCIAL');
                const ordinary = await tx.auditEvent.findMany({
                  where: { action: { in: ['PRODUCT_VARIANT_UPDATED', 'PRODUCT_VARIANT_CREATED'] } },
                });
                for (const event of ordinary) {
                  assert.ok(
                    !/cost/i.test(JSON.stringify([event.before, event.after])),
                    'no cost in the ordinary audit',
                  );
                }
                const cleared = await catalog.editVariant(actors.full.token, product.id, a2.id, {
                  expectedRowVersion: variantOf(changed, skuA).rowVersion,
                  labelVi: '50 ml',
                  labelEn: '50 ml',
                  barcode: null,
                  lowStockThreshold: 5,
                  sortOrder: a2.sortOrder,
                  isActive: true,
                  costPriceVnd: null,
                });
                assert.equal(variantOf(cleared, skuA).costPriceVnd, null);
                assert.equal(variantOf(cleared, skuA).marginVnd, null);
                product = cleared;
              },
            );

            // ======================================================================= the catalog itself
            await suite.test(
              'brands and categories: codes, two levels, versions, audit',
              async () => {
                assert.equal(brand.code, `brand-${run.toLowerCase()}`);
                assert.equal(brand.productCount, 0);
                const dong = await catalog.createBrand(actors.manager.token, {
                  nameVi: 'Đông y',
                  nameEn: 'Đông Y Đẹp',
                });
                assert.equal(dong.code, 'dong-y-dep', 'đ is mapped, accents are stripped');
                const again = await catalog.createBrand(actors.manager.token, {
                  nameVi: 'Đông y 2',
                  nameEn: 'Đông Y Đẹp',
                });
                assert.equal(again.code, 'dong-y-dep-2', 'a clash gets a numeric suffix');
                const edited = await catalog.editBrand(actors.manager.token, dong.id, {
                  expectedRowVersion: dong.rowVersion,
                  nameVi: 'Đông y mới',
                  nameEn: 'Đông Y Đẹp',
                  isActive: false,
                });
                assert.equal(edited.rowVersion, 2);
                assert.equal(edited.isActive, false);
                await fails(
                  () =>
                    catalog.editBrand(actors.manager.token, dong.id, {
                      expectedRowVersion: 1,
                      nameVi: 'Cũ',
                      nameEn: 'Old',
                      isActive: true,
                    }),
                  'CONFLICT',
                );
                assert.equal(
                  (
                    await catalog.editBrand(actors.manager.token, dong.id, {
                      expectedRowVersion: 2,
                      nameVi: 'Đông y mới',
                      nameEn: 'Đông Y Đẹp',
                      isActive: false,
                    })
                  ).rowVersion,
                  2,
                  'the same values are a quiet no-op',
                );
                for (const bad of [
                  { nameVi: '  ', nameEn: 'A' },
                  { nameVi: 'A', nameEn: '' },
                ]) {
                  await fails(
                    () => catalog.createBrand(actors.manager.token, bad),
                    'VALIDATION_FAILED',
                  );
                }
                // An inactive brand cannot be chosen for a product.
                await fails(
                  () =>
                    catalog.createProduct(actors.manager.token, {
                      ...baseProduct,
                      brandId: dong.id,
                    }),
                  'VALIDATION_FAILED',
                  'brandId',
                );
                // Categories: two levels.
                const child = await catalog.createCategory(actors.manager.token, {
                  parentId: category.id,
                  nameVi: 'Sữa rửa mặt',
                  nameEn: `Cleanser ${run}`,
                  sortOrder: 2,
                });
                assert.equal(child.parentId, category.id);
                await fails(
                  () =>
                    catalog.createCategory(actors.manager.token, {
                      parentId: child.id,
                      nameVi: 'Cháu',
                      nameEn: 'Grandchild',
                    }),
                  'PRODUCT_CATEGORY_DEPTH',
                );
                const other = await catalog.createCategory(actors.manager.token, {
                  parentId: null,
                  nameVi: 'Trang điểm',
                  nameEn: `Makeup ${run}`,
                });
                await fails(
                  () =>
                    catalog.editCategory(actors.manager.token, category.id, {
                      expectedRowVersion: category.rowVersion,
                      parentId: other.id,
                      nameVi: category.nameVi,
                      nameEn: category.nameEn,
                      sortOrder: 0,
                      isActive: true,
                    }),
                  'PRODUCT_CATEGORY_DEPTH',
                );
                await fails(
                  () =>
                    catalog.editCategory(actors.manager.token, other.id, {
                      expectedRowVersion: other.rowVersion,
                      parentId: other.id,
                      nameVi: other.nameVi,
                      nameEn: other.nameEn,
                      sortOrder: 0,
                      isActive: true,
                    }),
                  'VALIDATION_FAILED',
                  'parentId',
                );
                await fails(
                  () =>
                    catalog.createCategory(actors.manager.token, {
                      parentId: randomUUID(),
                      nameVi: 'Mồ côi',
                      nameEn: 'Orphan',
                    }),
                  'VALIDATION_FAILED',
                  'parentId',
                );
                const moved = await catalog.editCategory(actors.manager.token, other.id, {
                  expectedRowVersion: other.rowVersion,
                  parentId: category.id,
                  nameVi: other.nameVi,
                  nameEn: other.nameEn,
                  sortOrder: 5,
                  isActive: true,
                });
                assert.equal(
                  moved.parentId,
                  category.id,
                  'a childless category may become a child',
                );
                const list = await catalog.categories(actors.pricer.token);
                assert.ok(list.categories.some((row) => row.id === moved.id));
                assert.ok(
                  (await catalog.categories(actors.manager.token)).categories.find(
                    (row) => row.id === category.id,
                  )!.productCount >= 1,
                );
                const audits = await tx.auditEvent.findMany({
                  where: { action: { startsWith: 'PRODUCT_' }, actorUserId: actors.manager.id },
                });
                assert.ok(audits.some((event) => event.action === 'PRODUCT_BRAND_UPDATED'));
                assert.ok(audits.some((event) => event.action === 'PRODUCT_CATEGORY_CREATED'));
              },
            );

            await suite.test('variants: SKU and barcode identity, versions, fields', async () => {
              const detail = await catalog.product(actors.manager.token, product.id);
              assert.equal(detail.status, 'PUBLISHED');
              assert.equal(detail.code, `moisturizer-${run.toLowerCase()}`);
              const a = variantOf(detail, skuA);
              await fails(
                () =>
                  catalog.createVariant(actors.manager.token, product.id, {
                    sku: skuA.toLowerCase(),
                    labelVi: null,
                    labelEn: null,
                    barcode: null,
                    lowStockThreshold: null,
                  }),
                'CONFLICT',
                'sku',
              );
              for (const sku of ['', 'có dấu', 'a b', '-X', 'x'.repeat(65)]) {
                await fails(
                  () =>
                    catalog.createVariant(actors.manager.token, product.id, {
                      sku,
                      labelVi: null,
                      labelEn: null,
                      barcode: null,
                      lowStockThreshold: null,
                    }),
                  'VALIDATION_FAILED',
                  'sku',
                );
              }
              const withBarcode = await catalog.createVariant(actors.manager.token, product.id, {
                sku: `P63-${run}-BAR`,
                labelVi: null,
                labelEn: null,
                barcode: ' 8938500000011 ',
                lowStockThreshold: 0,
              });
              assert.equal(variantOf(withBarcode, `P63-${run}-BAR`).barcode, '8938500000011');
              await fails(
                () =>
                  catalog.createVariant(actors.manager.token, product.id, {
                    sku: `P63-${run}-BAR2`,
                    labelVi: null,
                    labelEn: null,
                    barcode: '8938500000011',
                    lowStockThreshold: null,
                  }),
                'CONFLICT',
                'barcode',
              );
              await fails(
                () =>
                  catalog.createVariant(actors.manager.token, product.id, {
                    sku: `P63-${run}-NEG`,
                    labelVi: null,
                    labelEn: null,
                    barcode: null,
                    lowStockThreshold: -1,
                  }),
                'VALIDATION_FAILED',
                'lowStockThreshold',
              );
              // Optimistic version.
              await fails(
                () =>
                  catalog.editVariant(actors.manager.token, product.id, a.id, {
                    expectedRowVersion: a.rowVersion - 1,
                    labelVi: 'x',
                    labelEn: 'x',
                    barcode: null,
                    lowStockThreshold: null,
                    sortOrder: 0,
                    isActive: true,
                  }),
                'CONFLICT',
              );
              // A variant of another product is not found.
              const other = await catalog.createProduct(actors.manager.token, {
                ...baseProduct,
                nameEn: `Other ${run}`,
              });
              await fails(
                () =>
                  catalog.editVariant(actors.manager.token, other.id, a.id, {
                    expectedRowVersion: a.rowVersion,
                    labelVi: 'x',
                    labelEn: 'x',
                    barcode: null,
                    lowStockThreshold: null,
                    sortOrder: 0,
                    isActive: true,
                  }),
                'NOT_FOUND',
              );
              await fails(
                async () => catalog.product(actors.manager.token, 'not-a-uuid'),
                'NOT_FOUND',
              );
              await fails(() => catalog.product(actors.manager.token, randomUUID()), 'NOT_FOUND');
            });

            await suite.test('prices: versions, history, rule 1, promotions, rule 2', async () => {
              // A fresh product so the numbers are exact.
              let p = await catalog.createProduct(actors.full.token, {
                ...baseProduct,
                nameEn: `Serum ${run}`,
              });
              p = await catalog.createVariant(actors.full.token, p.id, {
                sku: `P63-${run}-S1`,
                labelVi: '30 ml',
                labelEn: '30 ml',
                barcode: null,
                lowStockThreshold: null,
                listPriceVnd: money(200_000),
              });
              const v = () => variantOf(p, `P63-${run}-S1`);
              assert.equal(v().priceVersionNo, 1);
              assert.equal(v().effectivePriceVnd, '200000');
              // Validation and the version check.
              for (const bad of ['0', '-5', '1.5', '1e3', 'abc', '']) {
                await fails(
                  () =>
                    catalog.changePrice(actors.full.token, p.id, v().id, {
                      expectedVersionNo: 1,
                      listPriceVnd: bad,
                      reason: null,
                    }),
                  'VALIDATION_FAILED',
                  'listPriceVnd',
                );
              }
              await fails(
                () =>
                  catalog.changePrice(actors.full.token, p.id, v().id, {
                    expectedVersionNo: 0,
                    listPriceVnd: money(210_000),
                    reason: null,
                  }),
                'CONFLICT',
              );
              p = await catalog.changePrice(actors.full.token, p.id, v().id, {
                expectedVersionNo: 1,
                listPriceVnd: money(210_000),
                reason: 'Tăng giá nhập',
              });
              assert.equal(v().priceVersionNo, 2);
              assert.deepEqual(
                v().priceHistory.map((row) => [row.versionNo, row.listPriceVnd, row.reason]),
                [
                  [2, '210000', 'Tăng giá nhập'],
                  [1, '200000', null],
                ],
              );
              assert.equal(
                (
                  await catalog.changePrice(actors.full.token, p.id, v().id, {
                    expectedVersionNo: 2,
                    listPriceVnd: money(210_000),
                    reason: null,
                  })
                ).variants[0]!.priceVersionNo,
                2,
                'the same price adds no version',
              );
              // Promotion rule 2: below the list price, not already over, no overlap.
              const now = Date.now();
              const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
              for (const price of [money(210_000), money(300_000)]) {
                await fails(
                  () =>
                    catalog.createPromotion(actors.full.token, p.id, v().id, {
                      promoPriceVnd: price,
                      startsAt: iso(-60_000),
                      endsAt: iso(3_600_000),
                    }),
                  'PRODUCT_PROMOTION_PRICE_INVALID',
                  'promoPriceVnd',
                );
              }
              await fails(
                () =>
                  catalog.createPromotion(actors.full.token, p.id, v().id, {
                    promoPriceVnd: money(150_000),
                    startsAt: iso(-7_200_000),
                    endsAt: iso(-3_600_000),
                  }),
                'PRODUCT_PROMOTION_EXPIRED',
                'endsAt',
              );
              await fails(
                () =>
                  catalog.createPromotion(actors.full.token, p.id, v().id, {
                    promoPriceVnd: money(150_000),
                    startsAt: iso(3_600_000),
                    endsAt: iso(60_000),
                  }),
                'VALIDATION_FAILED',
                'endsAt',
              );
              await fails(
                () =>
                  catalog.createPromotion(actors.full.token, p.id, v().id, {
                    promoPriceVnd: money(150_000),
                    startsAt: 'tomorrow',
                    endsAt: iso(3_600_000),
                  }),
                'VALIDATION_FAILED',
                'startsAt',
              );
              p = await catalog.createPromotion(actors.full.token, p.id, v().id, {
                promoPriceVnd: money(150_000),
                startsAt: iso(-60_000),
                endsAt: iso(3_600_000),
              });
              assert.equal(v().effectivePriceVnd, '150000');
              assert.equal(v().activePromotion?.state, 'ACTIVE');
              assert.equal(v().listPriceVnd, '210000', 'the list price is untouched');
              await fails(
                () =>
                  catalog.createPromotion(actors.full.token, p.id, v().id, {
                    promoPriceVnd: money(140_000),
                    startsAt: iso(1_800_000),
                    endsAt: iso(7_200_000),
                  }),
                'PRODUCT_PROMOTION_OVERLAP',
                'startsAt',
              );
              // A later, separate window is fine (scheduled).
              p = await catalog.createPromotion(actors.full.token, p.id, v().id, {
                promoPriceVnd: money(160_000),
                startsAt: iso(7_200_000),
                endsAt: iso(10_800_000),
              });
              assert.deepEqual(
                v().promotions.map((row) => row.state),
                ['SCHEDULED', 'ACTIVE'],
              );
              // Rule 1: the list price cannot change while an unfinished promotion is at or above the new price.
              for (const price of [150_000, 140_000, 160_000, 100_000]) {
                await fails(
                  () =>
                    catalog.changePrice(actors.full.token, p.id, v().id, {
                      expectedVersionNo: 2,
                      listPriceVnd: money(price),
                      reason: null,
                    }),
                  'PRODUCT_PRICE_BELOW_PROMOTION',
                  'listPriceVnd',
                );
              }
              p = await catalog.changePrice(actors.full.token, p.id, v().id, {
                expectedVersionNo: 2,
                listPriceVnd: money(161_000),
                reason: null,
              });
              assert.equal(v().priceVersionNo, 3);
              // Ending both promotions by hand frees the price; the price returns to the list price by itself.
              const [scheduled, active] = v().promotions;
              p = await catalog.endPromotion(actors.full.token, p.id, active!.id);
              assert.equal(v().effectivePriceVnd, '161000');
              assert.equal(v().promotions.find((row) => row.id === active!.id)?.state, 'ENDED');
              await fails(
                () => catalog.endPromotion(actors.full.token, p.id, active!.id),
                'PRODUCT_PROMOTION_EXPIRED',
              );
              await fails(
                () => catalog.endPromotion(actors.manager.token, p.id, scheduled!.id),
                'FORBIDDEN',
              );
              p = await catalog.endPromotion(actors.full.token, p.id, scheduled!.id);
              assert.ok(v().promotions.every((row) => row.state === 'ENDED'));
              // Owner fix (2026-10-07): a promotion ended by hand, even before it started, no longer blocks lowering the list price.
              p = await catalog.changePrice(actors.full.token, p.id, v().id, {
                expectedVersionNo: 3,
                listPriceVnd: money(100_000),
                reason: null,
              });
              assert.equal(v().priceVersionNo, 4);
              assert.equal(v().effectivePriceVnd, '100000');
              p = await catalog.changePrice(actors.full.token, p.id, v().id, {
                expectedVersionNo: 4,
                listPriceVnd: money(170_000),
                reason: 'Tăng giá',
              });
              assert.equal(v().effectivePriceVnd, '170000');
              await fails(
                () => catalog.endPromotion(actors.full.token, product.id, active!.id),
                'NOT_FOUND',
              );
              // Prices and promotions are audited FINANCIAL.
              const financial = await tx.auditEvent.findMany({
                where: {
                  action: {
                    in: [
                      'PRODUCT_PRICE_CHANGED',
                      'PRODUCT_PROMOTION_CREATED',
                      'PRODUCT_PROMOTION_ENDED',
                    ],
                  },
                },
              });
              assert.ok(financial.length >= 8);
              assert.ok(financial.every((event) => event.dataClassification === 'FINANCIAL'));
              const last = await tx.auditEvent.findFirstOrThrow({
                where: { action: 'PRODUCT_PRICE_CHANGED', entityId: v().id },
                orderBy: { occurredAt: 'desc' },
              });
              assert.equal(last.reason, 'Tăng giá');
              // The history rows are append-only at the database too.
              assert.equal(await tx.productPriceVersion.count({ where: { variantId: v().id } }), 5);
            });

            await suite.test(
              'status: allowed moves only, publish needs an active priced variant',
              async () => {
                let p = await catalog.createProduct(actors.manager.token, {
                  ...baseProduct,
                  nameEn: `Mask ${run}`,
                });
                assert.equal(p.status, 'DRAFT');
                assert.equal(p.publishedAt, null);
                const status = (to: 'PUBLISHED' | 'INACTIVE') =>
                  catalog.changeStatus(actors.manager.token, p.id, {
                    expectedRowVersion: p.rowVersion,
                    status: to,
                  });
                await fails(() => status('PUBLISHED'), 'PRODUCT_PUBLISH_INCOMPLETE');
                await fails(() => status('INACTIVE'), 'PRODUCT_STATUS_INVALID');
                await fails(
                  () =>
                    catalog.changeStatus(actors.manager.token, p.id, {
                      expectedRowVersion: p.rowVersion,
                      status: 'DRAFT' as 'PUBLISHED',
                    }),
                  'VALIDATION_FAILED',
                  'status',
                );
                // An unpriced variant does not qualify; neither does an inactive priced one.
                p = await catalog.createVariant(actors.manager.token, p.id, {
                  sku: `P63-${run}-M1`,
                  labelVi: null,
                  labelEn: null,
                  barcode: null,
                  lowStockThreshold: null,
                });
                await fails(() => status('PUBLISHED'), 'PRODUCT_PUBLISH_INCOMPLETE');
                const m1 = variantOf(p, `P63-${run}-M1`);
                p = await catalog.changePrice(actors.pricer.token, p.id, m1.id, {
                  expectedVersionNo: 0,
                  listPriceVnd: money(80_000),
                  reason: null,
                });
                p = await status('PUBLISHED');
                assert.equal(p.status, 'PUBLISHED');
                assert.ok(p.publishedAt);
                const firstPublished = p.publishedAt;
                // A published product keeps one active, priced variant.
                await fails(
                  () =>
                    catalog.editVariant(actors.manager.token, p.id, m1.id, {
                      expectedRowVersion: variantOf(p, `P63-${run}-M1`).rowVersion,
                      labelVi: null,
                      labelEn: null,
                      barcode: null,
                      lowStockThreshold: null,
                      sortOrder: 0,
                      isActive: false,
                    }),
                  'PRODUCT_LAST_PRICED_VARIANT',
                );
                // With a second priced variant it may be switched off.
                p = await catalog.createVariant(actors.full.token, p.id, {
                  sku: `P63-${run}-M2`,
                  labelVi: null,
                  labelEn: null,
                  barcode: null,
                  lowStockThreshold: null,
                  listPriceVnd: money(90_000),
                });
                p = await catalog.editVariant(actors.manager.token, p.id, m1.id, {
                  expectedRowVersion: variantOf(p, `P63-${run}-M1`).rowVersion,
                  labelVi: null,
                  labelEn: null,
                  barcode: null,
                  lowStockThreshold: null,
                  sortOrder: 0,
                  isActive: false,
                });
                assert.equal(variantOf(p, `P63-${run}-M1`).isActive, false);
                // INACTIVE and back; the first publication time never changes; never back to draft.
                p = await status('INACTIVE');
                assert.equal(p.status, 'INACTIVE');
                p = await status('PUBLISHED');
                assert.equal(p.publishedAt, firstPublished);
                assert.equal(
                  (await status('PUBLISHED')).rowVersion,
                  p.rowVersion,
                  'same status is a quiet no-op',
                );
                await fails(
                  () =>
                    catalog.changeStatus(actors.manager.token, p.id, {
                      expectedRowVersion: p.rowVersion - 1,
                      status: 'INACTIVE',
                    }),
                  'CONFLICT',
                );
                await fails(
                  () =>
                    catalog.changeStatus(actors.pricer.token, p.id, {
                      expectedRowVersion: p.rowVersion,
                      status: 'INACTIVE',
                    }),
                  'FORBIDDEN',
                );
                // The product edit keeps the same rules and versions.
                const edited = await catalog.editProduct(actors.manager.token, p.id, {
                  ...baseProduct,
                  nameEn: `Mask ${run}`,
                  nameVi: 'Mặt nạ',
                  featured: true,
                  expectedRowVersion: p.rowVersion,
                });
                assert.equal(edited.featured, true);
                assert.equal(edited.rowVersion, p.rowVersion + 1);
                await fails(
                  () =>
                    catalog.editProduct(actors.manager.token, p.id, {
                      ...baseProduct,
                      nameVi: ' ',
                      expectedRowVersion: edited.rowVersion,
                    }),
                  'VALIDATION_FAILED',
                  'nameVi',
                );
                const audit = await tx.auditEvent.findMany({
                  where: { action: 'PRODUCT_STATUS_CHANGED', entityId: p.id },
                });
                assert.equal(audit.length, 3);
              },
            );

            await suite.test(
              'images: alt text, order, removal, media library protection and access',
              async () => {
                const p = await catalog.createProduct(actors.manager.token, {
                  ...baseProduct,
                  nameEn: `Soap ${run}`,
                });
                const asset = (label: string, altVi: string | null) =>
                  tx.mediaAsset.create({
                    data: {
                      storageKey: `p63/${run}/${label}.webp`,
                      originalFilename: `${label}.webp`,
                      mime: 'image/webp',
                      bytes: 1000,
                      width: 100,
                      height: 100,
                      sha256: randomBytes(32).toString('hex'),
                      altVi,
                      createdByUserId: ownerRow.id,
                    },
                  });
                const one = await asset('one', 'Ảnh một');
                const two = await asset('two', 'Ảnh hai');
                const bare = await asset('bare', null);
                await fails(
                  () => catalog.addImage(actors.manager.token, p.id, { mediaAssetId: bare.id }),
                  'MEDIA_ALT_REQUIRED',
                  'altVi',
                );
                await fails(
                  () =>
                    catalog.addImage(actors.manager.token, p.id, { mediaAssetId: randomUUID() }),
                  'VALIDATION_FAILED',
                  'mediaAssetId',
                );
                await fails(
                  () => catalog.addImage(actors.pricer.token, p.id, { mediaAssetId: one.id }),
                  'FORBIDDEN',
                );
                await catalog.addImage(actors.manager.token, p.id, { mediaAssetId: one.id });
                const added = await catalog.addImage(actors.manager.token, p.id, {
                  mediaAssetId: two.id,
                });
                assert.deepEqual(
                  added.images.map((image) => [image.mediaAssetId, image.sortOrder, image.altVi]),
                  [
                    [one.id, 0, 'Ảnh một'],
                    [two.id, 1, 'Ảnh hai'],
                  ],
                );
                await fails(
                  () => catalog.addImage(actors.manager.token, p.id, { mediaAssetId: one.id }),
                  'CONFLICT',
                  'mediaAssetId',
                );
                const [first, second] = added.images;
                const reordered = await catalog.orderImages(actors.manager.token, p.id, {
                  imageIds: [second!.id, first!.id],
                });
                assert.deepEqual(
                  reordered.images.map((image) => image.mediaAssetId),
                  [two.id, one.id],
                );
                for (const imageIds of [
                  [first!.id],
                  [first!.id, first!.id],
                  [first!.id, randomUUID()],
                  [],
                ]) {
                  await fails(
                    () => catalog.orderImages(actors.manager.token, p.id, { imageIds }),
                    'VALIDATION_FAILED',
                    'imageIds',
                  );
                }
                // The library knows where a picture is used and refuses to delete it.
                assert.deepEqual(
                  (await mediaUsages(tx, one.id)).map((usage) => [
                    usage.kind,
                    usage.id,
                    usage.title,
                  ]),
                  [['PRODUCT', p.id, p.nameVi]],
                );
                await fails(() => media.remove(ownerToken, one.id), 'MEDIA_IN_USE');
                // Product editors may list and open the library; alt editing and deleting stay with website content.
                const listed = await media.list(actors.manager.token, {});
                assert.ok(listed.items.some((item) => item.id === one.id));
                await fails(() => media.list(actors.pricer.token, {}), 'FORBIDDEN');
                await fails(() => media.list(actors.none.token, {}), 'FORBIDDEN');
                // Owner (2026-10-07): product editors also edit captions and alt text; others still cannot.
                for (const actor of [actors.pricer, actors.none]) {
                  await fails(
                    () =>
                      media.updateAlt(actor.token, bare.id, {
                        altVi: 'Sửa',
                        altEn: null,
                        expectedVersion: bare.rowVersion,
                      }),
                    'FORBIDDEN',
                  );
                }
                const described = await media.updateAlt(actors.manager.token, bare.id, {
                  altVi: 'Mô tả do người sửa sản phẩm',
                  altEn: 'Caption by a product editor',
                  expectedVersion: bare.rowVersion,
                });
                assert.equal(described.altVi, 'Mô tả do người sửa sản phẩm');
                assert.equal(described.altEn, 'Caption by a product editor');
                // Deleting stays with website content.
                await fails(() => media.remove(actors.manager.token, bare.id), 'FORBIDDEN');
                // Removal only unlinks.
                await fails(
                  () => catalog.removeImage(actors.manager.token, p.id, randomUUID()),
                  'NOT_FOUND',
                );
                const removed = await catalog.removeImage(actors.manager.token, p.id, first!.id);
                assert.deepEqual(
                  removed.images.map((image) => image.mediaAssetId),
                  [two.id],
                );
                assert.equal(
                  await tx.mediaAsset.count({ where: { id: one.id } }),
                  1,
                  'the picture stays in the library',
                );
                await media.remove(ownerToken, one.id);
              },
            );

            await suite.test(
              'a product with no brand, category, description or image',
              async () => {
                const bare = await catalog.createProduct(actors.manager.token, {
                  nameVi: 'Không nhãn',
                  nameEn: `Unbranded ${run}`,
                  descriptionVi: null,
                  descriptionEn: null,
                  brandId: null,
                  categoryId: null,
                  featured: false,
                });
                assert.equal(bare.brand, null);
                assert.equal(bare.category, null);
                assert.deepEqual(bare.images, []);
                assert.ok(bare.brandOptions.length >= 1, 'the active brands are still offered');
                const same = await catalog.editProduct(actors.manager.token, bare.id, {
                  nameVi: 'Không nhãn',
                  nameEn: `Unbranded ${run}`,
                  descriptionVi: null,
                  descriptionEn: null,
                  brandId: null,
                  categoryId: null,
                  featured: false,
                  expectedRowVersion: bare.rowVersion,
                });
                assert.equal(same.rowVersion, bare.rowVersion, 'nothing changed');
              },
            );

            await suite.test('lists: price range, cover, filters, never a cost', async () => {
              const list = await catalog.products(actors.full.token);
              noCost(list);
              const serum = list.products.find((row) => row.nameEn === `Serum ${run}`)!;
              assert.equal(serum.priceFromVnd, '170000');
              assert.equal(serum.priceToVnd, '170000');
              assert.equal(serum.activeVariantCount, 1);
              const mask = list.products.find((row) => row.nameEn === `Mask ${run}`)!;
              assert.equal(mask.priceFromVnd, '90000', 'only active, priced variants count');
              assert.equal(mask.status, 'PUBLISHED');
              assert.equal(mask.brand?.id, brand.id);
              const soap = list.products.find((row) => row.nameEn === `Soap ${run}`)!;
              assert.equal(soap.priceFromVnd, null);
              assert.ok(soap.coverMediaId);
              assert.deepEqual(list.access, { manage: true, prices: true, cost: true });
              assert.deepEqual((await catalog.products(actors.denied.token)).access, {
                manage: true,
                prices: true,
                cost: false,
              });
            });

            throw rollback;
          },
          { timeout: 240_000 },
        ),
        (error: unknown) => error === rollback,
      );
    } finally {
      await database.$disconnect();
      await rm(root, { recursive: true, force: true });
    }
  },
);
