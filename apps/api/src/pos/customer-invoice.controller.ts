import type { CustomerInvoiceDetail, CustomerInvoiceListResponse } from '@lucy-spa/contracts';
import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { CustomerInvoiceService } from './customer-invoice.service.js';

class ListQueryDto {
  @IsOptional() @IsString() @MaxLength(64) cursor?: string;
}

/**
 * The signed-in customer's own invoices (Phase 4 Step 9). Read only: identity is the session cookie, no customer id
 * is accepted, and a foreign, guest-payer, draft or missing invoice is the same `NOT_FOUND`.
 */
@Controller('api/v1/me/invoices')
export class CustomerInvoiceController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(CustomerInvoiceService) private readonly invoices: CustomerInvoiceService,
  ) {}

  @Get()
  @ApiOkResponse({ description: 'The customer’s invoices where they are the payer, newest first.' })
  list(
    @Query() query: ListQueryDto,
    @Req() request: Request,
  ): Promise<CustomerInvoiceListResponse> {
    return this.invoices.list(this.session(request), query.cursor);
  }

  @Get(':id')
  @ApiOkResponse({ description: 'One of the customer’s own invoices.' })
  detail(@Param('id') id: string, @Req() request: Request): Promise<CustomerInvoiceDetail> {
    return this.invoices.detail(this.session(request), id);
  }

  private session(request: Request): string | undefined {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }
}
