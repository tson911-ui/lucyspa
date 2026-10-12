import type { ReportBranchRef, ReportPeriod } from './reports.js';

/**
 * Phase 8 P8-16 (docs/PHASE8_REPORTS.md 4.9, Owner OQ-P8-7 of 2026-10-12): customer reviews. A customer with an account may give 1 to 5 stars and a
 * short note for a paid invoice of theirs, and may rate each person who served on it, or skip it. PRIVATE: used inside only, never published on the
 * site and not shown to the people rated (the Owner decides that later). Written once, never changed or deleted.
 */
export const REVIEW_MAX_COMMENT = 1000;
/** A person or a branch with fewer ratings than this is "chưa đủ đánh giá" instead of an average. */
export const REVIEW_MIN_RATINGS = 5;

export interface ReviewStaffMember {
  employeeUserId: string;
  /** The name the customer knows the person by. */
  name: string;
}

export interface CustomerReviewView {
  rating: number;
  comment: string | null;
  createdAt: string;
  staff: { name: string; rating: number }[];
}

/** GET /api/v1/me/reviews/invoices/:invoiceId: what the invoice page needs to offer (or show) a review. */
export interface CustomerReviewPrompt {
  invoiceId: string;
  /** False when the invoice is not paid (nothing to review yet). */
  canReview: boolean;
  /** The review already given, when there is one (then there is nothing to offer). */
  review: CustomerReviewView | null;
  /** The people who performed a service on the invoice, to rate one by one. */
  staff: ReviewStaffMember[];
}

/** POST /api/v1/me/reviews */
export interface CustomerReviewRequest {
  invoiceId: string;
  rating: number;
  comment: string | null;
  staff: { employeeUserId: string; rating: number }[];
}

export interface RatingSummary {
  count: number;
  /** Average in hundredths (4.25 stars = 425); null when nothing was rated. */
  averageHundredths: number | null;
  /** How many gave 1, 2, 3, 4 and 5 stars. */
  distribution: [number, number, number, number, number];
  /** At least `REVIEW_MIN_RATINGS` ratings: only then is the average a figure to rely on. */
  enough: boolean;
}

export interface ReviewBranchRow extends RatingSummary {
  branch: ReportBranchRef;
}

export interface ReviewStaffRow extends RatingSummary {
  userId: string;
  name: string;
  employeeCode: string | null;
}

export interface ReviewsReport {
  generatedAt: string;
  period: ReportPeriod;
  branches: ReportBranchRef[];
  totals: RatingSummary;
  byBranch: ReviewBranchRow[];
  staff: ReviewStaffRow[];
  /** Invoices of customers with an account that were paid in the period, and the share of them that was reviewed (basis points). */
  paidInvoices: number;
  responseBp: number;
}
