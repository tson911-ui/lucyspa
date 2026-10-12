# Phase 8 P8-5: revenue and refunds screens, dashboard widget (Wave A)

Design: `docs/PHASE8_REPORTS.md` 4.1-4.2, 5, 6 (Owner answers section 13, OQ-P8-2 for the dashboard). Not deployed. UI only: no API or data change.

## What changed

- **`/workforce/reports/revenue`** ("Doanh thu"): one h1, one primary action "Xuất file" (only for a person with `EXPORT_REPORTS`), a toolbar (period
  picker, branch, comparison, grouping, reload), six figures (revenue, collected, given back, paid invoices with the average, lượt đến, collected-not-delivered)
  with the change against the previous period in words, the line chart (previous period dashed, "view as table"), and three tabs: branches, group and
  kind (donut + table), payment method. The definition of revenue is printed on the page. Everything is ONE answer of `GET /reports/revenue`.
- **`/workforce/reports/refunds`** ("Hoàn tiền"): date and branch filters, 20 a page, failed-delivery refunds flagged, the three totals and open PayOS anomalies.
- **Export dialog** (shared): content, Excel / CSV (server file, password again for pay and profit data) or PDF (the browser print dialog; print styles hide the app,
  show period and branches). **Dashboard:** the "Hóa đơn đã thanh toán" money widget is replaced by "Doanh thu" (today against yesterday, 7 days, optional comparison,
  paid-invoice count and money held as a second line); the dead `paid-invoices` helper and its test are removed. Nav group "Báo cáo" (Doanh thu, Hoàn tiền).
- `ApiClient.postFile` (CSRF, one retry, file + name + row count). KPI numbers step down the type scale on a narrow card instead of splitting their digits (kit CSS).

## Tests (green)

Web 985 (new: reports lib, screen markup incl. permission gating and the figures, `postFile`, nav and dashboard layout updated), UI 489, lint, typecheck, format.

## UX gate (docs/UXUI_REDESIGN_DESIGN.md 21; screenshots in `.local/uxui-screens/`, all opened and reviewed)

1. Rendered at 360 / 768 / 1440 light and 1440 dark for revenue (overview, comparison, kind tab, method tab, empty period, export dialog), refunds (data, empty) and the dashboard,
   plus 130% text at 360 and 1440. Checked: spacing and alignment, one primary action, no heading with a number, tables one surface, 44/40 px targets, dark tokens, long amounts.
2. Fixed after review: comparison wording ("so với kỳ trước"), toolbar selects instead of a wrapping segmented control, the donut total overflowing its hole, duplicate table
   headers, "PDF" label wrapping, a note that the first and last week/month may be incomplete, KPI digits splitting at 130% text, a nav label wrapping at 768.
3. DOM audit (real app, scratch DB with the 164k-invoice fixture): refunds 0 findings; revenue 7, all kit-level patterns already on the dashboard baseline (chart "view as table" row, card
   vs notice surface). Baseline pages: dashboard 9 → 10 only because this DB has three branches (a select beside a button) after the new quick links; the wrapped label I caused is fixed.
4. Not fixable here: the KPI row 2 cards differ in height when only one has a caption; left as the kit renders them.
5. Before/after for the Owner: the replaced money widget is the only change to an existing screen.

## Open questions

None for the Owner.
