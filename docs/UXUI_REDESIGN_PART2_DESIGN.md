# UX/UI Part 2: customer area and public site (design contract)

Status: **approved by the Owner 2026-10-03 (answers in section 10).** Step plan: `UXUI_REDESIGN_PART2_PLAN.md`.
Mockups (real tokens, light and dark): `docs/mockups/part2/home.html`, `booking.html` (screens in `.local/uxui-screens/p2-*`).
Builds on `UXUI_REDESIGN_DESIGN.md` (tokens section 6, rules FR1-FR15 in 21.4, seasons section 20) and PRD 4.4 (motion).
Visual reference only: the Lovable render (`pixel-perfect-render-8439.lovable.app`). Nothing of its code or copy is reused.

## 1. What the reference teaches, and what we change

| Keep (layout ideas)                                                               | Change or drop                                                                                                 |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Hero: copy left, promo slider right; warm page band, white bands alternate        | All copy, hours (it shows 2 weekday ranges and 0905 123 456), prices and the "Mỹ phẩm" item are fake           |
| Service-group cards with a short price list and "Xem tất cả"                      | Its "why choose us" section (clean tools, punctuality) is not real: dropped entirely (Q-P2-3)                  |
| Visit section: hours card + address card; 3-column footer                         | White text drawn straight on a photo; we put text on a surface-token panel so contrast holds in light and dark |
| Sticky pill header, phone bottom tab bar, sticky booking summary/action bar       | Targets of 36-40 px on phones (its own audit fails 44 px); we hold 44 px                                       |
| Booking as a stepper with selectable service rows                                 | Its guest "Thông tin" step: we have no guest booking (Q-P2-2). Our people and staff rules stay (5.5)           |
| Auth card with Đăng nhập/Đăng ký switch; account home with greeting + quick tiles | Raw Tailwind/shadcn markup; bordered boxes inside cards; two different headers (public vs account)             |

## 2. Real-data contract (nothing invented, nothing hard-coded)

| Content                                        | Source of truth                                                                                                                                                  | Who edits                      |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Name, tagline VI/EN, address, hotline, map URL | new `website_shop_info` row (6.1), seeded with the Owner's values: Lucy Spa, "Thư Giãn Tận Tâm – Nâng Tầm Nhan Sắc", 04 Nguyễn Quang Bích, Đà Nẵng, 0934 936 101 | Owner, admin "Shop info" tab   |
| Opening hours                                  | `branch_operating_hours` of the shop-info branch (the same rows the booking engine uses: one truth). Today: every day 09:00-21:00                                | Owner, existing branch screen  |
| Services, groups, prices, estimates            | live catalogue (active categories and services, available in at least one active branch)                                                                         | Owner, existing Services admin |
| Promotions                                     | only the Owner's Slider (`website_slides`) and Popup (`website_popups`)                                                                                          | Owner                          |
| Season look                                    | existing season layer; untouched                                                                                                                                 | Owner                          |
| Hero fallback image                            | optional media-library asset chosen in Shop info; none chosen = a brand panel (wordmark), never a fake photo                                                     | Owner                          |

Display rules (one formatter in `apps/web`, tested): price `min == max` -> `80.000 ₫`; range -> `5.000-30.000 ₫`; `PER_NAIL` appends
`/ngón` (EN `/nail`); estimate `min == max` -> `60 phút`, else `60-90 phút`. **Only `estimatedMin/Max` is public; the internal
scheduling `durationMinutes` never leaves the API** (PRD 8.2). Money stays integer VND. Group order: category `sortOrder`; services
inside a group: price ascending then name (no per-service order exists; Q-P2-8). A group with no visible service is not shown.
Home shows each group's first 3 services. "Mỹ phẩm": no route, no hidden link; nav and footer are data-driven (3.3) so one entry adds it.

## 3. Information architecture

### 3.1 One site chrome

Public pages, auth pages and the member area share **one** header and footer (the reference has two different ones; we had two as
well). The member area adds an in-page tab row, not a second shell. The seasonal frame (`SeasonSiteFrame`: header slot, footer slot,
greeting strip, particles, footer scene) is kept and receives the new header and footer unchanged, so every season kit still seats.
The staff area is untouched, and so are the staff login pages (red full-screen auth panel, 12.6).

### 3.2 Routes (existing URLs stay: emails and notifications link to them)

