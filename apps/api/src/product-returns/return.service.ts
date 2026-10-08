import type {
  ProductReturnAcceptRequest,
  ProductReturnCaseResponse,
  ProductReturnCloseRequest,
  ProductReturnContextResponse,
  ProductReturnListResponse,
  ProductReturnLookupResponse,
  ProductReturnNoteRequest,
  ProductReturnOpenRequest,
  ProductReturnPhotoRemoveRequest,
} from '@lucy-spa/contracts';
import {
  MediaNotFoundError,
  newMediaKey,
  resolvePermissionHolders,
  type MediaStorage,
} from '@lucy-spa/server';
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@lucy-spa/database';
import type { Readable } from 'node:stream';
import type { Logger } from 'pino';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { capabilityDigest } from '../auth/crypto.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { loadAuthorityGraph } from '../authorization/authorization.store.js';
import { sqlStateOf } from '../booking/customer-command.js';
import { API_LOGGER, RETURN_EVIDENCE_STORAGE } from '../platform/tokens.js';
import {
  MEDIA_LIMITS,
  processImage,
  sha256Hex,
  type ProcessedImage,
  type VariantKind,
} from '../website/media.processing.js';
import { canManageAt } from './return.access.js';
import * as core from './return.core.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Per signed-in user: 30 photo uploads a minute, duplicates and rejected files included. */
const UPLOAD_LIMIT = Object.freeze({ attempts: 30, windowSeconds: 60 });

export interface UploadedEvidence {
  readonly buffer: Buffer;
  readonly originalname: string;
}

interface StoredKeys {
  originalKey: string;
  variantKeys: Record<VariantKind, string>;
}

/**
 * Phase 6 P6-12: product return cases. Authority is decided inside each transaction (the core). The image work and the storage writes
 * happen outside any database transaction; the rows commit last and the objects are removed again if they do not. A removal deletes
 * the objects only after its commit (OQ-79). The wrapper turns the retryable lock and unique conflicts, and a database guard that
 * fired anyway, into the precise conflict.
 */
