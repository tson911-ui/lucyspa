import type {
  ProductOrderResponse,
  ProductOrderTicketLinkResponse,
  ProductOrderTicketPublicResponse,
} from '@lucy-spa/contracts';
import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { PublicRateLimitGuard } from '../platform/public-rate-limit.guard.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { ProductOrderService, PublicProductOrderService } from './order.service.js';

/**
 * Phase 6 P6-16/P6-17: the counter pre-orders. The global guard enforces JSON, exact Origin and CSRF; authority (a permission at the
 * order's branch) is decided in the service's transaction.
 */
@Controller('api/v1/product-orders')
export class ProductOrderController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(ProductOrderService) private readonly orders: ProductOrderService,
  ) {}

  @Post(':id/ticket-link')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Make a new secret ticket link for a customer without an account (SELL_PRODUCTS or MANAGE_PRODUCT_ORDERS). The token is shown once; the old link stops working.',
  })
  createTicketLink(
    @Param('id') id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductOrderTicketLinkResponse> {
    response.setHeader('cache-control', 'no-store');
    return this.orders.createTicketLink(this.session(request), id, this.requestId(response));
  }

  @Post(':id/ticket-link/revoke')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Revoke the active ticket link of the order, if any.' })
  revokeTicketLink(
    @Param('id') id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductOrderResponse> {
    return this.orders.revokeTicketLink(this.session(request), id, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}

/**
 * The anonymous ticket (OQ-P6-42): read-only, per-address rate limited like every public read, never cached, and a wrong or revoked
 * token is the same 404 as an unknown one.
 */
@UseGuards(PublicRateLimitGuard)
@Controller('api/v1/public')
export class PublicProductOrderController {
  constructor(
    @Inject(PublicProductOrderService) private readonly tickets: PublicProductOrderService,
  ) {}

  @Get('product-order-tickets/:token')
  @ApiOkResponse({
    description: 'The read-only ticket of a pre-order for the holder of its secret link.',
  })
  async ticket(
    @Param('token') token: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductOrderTicketPublicResponse> {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('x-robots-tag', 'noindex');
    return this.tickets.ticket(token);
  }
}
