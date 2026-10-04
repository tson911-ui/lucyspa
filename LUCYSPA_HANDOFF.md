# Lucy Spa handoff (current state)

Historical detail (Phase 0-3, Phase 2 follow-up, Notification Center, Organization Hierarchy, production states,
Phase 4 Step 1-6 summaries): [docs/HANDOFF_HISTORY.md](docs/HANDOFF_HISTORY.md). Agent rules: [CLAUDE.md](CLAUDE.md).

## Start here

1. Read the PRD sections relevant to the requested task before implementation ([LUCY_SPA_PRD.md](LUCY_SPA_PRD.md);
   change it only with explicit Owner authorization), this file, and the requested Step's own doc.
2. Inspect `git status` / `git log` and the repository before changing anything. Preserve completed work.
3. One Step at a time; Owner review and checkpoint commit/push after every Step. Never deploy unless asked.
   Never touch `apps/web/next-env.d.ts`.

## Phase status

| Phase                                     | Status                                                           |
| ----------------------------------------- | ---------------------------------------------------------------- |
| Phase 0                                   | PASS                                                             |
| Phase 1 (auth and security)               | COMPLETE                                                         |
| Phase 2 (services, employees, operations) | CLOSED / PRODUCTION ACCEPTED (follow-up Steps 1-7 also accepted) |
| Phase 3 (booking, walk-in, queue)         | COMPLETE / OWNER APPROVED                                        |
| Notification Center (in-app, V1)          | CLOSED / PRODUCTION VERIFIED                                     |
| **Phase 4 (POS, invoices, payments)**     | **CLOSED / OWNER APPROVED (Steps 1-11), LIVE IN PRODUCTION**     |
| UX/UI redesign Part 1 + Part 2            | DEPLOYED (production = `58bfabc`)                                |
| **Phase 5 (loyalty and combos)**          | **IN PROGRESS (P5-4 built, not deployed)**                       |
| Phase 6+ (products, payroll, finance)     | NOT started                                                      |

## Phase 4 steps (docs: `docs/PHASE4_*`)

| Step | Name                                                                 | Status                                 |
| ---- | -------------------------------------------------------------------- | -------------------------------------- |
| 1    | Design contract (`PHASE4_POS_INVOICE_PAYMENTS_DESIGN.md`)            | CLOSED                                 |
| 2    | Visit completion carryover (manager END, cancel line)                | CLOSED                                 |
| 3    | Staff-added service                                                  | CLOSED                                 |
| 4    | POS database + permissions foundation (OP-1 quantity limit)          | CLOSED                                 |
| 5    | Invoice / POS (draft, price/quantity, payer, finalize, cancel, OP-7) | CLOSED                                 |
| 6    | Discounts / vouchers (+ historical service-category snapshot)        | CLOSED (`f898f2d`)                     |
| 7    | Cash / split payments / payment states / corrections                 | CLOSED / OWNER APPROVED (no migration) |
| 8    | PayOS (Q7 answered)                                                  | CLOSED / OWNER APPROVED                |
| 9    | Customer invoice history                                             | CLOSED / OWNER APPROVED                |
| 10   | Invoice / revenue notifications                                      | CLOSED / OWNER APPROVED                |
| 11   | Final validation (single full gate; no deploy)                       | CLOSED / OWNER APPROVED                |

Phase 4 migrations so far: Step 3 (`20261013…`), Step 4 (`20261014000000-04`), Step 6 (`20261015000000`, category snapshot), Step 8 (`20261016000000-01`), Step 10 (`20261017000000`, notifications).

## Locked Owner decisions (do not reopen; details in the Phase 4 design doc)

- **Q0** Phase 3 carryovers are in Phase 4 (manager END resolution, cancel unperformed line, staff-added service).
- **Q1** Price is permission-based, chosen inside the visit-line snapshot range; catalog changes never alter a transaction.
- **Q2** One Visit -> one active Invoice, only after COMPLETED; payer on the invoice (owner default, guest allowed); split payment, not split invoices.
- **Q3** Integer VND; percentages round half up; no cash rounding; versioned deterministic calculation.
- **Q4** No free-form discount; Owner-configured discounts/vouchers; invoice-level; no stacking; Member/Birthday/loyalty stay Phase 5.
- **Q5** No tip in Phase 4 (tip, cash safe, closing, commission, payroll = Phase 7).
- **Q6** Unpaid invoice cancellable; cash reversal needs `CORRECT_PAYMENTS` + reason + re-auth; a confirmed PayOS payment is never manually reversed; correction is not a refund.
- **Q9** Nine financial permissions, no role-name access, no automatic seeding, re-auth only for `CORRECT_PAYMENTS` and finalized-invoice cancellation.
- **Q10** UI term "Hóa đơn"; code `INV-YYMMDD-XXXXXX`; internal receipt, not an official e-invoice.
- **OP-1** Quantity limit is per Service (`services.max_quantity`), snapshotted on the line; no global setting.
- **OP-2** Amount due exactly 0 -> finalize directly to PAID, no Payment row.
- **OP-3** A per-customer usage limit needs an identified MEMBER payer; a guest is ineligible for it.
- **OP-4** `minimumSpend` uses the eligible subtotal before the benefit.
- **OP-5** Code-less promotions are automatic candidates, vouchers only once supplied; exactly one winner, deterministic tie-break.
- **OP-6** Cash is recorded by any actor with `COLLECT_PAYMENTS` in scope; server-recorded time; no re-auth for normal collection.
- **Q7** (PayOS, answered before Step 8): simulated PayOS in tests, live check only after deploy with a small amount; QR expires in 15 min; one pending request per invoice (cancel + recreate allowed); create/cancel needs `COLLECT_PAYMENTS` in scope; late confirmation recorded only if a balance remains, else anomaly for management; amount mismatch never marks paid (anomaly); a request may be partial (split with cash); no in-system correction of a PayOS-settled invoice (audited management note only, refunds Phase 6); staff can never mark a transfer received.
- **OP-7** `PAID -> CANCELLED` only for a zero-balance invoice with no payment row; needs `CANCEL_INVOICES`, reason, fresh re-auth; releases the redemption.

- **Phase 5 P5-Q1…P5-Q9** (locked 2026-10-04; table in `docs/PHASE5_LOYALTY_COMBOS_DESIGN.md` section 2.1; Phase 5 Q10 withdrawn): points start 0 at go-live, payer earns (guest: nobody), floor per invoice, new customer = phone with no completed visit, balance never < 0 (shortfall recorded and flagged), birthday and gift catalog ship empty, combos POS + members only, no notifications.

## Open Owner checkpoints (NOT decided; do not decide or implement)

