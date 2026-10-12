import {
  REPORT_DEFINITIONS,
  type BookingFunnelReport,
  type AdvancesReport,
  type BestSellerReport,
  type CashDailyReport,
  type CashDifferencesReport,
  type CashFundsReport,
  type LabourCostReport,
  type PayrollMonthlyReport,
  type ProfitReport,
  type TipsReport,
  type ComboReport,
  type ExpiryReport,
  type LowStockReport,
  type SlowMoverReport,
  type StockMovementReport,
  type StockReceiptReport,
  type StockValueReport,
  type CustomerVisitsReport,
  type LoyaltyReport,
  type StaffActivityReport,
  type TopCustomersReport,
  type DiscountReport,
  type OnlineOrderReport,
  type ProductRevenueReport,
  type RefundReport,
  type ReportRegistryResponse,
  type RevenueReport,
  type ServiceRevenueReport,
} from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { refundReport, type RefundQuery } from './refunds.core.js';
import { runReport, type ReportContext, type ReportKind } from './report.frame.js';
import {
  bookingFunnel,
  customerVisits,
  loyaltyReport,
  staffActivity,
  topCustomers,
  type PeopleQuery,
} from './people.core.js';
import { revenueReport, type RevenueQuery } from './revenue.core.js';
import {
  advancesReport,
  cashDaily,
  cashDifferences,
  cashFunds,
  labourCost,
  payrollMonthly,
  tipsReport,
  type MoneyQuery,
} from './money.core.js';
import { profitReport, type ProfitQuery } from './profit.core.js';
import {
  bestSellers,
  expiringLots,
  lowStock,
  slowMovers,
  stockMovements,
  stockReceipts,
  stockValue,
  type StockQuery,
} from './stock.core.js';
import {
  comboReport,
  discountReport,
  onlineOrderReport,
  productRevenue,
  serviceRevenue,
  type SalesQuery,
} from './sales.core.js';

