import {
  CASH_MANUAL_KINDS,
  type CashEntryListResponse,
  type CashEntryResponse,
  type CashGoLiveRequest,
  type CashManualEntryRequest,
  type CashOverviewResponse,
  type CashReverseRequest,
  type CashTransferRequest,
  type CashTransferResponse,
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
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
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

class ManualDto implements CashManualEntryRequest {
  @ApiProperty() @IsString() @MaxLength(64) fundId!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(64) branchId?: string;
  @ApiProperty({ enum: CASH_MANUAL_KINDS })
  @IsIn(CASH_MANUAL_KINDS)
  kind!: CashManualEntryRequest['kind'];
  @ApiProperty() @IsString() @MaxLength(20) amountVnd!: string;
  @ApiProperty() @IsString() @MaxLength(2000) reason!: string;
  @ApiProperty() @IsString() @MaxLength(64) clientRequestId!: string;
}

class ReverseDto implements CashReverseRequest {
  @ApiProperty() @IsString() @MaxLength(2000) reason!: string;
  @ApiProperty() @IsString() @MaxLength(64) clientRequestId!: string;
}

class TransferDto implements CashTransferRequest {
  @ApiProperty() @IsString() @MaxLength(64) fromFundId!: string;
  @ApiProperty() @IsString() @MaxLength(64) toFundId!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(64) branchId?: string;
  @ApiProperty() @IsString() @MaxLength(20) amountVnd!: string;
  @ApiProperty() @IsString() @MaxLength(2000) reason!: string;
  @ApiProperty() @IsString() @MaxLength(64) clientRequestId!: string;
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

  @Get('funds/:id/entries')
  @ApiOkResponse({
    description:
      'The book of one fund, 20 entries a page, newest day first, with the totals of the filter (VIEW_CASH or MANAGE_CASH at the fund branch).',
  })
  entries(
    @Param('id') id: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('category') category: string | undefined,
    @Query('direction') direction: string | undefined,
    @Query('page') page: string | undefined,
    @Req() request: Request,
  ): Promise<CashEntryListResponse> {
    return this.cash.entries(this.session(request), id, { from, to, category, direction, page });
  }

  @Post('entries')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Records money in, money out, a staff cash deposit or an Owner withdrawal (amount and reason required; a withdrawal needs a fresh password).',
  })
  record(
    @Body() body: ManualDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CashEntryResponse> {
    return this.cash.record(this.session(request), body, this.requestId(response));
  }

  @Post('entries/:id/reverse')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Reverses a manual entry by a correction entry (MANAGE_CASH, reason).',
  })
  reverse(
    @Param('id') id: string,
    @Body() body: ReverseDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CashEntryResponse> {
    return this.cash.reverse(this.session(request), id, body, this.requestId(response));
  }

  @Post('transfers')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Moves money between two funds as two linked entries (MANAGE_CASH on both, fresh password).',
  })
  transfer(
    @Body() body: TransferDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CashTransferResponse> {
    return this.cash.transfer(this.session(request), body, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
