import type { OperationalReasonRequest, OperationalTodayResponse } from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { requireEmptyObject } from '../auth/session-auth.controller.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { OperationsService } from './operations.service.js';

class ReasonDto implements OperationalReasonRequest {
  @ApiProperty() @IsString() @MaxLength(2_048) reason!: string;
}

function requestId(response: Response): string | undefined {
  const value = response.getHeader('x-request-id');
  return typeof value === 'string' ? value : undefined;
}

/**
 * Operational booking board, computed queue and customer arrival (Phase 3 Step 5). Branch
 * scope and permissions are decided by the service for the record's own branch; the global
 * guard enforces JSON, exact Origin and the session-bound CSRF token on every POST.
 */
@Controller('api/v1/operations')
export class OperationsController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(OperationsService) private readonly operations: OperationsService,
  ) {}

  @Get('branches/:branchId/today')
  @ApiOkResponse({ description: 'Today: bookings with derived states, and the computed queue.' })
  today(
    @Param('branchId') branchId: string,
    @Req() request: Request,
  ): Promise<OperationalTodayResponse> {
    return this.operations.today(this.session(request), branchId);
  }

  @Post('bookings/:id/arrive')
  @HttpCode(200)
  @ApiOkResponse({ description: 'The visit (created, or the same one on a repeat).' })
  arrive(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ visitId: string }> {
    // Arrival takes no input: the booking id is in the path.
    requireEmptyObject(body);
    return this.operations.arrive(this.session(request), id, requestId(response));
  }

  @Post('bookings/:id/no-show')
  @HttpCode(204)
  @ApiNoContentResponse({
    description: 'NO_SHOW, which also releases the slot; repeat is harmless.',
  })
  noShow(
    @Param('id') id: string,
    @Body() body: ReasonDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    return this.operations.noShow(this.session(request), id, body, requestId(response));
  }

  @Post('visits/:id/advance')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Manager queue override (audited).' })
  advance(
    @Param('id') id: string,
    @Body() body: ReasonDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    return this.operations.advance(this.session(request), id, body, requestId(response));
  }

  private session(request: Request): string | undefined {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }
}