/**
 * Phase 8: the reports. Every method runs in the read-only frame (`runReport`); nothing here writes. The one write of the whole area
 * (the audit row of an exported file, P8-4) is made by the export service in its own transaction after the data was read.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<SessionService, 'withReadOnlyTransaction' | 'resolve'>,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  /** What this person may open: drives the menu. A report with no covered branch is `available: false`, never an error. */
  registry(token: string | undefined): Promise<ReportRegistryResponse> {
    return this.run(token, 'dashboard', async (context) => {
      const reports = REPORT_DEFINITIONS.map((definition) => {
        const covered = context.allBranches.filter((branch) =>
          definition.requires.every((permission) => context.can(permission, branch.id)),
        );
        const exportable =
          definition.exportable &&
          covered.some((branch) => context.can('EXPORT_REPORTS', branch.id));
        return {
          id: definition.id,
          area: definition.area,
          wave: definition.wave,
          available:
            covered.length > 0 &&
            (!definition.shopWide || covered.length === context.allBranches.length),
          exportable,
          exportReauth: definition.exportReauth,
          branchIds: covered.map((branch) => branch.id),
        };
      });
      const seen = new Set(reports.flatMap((report) => report.branchIds));
      return {
        generatedAt: context.now.toISOString(),
        branches: context.allBranches
          .filter((branch) => seen.has(branch.id))
          .map(({ id, code, name }) => ({ id, code, name })),
        reports,
      };
    });
  }

  /** R1-R4: revenue overview, by branch, side and kind, channel and method (one payload; the screens regroup it). */
  revenue(token: string | undefined, query: RevenueQuery): Promise<RevenueReport> {
    return this.run(token, 'report', (context) => revenueReport(context, query));
  }

  /** R10: refunds, exchange differences and reversed payments of a period. */
  refunds(token: string | undefined, query: RefundQuery): Promise<RefundReport> {
    return this.run(token, 'report', (context) => refundReport(context, query));
  }

  /** R5: revenue by service. */
  serviceRevenue(token: string | undefined, query: SalesQuery): Promise<ServiceRevenueReport> {
    return this.run(token, 'report', (context) => serviceRevenue(context, query));
  }

  /** R6: revenue by product, brand or category. */
  productRevenue(
    token: string | undefined,
    query: SalesQuery & { by?: unknown },
  ): Promise<ProductRevenueReport> {
    return this.run(token, 'report', (context) => productRevenue(context, query));
  }

  /** R7: combo packages sold, used, remaining and expired. */
  combos(token: string | undefined, query: SalesQuery): Promise<ComboReport> {
    return this.run(token, 'report', (context) => comboReport(context, query));
  }

  /** R8: discounts given by source, and revenue by campaign. */
  discounts(token: string | undefined, query: SalesQuery): Promise<DiscountReport> {
    return this.run(token, 'report', (context) => discountReport(context, query));
  }

  /** R9: online orders of the period. */
  onlineOrders(
    token: string | undefined,
    query: SalesQuery & { page?: unknown },
  ): Promise<OnlineOrderReport> {
    return this.run(token, 'report', (context) => onlineOrderReport(context, query));
  }

  /** C1: completed visits (lượt đến), people, new and returning. */
  customerVisits(token: string | undefined, query: PeopleQuery): Promise<CustomerVisitsReport> {
    return this.run(token, 'report', (context) => customerVisits(context, query));
  }

  /** C2: bookings, check-ins, cancellations and no-shows. */
  bookingFunnel(token: string | undefined, query: PeopleQuery): Promise<BookingFunnelReport> {
    return this.run(token, 'report', (context) => bookingFunnel(context, query));
  }

  /** C3: points, tiers, referrals, rewards and birthdays. */
  loyalty(token: string | undefined, query: PeopleQuery): Promise<LoyaltyReport> {
    return this.run(token, 'report', (context) => loyaltyReport(context, query));
  }

  /** C4: the customers who paid most in the period. */
  topCustomers(token: string | undefined, query: PeopleQuery): Promise<TopCustomersReport> {
    return this.run(token, 'report', (context) => topCustomers(context, query));
  }

  /** S1: what each employee did in the period (facts only). */
  staffActivity(token: string | undefined, query: PeopleQuery): Promise<StaffActivityReport> {
    return this.run(token, 'report', (context) => staffActivity(context, query));
  }

  /** P8-9: Units and money per product. */
  bestSellers(token: string | undefined, query: StockQuery): Promise<BestSellerReport> {
    return this.run(token, 'report', (context) => bestSellers(context, query));
  }

  /** P8-9: Variants at or below their threshold now. */
  lowStock(token: string | undefined, query: StockQuery): Promise<LowStockReport> {
    return this.run(token, 'report', (context) => lowStock(context, query));
  }

  /** P8-9: Stock with no sale for N days. */
  slowMovers(token: string | undefined, query: StockQuery): Promise<SlowMoverReport> {
    return this.run(token, 'report', (context) => slowMovers(context, query));
  }

  /** P8-9: Lots expired or expiring soon. */
  expiringLots(token: string | undefined, query: StockQuery): Promise<ExpiryReport> {
    return this.run(token, 'report', (context) => expiringLots(context, query));
  }

  /** P8-9: Stock at cost with coverage. */
  stockValue(token: string | undefined, query: StockQuery): Promise<StockValueReport> {
    return this.run(token, 'report', (context) => stockValue(context, query));
  }

  /** P8-9: Movements by kind and reason. */
  stockMovements(token: string | undefined, query: StockQuery): Promise<StockMovementReport> {
    return this.run(token, 'report', (context) => stockMovements(context, query));
  }

  /** P8-9: Receipts by supplier. */
  stockReceipts(token: string | undefined, query: StockQuery): Promise<StockReceiptReport> {
    return this.run(token, 'report', (context) => stockReceipts(context, query));
  }

  /** P8-12: K1: the cash of each day: opening float, in, out, expected, counted, difference. */
  cashDaily(token: string | undefined, query: MoneyQuery): Promise<CashDailyReport> {
    return this.run(token, 'report', (context) => cashDaily(context, query));
  }

  /** P8-12: K2: the balance of each fund up to the end of the period. */
  cashFunds(token: string | undefined, query: MoneyQuery): Promise<CashFundsReport> {
    return this.run(token, 'report', (context) => cashFunds(context, query));
  }

  /** P8-12: K3: closed days whose count differed from the book. */
  cashDifferences(token: string | undefined, query: MoneyQuery): Promise<CashDifferencesReport> {
    return this.run(token, 'report', (context) => cashDifferences(context, query));
  }

  /** P8-12: T1: tips by person, by method, and what is still owed. */
  tips(token: string | undefined, query: MoneyQuery): Promise<TipsReport> {
    return this.run(token, 'report', (context) => tipsReport(context, query));
  }

  /** P8-12: P1: pay runs by month, by kind of pay item. */
  payrollMonthly(token: string | undefined, query: MoneyQuery): Promise<PayrollMonthlyReport> {
    return this.run(token, 'report', (context) => payrollMonthly(context, query));
  }

  /** P8-12: P2: labour cost against revenue by month. */
  labourCost(token: string | undefined, query: MoneyQuery): Promise<LabourCostReport> {
    return this.run(token, 'report', (context) => labourCost(context, query));
  }

  /** P8-12: P3: salary advances paid and not yet recovered. */
  advances(token: string | undefined, query: MoneyQuery): Promise<AdvancesReport> {
    return this.run(token, 'report', (context) => advancesReport(context, query));
  }

  /** P8-13: provisional profit of the whole shop (the Owner's VIEW_PROFIT). */
  profit(token: string | undefined, query: ProfitQuery): Promise<ProfitReport> {
    return this.run(token, 'report', (context) => profitReport(context, query));
  }

  /** The single entry for the reports of the later Steps. */
  run<T>(
    token: string | undefined,
    kind: ReportKind,
    work: (context: ReportContext) => Promise<T>,
  ): Promise<T> {
    return runReport({ sessions: this.sessions, throttle: this.throttle }, token, kind, work);
  }
}
