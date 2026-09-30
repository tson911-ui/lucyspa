# UX/UI Redesign: design contract

**Status: Step 1 of 14 (Design Contract), CLOSED / OWNER APPROVED.** The Owner accepted every recommended default in section 17
(Q-D1 to Q-D6 and Q-CM1 to Q-CM13) as written; they are LOCKED Owner decisions. Documentation only. No code, schema, API, migration or
runtime change was made. Step 2 (Foundations) is **CLOSED / OWNER APPROVED** (`UXUI_REDESIGN_STEP2_FOUNDATIONS.md`). Step 3 (Core components) is **CLOSED / OWNER APPROVED** (`UXUI_REDESIGN_STEP3_CORE_COMPONENTS.md`; `jsdom` dev dependency approved for interactive tests in later Steps). Step 4 (Data components) is **CLOSED / OWNER APPROVED** (`UXUI_REDESIGN_STEP4_DATA_COMPONENTS.md`; phone "Sort by" select added on the Owner's answer). Nothing was deployed.

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
| 8    | Migrate People and organization              | 3, 10, 11, 12               |
| 9    | Migrate Catalog and Finance                  | 3, 10, 11, 12               |
| 10   | Migrate Operations and personal pages        | 3, 10, 11, 12               |
| 11   | Content A: storage + media library           | 16.1-16.4, 16.7-16.9, 17    |
| 12   | Content B: promotional popup                 | 16.5, 16.7-16.9, 17         |
| 13   | Content C: homepage slider                   | 16.6-16.9, 17               |
| 14   | Part 1 final validation                      | 18, 19                      |

Every Step also reads section 0 (rules) and section 17 (Owner decisions) for the answers it depends on.

---

## 0. Owner decisions recorded (LOCKED for this track)

| #   | Decision                                                                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Brand colors: primary red `#782b37` and white `#ffffff`. **No gold anywhere** (also no yellow/amber that reads as gold).                                                                                                                                  |
| D2  | Light and dark mode with a user toggle; default follows the system.                                                                                                                                                                                       |
| D3  | Admin (workforce) area first. Customer area and public site are a later part of this track (own contract).                                                                                                                                                |
| D4  | Admin is modern, luxurious, professional, very easy to use, fast; no cinematic motion (PRD 4.4 applies to the customer side only).                                                                                                                        |
| D5  | Desktop, tablet and phone; VI/EN; Vietnamese diacritics must render well.                                                                                                                                                                                 |
| D6  | Clear, consistent layout on every page. Every list has pagination (plus search/filters where useful).                                                                                                                                                     |
| D7  | Edit and Delete buttons are clear and consistently placed; destructive actions use a confirmation dialog. Where records must never be deleted (financial/operational history) show the allowed action (Cancel, Deactivate, Correct), never a fake Delete. |
| D8  | Dashboard of widgets, rearrangeable per user by drag and drop. Drag and drop also orders images and slides.                                                                                                                                               |
| D9  | Design the dashboard and a shared chart kit now so Phase 8 analytics plug in without redesign. Only widgets backed by existing data are built in this track; permission rules (for example `VIEW_REVENUE`) apply to widgets.                              |
| D10 | Website content management (media library, promotional popup, homepage slider) is planned as separate Steps (11-13) since it needs storage, schema and API. Respect PRD 24.1. No page builder.                                                            |
| D11 | Apart from the content-management group, **no business logic or API changes** in this track.                                                                                                                                                              |

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
toggle** (Light / Dark / System), **language switch** (VI/EN, existing behavior), **user menu** (name, title, My account, Sign out).
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
(`light`, `dark`, or absent = system via `prefers-color-scheme`). The toggle writes the cookie (1 year, `SameSite=Lax`, not
`HttpOnly`, no personal data) and updates the attribute. `color-scheme` follows the theme so native controls and scrollbars match.
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
- **Motion** (admin): `--ls-dur-fast 120ms`, `--ls-dur-base 180ms`, easing `cubic-bezier(.2,0,0,1)`; only opacity/transform/background
  transitions on hover, focus, dialog open, drawer slide, drag ghost. No parallax, page transitions, scroll effects or
  looping animation. `prefers-reduced-motion: reduce` sets all durations to 0 (drag and drop still works).
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

| Component    | Purpose / API notes                                                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`     | `variant`: `primary` (wine fill), `secondary` (outlined neutral), `ghost`, `danger-outline`, `danger` (solid; **dialogs only**, enforced by lint/test), `loading`, `icon`, `size` md/lg |
| `IconButton` | icon-only, requires `label` (aria-label + tooltip), 44 px hit area                                                                                                                      |
| `ButtonLink` | anchor styled as a button (navigation actions)                                                                                                                                          |
| `ActionBar`  | consistent place for page/record actions (section 10.3)                                                                                                                                 |
| `RowActions` | table row action cell: **Edit** (icon+text on desktop, icon on phone) then a `...` menu holding secondary/destructive actions; order fixed (section 10.4)                               |
| `Menu`       | dropdown/popover menu with roving focus, typeahead, Escape closes                                                                                                                       |

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
(icon + text), and the single primary action last when there is one. On phone the bar becomes primary + `...` menu. Forms end with
`FormActions`: `[Save]` (primary) `[Cancel]` (ghost) left to right, sticky at the bottom on phone.

### 10.4 Row actions in tables

The last column, right aligned, header visually hidden but present for AT ("Actions"): `Edit` (or `View` when the user has read-only
authority) then the `...` menu. The order inside the menu is fixed: safe actions first, then a divider, then the destructive one, in
danger text with icon. A row also links through its name cell. Bulk actions are **not** introduced (no requirement; none exist).

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

Login/forgot-password: centered card (max 420 px) on `--ls-bg-page`, wordmark above, language and theme toggles top right, no shell.

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

| Step | Scope                                                                                                                                                                                                                                                            | Touches                                                          | Key tests / acceptance                                                                                                              |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1    | This contract; PRD 4.1 updated; handoff line.                                                                                                                                                                                                                    | docs, PRD                                                        | Owner review                                                                                                                        |
| 2    | Foundations (section 8): tokens v2, theme + pre-paint script, font, base CSS, icons, gold removed, `workforce.css` literals to tokens.                                                                                                                           | `packages/ui`, `apps/web` css/layout                             | token contrast test; both themes render; no gold/hex leftovers                                                                      |
| 3    | Core components 9.1-9.3, 9.5 (Button family, feedback, forms, Dialog, ConfirmDialog, Drawer, Menu), `ImageUploader` shell; `ui.tsx` re-exports mapped onto them.                                                                                                 | `packages/ui`, `apps/web` ui.tsx                                 | component tests (keyboard, ARIA, longest VI label); ConfirmDialog parity with existing delete tests                                 |
| 4    | Data components 9.4: `DataTable` (client/server/cursor), `Pagination`, `ListToolbar`, `DescriptionList`, `Tabs`, card-list phone mode, URL-state hook; **pilot on Employees and Skills**.                                                                        | `packages/ui`, employees + skills screens                        | paging math, URL state, phone layout, a11y                                                                                          |
| 5    | App shell and navigation (section 4): `AppShell`, sidebar/drawer/rail, topbar, theme toggle, user menu, breadcrumbs, regrouped `navigationFor` groups (rules unchanged), auth page template.                                                                     | `packages/ui`, `shell.tsx`, `permissions.ts` (groups only), i18n | `permissions.test.ts` still green (visibility unchanged); nav per role; 4 widths                                                    |
| 6    | `SortableList/Grid` + chart kit + `DateRangePicker` + `KpiCard` + comparison (section 14.4); dev-only demo route removed before review or behind a test file; unit tests with fixtures.                                                                          | `packages/ui`                                                    | palette validator re-run in a test; keyboard reorder; chart a11y table; formatting                                                  |
| 7    | Dashboard (section 14, 15): widget registry, grid, customize mode, persistence, widgets of 14.3, permission gating, per-widget states.                                                                                                                           | `apps/web` dashboard                                             | layout derivation per permission set; persistence; widget states; keyboard reorder                                                  |
| 8    | Migrate **People and organization**: employees (detail, lifecycle, roles, skills, create), teams, organization, skills, roles to templates 12.1-12.3 and 10.x action rules.                                                                                      | `apps/web` screens                                               | existing screen tests kept green + new ones for paging/actions                                                                      |
| 9    | Migrate **Catalog and Sales**: services (+detail), branches (+detail), discounts (+detail/form), POS list/invoice/payments.                                                                                                                                      | `apps/web` screens                                               | same; destructive-action matrix (10.5) asserted                                                                                     |
| 10   | Migrate **Operations and personal**: booking board, walk-in, reassignment, my-services, collaborator schedule, attendance, leave, my account, my income, notifications, login/forgot pages (board template 12.4).                                                | `apps/web` screens                                               | same; `wf-*` legacy CSS deleted at the end of this Step                                                                             |
| 11   | **Content A**: migration (`media_assets`, `media_variants`, permission enum), `MediaStorage` + local implementation, upload/serve/list/update/delete API, audit, media library UI, `ImageUploader` wired. New env `MEDIA_STORAGE_DIR`.                           | api, database, server, contracts, web                            | integration: upload validation (type/size/magic bytes), variants, dedupe, delete-if-referenced refusal, permission, audit; UI tests |
| 12   | **Content B**: `website_popups`, admin CRUD with overlap rule, status derivation, preview, public popup endpoint and public-site component (once per session).                                                                                                   | api, database, contracts, web                                    | integration: overlap, schedule window, public visibility; web: once-per-session, focus trap, Escape                                 |
| 13   | **Content C**: `website_slides`, admin list with drag-and-drop reorder, schedule, public slides endpoint and basic slider component.                                                                                                                             | api, database, contracts, web                                    | integration: reorder transaction, visibility window, max visible; web: keyboard reorder, pause, reduced motion                      |
| 14   | **Part 1 final validation**: `pnpm check`, full tests including integration on a scratch DB, build, smoke; axe/a11y pass on key pages in light+dark at 360/768/1440; deployment checklist (env var, `db:permissions:sync`, media dir permissions, backup scope). | all                                                              | full gate; report with deployment checklist                                                                                         |

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
