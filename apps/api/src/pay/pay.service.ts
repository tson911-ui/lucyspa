import type {
  CommissionRuleRequest,
  InvoiceEarningsResponse,
  InvoiceTipsResponse,
  StaffCodeCreateRequest,
  StaffCodeResetRequest,
  StaffCodesResponse,
  TipRequest,
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
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { sqlStateOf } from '../booking/customer-command.js';
import * as earnings from './pay-earnings.core.js';
import * as rules from './pay-rules.core.js';
import * as salary from './pay-salary.core.js';
import * as codes from './staff-codes.core.js';
import * as tips from './tips.core.js';

/**
 * Phase 7 Wave B: pay configuration (tour rules, commission rules, salary versions). Authority is decided inside every command; a retryable
 * lock or a unique/guard conflict the pre-checks could not see becomes CONFLICT.
 */
@Injectable()
export class PayService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  tourRules(token: string | undefined): Promise<TourRulesResponse> {
    return this.run(token, undefined, (context) => rules.listTourRules(context));
  }

  tourHistory(token: string | undefined, serviceId: string): Promise<TourRuleHistoryResponse> {
    return this.run(token, undefined, (context) => rules.tourHistory(context, serviceId));
  }

  addTourRule(
    token: string | undefined,
    body: TourRuleRequest,
    requestId?: string,
  ): Promise<TourRuleResponse> {
    return this.run(token, requestId, (context) => rules.addTourRule(context, { ...body }));
  }

  commissionRules(token: string | undefined): Promise<CommissionRulesResponse> {
    return this.run(token, undefined, (context) => rules.listCommissionRules(context));
  }

  commissionProducts(
    token: string | undefined,
    query: unknown,
  ): Promise<CommissionTargetsResponse> {
    return this.run(token, undefined, (context) => rules.searchProducts(context, query));
  }

  addCommissionRule(
    token: string | undefined,
    body: CommissionRuleRequest,
    requestId?: string,
  ): Promise<CommissionRuleResponse> {
    return this.run(token, requestId, (context) => rules.addCommissionRule(context, { ...body }));
  }

  salaries(token: string | undefined): Promise<SalariesResponse> {
    return this.run(token, undefined, (context) => salary.listSalaries(context));
  }

  salaryHistory(token: string | undefined, employeeId: string): Promise<SalaryHistoryResponse> {
    return this.run(token, undefined, (context) => salary.salaryHistory(context, employeeId));
  }

  addSalaryVersion(
    token: string | undefined,
    body: SalaryVersionRequest,
    requestId?: string,
  ): Promise<SalaryVersionResponse> {
    return this.run(token, requestId, (context) => salary.addSalaryVersion(context, { ...body }));
  }

  invoiceEarnings(token: string | undefined, invoiceId: string): Promise<InvoiceEarningsResponse> {
    return this.run(token, undefined, (context) => earnings.invoiceEarnings(context, invoiceId));
  }

  correctSeller(
    token: string | undefined,
    lineId: string,
    body: SellerCorrectionRequest,
    requestId?: string,
  ): Promise<InvoiceEarningsResponse> {
    return this.run(token, requestId, (context) =>
      earnings.correctSeller(context, lineId, { ...body }),
    );
  }

  invoiceTips(token: string | undefined, invoiceId: string): Promise<InvoiceTipsResponse> {
    return this.run(token, undefined, (context) => tips.invoiceTips(context, invoiceId));
  }

  recordTip(
    token: string | undefined,
    body: TipRequest,
    requestId?: string,
  ): Promise<InvoiceTipsResponse> {
    return this.run(token, requestId, (context) => tips.recordTip(context, { ...body }));
  }

  reverseTip(
    token: string | undefined,
    tipId: string,
    body: TipReverseRequest,
    requestId?: string,
  ): Promise<InvoiceTipsResponse> {
    return this.run(token, requestId, (context) => tips.reverseTip(context, tipId, { ...body }));
  }

  staffCodes(token: string | undefined): Promise<StaffCodesResponse> {
    return this.run(token, undefined, (context) => codes.listStaffCodes(context));
  }

  createStaffCode(
    token: string | undefined,
    body: StaffCodeCreateRequest,
    requestId?: string,
  ): Promise<StaffCodesResponse> {
    return this.run(token, requestId, (context) => codes.createStaffCode(context, { ...body }));
  }

  resetStaffCode(
    token: string | undefined,
    employeeId: string,
    body: StaffCodeResetRequest,
    requestId?: string,
  ): Promise<StaffCodesResponse> {
    return this.run(token, requestId, (context) =>
      codes.resetStaffCode(context, employeeId, { ...body }),
    );
  }

  private run<T>(
    token: string | undefined,
    requestId: string | undefined,
    work: (context: AdminContext) => Promise<T>,
  ): Promise<T> {
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      { exclusive: false, requestId },
      async (context) => {
        try {
          return await work(context);
        } catch (error) {
          if (error instanceof AuthError) throw error;
          const meta = Reflect.get(Object(error), 'meta');
          const state = sqlStateOf(error) ?? (meta ? Reflect.get(Object(meta), 'code') : undefined);
          if (state === '23505' || Reflect.get(Object(error), 'code') === 'P2002') {
            throw new AuthError('PAY_VERSION_EXISTS');
          }
          if (
            ['55P03', '40P01', '40001', '23P01', '23514', '23503'].includes(state ?? '') ||
            ['P2034', 'P2003'].includes(Reflect.get(Object(error), 'code'))
          ) {
            throw new AuthError('CONFLICT');
          }
          throw error;
        }
      },
    );
  }
}
