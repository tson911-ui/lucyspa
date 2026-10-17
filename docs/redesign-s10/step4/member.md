# Step 4, member area and auth (session 10)

Worker: member. Stylesheet `packages/ui/src/s10-member.css` (all rules scoped to `ls-mem-*` hooks set by the member screens, plus the
account title band, `.ls-book-title`, `.ls-ticket-page`). Copy: `docs/redesign-s10/copy/member.md`. Kit requests: 6 `[member]` lines in
`docs/redesign-s10/kit-requests.md`.

Skills: frontend-design (guided every page: one surface per idea, tells removed, one filled button per view); web-design-guidelines
(rules read from the cached `.local/s10/wig-command.md`: the WebFetch of the raw URL returned only a summary); react-best-practices
(rules applied: rerender-derived-state-no-effect, rerender-memo, js-combine-iterations, js-set-map-lookups, async-parallel,
bundle-barrel-imports, js-cache-function-results, rerender-no-inline-components); react-view-transitions (`references/implementation.md`
read; decisions per page below).

New shared files (member only): `components/customer/member-ui.tsx` (StatusBadge with icon, MemberEmpty, RowLink),
`components/customer/member-format.ts` (Intl points and percent with cached formatters, expected range, order-line tone, pager labels),
`components/customer/member-paging.ts` (client pager state). The member pages no longer import `i18n/workforce` (270 KB) through
`useClientPaging`, `paginationLabels`, `lib/workforce/loyalty`, `lib/workforce/product-orders` or `workforce/ui` (pager text now in
`i18n/customer.ts` `list`).

## Cross-page (all member pages)

- account-frame.tsx:83,100: a record page (booking, invoice, order detail) has the Back chevron and no tabs (one navigation device, B7/C40);
  `backLabel` names the target ("Quay lại lịch hẹn", "Quay lại hóa đơn") :76,91. Top-level pages: no Back (kit PageBack decides).
- s10-member.css "Account title band": tabs from 768 px, list below, never both (the `.ls-subnav` rule loaded later showed the tabs at
  200 % zoom = 720 css px).
- Status badges (B18, C5): kit `Badge` with icon everywhere (member-ui.tsx `StatusBadge`); neutral states name an icon (completed = check,
  cancelled = x-circle, used up = check, expired/waiting = clock, voided = x-circle). No tier or blue colour on non-status text.
- Empty states: heading, sentence, one outline action (member-ui.tsx `MemberEmpty`, `buttonClass('secondary')`), no box (B12).
- Tells removed: Reveal entrances (all screens), count-up (loyalty), middle-dot strings, numbered lines "1. X", eyebrow labels (record
  facts are label/value rows at 14), pill-in-card kit, card per table row on phones, burgundy link columns.
- Tables: `.ls-mem-rows` + `phoneRows="compact"` = one hairline surface on a phone; names wrap by word, no ellipsis or clamp (C15, Owner
  answer 7); whole row = one link (stretched `RowLink`, focus ring on the row); the one-item ⋮ menus are gone (wig bookings.tsx:190,
  invoices.tsx:140 closed).

## Pages

