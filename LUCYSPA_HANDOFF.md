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
| **Phase 4 (POS, invoices, payments)**     | **CLOSED / OWNER APPROVED (Steps 1-11)**                         |
| Phase 5+ (loyalty, payroll, finance)      | NOT started (deferred)                                           |

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

## Open Owner checkpoints (NOT decided; do not decide or implement)

- None. Q8 was answered before Step 10 (see "Q8 (notifications)" below).

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
Fixed only gate-side defects (stale OpenAPI assertion in `scripts/smoke.mjs`, prettier drift). No migration, no product change, not deployed.
Report has the deployment checklist (10 pending migrations, PayOS env, webhook URL, `db:permissions:sync`, PER_NAIL limits). Step 11 and Phase 4 CLOSED / OWNER APPROVED; scratch DB dropped.

## Production

Deployed commit `97e0485` (Notification Center final validation); 25 migrations applied; api/web/worker online.
**Phase 4 (Steps 2-11) is NOT deployed.** Run `pnpm db:permissions:sync` at the next deployment. Deploy only when the Owner asks.

## Known pre-existing test flakes (unrelated to Phase 4; note in one line, do not investigate)

- Two `My Income` integration assertions fail only between 15:00 and 17:00 UTC.
- Worker Step 9 notification tests (`Redis job loss…`, `real Redis delayed-job loss…`) build the visit `serviceDate` from the UTC date and fail
  when the UTC and Vietnam dates differ (roughly 17:00-24:00 UTC).

## Hotfix: PayOS webhook signature (post 82a0862, not deployed)

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

### UX/UI Step 6 (sortable primitives + chart kit) - IMPLEMENTED, awaiting Owner review

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

### UX/UI Step 7.5b (page frame) - implemented locally 2026-10-01, awaiting Owner deploy check

- packages/ui: Page, PageHeader, Stack/Cluster/Grid; Card flush context (table/empty inside a card lose their border; nested Card logs in dev); RouteFade stack. Workforce shell wraps in Page; ui.tsx PageHeader/Section are kit components; workforce.css remapped to tokens (0 spacing literals).
- Nav gap/active bar on the 4 px grid; Leave table scrolls inside its card. Ratchet lowered (wf uses 720, spacing literals 0). No API/DB change.
- 207 ui + 233 web tests pass; DOM audit of Dashboard/Employees/Skills/Branches/Leave: no count rose. Report: docs/UXUI_REDESIGN_STEP7_5B_PAGE_FRAME.md. Next: Owner deploy check, then 7.5c.

### UX/UI Step 7.5c (data frame) - implemented locally 2026-10-01, awaiting Owner review

- packages/ui: DataTable column policy + required paging (dev guard), RowActions = single menu, FacetedFilter, MultiValue, ListSection, ListToolbar/Pagination layout, single-border table surface. Employees and Skills re-fitted (Skills edit now a row-menu dialog).
- 217 ui + 233 web tests pass; DOM audit employees 54->18, skills 142->21, no type rose. Radix not needed (spike found no gap). No API/DB change.
- Review 1 applied: columns hide by width (no page scroll 360-1920), audit script false positives only. Header not sticky on desktop. Report: docs/UXUI_REDESIGN_STEP7_5C_DATA_FRAME.md. Next: Owner review, then 7.5d (forms/overlays) + deploy check.

### UX/UI Step 7.5d (forms and overlays + hover theme) - implemented locally 2026-10-01

- packages/ui: FormGrid, CheckField, Disclosure, FormDialog, FormDrawer (discard guard, busy, error focus), FormSection without fieldset, FormActions Cancel then Save, field/dialog width tokens. Skills (create/edit dialog, status confirm in row menu) and Branches (DataTable + create dialog) migrated.
- Hover theme by tokens (--ls-hover-*): light = very light brand red + #782b37, dark unchanged; WCAG tests in tokens.test.ts. 232 ui + 233 web tests pass; ratchet lowered. Report: docs/UXUI_REDESIGN_STEP7_5D_FORMS_OVERLAYS.md.
- Owner chose to run 7.5d-7.5f back to back, then deploy and review once.

