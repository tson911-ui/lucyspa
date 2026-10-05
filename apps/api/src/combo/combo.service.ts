import type {
  ComboCreateRequest,
  ComboFrozenListResponse,
  ComboSoldPageResponse,
  ComboListResponse,
  ComboRestoreRequest,
  ComboResponse,
  ComboUsageItemResponse,
  ComboUsagePageResponse,
  ComboVersionRequest,
} from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { sqlStateOf } from '../booking/customer-command.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { addComboVersion, createCombo, listCombos } from './combo.core.js';
import { canSeeSold, canSeeValue, listSold, soldPageOf, soldStatusOf } from './combo-sold.core.js';
import { listFrozen, listUsage, restoreUsage } from './combo-usage.core.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Phase 5 P5-7: combo definitions. `MANAGE_COMBOS` (GLOBAL_ONLY) is decided inside each command. */
@Injectable()
export class ComboService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
  ) {}

  list(token: string | undefined): Promise<ComboListResponse> {
    return this.run(token, undefined, listCombos);
  }

  /** The usage history (RESTORE_COMBO_SESSIONS or MANAGE_COMBOS, global). */
  usage(token: string | undefined, query: { page?: string }): Promise<ComboUsagePageResponse> {
    return this.run(token, undefined, (context) => listUsage(context, query));
  }

  /** Every combo sold, all states, with a status filter and totals (RESTORE_COMBO_SESSIONS or MANAGE_COMBOS, global). */
  sold(
    token: string | undefined,
    query: { page?: string; status?: string },
  ): Promise<ComboSoldPageResponse> {
    return this.run(token, undefined, async (context) => {
      if (!canSeeSold(context)) throw new AuthError('FORBIDDEN');
      return listSold(context.tx, context.now, {
        ownerUserId: null,
        status: soldStatusOf(query.status),
        page: soldPageOf(query.page),
        withValue: canSeeValue(context),
      });
    });
  }

  /** The combos frozen by the reversal of their sale (VIEW_LOYALTY_EXCEPTIONS, global). */
  frozen(token: string | undefined): Promise<ComboFrozenListResponse> {
    return this.run(token, undefined, listFrozen);
  }

  /** Restores a mistaken use as an offset entry (RESTORE_COMBO_SESSIONS, fresh re-authentication). */
  async restore(
    token: string | undefined,
    consumptionId: string,
    body: ComboRestoreRequest,
    requestId?: string,
  ): Promise<ComboUsageItemResponse> {
    if (!UUID.test(consumptionId)) throw new AuthError('NOT_FOUND');
    const id = consumptionId.toLowerCase();
    return this.run(token, requestId, (context) =>
      restoreUsage(context, id, { reason: body.reason }, this.environment.auth.freshAuthSeconds),
    );
  }

  async create(
    token: string | undefined,
    body: ComboCreateRequest,
    requestId?: string,
  ): Promise<ComboResponse> {
    if (typeof body.serviceId !== 'string' || !UUID.test(body.serviceId)) {
      throw new AuthError('VALIDATION_FAILED', 'serviceId');
    }
    const input = { ...body, serviceId: body.serviceId.toLowerCase() };
    return this.run(token, requestId, (context) => createCombo(context, input));
  }

  async addVersion(
    token: string | undefined,
    comboId: string,
    body: ComboVersionRequest,
    requestId?: string,
  ): Promise<ComboResponse> {
    if (!UUID.test(comboId)) throw new AuthError('NOT_FOUND');
    const id = comboId.toLowerCase();
    return this.run(token, requestId, (context) => addComboVersion(context, id, body));
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
