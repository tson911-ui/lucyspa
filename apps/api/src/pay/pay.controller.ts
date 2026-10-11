import type {
  CommissionRuleRequest,
  InvoiceEarningsResponse,
  InvoiceTipsResponse,
  MyPayslipsResponse,
  PayRunCloseRequest,
  PayslipListResponse,
  PayslipPayRequest,
  PayslipReverseRequest,
  PayslipView,
  SalaryAdvanceApproveRequest,
  SalaryAdvanceCancelRequest,
  SalaryAdvancePayRequest,
  SalaryAdvanceRequest,
  SalaryAdvanceWriteOffRequest,
  SalaryAdvancesResponse,
  PayRunCreateRequest,
  PayRunDetailResponse,
  PayRunItemRequest,
  PayRunItemVoidRequest,
  PayRunListResponse,
  PayRunPaymentDayRequest,
  PayRunRefreshRequest,
  StaffCodeCreateRequest,
  StaffCodeResetRequest,
  StaffCodesResponse,
  TipReverseRequest,
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
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
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

class RunCloseDto implements PayRunCloseRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
}

class SlipPayDto implements PayslipPayRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
  @ApiProperty() @IsString() @MaxLength(64) fundId!: string;
  @ApiProperty({ nullable: true, type: [String] })
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  payslipIds!: string[] | null;
  @ApiProperty() @IsString() @MaxLength(64) clientRequestId!: string;
}

class SlipReverseDto implements PayslipReverseRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
  @ApiProperty() @IsString() @MaxLength(2000) reason!: string;
}

class AdvanceDto implements SalaryAdvanceRequest {
  @ApiProperty() @IsString() @MaxLength(64) employeeUserId!: string;
  @ApiProperty() @IsString() @MaxLength(20) amountVnd!: string;
  @ApiProperty() @IsString() @MaxLength(2000) reason!: string;
  @ApiProperty() @IsString() @MaxLength(64) clientRequestId!: string;
}

class AdvanceApproveDto implements SalaryAdvanceApproveRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
}

class AdvanceCancelDto implements SalaryAdvanceCancelRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
  @ApiProperty() @IsString() @MaxLength(2000) reason!: string;
}

class AdvancePayDto implements SalaryAdvancePayRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
  @ApiProperty() @IsString() @MaxLength(64) fundId!: string;
  @ApiProperty() @IsString() @MaxLength(64) clientRequestId!: string;
}

class AdvanceWriteOffDto implements SalaryAdvanceWriteOffRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
  @ApiProperty() @IsString() @MaxLength(2000) reason!: string;
}

class RunCreateDto implements PayRunCreateRequest {
  @ApiProperty() @IsString() @MaxLength(7) month!: string;
}

class RunRefreshDto implements PayRunRefreshRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
}

class RunPaymentDayDto implements PayRunPaymentDayRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
  @ApiProperty() @IsString() @MaxLength(10) paymentDay!: string;
}

class RunItemDto implements PayRunItemRequest {
  @ApiProperty() @IsString() @MaxLength(64) employeeUserId!: string;
  @ApiProperty({ enum: ['BONUS', 'ADJUSTMENT', 'DEDUCTION'] }) @IsString() @MaxLength(16) kind!:
    'BONUS' | 'ADJUSTMENT' | 'DEDUCTION';
  @ApiProperty() @IsString() @MaxLength(20) amountVnd!: string;
  @ApiProperty() @IsString() @MaxLength(2000) reason!: string;
  @ApiProperty() @IsString() @MaxLength(64) clientRequestId!: string;
}

class RunItemVoidDto implements PayRunItemVoidRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
  @ApiProperty() @IsString() @MaxLength(2000) reason!: string;
}

class StaffCodeDto implements StaffCodeCreateRequest {
  @ApiProperty() @IsString() @MaxLength(64) employeeUserId!: string;
}

class StaffCodeResetDto implements StaffCodeResetRequest {
  @ApiProperty() @IsString() @MaxLength(2000) reason!: string;
}

class TipReverseDto implements TipReverseRequest {
  @ApiProperty() @IsString() @MaxLength(2000) reason!: string;
  @ApiProperty() @IsString() @MaxLength(64) clientRequestId!: string;
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

  @Get('invoices/:invoiceId/tips')
  @ApiOkResponse({
    description:
      'The tips the customer added to the payments of one invoice, the KTVs who served on it and whether "Thêm tip" can be offered with the next PayOS payment (COLLECT_PAYMENTS, VIEW_INVOICES or a payroll permission). Tips are never recorded by staff.',
  })
  invoiceTips(
    @Param('invoiceId') invoiceId: string,
    @Req() request: Request,
  ): Promise<InvoiceTipsResponse> {
    return this.pay.invoiceTips(this.session(request), invoiceId);
  }

