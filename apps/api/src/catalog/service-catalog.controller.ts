import type {
  CatalogDeleteRequest,
  CatalogDeleteResponse,
  CatalogStatusRequest,
  ServiceAvailabilityRequest,
  ServiceCategoryCreateRequest,
  ServiceCategoryListResponse,
  ServiceCategoryResponse,
  ServiceCategoryUpdateRequest,
  ServiceCreateRequest,
  ServiceListResponse,
  ServicePriceRequest,
  ServiceResponse,
  ServiceSkillsRequest,
  ServiceUpdateRequest,
} from '@lucy-spa/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { ServiceCatalogService } from './service-catalog.service.js';

const MAX_VERSION = 2_147_483_647;
const PRICE = /^(?:0|[1-9][0-9]{0,17})$/;

class VersionedDto {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
}

class DeleteDto extends VersionedDto implements CatalogDeleteRequest {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2_048) reason?: string;
}

class CategoryCreateDto implements ServiceCategoryCreateRequest {
  @ApiProperty() @IsString() @MaxLength(64) code!: string;
  @ApiProperty() @IsString() @MaxLength(1_024) nameVi!: string;
  @ApiProperty() @IsString() @MaxLength(1_024) nameEn!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() sortOrder?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2_048) reason?: string;
}

class CategoryUpdateDto extends VersionedDto implements ServiceCategoryUpdateRequest {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(1_024) nameVi?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(1_024) nameEn?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() sortOrder?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2_048) reason?: string;
}

class StatusDto extends VersionedDto implements CatalogStatusRequest {
  @ApiProperty() @IsBoolean() isActive!: boolean;
  @ApiProperty() @IsString() @MaxLength(2_048) reason!: string;
}

class ServiceCreateDto implements ServiceCreateRequest {
  @ApiProperty() @IsString() @MaxLength(64) code!: string;
  @ApiProperty() @IsString() @MaxLength(36) categoryId!: string;
  @ApiProperty() @IsString() @MaxLength(1_024) nameVi!: string;
  @ApiProperty() @IsString() @MaxLength(1_024) nameEn!: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(8_192)
  descriptionVi?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(8_192)
  descriptionEn?: string | null;
  @ApiProperty({ description: 'Nonnegative integer VND.' })
  @IsString()
  @Matches(PRICE)
  priceVnd!: string;
  @ApiProperty({
    description: 'Internal scheduling duration (minutes); >= estimatedMaxMinutes; never public.',
  })
  @IsInt()
  durationMinutes!: number;
  @ApiProperty({
    required: false,
    description: 'Customer-facing estimate, minimum minutes. Give both bounds or neither.',
  })
  @IsOptional()
  @IsInt()
  estimatedMinMinutes?: number;
  @ApiProperty({
    required: false,
    description: 'Customer-facing estimate, maximum minutes (<= durationMinutes).',
  })
  @IsOptional()
  @IsInt()
  estimatedMaxMinutes?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2_048) reason?: string;
}

class ServiceUpdateDto extends VersionedDto implements ServiceUpdateRequest {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(36) categoryId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(1_024) nameVi?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(1_024) nameEn?: string;
  @ApiProperty({ required: false, nullable: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(8_192)
  descriptionVi?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(8_192)
  descriptionEn?: string | null;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() durationMinutes?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() estimatedMinMinutes?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() estimatedMaxMinutes?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2_048) reason?: string;
}

class PriceDto extends VersionedDto implements ServicePriceRequest {
  @ApiProperty({ description: 'Nonnegative integer VND.' })
  @IsString()
  @Matches(PRICE)
  priceVnd!: string;
  @ApiProperty() @IsString() @MaxLength(2_048) reason!: string;
}

class AvailabilityDto implements ServiceAvailabilityRequest {
  @ApiProperty({ nullable: true, description: 'null when the branch has no row yet.' })
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsInt()
  @Min(1)
  @Max(MAX_VERSION)
  expectedVersion!: number | null;
  @ApiProperty() @IsBoolean() isActive!: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2_048) reason?: string;
}

class ServiceSkillsDto extends VersionedDto implements ServiceSkillsRequest {
  @ApiProperty({ type: [String], description: 'Complete set; ANY one skill qualifies.' })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(36, { each: true })
  skillIds!: string[];
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2_048) reason?: string;
}

