# Phase 2 Step 9: workforce login, dashboard and Phase 2 UI

Status: **CLOSED** (Owner-authorized to close on passing checks; commit
`feat: add phase 2 workforce ui`). Baseline is `51d96ee`. Nothing was deployed and
production was not touched. There is no database migration.

Context:

- Steps 3–8 built the Phase 2 backend (branches and hours, services, skills,
  branch assignments, attendance, leave).
- Phase 1 built authentication, sessions and CSRF.
- This step exposes that backend through the first workforce web application. It does
  not re-implement business rules in the browser.

## 1. Scope

- **Workforce area:** `/{vi|en}/workforce` in the existing Next.js app.
- **Login and logout:** through the existing session API.
- **Authenticated shell:** a permission-aware navigation.
- **Dashboard.**
- **Management pages:** branches and business hours, services (categories, master data,
  price, branch availability, eligible skills), skills, employees (directory, skills,
  branch assignments).
- **Operations pages:** attendance (self check-in/out, history, branch view, corrections)
  and leave (requests, own history, cancellation, approvals).
- **One authorized backend addition:** the read-only employee directory
  `GET /api/v1/employees` (section 9.1).

This is not the public or premium marketing website, and no Step 10 work was started.

## 2. Login and session integration

- **Endpoints used:** the existing Phase 1 endpoints only.
  - `GET /api/v1/auth/context` returns the CSRF token and, for a new visitor, creates an
    anonymous session.
  - `POST /api/v1/auth/login` with `realm: 'WORKFORCE'`, by employee ID or email. It
    rotates the session cookie, after which the client refetches the context.
  - `GET /api/v1/auth/me` returns the account and permission hints.
  - `POST /api/v1/auth/logout` ends the session.
- **Cookie and requests:**
  - The HttpOnly session cookie travels through the existing same-origin `/api` rewrite.
  - Nothing is written to `localStorage`, `sessionStorage`, IndexedDB or
    `document.cookie`; a test asserts this.
  - No token appears in client code, and no other auth mechanism was added.
- **Customer accounts:**
  - The realms are separate on the server, so a customer credential fails workforce
    login.
  - If a customer session reaches the workforce area anyway, the guard refuses it and
    offers sign-out.
- **Route guard:**
  - Unauthenticated visits to workforce pages are redirected to login, keeping a safe
    `next=` return path. `safeNext` accepts only paths inside the workforce area.
  - Any `401 AUTHENTICATION_REQUIRED` (expiry, revocation, sign-out elsewhere) sends the
    user to login with a "session expired" notice.
  - The guard is UX only; every API call is authorized by the server.

## 3. Auth context and permission UX

- **Source:** `GET /auth/me` authorization hints (grants and denies, or `owner: true`).
  They drive navigation and actions through `canGlobal`, `canAt`, `canAnywhere` and
  `canAcross` (`src/lib/workforce/permissions.ts`), which mirror the server rules:
  - GLOBAL covers every branch;
  - a branch grant is never global;
  - any DENY on the scope wins;
  - multi-branch targets need every branch;
  - branchless targets need GLOBAL.
- **No role logic:** nothing is hard-coded by role (no "manager sees X").
- **Hints only:** these checks decide what the UI offers. The server remains
  authoritative, and its 403/404 responses are shown as understandable messages.

## 4. Application shell and navigation

- **Layout:** top bar (brand, user and role, language switch, sign-out) and a sidebar
  grouped into Home, Operations and Management.
- **Items shown:**
  - Dashboard: always.
  - Attendance and Leave: for employees (self-service), or with `VIEW_ATTENDANCE` /
    `APPROVE_LEAVE`.
  - Branches: with `MANAGE_BRANCHES`.
  - Services: with `MANAGE_SERVICES` or `MANAGE_SERVICE_PRICES`.
  - Skills: with `MANAGE_SKILLS`.
  - Employees: with `VIEW_EMPLOYEES`.
- **Mobile and tablet:** the sidebar collapses behind a "Menu" button (`aria-expanded`),
  and the current page is marked with `aria-current`.
