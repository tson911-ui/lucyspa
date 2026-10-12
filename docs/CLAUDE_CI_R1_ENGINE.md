# CI-R1: the product rewrite engine (Wave A, 2026-10-12)

Design: `docs/PHASE_CLAUDE_INTEGRATION.md` sections 4.3 to 4.5, 5 and 6. No migration, no permission, no screen: this step is the worker side only. Nothing starts a run yet (CI-R3), so with the switches off (default) the engine does nothing.

## What changed

- `packages/server/src/ai/rewrite-engine.ts`: `runRewriteTick` (one tick: take up to `concurrency` queued items, write a draft for each), `leaseRewriteItems`, `buildProductSnapshot` (names, brand, category, variants, the catalog text with supplier review text removed again, supplier attributes of the source record; returns the row version it read), `shopCity` (last part of the shop address), `snapshotOf`/`attributesOf`.
- Per item: kill switch and caps re-read; reserve the most the call may cost; call Claude (no tools, strict JSON schema, run's model and effort); server checks; **ledger row + reservation release + item update in one transaction**. The catalog is never written by the engine.
- Outcomes: draft with warnings = `DRAFT_READY`; refusal = billed, `NEEDS_ATTENTION` (not retried); cut-off or invalid JSON = billed, retried after a back-off, then `NEEDS_ATTENTION`; 5xx/429/timeout = not billed, hold released, back-off 30 s then 120 s, `FAILED` after 3 attempts; bad key / Console spend limit / cap / missing rate = the active runs pause (`PAUSED_ERROR` or `PAUSED_CAP`, `pause_reason`), the item keeps its attempt; five failures in a row = pause `CIRCUIT`; a lease that ran out three times = `FAILED LEASE_EXPIRED`; unusable snapshot = `FAILED BAD_SNAPSHOT`.
- Worker `ai-jobs.ts` runs the tick after the key check; an unexpected item error is logged by name only.

## Tests run

- Unit: snapshot and attribute readers (2). API integration on a scratch DB with the fake Anthropic (16 steps): switches off, good answer (ledger, hold released, run done, catalog untouched, request has no tools/temperature), warnings (clinic word, phone, "chính hãng"), refusal, invalid JSON then success, 5xx back-off and failure, key and spend-limit pause, caps and missing rate pause (no call made), circuit after five, lease limit and no double lease, expired leases, bad snapshot, **injection corpus** (5 attacks inside the supplier text: stays inside the data block, no e-mail or link reaches the model, a compromised answer is flagged and never applied), product snapshot. Plus the 19 existing AI integration tests. Root lint, typecheck, format clean.

## Known limits

- The prompt and checks have never run against the real API (no key on this machine); the Owner's 3-product run is the first real call.
- The tests share one DB connection, so two items cannot overlap inside a test; the concurrency limit is tested at the lease, and the overlap itself is one `Promise.all`.
- Open for CI-R2/R3: regeneration sets an item back to `QUEUED` (and a `DONE` run back to `RUNNING`); cancelling a run rejects its queued items (`REJECTED`, `RUN_CANCELLED`) so their products are free again.
