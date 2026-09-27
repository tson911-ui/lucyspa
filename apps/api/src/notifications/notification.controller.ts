import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { requireEmptyObject } from '../auth/session-auth.controller.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { NotificationService } from './notification.service.js';

class NotificationQueryDto {
  @IsOptional() @IsString() @MaxLength(61) cursor?: string;
}

@Controller('api/v1/notifications')
export class NotificationController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(NotificationService) private readonly notifications: NotificationService,
  ) {}
  @Get()
  list(@Query() query: NotificationQueryDto, @Req() request: Request) {
    return this.notifications.list(this.session(request), query.cursor);
  }
  @Get('unread-count')
  count(@Query() query: unknown, @Req() request: Request) {
    requireEmptyObject(query);
    return this.notifications.count(this.session(request));
  }
  @Post(':id/read')
  @HttpCode(200)
  read(@Param('id') id: string, @Body() body: unknown, @Req() request: Request) {
    requireEmptyObject(body);
    return this.notifications.read(this.session(request), id);
  }
  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }
}
