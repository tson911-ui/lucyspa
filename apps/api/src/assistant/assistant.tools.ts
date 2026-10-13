import type { ConverseTool } from '@lucy-spa/server';
import type {
  ReportRegistryResponse,
  RevenuePart,
  ReviewsReport,
  RevenueReport,
  ServiceRevenueReport,
  ProductRevenueReport,
  RefundReport,
  CustomerVisitsReport,
  BookingFunnelReport,
  CashDailyReport,
  CashFundsReport,
  LabourCostReport,
  PayrollMonthlyReport,
  AdvancesReport,
  ProfitReport,
} from '@lucy-spa/contracts';
import { REPORT_LIMITS } from '@lucy-spa/contracts';

/**
 * Claude integration Wave C (CI-S1): the fixed catalogue of read-only tools of the report assistant. Each tool is a thin wrapper over an
 * existing Phase 8 report service, run with the ASKING PERSON's own token, so the report's permission and branch scope apply a second
 * time. What the model gets back is an allow-listed projection: totals, labels and counts. Never a person's name, phone or pay line, never a
 * free-text field (reasons, notes, invoice codes). The model never writes SQL and never sees a table.
 */

/** The report methods the tools call (the real `ReportsService`, or a stub in a test). */
export interface AssistantReports {
  registry(token: string | undefined): Promise<ReportRegistryResponse>;
  revenue(token: string | undefined, query: Record<string, unknown>): Promise<RevenueReport>;
  refunds(token: string | undefined, query: Record<string, unknown>): Promise<RefundReport>;
  serviceRevenue(
    token: string | undefined,
    query: Record<string, unknown>,
  ): Promise<ServiceRevenueReport>;
  productRevenue(
    token: string | undefined,
    query: Record<string, unknown>,
  ): Promise<ProductRevenueReport>;
  customerVisits(
    token: string | undefined,
    query: Record<string, unknown>,
  ): Promise<CustomerVisitsReport>;
  bookingFunnel(
    token: string | undefined,
    query: Record<string, unknown>,
  ): Promise<BookingFunnelReport>;
  cashDaily(token: string | undefined, query: Record<string, unknown>): Promise<CashDailyReport>;
  cashFunds(token: string | undefined, query: Record<string, unknown>): Promise<CashFundsReport>;
  labourCost(token: string | undefined, query: Record<string, unknown>): Promise<LabourCostReport>;
  payrollMonthly(
    token: string | undefined,
    query: Record<string, unknown>,
  ): Promise<PayrollMonthlyReport>;
  advances(token: string | undefined, query: Record<string, unknown>): Promise<AdvancesReport>;
  profit(token: string | undefined, query: Record<string, unknown>): Promise<ProfitReport>;
  reviews(token: string | undefined, query: Record<string, unknown>): Promise<ReviewsReport>;
}

export interface ToolBranch {
  id: string;
  code: string;
  name: string;
}

export interface ToolArgs {
  from: string;
  to: string;
  /** A branch id, or undefined for every branch the person may see. */
  branchId: string | undefined;
}

export interface ToolContext {
  token: string;
  reports: AssistantReports;
  /** The branches the person may see in any report (from the registry); a tool further limits to its own report. */
  branches: readonly ToolBranch[];
}

export interface AssistantTool {
  name: string;
  /** The report the tool reads; it is offered only when the person may open that report. */
  reportId: string;
  description: string;
  run(args: ToolArgs, context: ToolContext): Promise<unknown>;
}

const money = (value: string | null | undefined): number => (value ? Number(value) : 0);
const percent = (basisPoints: number | null): number | null =>
  basisPoints === null ? null : Math.round(basisPoints / 10) / 10;
const average = (hundredths: number | null): number | null =>
  hundredths === null ? null : Math.round(hundredths) / 100;
const period = (from: string, to: string) => ({ from, to });

