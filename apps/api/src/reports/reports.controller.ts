import {
  REPORT_EXPORT_FORMATS,
  type RefundReport,
  type ReportExportRequest,
  type ReportRegistryResponse,
  type RevenueReport,
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