- **Route structure:**
  - the public Phase 0 page moved into the `(public)` route group, unchanged, so its
    header and footer don't wrap the workforce app;
  - `[locale]/layout.tsx` is now only the document root;
  - authenticated pages live in the `workforce/(app)` group behind the guard.

## 5. Dashboard

It shows only data that existing APIs provide:

- **Greeting** by display name.
- **Today's attendance per assigned branch**, derived from the employee's own records
  with the branch-timezone business date.
- **Own pending leave requests** (count).
- **Own branches.**
- **For approvers:** the number of PENDING requests in their scope.
- **Links** to the management pages the user can use.

There are no revenue, booking or customer metrics. The Owner (no employee profile) sees a
note instead of self-service cards.

## 6. Branch and business-hours UI

- **List:** only the branches the API returns for the caller.
- **Create:** only with GLOBAL `MANAGE_BRANCHES` (code, name, IANA timezone defaulting to
  `Asia/Ho_Chi_Minh` in the form, optional reason).
- **Detail:**
  - rename and timezone, and weekly hours: the whole week is edited, closed days send
    null times; `MANAGE_BRANCHES` at that branch;
  - activate/deactivate: GLOBAL `MANAGE_BRANCHES`, reason required;
  - otherwise read-only.
- **Versions:** every command sends `expectedVersion`.
- **Server rules:** the "no timezone change after attendance" rule stays on the server
  and is explained as a hint.

## 7. Service UI

Three clearly separate parts on the service detail:

- **Service master** (GLOBAL `MANAGE_SERVICES`): category, VI/EN names and descriptions,
  and the internal duration, which is labelled as never shown to customers. (The form
  later gained the customer-facing estimated duration range; see the Step 4 report's
  post-deployment enhancement.)
- **Price** (GLOBAL `MANAGE_SERVICE_PRICES`): a digits-only VND string with a required
  reason. VND is formatted from the integer string (thousand separators) and never passes
  through a floating-point number; a test covers an 18-digit amount.
- **Branch availability:** per visible branch; the toggle is shown with `MANAGE_SERVICES`
  at that branch. It sends the availability row's `expectedVersion`, or `null` for a new
  row.

Also:

- **Categories:** list, create, edit and activate/deactivate (reason required), all under
  GLOBAL `MANAGE_SERVICES`.
- **Service creation:** needs both `MANAGE_SERVICES` and `MANAGE_SERVICE_PRICES` (GLOBAL).
- **Status:** activate/deactivate with a reason.

## 8. Skills UI

- **Skill catalog** (GLOBAL `MANAGE_SKILLS`): list, create, rename, activate/deactivate
  (reason required for status).
- **Service eligible skills** (GLOBAL `MANAGE_SERVICES`): a checkbox set replacing the
  whole set, versioned by the service. The "any one skill qualifies" rule is only
  explained; nothing evaluates qualification in the browser.
- **Employee skills:** section 9.

## 9. Employee operational UI

- **Directory:** search by employee code or name, filter by branch and status, keyset
  "load more".
- **Employee page:** name, code, status, then:
  - **Skills:** grant or revoke. Offered with `MANAGE_SKILLS` over every branch of the
    employee, and never on oneself unless Owner.
  - **Branch assignments:** active list, assign (active branches not yet assigned, reason
    required), revoke (reason required), and history. A notice explains that a change also
    changes the employee's permission scope and signs them out. `expectedVersion` is the
    employee version from the assignments response.
- **Deliberately not shown:** contact, pay and birth-date data, even though the
  single-employee read returns some of them.
- **No HR features:** no payroll, contracts, scheduling, reviews or documents.

### 9.1 `GET /api/v1/employees`: the authorized backend addition

- **Why it was needed:** the UI must let a manager find and select an employee (for skills
  and branch assignments) and show names in attendance and leave views. Only
  `GET /employees/:id` existed; Phase 1 Step 10 had deferred the list "until a UI needs
  it". The Owner authorized this endpoint as a Step 9 prerequisite.
