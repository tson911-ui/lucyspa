# CI-F2: search-description drafts: notes never block (Owner, 2026-10-13)

**What changed.** The drafts of search descriptions and English texts (services, home page) now follow the same rule as the product rewrites: the checks still run (on the model's answer and again on the final text after an edit), the notes are shown beside the draft, and **nothing refuses or delays an apply because of a note**. Removed: the "blocking" flag on a note and on a draft, `blockingWarnings` in the list, the "Tôi đã đọc các lưu ý" tick and `acknowledgeWarnings` in the apply request (API and web), and `isBlockingSeoWarning`. The audit event of an apply now lists the note codes (`noteCodes`). The list column reads "N lưu ý"; the drawer box is titled "Lưu ý của hệ thống (chỉ để tham khảo)". An empty search description is stored as no text (not an empty string).

**Unchanged.** Permissions to apply (`USE_AI_CONTENT` plus `MANAGE_SERVICES` or `MANAGE_WEBSITE_CONTENT`), the row-version and stale checks, "Owner English text is never replaced", length limits on edits, and nothing is ever applied automatically. No migration, no new permission.

**Tests.** server `seo-draft.test.ts` (6), web `ai-seo.test.ts` (4), API `ai-seo.integration.test.ts` (9, now proving a draft with a wrong-fact note and one with a link note are shown with their notes; the apply path uses no acknowledgement). Typecheck of contracts, server, api, web and lint of the touched files are clean.

**Also recorded.** Owner answer 2: chat and customer card may be switched on for internal testing; lawyer review before Phase 10 (added to `docs/REVIEW_POLISH_CHECKLIST.md` section G).

**Open.** None new.
