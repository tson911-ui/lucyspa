import type {
  PublicPopupResponse,
  PublicSeasonResponse,
  PublicSlide,
  WebsitePopupEnabledRequest,
  WebsitePopupInput,
  WebsitePopupListResponse,
  WebsitePopupResponse,
  WebsitePopupUpdateRequest,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { MediaNotFoundError, type MediaStorage } from '@lucy-spa/server';
import { Inject, Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { MEDIA_STORAGE } from '../platform/tokens.js';
import { mediaVariantObject } from './media.core.js';
import type { VariantKind } from './media.processing.js';
import {
  activePopup,
  createPopup,
  deletePopup,
  getPopup,
  isPubliclyServed,
  listPopups,
  setPopupEnabled,
  updatePopup,
  type PublicLocale,
} from './popup.core.js';
import { activeSeason } from './season.core.js';
import { visibleSlides } from './slide.core.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * UX/UI Step 12: promotional popup commands. Authority (`MANAGE_WEBSITE_CONTENT`, GLOBAL) is decided inside
 * each transaction by the core functions.
 */
@Injectable()
export class PopupService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  list(token: string | undefined): Promise<WebsitePopupListResponse> {
    return this.run(token, undefined, (context) => listPopups(context));
  }

  get(token: string | undefined, id: string): Promise<WebsitePopupResponse> {
    return this.runOn(token, id, undefined, (context, popupId) => getPopup(context, popupId));
  }

  create(
    token: string | undefined,
    body: WebsitePopupInput,
    requestId?: string,
  ): Promise<WebsitePopupResponse> {
    return this.run(token, requestId, (context) => createPopup(context, body));
  }

  update(
    token: string | undefined,
    id: string,
    body: WebsitePopupUpdateRequest,
    requestId?: string,
  ): Promise<WebsitePopupResponse> {
    return this.runOn(token, id, requestId, (context, popupId) =>
      updatePopup(context, popupId, body),
    );
  }

  setEnabled(
    token: string | undefined,
    id: string,
    body: WebsitePopupEnabledRequest,
    requestId?: string,
  ): Promise<WebsitePopupResponse> {
    return this.runOn(token, id, requestId, (context, popupId) =>
      setPopupEnabled(context, popupId, body),
    );
  }

  remove(token: string | undefined, id: string, requestId?: string): Promise<void> {
    return this.runOn(token, id, requestId, (context, popupId) => deletePopup(context, popupId));
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

/**
 * The public, anonymous reads of the website content (design 16.3, 16.5): the live popup and the images
 * that live content shows. Nothing here needs a session and nothing here reveals a draft: an image is served
 * only while an enabled, in-window popup or slide references it.
 */
@Injectable()
export class PublicWebsiteService {
  constructor(
    @Inject(SessionService) private readonly sessions: Pick<SessionService, 'withTransaction'>,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
  ) {}

  /** The popup that is live now in the visitor's language, or null (the caller answers 204). */
  popup(locale: PublicLocale): Promise<PublicPopupResponse | null> {
    return this.read(async (tx) => activePopup(tx, await this.throttle.now(tx), locale));
  }

  /** The season that is live now in the visitor's language, or null (the caller answers 204). */
  season(locale: PublicLocale): Promise<PublicSeasonResponse | null> {
    return this.read(async (tx) => activeSeason(tx, await this.throttle.now(tx), locale));
  }

  /** The slides that are visible now, in slider order and in the visitor's language (possibly none). */
  slides(locale: PublicLocale): Promise<PublicSlide[]> {
    return this.read(async (tx) => visibleSlides(tx, await this.throttle.now(tx), locale));
  }

  /** One rendition of an image that live content uses. Anything else is 404, never a hint that it exists. */
  async variant(
    id: string,
    kind: VariantKind,
  ): Promise<{ stream: Readable; bytes: number; etag: string }> {
    if (!UUID.test(id)) throw new AuthError('NOT_FOUND');
    const assetId = id.toLowerCase();
    const object = await this.read(async (tx) => {
      if (!(await isPubliclyServed(tx, assetId, await this.throttle.now(tx)))) {
        throw new AuthError('NOT_FOUND');
      }
      return mediaVariantObject(tx, assetId, kind);
    });
    try {
      const { stream, bytes } = await this.storage.get(object.storageKey);
      return { stream, bytes, etag: `"${object.sha256.slice(0, 32)}-${kind.toLowerCase()}"` };
    } catch (error) {
      if (error instanceof MediaNotFoundError) throw new AuthError('NOT_FOUND');
      throw new AuthError('SERVICE_UNAVAILABLE');
    }
  }

  private read<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.sessions.withTransaction(work).catch((error: unknown) => {
      throw error instanceof AuthError ? error : new AuthError('SERVICE_UNAVAILABLE');
    });
  }
}
