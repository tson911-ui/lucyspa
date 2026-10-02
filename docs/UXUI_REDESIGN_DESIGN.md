# UX/UI Redesign: design contract

**Status: Step 1 of 14 (Design Contract), CLOSED / OWNER APPROVED.** The Owner accepted every recommended default in section 17
(Q-D1 to Q-D6 and Q-CM1 to Q-CM13) as written; they are LOCKED Owner decisions. Documentation only. No code, schema, API, migration or
runtime change was made. Step 2 (Foundations) is **CLOSED / OWNER APPROVED** (`UXUI_REDESIGN_STEP2_FOUNDATIONS.md`). Step 3 (Core components) is **CLOSED / OWNER APPROVED** (`UXUI_REDESIGN_STEP3_CORE_COMPONENTS.md`; `jsdom` dev dependency approved for interactive tests in later Steps). Step 4 (Data components) is **CLOSED / OWNER APPROVED** (`UXUI_REDESIGN_STEP4_DATA_COMPONENTS.md`; phone "Sort by" select added on the Owner's answer). Step 5 (App shell, navigation, auth layout) is **CLOSED / OWNER APPROVED** (`UXUI_REDESIGN_STEP5_SHELL_AUTH.md`; split auth layout and tagline approved). Step 6 (Sortable primitives + chart kit) is **IMPLEMENTED, awaiting Owner review** (`UXUI_REDESIGN_STEP6_SORTABLE_CHARTS.md`). Step 7 (Dashboard) is **CLOSED / OWNER APPROVED** (`UXUI_REDESIGN_STEP7_DASHBOARD.md`). **Step 7.5** (page-frame standardization, sessions 7.5a-f) is planned and Owner-approved in `UXUI_REDESIGN_STEP7_5_PLAN.md`; its rules and gate are in sections 21.4-21.5 (written by 7.5a) and amend 9.1 `RowActions`, 10.3, 10.4 and 21.1-1. Nothing was deployed.

This is the authoritative contract for the UX/UI Redesign track, Part 1 (workforce/admin area plus the website-content
feature group). `LUCY_SPA_PRD.md` governs where this document is silent (PRD 4.1 was updated for the Owner decisions below).
Baseline: `main` at `5952992` (Phase 4 closed; PayOS webhook hotfix).

## Index: which Step reads which sections

| Step | Title                                        | Sections to read            |
| ---- | -------------------------------------------- | --------------------------- |
| 2    | Foundations: tokens, theme, typography       | 1, 2, 5, 6, 7, 8            |
| 3    | Core components (buttons, forms, dialogs)    | 1, 2, 5, 7, 9.1-9.3, 10, 11 |
| 4    | Data components (table, pagination, filters) | 2, 7, 9.4-9.5, 10, 11, 12   |
| 5    | App shell and navigation                     | 2, 4, 7, 9.6, 12.6, 13      |
| 6    | Sortable primitives + chart kit              | 2, 6.5, 9.7-9.8, 14.4       |
| 7    | Dashboard (widgets, drag and drop)           | 4.3, 12.5, 14.1-14.3, 15    |
| 7.5  | Page-frame standardization (plan file)       | 9.4-9.6, 10, 21.4, 21.5     |
| 8    | Migrate People and organization              | 3, 10, 11, 12, 21.4, 21.5   |
| 9    | Migrate Catalog and Finance                  | 3, 10, 11, 12               |
| 10   | Migrate Operations and personal pages        | 3, 10, 11, 12               |
| 11   | Content A: storage + media library           | 16.1-16.4, 16.7-16.9, 17    |
| 12   | Content B: promotional popup                 | 16.5, 16.7-16.9, 17         |
| 13   | Content C: homepage slider                   | 16.6-16.9, 17               |
| 14   | Part 1 final validation                      | 18, 19                      |

Every Step also reads section 0 (rules) and section 17 (Owner decisions) for the answers it depends on. The seasonal-theme Steps
S1-S5 (decision D12) read sections 0, 6, 16 and 20 and section 20.10 for the open Owner questions.

---

## 0. Owner decisions recorded (LOCKED for this track)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Brand colors: primary red `#782b37` and white `#ffffff`. **No gold anywhere** (also no yellow/amber that reads as gold).                                                                                                                                                                                                                                                                       |
| D2  | Light and dark mode with a user toggle; default is Auto by time (light 06:00-17:59, dark 18:00-05:59, local device time; Owner 2026-10-02, replaces "follows the system").                                                                                                                                                                                                                     |
| D3  | Admin (workforce) area first. Customer area and public site are a later part of this track (own contract).                                                                                                                                                                                                                                                                                     |
| D4  | Admin is modern, luxurious, professional, very easy to use, fast; no cinematic motion (PRD 4.4 applies to the customer side only).                                                                                                                                                                                                                                                             |
| D5  | Desktop, tablet and phone; VI/EN; Vietnamese diacritics must render well.                                                                                                                                                                                                                                                                                                                      |
| D6  | Clear, consistent layout on every page. Every list has pagination (plus search/filters where useful).                                                                                                                                                                                                                                                                                          |
| D7  | Edit and Delete buttons are clear and consistently placed; destructive actions use a confirmation dialog. Where records must never be deleted (financial/operational history) show the allowed action (Cancel, Deactivate, Correct), never a fake Delete.                                                                                                                                      |
| D8  | Dashboard of widgets, rearrangeable per user by drag and drop. Drag and drop also orders images and slides.                                                                                                                                                                                                                                                                                    |
| D9  | Design the dashboard and a shared chart kit now so Phase 8 analytics plug in without redesign. Only widgets backed by existing data are built in this track; permission rules (for example `VIEW_REVENUE`) apply to widgets.                                                                                                                                                                   |
| D10 | Website content management (media library, promotional popup, homepage slider) is planned as separate Steps (11-13) since it needs storage, schema and API. Respect PRD 24.1. No page builder.                                                                                                                                                                                                 |
| D11 | Apart from the content-management group, **no business logic or API changes** in this track.                                                                                                                                                                                                                                                                                                   |
| D13 | **Admin micro-interactions** (Owner decision 2026-09-30): shared motion tokens (150-250 ms, ease-out, off under reduced motion) for button hover/press, input focus, the segmented slide, pagination, table rows and cards, menus, dialogs, drawers, toasts, sidebar collapse, route content fade and skeleton loading; micro-interactions only, no cinematic motion (amends D4; section 6.6). |
| D12 | **Seasonal/holiday themes** (Owner decision 2026-09-30): a preset theme layer on top of light/dark for the website, the future mobile app and, subtly, the admin area. Brand red stays primary; scheduled by the Owner; no free-form builder. Design in section 20.                                                                                                                            |

Standing project rules still apply (CLAUDE.md): authorization is permission + branch scope server-side (never role names),
money is integer VND, history is never deleted, migrations are additive, no commit/deploy without the Owner.

---

## 1. Design principles

1. **Fast and calm.** Content first, one obvious primary action per page, no decorative motion. Luxury comes from restraint:
   whitespace, a deep wine red used sparingly, precise alignment, quiet neutrals.
2. **Same place, same meaning.** Title, primary action, filters, table, pagination and row actions sit in the same place on
   every page (section 10). A user who learned one list has learned all of them.
3. **Status is never color-only.** Every state carries text (and an icon where space allows). Brand red is never the only
   signal for an error (section 6.4).
4. **The UI never authorizes.** Permission hints decide what is offered; the API still decides (existing rule, unchanged).
5. **Touch and keyboard are first-class.** Targets at least 44 px, visible focus, every drag action has a button alternative.
6. **Tokens, not literals.** No hex values in components or screen CSS; everything reads semantic tokens (section 6).

## 2. Scope and non-goals

**In scope (Part 1):** design tokens, theme, typography, shared components in `packages/ui`, app shell and navigation,
page templates, migration of all existing workforce screens, dashboard framework and widgets backed by existing data, the chart
kit, and the website-content feature group (Steps 11-13).

**Non-goals:**

- Any new business rule, workflow, permission semantics, report or API outside Steps 11-13.
- Analytics/report data (Phase 8), product/inventory screens (Phase 6), loyalty (Phase 5).
- Customer area and public site redesign, premium motion system (PRD 4.4). Part 2 gets its own contract.
- A page builder or general CMS (PRD 24.1 forbids it).
- Renaming routes, changing URLs or changing what an existing screen does.

---

## 3. Inventory of existing workforce screens

Source: `apps/web/src/app/[locale]/workforce/(app)` routes and `components/workforce/screens`. URLs are relative to
`/{locale}/workforce`. "Template" is the target page template of section 12. "List/paging today" records what Step 4/8-10
must adapt (API is not changed: see decision Q-D3).

| Route                           | Screen (LOC)                                                                            | Nav permission (UI hint)                    | Template         | Lists / paging today                             | Destructive actions today (target treatment)                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `/` dashboard                   | dashboard (146)                                                                         | any workforce                               | Dashboard        | none                                             | none                                                                                             |
| `/account`                      | my-account (624)                                                                        | any workforce                               | Form/tabs        | none                                             | none (password/email changes keep re-auth dialogs)                                               |
| `/income`                       | my-income (193)                                                                         | any workforce                               | List             | client, unpaged                                  | none                                                                                             |
| `/notifications`                | notifications inbox                                                                     | any workforce                               | List             | API cursor ("load more")                         | **Archive** (not delete)                                                                         |
| `/attendance`                   | attendance (430)                                                                        | employee or `VIEW_ATTENDANCE`               | List+form        | unpaged                                          | none; **Correct** (existing)                                                                     |
| `/leave`                        | leave (423)                                                                             | employee or `APPROVE_LEAVE`                 | List+form        | unpaged                                          | **Cancel** request                                                                               |
| `/collaborator-schedule`        | collaborator-schedule (585)                                                             | `VIEW/MANAGE_WORK_SCHEDULE`                 | Board            | calendar                                         | cancel occurrence (no delete)                                                                    |
| `/booking-board`                | booking-board (854)                                                                     | `VIEW_BOOKINGS`                             | Board            | day board                                        | **Cancel** line / walk-in, No-show, Resolve end                                                  |
| `/walk-in`                      | walk-in (491)                                                                           | `MANAGE_BOOKINGS`                           | Form             | none                                             | none                                                                                             |
| `/my-services`                  | my-services (245)                                                                       | employee + `PERFORM_SERVICES`               | Board            | short worklist                                   | none                                                                                             |
| `/reassignment`                 | reassignment (384)                                                                      | `REASSIGN_SERVICES`                         | List             | cursor ("load more")                             | none                                                                                             |
| `/pos`, `/pos/[id]`             | pos (218), invoice (771), payments (727)                                                | `VIEW_INVOICES`                             | Board+detail     | 7-day board, unpaged                             | **Cancel** invoice (re-auth), **Reverse** payment (`CORRECT_PAYMENTS`), never delete             |
| `/branches`, `/branches/[id]`   | branches (154), branch-detail (330)                                                     | `MANAGE_BRANCHES`                           | List+detail      | unpaged (few rows)                               | **Deactivate** (status)                                                                          |
| `/services`, `/services/[id]`   | services (563), service-detail (514)                                                    | `MANAGE_SERVICES` / `MANAGE_SERVICE_PRICES` | List+detail      | grouped by category, unpaged                     | service and category: **Delete** only where the API allows (never used); else **Deactivate**     |
| `/discounts`, `/discounts/[id]` | discounts (155), detail (368), form (213)                                               | GLOBAL `MANAGE_DISCOUNTS`/`CREATE_VOUCHERS` | List+detail      | unpaged                                          | **Deactivate/Cancel** (no delete: financial history)                                             |
| `/skills`                       | skills (229)                                                                            | `MANAGE_SKILLS`                             | List             | unpaged                                          | **Deactivate** (status)                                                                          |
| `/employees`, `/employees/[id]` | employees (417), detail (330), lifecycle (731), roles (301), skills (232), create (476) | `VIEW_EMPLOYEES`                            | List+detail+form | **server page + keyset** (only paged list today) | **End employment / disable access / revoke assignment** (never delete)                           |
| `/organization`                 | organization (1199)                                                                     | `VIEW/MANAGE_ORGANIZATION`                  | Tree+forms       | unpaged tree                                     | **End** appointment, deactivate units                                                            |
| `/teams`, `/teams/[id]`         | teams (905)                                                                             | `VIEW/MANAGE_TEAMS`                         | List+detail      | server page (`OrganizationPage`)                 | **Delete** team (API supports), otherwise deactivate                                             |
| `/roles`                        | roles (520), management-levels (51)                                                     | `MANAGE_PERMISSIONS`                        | List+detail      | unpaged                                          | none today (API has create, edit, set permissions only): Edit only, no Delete/Deactivate offered |
| `/login`, `/forgot-password`    | login (160), forgot-password (240)                                                      | public                                      | Auth             | none                                             | none                                                                                             |

Facts that drive the design:

- Only the employee directory has numbered server paging; reassignment and audit use cursors; everything else loads the
  whole scoped result. Step 4's table therefore has two modes (client paging over a loaded array, server paging), decision Q-D3.
- Hard delete exists only for service, service category and team (`POST .../delete`), gated by API rules. All other entities use
  status changes, cancellations or corrections. The confirm pattern is generalized in section 11.
- Existing shared UI lives in `apps/web/src/components/workforce/ui.tsx` (`PageHeader`, `Section`, `Badge`, `Notice`, `Field`,
  `SubmitButton`, `useResource`, `useSubmit`, `FormFeedback`) and `confirm-delete.tsx`; `packages/ui` only exports a wordmark and
  `tokens.css`. Styles: `workforce.css` (906 lines, `wf-*` classes), `globals.css`, `customer.css`.

---

## 4. Information architecture and navigation

### 4.1 Shell

Desktop (>= 1024 px): fixed left **sidebar** (collapsible to icons), sticky **topbar**, scrolling content column.
Tablet (640-1023 px): sidebar collapsed to an icon rail; expands as an overlay. Phone (< 640 px): sidebar becomes a **drawer**
opened from a menu button; topbar keeps brand, notifications and the user menu. A bottom tab bar is **not** used (the nav is too
large and permission-dependent).

Topbar (left to right): menu button (tablet/phone), brand wordmark, spacer, **notifications** (existing indicator), **theme
toggle** (Light / Dark / Auto by time), **language switch** (VI/EN, existing behavior), **user menu** (name, title, My account, Sign out).
Breadcrumbs sit above the page title on detail pages only.

### 4.2 Navigation grouped by task

The existing three groups (`home`, `operations`, `management`) are too coarse now that the list has 19 entries. New groups
(task-oriented; a group with no visible item is hidden; a group with one item renders that item flat). Order of items inside a
group follows the table. Permission rules are **exactly** the existing `navigationFor` rules: this contract moves entries between
groups, it does not change who sees what (D11).

| Group (VI / EN)                                           | Items (key: rule from `permissions.ts`)                                                                                                                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _(top, ungrouped)_ Tổng quan / Overview                   | `dashboard`                                                                                                                                                                                                                 |
| **Vận hành / Operations**                                 | `bookingBoard` (`VIEW_BOOKINGS`), `walkIn` (`MANAGE_BOOKINGS`), `myServices` (employee + `PERFORM_SERVICES`), `reassignment` (`REASSIGN_SERVICES`), `collaboratorSchedule` (`VIEW/MANAGE_WORK_SCHEDULE`)                    |
| **Thanh toán / Sales & payments**                         | `pos` (`VIEW_INVOICES`), `discounts` (GLOBAL `MANAGE_DISCOUNTS` or `CREATE_VOUCHERS`)                                                                                                                                       |
| **Nhân sự / People**                                      | `employees` (`VIEW_EMPLOYEES`), `attendance` (employee or `VIEW_ATTENDANCE`), `leave` (employee or `APPROVE_LEAVE`), `teams` (`VIEW/MANAGE_TEAMS`), `organization` (`VIEW/MANAGE_ORGANIZATION`), `skills` (`MANAGE_SKILLS`) |
| **Danh mục / Catalog**                                    | `services` (`MANAGE_SERVICES` or `MANAGE_SERVICE_PRICES`), `branches` (`MANAGE_BRANCHES`)                                                                                                                                   |
| **Website** _(new, Steps 11-13)_                          | `websiteContent` (media, popup, slider; new GLOBAL permission, Q-CM1)                                                                                                                                                       |
| **Quản trị / Administration**                             | `roles` (`MANAGE_PERMISSIONS`)                                                                                                                                                                                              |
| **Cá nhân / Personal** _(footer of sidebar or user menu)_ | `myAccount`, `myIncome`, notifications                                                                                                                                                                                      |

Rationale: staff think "what do I do now" (operations, sales), managers "who works here" (people), owners "what do we offer"
(catalog, website). Personal pages move to the user menu/sidebar footer because they are used rarely and clutter the task list.
The dashboard's old "Management" link grid is removed (the sidebar already provides it).

**Group headers are accordions (Owner, 2026-10-02).** A group with a heading renders it as a `<button aria-expanded
aria-controls>`: uppercase, brand red, semibold, with a chevron that rotates (down open, right closed; the 150 ms motion token,
so it is instant under reduced motion). Its items are indented one step (16 px) under it. Several groups may be open at once.
The group holding the current page opens itself (on load and whenever the page changes, even if it was closed); the other groups
start closed. Open/closed state is remembered per browser in `localStorage` (`ls.sidebar.groups`, a convenience only; blocked
storage just means the default). The **icon rail** (collapsed sidebar, tablet rail) keeps its behavior: no headers, every item
shown, the group name kept for assistive technology. Flat single-item groups have no header. Enter/Space operate the button;
a closed group's items are not rendered, so they are not in the tab order.

### 4.3 Permissions in navigation and widgets

Sidebar items and dashboard widgets are filtered with the existing UX hints (`canAnywhere`, `canGlobal`, `canAt`). A widget that
needs a branch resolves data per permitted branch; the API remains the authority and can still answer 403, which the widget shows
as a compact "no access" state (never a blank card). Active item uses `aria-current="page"`.

### 4.4 Quick access

A global search box is **not** in this track (it needs a cross-entity API, PRD 52). The page-level search of each list is enough.
Reserve topbar space so a Phase 8 search can be added without layout change.

---

## 5. Typography

- **Family:** _Be Vietnam Pro_ (designed for Vietnamese: correctly stacked diacritics) for all admin text, loaded with
  `next/font/google` (self-hosted at build time, subsets `latin` and `vietnamese`, weights 400/500/600/700, `display: swap`), with
  fallback `system-ui, "Segoe UI", Roboto, Arial, sans-serif`. Numerals use `font-variant-numeric: tabular-nums` in tables and KPIs.
- The current display serif (Georgia) stays out of admin: it lacks precomposed Vietnamese glyphs (already noted in
  `workforce.css`). A display face for the customer site is a Part 2 decision.
- **Scale** (rem, base 16 px; line-height in parentheses; letter-spacing only on headings/eyebrow):

| Token           | Size / line        | Weight | Use                                           |
| --------------- | ------------------ | ------ | --------------------------------------------- |
| `--ls-text-xs`  | 0.75 / 1.0 (16 px) | 500    | eyebrow, table meta, badges (never body text) |
| `--ls-text-sm`  | 0.875 / 1.25       | 400    | table cells, helper text, secondary           |
| `--ls-text-md`  | 1 / 1.5            | 400    | body, form controls (16 px avoids iOS zoom)   |
| `--ls-text-lg`  | 1.125 / 1.5        | 600    | card titles, section titles (h2)              |
| `--ls-text-xl`  | 1.5 / 1.3          | 600    | page title (h1), `-0.01em`                    |
| `--ls-text-2xl` | 2 / 1.2            | 600    | dashboard greeting, KPI value                 |

- Body text on tables is `sm`; form inputs are `md`. Minimum text size anywhere is 12 px and only for non-essential meta.
- Long Vietnamese strings run ~30% longer than English: no fixed-width buttons or badges; allow wrapping, `min-width` not
  `width`, and test every component with the longest VI label (Step 3 test rule).

## 6. Design tokens

Namespace `--ls-*`, defined in `packages/ui/src/tokens.css`, semantic (what it is for), not literal (what color). Legacy
`--lucy-*` names stay as aliases until Part 2 so `customer.css` keeps working; `--lucy-gold`, `--lucy-gold-light` and the ivory
background are **removed**, and the 23 gold references in `globals.css`, `workforce.css` and `customer.css` are mechanically
re-pointed to brand/neutral tokens in Step 2 (no customer redesign) so no gold remains anywhere after Step 2.

### 6.1 Theme mechanism

`<html data-theme="light|dark">` set by an inline script in the root layout **before paint** (no flash), from a `ls-theme` cookie
(`light`, `dark`, or absent = **Auto by time**, the default). Auto by time (Owner, 2026-10-02, replaces "System"): **light from
06:00 to 17:59, dark from 18:00 to 05:59**, by the viewer's local device clock. The same script schedules itself for the next
06:00 / 18:00 and re-checks when the tab becomes visible again, so the theme flips live at the boundary without a reload (no
flash on first load: the attribute is set before paint). The toggle has three options, **Light**, **Dark** (manual overrides) and
**Auto by time** (clock icon; VI "Tự động theo giờ" / EN "Auto by time"). It writes the cookie for Light/Dark (1 year,
`SameSite=Lax`, not `HttpOnly`, no personal data) and clears it for Auto, then updates the attribute. `color-scheme` follows the
theme so native controls and scrollbars match. An old `system` choice was never stored, so existing users land on Auto.
Tokens are defined under `:root` (light), `:root[data-theme="dark"]`, and
`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ... } }`.

### 6.2 Color tokens (all ratios computed with WCAG 2.x)

Text on any surface is at least **4.5:1**; large text and UI boundaries (input borders, focus rings, chart marks) at least **3:1**.

| Token                   | Light                 | Dark                  | Notes / verified contrast                                                       |
| ----------------------- | --------------------- | --------------------- | ------------------------------------------------------------------------------- |
| `--ls-bg-page`          | `#faf7f7`             | `#140f10`             | app background (faint wine tint, not cream)                                     |
| `--ls-bg-surface`       | `#ffffff`             | `#1d1618`             | cards, tables, dialogs                                                          |
| `--ls-bg-raised`        | `#ffffff`             | `#261d20`             | popovers, menus, hovered rows (light uses shadow instead of tint)               |
| `--ls-bg-sunken`        | `#f3eeee`             | `#100b0c`             | table header, inset areas                                                       |
| `--ls-text`             | `#221a1c`             | `#f4ecec`             | 17.0:1 on surface (L) / 15.3:1 (D)                                              |
| `--ls-text-muted`       | `#5c4e51`             | `#c4b5b8`             | 7.9:1 (L) / 9.0:1 (D)                                                           |
| `--ls-text-subtle`      | `#6f6164`             | `#a4949a`             | 5.9:1 (L) / 6.2:1 (D); lowest text tone allowed                                 |
| `--ls-border`           | `#e6dcdd`             | `#372b2e`             | decorative dividers (not a boundary that conveys meaning)                       |
| `--ls-border-control`   | `#8c7d80`             | `#7d6c70`             | input/checkbox boundary: 3.9:1 (L) / 3.6:1 (D)                                  |
| `--ls-brand`            | `#782b37`             | `#e08a9a`             | brand as text/link/icon/outline: 9.6:1 on white (L) / 7.0:1 on surface (D)      |
| `--ls-brand-fill`       | `#782b37`             | `#e08a9a`             | primary button and active nav background                                        |
| `--ls-on-brand`         | `#ffffff`             | `#2a0f16`             | text on brand fill: 9.6:1 (L) / 7.0:1 (D)                                       |
| `--ls-brand-fill-hover` | `#632330`             | `#eaa0ae`             | 11.6:1 (L) / 8.6:1 (D)                                                          |
| `--ls-brand-soft`       | `#f8edef`             | `#3a1b23`             | selected row, active-nav tint; brand text on it 8.3:1 (L) / `#f0b3be` 8.7:1 (D) |
| `--ls-focus`            | `#782b37`             | `#e08a9a`             | 2 px ring + 2 px offset in `--ls-bg-surface`; 3:1 minimum satisfied             |
| `--ls-danger`           | `#b3261e`             | `#ff9484`             | text/icon 6.5:1 on white (L), 8.3:1 (D)                                         |
| `--ls-danger-bg`        | `#fdecea`             | `#3d1c1a`             | danger text on it 5.7:1 (L) / 7.1:1 (D)                                         |
| `--ls-success` / `-bg`  | `#1e6b3c` / `#e6f3ea` | `#7fd39a` / `#14301d` | 5.7:1 (L) / 8.0:1 (D)                                                           |
| `--ls-warning` / `-bg`  | `#8f4300` / `#fdeedd` | `#ffb066` / `#3a2410` | **orange**, deliberately not amber/yellow (D1); 6.2:1 (L) / 8.1:1 (D)           |
| `--ls-info` / `-bg`     | `#22518a` / `#e8f0fa` | `#8ebcf0` / `#14283f` | 7.0:1 (L) / 7.6:1 (D)                                                           |
| `--ls-overlay`          | `rgb(34 26 28 / 0.5)` | `rgb(0 0 0 / 0.65)`   | dialog backdrop                                                                 |

Elevation (light only; dark uses `--ls-bg-raised` plus a 1 px border): `--ls-shadow-sm 0 1px 2px rgb(34 26 28 / .06)`,
`--ls-shadow-md 0 4px 16px rgb(34 26 28 / .10)`, `--ls-shadow-lg 0 12px 32px rgb(34 26 28 / .16)` (dialogs).

### 6.3 Dark mode rules

Dark mode is **selected, not inverted**: brand red becomes the lighter variant `#e08a9a` (a fill with dark text, or text/outline
on dark surfaces); surfaces are warm near-black with separation by lightness steps and 1 px borders, not shadows; pure white
(`#fff`) and pure black (`#000`) text/backgrounds are not used. Images keep their look (no filter); a decorative brand image may
get `filter: brightness(.9)` only if it glares. Charts use their own dark-selected steps (section 15).

**Hover, whole app (Owner, 2026-10-02; replaces the 7.5d tint).** One source: tokens `--ls-hover-bg/-text/-border/-ghost-border`,
never per screen. **Light = solid `#782b37` + white text and icon; dark = solid `--ls-brand-fill` + `--ls-on-brand`**, for every
interactive hover and keyboard highlight: user menu and `⋮` menu items, select/combobox options (also the arrow-key active
option), tabs, segmented options, pager buttons, ghost/outline/icon buttons, theme switch, check rows, facet options, calendar
days, password toggle and the sidebar. Rules: disabled never hovers; a keyboard-focused filled item draws its ring in the
on-fill color; a checked box on a filled row takes the on-fill accent; destructive controls (danger-outline button, danger menu
item) use the same solid rule in `--ls-danger` + `--ls-on-danger`; the solid primary keeps its own darker hover; on the auth
brand gradient the fill is inverted (panel text as fill). The selected segment/theme option is the same fill, told apart by
weight and the hover inset. **One documented exception:** a whole table row (and phone card row) keeps the subtle tint
`--ls-row-hover-bg` (`#fbf1f3` light, `#100b0c` dark) with unchanged text, for readability. Media tiles keep their border
highlight (cards, not menu-type items). Contrast is tested in `tokens.test.ts` (hover text 4.5:1 on the fill, fill 3:1 on every
surface, text and brand link 4.5:1 on the row tint).

**Sidebar items (Owner, workforce shell feedback 2026-10-02).** Their own tokens `--ls-nav-hover-bg/-text` and
`--ls-nav-active-bg/-text/-bar`. Light: hover and the current page are **solid brand red `#782b37` with white text and icon**
(current page also semibold; no edge bar, the fill carries it). Dark (Owner, 2026-10-02): hover and the current page are the
**solid dark primary fill `--ls-brand-fill` with `--ls-on-brand` text and icon**, the same as the primary button (current page
also semibold, no edge bar). The keyboard focus ring is drawn **outside** the item (2 px offset), because inside it would
vanish on the fill. Group headers use the same fill on hover.

### 6.4 Brand red versus error red (must stay distinct)

The wine `#782b37` (hue ~352°, dark, muted) and the danger red `#b3261e` (hue ~4°, brighter, more saturated) are close relatives, so
color alone never separates them. Rules:

1. **Brand red = action and place**: primary button, active nav, links, focus ring, selected row. **Danger red = problem and
   destruction**: validation error, failed state, destructive confirm button.
2. Danger is never shown as text or a border alone: it always carries an **icon** (warning triangle / circle-x) and words.
3. Destructive triggers (Delete/Cancel/Deactivate) are **outlined or ghost** in the danger color with a leading icon; only the
   confirm button inside the confirmation dialog is a solid danger fill. So the only solid red buttons on a page are brand
   primary (wine) and, inside a dialog, danger; they never appear side by side on the page surface.
4. Notices/badges for errors use `--ls-danger-bg` (pinkish-white tint) with an icon; brand-soft (`#f8edef`) is used only for
   selection/active states, never for messages.
5. In dark mode the brand is a cool rose (`#e08a9a`) and danger a warm salmon-coral (`#ff9484`): a hue gap of roughly 25° plus
   the rules above.

### 6.5 Chart tokens

Categorical series (fixed order, never cycled; 6 slots; validated with the dataviz validator: lightness band, chroma, CVD
separation, normal-vision floor and 3:1 contrast **all PASS**, worst adjacent CVD delta E 12.0 light / 10.7 dark, normal-vision
worst 22.9 light / 20.9 dark):

| Slot | Name   | Light     | Dark      |
| ---- | ------ | --------- | --------- |
| 1    | Wine   | `#a03a4c` | `#c9647a` |
| 2    | Blue   | `#2b6cb0` | `#4f8fd6` |
| 3    | Orange | `#d2691e` | `#d1722f` |
| 4    | Teal   | `#0b8f83` | `#2aa89b` |
| 5    | Violet | `#7c4dbd` | `#9a78d6` |
| 6    | Green  | `#3f8f3a` | `#55a648` |

Chart surfaces: light `#ffffff`, dark `#1b1416` (validated surface; cards use `--ls-bg-surface`, the difference is under 1 L step).
Slot 1 is a lighter wine than the UI brand so it clears the chart lightness band; it is still "the brand series". A 7th series is
never generated: fold into a neutral "Other" (`--ls-text-subtle`), facet or cut. Sequential ramp: one hue (wine) from
`--ls-brand-soft` to `--ls-brand`. Diverging (period comparison, positive/negative): blue and orange around a neutral midpoint,
**not** green/red (color-blind safe, and avoids brand-vs-danger confusion). Status colors (success/warning/danger/info) are
reserved for state and never reused as series. Grid lines `--ls-border` (dark `#4a3d40`, 1.7:1, intentionally recessive).
No gold, no yellow in any chart.

### 6.6 Spacing, radius, size, motion, z-index

- **Spacing** 4 px base: `--ls-space-1..10` = 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 px. Page gutter 16 px (phone), 24 px (tablet),
  32 px (desktop). Card padding 16/20/24. Vertical rhythm between page sections 24 px.
- **Radius**: `--ls-radius-sm 6px` (inputs, buttons, badges), `--ls-radius-md 10px` (cards, dialogs), `--ls-radius-full` (pills, avatars).
- **Sizes**: control height 40 px desktop, **44 px** touch (coarse pointer and < 1024 px), icon 20 px, table row 48 px (56 px touch),
  sidebar 264 px (72 px collapsed), content max width 1280 px (tables and boards may fill the column), form column max 720 px.
- **Breakpoints**: 640 (phone/tablet), 1024 (tablet/desktop), 1440 (wide; content stays capped). Mobile-first CSS.
- **Motion** (admin), amended by the Owner review of the auth card (decision D13): **micro-interactions only, still no cinematic
  motion.** Tokens in `tokens.css`: `--ls-dur-fast 150ms`, `--ls-dur-base 200ms`, `--ls-dur-slow 250ms`, easing
  `--ls-ease-out cubic-bezier(0,0,.2,1)` (`--ls-ease` stays for older rules), `--ls-press-scale 0.98`. Allowed micro-interactions,
  all driven by these tokens and reusable across the admin: button hover (fill darkens) and press (scale to `--ls-press-scale`);
  input focus (border and ring ease in); the sliding selected highlight of `SegmentedControl` (250 ms); hover backgrounds of
  navigation items and icon buttons; pagination buttons (hover, press); table row hover and phone card rows; menu and popover
  open (fade + 4 px drop) and item hover; dialog open (fade + scale 0.98, bottom sheet slides up on phones); drawer slide
  (250 ms); toast enter; sidebar collapse (width, 200 ms); route content fade (`RouteFade` in a `template.tsx`, opacity only,
  200 ms, no movement); skeleton pulse (`--ls-dur-loop`, the only repeating animation besides the spinner and indeterminate
  progress). Entrances only: unmounting is instant. Only opacity, transform, color, background, width and outline change; no
  literal durations in CSS (a test checks transitions and animations). Still forbidden: parallax, animated page transitions
  (slides, zooms), scroll effects, decorative or looping animation beyond the indicators above. `prefers-reduced-motion: reduce` sets all durations to 0 and the press scale to 1
  (drag and drop still works). New micro-interactions need a token, not a literal, and appear in the UX gate review (section 21).
- **z-index**: base 0, sticky header 10, drawer 20, popover 30, dialog 40, toast 50.
- **Icons**: one line-icon set, 20 px, `currentColor`, 1.75 stroke, inlined SVG components in `packages/ui` (no icon font, no
  runtime dependency). Icons are decorative (`aria-hidden`) unless they are the only label of a button.

---

## 7. Cross-cutting UX rules

- **Language:** all strings come from the VI/EN dictionaries (`i18n/workforce.ts`); components take text as props and never
  embed copy. Dates/times/money use the existing formatters (`lib/workforce/format.ts`): business dates in branch timezone,
  money integer VND with `.` grouping and `₫`/`VND` per existing format.
- **Focus:** visible ring on every interactive element; dialogs trap focus and restore it; skip link stays.
- **Forms:** label above control; helper text below; error text below with icon and `aria-describedby`; required marked in text,
  not only `*`; submit button disabled while pending with a spinner and text (`aria-busy`); the first invalid field is focused.
  Unsaved-changes prompt on leaving a dirty form.
- **Feedback:** success and non-blocking errors as **toasts** (bottom-right desktop, bottom on phone, 5 s, `role=status`);
  blocking errors inline (`Notice`). Server error shows the existing request reference.
- **Loading:** skeletons matching the final layout (tables show 5 skeleton rows); no full-page spinners. Buttons keep width when busy.
- **Empty states:** icon, one sentence, and the primary action if the user may create.
- **Touch:** minimum target 44 x 44 px, 8 px between adjacent targets, no hover-only affordances.
- **Tables on phone:** switch to a stacked "card list" (label/value pairs), keeping the same row actions in a `...` menu.

---

## 8. Foundations Step scope (Step 2)

Deliverables: `tokens.css` v2 (sections 6.1-6.6, legacy aliases, gold removed), theme cookie + inline pre-paint script + hook
`useTheme`, font loading (section 5), CSS reset/base (typography, focus, `prefers-reduced-motion`), `Icon` set, replacement of
`workforce.css` literal colors by tokens **without changing layout**. Acceptance: workforce and public pages render in both
themes with no hex literals left in `workforce.css`; contrast unit test over the token table (the ratios in 6.2 asserted in code);
no gold token or value remains in `apps/web/src` or `packages/ui/src`.

---

## 9. Shared component list (`packages/ui`)

Rules for all components: framework-only (React 19, no `next/*` imports, no API client, no dictionary import); text via props;
every component ships with a test (render, keyboard, ARIA, longest-VI-string), typed props, `className` passthrough limited to
layout; theming only via tokens. Screens keep their data hooks (`useResource`, `useSubmit`) in `apps/web`; those are not moved.
Existing `wf-*` classes are retired screen by screen in Steps 8-10; old and new coexist until then.

### 9.1 Actions

| Component    | Purpose / API notes                                                                                                                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`     | `variant`: `primary` (wine fill), `secondary` (outlined neutral), `ghost`, `danger-outline`, `danger` (solid; **dialogs only**, enforced by lint/test), `loading`, `icon`, `size` md/lg                           |
| `IconButton` | icon-only, requires `label` (aria-label + tooltip), 44 px hit area                                                                                                                                                |
| `ButtonLink` | anchor styled as a button (navigation actions)                                                                                                                                                                    |
| `ActionBar`  | consistent place for page/record actions (section 10.3)                                                                                                                                                           |
| `RowActions` | table row action cell: **one `⋮` icon button** opening a menu (Edit/View first, safe actions, divider, destructive last); the name cell is the link (section 10.4, amended by Step 7.5; component change in 7.5c) |
| `Menu`       | dropdown/popover menu with roving focus, typeahead, Escape closes                                                                                                                                                 |

### 9.2 Feedback

`Badge` (tones success/warning/danger/info/neutral/brand, always text, optional icon), `Notice` (inline, tones, icon, dismissible),
`ToastProvider` + `useToast`, `Spinner`, `Skeleton`, `EmptyState`, `ErrorState` (message + request reference + retry),
`Tooltip` (hover + focus, never the only carrier of information), `ProgressBar`.

### 9.3 Forms

`Field` (label, hint, error, required; composes any control), `TextInput`, `NumberInput`, `MoneyInput` (integer VND only, grouping),
`Textarea`, `Select`, `Combobox` (searchable, async optional), `Checkbox`, `RadioGroup`, `Switch`, `DateInput`, `TimeInput`,
`DateRangePicker` (section 14.4), `SearchInput` (debounced, clear button), `FormSection`, `FormActions` (sticky footer on phone),
`FileDropzone` (base of `ImageUploader`). Validation messages are supplied by screens (no schema library imposed).

### 9.4 Data display

| Component            | Notes                                                                                                                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DataTable`          | typed columns (`header`, `cell`, `align`, `sortable`, `hideBelow`), sticky header, row hover/selection, optional row link, loading (skeleton), empty, error; **phone = card list** (`mobileTitle` / `mobileMeta` per column); `mode="client"   | "server"` paging |
| `Pagination`         | numbered pages with first/last, prev/next, `aria-label` per page, "Showing 21-40 of 133", **page-size select (10/20/50)**, works for `page`/`total` (server), computed (client) and a cursor variant ("Load more" / next-prev) for keyset APIs |
| `ListToolbar`        | one row above the table: `SearchInput`, filter controls (`Select`/chips), result count, `Reset filters`, right-aligned primary action; wraps on tablet, collapses filters into a "Filters" sheet on phone                                      |
| `FilterChips`        | applied filters as removable chips                                                                                                                                                                                                             |
| `DescriptionList`    | label/value pairs for detail pages (replaces `wf-facts`)                                                                                                                                                                                       |
| `Card`, `CardHeader` | surface container; `Section` maps onto it                                                                                                                                                                                                      |
| `Tabs`               | URL-synchronised optional; roving focus                                                                                                                                                                                                        |
| `Avatar`             | initials fallback                                                                                                                                                                                                                              |
| `Stat`               | label + value + optional delta, used by KPI card (section 14)                                                                                                                                                                                  |

### 9.5 Overlays

`Dialog` (modal, focus trap, Escape/backdrop close unless `busy`), **`ConfirmDialog`** (section 11), `Drawer` (side sheet, used for
mobile nav, filter sheet, quick edit), `Popover`. Bottom-sheet presentation on phone for `Dialog` sizes sm/md.

### 9.6 Layout and shell

`AppShell` (sidebar, topbar, content, skip link), `SidebarNav` (groups, collapsed rail, `aria-current`), `Topbar`, `UserMenu`,
`ThemeToggle`, `LanguageSwitch`, `PageHeader` (breadcrumbs, title, description, actions), `PageSection`, `Breadcrumbs`, `Stack`,
`Grid`, `Split` (form with side summary), `StickyActions`.

### 9.7 Interaction

`SortableList` and `SortableGrid` (drag and drop with pointer, touch and keyboard sensors; each item exposes "Move up/down"
buttons as the non-drag alternative; announces moves via a live region; emits `onReorder(orderedIds)`; never persists by itself),
`DragHandle`. Built on `@dnd-kit/core` + `@dnd-kit/sortable` (dependency approval Q-D1). Used by the dashboard (Step 7) and the
slider (Step 13).

### 9.8 Images and charts

`ImageUploader` (section 16.3; presentational: file pick/drop, client-side type/size precheck, preview, progress, error; takes an
`upload(file)` function so the API client stays in `apps/web`), `ImageThumb` (aspect-ratio box, `srcset`, lazy), `MediaPicker`
(grid of library images, select one/many). Chart kit: section 14.

---

## 10. Layout consistency and list/CRUD conventions

### 10.1 Page anatomy (every page)

```
Topbar
[Breadcrumbs]                       (detail/form pages only)
Page title (h1)            [Secondary actions] [PRIMARY ACTION]
Optional one-line description
--------------------------------------------------------------
ListToolbar: [Search........] [Filter] [Filter]  12 results  [Reset]
DataTable (or board/detail content)
Pagination: Showing 1-20 of 133      [10|20|50]  « ‹ 1 2 3 › »
```

The **primary action** (Create / Add) is top right of the header, one per page, wine fill. Page width is fixed by template
(section 12) so the title/actions never jump between pages.

### 10.2 Lists

Every list uses `ListToolbar` + `DataTable` + `Pagination`, with: default sort stated in the header (sortable columns show an arrow),
search when rows can exceed ~15 (name/code/phone as PRD 52), filters for status and the main foreign key (branch, category, team),
URL query parameters for `q`, filters, `page`, `pageSize` so a filtered/paged view can be reloaded and shared, page size default 20,
page reset to 1 when a filter changes, loading/empty/error states, and a `role="status"` live result count. Lists that are
short by nature (branches, roles) still show the toolbar-less table with pagination hidden only when total <= page size
(the component always renders the row count line). Paging mode per list is in the Step plan and section 17 (Q-D3).

### 10.3 Actions on a record (detail/form pages)

`ActionBar` in the page header, right aligned: `[Edit]` (secondary) then `[Deactivate]`/`[Cancel]`/`[Delete]` in danger-outline
(icon + text), and the single primary action **last, at the trailing edge**. On phone the bar becomes primary + `...` menu. Forms,
dialogs and drawers end with the same order (**amended by Step 7.5**, was `[Save] [Cancel]` left to right): `[Cancel]` (secondary or
ghost) then `[Save]` (primary), right aligned at the trailing edge of the form or dialog, sticky at the bottom on phone.

### 10.4 Row actions in tables

The last column (48 px), right aligned, header visually hidden but present for AT ("Actions"): **a single `⋮` icon button** (label
"Actions") that opens a menu (**amended by Step 7.5**, was "Edit + `...`"). The order inside the menu is fixed: `Edit` (or `View` when
the user has read-only authority) first, other safe actions, then a divider, then the destructive one, in danger text with icon. The
row's name cell is the link to the detail page (or opens the edit dialog where no detail page exists). On phone the `⋮` sits at the top
right of the card. Bulk actions are **not** introduced (no requirement; none exist).

### 10.5 What the button says: the allowed action, not "Delete"

Delete appears **only** where the API supports a real delete (today: service, service category, team, and Steps 11-13 content).
For everything else the UI shows the action the domain allows, with words that say what will happen:

| Entity                             | Button(s) offered                             | Never shown        | Basis                                           |
| ---------------------------------- | --------------------------------------------- | ------------------ | ----------------------------------------------- |
| Service, service category          | Edit, **Delete** (when unused) / Deactivate   |                    | existing `POST .../delete` and `.../status`     |
| Team                               | Edit, **Delete** / Deactivate                 |                    | existing `POST teams/:id/delete`                |
| Branch, skill                      | Edit, **Deactivate / Reactivate**             | Delete             | status endpoints only                           |
| Role                               | Edit (name, permissions)                      | Delete, Deactivate | API has no remove/disable; none invented (D11)  |
| Employee                           | Edit, **End employment**, Disable access      | Delete             | lifecycle (PRD 40, immutable history)           |
| Branch assignment, org appointment | **End / Revoke**                              | Delete             | history preserved                               |
| Booking / visit line               | **Cancel**, No-show, Resolve end              | Delete             | operational history                             |
| Leave request                      | **Cancel request**, Approve / Reject          | Delete             | history                                         |
| Attendance record                  | **Correct**                                   | Delete             | correction record                               |
| Invoice                            | **Cancel invoice** (re-auth when finalized)   | Delete             | financial history                               |
| Payment                            | **Reverse** (`CORRECT_PAYMENTS`, re-auth)     | Delete             | explicit correction record                      |
| Discount / voucher                 | Edit, **Deactivate / Cancel**                 | Delete             | redemption history                              |
| Notification                       | **Archive**                                   | Delete             | existing                                        |
| Media, popup, slide (Steps 11-13)  | Edit, **Delete** (with reference rules, 16.8) |                    | marketing content, not business history (Q-CM5) |

If an action is not permitted or not possible, the button is **hidden** when the user could never do it (permission) and
**disabled with a visible reason** (text under the button or tooltip that is also in `aria-describedby`) when a state prevents it
(for example "Cannot delete: used by 12 bookings. Deactivate instead"). The Deactivate alternative is offered right there.

---

## 11. Confirmation dialogs

`ConfirmDialog` replaces `ConfirmDeleteDialog` (which stays until Step 8-9 migrate its callers). Props: `title`, `description`,
`facts` (name/code shown as a `DescriptionList`), `tone` (`danger` | `warning` | `neutral`), `confirmLabel` (verb + object, never
"OK"/"Yes"), `cancelLabel`, `onConfirm(): Promise<void>`, `reasonField` (optional required text, for cancellations that need a reason),
`requireTyping` (optional: type the code to confirm, reserved for irreversible bulk-like actions; not used today).

Behaviour (kept from the existing dialog): nothing is sent until the confirm button is pressed; Cancel, Escape and backdrop close
with no request; focus starts on **Cancel** (the safe choice); confirm button shows a spinner and the dialog cannot be dismissed
while busy; a server refusal keeps the dialog open, keeps the record and shows the reason in an inline `Notice` with the request
reference. `role="alertdialog"`, `aria-labelledby/-describedby`, focus trapped and restored to the trigger. Copy pattern:
title "Delete service?" / body states consequence and reversibility / button "Delete service". The existing re-authentication dialog
(`reauth-dialog.tsx`) remains a separate step-up flow that can **precede** the confirm.

---

## 12. Page templates

Each template fixes structure, spacing and responsive behaviour; a screen picks one and fills slots.

### 12.1 List page

Header (title, description, primary action) then `ListToolbar` then `DataTable` then `Pagination`. Max width: fills content column (up
to 1280 px). Row click opens the detail page; Edit/menu per 10.4. Phone: card list, filters in a sheet, primary action as a
full-width button under the title.

### 12.2 Detail page

Breadcrumbs, header with title + status `Badge` + `ActionBar`, then a two-column layout on desktop (main sections left,
summary/meta right, 2/3 + 1/3) that stacks on tablet/phone; sections are `Card`s with `CardHeader` (title + section action);
long detail pages use `Tabs` (Overview, related lists), each related list following 12.1 inside its tab. Facts use `DescriptionList`.

### 12.3 Form page

Breadcrumbs, title, single column max 720 px (optional right summary `Split` on desktop), grouped `FormSection`s with headings,
`FormActions` at the end (sticky on phone). Same template for create and edit; create pages say "New ..." in the title. Multi-step
creation (employee) shows a step indicator but keeps the same anatomy.

### 12.4 Board page

For booking board, POS board, reassignment, collaborator schedule, my services: header with date/branch controls (`Select`, date
stepper), a horizontal summary strip (counts as `Stat`s), then columns/lanes (desktop: side-by-side lanes; tablet: two; phone: one
lane at a time with a segmented control). Cards are compact with a status `Badge`, the customer/participant name first, the time
second. Board actions live on the card via `Menu`; destructive ones use `ConfirmDialog`. No drag and drop on operational boards
(the domain has explicit commands; not requested by the Owner).

### 12.5 Dashboard page

Header (greeting, branch/date scope selector, **Customize** toggle) then the widget grid (sections 14-15). Same shell; the grid is
12 columns on desktop, 6 on tablet, 1 on phone.

### 12.6 Auth pages

Login/forgot-password (workforce): the **centered card** (max 26 rem, wordmark LUCY SPA at the top inside the card) on a **full-screen brand background** (Owner correction after Step 5, replacing the split layout): deep brand-red gradient from the `--ls-auth-panel-*` tokens plus very subtle botanical line art as an inline SVG pattern, the same in light and dark, so the sides are not empty. The card stays on the normal surface tokens (light card in light mode, dark card in dark mode). Language switch and theme toggle stay at the top right of the page, restyled for the red background (on-red tokens, including the focus ring). Phones: same background, card with side margins. No animation, no external image (a photo can replace the background later). No shell. Card anatomy (Owner UX review): wordmark, 24 px gap, title, intro, form; the identifier choice is a two-option segmented control (Employee ID | Email); the "Forgot password?" link sits at the right end of the password label row; every password field has a show/hide button; vertical spacing uses spacing tokens only; the card has an elevation shadow token that works on red in light and dark. Customer auth pages are not part of this track (Part 2).

---

## 13. Responsive rules

| Aspect       | Phone (< 640)                 | Tablet (640-1023)                                | Desktop (>= 1024)                  |
| ------------ | ----------------------------- | ------------------------------------------------ | ---------------------------------- |
| Navigation   | drawer                        | icon rail, expands as overlay                    | full sidebar (collapsible)         |
| Tables       | card list                     | table, low-priority columns hidden (`hideBelow`) | full table                         |
| Filters      | in a "Filters" sheet          | inline, wrapping                                 | inline                             |
| Dialogs      | bottom sheet                  | centered                                         | centered                           |
| Forms        | single column, sticky actions | single column                                    | single column (+ optional summary) |
| Dashboard    | 1 column                      | 6-col grid                                       | 12-col grid                        |
| Touch target | 44 px                         | 44 px                                            | 40 px (44 px on coarse pointer)    |

Verified widths in acceptance: 360, 768, 1024, 1440. No horizontal page scroll at any width (tables scroll inside their own
container only where a card list is not used, such as boards).

---

## 14. Dashboard and chart kit (design now; analytics plug in later)

### 14.1 Widget model

A widget is a self-contained card with a typed definition (registered in `apps/web/src/lib/workforce/dashboard/registry.ts`):
`id`, `titleKey` (i18n), `size` (`s` 3 cols, `m` 6, `l` 9, `xl` 12; heights in row units), `requires(account) => boolean`
(permission hint: hides the widget and hides it from the customize list), `scope` (`branch` | `global` | `self`), `component`
(lazy). A widget owns its data loading (`useResource`), shows skeleton/empty/error/no-access states, refreshes on focus and every
5 minutes at most (no websockets), and links to the screen that holds the details ("View all"). Widgets never write.

Default layout per account kind (Owner, manager, employee) is derived from what the account may see; an unavailable widget is
skipped in the saved layout rather than breaking it. Adding a new widget later (Phase 8) = one registry entry + one component; no
change to the grid, persistence or permission plumbing. That is the "plug in without redesign" guarantee.

### 14.2 Customize mode and drag and drop

`Customize` toggles edit mode: widgets show a drag handle, a size control (S/M/L where allowed) and a hide button; a side/sheet
list offers hidden widgets to add back; `Reset to default` restores the derived layout; `Done` saves. Reordering uses
`SortableGrid` (pointer, touch after a short press, keyboard: Space to lift, arrows to move, Space to drop) and always offers
**Move earlier / Move later** buttons. Outside edit mode nothing is draggable (prevents accidental moves on touch).

**Persistence:** the layout is a small JSON `{ version, order: string[], hidden: string[], sizes: Record<string, size> }` stored in
`localStorage` under `ls-dashboard:{accountId}` (per user, per device); the theme is a cookie (6.1). No API change (D11).
Unknown/removed widget ids are ignored; new widgets append to the end. Cross-device sync would need a small preferences table
and endpoint, which is outside D11: decision Q-D2 (recommended: accept per-device for now).

### 14.3 Widgets built in this track (only backed by existing endpoints)

| Widget                    | Data (existing endpoint)                                              | Shown when (UX hint; API still authorizes)            | Notes                                                                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Greeting + recovery email | `auth/me`, recovery-email section (existing)                          | always                                                | fixed at top, not movable                                                                                                                                                  |
| Today's bookings          | `GET operations/branches/:id/today` (`bookings`, derived states)      | `VIEW_BOOKINGS` at a branch                           | counts by state + next 5                                                                                                                                                   |
| Customers in service      | same response (`activeVisits` with running lines, `queue.serving`)    | `VIEW_BOOKINGS`                                       | count + list of participants and KTV                                                                                                                                       |
| Waiting / queue           | same response (`waitingPool`, `queue.waiting`)                        | `VIEW_BOOKINGS`                                       | count + longest wait                                                                                                                                                       |
| Awaiting invoice          | `GET pos/branches/:id/board` (`awaiting`)                             | `VIEW_INVOICES`                                       | completed visits without invoice                                                                                                                                           |
| Paid invoices total       | `GET pos/branches/:id/board` (`invoices` trailing 7 days, `totalVnd`) | `VIEW_INVOICES` **and** `VIEW_REVENUE` at that branch | sum of paid invoice totals per business date, 7-day line/bar chart + KPI "today vs yesterday"; labelled "Paid invoices", **not** "Revenue" until Phase 8 defines it (Q-D5) |
| Payment alerts            | `GET pos/branches/:id/payment-anomalies`                              | `CORRECT_PAYMENTS` at a branch (the endpoint's rule)  | open anomaly count, link to POS                                                                                                                                            |
| Pending leave decisions   | `GET leave-requests?status=PENDING` (existing dashboard logic)        | `APPROVE_LEAVE`                                       | count                                                                                                                                                                      |
| My attendance today       | `attendance/me`, branch assignments (existing dashboard logic)        | employee                                              | in/out state per branch                                                                                                                                                    |
| My leave                  | `leave-requests/me` (existing)                                        | employee                                              | pending count                                                                                                                                                              |
| Notifications             | `GET notifications`, `unread-count` (existing)                        | always                                                | latest 5 + unread count                                                                                                                                                    |
| Quick links               | `navigationFor(account)`                                              | always                                                | replaces the old "Management" grid                                                                                                                                         |

Not built (no data yet, listed so Phase 8 knows the slots): revenue by service/branch/period, top services, employee performance,
retention, payroll, inventory. These arrive as new registry entries using the chart kit below.

Branch scope: widgets that need a branch use the dashboard scope selector (a branch the account may see, default first
permitted); "All my branches" is offered for count widgets only where the existing endpoints are called per branch in parallel
(bounded; if an account has more than 5 branches the selector is required). No new aggregate endpoint is added.

The revenue-style widget aggregates figures the user can already read one by one in POS; it is **not** a security boundary and
does not replace the server-enforced Phase 8 reports. State this in the widget's info tooltip.

### 14.4 Chart kit (`packages/ui`, SVG, no chart library)

Built in Step 6 with `d3-scale` and `d3-shape` (small, modular; approval Q-D1) or hand-written scales if not approved. Components:
`KpiCard`, `LineChart` (multi-series, area optional), `BarChart` (vertical/horizontal, grouped/stacked), `DonutChart` (also
serves as pie with `innerRadius=0`; max 6 slices then "Other"), `Sparkline`, `ChartLegend`, `ChartTooltip`, `ChartTable`
(accessible data table twin), `DateRangePicker`, `ComparisonToggle`, `ChartFrame` (title, subtitle, actions, loading/empty/error).

Shared contract (a single data shape so Phase 8 only supplies rows):

```
Series      { id, label, color?: SlotIndex, points: { x: Date | string, y: number }[] }
Comparison  { current: Series[]; previous?: Series[] }      // previous aligned by index (day 1..n)
Format      { valueFormat: 'vnd' | 'count' | 'percent' | 'duration'; locale: 'vi' | 'en' }
```

- **KpiCard:** label, value (`--ls-text-2xl`, tabular), delta vs previous period (arrow icon + signed % + words "up/down", never color
  alone; positive is blue/orange-neutral, **not** green/red, see 6.5, except where the metric has an unambiguous good direction and the
  screen passes `goodDirection`), optional `Sparkline`, "as of" time, info tooltip.
- **DateRangePicker:** presets (Today, Yesterday, 7 days, 30 days, This month, Last month, Custom), two-month calendar on desktop, full
  sheet on phone, keyboard operable; dates are **branch business dates** (`YYYY-MM-DD` in branch timezone), never UTC instants; max
  range configurable (default 366 days).
- **Comparison to previous period:** `ComparisonToggle` (None | Previous period | Same period last year). The kit computes the shifted
  range (equal length, immediately before) and passes both ranges to the data loader; the chart draws the previous series dashed in
  a neutral tone and the tooltip shows both values and the delta.
- **Marks and accessibility** (dataviz rules): 2 px lines, >= 8 px markers, 4 px rounded bar ends, 2 px surface gap between stacked
  segments, recessive grid, selective direct labels, legend always present for >= 2 series, hover crosshair + tooltip, keyboard
  focus on data points, a "Show as table" toggle on every chart, text in text tokens (never series color), dark mode uses the dark
  slots, texture pattern available for forced-colors/print. No dual axis, no 3D, no rainbow.
- **Formats:** VND with grouping and no decimals; counts as integers; percentages 1 decimal; durations in minutes (internal service
  durations are never shown to customers, PRD 4.2, but are allowed in admin).
- **Performance:** charts render <= 400 points; longer series are bucketed by the data loader (Phase 8), not by the chart.

---

## 15. Dashboard grid mechanics (summary for Step 7)

CSS grid, 12 columns (desktop) / 6 (tablet) / 1 (phone), gap 16 px, widget min height by size; items positioned by **order** (flow),
not free x/y, so layouts never overlap and always reflow on breakpoints. Order is the single persisted fact (14.2).
Skeletons reserve the widget height to avoid layout shift. Each widget is an error boundary. Tests: layout derivation per
permission set, persistence round trip, ignore unknown ids, keyboard reorder, hidden widget restoration.

---

## 16. Website content management (Steps 11-13)

Purpose: the Owner (or an authorized delegate) manages the customer-facing website content without a developer: a media library,
one promotional popup, and a homepage slider. It respects PRD 4.2 ("promotional popup on entry; user can dismiss it") and the
"popup/banner management" and "presentation surfaces" of PRD 24.1, without becoming a page builder or a CMS. PRD 24.1's campaign
association and sale badges belong to Phase 6 and are **not** built; this feature leaves room for them (16.9).

### 16.1 Permission and audit

One new permission `MANAGE_WEBSITE_CONTENT`, **GLOBAL_ONLY** (website content is not branch-scoped, like `MANAGE_DISCOUNTS`),
added through an additive migration of the `PermissionCode` enum and the permission catalog (`db:permissions:sync` at
deployment, as in Phase 4). It grants read + write of all three content types in the admin API; public read endpoints need no
permission. Nav item `websiteContent` appears with `canGlobal(account, 'MANAGE_WEBSITE_CONTENT')`. Every create/update/publish/
reorder/delete writes an `AuditEvent` (actor, entity, before/after summary, no image bytes). Decision Q-CM1 (single vs split).

### 16.2 Data model (additive migration; names indicative, final in Step 11)

| Table            | Key fields                                                                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `media_assets`   | `id` uuid, `storage_key` (opaque), `original_filename`, `mime`, `bytes`, `width`, `height`, `sha256`, `alt_vi`, `alt_en` (nullable), `created_by`, `created_at`, `row_version`, `deleted_at` null                           |
| `media_variants` | `asset_id`, `kind` (`thumb` 320w, `md` 960w, `lg` 1920w, all WebP), `storage_key`, `width`, `height`, `bytes`                                                                                                               |
| `website_popups` | `id`, `media_id` fk (nullable: text-only allowed), `title_vi/en`, `body_vi/en`, `cta_label_vi/en`, `cta_url` (nullable), `starts_at`, `ends_at`, `is_enabled`, `row_version`, audit stamps                                  |
| `website_slides` | `id`, `media_id` fk (required), `mobile_media_id` fk (nullable), `title_vi/en`, `subtitle_vi/en`, `link_url`, `link_label_vi/en`, `sort_order`, `starts_at` null, `ends_at` null, `is_enabled`, `row_version`, audit stamps |

Constraints: money not involved; timestamps `timestamptz` UTC; `sort_order` dense integers rewritten in one transaction on reorder;
`ends_at > starts_at`; `cta_url`/`link_url` validated as an internal path (`/vi/...` or `/en/...`, locale token allowed) or `https://`
URL only (no `javascript:`/`data:`); the media FK is `ON DELETE RESTRICT` (a referenced image cannot be removed). All tables
additive; no existing table changes. Popup overlap rule in 16.5.

### 16.3 Media library and storage

- **Storage interface** `MediaStorage { put(key, bytes, mime), get(key) -> stream, delete(key), publicUrl(key) }` in `packages/server`
  with one implementation now, `LocalDiskMediaStorage`, writing under `MEDIA_STORAGE_DIR` (an absolute path **outside** the repo
  and the release folder so deploys never wipe it; new required env var, documented in the Step report and deployment checklist).
  An S3-compatible implementation can replace it later by configuration only; DB rows hold opaque `storage_key`s, never paths or
  URLs, so no data migration is needed. Keys are random (`{yyyy}/{mm}/{uuid}.{ext}`), never derived from the filename.
- **Upload** `POST /api/v1/website/media` (multipart, `MANAGE_WEBSITE_CONTENT`, CSRF as all mutating routes, per-user rate limit).
  Limits: JPEG/PNG/WebP only (**no SVG, GIF, video, PDF**: SVG can carry script), 10 MB and 6000 px per side max (Q-CM8). The server
  sniffs magic bytes (ignores the client MIME and extension), re-encodes with `sharp` (approval Q-CM11), strips EXIF/GPS and
  auto-orients, keeps the **original** (PRD 53: originals are not destroyed) and creates the three WebP variants. Dedupe by
  `sha256`: re-uploading the same file returns the existing asset. Failures return a typed error the uploader shows verbatim.
- **Serving** `GET /api/v1/public/media/{assetId}/{variant}` (no auth, `Cache-Control: public, max-age=31536000, immutable`, ETag
  from the variant, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`); only assets referenced by an **enabled,
  in-window** popup/slide are served publicly, all others 404, so the library is not a public file host. Admin thumbnails use the
  authenticated route `GET /api/v1/website/media/{id}/{variant}`. Web uses plain `<img srcset sizes loading=lazy>` with the
  variants (no Next image optimizer, no remote patterns to configure).
- **Library UI:** grid with search by filename/alt, pagination (24 per page), upload (multi-file, drag and drop, progress), detail
  drawer (preview, dimensions, size, alt VI/EN edit, "used in" list), replace-file keeping the same id is **not** offered (would
  silently change live content); instead upload new and re-select. Delete per 16.8.
- **Backups:** the media directory joins the backup scope (PRD 45); the Step 11 report states this and the restore note.

### 16.4 Image uploader component (`ImageUploader`, Step 3 shell, wired in Step 11)

States: empty (drop zone + "Choose image", accepted types and size in text), dragging, uploading (progress bar, cancel), uploaded
(thumbnail, filename, size, dimensions, `Replace`, `Remove`), error (message + retry). Client precheck of type/size/dimensions
(the server stays authoritative). Keyboard: the zone is a button; `Enter/Space` opens the file dialog. Optional `MediaPicker` to
choose an existing library image instead of uploading. Recommended-size hint per use ("1920 x 800 px, under 10 MB").

### 16.5 Promotional popup (Step 12)

- **Fields:** image (optional), title VI/EN (optional), body VI/EN (optional, plain text, max 300 chars), CTA label VI/EN + CTA
  link (optional; label required if link set), `starts_at`, `ends_at`, `is_enabled`. At least an image or a title is required.
- **One active at a time:** the server rejects saving an **enabled** popup whose `[starts_at, ends_at)` overlaps another enabled
  popup, naming the conflicting popup (transactional check under an advisory lock; no DB extension). Disabled popups may overlap.
  Recommended over "newest wins" because it is predictable and the Owner sees the schedule (Q-CM2). Schedule list shows a
  timeline strip of upcoming/active/expired.
- **Status shown in admin** (derived, always text + badge): Draft (disabled), Scheduled, Active, Ended.
- **Public behavior:** `GET /api/v1/public/website/popup?locale=vi|en` returns the one active popup (cached 60 s) or `204`. The
  public layout shows it on **entry to the public home page** (Q-CM3) after first paint, as an accessible modal dialog
  (`role=dialog`, focus trap, Escape and a visible close button of at least 44 px, backdrop click closes, focus returns to the page).
  **Shown once per visit:** after showing or closing, `sessionStorage` key `ls-popup-seen:{id}:{rowVersion}` suppresses it for the
  browser session (Q-CM4); a new version of the popup shows again. Never shown on account, workforce or checkout pages, never
  blocks scrolling behind more than the modal itself, respects `prefers-reduced-motion` (no animation). VI/EN: the visitor's
  locale text, falling back to the other language, then omitted if both are empty.
- **Admin preview:** live desktop and phone frames in the form (client-side render of the same component), before enabling
  (PRD 24.1 asks for a preview "where practical").

### 16.6 Homepage slider (Step 13)

- **Fields per slide:** image (required, recommended 1920 x 800) and optional separate phone image (recommended 1080 x 1350; when
  absent the main image is cropped with `object-fit: cover` centered), title VI/EN, subtitle VI/EN (optional), link + label VI/EN
  (optional), `starts_at`/`ends_at` (both optional = always), `is_enabled`, alt text from the media asset (overridable per slide).
- **Order:** drag and drop in a `SortableList` with thumbnails (plus Move up/down buttons); the order is saved with one `POST
/api/v1/website/slides/reorder { orderedIds, expectedVersion? }` call in one transaction, optimistic UI with rollback on error.
- **Scheduled show/hide:** a slide is _visible_ when enabled and now in `[starts_at, ends_at)`; admin shows the derived status
  (Visible, Scheduled, Ended, Hidden). Public `GET /api/v1/public/website/slides?locale=` returns visible slides in order (cached 60 s).
  Max 8 visible at once (Q-CM7); the list stays unbounded but paged (20).
- **Public rendering (basic, non-cinematic in this track):** full-width slider on the home page with prev/next buttons, dots,
  swipe on touch, autoplay 6 s that **pauses on hover/focus/touch and has a visible Pause button** and is off under
  `prefers-reduced-motion`; a single slide shows no controls; no slides -> the section is omitted and the current home content is
  unchanged. First slide image is eager with fixed aspect ratio (no layout shift); the rest lazy. The premium motion treatment of
  PRD 4.4 is Part 2 and can restyle this component without changing data or API.

### 16.7 Admin UI for the group

One nav entry **Website** with three tabs (Media, Popup, Slider) inside a normal list/detail/form template (12.1-12.3): Media = grid
list with the toolbar; Popup = list of popups + form; Slider = ordered list + form drawer. Each save shows a toast; each destructive
action uses `ConfirmDialog`.

### 16.8 Delete rules (Q-CM5)

Media, popups and slides are marketing content, not financial/operational history, so a real **Delete** is allowed (with
`ConfirmDialog`) under these rules: a media asset that any popup/slide references cannot be deleted (the dialog lists where it is
used and offers nothing destructive); deleting an asset removes DB rows and files (originals and variants); a popup or slide can
be deleted at any time, and an **active/visible** one shows an extra warning line ("It is live on the website now"). Audit events
persist. Alternative (archive instead of delete) is a one-line change for the Owner to request.

### 16.9 Fit with PRD 24.1 and boundaries

Covers from 24.1: popup/banner title, message, image, CTA label and destination, active time range, preview. Deferred to Phase 6
(no column now, add additively later): campaign association, product-card badges, sale collection pages, per-campaign
presentation. No page builder: content types are fixed, fields are fixed, layout is fixed by code. No customer data, no cookies for
tracking, no third-party scripts. Business timezone for `starts_at/ends_at` entry is Asia/Ho_Chi_Minh, stored as UTC (Q-CM6).

---

## 17. Owner decisions (ALL LOCKED)

**The Owner accepted every recommendation (**rec**) below as written: Q-D1 to Q-D6 and Q-CM1 to Q-CM13 are LOCKED and must not be
reopened.** Where a row says "Question", the answer is its **(rec)** text. Q-D1..Q-D6 govern Steps 2-7; Q-CM* govern Steps 11-13.

| ID     | Question                                                                                                                                                                                                                 | Recommendation and consequence                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q-D1   | New web dependencies: `@dnd-kit/core` + `@dnd-kit/sortable`, `d3-scale` + `d3-shape`, Be Vietnam Pro via `next/font/google` (build-time download, self-hosted).                                                          | **(rec)** approve all. Without dnd-kit a hand-made sortable is slower to build and worse for accessibility; d3 modules are optional (hand-written scales otherwise). |
| Q-D2   | Where do the theme choice and dashboard layout persist? (a) per device: cookie + `localStorage`; (b) per user on the server (needs a small `user_preferences` table and endpoint, outside D11).                          | **(rec)** (a) now; (b) can be a later small Step if the Owner wants layouts to follow the user across devices.                                                       |
| Q-D3   | Lists whose API is not paginated (most of them): paginate in the browser over the loaded set (page size 20), and add API paging later only where volume demands (POS invoices, attendance, leave, notifications, audit). | **(rec)** yes, per D11 no API change. Server paging is used where it already exists (employees, reassignment cursor, teams).                                         |
| Q-D4   | Warning color is a deep **orange** (`#8f4300` on `#fdeedd`), never amber/yellow, to honor "no gold". OK?                                                                                                                 | **(rec)** yes.                                                                                                                                                       |
| Q-D5   | The dashboard money widget is titled **"Paid invoices"** (sum of paid invoice totals per business date from the POS board), not "Revenue", until Phase 8 defines revenue (PRD 61: no invented policy). OK?               | **(rec)** yes. Alternative: omit any money widget in this track.                                                                                                     |
| Q-D6   | Navigation regrouping (section 4.2) and moving My account / My income / Notifications into the user area.                                                                                                                | **(rec)** approve. Permissions unchanged.                                                                                                                            |
| Q-CM1  | Permissions: one GLOBAL_ONLY `MANAGE_WEBSITE_CONTENT` for media + popup + slider, or split (`MANAGE_MEDIA`, `MANAGE_POPUPS`, `MANAGE_SLIDER`)?                                                                           | **(rec)** one code. Fewer roles to maintain; Owner grants it to a marketing role if wanted.                                                                          |
| Q-CM2  | "One active popup at a time": reject overlapping enabled popups (rec), or allow overlap and let the newest start date win?                                                                                               | **(rec)** reject overlap with a clear message.                                                                                                                       |
| Q-CM3  | Where may the popup appear? Home page only (rec), or the first public page a visitor lands on (any public page)?                                                                                                         | **(rec)** home page only until more public pages exist.                                                                                                              |
| Q-CM4  | "Once per visit" = once per browser session (rec) or once per day / until changed?                                                                                                                                       | **(rec)** per session; reappears when the popup is edited.                                                                                                           |
| Q-CM5  | Media/popup/slide removal: real Delete with reference protection (rec) or archive only?                                                                                                                                  | **(rec)** Delete (16.8).                                                                                                                                             |
| Q-CM6  | Schedule times entered in Vietnam time (Asia/Ho_Chi_Minh) for the whole website, not per branch?                                                                                                                         | **(rec)** yes.                                                                                                                                                       |
| Q-CM7  | Slider limits: max 8 visible slides, optional phone image, autoplay 6 s with pause; recommended sizes 1920 x 800 (desktop) and 1080 x 1350 (phone).                                                                      | **(rec)** as stated.                                                                                                                                                 |
| Q-CM8  | Upload limits: JPEG/PNG/WebP, 10 MB, 6000 px per side; no SVG/GIF/video.                                                                                                                                                 | **(rec)** as stated.                                                                                                                                                 |
| Q-CM9  | Storage: local directory on the server, `MEDIA_STORAGE_DIR` outside the release folder, included in backups; object storage later. Confirm the production path/owner (Owner/ops action at deployment).                   | **(rec)** approve; Step 11 documents the env var and permissions.                                                                                                    |
| Q-CM10 | Text fallback: if only one of VI/EN is filled, show it in both languages (rec); alt text required in VI for every image, EN optional.                                                                                    | **(rec)** yes.                                                                                                                                                       |
| Q-CM11 | New API dependency `sharp` (image re-encode, variants, EXIF strip). `multer` already ships with `@nestjs/platform-express`.                                                                                              | **(rec)** approve.                                                                                                                                                   |
| Q-CM12 | Is ordering images/slides needed anywhere **besides** the homepage slider (for example a gallery on a service or branch page)? None exist today.                                                                         | **(rec)** no; slider only.                                                                                                                                           |
| Q-CM13 | Sequencing: run Steps 11-13 after the dashboard (Step 7) as listed, or earlier/parallel to the screen migrations (Steps 8-10)?                                                                                           | **(rec)** as listed: the kit (Steps 3-6) is complete by then.                                                                                                        |

---

## 18. Step plan

Each Step: plan first, implement only that Step, targeted tests, short report in `docs/` (about 40 lines), 5 handoff lines,
`git diff --stat`, stop for Owner review. Full regression, build and smoke run **only** at Step 14. No Step commits or deploys
without the Owner. Nothing in Steps 2-10 touches `apps/api`, `packages/database` or `packages/contracts`.

| Step | Scope                                                                                                                                                                                                                                                                                                                                                                                                             | Touches                                                          | Key tests / acceptance                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1    | This contract; PRD 4.1 updated; handoff line.                                                                                                                                                                                                                                                                                                                                                                     | docs, PRD                                                        | Owner review                                                                                                                        |
| 2    | Foundations (section 8): tokens v2, theme + pre-paint script, font, base CSS, icons, gold removed, `workforce.css` literals to tokens.                                                                                                                                                                                                                                                                            | `packages/ui`, `apps/web` css/layout                             | token contrast test; both themes render; no gold/hex leftovers                                                                      |
| 3    | Core components 9.1-9.3, 9.5 (Button family, feedback, forms, Dialog, ConfirmDialog, Drawer, Menu), `ImageUploader` shell; `ui.tsx` re-exports mapped onto them.                                                                                                                                                                                                                                                  | `packages/ui`, `apps/web` ui.tsx                                 | component tests (keyboard, ARIA, longest VI label); ConfirmDialog parity with existing delete tests                                 |
| 4    | Data components 9.4: `DataTable` (client/server/cursor), `Pagination`, `ListToolbar`, `DescriptionList`, `Tabs`, card-list phone mode, URL-state hook; **pilot on Employees and Skills**.                                                                                                                                                                                                                         | `packages/ui`, employees + skills screens                        | paging math, URL state, phone layout, a11y                                                                                          |
| 5    | App shell and navigation (section 4): `AppShell`, sidebar/drawer/rail, topbar, theme toggle, user menu, breadcrumbs, regrouped `navigationFor` groups (rules unchanged), auth page template.                                                                                                                                                                                                                      | `packages/ui`, `shell.tsx`, `permissions.ts` (groups only), i18n | `permissions.test.ts` still green (visibility unchanged); nav per role; 4 widths                                                    |
| 6    | `SortableList/Grid` + chart kit + `DateRangePicker` + `KpiCard` + comparison (section 14.4); dev-only demo route removed before review or behind a test file; unit tests with fixtures.                                                                                                                                                                                                                           | `packages/ui`                                                    | palette validator re-run in a test; keyboard reorder; chart a11y table; formatting                                                  |
| 7    | Dashboard (section 14, 15): widget registry, grid, customize mode, persistence, widgets of 14.3, permission gating, per-widget states.                                                                                                                                                                                                                                                                            | `apps/web` dashboard                                             | layout derivation per permission set; persistence; widget states; keyboard reorder                                                  |
| 7.5  | **Page-frame standardization** (inserted after the post-Step-7 audit; full plan and Step 8-14 remap in `UXUI_REDESIGN_STEP7_5_PLAN.md`): 7.5a rules + gate tooling, 7.5b page frame, 7.5c data frame, 7.5d forms/overlays, 7.5e dashboard + tabs, 7.5f closing audit. Owner deploys and reviews on the real app after 7.5b and 7.5d. Step 9a (Services) follows 7.5d. 7.5f copies the revised Step 8-14 map here. | `packages/ui`, frame of `apps/web` screens                       | rules 21.4; gate 21.5; audit vs baseline                                                                                            |
| 8    | Migrate **People and organization**: employees (detail, lifecycle, roles, skills, create), teams, organization, skills, roles to templates 12.1-12.3 and 10.x action rules.                                                                                                                                                                                                                                       | `apps/web` screens                                               | existing screen tests kept green + new ones for paging/actions                                                                      |
| 9    | Migrate **Catalog and Sales**: services (+detail), branches (+detail), discounts (+detail/form), POS list/invoice/payments.                                                                                                                                                                                                                                                                                       | `apps/web` screens                                               | same; destructive-action matrix (10.5) asserted                                                                                     |
| 10   | Migrate **Operations and personal**: booking board, walk-in, reassignment, my-services, collaborator schedule, attendance, leave, my account, my income, notifications, login/forgot pages (board template 12.4).                                                                                                                                                                                                 | `apps/web` screens                                               | same; `wf-*` legacy CSS deleted at the end of this Step                                                                             |
| 11   | **Content A**: migration (`media_assets`, `media_variants`, permission enum), `MediaStorage` + local implementation, upload/serve/list/update/delete API, audit, media library UI, `ImageUploader` wired. New env `MEDIA_STORAGE_DIR`.                                                                                                                                                                            | api, database, server, contracts, web                            | integration: upload validation (type/size/magic bytes), variants, dedupe, delete-if-referenced refusal, permission, audit; UI tests |
| 12   | **Content B**: `website_popups`, admin CRUD with overlap rule, status derivation, preview, public popup endpoint and public-site component (once per session).                                                                                                                                                                                                                                                    | api, database, contracts, web                                    | integration: overlap, schedule window, public visibility; web: once-per-session, focus trap, Escape                                 |
| 13   | **Content C**: `website_slides`, admin list with drag-and-drop reorder, schedule, public slides endpoint and basic slider component.                                                                                                                                                                                                                                                                              | api, database, contracts, web                                    | integration: reorder transaction, visibility window, max visible; web: keyboard reorder, pause, reduced motion                      |
| 14   | **Part 1 final validation**: `pnpm check`, full tests including integration on a scratch DB, build, smoke; axe/a11y pass on key pages in light+dark at 360/768/1440; deployment checklist (env var, `db:permissions:sync`, media dir permissions, backup scope).                                                                                                                                                  | all                                                              | full gate; report with deployment checklist                                                                                         |

**Remap of Steps 8-10 after 7.5 (Owner-approved 2026-10-01; detail in `UXUI_REDESIGN_STEP7_5_PLAN.md` section 8).** The frame, list
and form primitives now exist, so each Step is split and screens are assembled from them with no new `wf-*` CSS. Each sub-step
ends with the gate and Owner review; the last of each group sets its ratchet counters to 0. Delete/Cancel/Deactivate wording
follows 10.5.

- **9a** Services first: `DataTable` client mode, toolbar filters, category column, `⋮` menu, create in `FormDrawer`.
- **8a** Skills (finish), Roles (permission matrix with `CheckField`), Teams list and detail. **8b** Employee detail, lifecycle,
  roles, skills, create (page form). **8c** Organization (tab panels to `DataTable` and forms).
- **9b** Service detail, Branch detail, Discounts. **9c** POS board, invoice, payments (financial actions stay in `ConfirmDialog`).
- **10a** Booking board, walk-in, reassignment. **10b** My services, collaborator schedule, attendance, leave, my account, my
  income, notifications; delete the remaining `wf-*` CSS.

Done in 7.5: Skills and Branches (7.5d) and Employees (7.5c) are already on the new frame; Dashboard and the Organization tab strip
(7.5e); hover theme by tokens (7.5d).

Ordering constraints: 2 -> 3 -> 4 -> 5; 6 needs 3; 7 needs 5 and 6; 8-10 need 4 and 5; 11 needs 3-5 (may start its backend half
earlier if the Owner asks); 12 needs 11; 13 needs 6 and 11; 14 last. Steps 8-10 may swap order.

**Part 2 (later, own contract, Owner to start):** customer area and public site redesign on the same tokens and kit, including the
premium motion system of PRD 4.4, the public look of the popup/slider, logo and imagery when supplied, and the serif display face
decision. Nothing in Part 1 blocks it; Step 2 already removes gold from shared tokens.

## 19. Risks and mitigations

| Risk                                                            | Mitigation                                                                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Big-bang restyle breaks screens (15.7k lines of screen code)    | components land first; screens migrate in three reviewed Steps; old and new CSS coexist; existing screen tests must stay green  |
| Long Vietnamese labels overflow controls                        | wrap-first components; longest-VI-string test rule in Step 3                                                                    |
| Brand red confused with error red                               | rules in 6.4 enforced by component variants (solid danger only in `ConfirmDialog`) and reviewed on screenshots each Step        |
| Client-side paging hides scale problems                         | table shows total; Q-D3 records which lists need API paging when volumes grow                                                   |
| Uploads: abuse, malicious files, disk loss                      | magic-byte sniffing, re-encode, no SVG, rate limit, permission + CSRF, opaque keys, backups, public serve only for live content |
| Local-disk media storage blocks scaling out to multiple servers | storage interface; keys opaque; swap to object storage by config                                                                |
| Dashboard layout only per device                                | disclosed (Q-D2); server preferences can follow as a small later Step                                                           |
| Scope creep into analytics/CMS/page builder                     | non-goals in section 2; new widgets/content types need an Owner-approved Step                                                   |

---

## 20. Seasonal and holiday themes (Owner decision D12, design only)

**Status: decision recorded 2026-09-30, documentation only. Nothing in this section is implemented; no code, schema, API or
migration was changed.** It is planned as its own Steps S1-S5 (20.8), separate from Steps 2-14. It builds on Step 5 (theme
mechanism, admin shell) and on the website-content group (Steps 11-13).

### 20.1 The decision

- A **seasonal theme layer** sits on top of light/dark. It is a fixed list of **presets**: Lunar New Year (Tet), Christmas,
  Valentine (14/2), International Women's Day (8/3), Vietnamese Women's Day (20/10), Mid-Autumn, 30/4-1/5, National Day (2/9);
  extensible later by adding a preset in code (20.2), never by a runtime builder.
- Each preset has: accent tokens (light and dark), light decorations (inline SVG ornaments, optional particles), a header/banner
  frame, and a greeting text in VI and EN.
- **Brand red `#782b37` stays the primary color.** A preset adds an accent beside it; it never replaces brand, text, surface,
  border, focus or status tokens. WCAG AA holds in light and dark, for every preset (20.3).
- The Owner **schedules** a theme with start and end dates (Vietnam time), with a preview. It turns on and off automatically.
  **One theme is active at a time.** Lunar dates are entered by the Owner each year; the system never computes them.
- **Customer side changes visibly** (website, customer area, future mobile app). **Admin gets only a subtle touch** (20.5).
- A holiday may activate **theme + promotional popup + homepage slides together** (20.6).
- **No free-form theme builder**: the Owner picks a preset, dates and greeting text; nothing else is editable (no color pickers,
  no uploaded ornaments, no custom CSS). This matches D10 (no page builder).

### 20.2 Mechanism (how it layers on Step 5)

- A second, independent attribute: `data-season="<presetKey>"` beside `data-theme`. Theme is a per-device choice from a cookie
  (Step 2/5); season is decided by the **server** from the schedule, so it is rendered on `<html>` by the root layout (no flash)
  and never stored by the visitor.
- The **preset registry is data only** (key, names VI/EN, default greeting VI/EN, accent tokens for light and dark, suggested window
  for solar holidays, ornament id) in `packages/contracts`, so web and the future mobile app share one source. The web build
  generates `season.css` from it (a test fails if the generated file is out of date). Adding a preset = registry entry + ornament +
  tests, in a code change; the database only stores the preset **key**.
- Tokens a preset may set (and nothing else): `--ls-season-accent`, `--ls-season-accent-soft`, `--ls-season-on-accent`,
  `--ls-season-frame-from`, `--ls-season-frame-to`, `--ls-season-frame-text`. Defaults in `tokens.css` equal the neutral brand
  values, so with no season every component looks exactly as today. Only season components and the admin accent line read them.
- Selectors are **scopable**, not root-only: `[data-season='x']` with dark variants under
  `:root[data-theme='dark'] [data-season='x']` and the system-preference media query. This lets the admin preview apply a preset
  to a frame and lets the public site apply it to a header region without touching `<html>`.
- **Decorations** (customer side only): inline SVG ornaments (`aria-hidden`, `pointer-events: none`, no external image, no
  request) in the header/banner frame and hero corners; a thin greeting strip; optional **particles** (petals, snowflakes, lanterns,
  hearts) as a small fixed pool (at most 24 elements, fewer on phones), CSS transform/opacity only, loaded after first paint,
  paused when the tab is hidden. Particles **render nothing** under `prefers-reduced-motion` (checked in the component, not only by
  the global duration reset), and a visible "Turn off effects" control stores a per-device cookie `ls-fx=off`. No layout shift, no
  scroll blocking, no third-party script.
- Decorations never sit under text that has to be read, never use yellow/gold (D1, Q-S1), never change the popup/slider behavior
  defined in 16.5-16.6.

### 20.3 Accessibility and colors

- Every preset defines accent tokens for light **and** dark. A test (same style as `tokens.test.ts`) iterates
  presets x {light, dark}: accent text on each surface at least 4.5:1, `on-accent` on accent and on the frame gradient stops at
  least 4.5:1, accent used as a UI boundary at least 3:1. A preset that fails cannot ship.
- Red flag motifs (30/4, 2/9) would collide with error red (6.4): those presets use line-art stars and lotus as ornaments and a
  rose/coral accent, never flat danger red. Brand red and danger red stay distinct.
- Indicative accents (final values fixed and verified in S1): Tet peach-blossom pink and deep red; Christmas pine green; Valentine
  rose; 8/3 and 20/10 orchid/pink; Mid-Autumn plum/indigo with lantern coral; 30/4-1/5 and 2/9 rose/coral with white.

### 20.4 Schedule, data and API (Step S3; additive migration, names indicative)

Table `website_seasons`: `id` uuid, `preset_key` text (validated against the registry by the API, so a new preset needs no
migration), `label` (internal name, for example "Tet 2027"), `starts_at`, `ends_at` (`timestamptz` UTC; `ends_at > starts_at`;
**entered in Asia/Ho_Chi_Minh**, Q-CM6; the form takes the last day inclusive and stores the next day 00:00 local as the exclusive
end), `greeting_vi/en` (nullable: empty = preset default; max 80 chars, plain text), `apply_customer` (default true),
`apply_admin` (default true), `particles_enabled` (default true), `is_enabled`, `row_version`, audit stamps. Additive
`campaign`/`season_id` link columns on `website_popups` and `website_slides` (20.6).

- **One active at a time:** saving an **enabled** season whose window overlaps another enabled season is rejected, naming the
  conflict (transactional check under an advisory lock, exactly the popup rule 16.5). Consecutive windows that touch are fine
  (end is exclusive).
- **Automatic on/off:** the active season is derived from `now()` at read time; there is no job and nothing to "turn off".
  Status shown in admin (text + badge): Draft, Scheduled, Active, Ended.
- **Public read:** `GET /api/v1/public/website/season?locale=` returns `{ presetKey, greeting, endsAt, particles }` or `204`,
  cached 60 s. The mobile app uses the same endpoint plus the shared registry for token values and bundles its own native
  ornaments (Q-S8). No personal data, no cookies, no tracking.
- **Admin API:** `/api/v1/website/seasons` list (paged), get, create, update (row_version), enable/disable, delete. Permission: the
  existing GLOBAL_ONLY `MANAGE_WEBSITE_CONTENT` (Q-S9); CSRF and rate limit as all mutations; every write is an `AuditEvent`.
  Deleting is allowed (marketing content, as 16.8) with `ConfirmDialog` and an extra line when the season is Active.
- **Lunar dates:** the Owner types real dates each year. For solar holidays the form may prefill a **suggested** window from the
  registry (for example 8/3: 6-9 March), always editable and never saved unless the Owner confirms (Q-S3).

### 20.5 Surfaces

| Surface                   | What changes                                                                                                                                  | Switch                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Website and customer area | accent tokens, header/banner frame, ornaments, greeting strip, optional particles; visible. Fully styled on Part 2 components (Q-S7)          | `apply_customer`; visitor `ls-fx=off`   |
| Future mobile app         | same preset key, tokens, greeting and window from the public endpoint; native ornaments                                                       | `apply_customer`                        |
| Admin (workforce)         | **subtle only**: a 2 px accent line under the topbar and a small greeting chip in the dashboard header. No ornaments, no particles, no motion | `apply_admin`; per-device "hide" cookie |

Admin readability is never affected: tables, forms, status colors, focus ring and the auth panel keep base tokens.

### 20.6 Holiday bundle: theme + popup + slides

One holiday can switch on a theme, a popup and slides together. Recommended model (Q-S2): a popup or slide may reference a
**season** (`season_id`, nullable). A linked item is visible when it is enabled **and** its season is active (its own schedule
fields are disabled in the UI and ignored; unlinked items behave exactly as in 16.5-16.6). The popup overlap rule uses the
season's window. The season form has a "Holiday content" panel: linked popup and slides, plus "Create popup for this holiday" and
"Add slide" shortcuts that open the normal forms with the link set. A holiday overview shows what goes live and when. Steps 12 and
13 need no change beyond adding the nullable column, which can be done additively afterwards or folded into those Steps if the
Owner approves first (Q-S7).

### 20.7 Admin screens (Step S4)

Nav: a fourth tab **Seasons** in the Website entry (16.7), normal templates 12.1-12.3. List: timeline strip of the year, status
badges, pagination 20, filters (status, year). Form: preset picker as cards (swatch, name, ornament thumbnail), dates (Vietnam
time, inclusive last day), greeting VI/EN with the preset default as placeholder, toggles (customer, admin, particles, enabled),
holiday content panel (20.6). **Preview:** desktop and phone frames x light/dark rendering the real public components with the
preset scoped to the frame (scopable selectors, 20.2); no public preview URL exists, so nothing can leak.

### 20.8 Step plan (own Steps; each: plan first, report, Owner review)

| Step | Scope                                                                                                                                                                                                            | Touches                                    |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| S1   | Registry (data) in contracts, generated `season.css`, scopable selectors, neutral defaults, admin accent line, contrast test presets x themes. No schema/API.                                                    | `packages/contracts`, `packages/ui`, shell |
| S2   | Decoration kit: ornaments per preset, frame, greeting strip, particles with reduced-motion and `ls-fx` switch; specimen screenshots for Owner review (dev-only route removed).                                   | `packages/ui`, web                         |
| S3   | Migration `website_seasons` (+ nullable link columns), API, overlap rule, audit, public endpoint, integration tests.                                                                                             | database, api, contracts                   |
| S4   | Admin Seasons tab: list, form, preview, holiday content panel, delete rule.                                                                                                                                      | web                                        |
| S5   | Wiring: root layout reads the public endpoint (60 s revalidate, failure = no season), customer/public shells and admin touch, mobile payload note, combined-holiday visibility in public popup/slides endpoints. | web, api                                   |

Order: S1 -> S2; S3 needs Step 11 (permission, Website nav) and is best after 12-13 for the link; S4 needs S1-S3; S5 last. Recommended
placement: S1-S5 after Step 13 and before the Step 14 final gate, so one validation covers them (Q-S7). S1 may start earlier.
New dependencies: none (plain SVG and CSS).

### 20.9 Does the Step 5 mechanism need changes? (plan only)

Step 5 needs **no rework**. Three small adjustments belong to Step S1, none to Step 5's code now:

1. Theme tokens are declared on `:root` (light), `:root[data-theme='dark']` and the media query; season tokens must be **scopable**
   (attribute selector without `:root`) for preview frames, as in 20.2. `useTheme` and `themeInitScript` stay unchanged.
2. The root layout must read the active season **on the server** and set `data-season` (today it only sets the language and font
   variable). It is shared by the website and the workforce area, so the lookup must be cached (60 s) and fail closed to "no season".
3. `tokens.test.ts` asserts the two dark blocks are identical; it is extended to generated season blocks, and a new test iterates
   presets. `AppShell`/`AuthLayout` need only an optional accent line (a `box-shadow` reading `--ls-season-accent`, whose default is
   the border color, so nothing changes without a season). `base.css` already removes motion under `prefers-reduced-motion`; the
   particle component additionally renders nothing.

### 20.10 Owner decisions still needed

| ID    | Question                                                                                                                       | Recommendation                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Q-S1  | D1 forbids gold and yellow, yet Tet (apricot blossom) and Mid-Autumn are traditionally gold. Keep D1 for seasons?              | **(rec)** yes: peach blossom (pink) for Tet, plum/coral for Mid-Autumn. An exception would reopen D1.           |
| Q-S2  | Holiday bundle: linked popup/slides follow the season window (rec), or stay independent with shortcuts only?                   | **(rec)** follow the season (20.6).                                                                             |
| Q-S3  | Prefill suggested dates for solar holidays (8/3, 14/2, 20/10, 30/4-1/5, 2/9, 25/12)? Lunar holidays never prefilled.           | **(rec)** yes, editable, confirm to save.                                                                       |
| Q-S4  | Admin touch: accent line + greeting chip only, with a per-device "hide"?                                                       | **(rec)** yes.                                                                                                  |
| Q-S5  | Particles: on by default for the customer side with the visitor "Turn off effects" control, at most 24 (fewer on phones)?      | **(rec)** yes.                                                                                                  |
| Q-S6  | Default VI/EN greetings per preset are proposals; maximum 80 chars, the Owner may override each schedule.                      | **(rec)** yes; proposals are listed for approval in S1.                                                         |
| Q-S7  | Sequencing: S1-S5 after Step 13 and before Step 14 (rec), or after Part 2; and the `season_id` link column now (rec) or later? | **(rec)** after Step 13; customer visuals on current public pages, full polish in Part 2; add the column in S3. |
| Q-S8  | Mobile app: public endpoint + shared registry, app bundles its own ornaments (rec), or the API serves SVG?                     | **(rec)** bundled ornaments.                                                                                    |
| Q-S9  | Permission: reuse `MANAGE_WEBSITE_CONTENT` (rec) or add a separate code?                                                       | **(rec)** reuse (Q-CM1 logic).                                                                                  |
| Q-S10 | Preview only inside admin frames, no shareable preview link?                                                                   | **(rec)** yes.                                                                                                  |
| Q-S11 | Overlapping enabled seasons rejected (rec) instead of "newest wins"?                                                           | **(rec)** reject, as popups.                                                                                    |

---

## 21. UX quality gate (MANDATORY for every remaining UI Step)

**Status: Owner rule, recorded 2026-09-30.** It applies to Steps 6-14, the seasonal Steps S1-S5 and Part 2. A UI Step is **not
reported done** until this gate has been run and its result is in the Step report. Step 14 re-runs it on the key pages.

### 21.1 Layout rules (the checklist)

1. **Spacing** (**amended by Step 7.5**): tokens only (`--ls-space-*`, all multiples of 4). Gaps **between blocks** use 8/16/24/32/48
   only; 4/12/20 live inside a control, badge, dense row or between an icon and its text. No px/rem/em literal for `margin`,
   `padding` or `gap` in screen or component CSS (the ratchet test of 21.5 counts them). Section 21.4 adds the frontend rules FR1-FR15.
2. **Type:** only the section 5 scale (`--ls-text-*`, `--ls-leading-*`); one `h1` per page; titles of the same level share size and
   weight (a page title is never lighter than the section titles under it); no ad-hoc `font-size`.
3. **Vertical rhythm:** inside one container every sibling gap comes from one rule (for example 16 px between form fields, 24 px
   between cards, the page anatomy of 10.1). No spacer elements, no one-off margins that make one gap different.
4. **Aligned edges:** blocks in a column share one left edge (brand, sidebar items, page title, cards); form labels, controls and
   buttons share one width; right-aligned actions share one right edge; controls in a row share one height and one baseline.
5. **Max widths:** text lines at most 75 characters, forms `--ls-form-max`, content `--ls-content-max`, auth card 26 rem. Nothing
   stretches across the page by accident (a select or button that fills a row it does not need to is a defect).
6. **Touch targets:** at least 44 px below 1024 px and on coarse pointers, 40 px on desktop (section 13), for icon buttons, toggles,
   segments, row and card actions and links used as titles. Only links inside running text are exempt.
7. **No orphaned or oddly placed elements:** no icon overlapping text, no badge or button label wrapping onto two lines, no
   single word alone on a line in a heading, no empty labeled cell (show an em dash), no heading followed by a link with the same
   text, no horizontal page scroll, no clipped text, the primary action in the same place as on sibling pages.
8. **Both themes and all widths:** status is never color only (6.4), no amber/gold (D1), focus ring visible on every background,
   and the same layout quality at 360, 768 and 1440 px in light and at 1440 px in dark.
9. **Shared components and motion only:** every screen is built from the `packages/ui` components and reads the motion tokens
   (6.6, D13). No ad-hoc styles that re-implement a component, no literal durations, no one-off animation or transition.

### 21.2 Procedure before a Step is reported done

1. **Render** only the screens changed in the Step with the headless browser: `node scripts/uxui-screens.mjs <name> <url-or-html-file>`. It drives
   Edge/Chrome through the DevTools protocol at **360, 768 and 1440 px in light plus 1440 px in dark** (system color-scheme
   emulation; `--all` adds dark at 360 and 768), saves full-page PNGs plus a readable `-top` crop to **`.local/uxui-screens/`** (ignored by git) and prints an automatic audit:
   horizontal page scroll and interactive targets under the minimum size. Exit code 1 (`CHECK` lines) means findings to fix or to
   explain in the report.
2. Screens that load data are rendered **with data**: the real screens run in a local harness (`.local/uxui-harness/`, machine-local
   and not committed: an esbuild bundle of the real shell and screens, `next/link` and `next/navigation` stubbed, a scripted
   `fetch` with realistic Vietnamese fixtures). Recreate it from that description if missing, or point the script at the running
   app. Open states that the Step changes (menu, dialog, drawer, filter sheet, tablet overlay) are captured too.
3. **Review** each image against 21.1, fix, and render again until clean. Look at the `-top` crop at full size; a downscaled
   full-page image hides misalignment.
4. **Report** in the Step report (a "UX gate" paragraph of at most 5 lines): screens and widths reviewed, issues found and fixed,
   anything deliberately left and why, and the folder `.local/uxui-screens/` so the Owner can open the images. The static render
   does not replace the Owner's check on a real phone.

### 21.3 Review of the already-built work against this gate (2026-09-30)

**Status: F1-F12 and F14 fixed in Step 5b (`docs/UXUI_REDESIGN_STEP5B_UX_FIXES.md`); F13 stays with Step 8.** The table is the
record of what was found.

Rendered: the real workforce shell with the Employees and Skills screens (scripted API) at 360, 768 and 1440 px in light and dark (full matrix),
plus the auth pages. Everything below is a finding; nothing was changed.

| #   | Where                    | Finding (rule)                                                                                                                                         | Likely cause / fix                                                                               |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| F1  | Search input (all lists) | The magnifier icon overlaps the placeholder and typed text at every width (7)                                                                          | Legacy `.wf-app input` padding beats the component's icon padding; scope or drop the legacy rule |
| F2  | Page-size select         | Stretches the full width under every table (5, 7)                                                                                                      | Legacy `.wf-app select { width: 100% }` overrides `ls-*` controls; same root cause as F1         |
| F3  | Status badges            | "Đang hoạt động" wraps onto two lines at 768 px, making tall pills and cramped columns (7)                                                             | Badge needs `white-space: nowrap` and the status column a minimum width                          |
| F4  | Phone card list          | Label/value rows are inconsistent: short values right-aligned, long ones dropped below the label; empty values show blank instead of an em dash (4, 7) | Fixed two-column row layout, em dash for empty                                                   |
| F5  | Phone card list          | Card title links are 20 px tall and "Sửa" is a bare text link (6)                                                                                      | 44 px hit areas for title and actions                                                            |
| F6  | Phone list toolbar       | "Bộ lọc" sits alone under the search field, the count and "Sắp xếp theo" crowd below it (4, 7)                                                         | Search and Filters on one row; sort aligned with the same edges                                  |
| F7  | Topbar order             | Theme toggle and language link come before the bell; contract 4.1 says notifications, theme, language, user menu (7)                                   | Reorder in `WorkforceShell`/`AppShell` slots                                                     |
| F8  | Topbar controls          | Mixed heights: theme options 36 px (under the 40 px minimum), "English" link 43 px wide at 768, bell in a bordered legacy box (4, 6)                   | One control height; toggle options 40/44 px; quiet button style for the language link            |
| F9  | Notification badge       | The unread count is a tan/orange circle that reads as amber (8, D1) and the bell box does not match the ghost icon buttons                             | Brand-colored badge on an `IconButton`-style bell                                                |
| F10 | Topbar brand             | The wordmark link is 30 px tall (6) and its left edge (45 px) matches neither the sidebar items (24 px) nor the gutter (4)                             | Padding to reach the control height; align to the sidebar content edge                           |
| F11 | Page titles              | `h1` renders regular weight beside bold section titles and uses a `clamp()` size instead of tokens (2)                                                 | `h1` from the type scale, weight 600, in `.wf-main` (and later page templates)                   |
| F12 | Sort header buttons      | "Mã" sort button is 40 px wide at 768 px (6)                                                                                                           | Minimum width on sort buttons                                                                    |
| F13 | Skills create card       | A card titled "Thêm kỹ năng" whose only content is a link with the same text (7)                                                                       | Legacy pattern; resolved by the Step 8 migration to the page templates, not a Step 5 fix         |
| F14 | Auth pages               | Theme toggle options are 36 px on desktop (6)                                                                                                          | Same as F8 (shared `ThemeToggle`)                                                                |

Not reviewed by this render (open states are not captured yet): the user menu panel, the phone drawer, the tablet overlay, the
filter sheet. Proposed handling: one "Step 5b: UX gate fixes" Step before Step 6 (F1-F12, F14 in `packages/ui`, `workforce.css`
scoping and `shell.tsx`; F13 stays with Step 8), including captures of those open states. **Owner decision needed** on running
Step 5b before Step 6.

### 21.4 Frontend rules FR1-FR15 (Step 7.5a, Owner-approved 2026-10-01; MANDATORY for every Step after 7.5)

They extend 21.1 (rules 1, 5 and 6 there are restated more precisely here). "Checked by" says where a violation shows up.

| #    | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Checked by                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| FR1  | **Grid.** Every spacing value is a `--ls-space-*` token (multiples of 4). Gaps between blocks: 8/16/24/32/48 only; 4/12/20 only inside a control, badge, dense row or icon-text pair. No px/rem/em literal for margin, padding, gap or layout width.                                                                                                                                                                                                                                                                                                   | CSS ratchet; DOM `off-grid-spacing`                                           |
| FR2  | **Rhythm.** Page: header, 24, content; sibling blocks 24; blocks inside a card 16; fields 16; label to control 8; inline 8; icon to text 4. Gaps come from `Stack`/`Cluster`/`Grid` (Step 7.5b), never from a margin on the child. Cards in one row share top, height and the offset of their title and value.                                                                                                                                                                                                                                         | DOM `sibling-gap-uneven`, `row-*`, `inner-offset-mismatch`                    |
| FR3  | **Surfaces.** `Card` is the only container surface. Nothing bordered inside a card (table, empty state, notice and tabs render flush there). Lists have **no outer card**: the table is its own single-border surface, toolbar and pagination sit on the page. Two surfaces never touch or overlap borders.                                                                                                                                                                                                                                            | DOM `nested-border-box`, `border-collision`                                   |
| FR4  | **Page anatomy.** `Page` then `PageHeader` (optional breadcrumbs, one `h1`, one-line description, actions right, aligned to the block bottom) then content. Exactly one primary action per page, last in the header.                                                                                                                                                                                                                                                                                                                                   | review; `PageHeader` tests                                                    |
| FR5  | **Buttons.** primary (one per region) > secondary > ghost > danger-outline; solid danger only in `ConfirmDialog`; one height per row (40 desktop, 44 touch); all actions are kit buttons (no text-link actions, no raw `<button>`). Where an action lives: page -> `PageHeader`; list (search, filter, reload) -> toolbar; row -> `⋮`; card -> `CardHeader`; form/dialog -> footer, primary last.                                                                                                                                                      | DOM `orphan-action` (heuristic), `small-target`; ratchet `solidDangerButtons` |
| FR6  | **Alignment.** Controls in a row share height and baseline; toolbar controls carry no label above (placeholder + `aria-label`); in forms every label is above; blocks in a column share one left edge; right-aligned actions share one right edge.                                                                                                                                                                                                                                                                                                     | DOM `control-*`, `toolbar-label-above`, `edge-left`                           |
| FR7  | **Widths.** Fields use `--ls-field-sm/md/lg` (160/280/480) or full width; a select or search never stretches to 100% in a toolbar; long values (a 66-character branch name) clamp to one line with `title` and a max width (select 280); text measure at most 75 characters.                                                                                                                                                                                                                                                                           | DOM `text-clipped`, `edge-overflow-right`; review                             |
| FR8  | **Lists.** Anything that can exceed 20 rows uses `DataTable` + `Pagination` (20 per page, search from about 15 rows); no raw `<table>`; one line per row and one row height by default; numeric columns `nowrap`, right-aligned, tabular; headers, badges and button labels never wrap; a multi-value cell shows the first value + "+N"; empty cell is "—"; row actions in `⋮`.                                                                                                                                                                        | DOM `unpaged-list`, `row-height-uneven`, `wrapped-label`; ratchet `rawTables` |
| FR9  | **Forms.** Short form (up to about 5 fields, no sub-list) -> `FormDialog`; medium form (about 6-12 fields or one small sub-list) -> `FormDrawer`; long form (more than 12 fields, several sections, tabs or sub-lists, for example the employee detail) -> its own page (`Page variant="form"`). Opened from the header/toolbar primary button or a row `⋮`. No `<details>` create form, no inline expanding card, no native `fieldset` chrome; hints and errors below the control; checkbox, radio and switch through `CheckField` (row-wide target). | ratchet `detailsDisclosures`, `nativeFieldsets`, `nativeCheckboxes`           |
| FR10 | **No duplicates.** A heading never equals the label of a control in its own container; one title per surface.                                                                                                                                                                                                                                                                                                                                                                                                                                          | DOM `heading-equals-control`                                                  |
| FR11 | **Overflow.** No horizontal page scroll at 360, 768 and 1440; containers `min-width: 0`; only a table scrolls, inside its own wrapper.                                                                                                                                                                                                                                                                                                                                                                                                                 | DOM `page-horizontal-scroll`, `content-overflow`                              |
| FR12 | **Tabs.** `Tabs`/`PageTabs` directly under the header, 16 px to the panel, counts in the label; never outline buttons used as tabs; a tab list never touches a bordered sibling.                                                                                                                                                                                                                                                                                                                                                                       | DOM `border-collision`; review                                                |
| FR13 | **States.** Loading = skeleton with the final footprint; empty = `EmptyState` (flush, one action); error = `ErrorState` + retry; a chart without data shows the empty state, not an axis.                                                                                                                                                                                                                                                                                                                                                              | review                                                                        |
| FR14 | **Reorderable surfaces** (dashboard, later the slider) show a grip handle, a grab cursor and a one-line hint, plus the keyboard alternative.                                                                                                                                                                                                                                                                                                                                                                                                           | review                                                                        |
| FR15 | **Theme and i18n.** Tokens only (no hex, no amber/gold), both themes; every string through the dictionaries, including `sr-only` text passed into kit components; longest Vietnamese label tested; no new `wf-*` class.                                                                                                                                                                                                                                                                                                                                | tests; ratchet `wfClassUses`                                                  |

Kit dependencies: Radix primitives are allowed as headless behavior inside `packages/ui` only (plan section 1.1); no Tailwind.

### 21.5 Quality gate v2 (Step 7.5a; replaces "render and look" alone)

**Tooling (committed).** `scripts/uxui-screens.mjs` (render at 360/768/1440 light + 1440 dark, 21.2; its throw-away browser profile comes from `scripts/uxui-browser-profile.mjs`, which deletes it in `finally` and on exit and sweeps stale `uxui-*`/`uxaudit-*` folders from TEMP, also used by the local capture scripts), `scripts/uxui-page-audit.js` (the
DOM audit evaluated in a rendered page; every finding carries its rule `FR*`), `scripts/uxui-audit-summary.mjs` (table, `--write`,
`--compare`, `--page`), `apps/web/src/test/ui-ratchet.test.ts` + `ui-ratchet-baseline.json` (static counters), `docs/uxui-audit-baseline.json`
(Step 7.5a DOM baseline, 26 pages). **Machine-local, not committed** (credentials and seed data): `.local/uxui-audit/` holds the real-app
capture (`capture.mjs`), API client, seeds and `creds.json`.

**Environment.** Scratch database `lucy_spa_uxaudit_20261001` (never the dev DB): `node .local/uxui-audit/create-db.mjs` (keeps it if
present), `node .local/uxui-audit/migrate.mjs` (additive migrations + permission sync, safe to repeat), then the built API on 3101 and
the built web on 3100 (`node .local/uxui-audit/start-api.mjs`, `start-web.mjs`; rebuild `apps/api` and `apps/web` first when the Step
changed code). Seed scripts recreate the data if the database is rebuilt. Stop both servers afterwards.

**Per UI Step.** (1) Render the changed screens as in 21.2 and review them. (2) Run the audit on the changed pages against the real
app: `node .local/uxui-audit/capture.mjs <page...>` (set `AUDIT_ONLY=1` to skip screenshots) and compare with the baseline:
`node scripts/uxui-audit-summary.mjs --compare docs/uxui-audit-baseline.json`. A Step must not raise any count on any page; on the
pages it migrates the types of the rules it targets must be 0 or explained line by line in the report. (3) Lower the ratchet counters the
Step retired (`UPDATE_RATCHET=1 pnpm --filter @lucy-spa/web exec node --import tsx --test src/test/ui-ratchet.test.ts`); the test is
part of the web package tests and fails when a counter rises or when an improvement is not recorded. (4) Reference comparison below.
(5) Report: the 5-line UX gate note, plus the compare table totals.

**DOM checks (all in `scripts/uxui-page-audit.js`).** `unpaged-list` (more than 20 rows/items without a pagination control nearby),
`nested-border-box` and `border-collision` (target 0), `off-grid-spacing` (target 0 on migrated pages), `sibling-gap-uneven`,
`heading-equals-control`, `orphan-action` (heuristic: a button alone in its row outside header, toolbar, card header, footer, dialog;
review each hit), `control-height-mismatch` / `control-misaligned`, `toolbar-label-above`, `inner-offset-mismatch` (cards in one row),
`wrapped-label` (badge, button, tab or column header on two lines), `page-horizontal-scroll`, `small-target` (40 px desktop, 44 px
below 1024), `row-height-uneven`, `text-clipped`. Known limits: the audit sees only the rendered state (open dialogs need `--click`
renders), `orphan-action` and `sibling-gap-uneven` can flag deliberate layouts (explain them in the report, do not silence the check).

**Static ratchet.** Pinned counters: `rawTables`, `wfClassUses`, `detailsDisclosures`, `nativeFieldsets`, `nativeCheckboxes`,
`solidDangerButtons` (outside confirmation dialogs), and px/rem/em spacing literals in `workforce.css`, `components.css`, `shell.css`.
They only go down; the closing sub-step of Steps 8, 9 and 10 sets its group to 0 and Step 14 requires all of them at 0.

**Reference comparison (human, side by side).** For every list, form or dashboard page a Step migrates, the report links our `-top`
crop next to the matching `docs/references/shadcn-admin-*.png` and answers: (1) gutter 16 and header-to-content 24; (2) title 24/600 with
a one-line muted description; (3) actions right and bottom aligned; (4) toolbar is one row of equal-height controls; (5) the table is one
single-border surface with uniform rows (reference about 49 px, ours 48/56); (6) pagination is one footer row; (7) create/edit opens in a
dialog or drawer; (8) no element touches another surface. Pixel matching is not a goal: brand colors, font and 40 px controls differ on purpose.

**Baselines.** `docs/UXUI_AUDIT_BASELINE_7_5A.md` (readable) and `docs/uxui-audit-baseline.json` (for `--compare`) record the DOM audit of the 26
workforce/auth pages at 1440/768/360 in light on the post-Step-7 code (`99d77d5`), before any Step 7.5 UI change. Step 7.5f re-runs the
full matrix (light and dark) and publishes the before/after table.
