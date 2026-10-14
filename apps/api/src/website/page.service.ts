import type {
  WebsitePageInput,
  WebsitePageListResponse,
  WebsitePagePublishRequest,
  WebsitePageResponse,
  WebsitePageUpdateRequest,
} from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { createPage, getPage, listPages, setPagePublished, updatePage } from './page.core.js';
import { UUID } from './popup.core.js';

/**
 * Session 7b: information page commands. Authority (`MANAGE_WEBSITE_CONTENT`, GLOBAL) is decided inside each transaction by the
 * core functions.
 */
@Injectable()
export class PageService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  list(token: string | undefined): Promise<WebsitePageListResponse> {
    return this.run(token, undefined, (context) => listPages(context));
  }

  get(token: string | undefined, id: string): Promise<WebsitePageResponse> {
    return this.runOn(token, id, undefined, (context, pageId) => getPage(context, pageId));
  }

  create(
    token: string | undefined,
    body: WebsitePageInput,
    requestId?: string,
  ): Promise<WebsitePageResponse> {
    return this.run(token, requestId, (context) => createPage(context, body));
  }

  update(
    token: string | undefined,
    id: string,
    body: WebsitePageUpdateRequest,
    requestId?: string,
  ): Promise<WebsitePageResponse> {
    return this.runOn(token, id, requestId, (context, pageId) => updatePage(context, pageId, body));
  }

  setPublished(
    token: string | undefined,
    id: string,
    body: WebsitePagePublishRequest,
    requestId?: string,
  ): Promise<WebsitePageResponse> {
    return this.runOn(token, id, requestId, (context, pageId) =>
      setPagePublished(context, pageId, body),
    );
  }

  private runOn<T>(
    token: string | undefined,
    id: string,
    requestId: string | undefined,
    work: (context: AdminContext, id: string) => Promise<T>,
  ): Promise<T> {
    if (!UUID.test(id)) return Promise.reject(new AuthError('NOT_FOUND'));
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
