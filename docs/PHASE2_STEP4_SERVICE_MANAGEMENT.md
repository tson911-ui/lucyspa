# Phase 2 Step 4: service management

Status: **CLOSED** (Owner-approved; commit `feat: add phase 2 service management`).
Nothing was deployed to production. Baseline is `9e724aa`. The work is backend/API only.

This builds on the [Step 2 database foundation](PHASE2_STEP2_DATABASE_FOUNDATION.md)
(schema and the Step 1 contract) and [Step 3](PHASE2_STEP3_BRANCH_ADMIN_HOURS.md)
(branches, and the Owner decision about branch-scoped `MANAGE_SERVICES`). The PRD
basis is section 8.1 (service configuration), section 8.2 (durations are editable
scheduling estimates, not public labels), section 8.3 (price authority) and section 39
(price changes are audited).

**No schema or migration change was needed.** `service_categories`, `services` and
`service_branch_availability` already have `row_version` and the Step 2 constraints.

## Owner decisions (recorded at Step 4 close)

1. **Service creation needs price authority (approved).** A new service necessarily
   sets its initial configured price, so creation requires GLOBAL `MANAGE_SERVICES`
   **and** GLOBAL_ONLY `MANAGE_SERVICE_PRICES`. A caller holding only
   `MANAGE_SERVICES` can't create a service. The separate price-change command keeps
   its audit and concurrency behavior.
2. **Category deactivation doesn't cascade (approved).** Deactivating a service
   category never deactivates or changes its services. The PRD defines no cascade
   rule, so none was invented.
3. **Eligible-skill write authority for Step 5.** Not implemented here:

   | Relation                                     | Write authority                                    |
   | -------------------------------------------- | -------------------------------------------------- |
   | Service ↔ eligible skills (`service_skills`) | **GLOBAL `MANAGE_SERVICES`** (not `MANAGE_SKILLS`) |
   | Employee ↔ skills (`employee_skills`)        | `MANAGE_SKILLS` with the target's branch scope     |
   | Skill catalog (`skills`)                     | GLOBAL `MANAGE_SKILLS`                             |

   `service_skills` describes a service's capability requirements, which are service
   configuration. `MANAGE_SKILLS` governs the skill catalog and employee assignments.

## Scope implemented

| Area         | Behavior                                                                                                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Categories   | Create (the code is trimmed, uppercased and **immutable**), update the Vietnamese/English names and `sortOrder` (0–100000), activate and deactivate. Never deleted.                                   |
| Services     | Create; update master data (category, names, Vietnamese/English descriptions, where `null` clears them, and `durationMinutes` 1–1440); activate and deactivate. The code is immutable. Never deleted. |
| Price        | A separate command. Initial price at creation, and later changes.                                                                                                                                     |
| Availability | Explicit per-branch rows. **No active row means the service is not offered at that branch.** A new service is offered nowhere until configured.                                                       |

- **Separate offerings.** A 30-minute and a 60-minute foot massage are separate
  services (tested). At Step 4 there were no duration ranges; a customer-facing
  estimated range was added later (see "Post-deployment enhancement" at the end).
- **Duration is internal.** `durationMinutes` is exposed only through the authenticated
  workforce API. No public menu representation exists.
- **No invented category rule.** The PRD sets none, so deactivating a category does
  not cascade to its services, and a service may sit in an inactive category.
  Changes that set nothing new are rejected.

## Price authority (PRD 8.3)

- **Changing a price** needs **GLOBAL_ONLY `MANAGE_SERVICE_PRICES`**. Ordinary
  `MANAGE_SERVICES` is never enough, whether branch-scoped or GLOBAL. The Owner passes
  through existing Owner semantics.
- **Creating a service** sets a price, so it requires GLOBAL `MANAGE_SERVICES` **and**
  `MANAGE_SERVICE_PRICES`.
- **Format:** price is a nonnegative integer VND decimal string, stored as bigint
  (`'-1'`, `'1.5'` and numbers are rejected).
- **Every change** requires `expectedVersion` and a reason, rejects a no-op, and is
  audited as `SERVICE_PRICE_CHANGED` with before/after price strings.
- **History:** this changes only the configured price. Invoices (Phase 4) will snapshot
  prices, so historical transactions are never altered.

## Authorization and read scope