const KIND: Record<string, string> = {
  SERVICE: 'dịch vụ',
  COMBO: 'liệu trình trọn gói',
  PRODUCT: 'mỹ phẩm',
  OTHER: 'khác',
};
const SIDE: Record<string, string> = {
  SPA: 'Spa',
  BEAUTY: 'Lucy Beauty',
  UNCLASSIFIED: 'chưa phân loại',
};
const CHANNEL: Record<string, string> = { COUNTER: 'tại quầy', ONLINE: 'online' };
const METHOD: Record<string, string> = {
  CASH: 'tiền mặt',
  PAYOS: 'PayOS',
  TRANSFER: 'chuyển khoản',
};

const parts = <K extends string>(rows: readonly RevenuePart<K>[], labels: Record<string, string>) =>
  rows.map((row) => ({
    name: labels[row.key] ?? row.key,
    netRevenue: money(row.netVnd),
    percent: percent(row.shareBp),
  }));

const TOP = 10;

export const ASSISTANT_TOOLS: readonly AssistantTool[] = [
  {
    name: 'revenue',
    reportId: 'revenue-overview',
    description:
      'Net revenue of the shop for a period (money collected minus refunds), with the same figures for the equal period just before, the change in percent, the breakdown by branch, by what was sold, by counter or online, and by payment method, the paid invoices and the completed visits.',
    async run(args, context) {
      const report = await context.reports.revenue(context.token, {
        from: args.from,
        to: args.to,
        branchId: args.branchId,
        compare: 'previous',
      });
      const net = money(report.totals.netVnd);
      const before = report.previousTotals ? money(report.previousTotals.netVnd) : null;
      return {
        period: period(report.period.from, report.period.to),
        netRevenue: net,
        collected: money(report.totals.collectedVnd),
        refunds: money(report.totals.refundsVnd),
        exchanges: money(report.totals.exchangesVnd),
        paidInvoices: {
          count: report.paidInvoices.count,
          total: money(report.paidInvoices.totalVnd),
          average: money(report.paidInvoices.averageVnd),
        },
        completedVisits: report.visits,
        onlineMoneyNotDeliveredYet: money(report.onlineHeldVnd),
        previousPeriod:
          report.period.previous && before !== null
            ? {
                ...period(report.period.previous.from, report.period.previous.to),
                netRevenue: before,
                changeVnd: net - before,
                changePercent:
                  before === 0 ? null : Math.round(((net - before) / Math.abs(before)) * 1000) / 10,
              }
            : null,
        byBranch: report.byBranch.map((row) => ({
          name: row.branch.name,
          netRevenue: money(row.netVnd),
          visits: row.visits,
          paidInvoices: row.paidInvoices,
        })),
        bySide: parts(report.bySide, SIDE),
        byKind: parts(report.byKind, KIND),
        byChannel: parts(report.byChannel, CHANNEL),
        byMethod: report.byMethod.map((row) => ({
          name: METHOD[row.method] ?? row.method,
          in: money(row.inVnd),
          out: money(row.outVnd),
          net: money(row.netVnd),
        })),
      };
    },
  },
  {
    name: 'refunds',
    reportId: 'refunds',
    description:
      'Totals of refunds, exchange differences and reversed payments for a period, and how many payments need a look. Totals only, no invoice list.',
    async run(args, context) {
      const report = await context.reports.refunds(context.token, {
        from: args.from,
        to: args.to,
        branchId: args.branchId,
        pageSize: 1,
      });
      return {
        period: period(report.period.from, report.period.to),
        refunds: money(report.totals.refundsVnd),
        exchanges: money(report.totals.exchangesVnd),
        reversedPayments: money(report.totals.reversalsVnd),
        paymentsToCheck: report.totals.paymentAnomalies,
      };
    },
  },
  {
    name: 'service_revenue',
    reportId: 'revenue-by-service',
    description:
      'Revenue and number sold per service for a period: the ten services with the most revenue, with their share, and the totals.',
    async run(args, context) {
      const report = await context.reports.serviceRevenue(context.token, {
        from: args.from,
        to: args.to,
        branchId: args.branchId,
      });
      const rows = [...report.rows].sort((a, b) => money(b.netVnd) - money(a.netVnd));
      return {
        period: period(report.period.from, report.period.to),
        totals: { netRevenue: money(report.totals.netVnd), quantity: report.totals.quantity },
        top: rows.slice(0, TOP).map((row) => ({
          service: row.nameVi,
          quantity: row.quantity,
          netRevenue: money(row.netVnd),
          percent: percent(row.shareBp),
        })),
        otherServices: Math.max(rows.length - TOP, 0),
      };
    },
  },
  {
    name: 'product_revenue',
    reportId: 'revenue-by-product',
    description:
      'Cosmetics sold for a period: the ten products with the most revenue (units sold, units refunded, revenue, share) and the totals.',
    async run(args, context) {
      const report = await context.reports.productRevenue(context.token, {
        from: args.from,
        to: args.to,
        branchId: args.branchId,
        by: 'variant',
      });
      const rows = [...report.rows].sort((a, b) => money(b.netVnd) - money(a.netVnd));
      return {
        period: period(report.period.from, report.period.to),
        totals: {
          netRevenue: money(report.totals.netVnd),
          unitsSold: report.totals.unitsSold,
          unitsRefunded: report.totals.unitsRefunded,
        },
        top: rows.slice(0, TOP).map((row) => ({
          product: row.nameVi,
          brand: row.brandNameVi,
          unitsSold: row.unitsSold,
          unitsRefunded: row.unitsRefunded,
          netRevenue: money(row.netVnd),
          percent: percent(row.shareBp),
        })),
        otherProducts: Math.max(rows.length - TOP, 0),
      };
    },
  },
  {
    name: 'visits',
    reportId: 'customers-visits',
    description:
      'Completed visits (lượt đến) for a period: how many, booked or walk-in, how many different people, new and returning, and the split by branch.',
    async run(args, context) {
      const report = await context.reports.customerVisits(context.token, {
        from: args.from,
        to: args.to,
        branchId: args.branchId,
      });
      return {
        period: period(report.period.from, report.period.to),
        visits: report.totals.visits,
        bookedVisits: report.totals.bookedVisits,
        walkInVisits: report.totals.walkInVisits,
        people: report.totals.people,
        newPeople: report.totals.newPeople,
        returningPeople: report.totals.returningPeople,
        byBranch: report.byBranch.map((row) => ({
          name: row.branch.name,
          visits: row.visits,
          people: row.people,
        })),
      };
    },
  },
  {
    name: 'bookings',
    reportId: 'bookings-funnel',
    description:
      'Bookings for a period: made, arrived, cancelled, late-cancelled, no-show, still open, the share who came and the no-show share, online against at the desk.',
    async run(args, context) {
      const report = await context.reports.bookingFunnel(context.token, {
        from: args.from,
        to: args.to,
        branchId: args.branchId,
      });
      return {
        period: period(report.period.from, report.period.to),
        bookings: report.totals.bookings,
        arrived: report.totals.checkedIn,
        cancelled: report.totals.cancelled,
        lateCancelled: report.totals.lateCancelled,
        noShow: report.totals.noShow,
        stillOpen: report.totals.open,
        cameUpPercent: percent(report.cameBp),
        noShowPercent: percent(report.noShowBp),
        byChannel: report.byChannel.map((row) => ({
          name: row.channel === 'ONLINE' ? 'đặt online' : 'đặt tại quầy',
          bookings: row.bookings,
          arrived: row.checkedIn,
          cancelled: row.cancelled,
          noShow: row.noShow,
        })),
      };
    },
  },
  {
    name: 'cash',
    reportId: 'cash-daily',
    description:
      'The cash drawers for a period: cash in, cash out, the total difference between counted and expected, how many days were closed and open, and the in and out per category.',
    async run(args, context) {
      const report = await context.reports.cashDaily(context.token, {
        from: args.from,
        to: args.to,
        branchId: args.branchId,
      });
      return {
        period: period(report.period.from, report.period.to),
        booksStarted: report.started,
        cashIn: money(report.totals.cashInVnd),
        cashOut: money(report.totals.cashOutVnd),
        countDifference: money(report.totals.differenceVnd),
        closedDays: report.totals.closedDays,
        openDays: report.totals.openDays,
        byCategory: report.byCategory.map((row) => ({
          category: row.category,
          in: money(row.inVnd),
          out: money(row.outVnd),
        })),
      };
    },
  },
  {
    name: 'fund_balances',
    reportId: 'cash-funds',
    description:
      'The balance of every cash drawer and bank fund the person may see, with what came in and went out in the period.',
    async run(args, context) {
      const report = await context.reports.cashFunds(context.token, {
        from: args.from,
        to: args.to,
        branchId: args.branchId,
      });
      return {
        period: period(report.period.from, report.period.to),
        booksStarted: report.started,
        funds: report.rows.map((row) => ({
          name: row.name,
          kind: row.kind === 'BANK' ? 'ngân hàng' : 'tiền mặt',
          branch: row.branch?.name ?? null,
          balance: money(row.balanceVnd),
          in: money(row.inVnd),
          out: money(row.outVnd),
        })),
      };
    },
  },
  {
    name: 'labour_cost',
    reportId: 'labour-cost',
    description:
      'Labour cost against revenue by month for a period: the labour cost, the revenue, and labour as a percentage of revenue. Whole shop only.',
    async run(args, context) {
      const report = await context.reports.labourCost(context.token, {
        from: args.from,
        to: args.to,
      });
      return {
        period: period(args.from, args.to),
        booksStarted: report.started,
        months: report.rows.map((row) => ({
          month: row.month,
          status: row.status,
          labourCost: money(row.labourVnd),
          revenue: money(row.revenueVnd),
          labourPercentOfRevenue: percent(row.shareBp),
        })),
      };
    },
  },
  {
    name: 'payroll_totals',
    reportId: 'payroll-monthly',
    description:
      'Payroll totals by month for a period: how many people were paid, the total net pay and the tips, and the total per kind of pay. Totals only, never a person’s pay.',
    async run(args, context) {
      const report = await context.reports.payrollMonthly(context.token, {
        from: args.from,
        to: args.to,
      });
      return {
        period: period(args.from, args.to),
        booksStarted: report.started,
        totals: { netPay: money(report.totals.netVnd), tips: money(report.totals.tipsVnd) },
        months: report.rows.map((row) => ({
          month: row.month,
          status: row.status,
          people: row.people,
          netPay: money(row.netVnd),
          tips: money(row.tipsVnd),
          byKind: Object.fromEntries(
            Object.entries(row.byKind).map(([kind, value]) => [kind, money(value)]),
          ),
        })),
      };
    },
  },
  {
    name: 'advances_totals',
    reportId: 'advances',
    description:
      'Salary advances: the total still to be recovered and the total waiting for approval, and how many people have an advance outstanding. Totals only, never a person’s advance.',
    async run(_args, context) {
      const report = await context.reports.advances(context.token, {});
      return {
        booksStarted: report.started,
        outstanding: money(report.totals.outstandingVnd),
        waitingForApproval: money(report.totals.pendingVnd),
        peopleWithAdvanceOutstanding: report.rows.filter((row) => money(row.outstandingVnd) > 0)
          .length,
      };
    },
  },
  {
    name: 'profit',
    reportId: 'profit',
    description:
      'Provisional profit for a period (owner only): revenue, cost of goods, tour pay, commission, salaries, manual expenses and the profit, with how complete the cost data is.',
    async run(args, context) {
      const report = await context.reports.profit(context.token, {
        from: args.from,
        to: args.to,
      });
      return {
        period: period(report.period.from, report.period.to),
        booksStarted: report.started,
        revenue: money(report.lines.revenueVnd),
        costOfGoods: money(report.lines.costOfGoodsVnd),
        tourPay: money(report.lines.tourVnd),
        commission: money(report.lines.commissionVnd),
        salaries: money(report.lines.salariesVnd),
        manualExpenses: money(report.lines.manualExpensesVnd),
        profit: money(report.lines.profitVnd),
        goodsWithKnownCostPercent: percent(report.goods.coverageBp),
        salaryMonths: {
          counted: report.salaries.monthsCounted,
          partial: report.salaries.monthsPartial,
          missing: report.salaries.monthsMissing,
          draft: report.salaries.monthsDraft,
        },
      };
    },
  },
  {
    name: 'reviews',
    reportId: 'reviews',
    description:
      'Customer ratings for a period: how many ratings, the average (out of 5), how many of each star, the average per branch and the share of paid invoices that left a rating. No comments and no staff names.',
    async run(args, context) {
      const report = await context.reports.reviews(context.token, {
        from: args.from,
        to: args.to,
        branchId: args.branchId,
      });
      return {
        period: period(report.period.from, report.period.to),
        ratings: report.totals.count,
        average: average(report.totals.averageHundredths),
        oneToFiveStars: report.totals.distribution,
        enoughRatingsToJudge: report.totals.enough,
        byBranch: report.byBranch.map((row) => ({
          name: row.branch.name,
          ratings: row.count,
          average: average(row.averageHundredths),
        })),
        paidInvoices: report.paidInvoices,
        ratedPercent: percent(report.responseBp),
      };
    },
  },
];

