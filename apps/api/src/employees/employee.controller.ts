import type {
  EmployeeBaseSalaryRequest,
  EmployeeCreateRequest,
  EmployeeProfileUpdateRequest,
  EmployeeResponse,
  EmployeeScopeChangeRequest,
  EmployeeSetupIssueRequest,
  EmployeeSetupIssueResponse,
  EmployeeStatusChangeRequest,
} from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
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
import { EmployeeService } from './employee.service.js';

const SALARY = /^(?:0|[1-9][0-9]{0,17})$/;
const MAX_VERSION = 2_147_483_647;

class EmployeeCreateDto implements EmployeeCreateRequest {
  @ApiProperty() @IsString() @MaxLength(256) employeeId!: string;
  @ApiProperty() @IsString() @MaxLength(1_024) fullName!: string;
  @ApiProperty() @IsString() @MaxLength(10) dateOfBirth!: string;
  @ApiProperty() @IsString() @MaxLength(2_048) address!: string;
  @ApiProperty() @IsString() @MaxLength(128) phone!: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1_024)
  email?: string | null;
  @ApiProperty({ enum: ['vi', 'en'] }) @IsIn(['vi', 'en']) locale!: 'vi' | 'en';
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(36, { each: true })
  branchIds!: string[];
  @ApiProperty({ required: false, nullable: true, description: 'Nonnegative integer VND.' })
  @IsOptional()
  @IsString()
  @Matches(SALARY)
  baseSalaryVnd?: string | null;
}

class VersionedDto {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
}

class EmployeeProfileDto extends VersionedDto implements EmployeeProfileUpdateRequest {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(1_024) fullName?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(10) dateOfBirth?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2_048) address?: string;
  @ApiProperty({ required: false, enum: ['vi', 'en'] })
  @IsOptional()
  @IsIn(['vi', 'en'])
  locale?: 'vi' | 'en';
}

class ReasonedDto extends VersionedDto {
  @ApiProperty() @IsString() @MaxLength(2_048) reason!: string;
}

class EmployeeStatusDto extends ReasonedDto implements EmployeeStatusChangeRequest {
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsIn(['ACTIVE', 'INACTIVE'])
  status!: 'ACTIVE' | 'INACTIVE';
}

class EmployeeScopeDto extends ReasonedDto implements EmployeeScopeChangeRequest {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(36, { each: true })
  branchIds!: string[];
}

class EmployeeBaseSalaryDto extends ReasonedDto implements EmployeeBaseSalaryRequest {
  @ApiProperty({ nullable: true, description: 'Nonnegative integer VND; null = unknown.' })
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @Matches(SALARY)
  baseSalaryVnd!: string | null;
}

class EmployeeSetupIssueDto extends ReasonedDto implements EmployeeSetupIssueRequest {}

/**
 * Workforce employee administration. The global guard enforces JSON, exact Origin and
 * the session-bound CSRF token on every command; the session cookie identifies the actor.
 */
@Controller('api/v1/employees')
export class EmployeeController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
  ) {}

  @Post()
  @HttpCode(201)
  @ApiCreatedResponse({ description: 'PENDING_SETUP employee; issue setup separately.' })
  create(
    @Body() body: EmployeeCreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EmployeeResponse> {
    return this.employees.create(this.session(request), body, requestId(response));
  }

  @Get(':id')
  @ApiOkResponse({ description: 'Pay appears only with VIEW_EMPLOYEE_PAY for every branch.' })
  get(@Param('id') id: string, @Req() request: Request): Promise<EmployeeResponse> {
    return this.employees.get(this.session(request), id);
  }

  @Post(':id/profile')
  @HttpCode(200)
  updateProfile(
    @Param('id') id: string,
    @Body() body: EmployeeProfileDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EmployeeResponse> {
    return this.employees.updateProfile(this.session(request), id, body, requestId(response));
  }

  @Post(':id/status')
  @HttpCode(200)
  changeStatus(
    @Param('id') id: string,
    @Body() body: EmployeeStatusDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EmployeeResponse> {
    return this.employees.changeStatus(this.session(request), id, body, requestId(response));
  }

  @Post(':id/scope')
  @HttpCode(200)
  changeScope(
    @Param('id') id: string,
    @Body() body: EmployeeScopeDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EmployeeResponse> {
    return this.employees.changeScope(this.session(request), id, body, requestId(response));
  }

  @Post(':id/base-salary')
  @HttpCode(200)
  setBaseSalary(
    @Param('id') id: string,
    @Body() body: EmployeeBaseSalaryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EmployeeResponse> {
    return this.employees.setBaseSalary(this.session(request), id, body, requestId(response));
  }

  @Post(':id/setup')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Setup capability returned once; never stored raw.' })
  async issueSetup(
    @Param('id') id: string,
    @Body() body: EmployeeSetupIssueDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EmployeeSetupIssueResponse> {
    const issued = await this.employees.issueSetup(
      this.session(request),
      id,
      body,
      requestId(response),
    );
    response.setHeader('Cache-Control', 'no-store');
    return issued;
  }

  private session(request: Request): string | undefined {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }
}

function requestId(response: Response): string | undefined {
  const value = response.getHeader('x-request-id');
  return typeof value === 'string' ? value : undefined;
}
