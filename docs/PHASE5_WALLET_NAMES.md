# Wallet names and the Beauty card (Owner instruction, 2026-10-05)

## What changed

- **Names:** "Điểm Spa" → "Điểm Lucy Spa", "Điểm Beauty" → "Điểm Lucy Beauty"; EN "Lucy Spa points" / "Lucy Beauty points".
- **One place:** `apps/web/src/i18n/loyalty.ts` holds `walletNames` (labels) and `walletInline` (the same name inside a sentence, exported as
  `loyaltyWalletInline`). Customer page, admin profile, points history, adjustment form, exceptions, the admin intro, the "no tier"
  reason and the referral wording all read them. The customer referral hint now uses `{spa}` / `{beauty}` placeholders:
  "+10 điểm Lucy Spa và +10 điểm Lucy Beauty".
- **Beauty card** (customer page): the same "Ưu đãi hội viên" row as the Spa card. Value until Phase 6: "Áp dụng khi Lucy Beauty mở bán" /
  "Applies when Lucy Beauty opens", no %. Key `points.beautyDiscountPending` in `i18n/customer-loyalty.ts`.
- **Phase 6 must replace** that text with the real Beauty tier % (recorded in design 15.3 and in the key's comment).
- Comments in `customer-loyalty.controller.ts` and `contracts/referral.ts` use the new names. No API behavior, no migration, no permission.

## Tests

- `apps/web/src/lib/workforce/loyalty.test.tsx` + `lib/customer/loyalty.test.tsx`: 19 pass (new test pins both languages, the referral wording
  and that no "Spa points" / "điểm Spa" text without "Lucy" is left in the dictionary).
- `pnpm typecheck` in `apps/web`: clean. Wallet names are also pinned for the admin screens through the shared dictionary.

## UX gate

Rendered on the P5-8 review scratch DB (go-live ON), 360/768/1440 light and dark, VI and EN, customers An (Platinum + Beauty 70), Chi (empty).
Opened: An 1440 light and dark, An 768 light, An 360 light, Chi 360 dark, An EN 360 and 1440. Checked: both cards equal height at 768/1440 and
the same rows at 360; the Beauty value fits on one line at 360; names read "Điểm Lucy Spa" / "Điểm Lucy Beauty"; no horizontal scroll. DOM audit
script: 0 findings on every capture (the real-app audit baseline holds no member page).

## Open questions

None.
