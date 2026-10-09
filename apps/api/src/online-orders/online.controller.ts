import type {
  CustomerAddressListResponse,
  OnlineAddressCorrectRequest,
  OnlineContextResponse,
  OnlineDeliveredRequest,
  OnlineLogRequest,
  OnlineQueueResponse,
  OnlineReturnCostRequest,
  OnlineReturnedRequest,
  OnlineShipmentCorrectRequest,
  OnlineShipRequest,
  OnlineStaffOrderResponse,
  ShippingCarrierCreateRequest,
  ShippingCarrierEditRequest,
  ShippingCarrierListResponse,
  OnlineCartResponse,
  OnlineCheckoutRequest,
  OnlineOrderListResponse,
  OnlineOrderResponse,
  OnlinePaymentResponse,
  OnlineSalesPublicResponse,
  OnlineSalesSettingsResponse,
  OnlineSalesSettingsUpdateRequest,
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
  IsBoolean,
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
import { requireEmptyObject } from '../auth/session-auth.controller.js';
import { PublicRateLimitGuard } from '../platform/public-rate-limit.guard.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import type { QuoteResponse } from './online.checkout.js';
import { OnlineOrderService } from './online.service.js';

class CartAddDto {
  @ApiProperty() @IsString() @MaxLength(64) variantId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(1000) quantity!: number;
}
class CartSetDto {
  @ApiProperty() @IsString() @MaxLength(64) variantId!: string;
  @ApiProperty() @IsInt() @Min(0) @Max(1000) quantity!: number;
}
class QuoteDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  voucherCode?: string | null;
}
class AddressDto {
  @ApiProperty() @IsString() @MaxLength(400) recipientName!: string;
  @ApiProperty() @IsString() @MaxLength(80) recipientPhone!: string;
  @ApiProperty() @IsString() @MaxLength(80) provinceCode!: string;
  @ApiProperty() @IsString() @MaxLength(400) ward!: string;
  @ApiProperty() @IsString() @MaxLength(600) street!: string;
}
class CheckoutDto {
  @ApiProperty({ type: AddressDto })
  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() saveAddress?: boolean;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  voucherCode?: string | null;
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) acceptedPolicyVersion!: number;
  @ApiProperty() @IsString() @MaxLength(64) clientRequestId!: string;
}
class PayDto {
  @ApiProperty({ enum: ['vi', 'en'] }) @IsIn(['vi', 'en']) locale!: 'vi' | 'en';
}
class ListQueryDto {
  @IsOptional() @IsString() @MaxLength(64) cursor?: string;
}
class SettingsDto {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(64)
  fulfilmentBranchId?: string | null;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(120)
  unpaidTimeoutMinutes?: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxUnpaidOrders?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(1) @Max(100) maxCartLines?: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxLineQuantity?: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  shipWithinWorkingDays?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) @Max(60) transitDaysMin?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) @Max(60) transitDaysMax?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() shippingFeeEnabled?: boolean;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  shippingFeeVnd?: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(20)
  freeShippingThresholdVnd?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(20_000)
  policyVi?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(20_000)
  policyEn?: string | null;
}

