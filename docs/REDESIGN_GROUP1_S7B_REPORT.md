# Redesign group 1, session 7b report (customer profile edit, info pages). Local only: not pushed, not deployed.

Commits: plan decisions `f2f3e67`, item 2 `b63ebc2`, item 3 (this report's commit, see `git log`). Two migrations: `20261215000000_customer_email_change_guard`, `20261215000001_website_info_pages`.

## Item 0: the pnpm shim block (NVM4306), cleared

- Cause: NVM's `VerifyCache` records, per shim script, digest, size, mtime, file id **and the NTFS USN**. Digest, size, mtime and id still matched; only the USN of every file in the Node install had moved (npm was blocked too). That fits a security-descriptor rewrite: the tree carries ACEs for the `CodexSandboxUsers` group ("Codex sandbox internal group (managed)") and an AppContainer SID, marked inherited although no ancestor folder shows them (source undetermined). Nothing else changed since 2026-09-15.
- Content verified before touching anything: the `pnpm` 12.4.2 package and its win32 binary hash equal the npm registry tarballs (GitHub Actions trusted publisher); `packageManager` is `pnpm@12.4.2`.
- Fix: `nvm reshim` (re-baselined trust; the registry USNs now equal the files'), **not** a reinstall, because no update had happened. It may recur whenever the Codex sandbox rewrites ACLs. Whether an AppContainer SID should hold FullControl over the Node tree is the Owner's call.

## Item 2: customer profile edit

- `GET/POST /api/v1/me/profile` (session identity, name only, other fields refused as unknown). Edit dialog on `/account/profile`; header and greeting follow the new name.
- **Email goes through the existing verified flow** (password, then a code to the new address; customers sign in by email, so a plain edit would lock them out). This needed: migration `20261215000000` (`CREATE OR REPLACE` of the challenge trigger, one condition removed: a customer may hold a CHANGE_EMAIL flow), an `allowCustomer` option on `proveCurrentPassword` that only the email change sets (password change stays staff only), and neutral wording in the staff-worded code email. **This relaxes a deliberately staff-only guard: pending Owner approval.** Revert: restore the `20261003000001` function body, drop `allowCustomer`.
- **Birthday: decision needed.** Registration requires it and the column is NOT NULL, no other path creates a customer, so it is never empty: the "editable while empty" rule cannot occur. It is shown read only with a note to contact the spa; the API refuses it as an unknown field. No staff screen edits a customer's birthday yet (not built).

## Item 3: info pages

- Model `website_pages` (role INFO / POLICY / TERMS / PRIVACY, VI required, EN optional, SEO meta, publish flag, version); partial unique index keeps one published TERMS and one PRIVACY page. Admin `/api/v1/website/pages` (list, get, create, update, publish; `MANAGE_WEBSITE_CONTENT`, global; no delete). Public `/api/v1/public/pages` and `/pages/:slug`; footer links ride on the existing `/public/site` answer (`pages`).
- Text is a small markup (`##`, `###`, lists, bold, italic, links) parsed by one pure parser in `packages/contracts`; the API refuses HTML, images, other heading levels and links outside https / mailto / tel / `/vi|/en` paths / anchors. Drawn as elements, never as HTML. Popup and footer links now share the same link rule.
- Public URL `/{locale}/{slug}` through the `[...rest]` catch-all (a reserved-slug list, tested against the real routes). 404 only when the API says so; an unreachable API shows the error page. English without English text shows the Vietnamese text, marked `lang="vi"` and kept out of the index. Sitemap lists pages and `/contact`.
- Admin: "Trang thông tin" tab on Website, list, editor page (formatting bar, write/preview, SEO fields, publish switch).
- Footer: "Chính sách" column (POLICY pages) and the legal line (TERMS then PRIVACY), both hidden when none is published. TERMS and PRIVACY are **not** in the column. "Liên hệ" link added to the footer links.
- `/contact`: Google's own embed of the address (`maps?q=...&output=embed`: no key, no paid service, lazy, titled, plain link beside it). The site sets no CSP, so nothing blocks it; the render was seen in a screenshot. Pages show on the website within about 1 to 2 minutes (60 s API cache plus 60 s web memory).

## Checks (run)

`pnpm test` (all packages) green with the servers stopped; `pnpm lint`, `pnpm format:check` clean; scratch integration: `customer-profile`, `email-change`, `my-password`, `page`, `popup`, `shop-info`. Migrations applied to scratch databases only (`lucy_spa_polish1_scratch`, `lucy_spa_uxaudit_20261001`), names checked first.

## UX gate

1. Screens at 360 / 768 / 1440 light, 1440 dark, 360 at 130 % for profile, its two dialogs and error state, footer, contact, policy, admin list and editor: `.local/uxui-screens/group1-session7b/` (before and after).
2. Checked: spacing and alignment, labels, error beside the field, dialog footers (Cancel then primary), focus, dark pink accent, map render.
3. Fixed after review: a colliding `ls-contact-label`, a broken `·` escape in the legal line, a wrapped write/preview switch, uneven gaps in the editor.
4. DOM audit on `lucy_spa_uxaudit_20261001`: editor 0, pages tab 1 (two-line titles make mobile rows differ, like other lists). Public pages (harness audit): contact reports its three action pills (the C16 design), policy reports heading rhythm of user-written text.
5. Not done: 200 % text, phone checks on a device; profile page audited by screenshots only.