### UX/UI Step 7.5e (dashboard and tabs) - implemented locally 2026-10-01

- Widget titles clamp to one line (value rows align), branch select 280 px without label, layout button "Sắp xếp bố cục" + banner card, recovery email action in the card header, notices inside cards are flush, empty paid chart = EmptyState, Organization tabs on the kit Tabs.
- 233 ui + 235 web tests pass; dashboard audit 86->15 findings. Report: docs/UXUI_REDESIGN_STEP7_5E_DASHBOARD_TABS.md.

### UX/UI Step 7.5f (closing verification) - done locally 2026-10-01, awaiting Owner deploy + final review of 7.5d-7.5f

- Full DOM audit 26 pages x 3 widths: 2296 -> 529 findings (docs/UXUI_AUDIT_AFTER_7_5.md, snapshot docs/uxui-audit-after-7_5.json); ratchet lowered (wf uses 698, details 20, raw tables 23). Design contract 6.3 (hover) and 18 (Steps 8-10 remap) updated.
- Report: docs/UXUI_REDESIGN_STEP7_5F_CLOSING.md. Next after the Owner check: Step 9a Services (then 8a-8c, 9b-9c, 10a-10b).
- Owner review of 7.5d-f: raw checkboxes of Roles, Service detail and Team detail now CheckField (small-target 43 -> 23, no check above baseline; audit script measures a kit .ls-check-field row); toasts to be mounted in Step 8a (success = toast, errors in place); Skills deactivate-with-reason wording approved.

### UX/UI Step 9a (Services) - implemented locally 2026-10-01, awaiting Owner review (uncommitted, not deployed)

- Services/Categories in `Tabs`; `DataTable` client mode (search, category + status filters, sort, 20/page), row `⋮` (Details, (De)activate with reason, Delete), create = `FormDrawer`, category create/edit = `FormDialog`; `ConfirmDeleteDialog` removed. No API change.
- Ratchet: raw tables 23 -> 21, wf uses 698 -> 664, details 20 -> 17. Web targeted tests 23/23; DOM audit services 128 -> 36 (only the known icon-only phone Filter false positive rose).
- Build for the audit needs API_UPSTREAM_ORIGIN at build time. Report: docs/UXUI_REDESIGN_STEP9A_SERVICES.md. Owner said 7.5 "chua on lam"; specific notes pending.

### UX/UI Step 8a (Skills, Roles, Teams, toasts, permission-change notice) - implemented locally 2026-10-01, awaiting Owner review (uncommitted, not deployed)

- Toast provider in the workforce shell (success = toast, errors in place); API 401 `reason: AUTHORIZATION_CHANGED` (tested) + web passive `/auth/me` check on focus and every 3 min, wording "Quyền của bạn đã thay đổi, vui lòng đăng nhập lại". No in-session permission refresh.
- Roles = DataTable + FormDrawer with grouped permission matrix; Teams list = server DataTable; Team detail = breadcrumbs, header actions, Tabs, kit `SelectionBar` for bulk members. Kit: numeric/end alignment specificity fix, breadcrumb targets, `useOptionalToast`.
- Ratchet: raw tables 19, wf uses 604, details 12, fieldsets 17, solid danger 8. Tests: web 246, ui 235, api targeted + 2 integration files on the scratch DB. Report: docs/UXUI_REDESIGN_STEP8A_PEOPLE.md.
- Owner approved 8a: bulk member actions via SelectionBar = approved exception to contract 10.4; CSRF guard answers 401 (+ AUTHORIZATION_CHANGED reason) for an ended signed-in session before checking CSRF (wrong CSRF on a valid session stays 403).

### UX/UI Step 8b (Employees: detail, lifecycle, roles, skills, create) - implemented locally 2026-10-01, awaiting Owner review (uncommitted, not deployed; base 390b355)

