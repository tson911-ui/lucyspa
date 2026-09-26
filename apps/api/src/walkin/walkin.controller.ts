import type {
  VisitParticipantKindName,
  WalkInCreateRequest,
  WalkInIntentRequest,
  WalkInMemberLookupResponse,
  WalkInOptionsResponse,
  WalkInParticipantInput,
  WalkInVisitResponse,
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
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { requireEmptyObject } from '../auth/session-auth.controller.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { WALKIN_LIMITS } from './walkin.core.js';
import { WalkInService } from './walkin.service.js';

const KINDS: VisitParticipantKindName[] = ['MEMBER', 'GUEST', 'CHILD'];

class ParticipantDto implements WalkInParticipantInput {
  @ApiProperty() @IsString() @MaxLength(32) key!: string;
  @ApiProperty({ enum: KINDS }) @IsIn(KINDS) kind!: VisitParticipantKindName;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  customerUserId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(400) displayName?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(32) guardianKey?: string;
}

class LineDto {
  @ApiProperty() @IsString() @MaxLength(32) participantKey!: string;
  @ApiProperty() @IsString() @MaxLength(64) serviceId!: string;
  @ApiProperty({ nullable: true, description: 'A requested KTV, or null for Any KTV.' })
  @ValidateIf((line: LineDto) => line.requestedEmployeeUserId !== null)
  @IsString()
  @MaxLength(64)
  requestedEmployeeUserId!: string | null;
}

/** No visit code, arrival time, status, owner, KTV assignment or price is accepted. */
class CreateWalkInDto implements WalkInCreateRequest {
  @ApiProperty() @IsString() @MaxLength(64) idempotencyKey!: string;
  @ApiProperty({ type: [ParticipantDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(WALKIN_LIMITS.participants)
  @ValidateNested({ each: true })
  @Type(() => ParticipantDto)
  participants!: ParticipantDto[];
  @ApiProperty({ type: [LineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(WALKIN_LIMITS.lines)
  @ValidateNested({ each: true })
  @Type(() => LineDto)
  lines!: LineDto[];
}

class IntentDto implements WalkInIntentRequest {
  @ApiProperty({ nullable: true })
  @ValidateIf((body: IntentDto) => body.requestedEmployeeUserId !== null)
  @IsString()
  @MaxLength(64)
  requestedEmployeeUserId!: string | null;
}

class CancelDto {
  @ApiProperty() @IsString() @MaxLength(2_048) reason!: string;
}

class LookupQueryDto {
  @IsOptional() @IsString() @MaxLength(128) phone?: string;
  @IsOptional() @IsString() @MaxLength(320) email?: string;
}

function requestId(response: Response): string | undefined {
  const value = response.getHeader('x-request-id');
  return typeof value === 'string' ? value : undefined;
}

/**
 * Walk-in (Phase 3 Step 6): member lookup, intake options, intake with immediate assignment
 * attempt, initial assignment of a waiting sequence, and waiting intent. Permission and branch
 * scope are decided by the service; the global guard enforces JSON, exact Origin and CSRF.
 */
@Controller('api/v1/operations')
export class WalkInController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(WalkInService) private readonly walkIns: WalkInService,
  ) {}

  @Get('branches/:branchId/members')
  @ApiOkResponse({ description: 'Exact phone or email match of an active member (masked).' })
  members(
    @Param('branchId') branchId: string,
    @Query() query: LookupQueryDto,
    @Req() request: Request,
  ): Promise<WalkInMemberLookupResponse> {
    return this.walkIns.lookup(this.session(request), branchId, query);
  }

  @Get('branches/:branchId/walk-in-options')
  @ApiOkResponse({ description: 'Services offered here and the KTVs qualified today.' })
  options(
    @Param('branchId') branchId: string,
    @Req() request: Request,
  ): Promise<WalkInOptionsResponse> {
    return this.walkIns.options(this.session(request), branchId);
  }

  @Post('branches/:branchId/walk-ins')
  @HttpCode(201)
  @ApiCreatedResponse({ description: 'The walk-in visit; each sequence assigned now or waiting.' })
  create(
    @Param('branchId') branchId: string,
    @Body() body: CreateWalkInDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WalkInVisitResponse> {
    return this.walkIns.create(this.session(request), branchId, body, requestId(response));
  }

  @Post('visits/:visitId/participants/:participantId/assign')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Initial assignment of the waiting sequence, or still waiting.' })
  assign(
    @Param('visitId') visitId: string,
    @Param('participantId') participantId: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WalkInVisitResponse> {
    requireEmptyObject(body);
    return this.walkIns.assign(this.session(request), visitId, participantId, requestId(response));
  }

  @Post('visits/:visitId/lines/:lineId/intent')
  @HttpCode(200)
  @ApiOkResponse({ description: 'The waiting line’s requested KTV (or Any) changed.' })
  intent(
    @Param('visitId') visitId: string,
    @Param('lineId') lineId: string,
    @Body() body: IntentDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WalkInVisitResponse> {
    return this.walkIns.changeIntent(
      this.session(request),
      visitId,
      lineId,
      body,
      requestId(response),
    );
  }

  @Post('visits/:visitId/cancel-walk-in')
  @HttpCode(200)
  @ApiOkResponse({ description: 'The waiting walk-in left before any service started.' })
  cancel(
    @Param('visitId') visitId: string,
    @Body() body: CancelDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WalkInVisitResponse> {
    return this.walkIns.cancel(this.session(request), visitId, body, requestId(response));
  }

  private session(request: Request): string | undefined {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }
}