- Phase 5 (2026-10-04): OQ-1 yes, P5-T1/T2/T12/T13 approved, go-live switch defaults OFF; OQ-2…OQ-11 stay open (ask only when a step is blocked): `docs/PHASE5_LOYALTY_COMBOS_DESIGN.md` section 2.3-2.4.
- P5-2 (`docs/PHASE5_STEP2_DB_PERMISSIONS_FOUNDATION.md`): migrations `20261027000000`…`20261027000003` (permission codes, semantics, loyalty foundation, combo/reward foundation); 11 permissions, nothing granted; **not deployed**; deploy = `pnpm db:deploy` then `pnpm db:permissions:sync`.
- Owner 2026-10-04 (after P5-2): P5-T3/T4/T5/T9/T11 approved; combo issued only when its invoice is PAID; go-live = new Owner-only permission `ACTIVATE_LOYALTY` + fresh re-auth, stays OFF; **no deploy until all of Phase 5 is done**; OQ-2 Owner-approved (all services earn, tips excluded); **P5-T8 REJECTED by the Owner: manual deductions above the balance are hard-blocked ("Số dư chỉ còn X điểm", nothing written); reversals keep the P5-Q5 floor-at-0 + exception**. Design doc 2.5.
- P5-3 (`docs/PHASE5_STEP3_POINTS_TIERS.md`): migrations `20261028000000`…`02` (ACTIVATE_LOYALTY code, Owner-only triggers, loyalty consumer outcomes); `loyalty` outbox consumer (earn on INVOICE_PAID, reverse on INVOICE_REOPENED/CANCELLED), manual adjustments, exceptions list, go-live screen, customer points profile; **not deployed**; deploy adds `pnpm db:permissions:sync` (53 codes) and a worker restart.
- P5-4 (`docs/PHASE5_STEP4_MEMBER_DISCOUNT.md`): migration `20261029000000`; Member Discount = tier candidate in the best-offer selection (`calculation_version = 2`, Spa tier from the balance BEFORE the invoice, snapshot on the invoice, equal amount: promotion/voucher wins per a PROVISIONAL answer on P5-T6 (pending Owner confirmation), only when go-live ON); **pending Owner confirmation: P5-T6 (tie) and the OQ-2 Member-Discount half (which services get no member discount; applied to all as the proposed default)**; also P5-T8 REJECTED by the Owner (manual deduction above the balance is hard-blocked); **not deployed**.
- Q8 (Phase 4) was answered before Step 10 (see "Q8 (notifications)" below).

## Q8 (invoice / revenue notifications) - LOCKED

In-app only (no email/Zalo). Payer: notified when invoice becomes PAID and when a finalized invoice is cancelled (no reason); nothing for drafts/partials.
PayOS request creator: notified on success or anomaly. Management: exceptions only, to `CORRECT_PAYMENTS` holders at the invoice branch (PayOS anomalies, payment reversals, finalized-invoice cancellation).
Daily revenue summary 21:30 branch-local to `VIEW_REVENUE` holders (total, cash, PayOS, paid count, pending count); revenue totals only to `VIEW_REVENUE`; exception notices show only that invoice's amounts. Routing = invoice branch + permission engine, no role names.

## Owner instruction for Step 7

Keep the payment architecture ready for a future **CARD / POS-terminal** integration, but **do NOT activate CARD**
(Lucy Spa has no POS terminal yet): no CARD method selectable, accepted or shown in the UI or API.
Step 7 (`docs/PHASE4_STEP7_PAYMENTS.md`): cash + split + reversal under `/api/v1/pos/invoices/:id/payments`; no migration; CLOSED / OWNER APPROVED.
Step 7 Owner answers: COLLECT_PAYMENTS + VIEW_INVOICES are granted together via roles (no code change); CARD reversal policy deferred until a real terminal/provider exists (open future decision); paid amount on board rows deferred to the post-Phase 4 UX/UI redesign.
CARD-ready = the per-method rule table `apps/api/src/pos/payment.methods.ts` (keyed by the DB enum, CASH only); enabling CARD is an additive enum + rule (report 6).

## Step 8 (PayOS)

Step 8 (`docs/PHASE4_STEP8_PAYOS.md`): PayOS QR requests (`COLLECT_PAYMENTS`), signed webhook, settlement core in `packages/server`, worker sweep, anomalies/notes (`CORRECT_PAYMENTS`); 2 migrations; no live call made.
Step 8 Owner answers: anomaly review and notes stay on `CORRECT_PAYMENTS` (no new permission); anomaly recipients are decided with Q8 in Step 10 (invoice page + API list suffice for now); the short memo `LUCYSPA` is fine because matching uses the PayOS order code only.
Deploy needs `PAYOS_CLIENT_ID/API_KEY/CHECKSUM_KEY` (api + worker), the webhook URL registered in PayOS, `db:permissions:sync`; then one small real payment.

## Step 9 (customer invoice history)

Step 9 (`docs/PHASE4_STEP9_CUSTOMER_INVOICES.md`): `GET /api/v1/me/invoices[/:id]`, payer = session customer and finalized only, read only; no migration.
Web `/account/invoices` (VI/EN). CLOSED / OWNER APPROVED.
Step 9 Owner answers: drafts hidden, cancelled shown as "Đã hủy" (reason hidden); guest-payer invoices never viewable/attached (V1); no customer self-pay (counter payment; online self-pay = separate future feature). Dev DB `lucy_spa_dev` is 12 migrations behind: run integration tests on a scratch DB.

## Step 10 (invoice / revenue notifications)

Step 10 (`docs/PHASE4_STEP10_INVOICE_NOTIFICATIONS.md`): Q8 policy implemented in-app only; migration `20261017000000` (`outbox_consumptions`, notification CHECKs, one summary event per branch/date).
Worker consumer `notifications` (no `published_at`) + 21:30 branch-local summary scheduler; routing by `resolvePermissionHolders`; web FINANCE tab. No new permission/env.
Step 10 Owner answers (confirmed): Owner account receives exceptions/summary via the permission engine; managers see their own reversal alerts; summary daily even with zeros (00:00-21:30, catch-up to midnight); no read-time re-check for revoked holders; expired/failed PayOS requests notify nobody. CLOSED / OWNER APPROVED.

## Step 11 (final validation)

Step 11 (`docs/PHASE4_FINAL_VALIDATION.md`): full gate on scratch DB `lucy_spa_step11_validation_20260930` (35 migrations): 917 tests pass, web build, smoke pass.
Fixed only gate-side defects (stale OpenAPI assertion in `scripts/smoke.mjs`, prettier drift). No migration, no product change (deployed later, see Production).
Report has the deployment checklist (10 pending migrations, PayOS env, webhook URL, `db:permissions:sync`, PER_NAIL limits). Step 11 and Phase 4 CLOSED / OWNER APPROVED; scratch DB dropped.

## Production

Status as of 2026-10-04 14:50 (Owner-confirmed; replaces every older "not deployed" line in this file):

- Production runs `58bfabc` (latest `main`), deployed by the Owner through the usual runbook; every deploy checks out `origin/main`.
- `pnpm db:status` on the server: up to date, so all migrations through `20261026000000_uxui_part2_footer_blocks` are applied.
- Phase 4 (POS, invoices, PayOS) is live. The PayOS checksum key was rotated on the server today and a real QR test payment was marked paid correctly. The webhook signature hotfix is deployed (it is in `main`).
- Server security today: fail2ban on, SSH password login off, server rebooted onto the new kernel, all services came back.
- Deploy only when the Owner asks. Run `pnpm db:permissions:sync` at a deployment that adds permissions.

## Known pre-existing test flakes (unrelated to Phase 4; note in one line, do not investigate)

- Two `My Income` integration assertions fail only between 15:00 and 17:00 UTC.
- Worker Step 9 notification tests (`Redis job loss…`, `real Redis delayed-job loss…`) build the visit `serviceDate` from the UTC date and fail
  when the UTC and Vietnam dates differ (roughly 17:00-24:00 UTC).

## Hotfix: PayOS webhook signature (post 82a0862, DEPLOYED with 58bfabc)

- Webhook now verifies the signature over `data` first; authentic non-payment deliveries (URL-confirmation probe) get 200 and apply nothing.
- Refusals log a sanitized reason (`PayOS webhook refused`: reason, signature length, field names). See `docs/PHASE4_HOTFIX_PAYOS_WEBHOOK_SIGNATURE.md`.

