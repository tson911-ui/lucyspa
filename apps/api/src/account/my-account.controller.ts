import type { MyAccountResponse } from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { EmployeeProfileDto } from '../employees/employee.controller.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { MyAccountService } from './my-account.service.js';

/** The same allowlisted, strict profile DTO as the management command (no ID field). */
class MyAccountProfileDto extends EmployeeProfileDto {}

/**
 * "Tài khoản của tôi / My Account". The session cookie is the only identity: there is no
 * employee ID in the path or body. The global guard enforces JSON, exact Origin and the
 * session-bound CSRF token on the write; unknown body fields are rejected by the DTO.
 */
@Controller('api/v1/me/account')
export class MyAccountController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(MyAccountService) private readonly account: MyAccountService,
  ) {}

  @Get()
  @ApiOkResponse({ description: 'The signed-in workforce account (Owner or employee).' })
  get(@Req() request: Request): Promise<MyAccountResponse> {
    return this.account.get(
      sessionCookie(request.headers.cookie, this.environment.auth.cookieName),
    );
  }

  @Post('profile')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Own name, phone, date of birth, address or language.' })
  updateProfile(
    @Body() body: MyAccountProfileDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MyAccountResponse> {
    const requestId = response.getHeader('x-request-id');
    return this.account.updateProfile(
      sessionCookie(request.headers.cookie, this.environment.auth.cookieName),
      body,
      typeof requestId === 'string' ? requestId : undefined,
    );
  }
}