| Route (`/[locale]/...`)                                                              | Page                                 | Access | New |
| ------------------------------------------------------------------------------------ | ------------------------------------ | ------ | --- |
| `` (home)                                                                            | Home                                 | public |     |
| `services`, `services/[code]`                                                        | Service list (`?group=`), detail     | public | yes |
| `account/book` (`?service=<code>`)                                                   | Booking flow, services preselectable | member |     |
| `account/login`, `register`, `forgot-password`                                       | Member auth, in site chrome          | public |     |
| `account`, `bookings`, `bookings/[id]`, `invoices`, `invoices/[id]`, `notifications` | Member area                          | member |     |

Same slugs in VI and EN (existing routes are English; one `hreflang` pair per page, Q-P2-7). Every "Đặt lịch" CTA links to
`account/book`; a visitor without a session is sent to `account/login?next=...` with the chosen service kept.

### 3.3 Navigation registry

One typed list in `apps/web` (`siteNav`): `{ key, labelKey, href, show(session), phoneTab? }`, used by the header, the phone tab bar
and the footer. Header (desktop): Trang chủ, Dịch vụ, Đặt lịch + language, theme, account menu, CTA "Đặt lịch ngay" (hidden on the
booking page itself). Account menu: signed out = Đăng nhập, Đăng ký; signed in = Lịch hẹn, Hóa đơn, Thông báo, Đăng xuất.
Phones (< 1024 px): header = wordmark, language, theme, account; a **5-tab bar** (Trang chủ, Dịch vụ, Đặt lịch, Lịch hẹn, Tài khoản;
44 px+, safe-area padding, current page marked) replaces the drawer. The bar is hidden inside the booking flow, where the
action bar takes the bottom edge. Adding Cosmetics later = one registry entry + route + i18n; the phone bar stays at five tabs
(Cosmetics then goes to the account menu or replaces a tab; decided with that phase).

## 4. Visual language

- **Colour and surfaces:** existing tokens only. Page bands alternate `--ls-bg-page` and `--ls-bg-surface`; one `Card` surface, nothing
  bordered inside a card (a card on a surface band takes the page colour and no shadow). Hover = the Owner's solid brand fill rule.
  Brand `#782b37` in light, the existing pink brand in dark; no gold; status colours unchanged.
- **Type:** Be Vietnam Pro for text. **Playfair Display (already loaded, Vietnamese subset) for h1-h3 on public and member pages
  only** (admin stays sans). Load weights 500 and 600 (today only 400). Q-P2-5.
- **5.2 token additions (the only ones, additive, customer scope):** `--ls-text-3xl` (clamp 1.75-2.5 rem, section titles),
  `--ls-text-display` (clamp 2-3.5 rem, the single hero h1), plus the motion tokens of section 7. The fixed admin scale is unchanged.
- **Spacing and targets:** 4-based tokens; band padding 48 px (phone and desktop), gaps 8/16/24/32/48; content max width
  `--ls-content-max`; **44 px targets on phones**, 40 px desktop.
- **Text on photos:** never directly on the image; always on a surface-token panel (the slide caption). Contrast therefore holds for
  any photo the Owner uploads and in both themes.
- **Images:** every `img` has explicit size or aspect ratio (no layout shift), `alt` empty when decorative; slide images come from the
  media variants API; the hero image is the LCP element and is never lazy.
- **Seasons:** decorations stay in the page background and frame slots; the hero copy and captions sit on page/surface tokens
  above them. A visual check with one season on and off is part of the home Step gate.

## 5. Page specs

### 5.1 Chrome

Header 64 px, sticky, surface background, 1 px bottom border, shadow token after scroll. Footer: wordmark + tagline, Liên hệ
(address, hotline as `tel:`, hours summary), Khám phá, Tài khoản, base line "© 2026 Lucy Spa · Đà Nẵng". All text from shop info.
Skip link, labelled landmarks (banner, `nav` x2 with distinct names, main, contentinfo), one h1 per page.

### 5.2 Home (mockup `home.html`)

1. **Hero** (band page): eyebrow "Spa · Đà Nẵng", h1 = tagline (display), one factual sentence, CTAs "Đặt lịch ngay" (primary) and "Xem dịch vụ".
   Right: the Slider (existing component and endpoint). Zero visible slides = the fallback image of shop info, or the brand panel.
