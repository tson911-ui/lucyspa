# Step 6, area "admin-c": evidence (session 10)

Worker: admin-c (products and stock). Plan: `docs/redesign-s10/plans/fd-plan-admin-a.md` (PATTERN-LIST/DETAIL/FORM + the 15 page
blocks). Owner answer 5 binds: product-new is its own page (it already was; "Thêm sản phẩm" is now a real link to it); every other big
layout change of the plan is **dropped** and listed per page. Owner answer 7: names wrap, nothing truncated.

Skills (loaded at the start): frontend-design (pattern + tells), web-design-guidelines (rules fetched fresh from the vercel-labs URL
with WebFetch on 2026-10-16, summary only; the full 17-section list read from `.local/s10/wig-command.md`, same source), react-best-
practices (rules applied: rerender-derived-state-no-effect, rerender-dependencies, rerender-memo, js-set-map-lookups,
js-cache-function-results, rerender-no-inline-components), react-view-transitions (`references/implementation.md` read).
Conflict noted: the plan puts the status badge "beside the h1"; the Owner rule "headings are text only" wins, so it is the kit
`PageHeader` `status` slot under the h1 (product-detail, campaign-detail, rewrite-detail, inventory-item, inventory-receipt).

View-transition decision (all 15 pages): staff 120 ms route fade only (kit `--ls-dur-route`). No ViewTransition, no GSAP, no shared
element; tables, totals, receipt lines and typing are never animated; an added or restored receipt line appears without animation.

Pattern used: compact (DESIGN 10) everywhere. List: products, product-campaigns, product-rewrites, product-text-cleanup,
shipping-carriers, inventory (4 tabs). Detail: product-detail, product-campaign-detail, product-rewrite-detail, inventory-item,
inventory-receipt. Form page: product-new, inventory-receipt-new, inventory-receipt-edit, online-sales.

## Shared work

- New `apps/web/src/components/workforce/screens/products-links.tsx`: `RouterMenuLink` (kit `MenuLinkComponent` = staff
  `PrefetchLink`, so a row `⋮` "Chi tiết/Mở" item is a real link that navigates client-side), `RouterButtonLink` (kit `buttonClass` on
  `PrefetchLink`; the kit `ButtonLink` is a plain `<a>` that would reload the shell), `focusInvalidSoon` (first `aria-invalid` field after a
  refused submit, in the form or the topmost dialog), `useLeaveGuard` (kit `useUnsavedChangesGuard` + "Bỏ thay đổi?" confirm on
  Cancel, same words as the kit overlays), `scrollToSection` (smooth only when motion is allowed: `motionAllowed(readMotionEnvironment())`).
- `packages/ui/src/s10-admin-c.css` (classes used only by these screens): `.ls-adm-c-name` (wrapping name in custom cells, replaces
  `ls-cell-title`/`ls-cell-truncate` spans), `.ls-adm-c-url` (URL/e-mail breaks anywhere), `.ls-adm-c-nowrap` (phone), `.ls-adm-c-stack`
  - `.ls-adm-c-muted` (name / time on two lines), `.ls-adm-c-anchor` (scroll-margin-top below the top bar), `.ls-adm-c-count-link`
    (40 px target for a problem count), and an override of `.ls-policy-default-text` (only online-sales.tsx uses it; grep proof:
    `grep -rn ls-policy-default apps/web/src packages/ui/src` = online-sales.tsx + components.css). Tokens only; nothing removed from
    shared sheets.
- C58b / answer 7: every `truncate: true` in these screens is `wrap: true` (33 columns in 13 files); `title=` tooltip copies removed from
  name links (products.tsx, campaigns.tsx, ai-drafts.tsx, inventory-stock.tsx) and raw spans (product-text-cleanup.tsx:130-131,
  campaign-items.tsx:97-102, campaign-picker.tsx:169). Numeric columns keep `numeric: true` (right, nowrap, tabular in the kit).
