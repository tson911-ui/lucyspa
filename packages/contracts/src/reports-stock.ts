import type { ReportBranchRef } from './reports.js';

/**
 * Phase 8 P8-9 (docs/PHASE8_REPORTS.md 4.5, Owner OQ-P8-9): cosmetics and stock. Needs VIEW_INVENTORY at the branch; the cost columns need
 * VIEW_PRODUCT_COST (a shop-wide permission) and are left out (null) without it, never zero-filled. Defaults approved by the Owner: a slow
 * mover has stock and no sale for 60 days; a lot is "expiring" when it expires within 60 days. Money is integer VND carried as a string.
 */

export const STOCK_DEFAULT_DAYS = 60;
export const STOCK_MAX_DAYS = 730;
export const STOCK_ROW_LIMIT = 5000;

export interface StockReportBase {
  generatedAt: string;
  branches: ReportBranchRef[];
  /** True when more rows existed than `STOCK_ROW_LIMIT`; the first ones (by the report's own order) are kept. */
  truncated: boolean;
}

export interface StockItemRef {
  variantId: string;
  sku: string;
  nameVi: string;
  nameEn: string;
}

export interface BestSellerRow extends StockItemRef {
  /** Units sold minus units that came back (a refund, an exchange, a reversed sale) in the period. */
  unitsNet: number;
  unitsSold: number;
  unitsReturned: number;
  /** Money collected for the product in the period (the revenue basis). */
  netVnd: string;
  shareBp: number;
}

export interface BestSellerReport extends StockReportBase {
  period: { from: string; to: string };
  rows: BestSellerRow[];
}

export interface LowStockRow extends StockItemRef {
  branch: ReportBranchRef;
  onHand: number;
  reserved: number;
  available: number;
  threshold: number;
}

export interface LowStockReport extends StockReportBase {
  rows: LowStockRow[];
}

export interface SlowMoverRow extends StockItemRef {
  branch: ReportBranchRef;
  onHand: number;
  /** Branch business day of the last sale (null: never sold here). */
  lastSoldOn: string | null;
  daysSinceSale: number | null;
  /** On-hand stock at cost (null without VIEW_PRODUCT_COST or without any cost recorded). */
  costValueVnd: string | null;
}

export interface SlowMoverReport extends StockReportBase {
  days: number;
  rows: SlowMoverRow[];
  costColumn: boolean;
}

export interface ExpiryRow extends StockItemRef {
  branch: ReportBranchRef;
  lotCode: string;
  expiryDate: string;
  /** Days from today to the expiry; negative when the lot has expired already. */
  daysLeft: number;
  quantity: number;
}

export interface ExpiryReport extends StockReportBase {
  days: number;
  rows: ExpiryRow[];
}

export interface StockValueRow extends StockItemRef {
  branch: ReportBranchRef;
  onHand: number;
  /** On-hand units whose lot has a unit cost, and the stock at cost of those units. */
  unitsWithCost: number;
  valueVnd: string;
}

export interface StockValueReport extends StockReportBase {
  rows: StockValueRow[];
  totals: {
    onHand: number;
    unitsWithCost: number;
    valueVnd: string;
    /** Units with a cost as a share of the units on hand, in basis points: the "x% of the stock has a cost" figure. */
    coverageBp: number;
    variantsWithoutCost: number;
  };
}

export interface StockMovementRow {
  branch: ReportBranchRef;
  kind: string;
  reason: string | null;
  entries: number;
  unitsIn: number;
  unitsOut: number;
}

export interface StockMovementReport extends StockReportBase {
  period: { from: string; to: string };
  rows: StockMovementRow[];
}

export interface ReceiptSupplierRow {
  supplierId: string | null;
  supplierName: string | null;
  receipts: number;
  units: number;
  /** Cost of the lines that have one (null without VIEW_PRODUCT_COST). */
  costVnd: string | null;
  linesWithoutCost: number;
}

export interface StockReceiptReport extends StockReportBase {
  period: { from: string; to: string };
  rows: ReceiptSupplierRow[];
  costColumn: boolean;
}
