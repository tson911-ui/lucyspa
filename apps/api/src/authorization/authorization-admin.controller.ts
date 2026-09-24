import type {
  AuditEventPageResponse,
  EmployeeAuthorizationResponse,
  PermissionCodeName,
  PermissionOverrideRemoveRequest,
  PermissionOverrideSetRequest,
  RoleAssignRequest,
  RoleCreateRequest,
  RoleListResponse,
  RolePermissionsRequest,
  RoleResponse,
  RoleRevokeRequest,
  RoleUpdateRequest,
} from '@lucy-spa/contracts';
import { PERMISSION_CATALOG } from '@lucy-spa/database';
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
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { Request, Response } from 'express';
import { AuthError } from '../auth/auth.error.js';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { AuditReadService } from './audit-read.service.js';
import { RoleAdminService } from './role-admin.service.js';

const CODES = PERMISSION_CATALOG.map((entry) => entry.code);
const MAX_VERSION = 2_147_483_647;

class ScopeDto {
  @ApiProperty({ enum: ['GLOBAL', 'BRANCH'] }) @IsIn(['GLOBAL', 'BRANCH']) kind!:
    'GLOBAL' | 'BRANCH';
  @ApiProperty({ required: false, description: 'Required for BRANCH, forbidden for GLOBAL.' })
  @ValidateIf((scope: ScopeDto) => scope.kind === 'BRANCH' || scope.branchId !== undefined)
  @IsString()
  @MaxLength(36)
  branchId?: string;
}

function toScope(scope: ScopeDto): RoleAssignRequest['scope'] {
  if (scope.kind === 'GLOBAL') {
    if (scope.branchId !== undefined) throw new AuthError('VALIDATION_FAILED', 'scope');
    return { kind: 'GLOBAL' };
  }
  return { kind: 'BRANCH', branchId: scope.branchId! };
}

class VersionedReasonDto {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
  @ApiProperty() @IsString() @MaxLength(2_048) reason!: string;
}

class RoleCreateDto implements RoleCreateRequest {
  @ApiProperty() @IsString() @MaxLength(64) code!: string;
  @ApiProperty() @IsString() @MaxLength(512) displayNameVi!: string;
  @ApiProperty() @IsString() @MaxLength(512) displayNameEn!: string;
  @ApiProperty({ enum: CODES, isArray: true })
  @IsArray()
  @ArrayMaxSize(CODES.length)
  @IsIn(CODES, { each: true })
  permissions!: PermissionCodeName[];
  @ApiProperty() @IsString() @MaxLength(2_048) reason!: string;
}

class RoleUpdateDto extends VersionedReasonDto implements RoleUpdateRequest {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  displayNameVi?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  displayNameEn?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() isActive?: boolean;
}

class RolePermissionsDto extends VersionedReasonDto implements RolePermissionsRequest {
  @ApiProperty({ enum: CODES, isArray: true })
  @IsArray()
  @ArrayMaxSize(CODES.length)
  @IsIn(CODES, { each: true })
  permissions!: PermissionCodeName[];
}