- **Authorization:** the existing `VIEW_EMPLOYEES` semantics, identical to the
  single-employee read (`decideAcross`):
  - an employee with active branches is visible only when `VIEW_EMPLOYEES` passes at
    **every** one;
  - an employee without an active branch needs GLOBAL `VIEW_EMPLOYEES`;
  - denies and overrides apply through the same engine;
  - no permission is 403, customers 403, anonymous 401.
- **Filtering before paging:** visibility is a query predicate applied before search,
  filters, ordering and paging, so hidden employees never appear in pages, cursors or
  search results.
- **Fields:** `id`, `employeeId` (code), `fullName`, `status`, `branchIds` (active),
  `version`. No phone, email, address, birth date or pay.
- **Query:**
  - `q` matches the code or full name (case-insensitive, 1–100 characters);
  - `branchId` (active assignment) and `status` filters;
  - keyset cursor over the unique employee code; `limit` 1–100 (default 50), the same
    bounds as audit reads;
  - strict query DTO: unknown parameters such as `phone`/`email` are 400.
- **Tests:**
  - integration (real PostgreSQL, rolled back): callers; branch, multi-branch and GLOBAL
    visibility; no widening by `APPROVE_LEAVE`/`VIEW_ATTENDANCE`/`MANAGE_SKILLS`; exact
    field set; search by code and name; branch and status filters; bounds; pagination
    without gaps; hidden employees absent from every page and from exact-code searches.
  - HTTP contract: strict query, forwarding, error mapping.
- **No migration.**

### 9.2 Display names in attendance and leave

- **Source:** names come only from the directory. A viewer without `VIEW_EMPLOYEES`
  (or without containment for that employee) sees a neutral "Employee 1a2b3c4d" label;
  visibility was **not** widened.
- **Loading:** names load up to 500 directory entries (5 pages of 100).

## 10. Attendance UI

- **Self-service (employees):** one card per assigned branch shows the state derived from
  backend records by the branch-timezone business date:
  - not checked in;
  - checked in at HH:MM;
  - checked out (in – out);
  - an older day never closed ("ask a manager").

  The large Check in / Check out buttons call the existing commands; the server decides
  validity. Times display in the branch timezone. Own history is listed below.

- **Branch view (`VIEW_ATTENDANCE`):** branch and date-range filters over the scoped API
  list.
- **Correction (`MANAGE_ATTENDANCE` at the record's branch, never one's own record unless
  Owner):** check-in/out entered as branch wall-clock time and converted through the
  branch timezone (DST-safe), reason required, `expectedVersion` sent. Only changed
  fields are submitted.
- **Not built:** breaks, shifts, lateness, payroll, geolocation or biometrics.

## 11. Leave UI

- **Employee:**
  - create a request: localized type, start/end date pickers, a whole-day count preview,
    and a required reason;
  - own history with localized type and status badges;
  - cancel only own PENDING requests. APPROVED shows "cannot be cancelled by you".
- **Approvers (`APPROVE_LEAVE`):**
  - the server-scoped list filtered by status (default PENDING);
  - approve (optional note) or reject (reason required, enforced in the UI and by the
    API);
  - `expectedVersion` sent; one's own requests are never decidable.
- **Labels:**
  - statuses (PENDING, APPROVED, REJECTED, CANCELLED) show as text badges;
  - types (`ANNUAL`, `SICK`, `PERSONAL`, `FAMILY_EVENT`, `MATERNITY`, `OTHER`) show only
    as VI/EN labels.
- **1 day per month:** stated as explanatory baseline text only, with an explicit "no
  remaining balance is calculated". No quota, paid/unpaid, carry-forward, payroll or
  booking logic.

## 12. VI/EN localization

- **Same locale architecture:** the existing `[locale]` segment and `isLocale`, plus a
  workforce dictionary (`src/i18n/workforce.ts`) typed so VI and EN have identical keys
  (tested).