## UX/UI Redesign track, Step 1 (design contract)

- `docs/UXUI_REDESIGN_DESIGN.md`: admin first; brand red #782b37 + white, no gold; light/dark toggle; 14-step plan (kit, shell, dashboard, 3 screen migrations, website content Steps 11-13, final gate 14).
- Documentation only (PRD 4.1 updated); no code/API/migration. Step 1 CLOSED / OWNER APPROVED: all section 17 recommendations (Q-D1..Q-D6, Q-CM1..Q-CM13) accepted and LOCKED. Step 2 not started.
- Steps 2-10 change no API; only Steps 11-13 add schema/API (new GLOBAL permission MANAGE_WEBSITE_CONTENT, env MEDIA_STORAGE_DIR).

## UX/UI Redesign track, Step 2 (foundations, CLOSED / OWNER APPROVED)

- `packages/ui`: tokens v2 (`--ls-*`, light/dark, chart, scale), `base.css`, theme cookie `ls-theme` + pre-paint script + `useTheme`, `Icon` set; Be Vietnam Pro in the locale layout.
- Gold/ivory removed; `workforce.css`, `customer.css`, `globals.css` have no hex literals (guard tests). No API/DB/contract change.
- Tests: ui 18 pass (contrast table), web `styles.test.ts` 3 pass, typecheck/lint/build clean. Report: `docs/UXUI_REDESIGN_STEP2_FOUNDATIONS.md`.

## UX/UI Redesign track, Step 3 (core components, CLOSED / OWNER APPROVED; jsdom dev dependency approved for later Steps)

- `packages/ui`: Button family, feedback/toast, forms (Field, MoneyInput, Combobox...), Dialog/Drawer/ConfirmDialog/Menu, ImageUploader shell; `components.css` (tokens only). Solid danger button is dialogs-only (test).
- Web `ui.tsx` wrappers (Badge, Notice, Field, SubmitButton, ErrorState, Empty) now render them; `wf-*` CSS stays until Steps 8-10. No API/DB/contract change.
- Tests: ui 62 pass, web unit 191 pass, typecheck/lint clean. Report: `docs/UXUI_REDESIGN_STEP3_CORE_COMPONENTS.md`.

## UX/UI Redesign track, Step 4 (data components, CLOSED / OWNER APPROVED)

- `packages/ui`: `DataTable` (client/server, card list on phone with a "Sort by" select), `Pagination`/`CursorPagination`, `ListToolbar`, `FilterChips`, `DescriptionList`, `Tabs`, `useUrlState`; jsdom dev dependency added for interactive tests.
- Pilots: Employees (server paging, URL state) and Skills (client sort/filter/paging). No API/DB/contract change.
- Tests: ui 91 pass, web unit 191 pass, typecheck/lint clean. Report: `docs/UXUI_REDESIGN_STEP4_DATA_COMPONENTS.md`.

## UX/UI Redesign track, Step 5 (app shell, navigation, auth layout; CLOSED / OWNER APPROVED)

- `packages/ui`: `AppShell` (sidebar/rail/drawer, topbar), `SidebarNav`, `UserMenu`, `ThemeToggle`, `Breadcrumbs`, `AuthLayout` (centered card on a full-screen brand gradient + SVG botanical pattern), `shell.css`, auth-panel tokens, 13 nav icons.
- Web: `WorkforceShell` rebuilt on it; nav regrouped by task via `lib/workforce/nav-groups.ts` (visibility rules in `navigationFor` unchanged; `NavItem.group` values renamed); login and forgot-password use that auth layout (split layout replaced by the card on the brand background after Owner correction); auth card UX pass: segmented identifier control, show/hide password, forgot link in the label row, token rhythm and shadow; dead `wf-topbar/nav/body` CSS removed.
- Tests: ui 108 pass, web unit 200 pass, typecheck/lint clean. Report: `docs/UXUI_REDESIGN_STEP5_SHELL_AUTH.md`.

## UX/UI Redesign track, decision D12 (seasonal/holiday themes, DOCS ONLY)

- Owner decision 2026-09-30: preset seasonal theme layer (customer side visible, admin subtle), Owner-scheduled, one active at a time, no builder. Design: `docs/UXUI_REDESIGN_DESIGN.md` section 20 (Steps S1-S5, open questions Q-S1..Q-S11); PRD 4.1/4.4 noted.
- No code, schema or API change. Step 5 needs no rework; three small adjustments are planned inside S1 (20.9).

## UX/UI Redesign track, UX quality gate (docs + tooling; Owner rule, mandatory for every remaining UI Step)

- `docs/UXUI_REDESIGN_DESIGN.md` section 21 (checklist, procedure, review of Steps 2-5: findings F1-F14, not fixed) and a short rule in `CLAUDE.md`. Tool: `node scripts/uxui-screens.mjs <name> <url-or-html>` (360/768/1440, light/dark, audit) writing to `.local/uxui-screens/` (git-ignored).
- Owner decision pending: run a "Step 5b: UX gate fixes" Step before Step 6.

### UX/UI Step 5b (UX gate fixes) - CLOSED / OWNER APPROVED

- F1-F12, F14 fixed plus open states (overlay, drawer, user menu, filter sheet); F13 stays with Step 8.
- New auth header: display wordmark, "Đăng nhập"/"Sign in", "Dành cho nhân viên"/"For staff". Report: `docs/UXUI_REDESIGN_STEP5B_UX_FIXES.md`.
- Motion (15a7783) and gate (34b62e7) commits are pushed; the 5b changes are committed.
- Known item for Step 14: `employee-detail.test.tsx` fails when run from the repo root ("React is not defined"); it passes from `apps/web`.

### UX/UI Step 6 (sortable primitives + chart kit) - committed 2264a86, deployed

- `packages/ui`: SortableList/Grid (dnd-kit, keyboard + Move buttons), LineChart/BarChart/DonutChart/Sparkline/KpiCard/ChartFrame, DateRangePicker + ComparisonToggle; new deps dnd-kit, d3-scale, d3-shape (Q-D1).
- No API, DB, permission or screen change; the dashboard (Step 7) is the first user. 195 ui tests pass; palette validator runs in a test.
- Report: `docs/UXUI_REDESIGN_STEP6_SORTABLE_CHARTS.md` (UX gate images in `.local/uxui-screens/6-*`). Not committed.

### UX/UI Step 7 (dashboard) - CLOSED / OWNER APPROVED

- Widget dashboard on the kit: shared `Card`/`Stat` in `packages/ui`, 11 permission-gated widgets, customize mode (drag, keyboard, Move buttons, size, hide), layout in localStorage per user and device.
- Comparison loader requests exactly as many previous days as current days (`previousWindow`/`loadPreviousBoard`); requests are de-duplicated and refreshed on focus and every 5 min.
- No API, DB or permission change. 199 ui + 57 targeted web tests pass. Report: `docs/UXUI_REDESIGN_STEP7_DASHBOARD.md`. Owner accepted: branch-only scope, 12 columns from 1280 px, 200-invoice cap warning.

### UX/UI Step 7.5a (frontend rules + gate v2) - CLOSED / OWNER APPROVED

