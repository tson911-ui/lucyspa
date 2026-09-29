import type {
  EmployeeStatus,
  EmploymentClassification,
  TeamBulkSelection,
  TeamCreateRequest,
  TeamDeleteRequest,
  TeamLeaderRequest,
  TeamMembershipFilter,
  TeamMembersRequest,
  TeamUpdateRequest,
} from '@lucy-spa/contracts';
import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { IsDefined, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { TeamService } from './team.service.js';

class TeamListQuery {
  @IsOptional() @IsString() @MaxLength(36) branchId?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() limit?: string;
}

class TeamCreateDto implements TeamCreateRequest {
  @IsString() @MaxLength(36) branchId!: string;
  @IsString() @MaxLength(64) code!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsString() @MaxLength(500) reason!: string;
}

class TeamUpdateDto implements TeamUpdateRequest {
  @IsString() @MaxLength(200) name!: string;
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @MaxLength(500) reason!: string;
}

class TeamDeleteDto implements TeamDeleteRequest {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @MaxLength(500) reason!: string;
  @IsIn([true]) confirmed!: true;
}

class TeamLeaderDto implements TeamLeaderRequest {
  @IsOptional() @IsString() @MaxLength(36) userId!: string | null;
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @MaxLength(500) reason!: string;
}

class TeamEmployeesQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'PENDING_SETUP']) status?: EmployeeStatus;
  @IsOptional()
  @IsIn(['OFFICIAL_EMPLOYEE', 'COLLABORATOR', 'TRAINEE'])
  classification?: Exclude<EmploymentClassification, 'ENDED'>;
  @IsOptional()
  @IsIn(['ALL', 'MEMBERS', 'UNASSIGNED', 'OTHER_TEAM'])
  membership?: TeamMembershipFilter;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() limit?: string;
}

class TeamMembersDto implements TeamMembersRequest {
  @IsIn(['ADD', 'REMOVE', 'TRANSFER']) action!: 'ADD' | 'REMOVE' | 'TRANSFER';
  @IsOptional() @IsString() @MaxLength(36) targetTeamId?: string;
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @MaxLength(500) reason!: string;
  @IsDefined() selection!: TeamBulkSelection;
}

const requestId = (response: Response) => {
  const value = response.getHeader('x-request-id');
  return typeof value === 'string' ? value : undefined;
};

@Controller('api/v1/teams')
export class TeamController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(TeamService) private readonly teams: TeamService,
  ) {}

  @Get()
  list(@Query() query: TeamListQuery, @Req() request: Request) {
    return this.teams.list(this.session(request), query);
  }

  @Post()
  create(
    @Body() body: TeamCreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.teams.create(this.session(request), body, requestId(response));
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() request: Request) {
    return this.teams.get(this.session(request), id);
  }

  @Post(':id')
  update(
    @Param('id') id: string,
    @Body() body: TeamUpdateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.teams.update(this.session(request), id, body, requestId(response));
  }

  @Post(':id/delete')
  remove(
    @Param('id') id: string,
    @Body() body: TeamDeleteDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.teams.remove(this.session(request), id, body, requestId(response));
  }

  @Post(':id/leader')
  setLeader(
    @Param('id') id: string,
    @Body() body: TeamLeaderDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.teams.setLeader(this.session(request), id, body, requestId(response));
  }

  @Get(':id/employees')
  employees(@Param('id') id: string, @Query() query: TeamEmployeesQuery, @Req() request: Request) {
    return this.teams.employees(this.session(request), id, query);
  }

  @Post(':id/members')
  members(
    @Param('id') id: string,
    @Body() body: TeamMembersDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.teams.members(this.session(request), id, body, requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }
}
