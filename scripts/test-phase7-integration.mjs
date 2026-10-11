// Phase 7 (cash book, pay rules, earnings, tips, staff codes, payroll, advances) integration tests: a SECOND process after the main run, because the
// whole suite in one process outgrew the default 4 GB heap of Node (the run died with "JavaScript heap out of memory" after ~940 tests).
// Safety (Owner rule 2026-10-05): refuse to run unless DATABASE_URL names a scratch or test database.
await import('../packages/database/dist/assert-test-database.js');
process.env['RUN_AUTH_INTEGRATION'] = 'true';
await import('../apps/api/dist/finance/cash.integration.test.js');
await import('../apps/api/dist/finance/cash-posting.integration.test.js');
await import('../apps/api/dist/finance/cash-entries.integration.test.js');
await import('../apps/api/dist/finance/cash-closing.integration.test.js');
await import('../apps/api/dist/pay/pay-config.integration.test.js');
await import('../apps/api/dist/pay/pay-earnings.integration.test.js');
await import('../apps/api/dist/pay/tips.integration.test.js');
await import('../apps/api/dist/pay/staff-codes.integration.test.js');
await import('../apps/api/dist/pay/pay-runs.integration.test.js');
await import('../apps/api/dist/pay/pay-advances.integration.test.js');
await import('../apps/api/dist/pay/pay-close.integration.test.js');
