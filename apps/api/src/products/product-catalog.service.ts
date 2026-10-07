import type {
  ProductBrandCreateRequest,
  ProductBrandEditRequest,
  ProductBrandListResponse,
  ProductBrandResponse,
  ProductCategoryCreateRequest,
  ProductCategoryEditRequest,
  ProductCategoryListResponse,
  ProductCategoryResponse,
  ProductCreateRequest,
  ProductDetailResponse,
  ProductEditRequest,
  ProductImageAddRequest,
  ProductImageOrderRequest,
  ProductListResponse,
  ProductPriceChangeRequest,
  ProductPromotionCreateRequest,
  ProductSettingsEditRequest,
  ProductSettingsResponse,
  ProductStatusRequest,
  ProductVariantCreateRequest,
  ProductVariantEditRequest,
} from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError, type AuthErrorCode } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { sqlStateOf } from '../booking/customer-command.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import * as core from './product-catalog.core.js';
import * as settingsCore from './product-settings.core.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * What a database guard of the P6-2 migrations says when it fires anyway (a race the pre-checks in the core could not see), and the
 * precise error the person gets instead of a generic failure. The pre-checks are the normal path; this is the backstop.
 */
const GUARD_MESSAGES: readonly (readonly [RegExp, AuthErrorCode])[] = [
  [/must stay above the price of a promotion/i, 'PRODUCT_PRICE_BELOW_PROMOTION'],
  [/promotional price is below the current list price/i, 'PRODUCT_PROMOTION_PRICE_INVALID'],
  [/promotion cannot already be over|promotion is already over/i, 'PRODUCT_PROMOTION_EXPIRED'],
  [/published only with an active, priced variant/i, 'PRODUCT_PUBLISH_INCOMPLETE'],
  [/keeps at least one active, priced variant/i, 'PRODUCT_LAST_PRICED_VARIANT'],
  [/category parent must exist|cannot become a child/i, 'PRODUCT_CATEGORY_DEPTH'],
  [/published product never returns to draft/i, 'PRODUCT_STATUS_INVALID'],
];

export function guardError(error: unknown): AuthError | null {
  const meta = Reflect.get(Object(error), 'meta');
  const text = [
    Reflect.get(Object(error), 'message'),
    meta ? Reflect.get(Object(meta), 'message') : undefined,
    Reflect.get(Object(error), 'cause') ? String(Reflect.get(Object(error), 'cause')) : undefined,
  ]
    .filter((part): part is string => typeof part === 'string')
    .join(' ');
  const state = sqlStateOf(error) ?? (meta ? Reflect.get(Object(meta), 'code') : undefined);
  for (const [pattern, code] of GUARD_MESSAGES) {
    if (pattern.test(text)) return new AuthError(code);
  }
  if (state === '23P01' || /product_promotions_no_overlap/.test(text)) {
    return new AuthError('PRODUCT_PROMOTION_OVERLAP');
  }
  return null;
}

/**
 * Phase 6 P6-3: product catalog administration. Every request is authorized inside its transaction (core). The wrapper turns the
 * retryable lock and unique conflicts, and a database guard that fired anyway, into precise errors; an unknown failure stays a
 * generic one and reveals nothing.
 */
