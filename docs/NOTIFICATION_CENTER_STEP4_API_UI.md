# Notification Center — Step 4: API + UI

Status: **IMPLEMENTED, PENDING OWNER REVIEW. Not committed, not pushed, not deployed.**
Last implementation step before the Final Validation Gate. Builds on
[Step 1](NOTIFICATION_CENTER_STEP1_FOUNDATION.md), [Step 2](NOTIFICATION_CENTER_STEP2_ROUTING.md) and
[Step 3](NOTIFICATION_CENTER_STEP3_LEAVE_EVENTS.md). In-app only. No schema change, no new permission.
Revenue notifications remain deferred to Phase 4.

## API (extends `/api/v1/notifications`; no new authorization model)

| Endpoint                                 | Behavior                                                                                                                                                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/notifications`              | The caller's inbox. Query: `cursor`, `category` (`OPERATIONS` \| `HR`, from the registry), `unread=true`, `archived=true`. Default lists **non-archived** items. Returns `items`, `nextCursor`, `unreadCount`, `unreadByCategory`. |
| `GET /api/v1/notifications/unread-count` | `{ unreadCount, unreadByCategory }` (the bell badge).                                                                                                                                                                              |
| `POST /api/v1/notifications/:id/read`    | Marks one own item read; idempotent, the first timestamp is kept (unchanged behavior).                                                                                                                                             |
| `POST /api/v1/notifications/:id/archive` | Archives one own item (soft state, never a delete); idempotent, the first timestamp is kept. Returns the item.                                                                                                                     |
| `POST /api/v1/notifications/read-all`    | Body `{ category? }`. Marks the caller's unread **non-archived** items read (optionally one category). Returns `{ updated, unreadCount, unreadByCategory }`; a repeat returns `updated: 0`.                                        |

Contracts (`packages/contracts`): `NotificationItem` gains `archivedAt` and `params`
(registry-validated structured facts or `null`); `NotificationPage` gains `unreadByCategory`; new
`NotificationCountResponse`, `NotificationQuery`, `NotificationReadAllRequest/Response`, and
`NOTIFICATION_CATEGORIES` / `isNotificationCategory` in the registry.

## Ownership and security

- Every read and write is scoped to `recipient_user_id` = the authenticated caller. There is **no**
  recipient parameter anywhere; the global validation pipe (whitelist + forbid unknown) rejects any
  other query or body property with 400, and the write endpoints keep the existing CSRF/origin guard
  (403 without it).
- A foreign or unknown id is indistinguishable from a missing one (`NOT_FOUND`), for read and archive,
  and nothing of the other user changes.
- Only registry-validated `params` are returned; a tampered `params` object is returned as `null`.
  Neither the leave reason nor a manager note exists in any event or notification, so none is rendered.
- No permission was added or changed. Notification routing (who receives what) is unchanged from Steps 2–3.

## Filtering, counts, read and archive semantics

- Category filtering uses `notificationTypesInCategory(category)` (`type IN (...)`); there is no
  category column. Phase 3 types are `OPERATIONS`; the two Leave types are `HR`.
- `unreadCount` and `unreadByCategory` count rows with `read_at IS NULL AND archived_at IS NULL`, so an
  archived item is never counted. Category counts are grouped by type in SQL and mapped through the registry.
- Read and archive are independent states. Archiving an unread item leaves it unread but uncounted;
  reading an archived item is allowed and does not un-archive it. **Mark all read** never touches
  archived items. Nothing is hard-deleted; no retention or cleanup was added.
- Pagination (`created_at`, `id` keyset, 30 per page) keeps its filters across pages.

## UI (one shared inbox for workforce and customers)

- Bell with an unread badge (99+ cap), accessible label, VI/EN; refreshes every 30 s and after any change.
- Notification Center: category tabs with unread counts (workforce only; customers only ever receive
  operational messages, so they get no tabs), an **Unread only** toggle, **Archived / Inbox** switch,
  **Mark all as read** (current category, hidden in the archived view), per-item **Mark read** and
  **Archive**, refresh, load more, and loading / empty (with filter-aware text) / error states. Controls
  are disabled while a save is in flight; a view that no longer matches an item (for example after
  reading in "Unread only") drops it.
- Reuses the existing component, styles and conventions; the customer inbox architecture is unchanged.

## VI/EN rendering

`notificationMessage` renders Leave notifications from structured `params` (leave type, dates,
decision), localised: `LEAVE_REQUESTED`, `LEAVE_DECIDED` approved, `LEAVE_DECIDED` rejected (VI and EN).
Without params the generic per-type text is used. Phase 3 messages and the way they render are unchanged.
Dates are date-only text in the viewer's locale (no time-zone shift).

## Target / link behavior

- Booking and Visit keep their existing destinations and permission hints.
- A leave notification links to the **existing** leave page (`/leave`) for workforce accounts (employee
  or Owner); customers get no link. **Limitation:** the leave page has no per-request route or anchor, so
  the link opens the leave page, not the specific request. No URL was invented.

## Validation performed (targeted; no full regression)

- API HTTP (`notification.http.test`): default filters hide archived items; category/unread/archived
  parse; unknown category/flag/recipient parameters are 400 and never reach the inbox; archive and
  read-all need CSRF/origin and accept no extra body properties.
- API unit (`notification.test`): the bounded, own-only projection; unread means not read **and** not
  archived; idempotent read; authentication required.
- API integration on PostgreSQL (`notification-inbox.integration.test`, rolled back): ownership isolation
  (only own rows, foreign ids NOT_FOUND, other user untouched); category/unread/combined filters; counts
  in total and by category; mark one (idempotent, first timestamp kept); archive (hidden by default,
  listed on request, never counted, not deleted, repeat idempotent); mark-all (own, non-archived, per
  category, idempotent, skips archived, never touches another inbox); tampered `params` never exposed;
  pagination keeps filters.
- Web (`notification-center.test`, `notifications.test`): Leave requested/approved/rejected in VI and EN,
  fallback text, Phase 3 messages unchanged, links, archived badge and actions, query building (never a
  recipient), item update/drop semantics, bell and inbox chrome (customer without tabs, workforce with).
- Typecheck, lint, format: pass.
- Not run: browser/manual UI verification (no DOM environment is used in the web test setup; behavior is
  covered by SSR markup and pure-function tests), full regression, the comprehensive gate.

## Deferred / limitations

Leave links open the leave page, not a specific request; email, preferences, retention/hard delete,
timer escalation, migrating Phase 3 recipients, revenue and every category without a business trigger.

## Context for the Final Validation Gate

Verify on a fresh database: all migrations (including `20261012000000_notification_foundation`) apply
with no schema drift beyond the known composite-FK Prisma limitation; the Leave flow end to end (create →
event → managers by hierarchy; decision → employee) with the worker consumer running against real
PostgreSQL (and Redis for the Phase 3 warnings); Phase 3 notification regression (bookings, arrival,
warnings, reassignment); inbox ownership isolation over HTTP with real sessions; VI/EN in a browser;
`pnpm typecheck`, `lint`, `format:check`, `build` (the web build regenerates `apps/web/next-env.d.ts`,
which must stay out of the commit), and the relevant integration suites.
