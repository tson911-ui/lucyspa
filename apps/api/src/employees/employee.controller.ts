import type {
  EmployeeCredentialsRequest,
  EmploymentEndRequest,
  EmploymentEndResponse,
  EmploymentClassificationChangeRequest,
  EmploymentResponse,
  InitialEmploymentClassification,
  EmployeeBaseSalaryRequest,
  EmployeeCreateRequest,
  EmployeeDirectoryResponse,
  EmployeeProfileUpdateRequest,
  EmployeeResponse,
  EmployeeBranchAssignmentsResponse,
  EmployeeBranchAssignRequest,
  EmployeeBranchRevokeRequest,
  EmployeeScopeChangeRequest,
  EmployeeSetupIssueRequest,
  EmployeeSetupIssueResponse,
  EmployeeStatusChangeRequest,
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
import { ApiCreatedResponse, ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
import { EmployeeDirectoryService } from './employee-directory.service.js';
import { EmployeeService } from './employee.service.js';

const SALARY = /^(?:0|[1-9][0-9]{0,17})$/;
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const MAX_VERSION = 2_147_483_647;

class EmployeeDirectoryQueryDto {
  @IsOptional() @IsString() @MaxLength(400) q?: string;
  @IsOptional() @IsString() @MaxLength(36) branchId?: string;
  @IsOptional() @IsIn(['PENDING_SETUP', 'ACTIVE', 'INACTIVE']) status?: string;
  @IsOptional() @IsString() @MaxLength(128) cursor?: string;
  @IsOptional() @Matches(/^[1-9][0-9]{0,2}$/) limit?: string;
  @IsOptional() @IsIn(['MANAGERS', 'EMPLOYEES']) group?: string;
  @IsOptional() @Matches(/^[1-9][0-9]{0,5}$/) page?: string;
}

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
  @ApiProperty({ enum: ['TRAINEE', 'OFFICIAL_EMPLOYEE'] })
  @IsIn(['TRAINEE', 'OFFICIAL_EMPLOYEE'])
  classification!: InitialEmploymentClassification;
  @ApiProperty({ description: 'Workforce start date YYYY-MM-DD (initial classification).' })
  @IsString()
  @Matches(DATE)
  employmentStartDate!: string;
  @ApiProperty({ required: false, description: 'Required for a start date in the past.' })
  @IsOptional()
  @IsString()
  @MaxLength(2_048)
  employmentReason?: string;
  @ApiProperty({
    required: false,
    description: 'Initial workforce password (15–128 characters); account created ACTIVE.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1_024)
  initialPassword?: string;
}

class ClassificationChangeDto implements EmploymentClassificationChangeRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
  @ApiProperty({ enum: ['OFFICIAL_EMPLOYEE', 'ENDED'] })
  @IsIn(['OFFICIAL_EMPLOYEE', 'ENDED'])
  classification!: 'OFFICIAL_EMPLOYEE' | 'ENDED';
  @ApiProperty({ description: 'Effective date YYYY-MM-DD.' })
  @IsString()
  @Matches(DATE)
  effectiveDate!: string;
  @ApiProperty() @IsString() @MaxLength(2_048) reason!: string;
}

class EmploymentQueryDto {
  @IsOptional() @IsString() @Matches(DATE) date?: string;
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

class BranchAssignDto extends ReasonedDto implements EmployeeBranchAssignRequest {
  @ApiProperty() @IsString() @MaxLength(36) branchId!: string;
}

class BranchRevokeDto extends ReasonedDto implements EmployeeBranchRevokeRequest {}

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

class EmployeeCredentialsDto extends ReasonedDto implements EmployeeCredentialsRequest {
  @ApiProperty({ description: 'New workforce password (15–128 characters).' })
  @IsString()
  @MaxLength(1_024)
  newPassword!: string;
}

class EmploymentEndDto extends ReasonedDto implements EmploymentEndRequest {
  @ApiProperty({ description: 'Last classification effective date YYYY-MM-DD (ENDED from).' })
  @IsString()
  @Matches(DATE)
  effectiveDate!: string;
  @ApiProperty({ description: 'Disable sign-in now when the end date is today or earlier.' })
  @IsBoolean()
  disableAccess!: boolean;
}

/**
 * Workforce employee administration. The global guard enforces JSON, exact Origin and
 * the session-bound CSRF token on every command; the session cookie identifies the actor.
 */
@Controller('api/v1/employees')
export class EmployeeController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(EmployeeDirectoryService) private readonly directory: EmployeeDirectoryService,
  ) {}

  @Post()
  @HttpCode(201)
  @ApiCreatedResponse({
    description: 'PENDING_SETUP employee, or ACTIVE when initialPassword is provided.',
  })
  create(
    @Body() body: EmployeeCreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EmployeeResponse> {
    return this.employees.create(this.session(request), body, requestId(response));
  }

  @Get()
  @ApiOkResponse({ description: 'Directory scoped by VIEW_EMPLOYEES before paging.' })
  list(
    @Query() query: EmployeeDirectoryQueryDto,
    @Req() request: Request,
  ): Promise<EmployeeDirectoryResponse> {
    const defined = Object.fromEntries(
      Object.entries({ ...query }).filter(([, value]) => value !== undefined),
    );
    return this.directory.list(this.session(request), defined);
  }

  /** Employment classification history, current classification and classification on a date. */
  @Get(':id/employment')
  employment(
    @Param('id') id: string,
    @Query() query: EmploymentQueryDto,
    @Req() request: Request,
  ): Promise<EmploymentResponse> {
    return this.employees.employment(
      this.session(request),
      id,
      query.date === undefined ? {} : { date: query.date },
    );
  }

  /** Classification change (promotion or end), effective-dated and append-only. */
  @Post(':id/employment')
  @HttpCode(200)
  changeClassification(
    @Param('id') id: string,
    @Body() body: ClassificationChangeDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EmploymentResponse> {
    return this.employees.changeClassification(
      this.session(request),
      id,
      body,
      requestId(response),
    );
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

  @Get(':id/branch-assignments')
  @ApiOkResponse({ description: 'Active EmployeeBranchAssignment rows and revoked history.' })
  branchAssignments(
    @Param('id') id: string,
    @Req() request: Request,
  ): Promise<EmployeeBranchAssignmentsResponse> {
    return this.employees.branchAssignments(this.session(request), id);
  }

  @Post(':id/branch-assignments')
  @HttpCode(200)
  assignBranch(
    @Param('id') id: string,
    @Body() body: BranchAssignDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EmployeeBranchAssignmentsResponse> {
    return this.employees.assignBranch(this.session(request), id, body, requestId(response));
  }

  @Post(':id/branch-assignments/:branchId/revoke')
  @HttpCode(200)
  revokeBranch(
    @Param('id') id: string,
    @Param('branchId') branchId: string,
    @Body() body: BranchRevokeDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EmployeeBranchAssignmentsResponse> {
    return this.employees.revokeBranch(
      this.session(request),
      id,
      branchId,
      body,
      requestId(response),
    );
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

  /** Owner/manager-set workforce password (provision or reset). Never echoed or logged. */
  @Post(':id/credentials')
  @HttpCode(200)
  async setCredentials(
    @Param('id') id: string,
    @Body() body: EmployeeCredentialsDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EmployeeResponse> {
    const employee = await this.employees.setCredentials(
      this.session(request),
      id,
      body,
      requestId(response),
    );
    response.setHeader('Cache-Control', 'no-store');
    return employee;
  }

  /** "Kết thúc làm việc": ENDED classification and, when requested and due, no sign-in. */
  @Post(':id/end-employment')
  @HttpCode(200)
  endEmployment(
    @Param('id') id: string,
    @Body() body: EmploymentEndDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EmploymentEndResponse> {
    return this.employees.endEmployment(this.session(request), id, body, requestId(response));
  }

  private session(request: Request): string | undefined {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }
}

function requestId(response: Response): string | undefined {
  const value = response.getHeader('x-request-id');
  return typeof value === 'string' ? value : undefined;
}
