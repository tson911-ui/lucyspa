import type {
  ChatRequestList,
  ChatRequestRow,
  ChatRequestStatusRequest,
} from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { sqlStateOf } from '../booking/customer-command.js';
import * as inbox from './chat-requests.core.js';

/** The callback inbox's commands (see `chat-requests.core.ts`): authority is decided inside each command. */
@Injectable()
export class ChatRequestService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  list(
    token: string | undefined,
    query: { status?: string | undefined; page?: number | undefined },
  ): Promise<ChatRequestList> {
    return this.run(token, undefined, (context) => inbox.listRequests(context, query));
  }

  setStatus(
    token: string | undefined,
    id: string,
    body: ChatRequestStatusRequest,
    requestId?: string,
  ): Promise<ChatRequestRow> {
    return this.run(token, requestId, (context) => inbox.setRequestStatus(context, id, body));
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
