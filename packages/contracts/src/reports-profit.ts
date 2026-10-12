import type { ReportBranchRef, ReportPeriod } from './reports.js';

/**
 * Phase 8 P8-13 (docs/PHASE8_REPORTS.md 4.7, Owner OQ-P8-5): "lãi tạm tính", the provisional profit. Only for the Owner (VIEW_PROFIT is a
 * shop-wide permission) and for the whole shop: salaries are paid by one pay run for everybody, so a profit per branch would be a guess.
 *
 *   provisional profit = net revenue (the Doanh thu figure)
 *                      - cost of goods sold   (lot cost of the stock movements of sales, returns taken back)
 *                      - tour pay and product commission (the pay earnings of the period, reversals included)
 *                      - salaries   (pay-run items of the months that lie fully inside the period: base, collaborator work, bonus,
 *                                    adjustments and deductions; never the cash entries of paying them, and never tips)
 *                      - manual expenses of the cash book (not counting the ones corrected)
 *
 * It is NOT a tax report: rent, electricity, tax and every other cost are not in the system and are not guessed. A product whose lot has no
 * cost recorded is not estimated either: the share of units sold that had a cost is shown next to the figure, with the products still missing it.
 */
export const PROFIT_WITHOUT_COST_LIMIT = 50;

export interface ProfitProductRow {
  variantId: string;
  sku: string;
  nameVi: string;
  nameEn: string;
  /** Units sold net of returns whose lot has no cost. */
  unitsWithoutCost: number;
}

export interface ProfitReport {
  generatedAt: string;
  period: ReportPeriod;
  branches: ReportBranchRef[];
  /** False until the Owner started the cash book and payroll: salaries and expenses are then not in the books yet. */
  started: boolean;
  lines: {
    revenueVnd: string;
    costOfGoodsVnd: string;
    tourVnd: string;
    commissionVnd: string;
    salariesVnd: string;
    manualExpensesVnd: string;
    profitVnd: string;
  };
  goods: {
    unitsSold: number;
    unitsWithCost: number;
    /** Units sold that had a cost, as a share in basis points (10,000 when every unit had one). */
    coverageBp: number;
  };
  salaries: {
    /** Pay months fully inside the period (counted), months that overlap the period only in part (not counted), months inside without a run. */
    monthsCounted: number;
    monthsPartial: number;
    monthsMissing: number;
    /** Counted months whose run is still a draft. */
    monthsDraft: number;
  };
  withoutCost: ProfitProductRow[];
}
