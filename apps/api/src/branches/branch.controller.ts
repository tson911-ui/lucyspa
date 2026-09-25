import type {
  BranchCreateRequest,
  BranchHoursUpdateRequest,
  BranchListResponse,
  BranchOperatingDay,
  BranchResponse,
  BranchStatusRequest,
  BranchUpdateRequest,
} from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { BranchService } from './branch.service.js';

const LOCAL_TIME = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$/;
const MAX_VERSION = 2_147_483_647;

class BranchCreateDto implements BranchCreateRequest {
  @ApiProperty() @IsString() @MaxLength(64) code!: string;
  @ApiProperty() @IsString() @MaxLength(1_024) name!: string;
  @ApiProperty({ required: false, default: 'Asia/Ho_Chi_Minh' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
  @ApiProperty({ required: false, default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2_048) reason?: string;
}

class VersionedDto {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VERSION) expectedVersion!: number;
}

class BranchUpdateDto extends VersionedDto implements BranchUpdateRequest {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(1_024) name?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2_048) reason?: string;
}

class BranchStatusDto extends VersionedDto implements BranchStatusRequest {
  @ApiProperty() @IsBoolean() isActive!: boolean;
  @ApiProperty() @IsString() @MaxLength(2_048) reason!: string;
}

class OperatingDayDto implements BranchOperatingDay {
  @ApiProperty({ minimum: 1, maximum: 7, description: 'ISO weekday: 1 = Monday.' })
  @IsInt()
  @Min(1)
  @Max(7)
  isoWeekday!: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  @ApiProperty() @IsBoolean() isClosed!: boolean;
  @ApiProperty({ nullable: true, example: '09:00' })
  @IsOptional()
  @IsString()
  @Matches(LOCAL_TIME)
  opensAt!: string | null;
  @ApiProperty({ nullable: true, example: '21:00' })
  @IsOptional()
  @IsString()
  @Matches(LOCAL_TIME)
  closesAt!: string | null;
}

class BranchHoursDto extends VersionedDto implements BranchHoursUpdateRequest {
  @ApiProperty({ type: [OperatingDayDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => OperatingDayDto)
  days!: OperatingDayDto[];
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2_048) reason?: string;
}

function requestId(response: Response): string | undefined {
  const value = response.getHeader('x-request-id');
  return typeof value === 'string' ? value : undefined;
}

/**
 * Branch administration. The global guard enforces JSON, exact Origin and the
 * session-bound CSRF token on every command; the session cookie identifies the actor.
 */
@Controller('api/v1/branches')
export class BranchController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(BranchService) private readonly branches: BranchService,
  ) {}

  @Get()
  @ApiOkResponse({ description: 'Only branches the caller may see.' })
  list(@Req() request: Request): Promise<BranchListResponse> {
    return this.branches.list(this.session(request));
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() request: Request): Promise<BranchResponse> {
    return this.branches.get(this.session(request), id);
  }

  @Post()
  @HttpCode(201)
  @ApiCreatedResponse({ description: 'New branch with default 09:00–21:00 hours every day.' })
  create(
    @Body() body: BranchCreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BranchResponse> {
    return this.branches.create(this.session(request), body, requestId(response));
  }

  @Post(':id')
  @HttpCode(200)
  update(
    @Param('id') id: string,
    @Body() body: BranchUpdateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BranchResponse> {
    return this.branches.update(this.session(request), id, body, requestId(response));
  }

  @Post(':id/status')
  @HttpCode(200)
  setStatus(
    @Param('id') id: string,
    @Body() body: BranchStatusDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BranchResponse> {
    return this.branches.setStatus(this.session(request), id, body, requestId(response));
  }

  @Post(':id/hours')
  @HttpCode(200)
  setHours(
    @Param('id') id: string,
    @Body() body: BranchHoursDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BranchResponse> {
    return this.branches.setHours(this.session(request), id, body, requestId(response));
  }

  private session(request: Request): string | undefined {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }
}
