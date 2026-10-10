import type {
  SupplierSourceCadence,
  SupplierSourceCreateRequest,
  SupplierSourceEditRequest,
  SupplierSourceKind,
  SupplierSourceListResponse,
  SupplierSourcePermissionRequest,
  SupplierSourceResponse,
  SupplierSourceVersionRequest,
} from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { SupplierSourceService } from './supplier-source.service.js';

/*
 * Only the contract's fields are accepted (the global pipe forbids unknown ones). Values are validated again, with exact rules, in the
 * core: the decorators only keep the wrong types out.
 */
class CreateDto implements SupplierSourceCreateRequest {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(64) supplierId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(400) supplierName?: string;
  @ApiProperty() @IsString() @MaxLength(400) name!: string;
  @ApiProperty() @IsString() @MaxLength(16) kind!: SupplierSourceKind;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(600)
  baseUrl?: string | null;
}

class EditDto implements SupplierSourceEditRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(400) name?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(600) baseUrl?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  scanCadence?: SupplierSourceCadence;
}

class PermissionDto implements SupplierSourcePermissionRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
  @ApiProperty() @IsString() @MaxLength(600) givenBy!: string;
  @ApiProperty() @IsString() @MaxLength(600) method!: string;
  @ApiProperty() @IsString() @MaxLength(10) date!: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
  @ApiProperty() @IsBoolean() permitsText!: boolean;
  @ApiProperty() @IsBoolean() permitsImages!: boolean;
  @ApiProperty() @IsBoolean() permitsPrices!: boolean;
}

class VersionDto implements SupplierSourceVersionRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
}

@Controller('api/v1/supplier-sources')
export class SupplierSourceController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(SupplierSourceService) private readonly sources: SupplierSourceService,
  ) {}

  @Get()
  @ApiOkResponse({
    description:
      'The supplier sources, newest first, and the suppliers a new one can belong to (MANAGE_SUPPLIER_SOURCES or REVIEW_SUPPLIER_IMPORTS).',
  })
  list(@Req() request: Request): Promise<SupplierSourceListResponse> {
    return this.sources.list(this.session(request));
  }

  @Post()
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Adds a source: disabled, no permission recorded (MANAGE_SUPPLIER_SOURCES). Gives a supplier by id, or by name to use or create.',
  })
  create(
    @Body() body: CreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SupplierSourceResponse> {
    return this.sources.create(this.session(request), body, this.requestId(response));
  }

  @Post(':id/edit')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Changes the name, the address or the cadence of a source.' })
  edit(
    @Param('id') id: string,
    @Body() body: EditDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SupplierSourceResponse> {
    return this.sources.edit(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/permission')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Records who gave the permission, how, when and for which content; clears an earlier confirmation and disables the source.',
  })
  permission(
    @Param('id') id: string,
    @Body() body: PermissionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SupplierSourceResponse> {
    return this.sources.permission(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/confirm-permission')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Confirms the recorded permission as the acting person.' })
  confirm(
    @Param('id') id: string,
    @Body() body: VersionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SupplierSourceResponse> {
    return this.sources.confirm(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/enable')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Enables a source whose permission record is complete, confirmed and covers text or images.',
  })
  enable(
    @Param('id') id: string,
    @Body() body: VersionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SupplierSourceResponse> {
    return this.sources.enable(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/disable')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Disables a source; nothing is deleted.' })
  disable(
    @Param('id') id: string,
    @Body() body: VersionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SupplierSourceResponse> {
    return this.sources.disable(this.session(request), id, body, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