@Injectable()
export class ProductReturnService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation' | 'resolve'
    >,
    @Inject(AuthThrottleService)
    private readonly throttle: Pick<AuthThrottleService, 'now' | 'debitWindow'>,
    @Inject(RETURN_EVIDENCE_STORAGE) private readonly storage: MediaStorage,
    @Inject(API_LOGGER) private readonly logger: Logger,
  ) {}

  // ------------------------------------------------------------------------------------------- reads

  context(token: string | undefined): Promise<ProductReturnContextResponse> {
    return this.run(token, undefined, (context) => core.returnContext(context));
  }

  lookup(
    token: string | undefined,
    branchId: string,
    invoiceCode: string | undefined,
  ): Promise<ProductReturnLookupResponse> {
    const branch = this.id(branchId, 'branchId');
    return this.run(token, undefined, (context) =>
      core.lookupInvoice(context, branch, invoiceCode),
    );
  }

  list(
    token: string | undefined,
    query: {
      branchId: string;
      status?: string | undefined;
      reason?: string | undefined;
      q?: string | undefined;
      page?: number | undefined;
    },
  ): Promise<ProductReturnListResponse> {
    const branchId = this.id(query.branchId, 'branchId');
    return this.run(token, undefined, (context) => core.listCases(context, { ...query, branchId }));
  }

  get(token: string | undefined, id: string): Promise<ProductReturnCaseResponse> {
    const caseId = this.id(id);
    return this.run(token, undefined, (context) => core.getCase(context, caseId));
  }

  // ---------------------------------------------------------------------------------------- commands

  open(
    token: string | undefined,
    body: ProductReturnOpenRequest,
    requestId?: string,
  ): Promise<ProductReturnCaseResponse> {
    // The holders of REFUND_PRODUCTS are told in the same transaction. They are resolved and locked (with the actor, sorted by id) BEFORE
    // the invoice row is taken, so a notice never waits for a user row that another command holds while it waits for the invoice. Only
    // someone who may open cases at the branch causes any lock; for anyone else the command fails on authority.
    let recipients: readonly string[] = [];
    const branchId =
      typeof body?.branchId === 'string' && UUID.test(body.branchId)
        ? body.branchId.toLowerCase()
        : null;
    return this.run(
      token,
      requestId,
      (context) => core.openCase(context, { ...body }, recipients),
      branchId === null
        ? undefined
        : async (tx) => {
            if (!(await this.mayOpenAt(tx, token, branchId))) return [];
            recipients = await resolvePermissionHolders(tx, {
              branchId,
              permission: 'REFUND_PRODUCTS',
            });
            return recipients;
          },
    );
  }

  addNote(
    token: string | undefined,
    id: string,
    body: ProductReturnNoteRequest,
    requestId?: string,
  ): Promise<ProductReturnCaseResponse> {
    const caseId = this.id(id);
    return this.run(token, requestId, (context) => core.addNote(context, caseId, { ...body }));
  }

  accept(
    token: string | undefined,
    id: string,
    body: ProductReturnAcceptRequest,
    requestId?: string,
  ): Promise<ProductReturnCaseResponse> {
    const caseId = this.id(id);
    return this.run(token, requestId, (context) => core.acceptCase(context, caseId, { ...body }));
  }

  decline(
    token: string | undefined,
    id: string,
    body: ProductReturnCloseRequest,
    requestId?: string,
  ): Promise<ProductReturnCaseResponse> {
    const caseId = this.id(id);
    return this.run(token, requestId, (context) => core.declineCase(context, caseId, { ...body }));
  }

  cancel(
    token: string | undefined,
    id: string,
    body: ProductReturnCloseRequest,
    requestId?: string,
  ): Promise<ProductReturnCaseResponse> {
    const caseId = this.id(id);
    return this.run(token, requestId, (context) => core.cancelCase(context, caseId, { ...body }));
  }

  // ------------------------------------------------------------------------------------------ photos

  async uploadPhoto(
    token: string | undefined,
    id: string,
    file: UploadedEvidence | undefined,
    requestId?: string,
  ): Promise<ProductReturnCaseResponse> {
    const caseId = this.id(id);
    if (!file || !Buffer.isBuffer(file.buffer)) throw new AuthError('VALIDATION_FAILED', 'file');
    if (file.buffer.length > MEDIA_LIMITS.maxBytes) throw new AuthError('MEDIA_TOO_LARGE');
    const sha256 = sha256Hex(file.buffer);
    // 1. Authorize, rate limit and short-circuit a repeat of the same picture before any image work.
    const known = await this.run(token, requestId, async (context) => {
      const existing = await core.checkPhotoUpload(context, caseId, sha256);
      const admitted = await this.throttle.debitWindow(
        context.tx,
        'RETURN_PHOTO_UPLOAD',
        context.actor.userId,
        UPLOAD_LIMIT.attempts,
        UPLOAD_LIMIT.windowSeconds,
        context.now,
      );
      if (!admitted) throw new AuthError('RATE_LIMITED');
      return existing;
    });
    if (known) return known;
    // 2. Validate and re-encode, then write the objects (the original is kept byte for byte but never served).
    const image = await processImage(file.buffer);
    const stored = await this.store(image);
    // 3. Commit the rows; remove the objects again when they are not the ones recorded.
    try {
      const result = await this.run(token, requestId, (context) =>
        core.recordPhoto(context, caseId, {
          originalKey: stored.originalKey,
          thumbKey: stored.variantKeys.THUMB,
          mdKey: stored.variantKeys.MD,
          lgKey: stored.variantKeys.LG,
          mime: image.mime,
          bytes: file.buffer.length,
          width: image.width,
          height: image.height,
          sha256: image.sha256,
        }),
      );
      if (result.duplicate) await this.discard(this.keysOf(stored));
      return result.response;
    } catch (error) {
      await this.discard(this.keysOf(stored));
      throw error;
    }
  }

  async removePhoto(
    token: string | undefined,
    id: string,
    photoId: string,
    body: ProductReturnPhotoRemoveRequest,
    requestId?: string,
  ): Promise<ProductReturnCaseResponse> {
    const caseId = this.id(id);
    const photo = this.id(photoId);
    const result = await this.run(token, requestId, (context) =>
      core.removePhoto(context, caseId, photo, { ...body }),
    );
    // After the commit: a failed object delete leaves an orphan object but never a missing tombstone.
    await this.discard(result.keys);
    return result.response;
  }

  /** One rendition of a photo; authority (a view permission at the case's branch) is decided on every request. */
  async photo(
    token: string | undefined,
    id: string,
    photoId: string,
    kind: VariantKind,
  ): Promise<{ stream: Readable; bytes: number }> {
    if (!UUID.test(id) || !UUID.test(photoId)) throw new AuthError('NOT_FOUND');
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
        return core.photoRendition(tx, graph, id.toLowerCase(), photoId.toLowerCase(), kind);
      })
      .catch((error: unknown) => {
        throw error instanceof AuthError ? error : new AuthError('SERVICE_UNAVAILABLE');
      });
    try {
      return await this.storage.get(object.storageKey);
    } catch (error) {
      if (error instanceof MediaNotFoundError) throw new AuthError('NOT_FOUND');
      throw new AuthError('SERVICE_UNAVAILABLE');
    }
  }

  // ----------------------------------------------------------------------------------------- plumbing

  /** Whether the signed-in user (resolved from the token) holds the manage permission at the branch. No lock is taken. */
  private async mayOpenAt(
    tx: Prisma.TransactionClient,
    token: string | undefined,
    branchId: string,
  ): Promise<boolean> {
    const digest = token === undefined ? null : capabilityDigest(token);
    if (digest === null) return false;
    const session = await tx.session.findUnique({
      where: { tokenHash: new Uint8Array(digest) },
      select: { userId: true },
    });
    if (!session?.userId) return false;
    const graph = await loadAuthorityGraph(tx, session.userId);
    return graph !== null && canManageAt(graph, branchId);
  }

  private async store(image: ProcessedImage): Promise<StoredKeys> {
    const now = new Date();
    const originalKey = newMediaKey(image.extension, now);
    const variantKeys = Object.fromEntries(
      image.variants.map((variant) => [
        variant.kind,
        newMediaKey('webp', now, variant.kind.toLowerCase()),
      ]),
    ) as Record<VariantKind, string>;
    const stored: StoredKeys = { originalKey, variantKeys };
    try {
      await this.storage.put(originalKey, image.original, image.mime);
      for (const variant of image.variants) {
        await this.storage.put(variantKeys[variant.kind], variant.bytes, 'image/webp');
      }
    } catch {
      await this.discard(this.keysOf(stored));
      throw new AuthError('SERVICE_UNAVAILABLE');
    }
    return stored;
  }

  private keysOf(stored: StoredKeys): string[] {
    return [stored.originalKey, ...Object.values(stored.variantKeys)];
  }

  private async discard(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.storage.delete(key);
      } catch {
        this.logger.warn(
          'A return evidence object could not be removed; it is orphaned in storage',
        );
      }
    }
  }

  private id(value: string | undefined, field?: string): string {
    if (typeof value !== 'string' || !UUID.test(value)) {
      throw field ? new AuthError('VALIDATION_FAILED', field) : new AuthError('NOT_FOUND');
    }
    return value.toLowerCase();
  }

  private run<T>(
    token: string | undefined,
    requestId: string | undefined,
    work: (context: AdminContext) => Promise<T>,
    lockUsers?: (tx: Prisma.TransactionClient) => Promise<readonly string[]>,
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
