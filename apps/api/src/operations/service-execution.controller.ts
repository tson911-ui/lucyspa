import type { MyServiceWorkResponse, ServiceExecutionWork } from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { requireEmptyObject } from '../auth/session-auth.controller.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { ServiceExecutionService } from './service-execution.service.js';

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

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
