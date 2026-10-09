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
  ProductPublicPageCopy,
  ProductSettingsEditRequest,
  ProductSettingsResponse,
  ProductStatusRequest,
  ProductVariantCreateRequest,
  ProductVariantEditRequest,
} from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { requireEmptyObject } from '../auth/session-auth.controller.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { ProductCatalogService } from './product-catalog.service.js';

/*
 * Only the contract's fields are accepted (the global pipe forbids unknown ones). Values are validated again, with exact rules,
 * in the core: the decorators only keep the wrong types out. Optional keys (`listPriceVnd`, `costPriceVnd`, `sortOrder`) are
 * detected by presence: an absent cost leaves the stored cost alone, a present one needs `VIEW_PRODUCT_COST`.
 */

class BrandCreateDto implements ProductBrandCreateRequest {
  @ApiProperty() @IsString() @MaxLength(400) nameVi!: string;
  @ApiProperty() @IsString() @MaxLength(400) nameEn!: string;
}

class BrandEditDto implements ProductBrandEditRequest {
  @ApiProperty() @IsInt() expectedRowVersion!: number;
  @ApiProperty() @IsString() @MaxLength(400) nameVi!: string;
  @ApiProperty() @IsString() @MaxLength(400) nameEn!: string;
  @ApiProperty() @IsBoolean() isActive!: boolean;
}