class RoleAssignDto extends VersionedReasonDto {
  @ApiProperty() @IsString() @MaxLength(36) roleId!: string;
  @ApiProperty({ type: ScopeDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => ScopeDto)
  scope!: ScopeDto;
}

class RoleRevokeDto extends VersionedReasonDto implements RoleRevokeRequest {
  @ApiProperty() @IsString() @MaxLength(36) assignmentId!: string;
}

class OverrideSetDto extends VersionedReasonDto {
  @ApiProperty({ enum: CODES }) @IsIn(CODES) permission!: PermissionCodeName;
  @ApiProperty({ enum: ['ALLOW', 'DENY'] }) @IsIn(['ALLOW', 'DENY']) effect!: 'ALLOW' | 'DENY';
  @ApiProperty({ type: ScopeDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => ScopeDto)
  scope!: ScopeDto;
}

class OverrideRemoveDto extends VersionedReasonDto implements PermissionOverrideRemoveRequest {
  @ApiProperty() @IsString() @MaxLength(36) overrideId!: string;
}

class AuditQueryDto {
  @IsOptional() @Matches(/^[1-9][0-9]{0,2}$/) limit?: string;
  @IsOptional() @IsString() @MaxLength(256) cursor?: string;
  @IsOptional() @IsString() @MaxLength(36) branchId?: string;
  @IsOptional() @IsString() @MaxLength(64) action?: string;
  @IsOptional() @IsString() @MaxLength(36) subjectUserId?: string;
  @IsOptional() @IsString() @MaxLength(36) actorUserId?: string;
  @IsOptional() @IsString() @MaxLength(64) entityType?: string;
  @IsOptional() @IsString() @MaxLength(128) entityId?: string;
  @IsOptional() @IsString() @MaxLength(40) from?: string;
  @IsOptional() @IsString() @MaxLength(40) to?: string;
}

function requestId(response: Response): string | undefined {
  const value = response.getHeader('x-request-id');
  return typeof value === 'string' ? value : undefined;
}

/**
 * Role, assignment, override and audit-read administration. The global guard enforces
 * JSON, exact Origin and the session-bound CSRF token on every command; the session
 * cookie identifies the actor.
 */
@Controller('api/v1')
export class AuthorizationAdminController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(RoleAdminService) private readonly roles: RoleAdminService,
    @Inject(AuditReadService) private readonly audit: AuditReadService,
  ) {}

  @Get('roles')
  listRoles(@Req() request: Request): Promise<RoleListResponse> {
    return this.roles.listRoles(this.session(request));
  }

  @Post('roles')
  @HttpCode(201)
  createRole(
    @Body() body: RoleCreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RoleResponse> {
    return this.roles.createRole(this.session(request), body, requestId(response));
  }

  @Post('roles/:id')
  @HttpCode(200)
  updateRole(
    @Param('id') id: string,
    @Body() body: RoleUpdateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RoleResponse> {
    return this.roles.updateRole(this.session(request), id, body, requestId(response));
  }

  @Post('roles/:id/permissions')
  @HttpCode(200)
  setRolePermissions(
    @Param('id') id: string,
    @Body() body: RolePermissionsDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RoleResponse> {
    return this.roles.setRolePermissions(this.session(request), id, body, requestId(response));
  }

  @Get('employees/:id/authorization')
  employeeAuthorization(
    @Param('id') id: string,
    @Req() request: Request,
  ): Promise<EmployeeAuthorizationResponse> {
    return this.roles.employeeAuthorization(this.session(request), id);
  }

  @Post('employees/:id/roles')
  @HttpCode(200)
  assignRole(
    @Param('id') id: string,
    @Body() body: RoleAssignDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EmployeeAuthorizationResponse> {
    const input: RoleAssignRequest = { ...body, scope: toScope(body.scope) };
    return this.roles.assignRole(this.session(request), id, input, requestId(response));
  }

  @Post('employees/:id/roles/revoke')
  @HttpCode(200)
  revokeRole(
    @Param('id') id: string,
    @Body() body: RoleRevokeDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EmployeeAuthorizationResponse> {
    return this.roles.revokeRole(this.session(request), id, body, requestId(response));
  }

  @Post('employees/:id/overrides')
  @HttpCode(200)
  setOverride(
    @Param('id') id: string,
    @Body() body: OverrideSetDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EmployeeAuthorizationResponse> {
    const input: PermissionOverrideSetRequest = { ...body, scope: toScope(body.scope) };
    return this.roles.setOverride(this.session(request), id, input, requestId(response));
  }

  @Post('employees/:id/overrides/remove')
  @HttpCode(200)
  removeOverride(
    @Param('id') id: string,
    @Body() body: OverrideRemoveDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EmployeeAuthorizationResponse> {
    return this.roles.removeOverride(this.session(request), id, body, requestId(response));
  }

  @Get('audit-events')
  @ApiOkResponse({ description: 'Newest first; scope filtering precedes pagination.' })
  listAudit(
    @Query() query: AuditQueryDto,
    @Req() request: Request,
  ): Promise<AuditEventPageResponse> {
    const { limit, ...filters } = query;
    return this.audit.list(this.session(request), {
      ...filters,
      ...(limit === undefined ? {} : { limit: Number(limit) }),
    });
  }

  private session(request: Request): string | undefined {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }
}
