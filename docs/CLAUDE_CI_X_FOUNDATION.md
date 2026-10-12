# CI-X1 to CI-X3: the AI foundation (Wave A, 2026-10-12)

Design: `docs/PHASE_CLAUDE_INTEGRATION.md` sections 4.2, 5 and 9.4. Owner answers OQ-CI-3 (strongest model), OQ-CI-4 (two key groups, 3,000,000 đ cap, 5 permissions granted to nobody), OQ-CI-8 ("chính hãng" a setting, off).

## What changed

- **Migrations 123 to 125** (`20261212000000..2`, rehearsed on a fresh scratch DB and on a populated copy: 3.4 s, 40 of 92 products backfilled as `SUPPLIER_COPY`, the rest default `LUCY_MANUAL`): two enum codes, the catalog semantics check, then `ai_settings` (one row, everything off, rate NULL, cap 3,000,000 đ, Opus, "chính hãng" off, never deleted), `ai_usage_ledger` (append-only),
  `ai_reservations`, `ai_runs`, `ai_items` (one open draft per product, applied/rejected are history), and on `products`: `content_origin`, SEO title/description, the four description sections, plus a trigger that refuses an import to overwrite the text of a Lucy-owned product (`SET LOCAL lucy.text_change_source` + an explicit override). Supplier approval now writes `SUPPLIER_COPY`.
- **Permissions 77 to 79**, global, standard, granted to nobody: `MANAGE_AI_SETTINGS`, `USE_AI_CONTENT` (catalog, Prisma enum, contracts, role groups, labels vi/en, the five tests that pinned 77).
- **Server package** (`packages/server/src/ai`): `@anthropic-ai/sdk` 0.129.0 (exact, the one new dependency, 13 days old), `ClaudeClient` (streaming final message, adaptive thinking by omission, `output_config.effort` + strict JSON schema, no tools/web/temperature/prefill, refusal fallback `default` as a setting; errors classified: bad key, the two spend-limit shapes, rate, server, unreachable, timeout; a refusal, a cut-off or invalid answer is a normal outcome that carries its usage),
  the price table (micro-USD, rounded up, 2026-10-12 prices), the spending cap (monthly + per feature in VND at the typed rate, reserve before the call under an advisory lock, shop-time-zone month, expiring reservations), the ledger writer, the key check, and `FakeAnthropic` (no test contacts Anthropic). The prompt `product-rewrite.v1`, its schema and the server-side checks are in `product-rewrite.ts` (engine and runs follow in CI-R1..R3).
- **API** `api/v1/ai/settings` (get, change with row version and audit, key check request), `MANAGE_AI_SETTINGS`; the key itself never appears (only "configured"). **Worker** `ai-jobs.ts`: answers a pending key check (free call), runs even without a key. Logger redaction covers the key names (tested).
- **Screen "Cài đặt AI"** (administration menu): key status + "Kiểm tra kết nối", cost card (month spend and caps in đồng, per feature), switches, rate and caps, model/effort/concurrency/refusal fallback, "chính hãng" switch and extra blocked phrases.

## Tests run

- Server unit: prices (3), client against the fake (7: headers, schema, no forbidden params, refusal/cut-off/invalid JSON, every error class, timeout, no key = no request), rewrite prompt and checks (8), logger. DB: foundation test (permissions, settings, ledger, drafts, text lock). API integration on a scratch DB: spending cap (4), settings (5), key check (6). Web: helper (5), screen/dictionary (2), nav/role tests. Root lint, typecheck, format clean.

## UX gate (Cài đặt AI)

Rendered at 360, 768, 1440 light and 1440 dark plus 130% text (images opened and read): no overlap, one vertical rhythm, cards single-surface, footer Hoàn tác then Lưu cài đặt, 44 px controls. Fixed after review: cost list to two columns, per-feature caps labelled by feature only, repeated key-missing line removed, a wrapping switch label and a clipped model option shortened. States checked: key missing, key checked, rate empty (notice), filled with ledger rows, no access. DOM audit: 0 findings, no baseline count rose.

## Known limits

- The rewrite prompt and validator have never run against the real API (no key on this machine); the Owner's 3-product run is the first real call.
- Integration stage 2 once timed out in the walk-in race suite while the audit stack ran; the suite passes alone (known load flake, unrelated).

## Open questions

None for the Owner. The Anthropic key is pasted by the Owner (guide in the Wave A deploy guide).