- **Stable codes:** backend codes are never translated in the API; they are mapped to UI
  labels.
- **Switching:** the shell and login page switch language by swapping the locale path
  segment.

## 13. Responsive and accessibility behavior

- **Layout:**
  - sidebar on desktop, collapsible menu at 900px or less;
  - tables turn into labelled cards at 760px or less (`data-label`), with no sideways
    scrolling;
  - 44px minimum touch targets, and a full-width check-in button.
- **Semantics:**
  - labelled controls; required fields marked;
  - `role="alert"`/`status` for feedback; `aria-current`, `aria-expanded` and
    `aria-busy`;
  - a skip link and focus-visible outlines.
- **Statuses:** always text badges, never color alone.
- **Forms:**
  - duplicate submissions are blocked while pending;
  - entered data stays after recoverable errors;
  - obvious invalid input is prevented (date order, VND digits, required reasons).
- **Headings:** workforce headings use the body font, because the public display serif
  lacks precomposed Vietnamese glyphs; this was found in manual validation.

## 14. API client, CSRF and error handling

- **Single client:** `WorkforceApi` (`src/lib/workforce/api.ts`) is the only fetch
  wrapper.
  - same-origin credentials, JSON, `cache: 'no-store'`;
  - the CSRF token comes from the context, and each POST carries `X-CSRF-Token`;
  - after a `REQUEST_NOT_ALLOWED` (rotated session) the client refreshes the token and
    retries **once**; the guard rejected the request before it ran;
  - `204` handling; network failures become `NETWORK`.
- **Error envelope:** keeps only `code`, a safe `field` and `requestId`. Messages are
  localized per code:
  - validation 400, 401, 403, 404, 409, 429, 503, network and unexpected;
  - no stack traces or raw server text.
- **409 conflicts:** never overwrite. `runMutation` reloads the affected resource and the
  user sees "this data was changed — the latest version has been reloaded".

## 15. Tests and checks

| Check                                                                                   | Result                  |
| --------------------------------------------------------------------------------------- | ----------------------- |
| Web focused tests (`node --import tsx --test`, the existing tooling; no new dependency) | **PASS 25**             |
| Employee directory integration (real PostgreSQL, rolled back)                           | **PASS 5** (4 subtests) |
| Employee directory HTTP contract                                                        | PASS 1                  |
| Every HTTP suite that boots `AppModule` (new route and provider)                        | PASS 33                 |
| Phase 1 employee integration (the employee controller changed)                          | PASS 10                 |
| Web `tsc --noEmit`; `next build` (all workforce routes compiled and prerendered)        | PASS                    |
| Contracts and API builds; ESLint, Prettier and the boundary check on changed files      | PASS                    |

**Web tests cover:**

- **Auth:**
  - login flow (anonymous CSRF, WORKFORCE body, fresh CSRF after rotation);
  - anonymous, customer and workforce session separation;
  - 401 expiry signal; logout and CSRF reset; retry-once;
  - no web storage; safe post-login redirects.
- **Permissions:**
  - navigation from effective grants; deny precedence; branch versus GLOBAL;
  - multi-branch and branchless rules;
  - management create actions hidden without GLOBAL permission (branches, skills,
    categories, services needing the price permission).
- **Attendance:**
  - self-service rendering; branch view only with `VIEW_ATTENDANCE`;
  - correction only with `MANAGE_ATTENDANCE` at the branch and not on own records;
  - state derived by branch-timezone date.
- **Leave:**
  - request form; localized type labels (no raw codes); status labels;
  - cancel own PENDING only; APPROVED not self-cancellable;
  - decisions only with `APPROVE_LEAVE` and never on own requests;
  - baseline text without a balance.
- **Management and conflicts:** 409 reloads without overwriting; business-hours weekday
  completion; VND formatting without floats; timezone conversion; VI/EN key parity.

Focused suites only; the full repository suite was not rerun.

## 16. Manual validation

- **Environment:** local only. The API was built from this tree and connected to the local
  Docker PostgreSQL and Redis; the web ran on the Next dev server.