| Operation                                                       | Requirement                                                                            |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Category create, update and status                              | GLOBAL `MANAGE_SERVICES`                                                               |
| Service master update and status                                | GLOBAL `MANAGE_SERVICES`                                                               |
| Service create                                                  | GLOBAL `MANAGE_SERVICES` + `MANAGE_SERVICE_PRICES`                                     |
| Price change                                                    | `MANAGE_SERVICE_PRICES` (GLOBAL_ONLY) only                                             |
| Availability at branch B                                        | `MANAGE_SERVICES` for B (a branch grant with membership, or GLOBAL); B must be visible |
| Reads (`GET /service-categories`, `/services`, `/services/:id`) | Any authenticated workforce actor                                                      |

- **Branch-scoped `MANAGE_SERVICES` (Owner decision).** It toggles availability **only
  for its own branch**. Name, category, duration, other master data, status and price
  are refused (tested).
- **Reads by default** show active categories and services only. GLOBAL
  `MANAGE_SERVICES` holders also see inactive ones.
- **Availability entries** are filtered to branches the caller may see:
  - all branches for GLOBAL `MANAGE_SERVICES` or `MANAGE_BRANCHES`;
  - otherwise the caller's active member branches.

  `?branchId=` returns only services actively offered at that (visible) branch;
  another branch is 404.

- **Customers** are refused (403) by the shared admin frame. Anonymous callers get 401.

## Audit and concurrency

These are append-only audit events, written in the same transaction as the change:

| Action                            | Contents                                               | Branch        |
| --------------------------------- | ------------------------------------------------------ | ------------- |
| `SERVICE_CATEGORY_CREATED`        | code, names, sort order, active                        | null (global) |
| `SERVICE_CATEGORY_UPDATED`        | before/after of the changed fields only                | null          |
| `SERVICE_CATEGORY_STATUS_CHANGED` | before/after active flag; reason required              | null          |
| `SERVICE_CREATED`                 | code, category, names, price, duration, active         | null          |
| `SERVICE_UPDATED`                 | before/after of the changed fields only                | null          |
| `SERVICE_STATUS_CHANGED`          | before/after active flag; reason required              | null          |
| `SERVICE_PRICE_CHANGED`           | before/after `priceVnd`; reason required               | null          |
| `SERVICE_AVAILABILITY_CHANGED`    | branch and before/after state (`null` = no row before) | that branch   |

Master-data events are global (null branch), so reading them needs unrestricted
GLOBAL `VIEW_AUDIT_LOG`. Availability events are readable per branch.

**Concurrency** follows the existing model: `expectedVersion` against `row_version`,
with 409 on a stale value.

- **Rows are locked `FOR UPDATE`** after the frame's User locks, using the shared graph
  lock (no security-graph change).
- **Availability has its own version.** A branch manager's toggle never conflicts with
  a master-data edit. `expectedVersion` is `null` when the row doesn't exist yet;
  sending `null` when a row exists is 409.

## API (under `/api/v1`)

| Route                                  | Result |
| -------------------------------------- | ------ |
| `GET service-categories`               | 200    |
| `POST service-categories`              | 201    |
| `POST service-categories/:id`          | 200    |
| `POST service-categories/:id/status`   | 200    |
| `GET services?categoryId&branchId`     | 200    |
| `GET services/:id`                     | 200    |
| `POST services`                        | 201    |
| `POST services/:id`                    | 200    |
| `POST services/:id/status`             | 200    |
| `POST services/:id/price`              | 200    |
| `POST services/:id/branches/:branchId` | 200    |

The contracts are in `@lucy-spa/contracts` (`ServiceCategory*`, `Service*`,
`CatalogStatusRequest`, `ServiceAvailability*`).

- **Protection:** every POST keeps the JSON, exact-Origin and session-bound CSRF
  checks.
- **Strict DTOs:** unknown fields such as `code`, `priceVnd` in a master update, or
  `tourAmountVnd` are rejected, as are non-string prices, string durations and
  unknown query parameters.

## Tests and checks

| Check                                                                                         | Result                  |
| --------------------------------------------------------------------------------------------- | ----------------------- |
| Service catalog integration (real PostgreSQL, each command in its own savepoint, rolled back) | **PASS 5** (4 subtests) |
| Service catalog HTTP contract test                                                            | PASS 1                  |
| Every HTTP suite that boots `AppModule` (rerun because the module changed)                    | PASS 28                 |
| Builds: contracts and API; web `tsc --noEmit` (writes nothing)                                | PASS                    |
| ESLint, Prettier and the boundary check on changed files                                      | PASS                    |

