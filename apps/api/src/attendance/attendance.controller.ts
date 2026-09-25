import type {
  AttendanceCheckInRequest,
  AttendanceCorrectionRequest,
  AttendanceListResponse,
  AttendanceRecordResponse,
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
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { requireEmptyObject } from '../auth/session-auth.controller.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { AttendanceService } from './attendance.service.js';

const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const INSTANT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(?:Z|[+-][0-9]{2}:[0-9]{2})$/;

class CheckInDto implements AttendanceCheckInRequest {
  @ApiProperty() @IsString() @MaxLength(36) branchId!: string;
}

class CorrectionDto implements AttendanceCorrectionRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
  @ApiProperty({ required: false, description: 'ISO-8601 instant within the same business date.' })
  @IsOptional()
  @IsString()
  @Matches(INSTANT)
  checkInAt?: string;
  @ApiProperty({ required: false, description: 'ISO-8601 instant after the check-in.' })
  @IsOptional()
  @IsString()
  @Matches(INSTANT)
  checkOutAt?: string;
  @ApiProperty() @IsString() @MaxLength(2_048) reason!: string;
}

class OwnQueryDto {
  @IsOptional() @IsString() @Matches(DATE) from?: string;
  @IsOptional() @IsString() @Matches(DATE) to?: string;
  @IsOptional() @IsString() @MaxLength(36) branchId?: string;
}

class BranchQueryDto extends OwnQueryDto {
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
 * Attendance V1. The global guard enforces JSON, exact Origin and the session-bound CSRF
 * token on every command; the session cookie identifies the actor.
 */
@Controller('api/v1/attendance')
export class AttendanceController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(AttendanceService) private readonly attendance: AttendanceService,
  ) {}

  @Post('check-in')
  @HttpCode(201)
  checkIn(
    @Body() body: CheckInDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AttendanceRecordResponse> {
    return this.attendance.checkIn(this.session(request), body, requestId(response));
  }

  @Post(':id/check-out')
  @HttpCode(200)
  checkOut(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AttendanceRecordResponse> {
    requireEmptyObject(body);
    return this.attendance.checkOut(this.session(request), id, requestId(response));
  }

  @Post(':id/correct')
  @HttpCode(200)
  correct(
    @Param('id') id: string,
    @Body() body: CorrectionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AttendanceRecordResponse> {
    return this.attendance.correct(this.session(request), id, body, requestId(response));
  }

  @Get('me')
  listOwn(@Query() query: OwnQueryDto, @Req() request: Request): Promise<AttendanceListResponse> {
    return this.attendance.listOwn(this.session(request), defined({ ...query }));
  }

  @Get()
  listBranch(
    @Query() query: BranchQueryDto,
    @Req() request: Request,
  ): Promise<AttendanceListResponse> {
    return this.attendance.listBranch(this.session(request), defined({ ...query }));
  }

  private session(request: Request): string | undefined {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }
}
