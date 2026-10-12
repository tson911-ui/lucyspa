import type { RefundReport, ReportRegistryResponse, RevenueReport } from '@lucy-spa/contracts';
import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { ReportsService } from './reports.service.js';

/**
 * Phase 8: the reports. Every route is a GET; authority (the permissions of each report at each branch) is decided inside the
 * read-only frame from the person's own authority graph.
 */
@Controller('api/v1/reports')
export class ReportsController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(ReportsService) private readonly reports: ReportsService,
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

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }
}