**The integration test covers:**

- **Categories:**
  - code normalization, duplicate 409, and invalid code, name and sort order;
  - branch-scoped, price-only and staff actors refused; customer 403, anonymous 401;
  - update with a before/after audit, a stale 409, and a no-op rejected;
  - deactivation, with same-status 409, visibility for staff vs. managers, and the
    audit.
- **Services:**
  - separate 30- and 60-minute offerings, offered nowhere at creation;
  - the creation audit records the price;
  - `MANAGE_SERVICES` alone can't create (price authority);
  - invalid duration (0, 1441), negative price and unknown category rejected;
    duplicate code 409;
  - master update leaves the price untouched, with a before/after audit and a stale
    409;
  - **branch-scoped `MANAGE_SERVICES` can't edit name, duration or status**;
  - an inactive service is hidden from staff but kept and never deleted.
- **Price:**
  - catalog, branch and staff actors refused;
  - the price manager succeeds, with the version bumped and the before/after audit
    (`150000` → `180000`, reason, STANDARD classification);
  - stale 409; the same price rejected.
- **Availability:**
  - no row means not offered; the branch manager enables its own branch (the audit has
    the branch and `null` → `true`) without bumping the master version;
  - another branch is 404 (also for `?branchId=`); null or stale versions and no-op
    states are 409; disabling hides it again; an unknown service is 404;
  - a GLOBAL manager configures another branch; branch-scoped callers see only their
    own entries; staff and customers are refused.

The postcheck confirms the service and category counts are unchanged, no fixture users
remain, and no Owner was created. Step 2 and 3 suites and Phase 1 suites were not
rerun: the schema and shared authorization code are unchanged.

## Files

Modified:

```text
LUCYSPA_HANDOFF.md
apps/api/src/app.module.ts                  (registers the catalog controller and service)
packages/contracts/src/index.ts             (service catalog contracts)
scripts/test-auth-integration.mjs           (adds the catalog integration test)
```

Created:

```text
apps/api/src/catalog/catalog.input.ts
apps/api/src/catalog/service-catalog.controller.ts
apps/api/src/catalog/service-catalog.http.test.ts
apps/api/src/catalog/service-catalog.integration.test.ts
apps/api/src/catalog/service-catalog.service.ts
docs/PHASE2_STEP4_SERVICE_MANAGEMENT.md
```

## Known limitations and intentional deferrals

- **Step 5:**
  - the skill catalog, eligible service skills (`service_skills`) and employee skills;
  - services are creatable without skills, as intended.
- **Phase 3:**
  - booking qualification and employee availability;
  - scheduling by duration, including the "not after closing time" check;
  - Any-KTV, queue and leave conflicts.
- **Phase 5:** point eligibility and membership discounts. **Phase 7:** tour
  configuration.
- **No speculative columns or commands** were added for any of these.
- **Public menu:** not built. Any future public representation must omit
  `durationMinutes`; the estimated range (`estimatedMinMinutes`–`estimatedMaxMinutes`)
  is the customer-facing value.
- **Price history** lives only in the audit log. Invoices will snapshot prices
  (Phase 4).
- **Inactive entities:** availability rows for an inactive service or branch are
  kept, but an inactive service is not offered anywhere. Booking will require
  service active, branch active and availability active together.
- **Production:** not deployed. It needs `pnpm db:deploy` (both Phase 2 migrations)
  and `pnpm db:permissions:sync`.

## Recommended Step 5 scope (needs separate Owner authorization)

**Skills and employee skills**:

- **Skill catalog:** create, update, activate and deactivate under GLOBAL
  `MANAGE_SKILLS`, with immutable codes, audited.
- **Eligible skills per service:**
  - add and remove `service_skills` rows (any one skill qualifies, H4) under **GLOBAL
    `MANAGE_SERVICES`** (Owner decision 3; `MANAGE_SKILLS` is not the write
    authority);
  - audited, with the service's `expectedVersion` protected.
- **Employee skills:**
  - grant and revoke under `MANAGE_SKILLS` for every branch of the target employee;
  - history-preserving rows (Step 2 triggers), Owner and customers excluded, no
    self-grant by non-Owners, audited;
  - consider whether containment applies.
- **Reads:** an employee's skills and a skill's holders, both scoped.
- **Tests:** HTTP and rolled-back integration.
- **Out of scope:** the Phase 3 qualification engine and UI.

## Post-deployment enhancement: estimated service duration ranges

