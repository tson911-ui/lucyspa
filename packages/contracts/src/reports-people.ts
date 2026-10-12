import type { ReportBranchRef, ReportBucket, ReportPeriod } from './reports.js';

/**
 * Phase 8 P8-8 (docs/PHASE8_REPORTS.md 4.3-4.4, Owner answers OQ-P8-3 and OQ-P8-4): customers, bookings, loyalty and staff.
 *
 * - A **lượt đến** is one completed visit (a group that comes together is one lượt đến); the people of a visit are counted separately.
 * - A person is an account, else a guest's canonical phone number. **Returning** = had a completed visit before the period (at any branch);
 *   **new** = the first completed visit is in the period. A guest with neither account nor phone is counted as unidentified, never guessed.
 * - Staff figures are facts about work, never a ranking and never a "good/bad" label; sales columns need VIEW_REVENUE and pay columns
 *   VIEW_EMPLOYEE_PAY at every covered branch, otherwise the column is left out (null), never zero-filled.
 * Money is integer VND carried as a decimal string.
 */

export interface PeopleReportBase {
  generatedAt: string;
  period: ReportPeriod;
  branches: ReportBranchRef[];
}

export interface VisitPoint {
  /** First day of the bucket. */
  start: string;
  visits: number;
  people: number;
  newPeople: number;
  returningPeople: number;
}

export interface CustomerVisitsReport extends PeopleReportBase {
  bucket: ReportBucket;
  series: VisitPoint[];
  totals: {
    /** Completed visits (lượt đến). */
    visits: number;
    bookedVisits: number;
    walkInVisits: number;
    /** Distinct identified people over the whole period, and how many of them are new or returning. */
    people: number;
    newPeople: number;
    returningPeople: number;
    /** People of a visit with neither an account nor a phone number. */
    unidentified: number;
  };
  byBranch: { branch: ReportBranchRef; visits: number; people: number }[];
}

export interface BookingPoint {
  start: string;
  bookings: number;
  checkedIn: number;
  cancelled: number;
  lateCancelled: number;
  noShow: number;
  /** Still confirmed: neither came, nor cancelled, nor marked no-show. */
  open: number;
}

export interface BookingFunnelReport extends PeopleReportBase {
  bucket: ReportBucket;
  series: BookingPoint[];
  totals: Omit<BookingPoint, 'start'>;
  /** Of the bookings that were not cancelled: how many came and how many did not, in basis points. */
  cameBp: number;
  noShowBp: number;
  byChannel: {
    channel: 'ONLINE' | 'DESK';
    bookings: number;
    checkedIn: number;
    cancelled: number;
    noShow: number;
  }[];
}

export interface LoyaltyPointsRow {
  wallet: 'SPA' | 'BEAUTY';
  kind: string;
  points: number;
  entries: number;
}

export interface LoyaltyReport extends PeopleReportBase {
  points: LoyaltyPointsRow[];
  /** Customers per tier by their current balance (Spa wallet and Beauty wallet separately). */
  tiers: { tier: string; spa: number; beauty: number }[];
  /** Points outstanding now. */
  outstanding: { spa: number; beauty: number };
  referrals: { bound: number; rewarded: number };
  rewardRedemptions: number;
  birthday: { redeemed: number; amountVnd: string };
  /** True when points not tied to a branch (manual adjustments, referral awards) are included: only for a person who reads every branch. */
  includesBranchless: boolean;
}

export interface TopCustomerRow {
  userId: string;
  name: string;
  /** In full (Owner, OQ-P8-6). */
  phone: string | null;
  invoices: number;
  collectedVnd: string;
  visits: number;
}

export interface TopCustomersReport extends PeopleReportBase {
  rows: TopCustomerRow[];
  limit: number;
}

export interface StaffRow {
  userId: string;
  name: string;
  employeeCode: string | null;
  /** Services the person ended in the period, the people they served, the time they actually worked and the time planned for it. */
  servicesPerformed: number;
  customersServed: number;
  actualMinutes: number;
  plannedMinutes: number;
  /** Money collected for the lines assigned to the person (null without VIEW_REVENUE at every covered branch). */
  serviceSalesVnd: string | null;
  productSalesVnd: string | null;
  /** Orders placed with the person's referral code, and their invoice total (the total only with VIEW_REVENUE). */
  referralOrders: number;
  referralInvoiceVnd: string | null;
  /** Tips, tour pay and product commission earned (null without VIEW_EMPLOYEE_PAY at every covered branch). */
  tipsVnd: string | null;
  tourVnd: string | null;
  commissionVnd: string | null;
  attendanceDays: number;
  attendanceMinutes: number;
  /** Approved leave days inside the period. */
  leaveDays: number;
}

export interface StaffActivityReport extends PeopleReportBase {
  columns: { sales: boolean; pay: boolean };
  rows: StaffRow[];
}
