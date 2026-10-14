import type { CustomerProfileResponse, CustomerProfileUpdateRequest } from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { CustomerProfileService } from './customer-profile.service.js';

/** The name and the version it was read at; any other field (phone, birthday, email) is rejected by the global whitelist. */
class CustomerProfileDto implements CustomerProfileUpdateRequest {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
  @ApiProperty() @IsString() @MaxLength(1_000) fullName!: string;
}

/**
 * "Hồ sơ" of the signed-in customer. The session cookie is the only identity: no customer id is in the path or body. The global
 * guard enforces JSON, exact Origin and the session-bound CSRF token on the write.
 */
@Controller('api/v1/me/profile')
export class CustomerProfileController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(CustomerProfileService) private readonly profile: CustomerProfileService,
  ) {}

  @Get()
  @ApiOkResponse({ description: 'The signed-in customer: name, email, phone, birthday, language.' })
  get(@Req() request: Request): Promise<CustomerProfileResponse> {
    return this.profile.get(this.session(request));
  }

  @Post()
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Change the name. Email, phone and birthday are not changed here.',
  })
  update(
    @Body() body: CustomerProfileDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CustomerProfileResponse> {
    const requestId = response.getHeader('x-request-id');
    return this.profile.update(
      this.session(request),
      body,
      typeof requestId === 'string' ? requestId : undefined,
    );
  }

  private session(request: Request): string | undefined {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }
}
