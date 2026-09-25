import type {
  LeaveRequestCancelRequest,
  LeaveRequestCreateRequest,
  LeaveRequestDecisionRequest,
  LeaveRequestListResponse,
  LeaveRequestResponse,
  LeaveStatus,
  LeaveType,
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
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { LEAVE_STATUSES, LEAVE_TYPES, LeaveService } from './leave.service.js';

const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

class CreateDto implements LeaveRequestCreateRequest {
  @ApiProperty({ enum: LEAVE_TYPES }) @IsIn(LEAVE_TYPES) leaveType!: LeaveType;
  @ApiProperty({ description: 'Calendar date YYYY-MM-DD (inclusive).' })
  @IsString()
  @Matches(DATE)
  startDate!: string;
  @ApiProperty({ description: 'Calendar date YYYY-MM-DD (inclusive).' })
  @IsString()
  @Matches(DATE)
  endDate!: string;
  @ApiProperty() @IsString() @MaxLength(4_000) reason!: string;
}

class VersionedDto implements LeaveRequestCancelRequest, LeaveRequestDecisionRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(4_000) reason?: string;
}

class OwnQueryDto {
  @IsOptional() @IsString() @Matches(DATE) from?: string;
  @IsOptional() @IsString() @Matches(DATE) to?: string;
  @IsOptional() @IsIn(LEAVE_STATUSES) status?: LeaveStatus;
}

class ScopedQueryDto extends OwnQueryDto {
  @IsOptional() @IsString() @MaxLength(36) employeeId?: string;
}

function requestId(response: Response): string | undefined {
  const value = response.getHeader('x-request-id');
  return typeof value === 'string' ? value : undefined;
}

function defined<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}

/**
 * Leave requests. The global guard enforces JSON, exact Origin and the session-bound CSRF
 * token on every command; the session cookie identifies the actor, and the self-service
 * body never names an employee.
 */
@Controller('api/v1/leave-requests')
export class LeaveController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(LeaveService) private readonly leave: LeaveService,
  ) {}

  @Post()
  @HttpCode(201)
  create(
    @Body() body: CreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LeaveRequestResponse> {
    return this.leave.create(this.session(request), body, requestId(response));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id') id: string,
    @Body() body: VersionedDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LeaveRequestResponse> {
    return this.leave.cancel(this.session(request), id, defined({ ...body }), requestId(response));
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @Param('id') id: string,
    @Body() body: VersionedDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LeaveRequestResponse> {
    return this.leave.approve(this.session(request), id, defined({ ...body }), requestId(response));
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @Param('id') id: string,
    @Body() body: VersionedDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LeaveRequestResponse> {
    return this.leave.reject(this.session(request), id, defined({ ...body }), requestId(response));
  }

  @Get('me')
  listOwn(@Query() query: OwnQueryDto, @Req() request: Request): Promise<LeaveRequestListResponse> {
    return this.leave.listOwn(this.session(request), defined({ ...query }));
  }

  @Get()
  listScoped(
    @Query() query: ScopedQueryDto,
    @Req() request: Request,
  ): Promise<LeaveRequestListResponse> {
    return this.leave.listScoped(this.session(request), defined({ ...query }));
  }

  private session(request: Request): string | undefined {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }
}
