import type {
  CustomerReviewPrompt,
  CustomerReviewRequest,
  CustomerReviewView,
} from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { Request } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { CustomerReviewService } from './customer-reviews.service.js';

class StaffRatingDto {
  @IsString() @MaxLength(36) employeeUserId!: string;
  @IsInt() @Min(1) @Max(5) rating!: number;
}

class ReviewDto implements CustomerReviewRequest {
  @IsString() @MaxLength(36) invoiceId!: string;
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() @MaxLength(1000) comment!: string | null;
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => StaffRatingDto)
  staff!: StaffRatingDto[];
}

/**
 * The signed-in customer's review of a paid invoice (Phase 8 P8-16). Identity is the session cookie; no customer id is accepted. Private: used
 * inside the spa only. A review is written once and never changed.
 */
@Controller('api/v1/me/reviews')
export class CustomerReviewController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(CustomerReviewService) private readonly reviews: CustomerReviewService,
  ) {}

  @Get('invoices/:invoiceId')
  @ApiOkResponse({
    description:
      'Whether the paid invoice can be reviewed, the review already given, and the people who served.',
  })
  prompt(
    @Param('invoiceId') invoiceId: string,
    @Req() request: Request,
  ): Promise<CustomerReviewPrompt> {
    return this.reviews.prompt(this.session(request), invoiceId);
  }

  @Post()
  @HttpCode(201)
  @ApiOkResponse({ description: 'Gives the review of a paid invoice (once).' })
  submit(@Body() body: ReviewDto, @Req() request: Request): Promise<CustomerReviewView> {
    return this.reviews.submit(this.session(request), {
      invoiceId: body.invoiceId,
      rating: body.rating,
      comment: body.comment ?? null,
      staff: body.staff.map((entry) => ({
        employeeUserId: entry.employeeUserId,
        rating: entry.rating,
      })),
    });
  }

  private session(request: Request): string | undefined {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }
}