| Page              | Pattern                       | What changed (file:line)                                                                                                                                                                                                                                                                                                                                                                              | B/C items         | Baseline findings closed                                                                                                |
| ----------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| login             | R auth card (9.2)             | auth.tsx:41-90 no second wordmark above the card; :263-267 C68 line under the title, booking variant when `next` is the booking page; `name` on every input (:280,:300)                                                                                                                                                                                                                               | C68, C34, B1      | wig auth.tsx:244                                                                                                        |
| register          | auth card                     | :506-585 names; :529 placeholder from i18n; :336-345 password problems on their field + focus first error (PasswordPair `problem`, :176 focusFirstError)                                                                                                                                                                                                                                              | B1                | wig auth.tsx:483, :406, :244                                                                                            |
| forgot            | auth card                     | :671 back = neutral pill then primary (same order at every width); :652-662 OTP and password errors on the fields                                                                                                                                                                                                                                                                                     | FR action rule    | wig auth.tsx:302/:601                                                                                                   |
| account           | account home                  | bookings.tsx:199-216 whole-card link, chevron in the header, no pill; :244 h1 "Xin chào, {tên}"; points as label/value rows, tier as its own neutral badge (no dot); s10-member.css equal heights, hover one grey step, pressed the next                                                                                                                                                              | B19, B12, B6, B1  | E2 pink-dark (pill), tells                                                                                              |
| account-empty     | account home                  | next-booking card links to the booking flow with two quiet lines (no button: Owner answer 2, the header has the action)                                                                                                                                                                                                                                                                               | B19, B11          | middle dot, pill-in-card                                                                                                |
| book              | booking flow                  | book.tsx:149 branch derived in render; :233 services grouped/matched once (useMemo); :522 one hairline list surface per category, note always the 2nd line (CSS); :378-412 Continue stays enabled, names the next step, says what is missing (focus to the step heading); :780 review values as two lines; :852 tally without dot; search placeholder "Ví dụ: gội đầu…"; current step label ink (CSS) | B6, B12, B22, C38 | rbp book.tsx:153-156, :478-493, :499; wig book.tsx:394, :472, customer.ts:10                                            |
| bookings          | customer list                 | :132-191 row link, services in full, status badge with icon, no ⋮, compact phone rows; section headings at the heading role                                                                                                                                                                                                                                                                           | C15, B18, C5      | wig bookings.tsx:190; rbp bookings.tsx:34,47                                                                            |
| booking-detail    | split (record + summary card) | :460-533 services as lines with labelled facts (time, duration, for, staff); summary card: status, code (translate=no), branch, time; cancel = danger outline in the card footer + confirm dialog; subtitle = date and time, code only in the record                                                                                                                                                  | C41, B6           | wig bookings.tsx:107 (not-found h1 now the message)                                                                     |
| booking-cancelled | as detail                     | :455 "Lịch hẹn này đã hủy." with icon at the top; summary card offers "Đặt lịch mới" (the page's one primary)                                                                                                                                                                                                                                                                                         | C33, C5           |                                                                                                                         |
| bookings-empty    | empty state                   | :357 MemberEmpty heading + sentence + outline "Đặt lịch", no box                                                                                                                                                                                                                                                                                                                                      | B12, B11          |                                                                                                                         |
| invoices          | customer list                 | invoices.tsx:62-105 code first (date under it), whole-row link, "0 ₫" not "—", badges with icon, no ⋮; pager text from i18n/customer                                                                                                                                                                                                                                                                  | C15, B18          | wig invoices.tsx:140; rbp invoices.tsx:24,36                                                                            |
| invoice-detail    | split                         | :228-345 lines without numbers, unit × qty and recipient as two values; payments as lines (method, amount, time); summary card: status, code, branch, issued/paid, totals; review below; review read beside the invoice (useReviewPrompt)                                                                                                                                                             | C41, B12          | rbp invoices.tsx:392, :333-336 (Map)                                                                                    |
| invoices-empty    | empty state                   | :139 MemberEmpty "Chưa có hóa đơn" + sentence + outline "Đặt lịch"                                                                                                                                                                                                                                                                                                                                    | C33               |                                                                                                                         |
| review card       | form card                     | review-card.tsx:105-111 submit stays enabled, says what is missing; :191 "Để sau" neutral (was outline); Reveal removed; first-person copy removed                                                                                                                                                                                                                                                    | B11, C38          | wig review-card.tsx:178                                                                                                 |
| loyalty           | loyalty                       | loyalty.tsx: no count-up, no Reveal; wallet cards one height, tier on its own line (neutral badge), points at the title size (28, on scale); tier table = kit InfoTable (no `div role=table`, no inset shadow), own tier = tick + words in ink; percents and the "1.000 ₫" rule through Intl; combos/uses/referrals/gifts under one heading "Combo, quà tặng và giới thiệu" (h3 blocks)               | D7, A3, R26       | E2 shadow-gradient (div.ls-tier-row gone), wig loyalty.tsx:145,:207,:178, customer-loyalty.ts:29; rbp loyalty.tsx:32,46 |
| loyalty-empty     | loyalty                       | :91 when no wallet has points: "Bắt đầu tích điểm", the earning rule, outline "Đặt lịch"; badges in a fixed slot (equal heights)                                                                                                                                                                                                                                                                      | C33, B6           |                                                                                                                         |
| notifications     | account list                  | notifications.tsx: "Đánh dấu tất cả đã đọc" moved from the title band to the list's trailing edge; `ls-mem-inbox` CSS: titles ink, no underline at rest, wrap in full (no clamp, C15)                                                                                                                                                                                                                 | A3, C15           | partial; the rest is inbox.tsx (kit request)                                                                            |
| ticket            | public ticket                 | ticket-view.tsx:104-106 code in ink at 28 (scale), translate=no, its label visually hidden; one card (facts + products as hairline rows); line state only where it differs; "Số lượng 1" and the price apart (no dot); cached Intl                                                                                                                                                                    | A3, B22, B1       | E2 brand-text and off-scale `p.ls-ticket-code`; wig ticket-view.tsx:94; rbp ticket-view.tsx:23                          |
| session states    |                               | session.tsx:175,188 the error and staff-session states have their h1                                                                                                                                                                                                                                                                                                                                  |                   | wig session.tsx:170                                                                                                     |

## web-design-guidelines re-run (files changed in this step)

Found during the re-run and fixed: account-frame.tsx (Back label not naming its target) → `backLabel`; bookings.tsx (menu navigation via
router.push, NotFound h1, ellipsised services) → fixed; invoices.tsx (router.push menu, rows by date only) → fixed; loyalty.tsx (hand-built
%, div table, "1.000đ") → fixed; book.tsx (disabled Continue, generic "Tiếp tục", placeholder = label, straight quotes, number + unit
without nbsp) → fixed; auth.tsx (no `name`, literal placeholder, errors in the top notice) → fixed; review-card.tsx (disabled submit) →
fixed; ticket-view.tsx (no translate=no) → fixed; s10-member.css (`outline: none` on the row link) → ring drawn on the stretched area.

Follow-up (coordinator, nothing deferred), all closed:

- book.tsx:120 step in the URL: `?step=` through the kit `useUrlState`; a step change is a history entry, so Back/Forward move between
  steps and a reload stays on the step. The choices are kept for the tab in `sessionStorage` (try/catch; the flow works without it), and
  the shown step is held back to the furthest one the choices allow (`furthestStep`), so a reload or a shared address never opens a step
  whose earlier choices are missing. The heading takes the focus on every step change (button or Back/Forward), and `useStepSlide` still
  plays (G3, `useMotion`, 240 ms, none under reduced motion). A confirm step opened by a reload makes its idempotency key on confirm.
- book.tsx:118, auth.tsx:381 unsaved-changes guard: `components/customer/unsaved-guard.ts` (beforeunload + a capture-phase click guard on
  in-site links, only while the form holds entries; plain questions "Lịch hẹn chưa được đặt. Rời trang và bỏ các lựa chọn?" / "Bạn chưa
  gửi đăng ký. Rời trang và bỏ thông tin đã nhập?"). Never after submit: booking is not dirty while sending or once made; register is not
  dirty while sending or once the code step opens. The sign-in / register switch asks too (`confirmLeave`). Leaving through a link after
  "OK" forgets the kept booking choices.
- book.tsx:896 undo for removing a guest: kit toast with `action: { label: 'Hoàn tác' }` (8 s); the guest returns to the same place with
  the services that were theirs. `CustomerShell` now mounts the `ToastProvider` (region "Thông báo").
- book.tsx:728 slot times: `formatSlotTime` (Intl, the branch wall-clock reading kept) on the time choices and the review row.
- List pages in the URL: bookings `upcomingPage` / `historyPage`, invoices `page` and `loaded` (the "Xem thêm" pages are fetched again on
  return, one after another), loyalty `historyPage`, `combosPage`, `usesPage`, `referralsPage`, `giftsPage` (`member-paging.ts`
  `useUrlPage`). Notifications: the shared inbox now keeps group, view and page in the URL itself (admin-a).
- account-menu.tsx:41: page entries are real links through the kit `Menu` `LinkComponent` (Next `Link`, view-transition type kept); only
  sign-out is an action.
- Notifications: the inbox workaround in s10-member.css is retired (the shared inbox has no status column, dot + 600 for unread,
  wrapping messages and a full empty state); only the list wrapper and the mark-all row stay. Member table overrides the kit now covers
  (unclamp, no tooltips) were trimmed too.

Final list: 0.

## react-best-practices re-run (components touched)

Fixed: book.tsx derived branch, memoised groups, single match pass, Set lookup, messages bound to their step (derived, no reset effects);
bookings/invoices columns memoised; invoices review read in parallel; ticket and member Intl formatters cached; workforce dictionary no
longer reached from the member pages; no inline components (the notifications `frame` is a render function prop).

Follow-up, all closed:

- client-swr-dedup (bookings.tsx `useFetch`): `lib/customer/fetch-cache.ts` (no dependency) shares in-flight reads and reuses an answer
  for 30 s per request key; `useFetch(load, key, { cache })` opts in with the request's own path (never a short name two screens could
  share), paints a recent answer at once, `retry` and `set` forget it, a failed read is never kept. Member callers use it (home and the
  bookings list now share one `/api/v1/me/bookings` read); a cancellation and a new booking forget `/api/v1/me/bookings*`; any session
  change (sign-in, sign-out, profile) clears everything. The shop screens keep their uncached reads until their owner passes a `cache` key.
- session.tsx:109-127 / :155-198: `RequireCustomer` reads the session no more: it follows the site frame's session (which already re-reads
  on every announced change), so the area opens at once and the second listener is gone; it reads once itself only when the frame knows no
  member (anonymous, staff or a failed read). The account context value is memoised. Sign-out marks the frame signed out first.