- Design contract 21.4 (FR1-FR15) and 21.5 (gate v2) written; 9.1/10.3/10.4/21.1-1 amended as the Owner approved; CLAUDE.md digest added. No UI, API or DB change.
- Tooling: scripts/uxui-page-audit.js (DOM audit, rule-tagged), scripts/uxui-audit-summary.mjs (--write/--compare), apps/web/src/test/ui-ratchet.test.ts (counters only go down).
- Baseline: 26 pages x 3 widths on scratch DB lucy_spa_uxaudit_20261001 in docs/uxui-audit-baseline.json and docs/UXUI_AUDIT_BASELINE_7_5A.md. Report: docs/UXUI_REDESIGN_STEP7_5A_RULES_GATE.md. Also a PreToolUse hook (.claude/settings.json) blocks Bash heredocs.
- Next: 7.5b (page frame); after 7.5b and 7.5d the Owner deploys and reviews before the next session.

### UX/UI Step 7.5b (page frame) - committed 5039dd0, deployed

- packages/ui: Page, PageHeader, Stack/Cluster/Grid; Card flush context (table/empty inside a card lose their border; nested Card logs in dev); RouteFade stack. Workforce shell wraps in Page; ui.tsx PageHeader/Section are kit components; workforce.css remapped to tokens (0 spacing literals).
- Nav gap/active bar on the 4 px grid; Leave table scrolls inside its card. Ratchet lowered (wf uses 720, spacing literals 0). No API/DB change.
- 207 ui + 233 web tests pass; DOM audit of Dashboard/Employees/Skills/Branches/Leave: no count rose. Report: docs/UXUI_REDESIGN_STEP7_5B_PAGE_FRAME.md. Next: Owner deploy check, then 7.5c.

### UX/UI Step 7.5c (data frame) - committed 7a51634, deployed

- packages/ui: DataTable column policy + required paging (dev guard), RowActions = single menu, FacetedFilter, MultiValue, ListSection, ListToolbar/Pagination layout, single-border table surface. Employees and Skills re-fitted (Skills edit now a row-menu dialog).
- 217 ui + 233 web tests pass; DOM audit employees 54->18, skills 142->21, no type rose. Radix not needed (spike found no gap). No API/DB change.
- Review 1 applied: columns hide by width (no page scroll 360-1920), audit script false positives only. Header not sticky on desktop. Report: docs/UXUI_REDESIGN_STEP7_5C_DATA_FRAME.md. Next: Owner review, then 7.5d (forms/overlays) + deploy check.

### UX/UI Step 7.5d (forms and overlays + hover theme) - committed 70a5c9a (with 7.5e-f), deployed

- packages/ui: FormGrid, CheckField, Disclosure, FormDialog, FormDrawer (discard guard, busy, error focus), FormSection without fieldset, FormActions Cancel then Save, field/dialog width tokens. Skills (create/edit dialog, status confirm in row menu) and Branches (DataTable + create dialog) migrated.
- Hover theme by tokens (--ls-hover-*): light = very light brand red + #782b37, dark unchanged; WCAG tests in tokens.test.ts. 232 ui + 233 web tests pass; ratchet lowered. Report: docs/UXUI_REDESIGN_STEP7_5D_FORMS_OVERLAYS.md.
- Owner chose to run 7.5d-7.5f back to back, then deploy and review once.

### UX/UI Step 7.5e (dashboard and tabs) - committed 70a5c9a, deployed

- Widget titles clamp to one line (value rows align), branch select 280 px without label, layout button "Sắp xếp bố cục" + banner card, recovery email action in the card header, notices inside cards are flush, empty paid chart = EmptyState, Organization tabs on the kit Tabs.
- 233 ui + 235 web tests pass; dashboard audit 86->15 findings. Report: docs/UXUI_REDESIGN_STEP7_5E_DASHBOARD_TABS.md.

### UX/UI Step 7.5f (closing verification) - committed 70a5c9a, deployed

- Full DOM audit 26 pages x 3 widths: 2296 -> 529 findings (docs/UXUI_AUDIT_AFTER_7_5.md, snapshot docs/uxui-audit-after-7_5.json); ratchet lowered (wf uses 698, details 20, raw tables 23). Design contract 6.3 (hover) and 18 (Steps 8-10 remap) updated.
- Report: docs/UXUI_REDESIGN_STEP7_5F_CLOSING.md. Next after the Owner check: Step 9a Services (then 8a-8c, 9b-9c, 10a-10b).
- Owner review of 7.5d-f: raw checkboxes of Roles, Service detail and Team detail now CheckField (small-target 43 -> 23, no check above baseline; audit script measures a kit .ls-check-field row); toasts to be mounted in Step 8a (success = toast, errors in place); Skills deactivate-with-reason wording approved.

### UX/UI Step 9a (Services) - committed 97c536e, deployed

- Services/Categories in `Tabs`; `DataTable` client mode (search, category + status filters, sort, 20/page), row `⋮` (Details, (De)activate with reason, Delete), create = `FormDrawer`, category create/edit = `FormDialog`; `ConfirmDeleteDialog` removed. No API change.
- Ratchet: raw tables 23 -> 21, wf uses 698 -> 664, details 20 -> 17. Web targeted tests 23/23; DOM audit services 128 -> 36 (only the known icon-only phone Filter false positive rose).
- Build for the audit needs API_UPSTREAM_ORIGIN at build time. Report: docs/UXUI_REDESIGN_STEP9A_SERVICES.md. Owner said 7.5 "chua on lam"; specific notes pending.

### UX/UI Step 8a (Skills, Roles, Teams, toasts, permission-change notice) - committed 390b355, deployed

- Toast provider in the workforce shell (success = toast, errors in place); API 401 `reason: AUTHORIZATION_CHANGED` (tested) + web passive `/auth/me` check on focus and every 3 min, wording "Quyền của bạn đã thay đổi, vui lòng đăng nhập lại". No in-session permission refresh.
- Roles = DataTable + FormDrawer with grouped permission matrix; Teams list = server DataTable; Team detail = breadcrumbs, header actions, Tabs, kit `SelectionBar` for bulk members. Kit: numeric/end alignment specificity fix, breadcrumb targets, `useOptionalToast`.
- Ratchet: raw tables 19, wf uses 604, details 12, fieldsets 17, solid danger 8. Tests: web 246, ui 235, api targeted + 2 integration files on the scratch DB. Report: docs/UXUI_REDESIGN_STEP8A_PEOPLE.md.
- Owner approved 8a: bulk member actions via SelectionBar = approved exception to contract 10.4; CSRF guard answers 401 (+ AUTHORIZATION_CHANGED reason) for an ended signed-in session before checking CSRF (wrong CSRF on a valid session stays 403).

### UX/UI Step 8b (Employees: detail, lifecycle, roles, skills, create) - committed 3459413, deployed

- Employee detail = breadcrumbs, `⋮` menu + primary Edit profile, 4 Tabs (profile + account, employment history, roles and branches, skills); promote/end/password/profile = FormDialog, disable/re-enable sign-in and removals = ConfirmDialog; all `<details>` forms gone. Create = own page `/employees/new` (toast + member page after success).
- Kit: `ListSection actions`, `.ls-field` no longer stretches controls in a grid row, `RadioGroup` row-wide targets. Ratchet: raw tables 18, wf uses 483, details 7, fieldsets 11, checkboxes 9.
- Tests: web 246, ui 236. DOM audit employee-detail 238 -> 13. Report: docs/UXUI_REDESIGN_STEP8B_EMPLOYEES.md. Next: 8c (Organization).

### UX/UI Step 8c (Organization: regions, areas, branch placement, appointments) - committed a9887ba, deployed

