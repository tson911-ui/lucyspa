import type {
  ComboCreateRequest,
  ComboListResponse,
  ComboResponse,
  ComboVersionRequest,
} from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { sqlStateOf } from '../booking/customer-command.js';
import { addComboVersion, createCombo, listCombos } from './combo.core.js';

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
  ) {}

  list(token: string | undefined): Promise<ComboListResponse> {
    return this.run(token, undefined, listCombos);
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