- Employee detail = breadcrumbs, `⋮` menu + primary Edit profile, 4 Tabs (profile + account, employment history, roles and branches, skills); promote/end/password/profile = FormDialog, disable/re-enable sign-in and removals = ConfirmDialog; all `<details>` forms gone. Create = own page `/employees/new` (toast + member page after success).
- Kit: `ListSection actions`, `.ls-field` no longer stretches controls in a grid row, `RadioGroup` row-wide targets. Ratchet: raw tables 18, wf uses 483, details 7, fieldsets 11, checkboxes 9.
- Tests: web 246, ui 236. DOM audit employee-detail 238 -> 13. Report: docs/UXUI_REDESIGN_STEP8B_EMPLOYEES.md. Next: 8c (Organization).

### UX/UI Step 8c (Organization: regions, areas, branch placement, appointments) - implemented locally 2026-10-01, awaiting Owner review (uncommitted, not deployed; base 3459413)

- Page = header action per tab + one Notice + 4 Tabs (`?tab=`), each a client DataTable (20/page, sort, `⋮`) with ListToolbar (search + 1 filter); all forms are FormDialog (create/rename/edit/placement/appoint with employee Combobox), activate/deactivate and end appointment are ConfirmDialog with required reason; `<details>`, inline row editing and `window.prompt` removed. No API/DB/permission change.
- Ratchet: raw tables 14, wf uses 439, details 4, checkboxes 8, solid danger 6. Tests: new organization-list + screen tests, 25/25 targeted. DOM audit organization 67 -> 40 (rest = kit polish, plan section 11). Report: docs/UXUI_REDESIGN_STEP8C_ORGANIZATION.md. Next: 9b (Service detail, Branches detail, Discounts).

### UX/UI Step 9b (Service detail, Branch detail, Discounts list/detail/create) - implemented locally 2026-10-01, awaiting Owner review (uncommitted, not deployed; base a9887ba)

- Service/Branch/Discount details = breadcrumbs, `⋮` menu + primary action, read-only `DescriptionList` cards or Tabs; edits are FormDrawer/FormDialog, status/terminate are ConfirmDialog with required reason. Discounts list = client DataTable + toolbar (URL state); create = own page `/discounts/new`, new version = own page `/discounts/[id]/versions/new` (Owner approved 9b). No API/DB/permission change.
- Ratchet: raw tables 10, wf uses 397, fieldsets 7, checkboxes 4. Tests: 46 targeted green. DOM audit service-detail 135 -> 14, branch-detail 89 -> 14, discount-detail 78 -> 14, discounts 56 -> 36. Report: docs/UXUI_REDESIGN_STEP9B_DETAILS_DISCOUNTS.md. Next: 9c (POS, invoice, payments).

### UX/UI Step 9c (POS board, invoice, payments) - Owner approved 2026-10-01 (base 1377faf)

- UI only. Board = toolbar + two DataTables; invoice = breadcrumbs, header `⋮` cancel + primary Finalize, cards (lines+totals, discount, promo codes, payer, payments, PayOS wait, anomalies, notes); every form is a FormDialog, reversal/cancel are ConfirmDialog with reason, re-auth unchanged. `DescriptionList layout="totals"` added. No API/DB/permission change; behavior differences listed in the report.
- Ratchet: raw tables 6, wf uses 334. Tests 39 web + 21 ui green. Scratch-DB money flow 29/29 (open, price, promo, finalize, cash, PayOS QR via simulator, PAID, reversal, cancel). Report: docs/UXUI_REDESIGN_STEP9C_POS_INVOICES.md. Next: Kit polish (plan section 11, incl. neutral password-dialog wording), then 10a.

### UX/UI Kit polish (plan section 11) - approved by Owner 2026-10-01 (base 54a110d)

- Kit only: Badge 4/8 padding, Notice 1 px border + card radius, phone card title 2-line clamp with reserved height + `minmax(0,1fr)` tracks (overflow 98 -> 2), `ReauthDialog` on `FormDialog` with neutral text (VI/EN). Audit script: hidden-text and docked-chrome false positives fixed.
- Ratchet wf 325, css literals 6. Tests ui 238 + web targeted 8 green. DOM audit: no type rose, off-grid 1202 -> 24. Report: docs/UXUI_REDESIGN_KIT_POLISH.md. Next: 10a.
