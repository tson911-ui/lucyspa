import type {
  SupplierApproveReadyRequest,
  SupplierApproveReadyResponse,
  SupplierCandidateApproveRequest,
  SupplierCandidateApproveResponse,
  SupplierCandidateDecideRequest,
  SupplierCandidateDecideResponse,
  SupplierCandidateDetailResponse,
  SupplierCandidateEditRequest,
  SupplierCandidateImageDecisionRequest,
  SupplierCandidateKeepSeparateRequest,
  SupplierCandidateListResponse,
  SupplierMappingRequest,
  SupplierMappingResponse,
} from '@lucy-spa/contracts';
import { MediaNotFoundError, type MediaStorage } from '@lucy-spa/server';
import { Inject, Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { loadAuthorityGraph } from '../authorization/authorization.store.js';
import { sqlStateOf } from '../booking/customer-command.js';
import * as input from '../inventory/inventory.input.js';
import { MEDIA_STORAGE } from '../platform/tokens.js';
import { mediaVariantObject } from '../website/media.core.js';
import type { VariantKind } from '../website/media.processing.js';
import * as core from './supplier-import.core.js';

/**
 * Phase 9 P9-6: the review of supplier candidates. Authority (`REVIEW_SUPPLIER_IMPORTS`, GLOBAL) is decided inside each command. A
 * retryable lock or a unique or guard conflict that the pre-checks could not see becomes CONFLICT, as for the sources.
 */
@Injectable()
export class SupplierImportService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation' | 'resolve'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
  ) {}

  list(
    token: string | undefined,
    query: { state?: string | undefined; warning?: string | undefined; page?: number | undefined },
  ): Promise<SupplierCandidateListResponse> {
    return this.run(token, undefined, (context) => core.listCandidates(context, query));
  }

  get(token: string | undefined, id: string): Promise<SupplierCandidateDetailResponse> {
    return this.run(token, undefined, (context) => core.getCandidate(context, id));
  }

  edit(
    token: string | undefined,
    id: string,
    body: SupplierCandidateEditRequest,
    requestId?: string,
  ) {
    return this.run(token, requestId, (context) => core.editCandidate(context, id, body));
  }

  imageDecision(
    token: string | undefined,
    id: string,
    body: SupplierCandidateImageDecisionRequest,
    requestId?: string,
  ) {
    return this.run(token, requestId, (context) => core.decideImage(context, id, body));
  }

  keepSeparate(
    token: string | undefined,
    id: string,
    body: SupplierCandidateKeepSeparateRequest,
    requestId?: string,
  ) {
    return this.run(token, requestId, (context) => core.keepSeparate(context, id, body));
  }

  mapping(
    token: string | undefined,
    body: SupplierMappingRequest,
    requestId?: string,
  ): Promise<SupplierMappingResponse> {
    return this.run(token, requestId, (context) => core.saveSourceMapping(context, body));
  }

  approve(
    token: string | undefined,
    id: string,
    body: SupplierCandidateApproveRequest,
    requestId?: string,
  ): Promise<SupplierCandidateApproveResponse> {
    return this.run(token, requestId, (context) => core.approveCandidate(context, id, body));
  }

  approveReady(
    token: string | undefined,
    body: SupplierApproveReadyRequest,
    requestId?: string,
  ): Promise<SupplierApproveReadyResponse> {
    return this.run(token, requestId, (context) => core.approveReady(context, body));
  }

  reject(
    token: string | undefined,
    id: string,
    body: SupplierCandidateDecideRequest,
    requestId?: string,
  ): Promise<SupplierCandidateDecideResponse> {
    return this.run(token, requestId, (context) => core.rejectCandidate(context, id, body));
  }

  ignore(
    token: string | undefined,
    id: string,
    body: SupplierCandidateDecideRequest,
    requestId?: string,
  ): Promise<SupplierCandidateDecideResponse> {
    return this.run(token, requestId, (context) => core.ignoreCandidate(context, id, body));
  }

  /**
   * One rendition of one candidate picture for the reviewer. The authority is REVIEW_SUPPLIER_IMPORTS (a reviewer does not need the
   * media library); the picture must belong to that candidate. A review page asks for dozens at once, so, as for the library, this read
   * decides authority from a fresh read-only session lookup under the shared graph lock only.
   */
  async picture(
    token: string | undefined,
    candidateId: string,
    imageId: string,
    kind: VariantKind,
  ): Promise<{ stream: Readable; bytes: number; etag: string }> {
    const object = await this.sessions
      .withTransaction(async (tx) => {
        const principal = await this.sessions.resolve(token, tx);
        if (principal?.kind !== 'AUTHENTICATED' || principal.userId === null) {
          throw new AuthError('AUTHENTICATION_REQUIRED');
        }
        if (principal.userKind !== 'OWNER' && principal.userKind !== 'EMPLOYEE') {
          throw new AuthError('FORBIDDEN');
        }
        const graph = await loadAuthorityGraph(tx, principal.userId);
        if (!graph) throw new AuthError('AUTHENTICATION_REQUIRED');
        if (!decide(graph, 'REVIEW_SUPPLIER_IMPORTS', { kind: 'GLOBAL' })) {
          throw new AuthError('FORBIDDEN');
        }
        const asset = await core.candidateImageAsset(
          tx,
          input.uuid(candidateId, 'id'),
          input.uuid(imageId, 'imageId'),
        );
        return mediaVariantObject(tx, asset, kind);
      })
      .catch((error: unknown) => {
        throw error instanceof AuthError ? error : new AuthError('SERVICE_UNAVAILABLE');
      });
    try {
      const { stream, bytes } = await this.storage.get(object.storageKey);
      return { stream, bytes, etag: `"${object.sha256.slice(0, 32)}-${kind.toLowerCase()}"` };
    } catch (error) {
      if (error instanceof MediaNotFoundError) throw new AuthError('NOT_FOUND');
      throw new AuthError('SERVICE_UNAVAILABLE');
    }
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
