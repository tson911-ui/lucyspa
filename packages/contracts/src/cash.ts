/**
 * Phase 7 Wave A (docs/PHASE7_PAYROLL_FUNDS.md section 7): the shop funds ("sổ quỹ"). Money is integer VND carried as a decimal string
 * (like every other money field of the contracts). Reading needs VIEW_CASH or MANAGE_CASH at the branch of a fund; every change needs
 * MANAGE_CASH at that branch. The shared bank fund needs the permission at every active branch. Nothing is granted by default.
 */

export const FUND_KINDS = ['CASH', 'BANK'] as const;
export type FundKindName = (typeof FUND_KINDS)[number];

export const FUND_DIRECTIONS = ['IN', 'OUT'] as const;
export type FundDirectionName = (typeof FUND_DIRECTIONS)[number];

export const FUND_ENTRY_CATEGORIES = [
  'SALE_CASH',
  'SALE_BANK',
  'PAYMENT_REVERSAL',
  'PRODUCT_REFUND',
  'EXCHANGE_DIFFERENCE',
  'FAILED_DELIVERY_REFUND',
  'TIP_IN',
  'TIP_OUT',
  'SALARY_PAYOUT',
  'ADVANCE',
  'MANUAL_INCOME',
  'MANUAL_EXPENSE',
  'OWNER_WITHDRAWAL',
  'DEPOSIT',
  'FUND_TRANSFER',
  'COUNT_DIFFERENCE',
  'CORRECTION',
] as const;
export type FundEntryCategoryName = (typeof FUND_ENTRY_CATEGORIES)[number];

/** A most-likely-typo guard: no single amount of the cash book may exceed this many VND (10 billion). */
export const CASH_AMOUNT_MAX_VND = 10_000_000_000;
export const CASH_REASON_MAX = 500;

export interface CashBranchRef {
  id: string;
  code: string;
  name: string;
}

export interface CashFundItem {
  id: string;
  kind: FundKindName;
  /** Null for the shared bank fund. */
  branch: CashBranchRef | null;
  name: string;
  openingBalanceVnd: string;
  /** Opening balance plus every entry of the book (not only the closed days). */
  balanceVnd: string;
  /** The last closed business date (cash funds only), YYYY-MM-DD. */
  lastClosedDate: string | null;
}

export interface CashGoLiveInfo {
  /** ISO instant. Nothing before it is posted. */
  at: string;
  setBy: { id: string; name: string };
}

/** What the signed-in person may do in the cash book, by branch (the bank fund is the `bank` flag). */
export interface CashBranchAccess {
  branch: CashBranchRef;
  view: boolean;
  manage: boolean;
  /** May hand collected cash in at this branch (MANAGE_CASH or COLLECT_PAYMENTS). */
  deposit: boolean;
}

export interface CashOverviewResponse {
  /** Null until the Owner starts the cash book and payroll (no default date). */
  goLive: CashGoLiveInfo | null;
  branches: CashBranchAccess[];
  /** May the person start the cash book (MANAGE_CASH at every active branch)? */
  canGoLive: boolean;
  /** The funds the person may see. */
  funds: CashFundItem[];
  /** The default float left for the next day (settings; the Owner may change it per closing). */
  defaultNextFloatVnd: string;
  /** Closings of the last 30 days, in the funds the person may see, whose difference reached the alert threshold. */
  differenceAlerts: number;
  alertThresholdVnd: string;
}

export interface CashGoLiveBranchBalance {
  branchId: string;
  /** The counted cash of the branch's drawer and safe, integer VND as a string. */
  countedVnd: string;
}

export interface CashGoLiveRequest {
  /** One counted opening balance per active branch: exactly the active branches, no more, no fewer. */
  branches: CashGoLiveBranchBalance[];
  /** The counted opening balance of the bank account. */
  bankVnd: string;
}

/** The manual entries a person records (P7-4). Everything else in the book is posted from its source. */
export const CASH_MANUAL_KINDS = [
  'MANUAL_INCOME',
  'MANUAL_EXPENSE',
  'DEPOSIT',
  'OWNER_WITHDRAWAL',
] as const;
export type CashManualKind = (typeof CASH_MANUAL_KINDS)[number];

export const CASH_PAGE_SIZE = 20;

export interface CashEntryItem {
  id: string;
  /** The order of the book, a decimal string. */
  seq: string;
  /** The branch-local day the entry counts for, YYYY-MM-DD. */
  businessDate: string;
  direction: FundDirectionName;
  category: FundEntryCategoryName;
  amountVnd: string;
  /** The invoice, refund or exchange code the money belongs to; null for a manual entry. */
  reference: string | null;
  reason: string | null;
  actor: { id: string; name: string } | null;
  occurredAt: string;
  /** This entry reverses that one (a correction), or is reversed by that one. */
  reversesEntryId: string | null;
  reversedByEntryId: string | null;
  /** May the signed-in person reverse it (a manual entry that is not reversed yet)? */
  canReverse: boolean;
}

