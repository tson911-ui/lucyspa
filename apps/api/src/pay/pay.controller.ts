import type {
  CommissionRuleRequest,
  InvoiceEarningsResponse,
  SellerCorrectionRequest,
  CommissionRuleResponse,
  CommissionRulesResponse,
  CommissionTargetsResponse,
  SalariesResponse,
  SalaryHistoryResponse,
  SalaryVersionRequest,
  SalaryVersionResponse,
  TourRuleHistoryResponse,
  TourRuleRequest,
  TourRuleResponse,
  TourRulesResponse,
} from '@lucy-spa/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { PayService } from './pay.service.js';

/*
 * Only the contract's fields are accepted (the global pipe forbids unknown ones). Exact rules (amounts, dates, targets, authority) are
 * applied again, strictly, in the core.
 */
class TourRuleDto implements TourRuleRequest {
  @ApiProperty() @IsString() @MaxLength(64) serviceId!: string;
  @ApiProperty() @IsString() @MaxLength(20) amountVnd!: string;
  @ApiProperty() @IsString() @MaxLength(10) effectiveFrom!: string;
  @ApiProperty({ nullable: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(2000)
  reason!: string | null;
}

class CommissionRuleDto implements CommissionRuleRequest {
  @ApiProperty() @IsString() @MaxLength(16) scope!: CommissionRuleRequest['scope'];
  @ApiProperty({ nullable: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(64)
  targetId!: string | null;
  @ApiProperty({ nullable: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(64)
  employeeUserId!: string | null;
  @ApiProperty() @IsString() @MaxLength(20) kind!: CommissionRuleRequest['kind'];
  @ApiProperty() @IsString() @MaxLength(20) value!: string;
  @ApiProperty() @IsString() @MaxLength(10) effectiveFrom!: string;
  @ApiProperty({ nullable: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(2000)
  reason!: string | null;
}

class SellerDto implements SellerCorrectionRequest {
  @ApiProperty() @IsString() @MaxLength(64) employeeUserId!: string;
  @ApiProperty() @IsString() @MaxLength(2000) reason!: string;
}

class SalaryVersionDto implements SalaryVersionRequest {
  @ApiProperty() @IsString() @MaxLength(64) employeeUserId!: string;
  @ApiProperty({ nullable: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(20)
  amountVnd!: string | null;
  @ApiProperty() @IsString() @MaxLength(10) effectiveFrom!: string;
  @ApiProperty({ nullable: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(2000)
  reason!: string | null;
}

/**
 * Phase 7 Wave B: pay configuration. The global guard enforces JSON, exact Origin and CSRF; authority (MANAGE_PAY_RULES, the payroll
 * permissions, MANAGE/VIEW_EMPLOYEE_PAY at the employee's branches) is decided in the service's transaction. Nothing here pays anyone.
 */
@Controller('api/v1/pay')
export class PayController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(PayService) private readonly pay: PayService,
  ) {}

  @Get('tour-rules')
  @ApiOkResponse({
    description:
      'Every active service with its tour amount in force and the next one (MANAGE_PAY_RULES or the payroll permissions).',
  })
  tourRules(@Req() request: Request): Promise<TourRulesResponse> {
    return this.pay.tourRules(this.session(request));
  }

  @Get('tour-rules/:serviceId/history')
  @ApiOkResponse({ description: 'The versions of one service, newest first.' })
  tourHistory(
    @Param('serviceId') serviceId: string,
    @Req() request: Request,
  ): Promise<TourRuleHistoryResponse> {
    return this.pay.tourHistory(this.session(request), serviceId);
  }

  @Post('tour-rules')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Adds a tour amount for a service from a date (MANAGE_PAY_RULES). Append-only.',
  })
  addTourRule(
    @Body() body: TourRuleDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TourRuleResponse> {
    return this.pay.addTourRule(this.session(request), body, this.requestId(response));
  }

  @Get('commission-rules')
  @ApiOkResponse({
    description:
      'The product commission rules with their state, the brands, categories and official employees.',
  })
  commissionRules(@Req() request: Request): Promise<CommissionRulesResponse> {
    return this.pay.commissionRules(this.session(request));
  }

  @Get('commission-rules/products')
  @ApiOkResponse({
    description: 'Product search for a product-scoped rule (two characters at least).',
  })
  commissionProducts(
    @Query('q') query: string | undefined,
    @Req() request: Request,
  ): Promise<CommissionTargetsResponse> {
    return this.pay.commissionProducts(this.session(request), query);
  }

  @Post('commission-rules')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Adds a commission rule from a date (MANAGE_PAY_RULES). Append-only.',
  })
  addCommissionRule(
    @Body() body: CommissionRuleDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CommissionRuleResponse> {
    return this.pay.addCommissionRule(this.session(request), body, this.requestId(response));
  }

  @Get('salaries')
  @ApiOkResponse({
    description: 'Official employees with the salary version in force (those the person may see).',
  })
  salaries(@Req() request: Request): Promise<SalariesResponse> {
    return this.pay.salaries(this.session(request));
  }

  @Get('salaries/:employeeId/history')
  @ApiOkResponse({ description: 'The salary versions of one employee, newest first.' })
  salaryHistory(
    @Param('employeeId') employeeId: string,
    @Req() request: Request,
  ): Promise<SalaryHistoryResponse> {
    return this.pay.salaryHistory(this.session(request), employeeId);
  }

  @Post('salaries')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Adds a salary version for an employee (MANAGE_EMPLOYEE_PAY at their branches). Append-only.',
  })
  addSalaryVersion(
    @Body() body: SalaryVersionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SalaryVersionResponse> {
    return this.pay.addSalaryVersion(this.session(request), body, this.requestId(response));
  }

  @Get('invoices/:invoiceId/earnings')
  @ApiOkResponse({
    description:
      'The tour and commission earnings of one invoice, with the lines (MANAGE_PAYROLL or APPROVE_PAYROLL).',
  })
  invoiceEarnings(
    @Param('invoiceId') invoiceId: string,
    @Req() request: Request,
  ): Promise<InvoiceEarningsResponse> {
    return this.pay.invoiceEarnings(this.session(request), invoiceId);
  }

  @Post('product-lines/:lineId/seller')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Corrects who sold a product line after finalization (MANAGE_PAYROLL, reason). Audited; the old earning is reversed, the new seller earns.',
  })
  correctSeller(
    @Param('lineId') lineId: string,
    @Body() body: SellerDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InvoiceEarningsResponse> {
    return this.pay.correctSeller(this.session(request), lineId, body, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}

void IsOptional;
