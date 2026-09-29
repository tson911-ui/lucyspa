import type {
  AddServiceLineRequest,
  AddedServiceLineResponse,
  CancelServiceLineRequest,
  CancelledServiceLineResponse,
  MyServiceWorkResponse,
  ResolveServiceExecutionRequest,
  ResolvedServiceExecutionResponse,
  ServiceExecutionWork,
  WalkInOptionsResponse,
} from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { requireEmptyObject } from '../auth/session-auth.controller.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { ServiceExecutionService } from './service-execution.service.js';

class ResolveEndDto implements ResolveServiceExecutionRequest {
  @ApiProperty() @IsString() @MaxLength(2_048) reason!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(40) endedAt?: string;
}

class CancelLineDto implements CancelServiceLineRequest {
  @ApiProperty() @IsString() @MaxLength(2_048) reason!: string;
}

/** Only ids: no service name, price, quantity or time can be supplied (unknown fields are rejected). */
class AddServiceLineDto implements AddServiceLineRequest {
  @ApiProperty() @IsString() @MaxLength(64) participantId!: string;
  @ApiProperty() @IsString() @MaxLength(64) serviceId!: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(64)
  requestedEmployeeUserId?: string | null;
  @ApiProperty() @IsString() @MaxLength(64) idempotencyKey!: string;
}

@Controller('api/v1/operations')
export class ServiceExecutionController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(ServiceExecutionService) private readonly executions: ServiceExecutionService,
  ) {}

  @Get('branches/:branchId/my-services')
  @ApiOkResponse({ description: 'Own assigned services today and any older unfinished execution.' })
  myWork(
    @Param('branchId') branchId: string,
    @Req() request: Request,
  ): Promise<MyServiceWorkResponse> {
    return this.executions.myWork(this.session(request), branchId);
  }

  @Get('service-lines/:id/execution')
  @ApiOkResponse({ description: 'Own service line, execution facts and permitted actions.' })
  get(@Param('id') id: string, @Req() request: Request): Promise<ServiceExecutionWork> {
    return this.executions.get(this.session(request), id);
  }

  @Post('service-lines/:id/start')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Start own PLANNED line; repeat returns the original running execution.',
  })
  start(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ServiceExecutionWork> {
    requireEmptyObject(body);
    return this.executions.start(this.session(request), id, this.requestId(response));
  }

  @Post('service-lines/:id/end')
  @HttpCode(200)
  @ApiOkResponse({ description: 'End own running service; repeat preserves the original END.' })
  end(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ServiceExecutionWork> {
    requireEmptyObject(body);
    return this.executions.end(this.session(request), id, this.requestId(response));
  }

  @Post('service-lines/:id/resolve-end')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Management resolution of a forgotten END (RESOLVE_SERVICE_EXECUTION; reason required); repeat by the same actor returns the original outcome.',
  })
  resolveEnd(
    @Param('id') id: string,
    @Body() body: ResolveEndDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ResolvedServiceExecutionResponse> {
    return this.executions.resolve(this.session(request), id, body, this.requestId(response));
  }

  @Get('visits/:id/add-service-options')
  @ApiOkResponse({
    description:
      'Services that can be added to this open visit (MANAGE_BOOKINGS, or PERFORM_SERVICES for a performer serving it).',
  })
  addOptions(@Param('id') id: string, @Req() request: Request): Promise<WalkInOptionsResponse> {
    return this.executions.addOptions(this.session(request), id);
  }

  @Post('visits/:id/lines')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Add one catalog service to an open visit on behalf of the customer; a repeat of the same key returns the same line.',
  })
  addLine(
    @Param('id') id: string,
    @Body() body: AddServiceLineDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AddedServiceLineResponse> {
    return this.executions.addLine(this.session(request), id, body, this.requestId(response));
  }

  @Post('service-lines/:id/cancel')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Cancel one unperformed line of an open visit (MANAGE_BOOKINGS; reason required); never a deletion.',
  })
  cancelLine(
    @Param('id') id: string,
    @Body() body: CancelLineDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CancelledServiceLineResponse> {
    return this.executions.cancelLine(this.session(request), id, body, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
