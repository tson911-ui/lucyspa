import type {
  SupplierSourceCreateRequest,
  SupplierSourceEditRequest,
  SupplierSourceListResponse,
  SupplierSourcePermissionRequest,
  SupplierSourceResponse,
  SupplierSourceVersionRequest,
} from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { sqlStateOf } from '../booking/customer-command.js';
import * as core from './supplier-source.core.js';

/**
 * Phase 9 P9-2: supplier source administration (`MANAGE_SUPPLIER_SOURCES`, `REVIEW_SUPPLIER_IMPORTS` to read; decided inside each
 * command). The wrapper turns a retryable lock or a unique or guard conflict that the pre-checks could not see into CONFLICT.
 */
@Injectable()
export class SupplierSourceService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  list(token: string | undefined): Promise<SupplierSourceListResponse> {
    return this.run(token, undefined, (context) => core.listSources(context));
  }

  create(token: string | undefined, body: SupplierSourceCreateRequest, requestId?: string) {
    return this.run(token, requestId, (context) => core.createSource(context, body));
  }

  edit(token: string | undefined, id: string, body: SupplierSourceEditRequest, requestId?: string) {
    return this.run(token, requestId, (context) => core.editSource(context, id, body));
  }

  permission(
    token: string | undefined,
    id: string,
    body: SupplierSourcePermissionRequest,
    requestId?: string,
  ) {
    return this.run(token, requestId, (context) => core.recordPermission(context, id, body));
  }

  confirm(
    token: string | undefined,
    id: string,
    body: SupplierSourceVersionRequest,
    requestId?: string,
  ) {
    return this.run(token, requestId, (context) => core.confirmPermission(context, id, body));
  }

  enable(
    token: string | undefined,
    id: string,
    body: SupplierSourceVersionRequest,
    requestId?: string,
  ) {
    return this.run(token, requestId, (context) => core.enableSource(context, id, body));
  }

  disable(
    token: string | undefined,
    id: string,
    body: SupplierSourceVersionRequest,
    requestId?: string,
  ) {
    return this.run(token, requestId, (context) => core.disableSource(context, id, body));
  }

  private run<T extends SupplierSourceListResponse | SupplierSourceResponse>(
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
