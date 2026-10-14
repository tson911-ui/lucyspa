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

1. Screens (before and after) in `.local/uxui-screens/group1-session7b/`: profile, its two dialogs and the name error, footer, contact, policy, admin list and editor (new, edit, preview), at 360 / 768 / 1440 light, 1440 dark, 360 at 130 % (admin screens at 768 / 1440 and 360 for the editor). All "after" images were recaptured from the final build.
2. Opened and checked: profile 1440 light, name dialog 1440 light, name error 360 and 1440, email dialog 1440 dark, email code step 360; policy 1440 light and dark and 360 at 130 %; contact 1440 light and dark, 768 and 360; footer 360 (seen inside the contact and policy shots: the footer shot itself stops at the 5000 px cap); admin list 1440 light and dark, editor 1440 light, 768 new, 360 edit, preview 1440; before images: profile, admin, contact, policy (the contact and policy "before" are the 404 page, the footer has no column or legal line). Not opened: the remaining 768 and 130 % variants of the profile and admin screens.
3. Fixed after review: a colliding `ls-contact-label`, a broken `·` escape in the legal line, a wrapped write/preview switch, uneven gaps in the editor, the policy column wrapping into two narrow columns on a phone (it now takes the row below 1024 px), and the email field now validates on blur (H12). The 360 contact map was still loading in one shot; the 768 and 1440 shots show it rendered.
4. DOM audit on `lucy_spa_uxaudit_20261001`, clean run of the 26 baseline pages (`results-s7b`): no count rose except `list-height-uneven` 4 to 7, all three on the **dashboard** (data-driven widget lists in the scratch data; no dashboard file changed in this session). New pages: editor 0, pages tab 1 (two-line titles make mobile rows differ, as in other lists). Public pages (harness audit): contact reports its three action pills (the C16 design), policy the heading rhythm of user-written text. Left as is: the pre-existing footer links column still wraps tightly at 130 % ("Đăng nhập / Đăng ký").
5. Kit behaviour, not changed: an empty required field in a `FormDialog` shows the browser's own bubble; the profile dialogs drop `required` so the page's own message shows beside the field instead. Not done: 200 % text, a phone, the 768 and 130 % variants listed above.
