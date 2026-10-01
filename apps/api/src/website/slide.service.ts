import type {
  WebsiteSlideEnabledRequest,
  WebsiteSlideInput,
  WebsiteSlideListResponse,
  WebsiteSlideReorderRequest,
  WebsiteSlideResponse,
  WebsiteSlideUpdateRequest,
} from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { UUID } from './popup.core.js';
import {
  createSlide,
  deleteSlide,
  getSlide,
  listSlides,
  reorderSlides,
  setSlideEnabled,
  updateSlide,
} from './slide.core.js';

/**
 * UX/UI Step 13: homepage slider commands. Authority (`MANAGE_WEBSITE_CONTENT`, GLOBAL) is decided inside
 * each transaction by the core functions.
 */
@Injectable()
export class SlideService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  list(token: string | undefined): Promise<WebsiteSlideListResponse> {
    return this.run(token, undefined, (context) => listSlides(context));
  }

  get(token: string | undefined, id: string): Promise<WebsiteSlideResponse> {
    return this.runOn(token, id, undefined, (context, slideId) => getSlide(context, slideId));
  }

  create(
    token: string | undefined,
    body: WebsiteSlideInput,
    requestId?: string,
  ): Promise<WebsiteSlideResponse> {
    return this.run(token, requestId, (context) => createSlide(context, body));
  }

  update(
    token: string | undefined,
    id: string,
    body: WebsiteSlideUpdateRequest,
    requestId?: string,
  ): Promise<WebsiteSlideResponse> {
    return this.runOn(token, id, requestId, (context, slideId) =>
      updateSlide(context, slideId, body),
    );
  }

  setEnabled(
    token: string | undefined,
    id: string,
    body: WebsiteSlideEnabledRequest,
    requestId?: string,
  ): Promise<WebsiteSlideResponse> {
    return this.runOn(token, id, requestId, (context, slideId) =>
      setSlideEnabled(context, slideId, body),
    );
  }

  reorder(
    token: string | undefined,
    body: WebsiteSlideReorderRequest,
    requestId?: string,
  ): Promise<WebsiteSlideListResponse> {
    return this.run(token, requestId, (context) => reorderSlides(context, body));
  }

  remove(token: string | undefined, id: string, requestId?: string): Promise<void> {
    return this.runOn(token, id, requestId, (context, slideId) => deleteSlide(context, slideId));
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
