// Phase 8 (reports, dashboard, export, audit-log screen, reviews) integration tests: a FOURTH process after the main runs, for the same reason
// as Phase 7 (the whole suite in one process outgrew the default 4 GB heap of Node).
// Safety (Owner rule 2026-10-05): refuse to run unless DATABASE_URL names a scratch or test database.
await import('../packages/database/dist/assert-test-database.js');
process.env['RUN_AUTH_INTEGRATION'] = 'true';
await import('../apps/api/dist/reports/reports.integration.test.js');
await import('../apps/api/dist/reports/revenue.integration.test.js');
