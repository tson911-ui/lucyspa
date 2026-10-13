// Claude integration (CI-0 and Wave A: supplier review-text cleanup, AI settings, spending cap, key check, rewrite engine, draft review,
// the import text lock) integration tests: a FIFTH process after the Phase 8 run, for the same reason as Phases 7 and 8 (the whole suite
// in one process outgrew the default 4 GB heap of Node). The tests use a fake Anthropic server; none contacts Anthropic.
// Safety (Owner rule 2026-10-05): refuse to run unless DATABASE_URL names a scratch or test database.
await import('../packages/database/dist/assert-test-database.js');
process.env['RUN_AUTH_INTEGRATION'] = 'true';
await import('../apps/api/dist/products/product-text-cleanup.integration.test.js');
await import('../apps/api/dist/ai/ai-settings.integration.test.js');
await import('../apps/api/dist/ai/ai-spend.integration.test.js');
await import('../apps/api/dist/ai/ai-key-check.integration.test.js');
await import('../apps/api/dist/ai/rewrite-engine.integration.test.js');
await import('../apps/api/dist/ai/rewrite-pending.integration.test.js');
await import('../apps/api/dist/ai/rewrite-blanks.integration.test.js');
await import('../apps/api/dist/ai/ai-drafts.integration.test.js');
await import('../apps/api/dist/ai/ai-runs.integration.test.js');
await import('../apps/api/dist/ai/ai-approve-all.integration.test.js');
await import('../apps/api/dist/ai/ai-seo.integration.test.js');
await import('../apps/api/dist/assistant/assistant.integration.test.js');
await import('../apps/api/dist/brief/brief.integration.test.js');
await import('../apps/api/dist/bot/bot.integration.test.js');
await import('../apps/api/dist/chat/chat.integration.test.js');
await import('../apps/api/dist/product-imports/import-text-lock.integration.test.js');
