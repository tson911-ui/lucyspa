import type {
  ChatCallbackRequestBody,
  ChatCallbackResponse,
  ChatMessageRequest,
  ChatMessageResponse,
  ChatRequestList,
  ChatRequestRow,
  ChatRequestStatusRequest,
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
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthError } from '../auth/auth.error.js';
import { sessionCookie } from '../auth/cookies.js';
import { clientIdentity } from '../platform/public-rate-limit.core.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { ChatRequestService } from './chat-requests.service.js';
import { ChatRateLimited, PublicChatService } from './chat.service.js';

/*
 * Claude integration Wave B (CI-B2). The decorators keep wrong types and oversized bodies out; the service validates every value again
 * (cleaning, lengths, the session id, the switches). The global guard still requires JSON, the exact Origin and the session-bound CSRF
 * token (a visitor gets an anonymous session from `GET /api/v1/auth/context` like every other public form), so no exemption exists.
 */
class ChatMessageDto implements ChatMessageRequest {
  @ApiProperty() @IsString() @MaxLength(64) sessionId!: string;
  @ApiProperty() @IsString() @MaxLength(2_000) message!: string;
  @ApiProperty({ enum: ['vi', 'en'] }) @IsIn(['vi', 'en']) locale!: 'vi' | 'en';
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(200) website?: string;
}

class ChatCallbackDto implements ChatCallbackRequestBody {
  @ApiProperty() @IsString() @MaxLength(64) phone!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(400) name?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2_000) note?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(64) branchCode?: string;
  @ApiProperty({ enum: ['vi', 'en'] }) @IsIn(['vi', 'en']) locale!: 'vi' | 'en';
  @ApiProperty() @IsBoolean() consent!: boolean;
  @ApiProperty() @IsIn(['OFF', 'N8N_DOWN', 'CAP_REACHED', 'VISITOR']) reason!:
    'OFF' | 'N8N_DOWN' | 'CAP_REACHED' | 'VISITOR';
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(200) website?: string;
}

class StatusDto implements ChatRequestStatusRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedRowVersion!: number;
  @ApiProperty({ enum: ['CALLED', 'CLOSED'] }) @IsIn(['CALLED', 'CLOSED']) status!:
    'CALLED' | 'CLOSED';
}

/** Turns a visitor-must-wait into HTTP 429 with the seconds to wait. */
async function limited<T>(response: Response, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ChatRateLimited) {
      response.setHeader('retry-after', String(error.retryAfterSeconds));
      throw new AuthError('RATE_LIMITED');
    }
    throw error;
  }
}

/** The website chat, anonymous. Nothing here is cached: every answer is about one visitor's message. */
@Controller('api/v1/public/chat')
export class PublicChatController {
  constructor(@Inject(PublicChatService) private readonly chat: PublicChatService) {}

  @Post('messages')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Relays one visitor message to the shop’s n8n bot and answers with plain text (and a booking link built here), or tells the widget to show the callback form. 429 with Retry-After when a limit is reached.',
  })
  message(
    @Body() body: ChatMessageDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ChatMessageResponse> {
    response.setHeader('cache-control', 'no-store');
    return limited(response, () =>
      this.chat.message(body, clientIdentity(request.headers['x-forwarded-for'])),
    );
  }

  @Post('callback')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Stores a "please call me back" request (phone required, consent required) for the staff inbox and tells the staff. Never stores the chat.',
  })
  callback(
    @Body() body: ChatCallbackDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ChatCallbackResponse> {
    response.setHeader('cache-control', 'no-store');
    return limited(response, () =>
      this.chat.callback(body, clientIdentity(request.headers['x-forwarded-for'])),
    );
  }
}

/** The staff inbox of those requests (`MANAGE_CHAT_REQUESTS`, GLOBAL). */
@Controller('api/v1/chat-requests')
export class ChatRequestController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(ChatRequestService) private readonly requests: ChatRequestService,
  ) {}

  @Get()
  @ApiOkResponse({ description: 'Callback requests, 20 per page, with counts per status.' })
  list(
    @Req() request: Request,
    @Query('status') status?: string,
    @Query('page') page?: string,
  ): Promise<ChatRequestList> {
    const parsed = page === undefined ? undefined : Number(page);
    return this.requests.list(this.session(request), {
      status,
      page: parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
    });
  }

  @Post(':id/status')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Marks a request called or closed (forward only); a stale version is a conflict. Audited.',
  })
  setStatus(
    @Param('id') id: string,
    @Body() body: StatusDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ChatRequestRow> {
    const value = response.getHeader('x-request-id');
    return this.requests.setStatus(
      this.session(request),
      id,
      body,
      typeof value === 'string' ? value : undefined,
    );
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }
}