2. **Facts strip** (surface): hours today-aware text, address, hotline. Real data, one line each.
3. **Nhóm dịch vụ**: one card per live group (4-up desktop, 2-up tablet, 1 phone): name, "n dịch vụ", first 3 services with price, "Xem tất cả" to `services?group=`.
4. **Ghé thăm** : hours card (grouped equal days; closed days shown) and address card with hotline, "Đặt lịch ngay" and "Chỉ đường"
   (link to the map URL, or a maps search link built from the address; no embedded map, no third-party script, Q-P2-9).
   There is **no "Vì sao chọn LUCY SPA" section** (Owner, Q-P2-3: the reference's claims are not real).
5. Footer. The promotional Popup keeps its once-per-session behaviour. States: services loading = skeleton cards; load error = the section shows a
   retry notice and the rest of the page still renders; empty catalogue = section omitted.

### 5.3 Services list and detail

List: `PublicPage` (h1 "Dịch vụ"), group filter as `SegmentedControl`/tabs bound to `?group=` (default "Tất cả"), service cards (name,
estimate, price, "Đặt lịch" -> `account/book?service=code`). More than 20 services still lists by group, so no table is needed;
cards are one surface each. Detail: h1 name, group, description (VI/EN, may be empty), price and estimate, "Đặt lịch", and the other
services of the group. No photos (the catalogue has none; Q-P2-6). Unknown or inactive code = real 404.

### 5.4 Auth pages

Centered card (max 26 rem) on the warm band under the shared header (not the red staff panel): wordmark, h1, intro, form, and a
`SegmentedControl` that links Đăng nhập and Đăng ký (route based). Forgot password is the same card. Password fields get show/hide;
"Quên mật khẩu?" at the end of the password label row; errors use the existing field and notice components; `next` is honoured
(same-origin paths only). Behaviour, validation and API calls stay as they are.

### 5.5 Booking (mockup `booking.html`)

Business rules and API are unchanged. The six internal views become **four visible steps** and a sticky summary:

| Step               | Contains (today's views)                                                               |
| ------------------ | -------------------------------------------------------------------------------------- |
| 1 Chọn dịch vụ     | branch (shown only when more than one active branch exists, otherwise auto) + services |
| 2 Khách            | people: "Tôi" default; add child, family or other with the existing relation rules     |
| 3 Nhân viên và giờ | staff per person ("Bất kỳ" default) + date + free times                                |
| 4 Xác nhận         | review, price note, submit                                                             |

Layout: desktop = list + sticky summary card (selected services, estimate, total, "Tiếp tục"); phone = list + sticky action bar
(count, estimate, total, "Tiếp tục"). Service rows are `ChoiceCard` (kit, native checkbox inside, selected = brand border + soft fill;
44 px+). Per-nail services show their per-nail range and the note that the count is settled at the shop (the booking has no
quantity today); the total is the sum of fixed prices plus "+ giá theo ngón". Slot, staff and branch pickers are `RadioGroup`
(no native fieldset); sections use `FormSection`. Step 1 reads the preselected `?service` codes. "Quay lại" is secondary, "Tiếp tục" and
"Đặt lịch" primary and last (FR). Errors and the slot-taken retry flow keep their current codes and messages.

### 5.6 Member area

Header and footer as everywhere; page = `Page` + `PageHeader` (one h1, one primary action) and, for the account section, a tab row
(Tổng quan, Lịch hẹn, Hóa đơn, Thông báo). **Overview:** greeting h1 + "Đặt lịch mới"; "Lịch hẹn sắp tới" (up to 3, link to all);
"Thông tin cá nhân" as `DescriptionList` (read-only from `/auth/me`; profile editing needs API and policy, out of scope). **Bookings
and invoices:** `DataTable` + `Pagination` (20/page), phone card mode; **detail:** `DescriptionList`, line list, status `Badge`.
**Cancel booking:** a quiet "Hủy lịch hẹn" in the header actions opens `ConfirmDialog` (danger tone, `reasonField`); this retires the
last solid danger button. Notifications reuse the shared inbox component.

## 6. Data and API (additive; staff API untouched)

### 6.1 Shop info

Table `website_shop_info` (single row, enforced by a fixed key): `tagline_vi`, `tagline_en`, `address` (<= 300), `hotline` (display
text, digits derived for `tel:`), `map_url` (nullable, https only), `hours_branch_id` (nullable FK `branches`; null = first active
branch), `hero_media_id` (nullable FK `media_assets`), `row_version`, audit stamps. Migration inserts the row with the Owner's values. Admin
`GET/POST /api/v1/website/shop-info` under `MANAGE_WEBSITE_CONTENT` (existing permission, no `db:permissions:sync` change),
row-version conflict, audit event, same conventions as popups. Alternative: columns on `branches` (Q-P2-1).

### 6.2 Public read endpoints (anonymous, cache 60 s, `Vary: Accept-Encoding`, no cookie)

- `GET /api/v1/public/site?locale=` -> tagline, address, hotline, map URL, hero image variants, `timezone`, grouped hours
  (`[{ weekdays, opensAt, closesAt }]`, closed days listed).
- `GET /api/v1/public/services?locale=` -> groups with services `{ code, name, description, priceMinVnd, priceMaxVnd, pricingUnit,
estimatedMinMinutes, estimatedMaxMinutes }`; `GET /api/v1/public/services/:code`. Inactive categories/services and services
  with no active branch availability are absent; no ids of internal tables beyond `code`; `durationMinutes` never serialised.
- Web fetches server-side (60 s revalidate, failure = section-level notice), as the season does. Contracts in `packages/contracts`.

### 6.3 Admin "Shop info" tab (Website group)

`FormSection`s: Texts (tagline VI/EN), Contact (address, hotline, map URL), Hero image (media picker, "none" allowed), Hours
(read-only preview from the branch + link "Sửa giờ mở cửa"). Footer + "Ghé thăm" preview below the form, saved with one primary
"Lưu". Same frame rules as Popups.

## 7. Motion system (PRD 4.4; customer side only)

One cohesive, restrained system defined once as tokens and a few components; the staff area never loads them (scope class
`.ls-site`; a test checks admin CSS does not reference them).

| Token (additive)      | Value                          | Use                             |
| --------------------- | ------------------------------ | ------------------------------- |
| `--ls-dur-reveal`     | 480 ms                         | content reveal                  |
| `--ls-dur-zoom`       | 400 ms                         | photo hover scale               |
| `--ls-ease-premium`   | cubic-bezier(0.22, 1, 0.36, 1) | all customer-side entrances     |
| `--ls-reveal-shift`   | `var(--ls-space-4)`            | reveal translate distance       |
| `--ls-stagger`        | 60 ms                          | child delay, at most 6 children |
| `--ls-parallax-shift` | `var(--ls-space-6)`            | hero image maximum travel       |

Patterns: **M1 reveal** (`Reveal` kit component: opacity + small translate once when entering view, `IntersectionObserver`, no
scroll listener; everything is visible without JS and above the fold never starts hidden, so LCP and no-JS are safe). **M2 hero**:
no entrance animation on text; slider crossfade (existing) and a transform-only image settle. **M3 hover**: card shadow/border
step, photo scale 1.03, arrow nudge 4 px, existing solid-brand hover. **M4 header**: shadow after scroll (sentinel observer). **M5 route**: the
existing `RouteFade` (opacity only) on the public and member layouts. **M6 parallax**: hero image only, CSS scroll-driven
(`animation-timeline: view()` inside `@supports`, >= 1024 px, fine pointer), max `--ls-parallax-shift`. **M7 booking micro**: tick
scale-in, action bar slides up when the first service is chosen, step bar fill. Transform and opacity only.

Rules: no literal durations (the existing token test is extended); all zero or off under `prefers-reduced-motion` (components check
it, not only the global reset); reveal and parallax also off for `saveData` and low memory (`deviceMemory` <= 2); no motion library;
no scroll-jacking, horizontal scroll sections, autoplay video, cursor effects, text parallax or layout-property animation; the only
repeating animations stay the slider (with its pause control), skeleton pulse and season particles (own switch). Budget checked in the
final gate on a throttled mobile profile: CLS 0, LCP <= 2.5 s, no new JS beyond the `Reveal` and header-sentinel code (a few KB).

## 8. Retiring the Part 2 ratchet items (all four counters to 0)

| Counter (now)          | Where                                                                                           | Replacement                                                                                                                                         | Step    |
| ---------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `wfClassUses` 80       | book 27, bookings 23, invoices 11, auth 8, session 5, shell 3, workforce/ui 2, account layout 1 | kit components + a site layout stylesheet on tokens; `customer.css` legacy block and `cu-*` deleted; customer screens stop importing `workforce/ui` | P2-6..8 |
| `nativeFieldsets` 4    | `book.tsx` (branch, services, times, person)                                                    | `RadioGroup` / `FormSection`                                                                                                                        | P2-7    |
| `nativeCheckboxes` 1   | `book.tsx` service picker                                                                       | `ChoiceCard` (native input lives inside `packages/ui`)                                                                                              | P2-7    |
| `solidDangerButtons` 1 | `bookings.tsx` cancel                                                                           | `ConfirmDialog` danger tone with `reasonField`                                                                                                      | P2-8    |

New ratchet counters (start at 0, never rise): `cuClassUses`, and spacing literals in the new site stylesheet.

## 9. Quality gate adjustments

FR1-FR15 and the UX gate (CLAUDE.md) apply in full. Adaptations: public pages use `PublicPage`/`Band` (container, one h1) instead of
`Page`/`PageHeader`; hero CTAs are exempt from "one primary action in the header". Renders per page: 360, 768, 1440 light plus 1440 dark
**and 360 dark** (public pages are phone-first), plus home with a season on and off. axe 0 violations, DOM audit no count rising, 44 px
targets. Both themes read from tokens only (no hex, no spacing literals).
Public pages (home, services, service detail) are indexable with metadata, sitemap and LocalBusiness data (Q-P2-4, Owner: site not
launched yet); account, auth and staff pages stay `noindex` always.

## 10. Owner decisions (ALL LOCKED, answered 2026-10-03; do not reopen)

Owner answers: **Q-P2-1 agreed** (`website_shop_info`, editable in admin). **Q-P2-2 = A**, no guest booking. **Q-P2-3: the "Vì sao chọn LUCY
SPA" section is removed entirely** (its claims are not real; no replacement). **Q-P2-4 = yes**: remove `noindex` and add SEO data now (site not
launched). **Q-P2-5 to Q-P2-11: follow the recommendations** (the table shows what was recommended; Q-P2-10 English copy and Q-P2-11
placeholder photo are approved as proposed).

| ID      | Question                                                                                                                                                     | Recommendation                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Q-P2-1  | Where does shop info live: one `website_shop_info` row + hours from a chosen branch (A), or address/phone columns on `branches` (B)?                         | **A**: one place for the Owner, tagline needs it anyway; B can follow with multiple branches |
| Q-P2-2  | Booking without an account (reference has a guest step)? No such policy exists today                                                                         | **No**: keep sign-in required; the CTA keeps the chosen service through login                |
| Q-P2-3  | "Vì sao chọn LUCY SPA": ship the 3 product facts now, add brand claims when you supply text                                                                  | **Owner: remove the section entirely**                                                       |
| Q-P2-4  | Remove `noindex` and add metadata/sitemap/LocalBusiness data for home, services, detail (account stays noindex)                                              | **Owner: yes, now** (P2-9)                                                                   |
| Q-P2-5  | Playfair Display 500/600 for h1-h3 on public and member pages only                                                                                           | **Yes**                                                                                      |
| Q-P2-6  | Service photos: none now (no field, no policy); detail pages are text                                                                                        | **Yes**; images are a later, separate item                                                   |
| Q-P2-7  | Same English slugs in VI and EN (`services`, `account/book`), not Vietnamese slugs                                                                           | **Yes**                                                                                      |
| Q-P2-8  | Order of services inside a group: price ascending then name (no per-service order exists)                                                                    | **Yes**; a manual order is a later, small Step                                               |
| Q-P2-9  | "Chỉ đường" = a link (your map URL or a maps search), no embedded map or third-party script                                                                  | **Yes**                                                                                      |
| Q-P2-10 | English tagline proposal: "Heartfelt Relaxation – Elevated Beauty"; EN copy of all new text is a proposal for your edit                                      | approve or edit                                                                              |
| Q-P2-11 | The Lovable hero photo (one image is available) imported to the media library titled "PLACEHOLDER - replace with a real shop photo", chosen as hero fallback | **Yes**, until real photos exist                                                             |

## 11. Risks

| Risk                                                            | Mitigation                                                                                          |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Booking regroup (6 views to 4) breaks the availability queries  | state machine and API untouched; existing `booking.test.tsx` stays green; new tests per merged step |
| Public catalogue leaks internal data (duration, inactive items) | explicit serializer, integration test asserts absent fields and hidden rows                         |
| Motion hurts LCP/CLS or low-end phones                          | rules in 7, no hidden above-the-fold content, measured in the final gate                            |
| Season art collides with the new hero                           | frame slots unchanged; home gate renders a season on and off                                        |
| Empty/odd catalogue (one group with one service)                | cards and sections are built for 1..n; mockup already shows a 1-service group                       |
| Two sources for hours drift                                     | hours are read from `branch_operating_hours` only; shop info stores a pointer, not hours            |