- Page = header action per tab + one Notice + 4 Tabs (`?tab=`), each a client DataTable (20/page, sort, `⋮`) with ListToolbar (search + 1 filter); all forms are FormDialog (create/rename/edit/placement/appoint with employee Combobox), activate/deactivate and end appointment are ConfirmDialog with required reason; `<details>`, inline row editing and `window.prompt` removed. No API/DB/permission change.
- Ratchet: raw tables 14, wf uses 439, details 4, checkboxes 8, solid danger 6. Tests: new organization-list + screen tests, 25/25 targeted. DOM audit organization 67 -> 40 (rest = kit polish, plan section 11). Report: docs/UXUI_REDESIGN_STEP8C_ORGANIZATION.md. Next: 9b (Service detail, Branches detail, Discounts).

### UX/UI Step 9b (Service detail, Branch detail, Discounts list/detail/create) - committed 1377faf, deployed

- Service/Branch/Discount details = breadcrumbs, `⋮` menu + primary action, read-only `DescriptionList` cards or Tabs; edits are FormDrawer/FormDialog, status/terminate are ConfirmDialog with required reason. Discounts list = client DataTable + toolbar (URL state); create = own page `/discounts/new`, new version = own page `/discounts/[id]/versions/new` (Owner approved 9b). No API/DB/permission change.
- Ratchet: raw tables 10, wf uses 397, fieldsets 7, checkboxes 4. Tests: 46 targeted green. DOM audit service-detail 135 -> 14, branch-detail 89 -> 14, discount-detail 78 -> 14, discounts 56 -> 36. Report: docs/UXUI_REDESIGN_STEP9B_DETAILS_DISCOUNTS.md. Next: 9c (POS, invoice, payments).

### UX/UI Step 9c (POS board, invoice, payments) - committed 042a99b, deployed

- UI only. Board = toolbar + two DataTables; invoice = breadcrumbs, header `⋮` cancel + primary Finalize, cards (lines+totals, discount, promo codes, payer, payments, PayOS wait, anomalies, notes); every form is a FormDialog, reversal/cancel are ConfirmDialog with reason, re-auth unchanged. `DescriptionList layout="totals"` added. No API/DB/permission change; behavior differences listed in the report.
- Ratchet: raw tables 6, wf uses 334. Tests 39 web + 21 ui green. Scratch-DB money flow 29/29 (open, price, promo, finalize, cash, PayOS QR via simulator, PAID, reversal, cancel). Report: docs/UXUI_REDESIGN_STEP9C_POS_INVOICES.md. Next: Kit polish (plan section 11, incl. neutral password-dialog wording), then 10a.

### UX/UI Kit polish (plan section 11) - committed d1f5aae, deployed

- Kit only: Badge 4/8 padding, Notice 1 px border + card radius, phone card title 2-line clamp with reserved height + `minmax(0,1fr)` tracks (overflow 98 -> 2), `ReauthDialog` on `FormDialog` with neutral text (VI/EN). Audit script: hidden-text and docked-chrome false positives fixed.
- Ratchet wf 325, css literals 6. Tests ui 238 + web targeted 8 green. DOM audit: no type rose, off-grid 1202 -> 24. Report: docs/UXUI_REDESIGN_KIT_POLISH.md. Next: 10a.

### UX/UI Step 10a (Booking board, walk-in, reassignment) - committed c65e48b, deployed

- UI only. Board = toolbar + DataTables (bookings, open-visit lines, pool) + equal-height queue cards; check-in is a row button (short confirm; no undo in the API), other decisions in the row `⋮`; walk-in = form page + member-lookup dialog; reassignment = toolbar + DataTable + dialog. Tablet fit measured (0 px over at 768/1024/1280). Real flows on scratch DB (bookings via API): arrive, late arrival, priority, KTV start/end, forgotten END, change staff, no-show all PASS.
- Ratchet wf 237, raw tables 5, fieldsets 5, checkboxes 2, solid danger 3. Web 275 + ui 238 green. DOM audit board 123 -> 6, walk-in 62 -> 2, reassignment 58 -> 2 (phone card row-height-uneven +2, Owner-approved exception). Report: docs/UXUI_REDESIGN_STEP10A_BOOKING_WALKIN_REASSIGN.md. Next: 10b.

### UX/UI Step 10b (My services, schedule, attendance, leave, account, income, notifications) - committed c283f90, deployed

- UI only. Cards for My services; DataTables + toolbars for schedule, attendance, leave, notifications; every create/edit/decision is a dialog or drawer, destructive ones a `ConfirmDialog`; leave tablet overflow fixed. `workforce.css` deleted: the rules the member area still uses moved unchanged into `customer.css` (Part 2 removes them).
- Ratchet: raw tables 0, details 0, wf uses 80, fieldsets 4, checkboxes 1, solid danger 1 (all member area). Web 275 + ui 11 css tests green. Scratch-DB flows 65/65 (leave, attendance check-in/out, profile, collaborator schedule, KTV Start/End/Add service). Report: docs/UXUI_REDESIGN_STEP10B_PERSONAL_PAGES.md.
- Open for the Owner: "Nhận khách" icon-only below 1280 px (check on the counter machine). Cards, phone exception and merged filter approved. Next: 11 (website content).

### UX/UI Step 11 (website media library) - committed c2656ef, deployed

- First Step with API + DB since the redesign started: 2 additive migrations (`MANAGE_WEBSITE_CONTENT` GLOBAL_ONLY, `media_assets` + `media_variants`), `sharp`, `MediaStorage` (local disk), upload/list/alt/delete/serve API with audit, library page `/website` (grid, upload queue, drawer, delete). **Deploy needs**: env `MEDIA_STORAGE_DIR` (required in production, outside the release folder, in backups), `db:deploy`, `db:permissions:sync`.
- Public serving and "used in" arrive with Steps 12/13. CLAUDE.md now requires `pnpm test` (whole repo) before every push. Report: docs/UXUI_REDESIGN_STEP11_MEDIA_LIBRARY.md. Next: 12 (popup).

### UX/UI Step 12 (promotional popup) - committed 2526a51, deployed

- 1 additive migration (`website_popups`), no new permission or env. Admin API (`/api/v1/website/popups`, audit, versions), one enabled popup per instant (advisory lock, `POPUP_OVERLAP` names the other popup), image needs Vietnamese alt, media delete now refused while a popup uses the image. Public anonymous `GET /api/v1/public/website/popup` and `/api/v1/public/media/:id/:variant` (only live-popup images).
- Web: `/website` tabs Media | Popup, popup list + schedule strip, form pages `/website/popups/new|:id` with live preview, `MediaPicker`; public home page shows the popup once per session. Kit: `PromoCard/PromoDialog/PromoPreview/ScheduleStrip`. Quality gate (screenshots, DOM audit, browser flow) deferred to Step 14 by Owner decision. Report: docs/UXUI_REDESIGN_STEP12_POPUP.md. Next: 13 (slider).

### UX/UI Step 13 (homepage slider) - committed bf8bf81, pushed, DEPLOYED to production (Owner-confirmed 2026-10-02; runbook docs/DEPLOY_STEP13_RUNBOOK.md)

- 1 additive migration (`website_slides`), no new permission or env. Admin API (`/api/v1/website/slides`, audit, versions, `POST reorder` in one transaction, max 8 visible at once: `SLIDE_LIMIT`), media delete/alt rules and public image serving now include slides; public `GET /api/v1/public/website/slides`.
- Web: `/website?tab=slider` (sortable list, status, schedule, row menu, add/edit drawer); public home page shows the slider (autoplay 6 s, pause on hover/focus/touch + Pause button, none under reduced motion). Kit: `Slider`, `MediaRow`. Quality gate (screenshots, DOM audit, browser flow) deferred to Step 14 by Owner decision.
- Whole-repo `pnpm test`, lint, format, typecheck green; scratch-DB integration green. Report: docs/UXUI_REDESIGN_STEP13_SLIDER.md. Next: S1-S5 (seasonal), then 14 (final gate).

