import type {
  BookingRecipientRelationName,
  CustomerBookingAvailabilityResponse,
  CustomerBookingBranchesResponse,
  CustomerBookingBranchResponse,
  CustomerBookingCancelRequest,
  CustomerBookingCreateRequest,
  CustomerBookingDetail,
  CustomerBookingEmployeesResponse,
  CustomerBookingLineInput,
  CustomerBookingListResponse,
  CustomerBookingRecipientInput,
} from '@lucy-spa/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { Request } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { BOOKING_LIMITS } from './booking.core.js';
import { CustomerBookingService } from './customer-booking.service.js';

const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const TIME = /^[0-9]{2}:[0-9]{2}$/;
const RELATIONS: BookingRecipientRelationName[] = ['SELF', 'CHILD', 'FAMILY', 'OTHER'];

class RecipientDto implements CustomerBookingRecipientInput {
  @ApiProperty() @IsString() @MaxLength(32) key!: string;
  @ApiProperty({ enum: RELATIONS }) @IsIn(RELATIONS) relation!: BookingRecipientRelationName;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(400) displayName?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(40) phone?: string;
}

class LineDto implements CustomerBookingLineInput {
  @ApiProperty() @IsString() @MaxLength(64) serviceId!: string;
  @ApiProperty() @IsString() @MaxLength(32) recipientKey!: string;
  @ApiProperty({ nullable: true, description: 'A specific KTV, or null for Any KTV.' })
  @ValidateIf((line: LineDto) => line.employeeUserId !== null)
  @IsString()
  @MaxLength(64)
  employeeUserId!: string | null;
}

/** No owner, status, price or code is accepted: the session is the owner (contract section 14). */
class CreateBookingDto implements CustomerBookingCreateRequest {
  @ApiProperty() @IsString() @MaxLength(64) idempotencyKey!: string;
  @ApiProperty() @IsString() @MaxLength(64) branchId!: string;
  @ApiProperty() @IsString() @Matches(DATE) date!: string;
  @ApiProperty() @IsString() @Matches(TIME) startTime!: string;
  @ApiProperty({ type: [RecipientDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BOOKING_LIMITS.maxRecipients)
  @ValidateNested({ each: true })
  @Type(() => RecipientDto)
  recipients!: RecipientDto[];
  @ApiProperty({ type: [LineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BOOKING_LIMITS.maxLines)
  @ValidateNested({ each: true })
  @Type(() => LineDto)
  lines!: LineDto[];
}

class CancelBookingDto implements CustomerBookingCancelRequest {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2_048) reason?: string;
}

class EmployeesQueryDto {
  @IsString() @MaxLength(400) serviceIds!: string;
}

class AvailabilityQueryDto {
  @IsString() @MaxLength(64) branchId!: string;
  @IsString() @Matches(DATE) date!: string;
  @IsString() @MaxLength(400) serviceIds!: string;
  @IsString() @MaxLength(400) employees!: string;
}

/**
 * Member booking for the signed-in customer (Phase 3 Step 4). Identity is the session cookie
 * only; the global guard enforces JSON, exact Origin and the session-bound CSRF token on every
 * POST. Business rules live in `CustomerBookingService` and the availability engine.
 */
@Controller('api/v1/me')
export class CustomerBookingController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(CustomerBookingService) private readonly booking: CustomerBookingService,
  ) {}

  @Get('booking/branches')
  @ApiOkResponse({ description: 'Active branches for online booking.' })
  branches(@Req() request: Request): Promise<CustomerBookingBranchesResponse> {
    return this.booking.branches(this.session(request));
  }

  @Get('booking/branches/:branchId')
  @ApiOkResponse({ description: 'Services offered at the branch and the bookable dates.' })
  branch(
    @Param('branchId') branchId: string,
    @Req() request: Request,
  ): Promise<CustomerBookingBranchResponse> {
    return this.booking.branch(this.session(request), branchId);
  }

  @Get('booking/branches/:branchId/employees')
  @ApiOkResponse({ description: 'Qualified KTVs per service (display names only).' })
  employees(
    @Param('branchId') branchId: string,
    @Query() query: EmployeesQueryDto,
    @Req() request: Request,
  ): Promise<CustomerBookingEmployeesResponse> {
    return this.booking.employees(this.session(request), branchId, query.serviceIds);
  }

  @Get('booking/availability')
  @ApiOkResponse({ description: 'Feasible start times for the ordered services (advisory).' })
  availability(
    @Query() query: AvailabilityQueryDto,
    @Req() request: Request,
  ): Promise<CustomerBookingAvailabilityResponse> {
    return this.booking.availability(this.session(request), query);
  }

  @Get('bookings')
  @ApiOkResponse({ description: 'The customer’s upcoming bookings and history.' })
  list(@Req() request: Request): Promise<CustomerBookingListResponse> {
    return this.booking.list(this.session(request));
  }

  @Post('bookings')
  @HttpCode(201)
  @ApiCreatedResponse({ description: 'A CONFIRMED booking (or the same booking on a replay).' })
  create(@Body() body: CreateBookingDto, @Req() request: Request): Promise<CustomerBookingDetail> {
    return this.booking.create(this.session(request), body);
  }

  @Get('bookings/:id')
  @ApiOkResponse({ description: 'One of the customer’s own bookings.' })
  detail(@Param('id') id: string, @Req() request: Request): Promise<CustomerBookingDetail> {
    return this.booking.detail(this.session(request), id);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Cancelled (idempotent); late flag set by the server.' })
  cancel(
    @Param('id') id: string,
    @Body() body: CancelBookingDto,
    @Req() request: Request,
  ): Promise<CustomerBookingDetail> {
    return this.booking.cancel(this.session(request), id, body);
  }

  private session(request: Request): string | undefined {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }
}