  @Post('tips/:tipId/reverse')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'The Owner-only correction: reverses a tip in full while no payroll run has taken it (APPROVE_PAYROLL, shop-wide; reason; audited).',
  })
  reverseTip(
    @Param('tipId') tipId: string,
    @Body() body: TipReverseDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InvoiceTipsResponse> {
    return this.pay.reverseTip(this.session(request), tipId, body, this.requestId(response));
  }

  @Get('referral-codes')
  @ApiOkResponse({
    description:
      'The staff referral codes for online orders: official employees and their code (MANAGE_PAY_RULES, MANAGE_PAYROLL or APPROVE_PAYROLL).',
  })
  staffCodes(@Req() request: Request): Promise<StaffCodesResponse> {
    return this.pay.staffCodes(this.session(request));
  }

  @Post('referral-codes')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Gives an official employee a referral code (MANAGE_PAY_RULES). Never automatic.',
  })
  createStaffCode(
    @Body() body: StaffCodeDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StaffCodesResponse> {
    return this.pay.createStaffCode(this.session(request), body, this.requestId(response));
  }

  @Post('referral-codes/:employeeId/reset')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Switches the current code of an official employee off and issues a new one (MANAGE_PAY_RULES, reason). The old code stays as history.',
  })
  resetStaffCode(
    @Param('employeeId') employeeId: string,
    @Body() body: StaffCodeResetDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StaffCodesResponse> {
    return this.pay.resetStaffCode(
      this.session(request),
      employeeId,
      body,
      this.requestId(response),
    );
  }

  @Get('runs')
  @ApiOkResponse({
    description: 'The payroll runs, newest month first (MANAGE_PAYROLL or APPROVE_PAYROLL).',
  })
  payRuns(@Req() request: Request): Promise<PayRunListResponse> {
    return this.pay.payRuns(this.session(request));
  }

  @Get('runs/:runId')
  @ApiOkResponse({
    description:
      'One payroll run with its people, items, warnings and totals (the preview of a draft).',
  })
  payRun(@Param('runId') runId: string, @Req() request: Request): Promise<PayRunDetailResponse> {
    return this.pay.payRun(this.session(request), runId);
  }

  @Post('runs')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Starts the draft of one month (MANAGE_PAYROLL). Nothing is paid.',
  })
  createPayRun(
    @Body() body: RunCreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PayRunDetailResponse> {
    return this.pay.createPayRun(this.session(request), body, this.requestId(response));
  }

  @Post('runs/:runId/refresh')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Rebuilds the generated items of a draft from the sources; manual items stay (MANAGE_PAYROLL).',
  })
  refreshPayRun(
    @Param('runId') runId: string,
    @Body() body: RunRefreshDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PayRunDetailResponse> {
    return this.pay.refreshPayRun(this.session(request), runId, body, this.requestId(response));
  }

  @Post('runs/:runId/payment-day')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Chooses the day the payslips and tips are paid out, while the run is a draft (MANAGE_PAYROLL).',
  })
  setPayRunPaymentDay(
    @Param('runId') runId: string,
    @Body() body: RunPaymentDayDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PayRunDetailResponse> {
    return this.pay.setPayRunPaymentDay(
      this.session(request),
      runId,
      body,
      this.requestId(response),
    );
  }

  @Post('runs/:runId/items')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Adds a bonus, adjustment or deduction with a reason to a draft (MANAGE_PAYROLL).',
  })
  addPayRunItem(
    @Param('runId') runId: string,
    @Body() body: RunItemDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PayRunDetailResponse> {
    return this.pay.addPayRunItem(this.session(request), runId, body, this.requestId(response));
  }

  @Post('runs/:runId/items/:itemId/void')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Voids a manual item of a draft, with a reason; it is never edited or deleted (MANAGE_PAYROLL).',
  })
  voidPayRunItem(
    @Param('runId') runId: string,
    @Param('itemId') itemId: string,
    @Body() body: RunItemVoidDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PayRunDetailResponse> {
    return this.pay.voidPayRunItem(
      this.session(request),
      runId,
      itemId,
      body,
      this.requestId(response),
    );
  }

  @Get('advances')
  @ApiOkResponse({
    description:
      'Salary advances, who can have one, and the funds one can be paid from (MANAGE_PAYROLL or APPROVE_PAYROLL).',
  })
  advances(@Req() request: Request): Promise<SalaryAdvancesResponse> {
    return this.pay.advances(this.session(request));
  }

  @Post('advances')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Requests an advance for an official employee with a confirmed salary: at most half of it (MANAGE_PAYROLL).',
  })
  requestAdvance(
    @Body() body: AdvanceDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SalaryAdvancesResponse> {
    return this.pay.requestAdvance(this.session(request), body, this.requestId(response));
  }

  @Post('advances/:id/approve')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Approves a request (APPROVE_PAYROLL). Nothing is paid.' })
  approveAdvance(
    @Param('id') id: string,
    @Body() body: AdvanceApproveDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SalaryAdvancesResponse> {
    return this.pay.approveAdvance(this.session(request), id, body, this.requestId(response));
  }

  @Post('advances/:id/cancel')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Cancels a request or an approved advance that has not been paid, with a reason.',
  })
  cancelAdvance(
    @Param('id') id: string,
    @Body() body: AdvanceCancelDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SalaryAdvancesResponse> {
    return this.pay.cancelAdvance(this.session(request), id, body, this.requestId(response));
  }

  @Post('advances/:id/pay')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Pays an approved advance out of a fund (APPROVE_PAYROLL + a fresh password). Writes the fund outflow in the same transaction.',
  })
  payAdvance(
    @Param('id') id: string,
    @Body() body: AdvancePayDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SalaryAdvancesResponse> {
    return this.pay.payAdvance(this.session(request), id, body, this.requestId(response));
  }

  @Post('advances/:id/write-off')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Writes off what is still owed on a paid advance, with a reason (APPROVE_PAYROLL + a fresh password).',
  })
  writeOffAdvance(
    @Param('id') id: string,
    @Body() body: AdvanceWriteOffDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SalaryAdvancesResponse> {
    return this.pay.writeOffAdvance(this.session(request), id, body, this.requestId(response));
  }

  @Post('runs/:runId/close')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Closes a draft (APPROVE_PAYROLL + a fresh password): freezes it, takes its sources, makes the payslips. Nobody is paid.',
  })
  closePayRun(
    @Param('runId') runId: string,
    @Body() body: RunCloseDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PayRunDetailResponse> {
    return this.pay.closePayRun(this.session(request), runId, body, this.requestId(response));
  }

  @Get('runs/:runId/payslips')
  @ApiOkResponse({
    description:
      'The payslips of a closed run and the funds they can be paid from (MANAGE_PAYROLL or APPROVE_PAYROLL).',
  })
  payslips(@Param('runId') runId: string, @Req() request: Request): Promise<PayslipListResponse> {
    return this.pay.payslips(this.session(request), runId);
  }

  @Get('payslips/:payslipId')
  @ApiOkResponse({ description: 'One payslip with its items (MANAGE_PAYROLL or APPROVE_PAYROLL).' })
  payslip(@Param('payslipId') payslipId: string, @Req() request: Request): Promise<PayslipView> {
    return this.pay.payslip(this.session(request), payslipId);
  }

  @Post('runs/:runId/pay')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Marks payslips paid and writes the fund outflows (APPROVE_PAYROLL + a fresh password; not before the payment day).',
  })
  payPayslips(
    @Param('runId') runId: string,
    @Body() body: SlipPayDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PayslipListResponse> {
    return this.pay.payPayslips(this.session(request), runId, body, this.requestId(response));
  }

  @Post('payslips/:payslipId/reverse')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Reverses a mistaken paid mark with correcting book entries (APPROVE_PAYROLL + a fresh password, reason).',
  })
  reversePayslip(
    @Param('payslipId') payslipId: string,
    @Body() body: SlipReverseDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PayslipView> {
    return this.pay.reversePayslip(
      this.session(request),
      payslipId,
      body,
      this.requestId(response),
    );
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

/**
 * "Phiếu lương của tôi / My payslips": the signed-in employee's own payslips, read-only. No permission is needed for one's own pay and nobody
 * else's is ever returned (a payslip that is not theirs is "not found").
 */
@Controller('api/v1/me/payslips')
export class MyPayslipsController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(PayService) private readonly pay: PayService,
  ) {}

  @Get()
  @ApiOkResponse({ description: 'Own payslips, newest first.' })
  list(@Req() request: Request): Promise<MyPayslipsResponse> {
    return this.pay.myPayslips(
      sessionCookie(request.headers.cookie, this.environment.auth.cookieName),
    );
  }

  @Get(':payslipId')
  @ApiOkResponse({ description: 'One own payslip with its items.' })
  one(@Param('payslipId') payslipId: string, @Req() request: Request): Promise<PayslipView> {
    return this.pay.myPayslip(
      sessionCookie(request.headers.cookie, this.environment.auth.cookieName),
      payslipId,
    );
  }
}