- Middle-dot tell removed: lib `variantName` (lib/workforce/products.ts:656, used only by product-variants/product-history) and
  `productLine` (lib/workforce/campaigns.ts:334, used only by campaign-items/picker) now give "A (B)"; JSX joins through
  `metaLine`/`listFormat` from pos-format.ts (product-variants.tsx:156, campaign-detail.tsx:109, campaign-items.tsx:147,
  campaign-picker.tsx:485, ai-drafts.tsx:258, inventory-receipts.tsx:748-754); dictionary strings ai-drafts.ts runs.counts/cost.
  `variantOptionLabel` (lib/workforce/inventory.ts:424) keeps its dot because inventory-counts.tsx (POS) also uses it; receipts build
  their own label.
- Empty states: kit `EmptyState` with a title, one sentence and (on list pages) one next action: the header primary's destination as the
  outline, or "Xóa bộ lọc" when filters hide everything. Sections inside a detail page (variants, images, history, lots, groups) take a
  title + sentence; their one action is the section header button directly above (not repeated).
- Row menus: `href` + `RouterMenuLink` (products.tsx:200, campaigns.tsx:143, ai-drafts.tsx:336, inventory-stock.tsx:227,
  inventory-receipts.tsx:282).
- Inputs: `name` (+ `autoComplete="off"` where the control takes it) on 98 Field-wired controls in 20 files; `spellCheck={false}` on the carrier URL and the
  supplier e-mail; `type="url"` on the tracking template; codes/SKU/lot/receipt codes `translate="no"`.
- One filled button per view: online-sales master switch (online-sales.tsx:241), ai-runs unlock (ai-runs.tsx:116), ai-drafts bulk
  approve (ai-drafts.tsx:291) and rewrite-detail Apply while edits are unsaved (ai-draft-detail.tsx:353) are outlines.

## Per page

### products (list)

- Header: one primary "Thêm sản phẩm" as `RouterButtonLink` to /products/new (products.tsx:312); "Trang mỹ phẩm" and "Cài đặt" moved
  into one header `⋮` (`Menu`, products.tsx:160, :307), so the row no longer wraps at 1024. Brand/category tab primaries unchanged (dialogs).
- Name/brand/category `wrap` (no ellipsis, no tooltip); placeholder "Ví dụ: kem chống nắng…" (:240); empty + no-match `EmptyState`
  (:348-360); row "Chi tiết" is a link (:200). Taxonomy: codes `translate="no"`, counts via cached Intl (products-taxonomy.tsx:50, :96,
  :102, :364-377), names on inputs, focus first invalid (:152, :429).
- Kept: thumbnail column, tabs, toolbar. Dropped per answer 5: nothing beyond restyle was planned except the overflow (done).
- Baseline closed: wig products.tsx:230, :317; products-taxonomy.tsx:226, :190, :79, :80. Tells: three-button header with tinted fills.

### product-detail

- Status badge in the header slot (product-detail.tsx:107), removed from the facts list; primary "Đăng bán" on drafts unchanged;
  history jump honours reduced motion (:89) and lands below the top bar (`ls-adm-c-anchor`, :167).
- Variants: SKU `translate="no"`, pre-order badge via Intl list, money fields `MoneyInput` (list price, cost, new price, promotion price;
  product-variants.tsx:515, :529, :670, :759), empty state; images: preview alt falls back to the tile title (product-images.tsx:165);
  settings: the "to" field shows the range error when it is at fault (product-settings-dialog.tsx:80, :173).
- Dropped per answer 5: tabs Tổng quan/Biến thể/Giá/Hình ảnh and the 8/4 split. Closed in the follow-up below (was open): history tab + pages in `useState` (wig
  product-history.tsx:60), variants pages (product-variants.tsx:84): state refactors, not restyle.
- Baseline closed: wig product-detail.tsx:90, :167; product-images.tsx:162; product-variants.tsx:489, :409; product-settings-dialog.tsx:144,
  :154; product-page-drawer.tsx:171; product-fields.tsx:45.

