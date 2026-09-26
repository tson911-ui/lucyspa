import type {
  CollaboratorWorkCancelRequest,
  CollaboratorWorkCreateRequest,
  CollaboratorWorkListResponse,
  CollaboratorWorkMode,
  CollaboratorWorkOccurrence,
  CollaboratorWorkOptionsResponse,
  CollaboratorWorkStatus,
  CollaboratorWorkUpdateRequest,
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
import { CollaboratorWorkService } from './collaborator-work.service.js';

const MODES = ['SHIFT', 'FULL_DAY'] as const;
const STATUSES = ['SCHEDULED', 'CANCELLED'] as const;
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const TIME = /^[0-9]{2}:[0-9]{2}$/;
const VND = /^(?:0|[1-9][0-9]{0,17})$/;

class CollaboratorWorkCreateDto implements CollaboratorWorkCreateRequest {
  @ApiProperty() @IsString() @MaxLength(64) employeeId!: string;
  @ApiProperty() @IsString() @MaxLength(64) branchId!: string;
  @ApiProperty() @IsString() @Matches(DATE) workDate!: string;
  @ApiProperty({ enum: MODES }) @IsIn(MODES) mode!: CollaboratorWorkMode;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Matches(TIME) startTime?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Matches(TIME) endTime?: string;
  @ApiProperty({ required: false, nullable: true, description: 'Integer VND as a string.' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(VND)
  agreedPayVnd?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(2_048)
  note?: string | null;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2_048) reason?: string;
}

class CollaboratorWorkUpdateDto implements CollaboratorWorkUpdateRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(64) branchId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Matches(DATE) workDate?: string;
  @ApiProperty({ required: false, enum: MODES })
  @IsOptional()
  @IsIn(MODES)
  mode?: CollaboratorWorkMode;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Matches(TIME) startTime?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Matches(TIME) endTime?: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(VND)
  agreedPayVnd?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(2_048)
  note?: string | null;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2_048) reason?: string;
}

class CollaboratorWorkCancelDto implements CollaboratorWorkCancelRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
  @ApiProperty() @IsString() @MaxLength(2_048) reason!: string;
}

class CollaboratorWorkQueryDto {
  @IsString() @Matches(DATE) from!: string;
  @IsString() @Matches(DATE) to!: string;
  @IsOptional() @IsString() @MaxLength(64) branchId?: string;
  @IsOptional() @IsString() @MaxLength(64) employeeId?: string;
  @IsOptional() @IsIn(STATUSES) status?: CollaboratorWorkStatus;
}

class OwnQueryDto {
  @IsString() @Matches(DATE) from!: string;
  @IsString() @Matches(DATE) to!: string;
}

class OptionsQueryDto {
  @IsString() @MaxLength(64) branchId!: string;
  @IsString() @Matches(DATE) workDate!: string;
}

function requestId(response: Response): string | undefined {
  const value = response.getHeader('x-request-id');
  return typeof value === 'string' ? value : undefined;
}

function defined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries({ ...value }).filter(([, entry]) => entry !== undefined),
  ) as T;
}

/**
 * "Lịch làm CTV / Collaborator schedule" (follow-up Step 6). The global guard enforces
 * JSON, exact Origin and the session-bound CSRF token on every command; the session
 * cookie identifies the actor.
 */
@Controller('api/v1/collaborator-work')
export class CollaboratorWorkController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(CollaboratorWorkService) private readonly work: CollaboratorWorkService,
  ) {}

  @Get()
  @ApiOkResponse({
    description: 'Occurrences at branches the caller may view; pay only with pay visibility.',
  })
  list(
    @Query() query: CollaboratorWorkQueryDto,
    @Req() request: Request,
  ): Promise<CollaboratorWorkListResponse> {
    return this.work.list(this.session(request), defined(query));
  }

  @Get('options')
  @ApiOkResponse({
    description: 'Branch hours of the date and the collaborators who can be scheduled.',
  })
  options(
    @Query() query: OptionsQueryDto,
    @Req() request: Request,
  ): Promise<CollaboratorWorkOptionsResponse> {
    return this.work.options(this.session(request), query);
  }

  @Post()
  @HttpCode(201)
  @ApiCreatedResponse({ description: 'A SCHEDULED occurrence.' })
  create(
    @Body() body: CollaboratorWorkCreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CollaboratorWorkOccurrence> {
    return this.work.create(this.session(request), defined(body), requestId(response));
  }

  @Post(':id')
  @HttpCode(200)
  update(
    @Param('id') id: string,
    @Body() body: CollaboratorWorkUpdateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CollaboratorWorkOccurrence> {
    return this.work.update(this.session(request), id, defined(body), requestId(response));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id') id: string,
    @Body() body: CollaboratorWorkCancelDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CollaboratorWorkOccurrence> {
    return this.work.cancel(this.session(request), id, body, requestId(response));
  }

  private session(request: Request): string | undefined {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }
}

/** "Lịch làm việc" in My Account: the signed-in member's own occurrences and agreed pay. */
@Controller('api/v1/me/collaborator-work')
export class MyCollaboratorWorkController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(CollaboratorWorkService) private readonly work: CollaboratorWorkService,
  ) {}

  @Get()
  @ApiOkResponse({ description: 'Own occurrences with own agreed pay; read-only.' })
  mine(
    @Query() query: OwnQueryDto,
    @Req() request: Request,
  ): Promise<CollaboratorWorkListResponse> {
    return this.work.mine(
      sessionCookie(request.headers.cookie, this.environment.auth.cookieName),
      query,
    );
  }
}
