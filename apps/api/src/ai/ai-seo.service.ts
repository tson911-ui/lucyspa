import type {
  AiSeoApplyRequest,
  AiSeoApplyResponse,
  AiSeoCreateRequest,
  AiSeoCreateResponse,
  AiSeoDetail,
  AiSeoEditRequest,
  AiSeoList,
  AiSeoPreview,
  AiSeoRegenerateRequest,
  AiSeoRejectRequest,
  AiSeoVersioned,
} from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { sqlStateOf } from '../booking/customer-command.js';
import * as seo from './ai-seo.core.js';

/** The commands of the search-description drafts (see `ai-seo.core.ts`): authority is decided inside each command. */
@Injectable()
export class AiSeoService {
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
    query: { status?: string | undefined; kind?: string | undefined; page?: number | undefined },
  ): Promise<AiSeoList> {
    return this.run(token, undefined, (context) => seo.listSeoDrafts(context, query));
  }

  preview(
    token: string | undefined,
    query: { scope?: unknown; serviceIds?: unknown },
  ): Promise<AiSeoPreview> {
    return this.run(token, undefined, (context) => seo.previewSeoCreate(context, query));
  }

  create(
    token: string | undefined,
    body: AiSeoCreateRequest,
    requestId?: string,
  ): Promise<AiSeoCreateResponse> {
    return this.run(token, requestId, (context) => seo.createSeoDrafts(context, body), 60_000);
  }

  detail(token: string | undefined, id: string): Promise<AiSeoDetail> {
    return this.run(token, undefined, (context) => seo.getSeoDraft(context, id));
  }

  edit(
    token: string | undefined,
    id: string,
    body: AiSeoEditRequest,
    requestId?: string,
  ): Promise<AiSeoDetail> {
    return this.run(token, requestId, (context) => seo.editSeoDraft(context, id, body));
  }

  apply(
    token: string | undefined,
    id: string,
    body: AiSeoApplyRequest,
    requestId?: string,
  ): Promise<AiSeoApplyResponse> {
    return this.run(token, requestId, (context) => seo.applySeoDraft(context, id, body));
  }

  reject(
    token: string | undefined,
    id: string,
    body: AiSeoRejectRequest,
    requestId?: string,
  ): Promise<AiSeoDetail> {
    return this.run(token, requestId, (context) => seo.rejectSeoDraft(context, id, body));
  }

  regenerate(
    token: string | undefined,
    id: string,
    body: AiSeoRegenerateRequest,
    requestId?: string,
  ): Promise<AiSeoDetail> {
    return this.run(token, requestId, (context) => seo.regenerateSeoDraft(context, id, body));
  }

  retry(
    token: string | undefined,
    id: string,
    body: AiSeoVersioned,
    requestId?: string,
  ): Promise<AiSeoDetail> {
    return this.run(token, requestId, (context) => seo.retrySeoDraft(context, id, body));
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
