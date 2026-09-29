import type {
  AuthorizationScope,
  OrganizationAppointment,
  OrganizationAppointmentsResponse,
  OrganizationLevel,
} from '@lucy-spa/contracts';
import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { OrganizationService } from './organization.service.js';

class ReasonDto {
  @IsString() @MaxLength(500) reason!: string;
}
class VersionDto extends ReasonDto {
  @IsInt() @Min(1) expectedVersion!: number;
}
class RegionCreateDto extends ReasonDto {
  @IsString() @MaxLength(64) code!: string;
  @IsString() @MaxLength(150) name!: string;
}
class RegionUpdateDto extends VersionDto {
  @IsOptional() @IsString() @MaxLength(150) name?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class AreaCreateDto extends RegionCreateDto {
  @IsString() @MaxLength(36) regionId!: string;
}
class AreaUpdateDto extends RegionUpdateDto {
  @IsOptional() @IsString() @MaxLength(36) regionId?: string;
}
class BranchPlacementDto extends VersionDto {
  @IsOptional() @IsString() @MaxLength(36) areaId!: string | null;
}
class ScopeDto {
  @IsIn(['GLOBAL', 'REGION', 'AREA', 'BRANCH']) kind!: AuthorizationScope['kind'];
  @IsOptional() @IsString() @MaxLength(36) regionId?: string;
  @IsOptional() @IsString() @MaxLength(36) areaId?: string;
  @IsOptional() @IsString() @MaxLength(36) branchId?: string;
}
class AppointmentDto extends ReasonDto {
  @IsString() @MaxLength(36) userId!: string;
  @IsIn([
    'CEO',
    'REGIONAL_MANAGER',
    'AREA_MANAGER',
    'STORE_MANAGER',
    'DEPUTY_STORE_MANAGER',
    'TEAM_LEADER',
  ])
  level!: OrganizationLevel;
  @ValidateNested() @Type(() => ScopeDto) scope!: ScopeDto;
}
class AppointmentsQuery {
  @IsOptional() @IsString() @MaxLength(36) userId?: string;
  @IsOptional() @IsString() @MaxLength(36) branchId?: string;
}
const requestId = (response: Response) => {
  const value = response.getHeader('x-request-id');
  return typeof value === 'string' ? value : undefined;
};

@Controller('api/v1/organization')
export class OrganizationController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(OrganizationService) private readonly organization: OrganizationService,
  ) {}

  @Get() snapshot(@Req() request: Request) {
    return this.organization.snapshot(this.session(request));
  }
  @Post('regions') createRegion(
    @Body() body: RegionCreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.organization.createRegion(this.session(request), body, requestId(response));
  }
  @Post('regions/:id') updateRegion(
    @Param('id') id: string,
    @Body() body: RegionUpdateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.organization.updateRegion(this.session(request), id, body, requestId(response));
  }
  @Post('areas') createArea(
    @Body() body: AreaCreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.organization.createArea(this.session(request), body, requestId(response));
  }
  @Post('areas/:id') updateArea(
    @Param('id') id: string,
    @Body() body: AreaUpdateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.organization.updateArea(this.session(request), id, body, requestId(response));
  }
  @Post('branches/:id') placeBranch(
    @Param('id') id: string,
    @Body() body: BranchPlacementDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.organization.placeBranch(this.session(request), id, body, requestId(response));
  }
  @Get('appointments') appointments(
    @Query() query: AppointmentsQuery,
    @Req() request: Request,
  ): Promise<OrganizationAppointmentsResponse> {
    return this.organization.appointments(this.session(request), query);
  }
  @Post('appointments') appoint(
    @Body() body: AppointmentDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OrganizationAppointment> {
    return this.organization.appoint(
      this.session(request),
      { ...body, scope: body.scope as AuthorizationScope },
      requestId(response),
    );
  }
  @Post('appointments/:id/end') endAppointment(
    @Param('id') id: string,
    @Body() body: VersionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.organization.endAppointment(this.session(request), id, body, requestId(response));
  }
  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }
}
