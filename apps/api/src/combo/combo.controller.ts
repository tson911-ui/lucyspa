import type {
  ComboCreateRequest,
  ComboFrozenListResponse,
  ComboListResponse,
  ComboRestoreRequest,
  ComboResponse,
  ComboUsageItemResponse,
  ComboUsagePageResponse,
  ComboVersionRequest,
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
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { ComboService } from './combo.service.js';

/** Only the contract's fields (the core validates every value again): no code, expiry, creator, time or version can be supplied. */
class ComboCreateDto implements ComboCreateRequest {
  @ApiProperty() @IsString() @MaxLength(64) serviceId!: string;
  @ApiProperty() @IsString() @MaxLength(200) nameVi!: string;
  @ApiProperty() @IsString() @MaxLength(200) nameEn!: string;
  @ApiProperty() @IsInt() paidSessions!: number;
  @ApiProperty() @IsInt() bonusSessions!: number;
  @ApiProperty() @IsString() @MaxLength(24) priceVnd!: string;
  @ApiProperty() @IsBoolean() active!: boolean;
}

class ComboVersionDto implements ComboVersionRequest {
  @ApiProperty() @IsInt() expectedVersionNo!: number;
  @ApiProperty() @IsString() @MaxLength(200) nameVi!: string;
  @ApiProperty() @IsString() @MaxLength(200) nameEn!: string;
  @ApiProperty() @IsInt() paidSessions!: number;
  @ApiProperty() @IsInt() bonusSessions!: number;
  @ApiProperty() @IsString() @MaxLength(24) priceVnd!: string;
  @ApiProperty() @IsBoolean() active!: boolean;
}

class UsageQueryDto {
  @IsOptional() @IsString() @MaxLength(8) page?: string;
}

/** The reason only: the use, the actor, the time and the branch are never supplied. */
class RestoreDto implements ComboRestoreRequest {
  @ApiProperty() @IsString() @MaxLength(2_048) reason!: string;
}

/**
 * Phase 5 P5-7: combo definitions (admin). `MANAGE_COMBOS` is GLOBAL_ONLY and decided inside each command; the global guard
 * enforces JSON, exact Origin and CSRF.
 */
@Controller('api/v1/combos')
export class ComboController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(ComboService) private readonly combos: ComboService,
  ) {}

  @Get()
  @ApiOkResponse({ description: 'Every combo with its versions (MANAGE_COMBOS).' })
  list(@Req() request: Request): Promise<ComboListResponse> {
    return this.combos.list(this.session(request));
  }

  @Get('usage')
  @ApiOkResponse({
    description: 'The combo usage history, newest first (RESTORE_COMBO_SESSIONS or MANAGE_COMBOS).',
  })
  usage(@Query() query: UsageQueryDto, @Req() request: Request): Promise<ComboUsagePageResponse> {
    return this.combos.usage(this.session(request), query);
  }

  @Get('frozen')
  @ApiOkResponse({
    description: 'Combos frozen by the reversal of their sale (VIEW_LOYALTY_EXCEPTIONS).',
  })
  frozen(@Req() request: Request): Promise<ComboFrozenListResponse> {
    return this.combos.frozen(this.session(request));
  }

  @Post('usage/:consumptionId/restore')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Restores a mistaken use as an offset entry with a reason (RESTORE_COMBO_SESSIONS, fresh re-authentication).',
  })
  restore(
    @Param('consumptionId') consumptionId: string,
    @Body() body: RestoreDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ComboUsageItemResponse> {
    return this.combos.restore(
      this.session(request),
      consumptionId,
      body,
      this.requestId(response),
    );
  }

  @Post()
  @HttpCode(200)
  @ApiOkResponse({ description: 'Creates a combo with its first version (MANAGE_COMBOS).' })
  create(
    @Body() body: ComboCreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ComboResponse> {
    return this.combos.create(this.session(request), body, this.requestId(response));
  }

  @Post(':id/versions')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Appends the next version of a combo (MANAGE_COMBOS).' })
  addVersion(
    @Param('id') id: string,
    @Body() body: ComboVersionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ComboResponse> {
    return this.combos.addVersion(this.session(request), id, body, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