- auth.tsx:199-209: the sign-in page uses the site frame's session instead of a third read (safe now that sign-out marks the frame first).
- loyalty.tsx:63-92: the five block reads start beside the summary's (`LOYALTY_BLOCKS` into the shared read cache); each block picks its
  read up when it mounts.

Final list: 0.

## View transitions

Route fade only on every member page (the existing `NAV_TRANSITION` links); no shared-element morph (no photo pairs here). Booking step
change: `useStepSlide` (kit, `useMotion`, `duration('base')` = 240 ms ≤ 11.3, no tween under reduced motion / data saver / `ls-fx=off`),
the one feedback animation of the flow. Login/register switch, review sent, tabs: no animation.

## Validation

- Tests (after the follow-up): account-frame, auth, review-card, profile, lib/customer loyalty/booking/invoice/fetch-cache (new),
  shop-screens, order-fulfilment, account-menu, notification-bell, pos-pre-orders, ui-ratchet: 75/75 pass. Kit: components-css +
  pages-v2-css 32/32.
- `tsc --noEmit` (web): 0 errors in member files (other workers' files report errors: workforce branches/discounts/employees screens,
  `ButtonLinkComponent` and organization texts). `eslint` on member files: 0.

## For the lead

- Kit requests made earlier: Menu links and DataTable unclamping are now in the kit and used (account-menu links; member overrides
  trimmed); the inbox items are done by admin-a. Still open there: the header "Đặt lịch" pill on auth pages (likely moot once it is the
  outline), the ticket footer (chrome), a DataTable row-link option (member rows use their own stretched link), dead CSS for C18.
  `pages-v2.css`/`site.css` not edited.
- Orders pages (public worker) share `AccountScreen` and `useFetch`: their record pages also drop the tabs (same B7 rule), their
  `NotFoundPage` h1 is the not-found sentence, and their reads stay uncached unless they pass `{ cache: path }`.
- Copy is new and pending Owner approval (copy/member.md).
- The review prompt is read beside every invoice detail, paid or not: the API answers `canReview: false` (200) for an unpaid invoice
  (apps/api/src/reviews/customer-reviews.core.ts:87); the card still shows only for a paid invoice.
- The whole-row link relies on `position: relative` on `<tr>` from 640 px (older desktop Safari ignored it). Please look at a 1440 Safari
  capture of bookings/invoices if one exists.
- The leave question is the browser's own confirm (plain text; no kit confirm dialog can stop a router link synchronously).
