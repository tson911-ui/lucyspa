# Phase 8 P8-4: export engine (Wave A)

Design: `docs/PHASE8_REPORTS.md` section 6, P8-T9, Owner answer OQ-P8-6 (section 13). Not deployed.

## What changed

- **`packages/server/src/report-export.ts` (pure):** `toCsv` (UTF-8 with BOM, comma, CRLF, quotes doubled, dates ISO, money plain, a text cell that
  starts with `= + - @ TAB CR` gets an apostrophe; a `+84…` phone number is left exactly as it is) and `toXlsx` (a minimal SpreadsheetML workbook
  written as a stream over `fflate`, **no new dependency**: text is always an inline string and never a formula, money is a number with `#,##0`,
  dates are real dates, percent is a fraction with `0.00%`, bold frozen filterable header, sheet names made safe and unique, integers beyond 2^53
  stay text). Checked with the product-import reader **and with openpyxl** (an independent reader) on a sample workbook.
- **`POST /api/v1/reports/export`** (`ReportExportService`): body `{report, format xlsx|csv, from, to, branchId, bucket, compare, locale vi|en}`.
  Two transactions: (1) read the report in its read-only snapshot, scope = branches where **`EXPORT_REPORTS` and the report's permissions both
  hold**, row cap 100,000 (`REPORT_TOO_MANY_ROWS`), build the bytes; (2) one command transaction that decides the permission again, **spends a fresh
  password confirmation for pay/profit reports** (`REPORT_EXPORT`, one confirmation per file) and writes the audit row `REPORT_EXPORTED` (who, report,
  format, period, branches, rows, bytes; classification FINANCIAL / EMPLOYEE_PAY / STANDARD by area). If (2) fails no file is returned. At most 2 files
  at a time per person (`EXPORT_BUSY`). Response: download, `Cache-Control: no-store`, `nosniff`, `X-Report-Rows`.
- **Built exports (Wave A):** revenue over time, by branch, by group and kind, by payment method, refunds and corrections. xlsx has a second
  sheet "Thông tin" (period, branches, who, when, rows, and the definition of revenue); csv is pure data. Headers in Vietnamese or English.
- `revenue.core.ts` now exposes `revenueData` (report + facts) so exports use the very numbers of the screen.
- Customer phone numbers: none in the Wave A reports; the rule (full number, Owner OQ-P8-6) is in the writer's tests for later reports.

## Decisions to note

- The export is a **POST** (not a GET): it writes an audit row and may spend a password confirmation, so it needs the CSRF guard. Every report read
  stays a GET. This refines "all routes are GET" in the design (P8-T1) with the one exception the design itself names (the audit row).
- Signing in counts as a fresh confirmation, so the first pay/profit file after a login needs no extra prompt; the next one does.

## Tests (green)

- `report-export.test.ts` (6): CSV format and escaping, formula neutralisation, xlsx round trip through the reader, XML specials and control
  characters, 40,000 rows streamed, multi-sheet names, empty cases.
- `reports.http.test.ts`: GETs carry session and query as given; the POST needs Origin and CSRF; only the contract's fields; download headers; no
  other write verb.
- `export.integration.test.ts` (9 tests): authority (including `EXPORT_REPORTS` at one branch while VIEW_REVENUE is everywhere), the file equals the
  screen, one audit row naming actor/report/rows, English labels, formula-looking refund reason neutralised in csv and kept as text in xlsx, row cap
  writes no audit row, validation, the password rule (definition flag tried on refunds), the two-at-a-time limit.

## Open questions

None for the Owner.
