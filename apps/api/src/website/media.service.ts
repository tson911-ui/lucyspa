import type {
  MediaAssetDetail,
  MediaListResponse,
  MediaUpdateRequest,
  MediaUploadResponse,
} from '@lucy-spa/contracts';
import { MediaNotFoundError, newMediaKey, type MediaStorage } from '@lucy-spa/server';
import { Inject, Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import type { Logger } from 'pino';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { loadAuthorityGraph } from '../authorization/authorization.store.js';
import { API_LOGGER, MEDIA_STORAGE } from '../platform/tokens.js';
import {
  createMedia,
  deleteMedia,
  findMediaByHash,
  getMedia,
  holdsWebsiteContent,
  listMedia,
  mediaVariantObject,
  requireWebsiteContent,
  updateMediaAlt,
  type StoredMedia,
} from './media.core.js';
import {
  MEDIA_LIMITS,
  processImage,
  sha256Hex,
  type ProcessedImage,
  type VariantKind,
} from './media.processing.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_VERSION = 2_147_483_647;
/** Per signed-in user: 30 upload attempts a minute (design 16.3). Duplicates and rejected files count too. */
const UPLOAD_LIMIT = Object.freeze({ attempts: 30, windowSeconds: 60 });

export interface UploadedFile {
  readonly buffer: Buffer;
  readonly originalname: string;
}

/**
 * UX/UI Step 11: media library commands. Authority (`MANAGE_WEBSITE_CONTENT`, GLOBAL) is decided inside each
 * transaction. The image work (decode, re-encode, three variants) and the storage writes happen outside any
 * database transaction; the rows commit last, and the objects are removed again if they do not.
 */
@Injectable()
export class MediaService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation' | 'resolve'
    >,
    @Inject(AuthThrottleService)
    private readonly throttle: Pick<AuthThrottleService, 'now' | 'debitWindow'>,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(API_LOGGER) private readonly logger: Logger,
  ) {}

  list(
    token: string | undefined,
    query: { search?: string | undefined; page?: number | undefined },
  ): Promise<MediaListResponse> {
    return this.run(token, undefined, (context) => listMedia(context, query));
  }

  get(token: string | undefined, id: string): Promise<MediaAssetDetail> {
    return this.runOn(token, id, undefined, (context, assetId) => getMedia(context, assetId));
  }

  updateAlt(
    token: string | undefined,
    id: string,
    body: MediaUpdateRequest,
    requestId?: string,
  ): Promise<MediaAssetDetail> {
    const expectedVersion = this.version(body.expectedVersion);
    return this.runOn(token, id, requestId, (context, assetId) =>
      updateMediaAlt(context, assetId, { ...body, expectedVersion }),
    );
  }

  async remove(token: string | undefined, id: string, requestId?: string): Promise<void> {
    const keys = await this.runOn(token, id, requestId, (context, assetId) =>
      deleteMedia(context, assetId),
    );
    // After the commit: a failed file delete leaves an orphan object but never a dangling row.
    await this.discard(keys);
  }

  async upload(
    token: string | undefined,
    file: UploadedFile | undefined,
    fields: { altVi?: unknown; altEn?: unknown },
    requestId?: string,
  ): Promise<MediaUploadResponse> {
    if (!file || !Buffer.isBuffer(file.buffer)) throw new AuthError('VALIDATION_FAILED', 'file');
    if (file.buffer.length > MEDIA_LIMITS.maxBytes) throw new AuthError('MEDIA_TOO_LARGE');
    const sha256 = sha256Hex(file.buffer);
    // 1. Authorize, rate limit and short-circuit a repeat of the same bytes before any image work.
    const known = await this.run(token, requestId, async (context) => {
      requireWebsiteContent(context);
      const admitted = await this.throttle.debitWindow(
        context.tx,
        'MEDIA_UPLOAD',
        context.actor.userId,
        UPLOAD_LIMIT.attempts,
        UPLOAD_LIMIT.windowSeconds,
        context.now,
      );
      if (!admitted) throw new AuthError('RATE_LIMITED');
      return findMediaByHash(context, sha256);
    });
    if (known) return { asset: known, duplicate: true };
    // 2. Validate and re-encode, then write the objects.
    const image = await processImage(file.buffer);
    const stored = await this.store(image);
    // 3. Commit the rows; remove the objects again when they are not the ones recorded.
    try {
      const result = await this.run(token, requestId, (context) =>
        createMedia(context, {
          image,
          stored,
          filename: file.originalname,
          altVi: fields.altVi,
          altEn: fields.altEn,
        }),
      );
      if (result.duplicate) await this.discard(this.keysOf(stored));
      return result;
    } catch (error) {
      await this.discard(this.keysOf(stored));
      if (error instanceof AuthError && error.code === 'CONFLICT') {
        // A concurrent upload of the same bytes won the unique hash: return that asset.
        const winner = await this.run(token, requestId, (context) =>
          findMediaByHash(context, sha256),
        );
        if (winner) return { asset: winner, duplicate: true };
      }
      throw error;
    }
  }

  /** One rendition for the admin library; the bytes are streamed, never held. */
  async variant(
    token: string | undefined,
    id: string,
    kind: VariantKind,
  ): Promise<{ stream: Readable; bytes: number; etag: string }> {
    if (!UUID.test(id)) throw new AuthError('NOT_FOUND');
    // A library page asks for dozens of renditions at once. `runAdminCommand` locks the actor's user and
    // session rows (right for commands), which would serialize them and stall the user's other requests,
    // so this read decides authority from a fresh read-only session lookup and authority graph instead:
    // still checked on every request, under the shared graph lock only.
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
        if (!holdsWebsiteContent(graph)) throw new AuthError('FORBIDDEN');
        return mediaVariantObject(tx, id.toLowerCase(), kind);
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

  private async store(image: ProcessedImage): Promise<StoredMedia> {
    const now = new Date();
    const originalKey = newMediaKey(image.extension, now);
    const variantKeys = Object.fromEntries(
      image.variants.map((variant) => [
        variant.kind,
        newMediaKey('webp', now, variant.kind.toLowerCase()),
      ]),
    ) as StoredMedia['variantKeys'];
    const stored: StoredMedia = { originalKey, variantKeys };
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

  private keysOf(stored: StoredMedia): string[] {
    return [stored.originalKey, ...Object.values(stored.variantKeys)];
  }

  private async discard(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.storage.delete(key);
      } catch {
        this.logger.warn('Media object could not be removed; it is orphaned in storage');
      }
    }
  }

  private version(value: unknown): number {
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > MAX_VERSION
    ) {
      throw new AuthError('VALIDATION_FAILED', 'expectedVersion');
    }
    return value;
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
