import type {
  RewardCatalogCreateRequest,
  RewardCatalogEditRequest,
  RewardCatalogItemResponse,
  RewardCatalogListResponse,
  RewardEntitlementPageResponse,
  RewardEntitlementResponse,
  RewardIssueOptionsResponse,
  RewardIssueRequest,
  RewardLookupResponse,
  RewardReasonRequest,
  RewardUseRequest,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { sqlStateOf } from '../booking/customer-command.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { createItem, editItem, listCatalog } from './reward-catalog.core.js';
import {
  issueOptions,
  issueReward,
  listEntitlements,
  lookupMember,
  ownerOfEntitlement,
  ownerOfUse,
  restoreUse,
  revokeReward,
  useReward,
} from './reward.core.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Lock = (tx: Prisma.TransactionClient) => Promise<readonly string[]>;

/**
 * Phase 5 P5-9: the reward catalog and the customers' entitlements. Every request is authorized inside its transaction; the client
 * never chooses an entitlement's owner, issuer, branch, time, expiry or status. The customer (the owner of the entitlement) is
 * locked first, then the entitlement row (design 12.2).
 */
@Injectable()
export class RewardService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
  ) {}

  // ------------------------------------------------------------------------------------------------------- catalog

  catalog(token: string | undefined): Promise<RewardCatalogListResponse> {
    return this.run(token, undefined, undefined, listCatalog);
  }

  createItem(
    token: string | undefined,
    body: RewardCatalogCreateRequest,
    requestId?: string,
  ): Promise<RewardCatalogItemResponse> {
    const serviceId = body.serviceId;
    if (serviceId !== null && serviceId !== undefined && !UUID.test(String(serviceId))) {
      throw new AuthError('VALIDATION_FAILED', 'serviceId');
    }
    const input = { ...body, serviceId: serviceId ? String(serviceId).toLowerCase() : null };
    return this.run(token, requestId, undefined, (context) => createItem(context, input));
  }

  editItem(
    token: string | undefined,
    itemId: string,
    body: RewardCatalogEditRequest,
    requestId?: string,
  ): Promise<RewardCatalogItemResponse> {
    const id = this.id(itemId);
    return this.run(token, requestId, undefined, (context) => editItem(context, id, body));
  }

  // ------------------------------------------------------------------------------------------------------ issuing

  options(token: string | undefined, branchId: string): Promise<RewardIssueOptionsResponse> {
    const branch = this.id(branchId);
    return this.run(token, undefined, undefined, (context) => issueOptions(context, branch));
  }

  lookup(
    token: string | undefined,
    branchId: string,
    query: { phone?: string },
  ): Promise<RewardLookupResponse> {
    const branch = this.id(branchId);
    return this.run(token, undefined, undefined, (context) => lookupMember(context, branch, query));
  }

  list(
    token: string | undefined,
    branchId: string,
    userId: string,
    query: { page?: string },
  ): Promise<RewardEntitlementPageResponse> {
    const branch = this.id(branchId);
    const user = this.id(userId);
    return this.run(token, undefined, undefined, (context) =>
      listEntitlements(context, branch, user, query),
    );
  }

  issue(
    token: string | undefined,
    branchId: string,
    userId: string,
    body: RewardIssueRequest,
    requestId?: string,
  ): Promise<RewardEntitlementResponse> {
    const branch = this.id(branchId);
    const user = this.id(userId);
    if (typeof body.catalogItemId !== 'string' || !UUID.test(body.catalogItemId)) {
      throw new AuthError('VALIDATION_FAILED', 'catalogItemId');
    }
    const input = { ...body, catalogItemId: body.catalogItemId.toLowerCase() };
    return this.run(
      token,
      requestId,
      async () => [user],
      (context) => issueReward(context, branch, user, input),
    );
  }

  use(
    token: string | undefined,
    branchId: string,
    entitlementId: string,
    body: RewardUseRequest,
    requestId?: string,
  ): Promise<RewardEntitlementResponse> {
    const branch = this.id(branchId);
    const id = this.id(entitlementId);
    return this.run(
      token,
      requestId,
      async (tx) => {
        const owner = await ownerOfEntitlement(tx, id);
        return owner ? [owner] : [];
      },
      (context) => useReward(context, branch, id, body),
    );
  }

  revoke(
    token: string | undefined,
    branchId: string,
    entitlementId: string,
    body: RewardReasonRequest,
    requestId?: string,
  ): Promise<RewardEntitlementResponse> {
    const branch = this.id(branchId);
    const id = this.id(entitlementId);
    return this.run(
      token,
      requestId,
      async (tx) => {
        const owner = await ownerOfEntitlement(tx, id);
        return owner ? [owner] : [];
      },
      (context) => revokeReward(context, branch, id, body),
    );
  }

  restore(
    token: string | undefined,
    useId: string,
    body: RewardReasonRequest,
    requestId?: string,
  ): Promise<RewardEntitlementResponse> {
    const id = this.id(useId);
    return this.run(
      token,
      requestId,
      async (tx) => {
        const owner = await ownerOfUse(tx, id);
        return owner ? [owner] : [];
      },
      (context) => restoreUse(context, id, body),
    );
  }

  private id(value: string): string {
    if (!UUID.test(value)) throw new AuthError('NOT_FOUND');
    return value.toLowerCase();
  }

  private async run<T>(
    token: string | undefined,
    requestId: string | undefined,
    lockUsers: Lock | undefined,
    work: (context: AdminContext) => Promise<T>,
  ): Promise<T> {
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      { exclusive: false, requestId, ...(lockUsers ? { lockUsers } : {}) },
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
