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
