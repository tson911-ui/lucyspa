import type {
  WebsiteSeasonEnabledRequest,
  WebsiteSeasonInput,
  WebsiteSeasonListResponse,
  WebsiteSeasonResponse,
  WebsiteSeasonUpdateRequest,
} from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { UUID } from './popup.core.js';
import {
  createSeason,
  deleteSeason,
  getSeason,
  listSeasons,
  setSeasonEnabled,
  updateSeason,
} from './season.core.js';

/**
 * UX/UI Step S3: seasonal theme commands. Authority (`MANAGE_WEBSITE_CONTENT`, GLOBAL) is decided inside each
 * transaction by the core functions.
 */
@Injectable()
export class SeasonService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  list(token: string | undefined): Promise<WebsiteSeasonListResponse> {
    return this.run(token, undefined, (context) => listSeasons(context));
  }

  get(token: string | undefined, id: string): Promise<WebsiteSeasonResponse> {
    return this.runOn(token, id, undefined, (context, seasonId) => getSeason(context, seasonId));
  }

  create(
    token: string | undefined,
    body: WebsiteSeasonInput,
    requestId?: string,
  ): Promise<WebsiteSeasonResponse> {
    return this.run(token, requestId, (context) => createSeason(context, body));
  }

  update(
    token: string | undefined,
    id: string,
    body: WebsiteSeasonUpdateRequest,
    requestId?: string,
  ): Promise<WebsiteSeasonResponse> {
    return this.runOn(token, id, requestId, (context, seasonId) =>
      updateSeason(context, seasonId, body),
    );
  }

  setEnabled(
    token: string | undefined,
    id: string,
    body: WebsiteSeasonEnabledRequest,
    requestId?: string,
  ): Promise<WebsiteSeasonResponse> {
    return this.runOn(token, id, requestId, (context, seasonId) =>
      setSeasonEnabled(context, seasonId, body),
    );
  }

  remove(token: string | undefined, id: string, requestId?: string): Promise<void> {
    return this.runOn(token, id, requestId, (context, seasonId) => deleteSeason(context, seasonId));
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

  private run<T>(
    token: string | undefined,
    requestId: string | undefined,
    work: (context: AdminContext) => Promise<T>,
  ): Promise<T> {
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      { exclusive: false, requestId },
      work,
    );
  }
}
