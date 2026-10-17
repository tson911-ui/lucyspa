// Phase 6 and Phase 9 (products, inventory, imports, pricing, returns, refunds, exchanges, product and online orders, campaigns, supplier sources)
// integration tests: a THIRD process, after the main run and before the Phase 7 run, because the whole suite in one or even two processes
// outgrew the default 4 GB heap of Node ("JavaScript heap out of memory" after ~930 tests).
// Safety (Owner rule 2026-10-05): refuse to run unless DATABASE_URL names a scratch or test database.
await import('../packages/database/dist/assert-test-database.js');
process.env['RUN_AUTH_INTEGRATION'] = 'true';
await import('../apps/api/dist/products/product-catalog.integration.test.js');
await import('../apps/api/dist/products/product-preorder.integration.test.js');
await import('../apps/api/dist/products/public-products.integration.test.js');
await import('../apps/api/dist/platform/public-rate-limit.integration.test.js');
await import('../apps/api/dist/inventory/inventory.integration.test.js');
await import('../apps/api/dist/inventory/inventory.race.integration.test.js');
await import('../apps/api/dist/product-imports/import.integration.test.js');
await import('../apps/api/dist/product-imports/import-price-zip.integration.test.js');
await import('../apps/api/dist/product-imports/import.race.integration.test.js');
await import('../apps/api/dist/pos/product-sale.integration.test.js');
await import('../apps/api/dist/pos/product-sale.race.integration.test.js');
await import('../apps/api/dist/pos/pricing-v3.integration.test.js');
await import('../apps/api/dist/pos/pricing-v3.race.integration.test.js');
await import('../apps/api/dist/pos/product-counter.integration.test.js');
await import('../apps/api/dist/pos/stock-sale.integration.test.js');
await import('../apps/api/dist/pos/stock-sale.race.integration.test.js');
await import('../apps/api/dist/loyalty/beauty-loyalty.integration.test.js');
await import('../apps/api/dist/product-returns/return.integration.test.js');
await import('../apps/api/dist/product-returns/return.exception.integration.test.js');
await import('../apps/api/dist/product-returns/return.race.integration.test.js');
await import('../apps/api/dist/product-returns/refund.integration.test.js');
await import('../apps/api/dist/product-returns/refund.race.integration.test.js');
await import('../apps/api/dist/product-returns/exchange.integration.test.js');
await import('../apps/api/dist/product-returns/exchange.race.integration.test.js');
await import('../apps/api/dist/product-orders/order.integration.test.js');
await import('../apps/api/dist/product-orders/order.commands.integration.test.js');
await import('../apps/api/dist/product-orders/order.race.integration.test.js');
await import('../apps/api/dist/online-orders/online.checkout.integration.test.js');
await import('../apps/api/dist/online-orders/online.fulfilment.integration.test.js');
await import('../apps/api/dist/online-orders/online.refunds.integration.test.js');
await import('../apps/api/dist/online-orders/online.limits.integration.test.js');
await import('../apps/api/dist/online-orders/online.race.integration.test.js');
// Session 10 A2: customer account deletion (orders, sessions, sealed email, database guards of migration 20261216000000).
await import('../apps/api/dist/account/account-deletion.integration.test.js');
await import('../apps/api/dist/campaigns/campaign.integration.test.js');
await import('../apps/api/dist/supplier-sources/supplier-source.integration.test.js');
await import('../apps/api/dist/supplier-sources/supplier-source-scan.integration.test.js');
await import('../apps/api/dist/supplier-sources/supplier-source-candidates.integration.test.js');
await import('../apps/api/dist/supplier-sources/supplier-source-resync.integration.test.js');
await import('../apps/api/dist/supplier-sources/supplier-import-all.integration.test.js');
await import('../apps/api/dist/supplier-imports/supplier-import.integration.test.js');