### product-new (own page, answer 5)

- Unsaved guard + guarded Cancel (product-create.tsx:124, :171), first invalid field focused, bottom "Còn thiếu…" summary removed
  (errors stay inline). Kept: one Card, Cancel then "Tạo sản phẩm". Baseline closed: wig product-create.tsx:105, :120.

### product-campaigns

- Placeholder + clarified label (address = page address), `EmptyState` with "Tạo chiến dịch" outline (campaigns.tsx:201-223), row
  "Mở" is a link (:143), name link without tooltip. Baseline closed: wig campaigns.tsx:146, :171, :287; campaigns.ts:28.

### product-campaign-detail

- Header: status badge + period as one muted line (campaign-detail.tsx:109, :174); "Kết thúc chiến dịch" (destructive) moved from the
  primary slot into the header `⋮` with its confirmation (:119, :181); problem counts are 40 px links (:297). Items/picker: names wrap,
  SKU `translate="no"`, Intl list for notes, placeholders, empty states; groups empty state.
- Dropped per answer 5: 4-up Stat row instead of the review card. Baseline closed: wig campaign-detail.tsx:148; campaign-items.tsx:190;
  campaign-groups.tsx:270; campaign-info.tsx:149; campaign-display.tsx:178; campaign-picker.tsx:265. formatVnd findings
  (campaign-items.tsx:121, campaign-groups.tsx:205, campaign-picker.tsx:198, ai-drafts.tsx:273, ai-runs.tsx:96, inventory-*.tsx) closed by
  inspection: lib/workforce/format.ts `formatVnd`/`formatDate` are cached Intl formatters. Closed in the follow-up below (was open): picker price bounds use the label
  as placeholder (toolbar controls carry no label above, FR rule) and MoneyInput separators per locale (kit request).

### product-rewrites

- Toolbar count "{n} kết quả" (ai-drafts.tsx:406), empty state with "Chạy viết lại" outline (:408-420), no-run state is one line of
  guidance instead of a card holding a sentence (ai-runs.tsx:140), per-button pending (ai-runs.tsx:106), polling timer no longer torn down
  each render (ai-drafts.tsx:125-131). Baseline closed: wig ai-drafts.tsx:273, :339; ai-runs.tsx:110, :303; rbp ai-drafts.tsx:121-125.

### product-rewrite-detail (seeded draft)

- Status badge in the header (ai-draft-detail.tsx:333); mirror effect replaced by a derived copy (:89); polling deps (:107-112); named
  busy labels (:665, :737); empty state. Closed in the follow-up below (was open): language tab in `useState` (wig :208), server field error as page Notice (:373),
  read-only reference text as textareas (:414): behaviour/layout changes, left as they are.

### product-text-cleanup

- Intro cut to two short sentences; the process detail moved into the confirm body; typographic quotes; empty state with check icon,
  title, sentence and "Xem danh sách sản phẩm" (product-text-cleanup.tsx:186-192); drawer load error has "Tải lại" (:301); names wrap,
  code `translate="no"` (:130-131). Closed in the follow-up below (was open): page in `useState` (wig :82). Baseline closed: wig :288, products.ts/cleanup quotes.

### online-sales (settings form)

