# Phase 8 P8-16 and P8-17: customer reviews (Wave D)

Design: `docs/PHASE8_REPORTS.md` 4.9. Owner answer OQ-P8-7 (2026-10-12): YES, built last; private, never published. Not deployed.
**Customer-visible: the Owner must approve the before/after screenshots below before this goes live.**

## What changed

- **Migration 122 `20261211000000_phase8_customer_reviews`** (additive, two empty tables, no new permission: `VIEW_REVIEWS` came with P8-2):
  `customer_reviews` (one per invoice, rating 1-5, note up to 1,000 characters) and `customer_review_staff_ratings` (a rating per person who served). The rules are
  in the database: a review needs a PAID invoice of the customer who paid it, a person can be rated only if they performed a service on that invoice, nothing is
  ever changed or deleted.
- **Customer API** (`/api/v1/me/reviews`): `GET invoices/:id` (can it be reviewed, the review already given, the people who served) and `POST` (once). The session
  is the only identity; a foreign, unpaid-guest or made-up invoice is the same NOT_FOUND; errors `REVIEW_ALREADY_SUBMITTED`, `REVIEW_NOT_AVAILABLE`.
- **Customer page:** on a PAID invoice a card "Đánh giá của bạn" (first lines: private, never posted, can be skipped): 1-5 stars, an optional note, an optional
  rating of each person (a select that starts on "Bỏ qua"), "Để sau" and "Gửi đánh giá". After sending: "Cảm ơn bạn đã đánh giá" with what they said. If the card
  cannot load, the invoice page goes on without it. Kit: `SegmentedControl` no longer looks pre-selected when nothing is chosen; new `decimal` value format.
- **Staff report** `GET /reports/reviews` + page `/reports/reviews` "Đánh giá của khách" (VIEW_REVIEWS at the branch): count, average (two decimals), distribution per branch
  and per person, and the share of paid invoices of customers with an account that was reviewed. Fewer than 5 ratings = "Chưa đủ đánh giá", no average. Numbers only: no comments.
  Export `reviews` (csv/xlsx) behind EXPORT_REPORTS.

## Decisions I made inside the Owner's answer (please confirm)

1. The customer sees the **names of the people who served** in the form (needed to rate them one by one); the invoice page itself still shows no staff.
2. A review is **final**: no edit, no delete (the customer can skip; "Để sau" only hides the card for this visit). The note is **stored but not shown in any report** until the Owner decides.
3. **No time limit** to review a paid invoice, and online orders (paid through PayOS) can be reviewed too. The people rated cannot see their ratings (as the Owner said).

## Before / after for the Owner (screenshots, not in git: `.local/p8/owner-review/`)

- Before: `rv-before-1440-light.png` (the paid-invoice page as it is today). After: `rv-after-form-1440-light.png`, `rv-after-form-360-light.png`, `rv-after-form-1440-dark.png`,
  `rv-form-130-360-light.png` (130% text), and `rv-after-thanks-1440-light.png` (after sending).

## Tests and UX gate

- API: `reviews.integration.test.ts` (5: prompt, validation and one review per invoice, database guards, report numbers and scope, export), `customer-reviews.http.test.ts`.
- Web: card (form, no people, thanks, English), request logic, report screen (average only from 5 ratings). UI kit: segmented-control and decimal-format tests.
- Rendered the card at 360, 768, 1440 light, 1440 dark, 130% text and the report at 360, 768, 1440 light + dark; opened the before, form, thanks, 360, 130% and dark images and the report
  at 1440. Fixed from review: the first star looked pre-selected (kit), six segments per person wrapped on a phone (now a select).

## Open

- The three decisions above, and the Owner's approval of the card's look and words.