class CategoryCreateDto implements ProductCategoryCreateRequest {
  @ApiProperty({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(64)
  parentId!: string | null;
  @ApiProperty() @IsString() @MaxLength(400) nameVi!: string;
  @ApiProperty() @IsString() @MaxLength(400) nameEn!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() sortOrder?: number;
}

class CategoryEditDto implements ProductCategoryEditRequest {
  @ApiProperty() @IsInt() expectedRowVersion!: number;
  @ApiProperty({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(64)
  parentId!: string | null;
  @ApiProperty() @IsString() @MaxLength(400) nameVi!: string;
  @ApiProperty() @IsString() @MaxLength(400) nameEn!: string;
  @ApiProperty() @IsInt() sortOrder!: number;
  @ApiProperty() @IsBoolean() isActive!: boolean;
}

class ProductCreateDto implements ProductCreateRequest {
  @ApiProperty() @IsString() @MaxLength(400) nameVi!: string;
  @ApiProperty() @IsString() @MaxLength(400) nameEn!: string;
  @ApiProperty({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(8_000)
  descriptionVi!: string | null;
  @ApiProperty({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(8_000)
  descriptionEn!: string | null;
  @ApiProperty({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(64)
  brandId!: string | null;
  @ApiProperty({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(64)
  categoryId!: string | null;
  @ApiProperty() @IsBoolean() featured!: boolean;
}

class ProductEditDto extends ProductCreateDto implements ProductEditRequest {
  @ApiProperty() @IsInt() expectedRowVersion!: number;
}

class StatusDto implements ProductStatusRequest {
  @ApiProperty() @IsInt() expectedRowVersion!: number;
  @ApiProperty() @IsIn(['PUBLISHED', 'INACTIVE']) status!: 'PUBLISHED' | 'INACTIVE';
}

class VariantCreateDto implements ProductVariantCreateRequest {
  @ApiProperty() @IsString() @MaxLength(100) sku!: string;
  @ApiProperty({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(400)
  labelVi!: string | null;
  @ApiProperty({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(400)
  labelEn!: string | null;
  @ApiProperty({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(200)
  barcode!: string | null;
  @ApiProperty({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  lowStockThreshold!: number | null;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() sellOnOrder?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() sellOnline?: boolean;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  leadTimeDaysMin?: number | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  leadTimeDaysMax?: number | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  usualSupplierId?: string | null;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() sortOrder?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(32) listPriceVnd?: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  costPriceVnd?: string | null;
}

class VariantEditDto implements ProductVariantEditRequest {
  @ApiProperty() @IsInt() expectedRowVersion!: number;
  @ApiProperty({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(400)
  labelVi!: string | null;
  @ApiProperty({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(400)
  labelEn!: string | null;
  @ApiProperty({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(200)
  barcode!: string | null;
  @ApiProperty({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  lowStockThreshold!: number | null;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() sellOnOrder?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() sellOnline?: boolean;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  leadTimeDaysMin?: number | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  leadTimeDaysMax?: number | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  usualSupplierId?: string | null;
  @ApiProperty() @IsInt() sortOrder!: number;
  @ApiProperty() @IsBoolean() isActive!: boolean;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  costPriceVnd?: string | null;
}

class SettingsEditDto implements ProductSettingsEditRequest {
  @ApiProperty() @IsInt() expectedRowVersion!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() leadTimeDaysMin?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() leadTimeDaysMax?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() expiryWarningDays?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() newBadgeDays?: number;
  @ApiProperty({ required: false, type: Object })
  @IsOptional()
  @IsObject()
  publicPage?: ProductPublicPageCopy;
}

class PriceDto implements ProductPriceChangeRequest {
  @ApiProperty() @IsInt() expectedVersionNo!: number;
  @ApiProperty() @IsString() @MaxLength(32) listPriceVnd!: string;
  @ApiProperty({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(2_000)
  reason!: string | null;
}

class PromotionDto implements ProductPromotionCreateRequest {
  @ApiProperty() @IsString() @MaxLength(32) promoPriceVnd!: string;
  @ApiProperty() @IsString() @MaxLength(40) startsAt!: string;
  @ApiProperty() @IsString() @MaxLength(40) endsAt!: string;
}

class ImageAddDto implements ProductImageAddRequest {
  @ApiProperty() @IsString() @MaxLength(64) mediaAssetId!: string;
}

class ImageOrderDto implements ProductImageOrderRequest {
  @ApiProperty() @IsArray() @IsString({ each: true }) imageIds!: string[];
}

/**
 * Phase 6 P6-3: product catalog administration. The global guard enforces JSON, exact Origin and CSRF. Authority (GLOBAL only) is
 * decided in the service's transaction: `MANAGE_PRODUCTS`, `MANAGE_PRODUCT_PRICES`, `VIEW_PRODUCT_COST`. Cost and margin are absent
 * from every response built for a caller without the cost permission.
 */
@Controller('api/v1')
export class ProductCatalogController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(ProductCatalogService) private readonly catalog: ProductCatalogService,
  ) {}

  // ---------------------------------------------------------------------------------------------- brands

  @Get('product-brands')
  @ApiOkResponse({ description: 'Every brand (MANAGE_PRODUCTS or MANAGE_PRODUCT_PRICES).' })
  brands(@Req() request: Request): Promise<ProductBrandListResponse> {
    return this.catalog.brands(this.session(request));
  }

  @Post('product-brands')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Creates a brand (MANAGE_PRODUCTS).' })
  createBrand(
    @Body() body: BrandCreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductBrandResponse> {
    return this.catalog.createBrand(this.session(request), body, this.requestId(response));
  }

  @Post('product-brands/:id/edit')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Edits a brand (MANAGE_PRODUCTS).' })
  editBrand(
    @Param('id') id: string,
    @Body() body: BrandEditDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductBrandResponse> {
    return this.catalog.editBrand(this.session(request), id, body, this.requestId(response));
  }

  // ------------------------------------------------------------------------------------------ categories

  @Get('product-categories')
  @ApiOkResponse({
    description: 'Every product category (MANAGE_PRODUCTS or MANAGE_PRODUCT_PRICES).',
  })
  categories(@Req() request: Request): Promise<ProductCategoryListResponse> {
    return this.catalog.categories(this.session(request));
  }

  @Post('product-categories')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Creates a category, two levels at most (MANAGE_PRODUCTS).' })
  createCategory(
    @Body() body: CategoryCreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductCategoryResponse> {
    return this.catalog.createCategory(this.session(request), body, this.requestId(response));
  }

  @Post('product-categories/:id/edit')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Edits a category (MANAGE_PRODUCTS).' })
  editCategory(
    @Param('id') id: string,
    @Body() body: CategoryEditDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductCategoryResponse> {
    return this.catalog.editCategory(this.session(request), id, body, this.requestId(response));
  }

  // ------------------------------------------------------------------------------------------- products

  @Get('products')
  @ApiOkResponse({
    description:
      'Every product with its price range, never a cost (MANAGE_PRODUCTS or MANAGE_PRODUCT_PRICES).',
  })
  products(@Req() request: Request): Promise<ProductListResponse> {
    return this.catalog.products(this.session(request));
  }

  @Post('products')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Creates a draft product (MANAGE_PRODUCTS).' })
  createProduct(
    @Body() body: ProductCreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductDetailResponse> {
    return this.catalog.createProduct(this.session(request), body, this.requestId(response));
  }

  @Get('products/:id')
  @ApiOkResponse({
    description:
      'One product with variants, prices, promotions and images; cost and margin only with VIEW_PRODUCT_COST.',
  })
  product(@Param('id') id: string, @Req() request: Request): Promise<ProductDetailResponse> {
    return this.catalog.product(this.session(request), id);
  }

  @Post('products/:id/edit')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Edits names, descriptions, brand, category, featured (MANAGE_PRODUCTS).',
  })
  editProduct(
    @Param('id') id: string,
    @Body() body: ProductEditDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductDetailResponse> {
    return this.catalog.editProduct(this.session(request), id, body, this.requestId(response));
  }

  @Post('products/:id/status')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Publishes, or switches a product off and on (MANAGE_PRODUCTS).' })
  changeStatus(
    @Param('id') id: string,
    @Body() body: StatusDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductDetailResponse> {
    return this.catalog.changeStatus(this.session(request), id, body, this.requestId(response));
  }

  // ------------------------------------------------------------------------------------------- variants

  @Post('products/:id/variants')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Adds a variant (MANAGE_PRODUCTS); a list price also needs MANAGE_PRODUCT_PRICES, a cost VIEW_PRODUCT_COST.',
  })
  createVariant(
    @Param('id') id: string,
    @Body() body: VariantCreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductDetailResponse> {
    return this.catalog.createVariant(this.session(request), id, body, this.requestId(response));
  }

  @Post('products/:id/variants/:variantId/edit')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Edits a variant (MANAGE_PRODUCTS); a cost needs VIEW_PRODUCT_COST.',
  })
  editVariant(
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body() body: VariantEditDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductDetailResponse> {
    return this.catalog.editVariant(
      this.session(request),
      id,
      variantId,
      body,
      this.requestId(response),
    );
  }

  @Post('products/:id/variants/:variantId/price')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Appends a list price version (MANAGE_PRODUCT_PRICES).' })
  changePrice(
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body() body: PriceDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductDetailResponse> {
    return this.catalog.changePrice(
      this.session(request),
      id,
      variantId,
      body,
      this.requestId(response),
    );
  }

  @Post('products/:id/variants/:variantId/promotions')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Creates a simple price promotion (MANAGE_PRODUCT_PRICES).' })
  createPromotion(
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body() body: PromotionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductDetailResponse> {
    return this.catalog.createPromotion(
      this.session(request),
      id,
      variantId,
      body,
      this.requestId(response),
    );
  }

  @Post('products/:id/promotions/:promotionId/end')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Ends a promotion early (MANAGE_PRODUCT_PRICES).' })
  endPromotion(
    @Param('id') id: string,
    @Param('promotionId') promotionId: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductDetailResponse> {
    requireEmptyObject(body);
    return this.catalog.endPromotion(
      this.session(request),
      id,
      promotionId,
      this.requestId(response),
    );
  }

  // --------------------------------------------------------------------------------------------- images

  @Post('products/:id/images')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Adds a media library picture to the product (MANAGE_PRODUCTS).' })
  addImage(
    @Param('id') id: string,
    @Body() body: ImageAddDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductDetailResponse> {
    return this.catalog.addImage(this.session(request), id, body, this.requestId(response));
  }

  @Post('products/:id/images/order')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Sets the order of the product pictures (MANAGE_PRODUCTS).' })
  orderImages(
    @Param('id') id: string,
    @Body() body: ImageOrderDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductDetailResponse> {
    return this.catalog.orderImages(this.session(request), id, body, this.requestId(response));
  }

  @Post('products/:id/images/:imageId/remove')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Removes a picture from the product (MANAGE_PRODUCTS).' })
  removeImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductDetailResponse> {
    requireEmptyObject(body);
    return this.catalog.removeImage(this.session(request), id, imageId, this.requestId(response));
  }

  // ------------------------------------------------------------------------------------------------ settings

  @Get('product-settings')
  @ApiOkResponse({
    description:
      'The product settings: waiting time of items sold on order, expiry warning (MANAGE_PRODUCTS or MANAGE_PRODUCT_PRICES).',
  })
  settings(@Req() request: Request): Promise<ProductSettingsResponse> {
    return this.catalog.settings(this.session(request));
  }

  @Post('product-settings/edit')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Changes the product settings (MANAGE_PRODUCTS).' })
  editSettings(
    @Body() body: SettingsEditDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductSettingsResponse> {
    return this.catalog.editSettings(this.session(request), body, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
