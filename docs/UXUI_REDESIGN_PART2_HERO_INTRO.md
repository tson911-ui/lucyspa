# Part 2 follow-up: editable home introduction sentence

The sentence under the home headline ("Chọn dịch vụ, chọn giờ còn trống và giữ chỗ trực tuyến trong vài phút." and its English twin) is now edited in Admin > Website > Shop info.

## What changed

- **Admin:** a new section "Câu giới thiệu trang chủ" with two optional text areas (Vietnamese, English), up to 200 characters each, between the tagline and the contact section. The preview shows what a visitor sees, including the fallback.
- **Fallback:** an empty field means "not set". The site then shows its built-in sentence in the visitor's language. The API never sends the other language's sentence (a Vietnamese sentence is never shown to an English visitor). The web also falls back when the shop profile cannot be read, so `pnpm smoke` (no API behind the web) still sees the built-in Vietnamese sentence.
- **Where it shows:** the home hero paragraph and the home page meta description (Open Graph/search snippet).
- **API:** `introVi` / `introEn` on `POST/GET /api/v1/website/shop-info` (`string | null`, empty or blank becomes null, whitespace normalized, over 200 characters is `VALIDATION_FAILED` naming the field); `intro` (`string | null`) on `GET /api/v1/public/site`. The web parser accepts an API that does not send `intro` yet (a restart in progress).

## Database: one additive migration

`20261024000000_uxui_part2_hero_intro`: two nullable columns `intro_vi`, `intro_en` on `website_shop_info` plus a CHECK (NULL or 1 to 200 characters). No data change, no permission change, no new environment variable. **Run `db:deploy` before restarting the API and the web** (the new API selects the columns). Rollback: redeploy the previous commit; the columns can stay.

## Tests and results

- Unit: API core (parse, limits, normalization), HTTP strictness, web form helpers, the public-site parser, the home page markup (typed sentence, fallback, per language).
- Integration on the throw-away database: shop info service 9/9 (new subtest: per language, never borrowed, 201 characters refused, clearing), database foundation (new constraint).
- Real app (scratch database): typed Vietnamese sentence shows on `/vi`, the empty English field falls back on `/en`, 201 characters is refused, clearing restores the built-in text (the public data is cached for 60 s). The Shop info tab renders at 360/768/1440 with 0 DOM audit findings.
- `pnpm format:check`, `pnpm lint`, `pnpm check`, `pnpm smoke` pass.
