import type { WebsiteShopInfoResponse, WebsiteShopInfoUpdateRequest } from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand } from '../authorization/admin-command.js';
import { getShopInfo, updateShopInfo } from './shop-info.core.js';

/**
 * UX/UI Part 2 (P2-2): the shop profile, admin side. Authority (`MANAGE_WEBSITE_CONTENT`, GLOBAL) is decided
 * inside each transaction by the core functions.
 */
@Injectable()
export class ShopInfoService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  get(token: string | undefined): Promise<WebsiteShopInfoResponse> {
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      { exclusive: false, requestId: undefined },
      (context) => getShopInfo(context),
    );
  }

  update(
    token: string | undefined,
    body: WebsiteShopInfoUpdateRequest,
    requestId?: string,
  ): Promise<WebsiteShopInfoResponse> {
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      { exclusive: false, requestId },
      (context) => updateShopInfo(context, body),
    );
  }
}
