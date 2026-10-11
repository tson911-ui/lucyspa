import type { CashGoLiveRequest, CashOverviewResponse } from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsString, MaxLength, ValidateNested } from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { CashService } from './cash.service.js';

/*
 * Only the contract's fields are accepted (the global pipe forbids unknown ones). The exact rules (amounts, the set of branches,
 * authority, the password confirmation) are applied again, strictly, in the core.
 */
class GoLiveBranchDto {
  @ApiProperty() @IsString() @MaxLength(64) branchId!: string;
  @ApiProperty() @IsString() @MaxLength(20) countedVnd!: string;
}

class GoLiveDto implements CashGoLiveRequest {
  @ApiProperty({ type: GoLiveBranchDto, isArray: true })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => GoLiveBranchDto)
  branches!: GoLiveBranchDto[];
  @ApiProperty() @IsString() @MaxLength(20) bankVnd!: string;
}

/**
 * Phase 7 Wave A: the cash book. The global guard enforces JSON, exact Origin and CSRF; authority (VIEW_CASH / MANAGE_CASH at the
 * branch) and the fresh password confirmation are decided in the service's transaction.
 */
@Controller('api/v1/cash')
export class CashController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(CashService) private readonly cash: CashService,
  ) {}

  @Get('overview')
  @ApiOkResponse({
    description:
      'The funds the person may see with their balances, the go-live state and the branches they may view or manage (VIEW_CASH or MANAGE_CASH).',
  })
  overview(@Req() request: Request): Promise<CashOverviewResponse> {
    return this.cash.overview(this.session(request));
  }

  @Post('go-live')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Starts the cash book and payroll once: the counted opening balance of every active branch and of the bank, a fresh password, MANAGE_CASH everywhere.',
  })
  goLive(
    @Body() body: GoLiveDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CashOverviewResponse> {
    return this.cash.goLive(this.session(request), body, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