class ServiceQueryDto {
  @IsOptional() @IsString() @MaxLength(36) categoryId?: string;
  @IsOptional() @IsString() @MaxLength(36) branchId?: string;
}

function requestId(response: Response): string | undefined {
  const value = response.getHeader('x-request-id');
  return typeof value === 'string' ? value : undefined;
}

/**
 * Service catalog administration and workforce reads. The global guard enforces JSON,
 * exact Origin and the session-bound CSRF token on every command.
 */
@Controller('api/v1')
export class ServiceCatalogController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(ServiceCatalogService) private readonly catalog: ServiceCatalogService,
  ) {}

  @Get('service-categories')
  listCategories(@Req() request: Request): Promise<ServiceCategoryListResponse> {
    return this.catalog.listCategories(this.session(request));
  }

  @Post('service-categories')
  @HttpCode(201)
  createCategory(
    @Body() body: CategoryCreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ServiceCategoryResponse> {
    return this.catalog.createCategory(this.session(request), body, requestId(response));
  }

  @Post('service-categories/:id')
  @HttpCode(200)
  updateCategory(
    @Param('id') id: string,
    @Body() body: CategoryUpdateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ServiceCategoryResponse> {
    return this.catalog.updateCategory(this.session(request), id, body, requestId(response));
  }

  @Post('service-categories/:id/status')
  @HttpCode(200)
  setCategoryStatus(
    @Param('id') id: string,
    @Body() body: StatusDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ServiceCategoryResponse> {
    return this.catalog.setCategoryStatus(this.session(request), id, body, requestId(response));
  }

  /** Permanent deletion of an empty, incorrectly created category (not deactivation). */
  @Post('service-categories/:id/delete')
  @HttpCode(200)
  deleteCategory(
    @Param('id') id: string,
    @Body() body: DeleteDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CatalogDeleteResponse> {
    return this.catalog.deleteCategory(this.session(request), id, body, requestId(response));
  }

  @Get('services')
  listServices(
    @Query() query: ServiceQueryDto,
    @Req() request: Request,
  ): Promise<ServiceListResponse> {
    return this.catalog.listServices(this.session(request), {
      ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
      ...(query.branchId === undefined ? {} : { branchId: query.branchId }),
    });
  }

  @Get('services/:id')
  getService(@Param('id') id: string, @Req() request: Request): Promise<ServiceResponse> {
    return this.catalog.getService(this.session(request), id);
  }

  @Post('services')
  @HttpCode(201)
  createService(
    @Body() body: ServiceCreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ServiceResponse> {
    return this.catalog.createService(this.session(request), body, requestId(response));
  }

  @Post('services/:id')
  @HttpCode(200)
  updateService(
    @Param('id') id: string,
    @Body() body: ServiceUpdateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ServiceResponse> {
    return this.catalog.updateService(this.session(request), id, body, requestId(response));
  }

  /** Permanent deletion of an incorrectly created service (not deactivation). */
  @Post('services/:id/delete')
  @HttpCode(200)
  deleteService(
    @Param('id') id: string,
    @Body() body: DeleteDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CatalogDeleteResponse> {
    return this.catalog.deleteService(this.session(request), id, body, requestId(response));
  }

  @Post('services/:id/status')
  @HttpCode(200)
  setServiceStatus(
    @Param('id') id: string,
    @Body() body: StatusDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ServiceResponse> {
    return this.catalog.setServiceStatus(this.session(request), id, body, requestId(response));
  }

  @Post('services/:id/price')
  @HttpCode(200)
  setPrice(
    @Param('id') id: string,
    @Body() body: PriceDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ServiceResponse> {
    return this.catalog.setPrice(this.session(request), id, body, requestId(response));
  }

  @Post('services/:id/skills')
  @HttpCode(200)
  setEligibleSkills(
    @Param('id') id: string,
    @Body() body: ServiceSkillsDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ServiceResponse> {
    return this.catalog.setEligibleSkills(this.session(request), id, body, requestId(response));
  }

  @Post('services/:id/branches/:branchId')
  @HttpCode(200)
  setAvailability(
    @Param('id') id: string,
    @Param('branchId') branchId: string,
    @Body() body: AvailabilityDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ServiceResponse> {
    return this.catalog.setAvailability(
      this.session(request),
      id,
      branchId,
      body,
      requestId(response),
    );
  }

  private session(request: Request): string | undefined {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }
}