- **HTTP checks:**
  - the login page renders in VI and EN;
  - every workforce route compiles and returns 200; an unknown locale is 404;
  - the public `/vi` page is unchanged;
  - the `/api` proxy issues an **HttpOnly** session cookie;
  - anonymous `/auth/me` and `/employees` return 401;
  - login without CSRF and a leave POST from a foreign Origin return 403.
- **Browser (headless Edge):**
  - login renders at desktop width;
  - an anonymous visit to `/vi/workforce/attendance` is redirected to login by the guard.
- **Responsive check:** the login page's server-rendered HTML, and static renders of the
  real shell/navigation and leave/attendance components with the real CSS inlined, were
  viewed in fixed 375px and 1024px frames. Headless Edge can't narrow its window below
  about 500px, hence the frames. This found and fixed:
  - a login-card overflow at 375px;
  - the Vietnamese heading glyph issue.

  Tables become cards, the nav collapses and opens, and there is no horizontal overflow.

- **Temporary workforce account: not created.**
  - The Owner authorized one only if it could be removed afterwards.
  - The schema makes that impossible: `users_identity_guard` rejects deleting any user
    ("User identities are permanent"), and branch-assignment history can't be deleted
    either.
  - The local database had no workforce users, so authenticated screens were not driven
    in a browser. Their behavior is covered by the component and workflow tests (section
    15), and the backend commands by the Step 3–8 integration tests.
  - To click through authenticated flows later, the Owner would need to authorize a
    **permanent** local dev account, or run the Owner bootstrap locally.
- **Cleanup of validation data:** page loads created 15 anonymous sessions and 1
  `ANONYMOUS_CONTEXT_IP` throttle row. Both tables permit deletion, and exactly those rows
  were deleted in one checked transaction. The local database was back to 0 sessions, 0
  throttle rows and 0 users.
- **Generated files:**
  - `next dev` generated `apps/web/AGENTS.md` and `CLAUDE.md`; they were deleted and not
    committed.
  - `next build` rewrote `apps/web/next-env.d.ts`; the pre-existing content was restored
    byte-for-byte from a backup (hash `a419cbe…`), and the file was never staged.

## 17. Database and migration status

**No migration and no schema change.** The directory endpoint reads existing tables.
Production was not touched and nothing was deployed.

## 18. Deferrals and limitations

- **Names without `VIEW_EMPLOYEES`:** an approver or attendance viewer who lacks
  `VIEW_EMPLOYEES` over an employee sees a neutral ID label, not a name. Visibility was
  deliberately not widened; granting `VIEW_EMPLOYEES` resolves it. The same applies to
  managers who have `MANAGE_SKILLS`/`MANAGE_EMPLOYEE_SCOPE` but not `VIEW_EMPLOYEES`: they
  can't find employees in the directory.
- **Correction needs the list:** `MANAGE_ATTENDANCE` without `VIEW_ATTENDANCE` has no list
  from which to open a correction.
- **Name lookup cap:** at most 500 directory entries are loaded for name display.
- **Search:** accent-sensitive; Vietnamese names match on exact diacritics, with no
  unaccent search.
- **Not in the UI:** employee creation, profile, status, pay, roles, overrides, audit log,
  password reset and recovery email. They exist in the API but are outside the approved
  Step 9 scope.
- **Leave:** no editing of PENDING requests (cancel and re-request), and no manager
  handling of APPROVED leave (as in Step 8).
- **Authenticated browser pass:** not done locally (section 16).
- **Visual design:** the tokens are provisional; there is no motion system, by design.

## 19. Git context

- **Baseline:** `51d96ee`.
- **Commit:** only Step 9 files (web app, directory endpoint and tests, contracts,
  integration-script registration, this report and the handoff).
- **Excluded:** `apps/web/next-env.d.ts` remains the pre-existing unstaged
  modification; generated files are not included.

## 20. Next step

**Phase 2 Step 10: Completion Gate and Production Deployment.** It needs separate Owner
authorization.