- Master switch button is the outline (the form's "Lưu thay đổi" is the one filled button, online-sales.tsx:241); on/off sentence is
  plain text, not a box in the card (:252); default policy drafts plain muted text (sheet override); number fields get their real names
  (`name={field}`, :214); mirror effect replaced (:89). Dropped per answer 5: ungrouping the cards, header switch, sticky footer.
  Closed in the follow-up below (was open): Save stays disabled while nothing changed (nothing to send). Baseline closed: wig online-sales.tsx:210; rbp :85-87.

### shipping-carriers

- Empty state (truck icon, title, sentence, "Thêm đơn vị" outline, shipping-carriers.tsx:215); template cell breaks anywhere,
  `translate="no"` (:205); URL field `type="url"` + `spellCheck={false}` (:381); mirror effect replaced (:84). The empty title/sentence
  live in online-sales.ts (`carriers`) because online-fulfilment.ts is the counter's file. Closed in the follow-up below (was open): paging via `useClientPaging`
  (wig :114). Baseline closed: wig :327, :347; rbp :76-78.

### inventory (tabs)

- "Tạo phiếu nhập" is a `RouterButtonLink` (inventory.tsx:132); "Cài đặt" stays the outline. Stock: names wrap, SKU `translate="no"`,
  row link, placeholder, empty states (inventory-stock.tsx:227-305). Receipts list: code `translate="no"`, row link, placeholder, empty
  states. Suppliers: phone nowrap, e-mail breaks + `translate="no"`, placeholder, `spellCheck={false}`, empty states
  (inventory-suppliers.tsx:93, :103, :187-201, :342). Baseline closed: wig inventory.tsx:134; inventory-stock.tsx:230, :252, :680;
  inventory-receipts.tsx:217, :239; inventory-suppliers.tsx:154, :267, :301.

### inventory-item

- **404 fixed (UI bug):** `GET /api/v1/inventory/branches/variants/<id>` came from `InventoryItemScreen`: `useUrlState` returns the
  server snapshot (no query) during hydration, so the first effect requested `/inventory/branches//variants/<id>` (collapsed by the
  server). The page now waits for the address bar (`useSyncExternalStore` hydration flag) and mounts the fetching `InventoryItemLoader`
  only with a branch (inventory-stock.tsx:354-380). No API change. Test: inventory.test.tsx (last test).
- Status badges in the header slot (:417), removed from the facts; history change through Intl `signDisplay` (−2, :554); lot/receipt
  codes `translate="no"`; empty states. Dropped per answer 5: 8/4 split. Closed in the follow-up below (was open): lots/history pages in `useState` (wig :448, :528).

### inventory-receipt

- Status badge in the header (kit PageHeader, inventory-receipts.tsx:385-418); "Người tạo/xác nhận/hủy" as name + muted time on two
  lines (`PersonAt`, :512) instead of "A · B"; "Sửa" is a link (:431); SKU/lot `translate="no"`; lines empty state.
  Baseline closed: wig inventory-receipts.tsx:361, :153 (Intl by inspection).

### inventory-receipt-new / inventory-receipt-edit

- C72: removing a line is undoable for 8 s from the toast ("Đã xóa dòng n." + "Hoàn tác", restored at its place; :743-760, kit toast
  action); unsaved guard + guarded Cancel (:787, :810); first invalid field focused (:804-807); variant options memoised with a Set
  (:743-754); item options without the dot. Edit of a confirmed receipt: `EmptyState` "Phiếu đã xác nhận, không sửa được" + "Xem phiếu
  {code}" link instead of a bare notice (:777).
- Kept: "Dòng n" blocks (a real sequence; the numbering is information), 40 px IconButton delete. Dropped per answer 5: the editable
  line table. Closed in the follow-up below (was open): per-line blocks not virtualised (wig :799). Baseline closed: wig :656, :697, :742, :810, :828, :907; rbp :679-688, :684.

## web-design-guidelines re-run (changed files)

Found and fixed during the re-run: online-sales.tsx:214 number fields all named "field" (my own name pass) -> `name={field}`;
rich-editor.tsx:110 / ai-draft-detail.tsx:590, :737 generic names "value" -> body/suggestion/reason; inventory-receipts.tsx:916 Combobox
rejects `autoComplete` (removed); media-picker.tsx describe step without a form; online-sales.tsx Save disabled while clean;
campaign-picker.tsx price-bound placeholder without an example. The items first left open (URL state, read-only textareas, receipt
virtualisation, server field error, media separators) are closed in the follow-up below. Final list for the touched files: 0.

## react-best-practices re-run (touched components)

Found and fixed: ai-runs.tsx:285 a new Intl.NumberFormat per call -> module cache (js-cache-function-results). Applied: derived state
instead of mirror effects (online-sales, shipping-carriers, ai-draft-detail), stable reload deps for polling (ai-drafts, ai-draft-detail),
memoised options + Set (inventory-receipts), module-level `PersonAt`/`RouterMenuLink`/`ReadOnlyText` (no inline components); follow-up: campaign-picker `PriceBound` mirror effect replaced by derived state, receipt lines `content-visibility: auto`. Final list: 0.

## Follow-up (coordinator, Step 6b): every open finding closed

- URL state (wig "URL reflects state"). New helper `urlPaging(pageKey, sizeKey)` in products-links.tsx (kit `useUrlState`; page and
  size normalised; the page resets when the size changes): variants `vpage`/`vsize` (product-variants.tsx), cleanup `page`/`pageSize`
  (product-text-cleanup.tsx), inventory-item lots `lpage`/`lsize` and movements `mpage`/`msize` (inventory-stock.tsx), receipt lines
  `lnpage`/`lnsize` (inventory-receipts.tsx), carriers `page`/`pageSize` plus the sort `dir` (shipping-carriers.tsx; replaces
  `useClientPaging` and `defaultSort`). Price history: `useHistoryUrl` (product-history.tsx) holds the SKU filter `hvariant`, the tab
  `htab` and both tables' pages `hprice`/`hpromo`/`hsize`; product-detail's "Xem lịch sử giá" writes `hvariant`. Back/Forward and a
  shared link restore the view.
- Rewrite detail: the language tab is `?lang=vi|en`. The product's current text and the suggested name are plain read-only text
  (`ReadOnlyText`, `.ls-adm-c-ref*`), not read-only textareas (no tab stop, read as text). A server refusal of a field
  (`descriptionVi`/`descriptionEn`) shows at that field, opens its language tab and takes focus; the page notice is only for a refusal
  that names no field.
- Long receipts: `.ls-adm-c-line` (`content-visibility: auto; contain-intrinsic-size: auto calc(var(--ls-space-10) * 5)`) on every
  line block (rbp rendering-content-visibility). A receipt holds tens of lines, not thousands, so no virtualiser is needed.
- MoneyInput: `locale={locale}` (kit Intl separator) in online-sales, campaign-groups, product-variants (4 fields), campaign-picker and
  inventory-receipts. The picker price bounds get placeholders with an example ("Từ 100.000…"), and their mirror effect is replaced
  by derived state.
- Media: `mediaMeta(asset, locale)` (lib/workforce/media.ts, used only by media-library and media-picker; its lib test updated) takes
  the decimal mark from Intl and reads "1,5 MB (1920 × 800)" (no middle dot). The lead's `searchPlaceholder` keys are used. The
  picker's describe step is a real form (Enter saves, the first invalid field is focused), and Back/Close ask before dropping a typed
  description.
- online-sales: Save is never disabled; with nothing changed it says "Chưa có thay đổi nào để lưu." (info toast) and sends nothing.
- The five detail pages keep importing the kit `PageHeader` directly (same result as the wrapper's new `status`).

## Kit requests made (docs/redesign-s10/kit-requests.md)

`ui.tsx` PageHeader `status` pass-through and `Empty` title/action; `MoneyInput` separator from Intl; media placeholders in
workforce.ts. The toolbar duplicate count is the POS request already filed (toolbar count kept as the search announcement).

## Tests

products.test.tsx (pre-order badge via Intl list, header status slot), campaigns.test.tsx (badge in header slot, End in the menu, no
middle dot), product-text-cleanup.test.tsx (one-line intro, no tooltip), shipping-carriers.test.tsx (empty state anatomy, one primary),
inventory.test.tsx (+ hydration test for the 404). All pass (see final message).