### UX/UI workforce shell feedback (b568c5b..684b9ee) - committed, pushed, DEPLOYED to production (Owner-confirmed 2026-10-02)

- Solid brand sidebar hover/current page, theme Auto by time (replaces System), collapsible sidebar groups, solid brand hover tokens everywhere, charts re-measure after the table view, theme survives a locale switch. HEAD 684b9ee. Next: S1-S5 (design 20.8), Step 14 final gate, then Part 2 (customer pages, own contract).

### UX/UI Step S1 (season registry, tokens, admin accent line) - implemented 2026-10-02 on f219980

- Owner decisions Q-S1..Q-S11 locked in design 20.10 (scoped yellow exception: Tet and Mid-Autumn ornaments only). Contracts `season-registry.ts` (8 presets, approved greetings and windows); ui `season-css.ts` generates `season.css` (`pnpm season:css`), neutral `--ls-season-*` defaults, topbar accent line (transparent by default); root layout imports `season.css`, inert until S5.
- No API, DB, permission or migration change. Tests: new `season.test.ts` (contrast presets x themes, hue rules, freshness); ui 286/286, lint, format, whole-repo `pnpm test` green. DOM audit dashboard 86 -> 10, login 11 -> 10.
- Report: docs/UXUI_REDESIGN_S1_SEASON_REGISTRY.md. S1 committed 796cdf1, CI green.

### UX/UI Step S2 (season decoration kit) - implemented 2026-10-02 on 796cdf1

- Kit in `packages/ui`: 8 inline-SVG ornaments, `SeasonFrame`/`GreetingStrip`, `SeasonParticles` (max 24, 12 on phones, only in the band gutters, none under reduced motion or `ls-fx=off`, paused in a hidden tab), `SeasonFxToggle`, `season-decor.css`. Registry gains `particle` per preset; S1 ornament colors re-chosen (3:1 on the frame, yellow only Tet and Mid-Autumn). Inert until S5.
- No API, DB, permission or migration change. New jsdom, css, fx-core and registry tests; whole-repo `pnpm test`, lint, format green. DOM audit dashboard 86 -> 10, login 11 -> 10. Specimens (Owner review of the art): `.local/season-s2-specimens/`.
- Art revision after Owner review: Christmas tree/star/baubles/bell, Mid-Autumn star lantern + moon, 30/4 and 2/9 red banner + solid yellow star + fireworks; yellow exception now covers those four presets (ornaments only). Report: docs/UXUI_REDESIGN_S2_DECORATION_KIT.md. Next: S3 (`website_seasons` migration and API).

### UX/UI Step S3 (seasons table, admin API, public endpoint, holiday links) - implemented 2026-10-02 on 679b568

- Migration `20261021000000_uxui_s3_website_seasons`: `website_seasons` + nullable `season_id` on popups and slides (RESTRICT). API `/api/v1/website/seasons` (MANAGE_WEBSITE_CONTENT, GLOBAL): CRUD, enable, delete rule A (items unlinked and hidden), `SEASON_OVERLAP`, audit; public `GET /api/v1/public/website/season?locale=` (60 s, 204 when none). No new permission or env.
- Linked popups/slides store the season window, follow its switch (public, overlap, 8-slide limit, image serving) and are re-checked on every season save. Lock order: season lock, popup/slide lock, rows. Report: docs/UXUI_REDESIGN_S3_SEASONS_API.md. Next: S4 (admin Seasons tab), S5 (wiring).

### UX/UI Step S4 (admin Seasons tab) - implemented 2026-10-02 on 498aa98

- Website tab "Mùa lễ" (?tab=season): DataTable + schedule strip + status/year filters; form pages /website/seasons/new and /:id (theme picker, inclusive last day in Vietnam time, suggested days for solar holidays, greeting VI/EN, switches, preview, holiday content). Kit: SeasonPreview (desktop/phone x light/dark via data-preview-theme scope in tokens.css + forced rules in season.css), SeasonPresetPicker, season-preview.css.
- Popup form and slide drawer got a Follow-a-season select (dates disabled, seasonId always sent). Web only, no API change. Report: docs/UXUI_REDESIGN_S4_SEASONS_TAB.md. Next: S5 (wiring).

### UX/UI Step S5 (season wiring) - implemented 2026-10-02 on 5375b0a

- Root layout reads the public season (server, 60 s cache, 1.5 s timeout, fail closed) and sets html data-season and data-season-admin (cookie ls-season-admin for the per-device hide). Customer public shell and member area get SeasonBand (frame, greeting, particles, Turn off effects); dashboard gets the admin greeting chip with Hide/Show. Web only, no API change; mobile reads the same endpoint plus the shared registry and bundles its own ornaments.
- Report: docs/UXUI_REDESIGN_S5_WIRING.md. S1-S5 complete; deploy runbook: docs/DEPLOY_S1_S5_RUNBOOK.md. Next: Step 14 final gate, Part 2.

### UX/UI Step S6a (season art engine) - implemented 2026-10-02 on 8322941

- Site-wide season art: slots (header row, logo accent, corners, dividers, strip, footer scene, tint) and particles behind content with a text keep-out mask; Tet (computed lunar year, goat art for 2027 only) and Christmas kits. Registry gained art palettes; lunar-year.ts in contracts.
- Screenshot gate fails hard (exit 3) on errors; CLAUDE.md: open every screenshot. Report: docs/UXUI_REDESIGN_S6A_ENGINE.md. Next: S6b (migration, admin Decoration section, custom events, Celebration kit).

### UX/UI Step S6b+S6c (decoration options, custom events, Celebration kit, full-page preview) - implemented 2026-10-02 on 7ac7476

- Migration 20261022000000 (9 season columns + website_season_slot_media); API: per-slot switches, density, greeting switches, image per slot (media usage kind SEASON, public serving while live); public season payload gained slots/density/media.
- Admin form: Event name first, base kit, computed Tet year name, Decoration section; full-page preview route /:locale/season-preview (session-guarded 404, SAMEORIGIN, postMessage draft). Celebration kit (balloons, confetti, ribbons, cake).
- Report: docs/UXUI_REDESIGN_S6B_DECORATION.md. Next: S6d (Valentine, 8/3, 20/10 kits), S6e (Mid-Autumn, Vu Lan, 30/4-1/5, 2/9).

### UX/UI Step S6d (Valentine, 8/3, 20/10 kits + shared kit engine) - implemented 2026-10-03 on d3ac883

- `season-kits.tsx` table (rail, corner, logo, divider, one-SVG footer scene cropped to its centre, particle glyph) shared by all new kits; Valentine (roses, chocolates, love letters, cupid), 8/3 and 20/10 (bouquets, ao dai, non la, gift boxes; orchid/tulip and lotus variants). Plaque lines avoid circumflex+tone (Georgia on Windows).
- Web UI only, no migration. Report: docs/UXUI_REDESIGN_S6D_KITS.md. Next: S6e (Mid-Autumn, 30/4-1/5, 2/9, Vu Lan).

### UX/UI Step S6e (Mid-Autumn, 30/4-1/5, 2/9, Vu Lan kits) - implemented 2026-10-03 on S6d

