import type {
  AiDraftApplyRequest,
  AiDraftApplyResponse,
  AiDraftDetail,
  AiDraftEditRequest,
  AiDraftList,
  AiDraftRegenerateRequest,
  AiDraftRejectRequest,
  AiDraftRetryRequest,
  AiKeyCheckRequest,
  AiPageApproveRequest,
  AiPageApproveResponse,
  AiPageResponse,
  AiPageViewRequest,
  AiRunCommandRequest,
  AiRunCreateRequest,
  AiRunList,
  AiRunPreview,
  AiRunRow,
  AiRunUnlockRequest,
  AiSettingsEditRequest,
  AiSettingsResponse,
} from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { sqlStateOf } from '../booking/customer-command.js';
import * as drafts from './ai-drafts.core.js';
import * as runs from './ai-runs.core.js';
import * as settings from './ai-settings.core.js';

/**
 * Claude integration Wave A: the AI module's commands. Authority is decided inside each command (`MANAGE_AI_SETTINGS` for the settings,
 * `USE_AI_CONTENT` for the drafts, both GLOBAL). A lock or version conflict the pre-checks could not see becomes CONFLICT. The API never
 * calls Anthropic for the rewrite: it writes runs and items, and the worker does the calls.
 */
@Injectable()
export class AiService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  /** The process environment (a test replaces it); only whether a key exists is ever read from it. */
  env: NodeJS.ProcessEnv = process.env;

  getSettings(token: string | undefined): Promise<AiSettingsResponse> {
    return this.run(token, undefined, (context) => settings.getSettings(context, this.env));
  }

  editSettings(
    token: string | undefined,
    body: AiSettingsEditRequest,
    requestId?: string,
  ): Promise<AiSettingsResponse> {
    return this.run(token, requestId, (context) => settings.editSettings(context, body, this.env));
  }

  requestKeyCheck(
    token: string | undefined,
    body: AiKeyCheckRequest,
    requestId?: string,
  ): Promise<AiSettingsResponse> {
    return this.run(token, requestId, (context) =>
      settings.requestKeyCheck(context, body, this.env),
    );
  }

  listDrafts(
    token: string | undefined,
    query: { status?: string | undefined; page?: number | undefined },
  ): Promise<AiDraftList> {
    return this.run(token, undefined, (context) => drafts.listDrafts(context, query));
  }

  getDraft(token: string | undefined, id: string): Promise<AiDraftDetail> {
    return this.run(token, undefined, (context) => drafts.getDraft(context, id));
  }

  viewDraft(token: string | undefined, id: string, requestId?: string): Promise<AiDraftDetail> {
    return this.run(token, requestId, (context) => drafts.viewDraft(context, id));
  }

  editDraft(
    token: string | undefined,
    id: string,
    body: AiDraftEditRequest,
    requestId?: string,
  ): Promise<AiDraftDetail> {
    return this.run(token, requestId, (context) => drafts.editDraft(context, id, body));
  }

  applyDraft(
    token: string | undefined,
    id: string,
    body: AiDraftApplyRequest,
    requestId?: string,
  ): Promise<AiDraftApplyResponse> {
    return this.run(token, requestId, (context) => drafts.applyDraft(context, id, body));
  }

  rejectDraft(
    token: string | undefined,
    id: string,
    body: AiDraftRejectRequest,
    requestId?: string,
  ): Promise<AiDraftDetail> {
    return this.run(token, requestId, (context) => drafts.rejectDraft(context, id, body));
  }

  regenerateDraft(
    token: string | undefined,
    id: string,
    body: AiDraftRegenerateRequest,
    requestId?: string,
  ): Promise<AiDraftDetail> {
    return this.run(token, requestId, (context) => drafts.regenerateDraft(context, id, body));
  }

  retryDraft(
    token: string | undefined,
    id: string,
    body: AiDraftRetryRequest,
    requestId?: string,
  ): Promise<AiDraftDetail> {
    return this.run(token, requestId, (context) => drafts.retryDraft(context, id, body));
  }

  pageOfDrafts(
    token: string | undefined,
    query: { page?: number | undefined },
  ): Promise<AiPageResponse> {
    return this.run(token, undefined, (context) => drafts.pageOfDrafts(context, query));
  }

  async viewPage(
    token: string | undefined,
    body: AiPageViewRequest,
    requestId?: string,
  ): Promise<{ marked: number }> {
    return {
      marked: await this.run(token, requestId, (context) => drafts.viewPage(context, body)),
    };
  }

  approvePage(
    token: string | undefined,
    body: AiPageApproveRequest,
    requestId?: string,
  ): Promise<AiPageApproveResponse> {
    // A page approval writes up to 20 products and their audit rows: it is allowed more time than one command.
    return this.run(token, requestId, (context) => drafts.approvePage(context, body), 60_000);
  }

  previewRun(
    token: string | undefined,
    query: { scope?: unknown; limit?: unknown; productIds?: unknown },
  ): Promise<AiRunPreview> {
    return this.run(token, undefined, (context) => runs.previewRun(context, query));
  }

  createRun(
    token: string | undefined,
    body: AiRunCreateRequest,
    requestId?: string,
  ): Promise<AiRunRow> {
    // Up to 400 product snapshots are read and written in one step.
    return this.run(token, requestId, (context) => runs.createRun(context, body), 120_000);
  }

  listRuns(token: string | undefined): Promise<AiRunList> {
    return this.run(token, undefined, (context) => runs.listRuns(context));
  }

  commandRun(
    token: string | undefined,
    id: string,
    command: 'pause' | 'resume' | 'cancel',
    body: AiRunCommandRequest,
    requestId?: string,
  ): Promise<AiRunRow> {
    return this.run(token, requestId, (context) => runs.commandRun(context, id, command, body));
  }

  unlockRuns(
    token: string | undefined,
    body: AiRunUnlockRequest,
    requestId?: string,
  ): Promise<AiRunList> {
    return this.run(token, requestId, (context) => runs.unlockRuns(context, body));
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
