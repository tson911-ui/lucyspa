import type { AssistantAnswer, AssistantAskRequest, AssistantStatus } from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { AssistantService } from './assistant.service.js';

/*
 * Claude integration Wave C (CI-S1): the report assistant (`USE_AI_ASSISTANT`, GLOBAL). The decorator keeps a wrong type out; the service
 * validates the question again (length, control characters) and decides authority, switches, limits and money before anything is called.
 */
class AskDto implements AssistantAskRequest {
  @ApiProperty() @IsString() @MaxLength(2000) question!: string;
}

@Controller('api/v1/ai/assistant')
export class AssistantController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(AssistantService) private readonly assistant: AssistantService,
  ) {}

  @Get()
  @ApiOkResponse({
    description:
      'Whether the question box can be used now, and how many questions are left this hour.',
  })
  status(@Req() request: Request): Promise<AssistantStatus> {
    return this.assistant.status(this.session(request));
  }

  @Post('ask')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'One question about the reports. The answer only quotes numbers the report tools returned; otherwise it says it is not sure. Limited to what the asker may already open.',
  })
  ask(
    @Body() body: AskDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AssistantAnswer> {
    return this.assistant.ask(this.session(request), body, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