- Mid-Autumn (lanterns, moon with banyan, Chi Hang and Chu Cuoi, jade rabbit, mooncakes, lion dance), 30/4-1/5 and 2/9 (flag bunting, fireworks, doves, lotus), new kit `vu-lan` (lotus lanterns on water, rose on shirt, lotus; particles off by default via `particlesDefault`). All ten kits now have site art: the S5 band is removed.
- No migration (kit = registry entry). Report: docs/UXUI_REDESIGN_S6E_KITS.md. Production deploy of S6a-S6e: docs/DEPLOY_S6_RUNBOOK.md. Next: Step 14 final gate, Part 2.

### UX/UI Step S6f (Vietnamese display font, full phone footer) - implemented 2026-10-03 on 9a2bfed

- Display font is self-hosted Playfair Display (normal + italic, latin + vietnamese) instead of Georgia; 8/3 plaque line restored to "Chúc mừng Quốc tế Phụ nữ 8/3"; the circumflex+tone guard test is replaced by font and mark-rendering tests.
- Phone footer shows every motif: panorama kits draw a centre row plus two side crops (per-kit `split` in `KIT_ART`), Tet gets a shelf row, Christmas a tree/gifts/snowman/Santa row, Celebration its gift piles; tablets (761-1023 px) get the same full footers at tablet sizes. Report: docs/UXUI_REDESIGN_S6F_PHONE_FONT.md.
- Mid-Autumn lion dance redrawn (`season-art-lion.tsx`: horn, mirror, eyes, beard, scaled cloth, four human legs) with Ong Dia and cymbals; Valentine lost Cupid (teddy bears hugging a heart, heart with an arrow; `wing` color removed, `pnpm season:css` rerun).

### UX/UI Step 14 (Part 1 final gate) - run 2026-10-03 on 219d33e

- Full gate green on the real app + scratch DBs: pnpm check, integration 70+5 and 478, smoke, DOM audit and axe on 52 pages x 360/768/1440 x light/dark (axe 0), Step 12/13 browser flow, S3/Step 12/13 lock races (website.race.integration.test.ts, mutation-checked).
- Fixed: API keep-alive (proxy ECONNRESET), slide rows/date inputs/card titles/breadcrumbs at 360 px, axe heading/radiogroup/landmark findings, kit spacing literals to tokens. Report: docs/UXUI_REDESIGN_STEP14_FINAL_GATE.md (with the deploy checklist).
- Left for Part 2 (customer area): ratchet wfClassUses 80, nativeFieldsets 4, nativeCheckboxes 1, solidDangerButtons 1.

### UX/UI Part 2 contract and plan (customer area + public site) - approved 2026-10-03

- docs/UXUI_REDESIGN_PART2_DESIGN.md (contract) + _PLAN.md (steps P2-1..P2-10) + mockups in docs/mockups/part2 (home, booking; real tokens, light/dark, 360/1440 reviewed).
- Decisions: one site chrome for public + member, 4-step booking on unchanged API, new public site/services endpoints + website_shop_info (Owner-editable), Owner seed data, motion tokens scoped to .ls-site, all four Part 2 ratchet counters to 0.
- Owner answered Q-P2-1..11 on 2026-10-03 (contract section 10): no guest booking, no "why choose us" section, SEO now; P2-1..P2-10 implementation follows.

### UX/UI Part 2 Step P2-1 (foundations) - 2026-10-03

- Tokens (3xl, display, customer motion), Playfair 500/600, kit site frame (SiteHeader/Nav/TabBar/Footer/Band/PublicPage/PriceList/Steps/ChoiceCard/Reveal/ThemeCycle, site.css), siteNav registry, shared chrome + interim home hero; legacy welcome/site-header CSS deleted. Report: docs/UXUI_REDESIGN_PART2_P2-1_FOUNDATIONS.md.
- Audit script knows the public frame (display tokens, hero actions, ls-site-main). Ratchet gained siteCssSpacingLiterals 0. No migration, no permission change.

### UX/UI Part 2 Step P2-2 (shop info + public endpoints) - 2026-10-03

- Migration 20261023000000 website_shop_info (one row, Owner seed); admin GET/POST /website/shop-info; public GET /public/site, /public/services, /public/services/:code (60 s cache, no internal duration). Report: docs/UXUI_REDESIGN_PART2_P2-2_BACKEND.md.
- No new permission. Deploy: db:deploy (additive). Hero image is a media use (SHOP_INFO).

### UX/UI Part 2 Step P2-3 (admin Shop info tab) - 2026-10-03

- Website page gets a Shop info tab (tagline VI/EN, address, hotline, https map link, home image, hours branch, preview); lib/hours.ts shared with the public site. Report: docs/UXUI_REDESIGN_PART2_P2-3_SHOP_INFO_TAB.md. No migration, no permission change.

### UX/UI Part 2 Step P2-4 (public home + services pages) - 2026-10-03, STOP for Owner review

- Home from live data (tagline, facts, catalogue group cards, visit, footer contact), /services list + detail (real 404s), hero = slide / chosen picture / brand panel, no why-choose-us. Report: docs/UXUI_REDESIGN_PART2_P2-4_HOME.md.
- Fixed on the way: ended season stayed on the site (Next fetch cache never stores 204; now 60 s ttl-memo), slider box stretched by portrait images, class clash .ls-facts. P2-5 folded into P2-7/P2-9.

### UX/UI Part 2 handoff note - 2026-10-03

- docs/PART2_HANDOFF.md holds the state (P2-1..P2-4 done, CI green at 5ec3cdb), Owner decisions, lessons (run pnpm lint and pnpm smoke before pushing; the Owner checks CI), tooling and the next steps (Owner reviews the home, then P2-6).

### UX/UI Part 2 Step P2-6 (member auth + account control) - 2026-10-03

- Auth pages as one centered card in the shared site frame (SegmentedControl, show/hide password, next kept); header account menu (signed out/in) + bell; member area moved onto the shared frame with a SiteSubNav row; customer.css shell/login rules removed, wfClassUses 80 -> 65.
- Report: docs/UXUI_REDESIGN_PART2_P2-6_MEMBER_AUTH.md. No migration, no permission, no API change.

### UX/UI Part 2 Step P2-7 (booking in four steps) - 2026-10-03

- Booking page: 4 steps (services, guests, staff and time, confirm), ChoiceCard rows grouped by category, sticky summary (desktop) / action bar (phone), ?service=CODE preselect, per-nail note and total with "+ giá theo ngón"; branch asked only with more than one branch. nativeFieldsets 0, nativeCheckboxes 0.
- Report: docs/UXUI_REDESIGN_PART2_P2-7_BOOKING.md. API and booking rules unchanged; no migration.

### UX/UI Part 2 Step P2-8 (member area on the kit) - 2026-10-03

- Overview, bookings and invoices as DataTable + Pagination (cursor "Xem thêm" for invoices), detail pages as Cards, cancel via ConfirmDialog (danger, reason); customer.css, wf-app, cu-* deleted. Ratchet wfClassUses, nativeFieldsets, nativeCheckboxes, solidDangerButtons all 0.
- Report: docs/UXUI_REDESIGN_PART2_P2-8_MEMBER_AREA.md. No API change, no migration.

### UX/UI Part 2 Step P2-9 (motion pass + search-engine data) - 2026-10-03

- Motion M1-M7 on tokens (hero settle/zoom/parallax in @supports, route fade on public + account, booking micro-motion, MotionGate for data saver/low memory). SEO for home, services list and service pages only: metadata, canonical + hreflang, Open Graph, /sitemap.xml, /robots.txt, LocalBusiness JSON-LD; origin from the request host, no new env var; account/auth/staff stay noindex.
- Report: docs/UXUI_REDESIGN_PART2_P2-9_MOTION_SEO.md. No API change, no migration.