@Injectable()
export class ProductCatalogService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
  ) {}

  // ---------------------------------------------------------------------------------------------- brands

  brands(token: string | undefined): Promise<ProductBrandListResponse> {
    return this.run(token, undefined, (context) => core.listBrands(context));
  }

  createBrand(
    token: string | undefined,
    body: ProductBrandCreateRequest,
    requestId?: string,
  ): Promise<ProductBrandResponse> {
    return this.run(token, requestId, (context) => core.createBrand(context, body));
  }

  editBrand(
    token: string | undefined,
    id: string,
    body: ProductBrandEditRequest,
    requestId?: string,
  ): Promise<ProductBrandResponse> {
    const brandId = this.id(id);
    return this.run(token, requestId, (context) => core.editBrand(context, brandId, body));
  }

  // ------------------------------------------------------------------------------------------ categories

  categories(token: string | undefined): Promise<ProductCategoryListResponse> {
    return this.run(token, undefined, (context) => core.listCategories(context));
  }

  createCategory(
    token: string | undefined,
    body: ProductCategoryCreateRequest,
    requestId?: string,
  ): Promise<ProductCategoryResponse> {
    return this.run(token, requestId, (context) => core.createCategory(context, body));
  }

  editCategory(
    token: string | undefined,
    id: string,
    body: ProductCategoryEditRequest,
    requestId?: string,
  ): Promise<ProductCategoryResponse> {
    const categoryId = this.id(id);
    return this.run(token, requestId, (context) => core.editCategory(context, categoryId, body));
  }

  // ------------------------------------------------------------------------------------------- products

  products(token: string | undefined): Promise<ProductListResponse> {
    return this.run(token, undefined, (context) => core.listAllProducts(context));
  }

  product(token: string | undefined, id: string): Promise<ProductDetailResponse> {
    const productId = this.id(id);
    return this.run(token, undefined, (context) => core.getProduct(context, productId));
  }

  createProduct(
    token: string | undefined,
    body: ProductCreateRequest,
    requestId?: string,
  ): Promise<ProductDetailResponse> {
    return this.run(token, requestId, (context) => core.createProduct(context, body));
  }

  editProduct(
    token: string | undefined,
    id: string,
    body: ProductEditRequest,
    requestId?: string,
  ): Promise<ProductDetailResponse> {
    const productId = this.id(id);
    return this.run(token, requestId, (context) => core.editProduct(context, productId, body));
  }

  changeStatus(
    token: string | undefined,
    id: string,
    body: ProductStatusRequest,
    requestId?: string,
  ): Promise<ProductDetailResponse> {
    const productId = this.id(id);
    return this.run(token, requestId, (context) => core.changeStatus(context, productId, body));
  }

  // ------------------------------------------------------------------------------------------- variants

  createVariant(
    token: string | undefined,
    id: string,
    body: ProductVariantCreateRequest,
    requestId?: string,
  ): Promise<ProductDetailResponse> {
    const productId = this.id(id);
    return this.run(token, requestId, (context) => core.createVariant(context, productId, body));
  }

  editVariant(
    token: string | undefined,
    id: string,
    variantId: string,
    body: ProductVariantEditRequest,
    requestId?: string,
  ): Promise<ProductDetailResponse> {
    const productId = this.id(id);
    const variant = this.id(variantId);
    return this.run(token, requestId, (context) =>
      core.editVariant(context, productId, variant, body),
    );
  }

  changePrice(
    token: string | undefined,
    id: string,
    variantId: string,
    body: ProductPriceChangeRequest,
    requestId?: string,
  ): Promise<ProductDetailResponse> {
    const productId = this.id(id);
    const variant = this.id(variantId);
    return this.run(token, requestId, (context) =>
      core.changePrice(context, productId, variant, body),
    );
  }

  createPromotion(
    token: string | undefined,
    id: string,
    variantId: string,
    body: ProductPromotionCreateRequest,
    requestId?: string,
  ): Promise<ProductDetailResponse> {
    const productId = this.id(id);
    const variant = this.id(variantId);
    return this.run(token, requestId, (context) =>
      core.createPromotion(context, productId, variant, body),
    );
  }

  endPromotion(
    token: string | undefined,
    id: string,
    promotionId: string,
    requestId?: string,
  ): Promise<ProductDetailResponse> {
    const productId = this.id(id);
    const promotion = this.id(promotionId);
    return this.run(token, requestId, (context) =>
      core.endPromotion(context, productId, promotion),
    );
  }

  // --------------------------------------------------------------------------------------------- images

  addImage(
    token: string | undefined,
    id: string,
    body: ProductImageAddRequest,
    requestId?: string,
  ): Promise<ProductDetailResponse> {
    const productId = this.id(id);
    return this.run(token, requestId, (context) => core.addImage(context, productId, body));
  }

  orderImages(
    token: string | undefined,
    id: string,
    body: ProductImageOrderRequest,
    requestId?: string,
  ): Promise<ProductDetailResponse> {
    const productId = this.id(id);
    return this.run(token, requestId, (context) => core.orderImages(context, productId, body));
  }

  removeImage(
    token: string | undefined,
    id: string,
    imageId: string,
    requestId?: string,
  ): Promise<ProductDetailResponse> {
    const productId = this.id(id);
    const image = this.id(imageId);
    return this.run(token, requestId, (context) => core.removeImage(context, productId, image));
  }

  // ------------------------------------------------------------------------------------------------ settings

  settings(token: string | undefined): Promise<ProductSettingsResponse> {
    return this.run(token, undefined, (context) => settingsCore.getSettings(context));
  }

  editSettings(
    token: string | undefined,
    body: ProductSettingsEditRequest,
    requestId?: string,
  ): Promise<ProductSettingsResponse> {
    return this.run(token, requestId, (context) => settingsCore.editSettings(context, body));
  }

  private id(value: string): string {
    if (!UUID.test(value)) throw new AuthError('NOT_FOUND');
    return value.toLowerCase();
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