Added after Phase 2 was deployed (commit `feat: add estimated service duration ranges`),
before the full service catalog is entered. Many spa services have no exact
customer-facing duration (hair wash about 30–45 minutes, herbal hair wash about 60–80,
facials 60–90, nails 60–120), while booking will still need one deterministic duration.

- **Model:**

  | Field                 | Meaning                                                                 |
  | --------------------- | ----------------------------------------------------------------------- |
  | `estimatedMinMinutes` | Customer-facing minimum estimate                                        |
  | `estimatedMaxMinutes` | Customer-facing maximum estimate                                        |
  | `durationMinutes`     | Deterministic internal scheduling duration (meaning and name unchanged) |

- **Invariant:** `1 <= estimatedMinMinutes <= estimatedMaxMinutes <= durationMinutes <=
1440`, whole minutes. A future booking slot is never shorter than the longest duration
  promised to the customer. An exact-duration service uses min = max. It is enforced by
  the SQL CHECK `services_estimated_duration_range`, the API (`checkServiceDurations`)
  and, as guidance only, the workforce form.
- **Migration:** `20260928000000_phase2_service_duration_estimate` adds
  `estimated_min_minutes` and `estimated_max_minutes`, then backfills, then sets NOT
  NULL and adds the CHECK. It adds no extension, drops nothing and changes no other data.
- **Backward compatibility:**
  - existing services are migrated with estimated min and max equal to their existing
    `durationMinutes` (exact estimates);
  - `durationMinutes` keeps its name and meaning.
- **API:**
  - responses add both estimate fields;
  - create accepts both bounds or neither (neither means exact; exactly one is 400,
    naming the missing field);
  - update accepts any subset and validates the resulting combination against the
    stored values (for example, lowering `durationMinutes` below the estimated maximum
    is `VALIDATION_FAILED` "durationMinutes");
  - audit events include the new fields;
  - permissions, versions and price behavior are unchanged.
- **UI:**
  - the create and edit forms share one set of three inputs (estimated minimum,
    estimated maximum, internal scheduling duration), with the rule explained and Save
    disabled until the values are valid;
  - the service list shows the estimate ("30–45 phút", or "60 min" when exact).
- **Phase 3 booking is NOT implemented.** `durationMinutes` is only being preserved as the
  future scheduling duration; nothing reserves staff time yet.
- **Tests (all pass):**
  - database schema test 11/11: backfill of a service created before the migration;
    exact, range and range-with-slack values accepted; out-of-order and null values
    rejected;
  - service catalog integration 6/6: create with a range and read it back, audit, exact
    and implicit-exact creates, six invalid creates that write nothing, partial updates
    validated against current values, slot below maximum rejected, range and slot moved
    together;
  - service catalog HTTP 1/1: new fields pass the real ValidationPipe; string,
    fractional and unknown fields rejected;
  - skills integration 4/4 (services created without an estimate);
  - API unit/HTTP 77 pass (17 opt-in integration tests skipped there and run
    separately);
  - web 29/29 (3 new);
  - web `tsc`, ESLint, Prettier, boundaries and Prisma validate pass; the local
    database with 6 migrations shows an empty schema diff.

## Post-deployment enhancement: permanent deletion of services and categories

Added so the Owner can remove services and categories that were entered incorrectly
(commit `feat: add safe service catalog deletion`). No existing
data is deleted automatically, and no migration or schema change is involved.

- **Delete vs deactivate:** "Xóa" (delete) permanently removes the record; only its
  audit snapshot remains. "Ngừng hoạt động" (deactivate) keeps the record and history and
  is the normal way to retire a service or category. Deactivation is unchanged.
- **Routes:** `POST /api/v1/services/:id/delete` and
  `POST /api/v1/service-categories/:id/delete`, with body
  `{ expectedVersion, reason? }` → `200 { id, deleted: true }`.
  - These are ordinary commands, so the global JSON, exact-Origin and CSRF guard applies.
    There is no `DELETE`-method route and no security exception.
  - Strict bodies reject any other field (for example `cascade`).
- **Authorization** (server-side, transaction-time):
  - **Service:** GLOBAL `MANAGE_SERVICES` **and** GLOBAL_ONLY `MANAGE_SERVICE_PRICES`,
    the authority that creates a service.
  - **Category:** GLOBAL `MANAGE_SERVICES`, the authority that creates one.
  - Branch-scoped managers, staff and customers get 403; anonymous callers 401.