### UX/UI Part 2 header review note (Owner, 2026-10-03) - follow-up to P2-6

- Header per the Lovable reference: logo, menu Trang chủ / Dịch vụ / Lịch hẹn / Hóa đơn (the last two for signed-in members only, via the nav registry and a shared SiteSessionProvider), then VI/EN, a sun/moon toggle (clock state dropped), account (and bell) and the single Đặt lịch ngay button; no separate Đặt lịch item; phone tab bar = Trang chủ, Dịch vụ, Đặt lịch ngay (+ Lịch hẹn, Hóa đơn for members). No cosmetics entry until its phase.

### UX/UI Part 2 Step P2-10 (final gate) - 2026-10-03, STOP for Owner review

- Integration 76/76 and 486/486, axe 0 on every Part 2 page, DOM audit clean except known phone-card FR8, CLS 0 everywhere, LCP <= 2.5 s on public pages and sign-in (member pages 3.7-5.5 s on the harsh profile: client-rendered). Fixed on the way: footer/divider shifts, sign-in server rendered, unread badge instead of bell.
- Report: docs/UXUI_REDESIGN_PART2_P2-10_FINAL_GATE.md. Deploy checklist: docs/DEPLOY_PART2_RUNBOOK.md (additive migrations, no permission, no new env var).

### UX/UI Part 2 follow-up: navigation motion + 360 px findings - 2026-10-03

- Public site: prefetched menu/CTA links, sliding menu pill (`site-nav.tsx`, `--ls-dur-slide`), route entrance on navigation only (`RouteEnter`), softer section reveals; all off under reduced motion. Member sign-in untouched.
- 360 px: last phone card layout fixed in the kit, `ls-cards-one-line` on member lists, tab bar hides under an open dialog (it blocked the cancel buttons while a season was active), audit exceptions for text fields and the docked form bar. Report: docs/UXUI_REDESIGN_PART2_NAV_MOTION.md.

### UX/UI Part 2 follow-up: editable home introduction - 2026-10-04

- Admin > Website > Shop info has two optional fields (VI, EN, max 200 characters) for the sentence under the home headline; empty = the built-in sentence (smoke still sees it). `intro` added to `/public/site`.
- **One additive migration on deploy:** `20261024000000_uxui_part2_hero_intro` (2 nullable columns + CHECK). Run `db:deploy` before restarting API and web. Report: docs/UXUI_REDESIGN_PART2_HERO_INTRO.md.

### UX/UI Part 2 follow-up: Owner review of the live site - 2026-10-04

- Header hover fixed (solid fill on the pill), three-state theme button (Light/Dark/Auto), tooltips below, serif logo and three-column footer, "Ghé thăm" removed, clickable cards share one hover/press motion. Home bands alternate warm/white like the reference.
- Admin > Website > Shop info edits: facts strip (show/hide, built-ins hide, custom lines VI/EN + icon, order), featured groups (choice, order, VI/EN description) and the optional "Vì sao chọn" section (off and empty by default; supersedes Q-P2-3).
- **One additive migration on deploy:** `20261025000000_uxui_part2_facts_groups` (7 defaulted columns + CHECK on `website_shop_info`). Run `db:deploy` before restarting API and web. Report: docs/UXUI_REDESIGN_PART2_OWNER_REVIEW_2.md.
- Round 3: section headings left-aligned, group and why-us cards equal-sized per row (names clamp to 2 lines), facts strip one row (scrolls on phones), one hover/press style for all public buttons. No migration change. Nothing is seeded on production (sample texts live only in tests and the scratch script).

### UX/UI Part 2 follow-up: one type scale, equal cards, real menu - 2026-10-04

- One public/member type scale in tokens.css (`--ls-type-*`: hero 48, page 36, section 30, sub 24, card 18, body 15, small 13; Playfair 500), stepped rhythm tokens, container 73 rem; member and booking titles moved off the staff sans; the DOM audit allows this scale. Cards of a row are one size with shared rows (subgrid). Report: docs/UXUI_REDESIGN_PART2_TYPE_SCALE.md.
- Scratch catalog hidden (it was invented). Real menu: docs/CATALOG_EXPORT_FOR_REVIEW.md (read-only export on the server), then `.local/p3-import-catalog.mjs`. No migration change. Open: weight 400 for titles is the Owner's call.
- Owner decision 2026-10-04: public/member titles are Playfair **400** (`--ls-weight-title`, replaces 500/600 of Q-P2-5). The catalog export now also carries branch code and name (docs/CATALOG_EXPORT_FOR_REVIEW.md, five single-command steps).

### UX/UI Part 2 follow-up: four fixes found on the real menu - 2026-10-04

- The Owner's production export (1 branch, 4 groups, 23 services) was imported into the scratch DB only and the public and member pages were re-audited on it: 78 renders, 0 findings, 0 axe. Fixes (CSS and tests in `packages/ui` only, no migration): four home groups form a 2 x 2 block; per-nail booking rows put the price under the name on phones (it squeezed the name to 23 px, FR11); breadcrumb links are at least as wide as tall; the section count uses the sans face.
- Scratch-only data (git-ignored `.local/`): the importer now gives each service the one skill most staff at an active branch hold (before, no start time existed); real-service customers `*.real@example.com`; scratch registration needs `API_PORT=3101 node .local/uxui-audit/start-api-keys.mjs`. Report: docs/UXUI_REDESIGN_PART2_TYPE_SCALE.md.

### UX/UI Part 2 follow-up: footer block area - 2026-10-04

- The footer brand column under the logo is a block area managed in Admin > Website > Shop info (add, edit, delete, reorder, show/hide; 12 at most): social icons, app badges (official Google Play and App Store files, unmodified, `apps/web/public/badges`), text, link list, image, slogan. **Default none, nothing seeded: the footer is the logo alone, so the tagline leaves the footer until a Slogan block is added.**
- **One additive migration on deploy:** `20261026000000_uxui_part2_footer_blocks` (`footer_blocks` JSONB default `[]` + CHECK). A server at `d59d02c` also has `20261024` and `20261025` pending; the Part 2 runbook lists only up to `20261023`. Check `/badges/*` answer 200 after deploy.
- Image blocks are counted by the media library's usage list and delete protection, and served publicly only while visible. Report: docs/UXUI_REDESIGN_PART2_FOOTER_BLOCKS.md.

### UX/UI follow-up: staff area motion, scrolling overlays, Back button - 2026-10-04

- Staff area uses the public motion system: prefetched links (`PrefetchLink`), sliding sidebar highlight (`useSlidingPill`), eased group open/close, page rise on navigation only, `LoadingState` skeletons, smooth button/row/tile hover (locked hover colours untouched). Off for reduced motion, data saver, low memory. Staff data stays fresh (no-store reads, no staleTimes, bfcache reload).
- Dialogs, drawers and sheets: header and footer fixed, body scrolls at any height (backdrop row is the viewport; `dvh`). Back button (`PageBack`, `lib/navigation/back.ts`) on every page except the staff dashboard and public home. No migration. Report: docs/UXUI_REDESIGN_STAFF_MOTION.md.

### UX/UI follow-up: Back on public services pages, header CTA - 2026-10-04

- `PageBack` now also on /services and every service detail (`PublicPage` takes a `back` slot; the list returns to the home, a detail to the list). Header "Đặt lịch ngay" is the same on every page: the old `startsWith(/account/book)` test also hid it on /account/bookings. No migration.
