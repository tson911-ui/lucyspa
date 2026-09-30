import type {
  DiscountActiveRequest,
  DiscountCreateRequest,
  DiscountDetailResponse,
  DiscountListResponse,
  DiscountTerminateRequest,
  DiscountVersionRequest,
  VoucherActiveRequest,
  VoucherCreateRequest,
} from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { sqlStateOf } from '../booking/customer-command.js';
import { normalizeReason } from '../operations/service-execution.service.js';
import {
  addVersion,
  createDiscount,
  createVoucher,
  getDiscount,
  listDiscounts,
  setDiscountActive,
  setVoucherActive,
  terminateDiscount,
} from './discount.core.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_VERSION = 2_147_483_647;

/**
 * Phase 4 Step 6: Owner configuration of discount programs, versions and voucher codes. Authority
 * (`MANAGE_DISCOUNTS`, `CREATE_VOUCHERS`) is GLOBAL only and decided inside the transaction; the client never
 * chooses a scope. All amounts are configured here and only here.
 */
@Injectable()
export class DiscountService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  list(token: string | undefined): Promise<DiscountListResponse> {
    return this.run(token, undefined, listDiscounts);
  }

  get(token: string | undefined, id: string): Promise<DiscountDetailResponse> {
    return this.runOn(token, id, undefined, getDiscount);
  }

  create(
    token: string | undefined,
    body: DiscountCreateRequest,
    requestId?: string,
  ): Promise<DiscountDetailResponse> {
    return this.run(token, requestId, (context) => createDiscount(context, body));
  }

  async addVersion(
    token: string | undefined,
    id: string,
    body: DiscountVersionRequest,
    requestId?: string,
  ): Promise<DiscountDetailResponse> {
    const expectedVersion = this.version(body.expectedVersion);
    return this.runOn(token, id, requestId, (context, programId) =>
      addVersion(context, programId, {
        expectedVersion,
        nameVi: body.nameVi,
        nameEn: body.nameEn,
        version: body.version,
      }),
    );
  }

  async setActive(
    token: string | undefined,
    id: string,
    body: DiscountActiveRequest,
    requestId?: string,
  ): Promise<DiscountDetailResponse> {
    const expectedVersion = this.version(body.expectedVersion);
    return this.runOn(token, id, requestId, (context, programId) =>
      setDiscountActive(context, programId, { expectedVersion, isActive: body.isActive }),
    );
  }

  async terminate(
    token: string | undefined,
    id: string,
    body: DiscountTerminateRequest,
    requestId?: string,
  ): Promise<DiscountDetailResponse> {
    const expectedVersion = this.version(body.expectedVersion);
    const reason = normalizeReason(body.reason);
    return this.runOn(token, id, requestId, (context, programId) =>
      terminateDiscount(context, programId, { expectedVersion, reason }),
    );
  }

  createVoucher(
    token: string | undefined,
    id: string,
    body: VoucherCreateRequest,
    requestId?: string,
  ): Promise<DiscountDetailResponse> {
    return this.runOn(token, id, requestId, (context, programId) =>
      createVoucher(context, programId, { code: body.code }),
    );
  }

  async setVoucherActive(
    token: string | undefined,
    id: string,
    voucherId: string,
    body: VoucherActiveRequest,
    requestId?: string,
  ): Promise<DiscountDetailResponse> {
    const expectedVersion = this.version(body.expectedVersion);
    if (!UUID.test(voucherId)) throw new AuthError('NOT_FOUND');
    return this.runOn(token, id, requestId, (context, programId) =>
      setVoucherActive(context, programId, voucherId.toLowerCase(), {
        expectedVersion,
        isActive: body.isActive,
      }),
    );
  }

  private version(value: unknown): number {
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > MAX_VERSION
    ) {
      throw new AuthError('VALIDATION_FAILED', 'expectedVersion');
    }
    return value;
  }

  private async runOn<T>(
    token: string | undefined,
    id: string,
    requestId: string | undefined,
    work: (context: AdminContext, id: string) => Promise<T>,
  ): Promise<T> {
    if (!UUID.test(id)) throw new AuthError('NOT_FOUND');
    return this.run(token, requestId, (context) => work(context, id.toLowerCase()));
  }

  private async run<T>(
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
          if (
            ['55P03', '40P01', '40001', '23505', '23P01'].includes(state ?? '') ||
            ['P2002', 'P2034'].includes(Reflect.get(Object(error), 'code'))
          ) {
            throw new AuthError('CONFLICT');
          }
          throw error;
        }
      },
    );
  }
}
