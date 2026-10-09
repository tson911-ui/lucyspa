import type {
  PublicPopupResponse,
  PublicCampaignsResponse,
  PublicProductCodesResponse,
  PublicProductDetailResponse,
  PublicProductsResponse,
  PublicServiceDetailResponse,
  PublicServicesResponse,
  PublicSeasonResponse,
  PublicSiteResponse,
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
import { runningCampaigns } from '../campaigns/campaign.public.js';
import { ShortCache } from '../platform/short-cache.js';
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
import {
  publicProductCodes,
  publicProductDetail,
  publicProducts,
} from '../products/public-products.core.js';
import type { PublicProductsQuery } from '../products/public-products.logic.js';
import { publicServiceDetail, publicServices } from './public-catalog.core.js';
import { activeSeason } from './season.core.js';
import { publicSite } from './shop-info.core.js';
import { visibleSlides } from './slide.core.js';

/** How long a public cosmetics read is remembered by the API (P6-7). */
const PUBLIC_PRODUCT_CACHE_MS = 5_000;
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
  /**
   * P6-7: the cosmetics reads are remembered for a few seconds (see `ShortCache`), so a burst of visitors costs one query.
   * Together with the website's own 60-second memory a price or stock change shows within about 65 seconds.
   */
  private readonly cache = {
    products: new ShortCache<PublicProductsResponse>(PUBLIC_PRODUCT_CACHE_MS, 100),
    detail: new ShortCache<PublicProductDetailResponse>(PUBLIC_PRODUCT_CACHE_MS, 300),
    codes: new ShortCache<PublicProductCodesResponse>(PUBLIC_PRODUCT_CACHE_MS, 1),
    campaigns: new ShortCache<PublicCampaignsResponse>(PUBLIC_PRODUCT_CACHE_MS, 2),
  };

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

  /** The shop profile (tagline, address, hotline, hours, hero image) in the visitor's language. */
  site(locale: PublicLocale): Promise<PublicSiteResponse> {
    return this.read((tx) => publicSite(tx, locale));
  }

  /** The service catalogue a visitor may see: active services of active categories offered by an active branch. */
  services(locale: PublicLocale): Promise<PublicServicesResponse> {
    return this.read((tx) => publicServices(tx, locale));
  }

  serviceDetail(locale: PublicLocale, code: string): Promise<PublicServiceDetailResponse> {
    return this.read((tx) => publicServiceDetail(tx, locale, code));
  }

  /** The visible cosmetics, one page (P6-6): only PUBLISHED products with a price; never a cost or a quantity. */
  products(locale: PublicLocale, query: PublicProductsQuery): Promise<PublicProductsResponse> {
    const load = () => this.read((tx) => publicProducts(tx, locale, query));
    // A visitor's free-text search is never remembered (an unbounded set of words); every other page is, for a few seconds.
    return query.q === '' ? this.cache.products.get(JSON.stringify([locale, query]), load) : load();
  }

  productDetail(locale: PublicLocale, code: string): Promise<PublicProductDetailResponse> {
    return this.cache.detail.get(`${locale}:${code}`, () =>
      this.read((tx) => publicProductDetail(tx, locale, code)),
    );
  }

  /** The campaigns running now (P6-23): remembered for a few seconds like the products they price. */
  campaigns(locale: PublicLocale): Promise<PublicCampaignsResponse> {
    return this.cache.campaigns.get(locale, () =>
      this.read(async (tx) => runningCampaigns(tx, await this.throttle.now(tx), locale)),
    );
  }

  productCodes(): Promise<PublicProductCodesResponse> {
    return this.cache.codes.get('codes', () => this.read((tx) => publicProductCodes(tx)));
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