export interface CashEntryListResponse {
  fund: CashFundItem;
  items: CashEntryItem[];
  page: number;
  pageSize: number;
  total: number;
  /** Money in and out of the entries matching the filter (all pages). */
  inVnd: string;
  outVnd: string;
  /** What the person may do with this fund. */
  can: { record: boolean; deposit: boolean; transfer: boolean };
}

export interface CashEntryResponse {
  item: CashEntryItem;
}

export interface CashManualEntryRequest {
  fundId: string;
  /** The branch the money belongs to: required for the shared bank fund, omitted for a branch cash fund. */
  branchId?: string;
  kind: CashManualKind;
  amountVnd: string;
  reason: string;
  clientRequestId: string;
}

export interface CashReverseRequest {
  reason: string;
  clientRequestId: string;
}

export interface CashTransferRequest {
  fromFundId: string;
  /** The branch of the transfer when it is not given by a cash fund (never needed: one side is always a cash fund). */
  branchId?: string;
  toFundId: string;
  amountVnd: string;
  reason: string;
  clientRequestId: string;
}

export interface CashTransferResponse {
  items: CashEntryItem[];
}

export const CASH_RECONCILIATION_KEYS = [
  'PAYMENT_CASH',
  'PAYMENT_BANK',
  'PAYMENT_REVERSAL',
  'REFUND_CASH',
  'REFUND_BANK',
  'EXCHANGE_CASH',
  'EXCHANGE_BANK',
] as const;
export type CashReconciliationKey = (typeof CASH_RECONCILIATION_KEYS)[number];

/** One kind of money source of a branch against the entries the book made from it. */
export interface CashReconciliationRow {
  key: CashReconciliationKey;
  sourceCount: number;
  sourceVnd: string;
  bookCount: number;
  bookVnd: string;
  /** Source minus book: zero when every source is in the book with its exact amount. */
  deltaVnd: string;
  /** Source rows with no entry yet. */
  unposted: number;
}

export interface CashReconciliationResponse {
  branch: CashBranchRef;
  from: string;
  to: string;
  goLiveAt: string;
  rows: CashReconciliationRow[];
  unposted: number;
  balanced: boolean;
}

/** The default size of a cash difference (VND) that the Owner is shown as an alert; a setting, never code. */
export const CASH_DIFFERENCE_ALERT_DEFAULT_VND = 50_000;

export interface CashClosingPreviewRequest {
  /** The branch-local day to close, YYYY-MM-DD (the day after the last closing up to today). */
  date: string;
}

/**
 * What the book says for the day about to be closed. Opening the preview first posts every payment, reversal and refund of the fund
 * that is not in the book yet, so the figures are complete (`unposted` is then 0; anything else blocks the closing).
 */
export interface CashClosingPreviewResponse {
  fund: CashFundItem;
  businessDate: string;
  /** The previous closing's next-day float, or the opening balance on the first day. */
  openingFloatVnd: string;
  cashInVnd: string;
  cashOutVnd: string;
  /** Opening float + cash in - cash out. */
  expectedVnd: string;
  unposted: number;
  lastClosedDate: string | null;
  defaultNextFloatVnd: string;
  alertThresholdVnd: string;
  closable: boolean;
  /** Why the day cannot be closed, when it cannot. */
  blockedBy: 'ALREADY_CLOSED' | 'FUTURE_DAY' | 'UNPOSTED' | null;
}

export interface CashCloseRequest {
  date: string;
  /** The cash actually counted in the drawer and safe. */
  countedVnd: string;
  /** What the Owner takes out when closing; the rest stays as the next day's float. */
  withdrawalVnd: string;
  /** Required whenever the count differs from the book. */
  reason: string | null;
  clientRequestId: string;
}

export interface CashClosingItem {
  id: string;
  fundId: string;
  businessDate: string;
  openingFloatVnd: string;
  cashInVnd: string;
  cashOutVnd: string;
  expectedVnd: string;
  countedVnd: string;
  /** Counted minus expected: negative = short, positive = over. */
  differenceVnd: string;
  reason: string | null;
  withdrawalVnd: string;
  nextFloatVnd: string;
  closedBy: { id: string; name: string };
  closedAt: string;
  /** The difference reaches the alert threshold. */
  alert: boolean;
}

export interface CashClosingResponse {
  item: CashClosingItem;
  fund: CashFundItem;
}

export interface CashClosingListResponse {
  fund: CashFundItem;
  items: CashClosingItem[];
  page: number;
  pageSize: number;
  total: number;
  alertThresholdVnd: string;
}
