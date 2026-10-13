# CI-E1: search descriptions and English drafts (Wave B, 2026-10-13)

Design: `docs/PHASE_CLAUDE_INTEGRATION.md` (SEO and English drafts) and the Owner's message of 2026-10-13. Claude only writes drafts; nothing reaches the website until a person with `MANAGE_SERVICES` or `MANAGE_WEBSITE_CONTENT` presses "Áp dụng". The Vietnamese text of the shop is never changed.

## What changed

- **Migration 131** (`20261213000003_claude_seo_drafts`): `seo_description_vi/en` (at most 300 characters) on `services` and `website_shop_info`; table `ai_seo_drafts` (kind SERVICE or SHOP, one open draft per target, snapshot/draft/edited/warnings, row version guard, history rows cannot be rewritten).
- **Engine** (`packages/server/src/ai`): prompt `seo-draft.v1`, strict schema, checks (wrong fact, repeated description, length, forbidden words, links, emoji, wrong language); the worker writes drafts under the same spending rules as the product rewrite (feature `SEO`, own switch `seo_enabled`, own model).
- **API** `api/v1/ai/seo-drafts`: list, detail, preview of a create, create (services without a description, or the home page), edit, apply, reject, rewrite, retry. A draft whose target changed after it was written is `STALE` and must be rewritten. Apply writes only the two search descriptions, plus an English text where the target has none.
- **Public site**: pages use the approved search description; English pages are `noindex` and left out of the sitemap and `hreflang` until their English text is approved (`englishApproved`); the shop JSON-LD has `sameAs` (Facebook) and a description.
- **Staff screen** "Mô tả tìm kiếm" (catalog menu, `USE_AI_CONTENT`): list with filters, create dialog with cost preview, draft drawer (current, draft, counter against 155 characters, warnings, apply with acknowledgement when warnings exist).
- Kit: `button.ls-link` (name cell that opens a drawer) now has the link look and a full-size target.

## Tests run

Unit: SEO draft rules (6), web helpers (4), sitemap/alternates/JSON-LD, public site parsers, nav and permissions. Integration on a scratch DB: `ai-seo.integration.test.ts` (8 steps: create rules, worker, edit, stale, apply per permission, reject, rewrite, retry). Whole-repo `pnpm test`, lint and format before the push.

## UX gate

List, ready, soft warning, blocking error, failed, stale, create dialog, rewrite and 130 % text at 360, 768, 1440 light and 1440 dark (opened and read). Fixed after review: the name buttons were native grey boxes under 44 px (kit class above); the status chip touched its text (now a `Cluster`). DOM audit of `seo-drafts`, `chat-requests` and `ai-settings`: 0 findings, nothing above the baseline.

## Open

- The Owner should look at the first real drafts before applying many.
- `sku` in the product JSON-LD still uses the public product code (earlier deviation).
