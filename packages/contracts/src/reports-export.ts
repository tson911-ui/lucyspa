/**
 * Phase 8 P8-4 (docs/PHASE8_REPORTS.md section 6): taking a report out as a file. The only POST of the report area: it writes one audit
 * row (and, for pay and profit data, spends a fresh password confirmation), so it needs the CSRF guard that a GET does not have.
 *
 * Needs EXPORT_REPORTS at the same branches as the report's own permissions. The file holds exactly what the screen shows for the same
 * filters; customer phone numbers are in full (Owner, OQ-P8-6). At most 100,000 rows; at most 2 files at a time per person.
 */
export const REPORT_EXPORT_FORMATS = ['xlsx', 'csv'] as const;
export type ReportExportFormat = (typeof REPORT_EXPORT_FORMATS)[number];

export interface ReportExportRequest {
  /** One of the exportable report ids of `REPORT_DEFINITIONS`. */
  report: string;
  format: ReportExportFormat;
  /** Branch business dates, like the report screen. Reports that are not about a period ignore them. */
  from?: string;
  to?: string;
  /** Narrows the covered branches (never widens them). */
  branchId?: string;
  bucket?: string;
  compare?: string;
  /** Language of the column headers and labels in the file; the default is Vietnamese. */
  locale?: 'vi' | 'en';
}
