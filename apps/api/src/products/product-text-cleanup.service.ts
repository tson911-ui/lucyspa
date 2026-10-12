import type {
  ProductTextCleanupApplyRequest,
  ProductTextCleanupApplyResponse,
  ProductTextCleanupDetailResponse,
  ProductTextCleanupPreviewResponse,
} from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { sqlStateOf } from '../booking/customer-command.js';
import * as core from './product-text-cleanup.core.js';

/**
 * Claude integration CI-0b: the supplier-comment cleanup of the product descriptions. Authority is decided inside each command
 * (`MANAGE_PRODUCTS`, GLOBAL). A lock or version conflict the pre-checks could not see becomes CONFLICT.
 */
@Injectable()
export class ProductTextCleanupService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  preview(token: string | undefined): Promise<ProductTextCleanupPreviewResponse> {
    return this.run(token, undefined, (context) => core.previewCleanup(context));
  }

  detail(token: string | undefined, id: string): Promise<ProductTextCleanupDetailResponse> {
    return this.run(token, undefined, (context) => core.previewOne(context, id));
  }

  apply(
    token: string | undefined,
    body: ProductTextCleanupApplyRequest,
    requestId?: string,
  ): Promise<ProductTextCleanupApplyResponse> {
    // Up to 100 products with their audit lines in one transaction: above Prisma's 5 seconds, still bounded.
    return this.run(token, requestId, (context) => core.applyCleanup(context, body), 60_000);
  }

  private run<T>(
    token: string | undefined,
    requestId: string | undefined,
    work: (context: AdminContext) => Promise<T>,
    timeoutMs?: number,
  ): Promise<T> {
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      { exclusive: false, requestId, ...(timeoutMs ? { timeoutMs } : {}) },
      async (context) => {
        try {
          return await work(context);
        } catch (error) {
          if (error instanceof AuthError) throw error;
          const meta = Reflect.get(Object(error), 'meta');
          const state = sqlStateOf(error) ?? (meta ? Reflect.get(Object(meta), 'code') : undefined);
          if (
            ['55P03', '40P01', '40001', '23505', '23P01', '23514', '23503'].includes(state ?? '') ||
            ['P2002', 'P2034', 'P2003'].includes(Reflect.get(Object(error), 'code'))
          ) {
            throw new AuthError('CONFLICT');
          }
          throw error;
        }
      },
    );
  }
}
