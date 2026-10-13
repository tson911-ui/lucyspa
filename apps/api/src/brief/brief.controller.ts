import type { CustomerBrief, ProductSuggestions } from '@lucy-spa/contracts';
import { Controller, Get, Inject, Param, Req, Res } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { BriefService } from './brief.service.js';

/*
 * Claude integration Wave D (CI-S2 and CI-S3): the customer summary and the product talking points for the staff member assigned to a visit
 * line (`VIEW_CUSTOMER_BRIEF` at the branch, the visit open, no more than two hours before the planned start). Every view is audited.
 */
@Controller('api/v1/briefs/lines')
export class BriefController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(BriefService) private readonly briefs: BriefService,
  ) {}

  @Get(':lineId')
  @ApiOkResponse({
    description:
      'The facts about the customer of this visit line (computed by code) and, when staff left notes, a short summary of them.',
  })
  brief(
    @Param('lineId') lineId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CustomerBrief> {
    return this.briefs.brief(this.session(request), lineId, this.requestId(response));
  }

  @Get(':lineId/suggestions')
  @ApiOkResponse({
    description:
      'Up to three product talking points for the staff member; nothing goes to the customer.',
  })
  suggestions(
    @Param('lineId') lineId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductSuggestions> {
    return this.briefs.suggestions(this.session(request), lineId, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