class LineVersionDto {
  @ApiProperty() @IsString() @MaxLength(64) id!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) rowVersion!: number;
}
class ShipDto {
  @ApiProperty({ type: [LineVersionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LineVersionDto)
  lines!: LineVersionDto[];
  @ApiProperty() @IsString() @MaxLength(64) carrierId!: string;
  @ApiProperty() @IsString() @MaxLength(200) trackingCode!: string;
  @ApiProperty() @IsString() @MaxLength(20) carrierFeeVnd!: string;
}
class ShipmentCorrectDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(200) trackingCode?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(20) carrierFeeVnd?: string;
  @ApiProperty() @IsString() @MaxLength(4000) reason!: string;
}
class DeliveredDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(10)
  deliveredOn?: string | null;
}
class LogDto {
  @ApiProperty() @IsString() @MaxLength(32) kind!: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(32)
  reasonCode?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(4000)
  note?: string | null;
}
class CancelLineDto {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
  @ApiProperty() @IsString() @MaxLength(64) cause!: string;
  @ApiProperty() @IsString() @MaxLength(4000) note!: string;
  @ApiProperty() @IsString() @MaxLength(32) method!: string;
  @ApiProperty({ nullable: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(200)
  bankReference!: string | null;
  @ApiProperty() @IsString() @MaxLength(64) clientRequestId!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(20) amountVnd?: string;
}
class SettleDto {
  @ApiProperty({ type: [LineVersionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LineVersionDto)
  lines!: LineVersionDto[];
  @ApiProperty() @IsString() @MaxLength(20) carrierFeeBackVnd!: string;
  @ApiProperty() @IsString() @MaxLength(4000) reason!: string;
  @ApiProperty() @IsString() @MaxLength(32) restock!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(32) method?: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(200)
  bankReference?: string | null;
  @ApiProperty() @IsString() @MaxLength(64) clientRequestId!: string;
}
class ReturnCostDto {
  @ApiProperty() @IsString() @MaxLength(20) costVnd!: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(4000)
  note?: string | null;
}
class ReturnedDto {
  @ApiProperty() @IsString() @MaxLength(4000) note!: string;
}
class AddressCorrectDto {
  @ApiProperty() @IsString() @MaxLength(400) recipientName!: string;
  @ApiProperty() @IsString() @MaxLength(80) recipientPhone!: string;
  @ApiProperty() @IsString() @MaxLength(80) provinceCode!: string;
  @ApiProperty() @IsString() @MaxLength(400) ward!: string;
  @ApiProperty() @IsString() @MaxLength(600) street!: string;
  @ApiProperty() @IsString() @MaxLength(4000) reason!: string;
}
class CarrierCreateDto {
  @ApiProperty() @IsString() @MaxLength(400) name!: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(600)
  trackingUrlTemplate?: string | null;
}
class CarrierEditDto {
  @ApiProperty() @IsInt() @Min(1) @Max(2_147_483_647) expectedRowVersion!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(400) name?: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(600)
  trackingUrlTemplate?: string | null;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() isActive?: boolean;
}
class QueueQueryDto {
  @IsString() @MaxLength(64) branchId!: string;
  @IsOptional() @IsString() @MaxLength(32) tab?: string;
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @IsString() @MaxLength(8) page?: string;
}

/**
 * Phase 6 Wave 4 (P6-19): online ordering. The member's routes take the session cookie as the only identity (no customer id is ever
 * accepted); the settings routes are for `MANAGE_PRODUCTS`. The public route carries no secret.
 */
@Controller('api/v1')
export class OnlineOrderController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(OnlineOrderService) private readonly online: OnlineOrderService,
  ) {}

  @Get('online-sales')
  @UseGuards(PublicRateLimitGuard)
  @ApiOkResponse({
    description: 'Whether online ordering is open, its limits, promises and policy text.',
  })
  publicSettings(): Promise<OnlineSalesPublicResponse> {
    return this.online.publicSettings();
  }

  @Get('me/cart')
  @ApiOkResponse({
    description: 'The member cart, priced today, with how each line would be served.',
  })
  cart(@Req() request: Request): Promise<OnlineCartResponse> {
    return this.online.cart(this.session(request));
  }

  @Post('me/cart/add')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Adds units of a variant to the cart.' })
  add(@Body() body: CartAddDto, @Req() request: Request): Promise<OnlineCartResponse> {
    return this.online.addToCart(this.session(request), body);
  }

  @Post('me/cart/set')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Sets the quantity of a cart line (0 removes it).' })
  set(@Body() body: CartSetDto, @Req() request: Request): Promise<OnlineCartResponse> {
    return this.online.setCartLine(this.session(request), body);
  }

  @Post('me/checkout/quote')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'The price of the cart as the checkout would place it; nothing is saved.',
  })
  quote(@Body() body: QuoteDto, @Req() request: Request): Promise<QuoteResponse> {
    return this.online.quote(this.session(request), body);
  }

