import type {
  CampaignCreateRequest,
  CampaignDetailResponse,
  CampaignEditRequest,
  CampaignEndRequest,
  CampaignGroupRequest,
  CampaignItemsAddFilteredRequest,
  CampaignItemsAddRequest,
  CampaignItemsRemoveRequest,
  CampaignItemsResponse,
  CampaignListResponse,
  CampaignPickerResponse,
  CampaignPublishRequest,
} from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError, type AuthErrorCode } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { sqlStateOf } from '../booking/customer-command.js';
import * as core from './campaign.core.js';

/** What a database guard of the campaign migration says when it fires anyway (a race the pre-checks could not see). */
const GUARD_MESSAGES: readonly (readonly [RegExp, AuthErrorCode])[] = [
  [/published before it starts/i, 'CAMPAIGN_START_PASSED'],
  [/never change/i, 'CAMPAIGN_NOT_EDITABLE'],
  [/at least one product/i, 'CAMPAIGN_EMPTY'],
  [/ended once|cannot be ended again/i, 'CAMPAIGN_ENDED'],
];

function guardError(error: unknown): AuthError | null {
  const meta = Reflect.get(Object(error), 'meta');
  const text = [
    Reflect.get(Object(error), 'message'),
    meta ? Reflect.get(Object(meta), 'message') : undefined,
  ]
    .filter((part): part is string => typeof part === 'string')
    .join(' ');
  for (const [pattern, code] of GUARD_MESSAGES) if (pattern.test(text)) return new AuthError(code);
  if (/product_campaigns_slug_key/.test(text)) return new AuthError('CAMPAIGN_SLUG_TAKEN');
  return null;
}

/**
 * Phase 6 Wave 4 (P6-23): promotion campaign administration (`MANAGE_PRODUCT_PRICES`, decided inside each command). The wrapper turns a
 * retryable lock or unique conflict, and a database guard that fired anyway, into a precise error.
 */
@Injectable()
export class CampaignService {
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
    query: { state?: string; q?: string; page?: string },
  ): Promise<CampaignListResponse> {
    return this.run(token, undefined, (context) => core.listCampaigns(context, query));
  }

  get(token: string | undefined, id: string): Promise<CampaignDetailResponse> {
    return this.run(token, undefined, (context) => core.getCampaign(context, id));
  }

  items(
    token: string | undefined,
    id: string,
    query: { page?: string; q?: string; groupId?: string; problem?: string },
  ): Promise<CampaignItemsResponse> {
    return this.run(token, undefined, (context) => core.campaignItems(context, id, query));
  }

  picker(
    token: string | undefined,
    id: string,
    query: Record<string, string | undefined>,
  ): Promise<CampaignPickerResponse> {
    return this.run(token, undefined, (context) => core.campaignPicker(context, id, query));
  }

  create(token: string | undefined, body: CampaignCreateRequest, requestId?: string) {
    return this.run(token, requestId, (context) => core.createCampaign(context, body));
  }

  edit(token: string | undefined, id: string, body: CampaignEditRequest, requestId?: string) {
    return this.run(token, requestId, (context) => core.editCampaign(context, id, body));
  }

  addGroup(token: string | undefined, id: string, body: CampaignGroupRequest, requestId?: string) {
    return this.run(token, requestId, (context) => core.addGroup(context, id, body));
  }

  editGroup(
    token: string | undefined,
    id: string,
    groupId: string,
    body: CampaignGroupRequest,
    requestId?: string,
  ) {
    return this.run(token, requestId, (context) => core.editGroup(context, id, groupId, body));
  }

  removeGroup(
    token: string | undefined,
    id: string,
    groupId: string,
    body: CampaignPublishRequest,
    requestId?: string,
  ) {
    return this.run(token, requestId, (context) => core.removeGroup(context, id, groupId, body));
  }

  addItems(
    token: string | undefined,
    id: string,
    body: CampaignItemsAddRequest,
    requestId?: string,
  ) {
    return this.run(token, requestId, (context) => core.addItems(context, id, body));
  }

  addFilteredItems(
    token: string | undefined,
    id: string,
    body: CampaignItemsAddFilteredRequest,
    requestId?: string,
  ) {
    return this.run(token, requestId, (context) => core.addFilteredItems(context, id, body));
  }

  removeItems(
    token: string | undefined,
    id: string,
    body: CampaignItemsRemoveRequest,
    requestId?: string,
  ) {
    return this.run(token, requestId, (context) => core.removeItems(context, id, body));
  }

  publish(token: string | undefined, id: string, body: CampaignPublishRequest, requestId?: string) {
    return this.run(token, requestId, (context) => core.publishCampaign(context, id, body));
  }

  end(token: string | undefined, id: string, body: CampaignEndRequest, requestId?: string) {
    return this.run(token, requestId, (context) => core.endCampaign(context, id, body));
  }

  remove(token: string | undefined, id: string, body: CampaignPublishRequest, requestId?: string) {
    return this.run(token, requestId, (context) => core.deleteCampaign(context, id, body));
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
          const guard = guardError(error);
          if (guard) throw guard;
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
