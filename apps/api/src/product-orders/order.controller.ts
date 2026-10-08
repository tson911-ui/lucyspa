import type {
  ProductOrderAllocateResponse,
  ProductOrderContextResponse,
  ProductOrderDetailResponse,
  ProductOrderMarkOrderedResponse,
  ProductOrderQueueResponse,
  ProductOrderResponse,
  ProductOrderTicketLinkResponse,
  ProductOrderTicketPublicResponse,
  ProductOrderToOrderResponse,
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
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { PublicRateLimitGuard } from '../platform/public-rate-limit.guard.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { ProductOrderService, PublicProductOrderService } from './order.service.js';

const CAUSES = [
  'SUPPLIER_CANNOT_DELIVER',
  'CUSTOMER_CANCELLED_BEFORE_ORDERING',
  'CUSTOMER_CHANGED_MIND',
  'LATE_OVER_7_DAYS',
];
const METHODS = ['CASH', 'BANK_TRANSFER_MANUAL'];

/*
 * Only the contract's fields are accepted (the global pipe forbids unknown ones). The decorators keep the wrong types out; the exact
 * rules (versions, the proof of a hand-over, the reference of a transfer, authority, the password) are applied again in the core.
 */
class OrderedLineDto {
  @ApiProperty() @IsString() @MaxLength(64) id!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) rowVersion!: number;
}
class MarkOrderedDto {
  @ApiProperty({ type: [OrderedLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OrderedLineDto)
  lines!: OrderedLineDto[];
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(600)
  note?: string | null;
}
class HandOverDto {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
  @ApiProperty({ enum: ['CUSTOMER', 'REPRESENTATIVE'] })
  @IsIn(['CUSTOMER', 'REPRESENTATIVE'])
  to!: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  representativeName?: string | null;
  @ApiProperty() @IsString() @MaxLength(64) orderCode!: string;
  @ApiProperty() @IsString() @MaxLength(16) phoneLast4!: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(600)
  note?: string | null;
}
class CancelLineDto {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
  @ApiProperty({ enum: CAUSES }) @IsIn(CAUSES) cause!: string;
  @ApiProperty() @IsString() @MaxLength(4000) note!: string;
  @ApiProperty({ enum: METHODS }) @IsIn(METHODS) method!: string;
  @ApiProperty({ nullable: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(200)
  bankReference!: string | null;
  @ApiProperty() @IsString() @MaxLength(64) clientRequestId!: string;
  @ApiProperty({
    required: false,
    description: 'Integer VND; only for the cause CUSTOMER_CHANGED_MIND.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  amountVnd?: string;
}
class DeclineCancelDto {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
  @ApiProperty() @IsString() @MaxLength(4000) note!: string;
}
class CorrectReferenceDto {
  @ApiProperty() @IsString() @MaxLength(200) bankReference!: string;
  @ApiProperty() @IsString() @MaxLength(4000) reason!: string;
}
class AllocateDto {
  @ApiProperty() @IsString() @MaxLength(64) branchId!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(64) variantId?: string;
}
class QueueQueryDto {
  @IsString() @MaxLength(64) branchId!: string;
  @IsOptional() @IsString() @MaxLength(32) tab?: string;
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000) page?: number;
}
class ToOrderQueryDto {
  @IsString() @MaxLength(64) branchId!: string;
}

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

  @Get()
  @ApiOkResponse({
    description: 'The order lines of a branch by tab, 20 a page (MANAGE_PRODUCT_ORDERS).',
  })
  list(@Query() query: QueueQueryDto, @Req() request: Request): Promise<ProductOrderQueueResponse> {
    return this.orders.list(this.session(request), query);
  }

  @Get('context')
  @ApiOkResponse({ description: 'The branches where the caller works the orders or refunds them.' })
  context(@Req() request: Request): Promise<ProductOrderContextResponse> {
    return this.orders.context(this.session(request));
  }

  @Get('to-order')
  @ApiOkResponse({
    description: 'The paid lines still to be ordered, grouped by supplier (MANAGE_PRODUCT_ORDERS).',
  })
  toOrder(
    @Query() query: ToOrderQueryDto,
    @Req() request: Request,
  ): Promise<ProductOrderToOrderResponse> {
    return this.orders.toOrder(this.session(request), query.branchId);
  }

  @Post('mark-ordered')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'The shop ordered these paid lines from the supplier (MANAGE_PRODUCT_ORDERS).',
  })
  markOrdered(
    @Body() body: MarkOrderedDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductOrderMarkOrderedResponse> {
    return this.orders.markOrdered(this.session(request), body as never, this.requestId(response));
  }

  @Post('allocate')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Give free stock to the waiting lines now (MANAGE_PRODUCT_ORDERS).',
  })
  allocate(
    @Body() body: AllocateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductOrderAllocateResponse> {
    return this.orders.allocate(this.session(request), body as never, this.requestId(response));
  }

  @Post('lines/:lineId/hand-over')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Hand the goods of an arrived line over after the order code and the last four phone digits were said (MANAGE_PRODUCT_ORDERS).',
  })
  handOver(
    @Param('lineId') lineId: string,
    @Body() body: HandOverDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductOrderDetailResponse> {
    return this.orders.handOver(
      this.session(request),
      lineId,
      body as never,
      this.requestId(response),
    );
  }

  @Post('lines/:lineId/cancel')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Cancel a paid line with a cause and refund it by cash or manual transfer: in full, or for a change of mind a part of it (REFUND_PRODUCTS, a fresh password when money is given back).',
  })
  cancelLine(
    @Param('lineId') lineId: string,
    @Body() body: CancelLineDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductOrderDetailResponse> {
    return this.orders.cancelLine(
      this.session(request),
      lineId,
      body as never,
      this.requestId(response),
    );
  }

  @Post('lines/:lineId/decline')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Decline the customer request to cancel after the supplier order: nothing moves, the decision and its reason are audited (REFUND_PRODUCTS).',
  })
  declineCancel(
    @Param('lineId') lineId: string,
    @Body() body: DeclineCancelDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductOrderDetailResponse> {
    return this.orders.declineCancel(
      this.session(request),
      lineId,
      body as never,
      this.requestId(response),
    );
  }

  @Post('lines/:lineId/reference-correction')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Correct a mistyped bank reference of a cancellation refund by a new linked record (REFUND_PRODUCTS).',
  })
  correctReference(
    @Param('lineId') lineId: string,
    @Body() body: CorrectReferenceDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductOrderDetailResponse> {
    return this.orders.correctReference(
      this.session(request),
      lineId,
      body as never,
      this.requestId(response),
    );
  }

  @Get(':id')
  @ApiOkResponse({
    description:
      'One order with its lines and what each can do now (SELL_PRODUCTS, MANAGE_PRODUCT_ORDERS or REFUND_PRODUCTS).',
  })
  get(@Param('id') id: string, @Req() request: Request): Promise<ProductOrderDetailResponse> {
    return this.orders.get(this.session(request), id);
  }

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
