import type {
  CatalogStatusRequest,
  EmployeeSkillGrantRequest,
  EmployeeSkillRevokeRequest,
  EmployeeSkillsResponse,
  SkillCreateRequest,
  SkillListResponse,
  SkillResponse,
  SkillUpdateRequest,
} from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { SkillService } from './skill.service.js';

const MAX_VERSION = 2_147_483_647;

class VersionedDto {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
}

class SkillCreateDto implements SkillCreateRequest {
  @ApiProperty() @IsString() @MaxLength(64) code!: string;
  @ApiProperty() @IsString() @MaxLength(1_024) nameVi!: string;
  @ApiProperty() @IsString() @MaxLength(1_024) nameEn!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2_048) reason?: string;
}

class SkillUpdateDto extends VersionedDto implements SkillUpdateRequest {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(1_024) nameVi?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(1_024) nameEn?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2_048) reason?: string;
}

class StatusDto extends VersionedDto implements CatalogStatusRequest {
  @ApiProperty() @IsBoolean() isActive!: boolean;
  @ApiProperty() @IsString() @MaxLength(2_048) reason!: string;
}

class GrantDto implements EmployeeSkillGrantRequest {
  @ApiProperty() @IsString() @MaxLength(36) skillId!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2_048) reason?: string;
}

class RevokeDto implements EmployeeSkillRevokeRequest {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2_048) reason?: string;
}

function requestId(response: Response): string | undefined {
  const value = response.getHeader('x-request-id');
  return typeof value === 'string' ? value : undefined;
}

/**
 * Skill catalog and employee skills. The global guard enforces JSON, exact Origin and
 * the session-bound CSRF token on every command.
 */
@Controller('api/v1')
export class SkillController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(SkillService) private readonly skills: SkillService,
  ) {}

  @Get('skills')
  listSkills(@Req() request: Request): Promise<SkillListResponse> {
    return this.skills.listSkills(this.session(request));
  }

  @Post('skills')
  @HttpCode(201)
  createSkill(
    @Body() body: SkillCreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SkillResponse> {
    return this.skills.createSkill(this.session(request), body, requestId(response));
  }

  @Post('skills/:id')
  @HttpCode(200)
  updateSkill(
    @Param('id') id: string,
    @Body() body: SkillUpdateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SkillResponse> {
    return this.skills.updateSkill(this.session(request), id, body, requestId(response));
  }

  @Post('skills/:id/status')
  @HttpCode(200)
  setSkillStatus(
    @Param('id') id: string,
    @Body() body: StatusDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SkillResponse> {
    return this.skills.setSkillStatus(this.session(request), id, body, requestId(response));
  }

  @Get('employees/:id/skills')
  employeeSkills(
    @Param('id') id: string,
    @Req() request: Request,
  ): Promise<EmployeeSkillsResponse> {
    return this.skills.employeeSkills(this.session(request), id);
  }

  @Post('employees/:id/skills')
  @HttpCode(200)
  grant(
    @Param('id') id: string,
    @Body() body: GrantDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EmployeeSkillsResponse> {
    return this.skills.grantEmployeeSkill(this.session(request), id, body, requestId(response));
  }

  @Post('employees/:id/skills/:skillId/revoke')
  @HttpCode(200)
  revoke(
    @Param('id') id: string,
    @Param('skillId') skillId: string,
    @Body() body: RevokeDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EmployeeSkillsResponse> {
    return this.skills.revokeEmployeeSkill(
      this.session(request),
      id,
      skillId,
      body,
      requestId(response),
    );
  }

  private session(request: Request): string | undefined {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }
}