- **Current references, from the actual schema:**
  - `services` is referenced only by `service_skills` (eligible skills) and
    `service_branch_availability`. Both are configuration owned by the service, with FK
    `ON DELETE RESTRICT`.
  - `service_categories` is referenced only by `services` (`RESTRICT`).
  - There is no history table yet. Audit events refer to entities by id without a foreign
    key and are never deleted.
- **Service deletion rules:**
  - In one transaction: lock the service and check `expectedVersion`, delete its
    `service_skills` and `service_branch_availability` rows, then delete the service.
  - Skills and branches themselves are untouched, and no orphan rows remain.
  - Any other row that references the service makes the delete fail through its RESTRICT
    foreign key. The whole transaction rolls back (nothing is partially deleted) and the
    API returns `409 CONFLICT` "inUse"; the UI says to use "Ngừng hoạt động" instead.
  - This is the protection **Phase 3 history must keep:** booking, invoice or any other
    history table that references `services` must use `ON DELETE RESTRICT` (never
    CASCADE), so a service with history can only be deactivated.
- **Category deletion rules:**
  - Refused with `409 CONFLICT` "services" while **any** service belongs to the
    category, active or inactive. Services are never cascaded.
  - The RESTRICT foreign key from services is the final guard against a concurrent insert.
  - Once its services are moved or deleted, the category can be deleted.
- **Other errors:** stale `expectedVersion` → 409 (the list reloads); an unknown or
  already-deleted id → 404.
- **Audit** (append-only, global event):
  - `SERVICE_DELETED` records a before snapshot: code, category, names, price, durations,
    status, eligible skill ids and availability. Its after value is `{ deleted: true,
removedSkillLinks, removedAvailabilityRows }`.
  - `SERVICE_CATEGORY_DELETED` records a before snapshot (code, names, sort order,
    status) and `{ deleted: true }`.
  - Both record the actor, time, request id and optional reason.
- **UI** (Workforce → Dịch vụ):
  - "Xóa" sits next to "Sửa" in the category list and next to "Chi tiết" in the service
    list (shown only with the matching permissions; the API still decides).
  - A confirmation dialog shows the name and code, explains that the deletion is
    permanent (and points to "Ngừng hoạt động" for services), and offers "Hủy" and a
    visually destructive "Xóa dịch vụ" / "Xóa nhóm dịch vụ".
  - Nothing is sent until that button is pressed; Hủy, Escape or the backdrop close it.
  - On success the row disappears immediately, the list reloads, and a success message
    names the record.
  - On refusal the record stays visible and the dialog shows the reason in Vietnamese,
    for example "Không thể xóa nhóm dịch vụ vì nhóm này vẫn còn dịch vụ. Hãy chuyển hoặc
    xóa các dịch vụ trước."
- **Tests (all pass):**
  - service catalog integration 8/8 (real PostgreSQL, rolled back), with two new subtests:
    - **Services:** unauthorized callers refused and nothing deleted; stale version
      refused; authorized deletion removes the service and its skill and availability rows
      with no orphans, keeping skills and branches; the service disappears from reads;
      deleting again is 404; audit snapshot checked; a probe row referencing the service
      through a RESTRICT foreign key (simulating future history) blocks deletion
      atomically with nothing removed and no audit event, and deactivation still works.
    - **Categories:** an empty category is deleted and audited; categories with an
      active or an inactive service are refused and nothing is removed; after its service
      is deleted, the category can be deleted; unauthorized callers and stale versions are
      refused.
  - Delete HTTP contract 1/1: CSRF/Origin on both routes, strict bodies, no DELETE route,
    error mapping.
  - Service catalog HTTP 1/1.
  - Web 37/37, 4 new: the dialog shows name and code and opening it sends nothing; a
    confirmed deletion is one CSRF-protected POST with only `expectedVersion`; Vietnamese
    refusal messages; immediate row removal and success message.
- **Limitation:** web tests render components on the server and exercise the deletion
  logic directly. The repository has no DOM/click testing library, so the click paths
  (Hủy, confirm) are covered at the logic level rather than by simulated clicks.

## Post-deployment enhancement: price ranges and pricing units

Added so the real menu can be entered exactly, for example per-nail Nail Design prices
("5.000 ₫/ngón", "5.000–10.000 ₫/ngón"). Commit `feat: add service price ranges and
pricing units`.

