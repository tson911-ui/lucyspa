import type { NotificationCategory } from '@lucy-spa/contracts';
import { NOTIFICATION_CATEGORIES } from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { requireEmptyObject } from '../auth/session-auth.controller.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { NotificationService } from './notification.service.js';

/**
 * The inbox is always the caller's own: no parameter names a recipient (and the global
 * validation pipe rejects unknown properties), so another user's inbox cannot be requested.
 */
class NotificationQueryDto {
  @IsOptional() @IsString() @MaxLength(61) cursor?: string;
  @IsOptional() @IsIn([...NOTIFICATION_CATEGORIES]) category?: NotificationCategory;
  @IsOptional() @IsIn(['true', 'false']) unread?: 'true' | 'false';
  @IsOptional() @IsIn(['true', 'false']) archived?: 'true' | 'false';
}

class ReadAllDto {
  @IsOptional() @IsIn([...NOTIFICATION_CATEGORIES]) category?: NotificationCategory;
}

@Controller('api/v1/notifications')
export class NotificationController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(NotificationService) private readonly notifications: NotificationService,
  ) {}
  @Get()
  list(@Query() query: NotificationQueryDto, @Req() request: Request) {
    return this.notifications.list(this.session(request), query.cursor, {
      ...(query.category ? { category: query.category } : {}),
      unread: query.unread === 'true',
      archived: query.archived === 'true',
    });
  }
  @Get('unread-count')
  count(@Query() query: unknown, @Req() request: Request) {
    requireEmptyObject(query);
    return this.notifications.count(this.session(request));
  }
  @Post('read-all')
  @HttpCode(200)
  readAll(@Body() body: ReadAllDto, @Req() request: Request) {
    return this.notifications.readAll(this.session(request), body.category);
  }
  @Post(':id/read')
  @HttpCode(200)
  read(@Param('id') id: string, @Body() body: unknown, @Req() request: Request) {
    requireEmptyObject(body);
    return this.notifications.read(this.session(request), id);
  }
  @Post(':id/archive')
  @HttpCode(200)
  archive(@Param('id') id: string, @Body() body: unknown, @Req() request: Request) {
    requireEmptyObject(body);
    return this.notifications.archive(this.session(request), id);
  }
  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }
}