  @Post('me/online-orders')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Places the order from the cart; the payment link is a separate call.',
  })
  place(
    @Body() body: CheckoutDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OnlineOrderResponse> {
    return this.online.place(
      this.session(request),
      body as unknown as OnlineCheckoutRequest,
      this.requestId(response),
    );
  }

  @Get('me/online-orders')
  @ApiOkResponse({ description: 'The member online orders, newest first, 20 a page.' })
  list(@Query() query: ListQueryDto, @Req() request: Request): Promise<OnlineOrderListResponse> {
    return this.online.list(this.session(request), query.cursor);
  }

  @Get('me/online-orders/:id')
  @ApiOkResponse({ description: 'One of the member own online orders.' })
  order(@Param('id') id: string, @Req() request: Request): Promise<OnlineOrderResponse> {
    return this.online.order(this.session(request), id);
  }

  @Post('me/online-orders/:id/pay')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'A PayOS request for the unpaid order, valid until the order deadline.',
  })
  pay(
    @Param('id') id: string,
    @Body() body: PayDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OnlinePaymentResponse> {
    return this.online.pay(this.session(request), id, body.locale, this.requestId(response));
  }

  @Post('me/online-orders/:id/refresh')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Reads the pending PayOS request now and answers with the order.' })
  refresh(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<OnlineOrderResponse> {
    requireEmptyObject(body);
    return this.online.refresh(this.session(request), id);
  }

  @Post('me/online-orders/:id/cancel')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Cancels an unpaid order.' })
  cancel(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<OnlineOrderResponse> {
    requireEmptyObject(body);
    return this.online.cancel(this.session(request), id);
  }

  @Post('me/online-orders/:id/received')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'The member says the parcel arrived; the return window counts from now.',
  })
  received(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<OnlineOrderResponse> {
    requireEmptyObject(body);
    return this.online.received(this.session(request), id);
  }

  @Get('me/addresses')
  @ApiOkResponse({
    description: 'The addresses the member kept, and the profile that fills the first one.',
  })
  addresses(@Req() request: Request): Promise<CustomerAddressListResponse> {
    return this.online.addresses(this.session(request));
  }

  @Post('me/addresses/:id/delete')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Forgets a kept address.' })
  removeAddress(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<CustomerAddressListResponse> {
    requireEmptyObject(body);
    return this.online.removeAddress(this.session(request), id);
  }

  // ---------------------------------------------------------------------------------------- admin

  @Get('online-sales-settings')
  @ApiOkResponse({
    description: 'The settings of online sales and the master switch (MANAGE_PRODUCTS).',
  })
  settings(@Req() request: Request): Promise<OnlineSalesSettingsResponse> {
    return this.online.settings(this.session(request));
  }

  @Post('online-sales-settings/edit')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Changes the settings of online sales (MANAGE_PRODUCTS).' })
  editSettings(
    @Body() body: SettingsDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OnlineSalesSettingsResponse> {
    return this.online.editSettings(
      this.session(request),
      body as unknown as OnlineSalesSettingsUpdateRequest,
      this.requestId(response),
    );
  }

  // ---------------------------------------------------------------- staff: the orders to pack and ship

  @Get('online-orders/context')
  @ApiOkResponse({ description: 'The branches the person may work or refund online orders in.' })
  fulfilmentContext(@Req() request: Request): Promise<OnlineContextResponse> {
    return this.online.fulfilmentContext(this.session(request));
  }

  @Get('online-orders')
  @ApiOkResponse({
    description:
      'The online orders of a branch by tab, 20 a page (MANAGE_PRODUCT_ORDERS or REFUND_PRODUCTS).',
  })
  queue(@Query() query: QueueQueryDto, @Req() request: Request): Promise<OnlineQueueResponse> {
    const page =
      query.page === undefined
        ? undefined
        : /^[0-9]{1,5}$/.test(query.page)
          ? Number(query.page)
          : Number.NaN;
    return this.online.queue(this.session(request), {
      branchId: query.branchId,
      ...(query.tab === undefined ? {} : { tab: query.tab }),
      ...(query.q === undefined ? {} : { q: query.q }),
      ...(page === undefined ? {} : { page }),
    });
  }

  @Get('online-orders/:id')
  @ApiOkResponse({ description: 'One online order for the people who pack, ship and refund.' })
  staffOrder(@Param('id') id: string, @Req() request: Request): Promise<OnlineStaffOrderResponse> {
    return this.online.staffOrder(this.session(request), id);
  }

  @Post('online-orders/:id/ship')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Ships the parcel: carrier, tracking code and the cost the shop pays (MANAGE_PRODUCT_ORDERS).',
  })
  ship(
    @Param('id') id: string,
    @Body() body: ShipDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OnlineStaffOrderResponse> {
    return this.online.ship(
      this.session(request),
      id,
      body as unknown as OnlineShipRequest,
      this.requestId(response),
    );
  }

  @Post('online-orders/:id/shipment')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Corrects the tracking code or the carrier cost by a new record with a reason.',
  })
  correctShipment(
    @Param('id') id: string,
    @Body() body: ShipmentCorrectDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OnlineStaffOrderResponse> {
    return this.online.correctShipment(
      this.session(request),
      id,
      body as unknown as OnlineShipmentCorrectRequest,
      this.requestId(response),
    );
  }

  @Post('online-orders/:id/delivered')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Marks the parcel delivered, on the given day (the return window counts from it).',
  })
  delivered(
    @Param('id') id: string,
    @Body() body: DeliveredDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OnlineStaffOrderResponse> {
    return this.online.delivered(
      this.session(request),
      id,
      body as unknown as OnlineDeliveredRequest,
      this.requestId(response),
    );
  }

  @Post('online-orders/:id/log')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'A failed delivery attempt, a contact, a new attempt, or the customer no longer wanting the parcel.',
  })
  log(
    @Param('id') id: string,
    @Body() body: LogDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OnlineStaffOrderResponse> {
    return this.online.log(
      this.session(request),
      id,
      body as unknown as OnlineLogRequest,
      this.requestId(response),
    );
  }

  @Post('online-orders/:id/returned')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'The parcel is back at the shop (after the customer said they no longer want it).',
  })
  returned(
    @Param('id') id: string,
    @Body() body: ReturnedDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OnlineStaffOrderResponse> {
    return this.online.returned(
      this.session(request),
      id,
      body as unknown as OnlineReturnedRequest,
      this.requestId(response),
    );
  }

  @Post('online-orders/:id/address')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Corrects the delivery address by a new record with a reason.' })
  address(
    @Param('id') id: string,
    @Body() body: AddressCorrectDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OnlineStaffOrderResponse> {
    return this.online.address(
      this.session(request),
      id,
      body as unknown as OnlineAddressCorrectRequest,
      this.requestId(response),
    );
  }

  @Post('online-orders/lines/:lineId/cancel')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Cancels a paid line that has not shipped and gives the money back (REFUND_PRODUCTS, a fresh password used once).',
  })
  cancelLine(
    @Param('lineId') lineId: string,
    @Body() body: CancelLineDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OnlineStaffOrderResponse> {
    return this.online.cancelLine(
      this.session(request),
      lineId,
      { ...body },
      this.requestId(response),
    );
  }

  @Post('online-orders/:id/settlement')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Settles a failed delivery once the parcel is back: the goods paid minus the two carrier costs (REFUND_PRODUCTS, a fresh password used once).',
  })
  settle(
    @Param('id') id: string,
    @Body() body: SettleDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OnlineStaffOrderResponse> {
    return this.online.settle(this.session(request), id, { ...body }, this.requestId(response));
  }

  @Post('online-orders/return-cases/:caseId/cost')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Records what the shop paid for goods to come back from a customer (REFUND_PRODUCTS).',
  })
  returnCost(
    @Param('caseId') caseId: string,
    @Body() body: ReturnCostDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OnlineStaffOrderResponse> {
    return this.online.returnCost(
      this.session(request),
      caseId,
      body as unknown as OnlineReturnCostRequest,
      this.requestId(response),
    );
  }

  @Get('shipping-carriers')
  @ApiOkResponse({ description: 'The carriers of the shop (MANAGE_PRODUCTS).' })
  carriers(@Req() request: Request): Promise<ShippingCarrierListResponse> {
    return this.online.carriers(this.session(request));
  }

  @Post('shipping-carriers')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Adds a carrier (MANAGE_PRODUCTS).' })
  createCarrier(
    @Body() body: CarrierCreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ShippingCarrierListResponse> {
    return this.online.createCarrier(
      this.session(request),
      body as unknown as ShippingCarrierCreateRequest,
      this.requestId(response),
    );
  }

  @Post('shipping-carriers/:id/edit')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Changes or switches off a carrier (MANAGE_PRODUCTS).' })
  editCarrier(
    @Param('id') id: string,
    @Body() body: CarrierEditDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ShippingCarrierListResponse> {
    return this.online.editCarrier(
      this.session(request),
      id,
      body as unknown as ShippingCarrierEditRequest,
      this.requestId(response),
    );
  }

  private session(request: Request): string | undefined {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response): string | undefined {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