- **Model:**

  | Field (API / SQL)               | Meaning                                                         |
  | ------------------------------- | --------------------------------------------------------------- |
  | `priceVnd` / `price_vnd`        | **Minimum** price per pricing unit; the price itself when exact |
  | `priceMaxVnd` / `price_max_vnd` | Maximum price per pricing unit; equal to `priceVnd` when exact  |
  | `pricingUnit` / `pricing_unit`  | `PER_SERVICE` (a flat price) or `PER_NAIL` (per nail)           |
  - The existing `priceVnd` field keeps its name. For every flat-price service it means
    exactly what it meant before, so existing clients, audit history and future invoice
    snapshots stay valid.
  - `ServicePricingUnit` is a SQL/Prisma enum. Further units are added as enum values
    only when real menu data needs them.

- **Invariant:** `0 <= priceVnd <= priceMaxVnd`, in integer VND (bigint, carried as
  decimal strings, never floating point). It is enforced by the SQL CHECKs
  `services_price_nonnegative` and `services_price_range`, by the API (`servicePrice`) and,
  as guidance only, by the form. An exact price is min = max.
- **Migration:** `20260929000000_phase2_service_price_range_unit` creates the enum and adds
  `pricing_unit` (NOT NULL, default `PER_SERVICE`) and `price_max_vnd`. It then backfills
  `price_max_vnd = price_vnd`, sets it NOT NULL and adds the CHECK. Every existing
  service becomes an exact `PER_SERVICE` price; no other data changes.
- **API** (pricing is price data, so it changes only through the price authority):
  - **Responses** add `priceMaxVnd` and `pricingUnit`.
  - **Create:** `priceMaxVnd` is optional (default `priceVnd`, an exact price) and
    `pricingUnit` is optional (default `PER_SERVICE`); it already requires the price
    permission.
  - **`POST /services/:id/price`** (GLOBAL_ONLY `MANAGE_SERVICE_PRICES`, reason required)
    takes `priceVnd` plus an optional `priceMaxVnd` (omitted means exact) and an optional
    `pricingUnit` (omitted means unchanged). A change that alters nothing is rejected.
  - **Master-data updates** never touch pricing.
  - **Errors:** `VALIDATION_FAILED` "priceMaxVnd" (below the minimum or malformed),
    "priceVnd" (negative, malformed or unchanged) and "pricingUnit" (unknown). The strict
    DTOs reject numbers, lowercase units and unknown fields with 400.
- **Audit:** `SERVICE_CREATED` and `SERVICE_PRICE_CHANGED` (before/after) record
  `priceVnd`, `priceMaxVnd` and `pricingUnit`. The `SERVICE_DELETED` snapshot also records
  the full price. Deletion behavior itself is unchanged.
- **UI:**
  - the create form and the service's price section share "Giá tối thiểu", "Giá tối đa"
    and "Đơn vị tính giá" ("Theo dịch vụ" / "Theo ngón"), with a live preview of the
    displayed price and a message when the maximum is below the minimum;
  - the price section needs a reason and only submits a real change;
  - the list and the detail header show "40.000 ₫", "5.000 ₫/ngón" or
    "5.000–10.000 ₫/ngón" (English "/nail"), with no range when min = max.
- **Existing Nail Design services** were not changed automatically; the Owner edits them
  after deployment. No service code appears in application logic.
- **Tests (all pass):**
  - database schema test 12/12: a service created before the migration is backfilled to
    `80000–80000 PER_SERVICE`; enum values; exact, per-nail and ranged prices accepted;
    max < min, negative, unknown-unit and null values rejected;
  - service catalog integration 9/9 (new pricing subtest): exact PER_SERVICE (default),
    exact PER_NAIL and ranged PER_NAIL creates; detail and list reads return range and
    unit; creation audit; five invalid creates that write nothing; a price command that
    sets a range (unit kept), changes the unit (omitted maximum means exact) and returns
    to exact; before/after audit; invalid and unchanged updates rejected with the price
    unchanged; `MANAGE_SERVICES` alone cannot change pricing. The existing price subtest
    now asserts the range and unit in its audit.
  - service catalog HTTP 1/1: range and unit reach the price command; numbers, negative
    values, unknown or lowercase units and pricing fields on the master-data route are
    rejected. Delete HTTP 1/1.
  - web 40/40: VI/EN display of exact and ranged per-nail and flat prices; string-based
    grouping beyond 2^53; the form rule compares as integers; form labels, unit options
    and preview.
