import {
  REPORT_EXPORT_FORMATS,
  type BookingFunnelReport,
  type BestSellerReport,
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
  type ReportExportRequest,
  type ReportRegistryResponse,
  type RevenueReport,
  type ServiceRevenueReport,
} from '@lucy-spa/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { ReportExportService } from './export.service.js';
import { ReportsService } from './reports.service.js';

/** Only the contract's fields are accepted (the global pipe forbids unknown ones); the rules are applied again in the service. */
class ExportDto implements ReportExportRequest {
  @ApiProperty() @IsString() @MaxLength(64) report!: string;
  @ApiProperty({ enum: REPORT_EXPORT_FORMATS })
  @IsIn(REPORT_EXPORT_FORMATS)
  format!: ReportExportRequest['format'];
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(10) from?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(10) to?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(64) branchId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(16) bucket?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(16) compare?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(16) by?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(4) days?: string;
  @ApiProperty({ required: false, enum: ['vi', 'en'] })
  @IsOptional()
  @IsIn(['vi', 'en'])
  locale?: 'vi' | 'en';
}

/**
 * Phase 8: the reports. Every route is a GET; authority (the permissions of each report at each branch) is decided inside the
 * read-only frame from the person's own authority graph.
 */
@Controller('api/v1/reports')
export class ReportsController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(ReportsService) private readonly reports: ReportsService,
    @Inject(ReportExportService) private readonly exports: ReportExportService,
  ) {}

  @Get()
  @ApiOkResponse({
    description:
      'The reports this person may open and the branches each one covers (the permissions of the report held at the branch).',
  })
  registry(@Req() request: Request): Promise<ReportRegistryResponse> {
    return this.reports.registry(this.session(request));
  }

  @Get('revenue')
  @ApiOkResponse({
    description:
      'Revenue of a period (collected minus given back, by day of the branch): totals, series, by branch, side, kind, channel and method (VIEW_REVENUE at the branch).',
  })
  revenue(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('branchId') branchId: string | undefined,
    @Query('bucket') bucket: string | undefined,
    @Query('compare') compare: string | undefined,
    @Req() request: Request,
  ): Promise<RevenueReport> {
    return this.reports.revenue(this.session(request), { from, to, branchId, bucket, compare });
  }

  @Get('refunds')
  @ApiOkResponse({
    description:
      'Refunds, exchange differences and reversed payments of a period, 20 a page (VIEW_REVENUE at the branch).',
  })
  refunds(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('branchId') branchId: string | undefined,
    @Query('page') page: string | undefined,
    @Req() request: Request,
  ): Promise<RefundReport> {
    return this.reports.refunds(this.session(request), { from, to, branchId, page });
  }

  @Get('revenue/services')
  @ApiOkResponse({
    description:
      'Revenue by service (money collected minus given back, by invoice line) and the units on invoices paid in the period (VIEW_REVENUE at the branch).',
  })
  servicesRevenue(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('branchId') branchId: string | undefined,
    @Req() request: Request,
  ): Promise<ServiceRevenueReport> {
    return this.reports.serviceRevenue(this.session(request), { from, to, branchId });
  }

  @Get('revenue/products')
  @ApiOkResponse({
    description:
      'Revenue by product variant, brand or category with units sold and refunded (VIEW_REVENUE at the branch).',
  })
  productsRevenue(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('branchId') branchId: string | undefined,
    @Query('by') by: string | undefined,
    @Req() request: Request,
  ): Promise<ProductRevenueReport> {
    return this.reports.productRevenue(this.session(request), { from, to, branchId, by });
  }

  @Get('revenue/combos')
  @ApiOkResponse({
    description:
      'Combo packages sold, voided, sessions used, remaining and expired (VIEW_REVENUE at the branch).',
  })
  combosReport(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('branchId') branchId: string | undefined,
    @Req() request: Request,
  ): Promise<ComboReport> {
    return this.reports.combos(this.session(request), { from, to, branchId });
  }

  @Get('revenue/discounts')
  @ApiOkResponse({
    description:
      'Discounts given by source (program, voucher, member tier, birthday) and revenue by campaign (VIEW_REVENUE at the branch).',
  })
  discountsReport(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('branchId') branchId: string | undefined,
    @Req() request: Request,
  ): Promise<DiscountReport> {
    return this.reports.discounts(this.session(request), { from, to, branchId });
  }

  @Get('online-orders')
  @ApiOkResponse({
    description:
      'Online orders placed in the period: states, money collected, refunded and held, staff-code orders, 20 a page (VIEW_REVENUE at the branch).',
  })
  onlineOrders(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('branchId') branchId: string | undefined,
    @Query('page') page: string | undefined,
    @Req() request: Request,
  ): Promise<OnlineOrderReport> {
    return this.reports.onlineOrders(this.session(request), { from, to, branchId, page });
  }

  @Get('customers/visits')
  @ApiOkResponse({
    description:
      'Completed visits (lượt đến), people, new and returning customers by day, week or month (VIEW_BOOKINGS at the branch).',
  })
  customerVisits(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('branchId') branchId: string | undefined,
    @Query('bucket') bucket: string | undefined,
    @Req() request: Request,
  ): Promise<CustomerVisitsReport> {
    return this.reports.customerVisits(this.session(request), { from, to, branchId, bucket });
  }

  @Get('bookings/funnel')
  @ApiOkResponse({
    description:
      'Bookings, check-ins, cancellations and no-shows by channel (VIEW_BOOKINGS at the branch).',
  })
  bookingFunnel(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('branchId') branchId: string | undefined,
    @Query('bucket') bucket: string | undefined,
    @Req() request: Request,
  ): Promise<BookingFunnelReport> {
    return this.reports.bookingFunnel(this.session(request), { from, to, branchId, bucket });
  }

  @Get('loyalty')
  @ApiOkResponse({
    description:
      'Points issued and taken back, customers per tier, referrals, rewards and birthdays (VIEW_LOYALTY at the branch).',
  })
  loyaltyReport(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('branchId') branchId: string | undefined,
    @Req() request: Request,
  ): Promise<LoyaltyReport> {
    return this.reports.loyalty(this.session(request), { from, to, branchId });
  }

  @Get('customers/top')
  @ApiOkResponse({
    description:
      'The 50 customers who paid most in the period (VIEW_REVENUE and VIEW_LOYALTY at the branch).',
  })
  topCustomersReport(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('branchId') branchId: string | undefined,
    @Req() request: Request,
  ): Promise<TopCustomersReport> {
    return this.reports.topCustomers(this.session(request), { from, to, branchId });
  }

  @Get('staff')
  @ApiOkResponse({
    description:
      'What each employee did: services, time, sales, tips, tour, commission, attendance and leave; facts only (VIEW_STAFF_REPORTS at the branch).',
  })
  staffReport(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('branchId') branchId: string | undefined,
    @Req() request: Request,
  ): Promise<StaffActivityReport> {
    return this.reports.staffActivity(this.session(request), { from, to, branchId });
  }

  @Get('stock/best-sellers')
  @ApiOkResponse({
    description:
      'Units and money per product in the period, most units first (VIEW_INVENTORY at the branch).',
  })
  bestSellers(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('branchId') branchId: string | undefined,
    @Req() request: Request,
  ): Promise<BestSellerReport> {
    return this.reports.bestSellers(this.session(request), { from, to, branchId });
  }

  @Get('stock/low')
  @ApiOkResponse({
    description:
      'Variants at or below their low-stock threshold now (VIEW_INVENTORY at the branch).',
  })
  lowStock(
    @Query('branchId') branchId: string | undefined,
    @Req() request: Request,
  ): Promise<LowStockReport> {
    return this.reports.lowStock(this.session(request), { branchId });
  }

  @Get('stock/slow')
  @ApiOkResponse({
    description:
      'Variants with stock and no sale for the last N days, default 60 (VIEW_INVENTORY; cost needs VIEW_PRODUCT_COST).',
  })
  slowMovers(
    @Query('branchId') branchId: string | undefined,
    @Query('days') days: string | undefined,
    @Req() request: Request,
  ): Promise<SlowMoverReport> {
    return this.reports.slowMovers(this.session(request), { branchId, days });
  }

  @Get('stock/expiry')
  @ApiOkResponse({
    description:
      'Lots expired or expiring within N days, default 60 (VIEW_INVENTORY at the branch).',
  })
  expiringLots(
    @Query('branchId') branchId: string | undefined,
    @Query('days') days: string | undefined,
    @Req() request: Request,
  ): Promise<ExpiryReport> {
    return this.reports.expiringLots(this.session(request), { branchId, days });
  }

  @Get('stock/value')
  @ApiOkResponse({
    description:
      'Stock on hand at cost with the share of units that have a cost (VIEW_INVENTORY and VIEW_PRODUCT_COST).',
  })
  stockValue(
    @Query('branchId') branchId: string | undefined,
    @Req() request: Request,
  ): Promise<StockValueReport> {
    return this.reports.stockValue(this.session(request), { branchId });
  }

  @Get('stock/movements')
  @ApiOkResponse({
    description: 'Stock movements of the period by kind and reason (VIEW_INVENTORY at the branch).',
  })
  stockMovements(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('branchId') branchId: string | undefined,
    @Req() request: Request,
  ): Promise<StockMovementReport> {
    return this.reports.stockMovements(this.session(request), { from, to, branchId });
  }

  @Get('stock/receipts')
  @ApiOkResponse({
    description:
      'Confirmed receipts of the period by supplier (VIEW_INVENTORY; cost needs VIEW_PRODUCT_COST).',
  })
  stockReceipts(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('branchId') branchId: string | undefined,
    @Req() request: Request,
  ): Promise<StockReceiptReport> {
    return this.reports.stockReceipts(this.session(request), { from, to, branchId });
  }

  @Post('export')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'A report as an .xlsx or .csv file (EXPORT_REPORTS and the report permissions at the same branches; at most 100,000 rows; a fresh password for pay and profit data). Writes one audit row, which is why it is a POST.',
  })
  async export(
    @Body() body: ExportDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const header = response.getHeader('x-request-id');
    const file = await this.exports.export(
      this.session(request),
      { ...body },
      typeof header === 'string' ? header : undefined,
    );
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Report-Rows', String(file.rows));
    return new StreamableFile(Buffer.from(file.bytes));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }
}
