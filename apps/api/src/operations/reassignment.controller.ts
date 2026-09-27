import type { ReassignmentScope, ReassignServicesRequest } from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { ReassignmentService } from './reassignment.service.js';

class WorkQueryDto {
  @IsOptional() @IsString() @MaxLength(10) from?: string;
  @IsOptional() @IsString() @MaxLength(10) to?: string;
  @IsOptional() @IsIn(['true', 'false']) conflictsOnly?: 'true' | 'false';
  @IsOptional() @IsString() @MaxLength(44) cursor?: string;
}
class ScopeDto {
  @IsIn(['LINE', 'PARTICIPANT']) scope!: ReassignmentScope;
}
class TargetDto {
  @IsUUID() id!: string;
  @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
}
class ReassignDto extends ScopeDto implements ReassignServicesRequest {
  @ApiProperty({ type: [TargetDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20)
  @ValidateNested({ each: true }) @Type(() => TargetDto) targets!: TargetDto[];
  @IsUUID() employeeUserId!: string;
  @IsIn(['LEAVE', 'MANAGER']) context!: 'LEAVE' | 'MANAGER';
  @IsString() @MaxLength(1000) reason!: string;
  @IsBoolean() acknowledgeSpecific!: boolean;
}

@Controller('api/v1/operations')
export class ReassignmentController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(ReassignmentService) private readonly assignments: ReassignmentService,
  ) {}
  @Get('branches/:branchId/reassignment-work')
  list(@Param('branchId') branchId: string, @Query() query: WorkQueryDto, @Req() request: Request) {
    return this.assignments.list(this.session(request), branchId, query);
  }
  @Get('assignment-lines/:kind/:id/replacements')
  replacements(@Param('kind') kind: string, @Param('id') id: string, @Query() query: ScopeDto, @Req() request: Request) {
    return this.assignments.replacements(this.session(request), kind, id, query.scope);
  }
  @Post('assignment-lines/:kind/:id/reassign')
  @HttpCode(200)
  reassign(@Param('kind') kind: string, @Param('id') id: string, @Body() body: ReassignDto,
    @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const requestId = response.getHeader('x-request-id');
    return this.assignments.reassign(this.session(request), kind, id, body, typeof requestId === 'string' ? requestId : undefined);
  }
  private session(request: Request) { return sessionCookie(request.headers.cookie, this.environment.auth.cookieName); }
}
