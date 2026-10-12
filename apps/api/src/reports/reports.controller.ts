import type { ReportRegistryResponse } from '@lucy-spa/contracts';
import { Controller, Get, Inject, Req } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { ReportsService } from './reports.service.js';

/**
 * Phase 8: the reports. Every route is a GET; authority (the permissions of each report at each branch) is decided inside the
 * read-only frame from the person's own authority graph.
 */
@Controller('api/v1/reports')
export class ReportsController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(ReportsService) private readonly reports: ReportsService,
  ) {}

  @Get()
  @ApiOkResponse({
    description:
      'The reports this person may open and the branches each one covers (the permissions of the report held at the branch).',
  })
  registry(@Req() request: Request): Promise<ReportRegistryResponse> {
    return this.reports.registry(this.session(request));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }
}