// ------------------------------------------------------------------------------------------------------------------ definitions

/** The tools one person gets: only those whose report the registry says they may open, each with the branches they cover. */
export function toolsFor(registry: ReportRegistryResponse): {
  tools: AssistantTool[];
  branches: ToolBranch[];
} {
  const open = new Set(
    registry.reports
      .filter((report) => report.available && report.branchIds.length > 0)
      .map((report) => report.id),
  );
  const tools = ASSISTANT_TOOLS.filter((tool) => open.has(tool.reportId));
  const seen = new Set(
    registry.reports.filter((report) => open.has(report.id)).flatMap((report) => report.branchIds),
  );
  return {
    tools: [...tools],
    branches: registry.branches.filter((branch) => seen.has(branch.id)),
  };
}

export function definitionsOf(
  tools: readonly AssistantTool[],
  branches: readonly ToolBranch[],
): ConverseTool[] {
  const list = branches.map((branch) => `${branch.code} (${branch.name})`).join(', ');
  return tools.map((tool) => {
    const wholeShop = ['labour_cost', 'payroll_totals', 'profit'].includes(tool.name);
    const noRange = tool.name === 'advances_totals';
    const properties: Record<string, unknown> = {
      from: { type: 'string', description: 'First day, YYYY-MM-DD.' },
      to: { type: 'string', description: 'Last day, YYYY-MM-DD (not before from).' },
      branch: {
        type: ['string', 'null'],
        description:
          wholeShop || noRange
            ? 'Always null: this report covers the whole shop.'
            : `Branch code to look at one branch, or null for every branch you may see. Codes: ${list}.`,
      },
    };
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: {
        type: 'object',
        properties,
        required: ['from', 'to', 'branch'],
        additionalProperties: false,
      },
    };
  });
}

// ------------------------------------------------------------------------------------------------------------------ arguments

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function dayNumber(value: string): number | null {
  if (!DAY.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  // Date.parse rolls over (2026-02-31 becomes March): reject anything that does not read back the same.
  return new Date(ms).toISOString().slice(0, 10) === value ? ms / 86_400_000 : null;
}

/** The arguments of a call, checked: real dates, from not after to, at most a year, a branch only from the person's own list. Null when invalid. */
export function parseArgs(raw: unknown, branches: readonly ToolBranch[]): ToolArgs | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const from = typeof input['from'] === 'string' ? input['from'] : '';
  const to = typeof input['to'] === 'string' ? input['to'] : '';
  const start = dayNumber(from);
  const end = dayNumber(to);
  if (start === null || end === null || end < start) return null;
  if (end - start + 1 > REPORT_LIMITS.maxDays) return null;
  const branch = input['branch'];
  if (branch === null || branch === undefined || branch === '') {
    return { from, to, branchId: undefined };
  }
  if (typeof branch !== 'string') return null;
  const found = branches.find((entry) => entry.code.toLowerCase() === branch.toLowerCase());
  return found ? { from, to, branchId: found.id } : null;
}
