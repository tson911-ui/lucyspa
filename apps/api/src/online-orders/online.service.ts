import type {
  CustomerAddressListResponse,
  OnlineAddressCorrectRequest,
  OnlineContextResponse,
  OnlineDeliveredRequest,
  OnlineLogRequest,
  OnlineQueueResponse,
  OnlineReturnedRequest,
  OnlineShipmentCorrectRequest,
  OnlineShipRequest,
  OnlineStaffOrderResponse,
  ShippingCarrierCreateRequest,
  ShippingCarrierEditRequest,
  ShippingCarrierListResponse,
  OnlineCartAddRequest,
  OnlineCartResponse,
  OnlineCartSetRequest,
  OnlineCheckoutRequest,
  OnlineOrderListResponse,
  OnlineOrderResponse,
  OnlinePaymentResponse,
  OnlineSalesPublicResponse,
  OnlineSalesSettingsResponse,
  OnlineSalesSettingsUpdateRequest,
} from '@lucy-spa/contracts';
import { provinceByCode } from '@lucy-spa/contracts';
import {
  applyProviderRead,
  ProviderRejectedError,
  ProviderUnavailableError,
  readProvider,
  type PaymentProvider,
  type ProviderRead,
} from '@lucy-spa/server';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import {
  CommandRollback,
  runCustomerCommand,
  type CustomerContext,
} from '../booking/customer-command.js';
import { API_ENVIRONMENT, PAYMENT_PROVIDER, type ApiEnvironment } from '../platform/tokens.js';
import { addToCart, getCart, setCartLine } from './online.cart.js';
import {
  cancelOwnUnpaidOrder,
  completeOnlinePayment,
  getOrder,
  pendingProviderRequests,
  placeOrder,
  quoteCheckout,
  reserveOnlinePayment,
  type OnlineProviderOutcome,
  type QuoteResponse,
} from './online.checkout.js';
import { createCarrier, editCarrier, listCarriers } from './online.carriers.js';
import {
  addLog,
  confirmReceived,
  correctAddress,
  correctShipment,
  listOnlineQueue,
  markDelivered,
  markReturnedToShop,
  onlineStaffOrder,
  shipOrder,
} from './online.fulfilment.js';
import { listOrders } from './online.orders.js';
import { orderContext } from '../product-orders/order.queue.js';
import { ProductOrderService } from '../product-orders/order.service.js';
import { holdsAt } from '../product-orders/order.access.js';
import { capabilityDigest } from '../auth/crypto.js';
import { loadAuthorityGraph } from '../authorization/authorization.store.js';
import { ownerRecipients } from '../product-returns/refund.notice.js';
import { conflictOnDatabaseGuard, ONLINE_LIMITS } from './online.input.js';
import { recordReturnCost } from './online.returns.js';
import { settleFailedDelivery } from './online.settlement.js';
import type { Prisma } from '@lucy-spa/database';
import {
  editOnlineSettings,
  getOnlineSettings,
  presentPublic,
  readOnlineSettings,
} from './online.settings.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Phase 6 Wave 4 (P6-19): online sales for the signed-in member, and the admin settings of the master switch. The session is the only
 * identity of a customer command: no customer id is accepted. The PayOS calls happen between two short transactions (a provider call
 * never holds a lock); the money is credited only by the settlement core from an authentic provider fact, never by this service.
 */
@Injectable()
export class OnlineOrderService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    > &
      Partial<Pick<SessionService, 'authorizationChanged'>>,
    @Inject(AuthThrottleService)
    private readonly throttle: Pick<AuthThrottleService, 'now' | 'debitWindow'>,
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Optional() @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider | null = null,
    @Optional()
    @Inject(ProductOrderService)
    private readonly counterOrders: ProductOrderService | null = null,
  ) {}

  // ----------------------------------------------------------------------------------- settings

  /** What anyone may read: whether online ordering is open, the limits, the promises and the policy text. */
  async publicSettings(): Promise<OnlineSalesPublicResponse> {
    const row = await this.sessions.withTransaction((tx) => readOnlineSettings(tx));
    const open = this.provider !== null;
    const answer = presentPublic(row);
    return open ? answer : { ...answer, enabled: false };
  }

  settings(token: string | undefined): Promise<OnlineSalesSettingsResponse> {
    return this.admin(token, undefined, (context) =>
      getOnlineSettings(context, this.provider !== null),
    );
  }

  editSettings(
    token: string | undefined,
    body: OnlineSalesSettingsUpdateRequest,
    requestId?: string,
  ): Promise<OnlineSalesSettingsResponse> {
    return this.admin(token, requestId, (context) =>
      editOnlineSettings(context, body, this.provider !== null),
    );
  }

  // --------------------------------------------------------------------------------- the member

  cart(token: string | undefined): Promise<OnlineCartResponse> {
    return this.customer(token, undefined, (context) => getCart(context));
  }

  addToCart(token: string | undefined, body: OnlineCartAddRequest): Promise<OnlineCartResponse> {
    return this.customer(token, undefined, (context) => addToCart(context, body));
  }

  setCartLine(token: string | undefined, body: OnlineCartSetRequest): Promise<OnlineCartResponse> {
    return this.customer(token, undefined, (context) => setCartLine(context, body));
  }

  async quote(
    token: string | undefined,
    body: { voucherCode?: string | null },
  ): Promise<QuoteResponse> {
    try {
      await this.customer(token, undefined, (context) => quoteCheckout(context, body));
    } catch (error) {
      if (error instanceof CommandRollback) return error.value as QuoteResponse;
      throw error;
    }
    throw new AuthError('SERVICE_UNAVAILABLE');
  }

  place(
    token: string | undefined,
    body: OnlineCheckoutRequest,
    requestId?: string,
  ): Promise<OnlineOrderResponse> {
    return this.customer(token, requestId, (context) => placeOrder(context, body));
  }

  list(token: string | undefined, cursor: string | undefined): Promise<OnlineOrderListResponse> {
    return this.customer(token, undefined, (context) => listOrders(context, cursor));
  }

  order(token: string | undefined, orderId: string): Promise<OnlineOrderResponse> {
    const id = this.id(orderId);
    return this.customer(token, undefined, (context) => getOrder(context, id));
  }

  addresses(token: string | undefined): Promise<CustomerAddressListResponse> {
    return this.customer(token, undefined, async ({ tx, customerUserId }) => {
      const [rows, user] = await Promise.all([
        tx.customerAddress.findMany({
          where: { userId: customerUserId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            recipientName: true,
            recipientPhone: true,
            provinceCode: true,
            ward: true,
            street: true,
          },
        }),
        tx.user.findUniqueOrThrow({
          where: { id: customerUserId },
          select: { fullName: true, phoneCanonical: true },
        }),
      ]);
      return {
        addresses: rows.map((row) => ({
          ...row,
          provinceName: provinceByCode(row.provinceCode)?.nameVi ?? row.provinceCode,
        })),
        profile: { fullName: user.fullName, phone: user.phoneCanonical },
      };
    });
  }

  removeAddress(
    token: string | undefined,
    addressId: string,
  ): Promise<CustomerAddressListResponse> {
    const id = this.id(addressId);
    return this.customer(token, undefined, async ({ tx, customerUserId }) => {
      await tx.customerAddress.deleteMany({ where: { id, userId: customerUserId } });
    }).then(() => this.addresses(token));
  }

  // -------------------------------------------------------------------------------- payment

  /**
   * A PayOS request for the unpaid order (W4-4): the link is valid until the order's own deadline. A live request with its link is
   * returned as it is. `locale` only chooses the page the bank sends the customer back to.
   */
  async pay(
    token: string | undefined,
    orderId: string,
    locale: 'vi' | 'en',
    requestId?: string,
  ): Promise<OnlinePaymentResponse> {
    const provider = this.requireProvider();
    const id = this.id(orderId);
    const reserved = await this.customer(token, requestId, (context) =>
      reserveOnlinePayment(context, id),
    );
    if (reserved.kind === 'READY') return reserved.payment;
    const back = `${this.environment.webOrigin}/${locale}/account/orders/${id}`;
    let outcome: OnlineProviderOutcome;
    try {
      const request = await provider.createPaymentRequest({
        orderCode: reserved.orderCode,
        amountVnd: reserved.amountVnd,
        description: 'LUCYSPA',
        expiresAt: reserved.expiresAt,
        returnUrl: back,
        cancelUrl: `${back}?cancelled=1`,
      });
      outcome = {
        kind: 'CREATED',
        paymentLinkId: request.paymentLinkId,
        checkoutUrl: request.checkoutUrl,
        qrCode: request.qrCode,
      };
    } catch (error) {
      if (error instanceof ProviderRejectedError) {
        outcome = { kind: 'REJECTED', providerCode: error.providerCode };
      } else if (error instanceof ProviderUnavailableError) {
        outcome = { kind: 'UNREACHABLE' };
      } else {
        throw error;
      }
    }
    const done = await this.customer(token, requestId, (context) =>
      completeOnlinePayment(context, reserved.invoiceId, reserved.paymentId, outcome),
    );
    if (done.failure === 'REJECTED') throw new AuthError('PAYMENT_PROVIDER_REJECTED');
    if (done.failure === 'UNREACHABLE') throw new AuthError('PAYMENT_PROVIDER_UNAVAILABLE');
    return done.payment;
  }

  /** Re-reads the order's pending request from PayOS now: recovers a missed notification when the customer comes back from the bank. */
  async refresh(token: string | undefined, orderId: string): Promise<OnlineOrderResponse> {
    const provider = this.provider;
    const id = this.id(orderId);
    if (provider) {
      const pending = await this.customer(token, undefined, (context) =>
        pendingProviderRequests(context, id),
      );
      for (const request of pending) {
        const read = await readProvider(provider, request.orderCode);
        await this.customer(token, undefined, (context) =>
          applyProviderRead(
            context.tx,
            { kind: 'USER', userId: context.customerUserId, requestId: context.requestId },
            request.paymentId,
            read,
          ),
        );
      }
    }
    return this.order(token, id);
  }

  /** The member cancels an unpaid order: the live PayOS request is cancelled at the provider first, then the order ends. */
  async cancel(token: string | undefined, orderId: string): Promise<OnlineOrderResponse> {
    const id = this.id(orderId);
    const provider = this.provider;
    if (provider) {
      const pending = await this.customer(token, undefined, (context) =>
        pendingProviderRequests(context, id),
      );
      for (const request of pending) {
        let read: ProviderRead;
        try {
          read = {
            kind: 'SNAPSHOT',
            snapshot: await provider.cancelPaymentRequest(
              Number(request.orderCode),
              'Cancelled by the customer',
            ),
          };
        } catch (error) {
          // A refused cancel means the request is no longer pending at the provider (paid, expired, unknown): read what it is.
          if (error instanceof ProviderRejectedError)
            read = await readProvider(provider, request.orderCode);
          else if (error instanceof ProviderUnavailableError) read = { kind: 'UNAVAILABLE' };
          else throw error;
        }
        await this.customer(token, undefined, (context) =>
          applyProviderRead(
            context.tx,
            { kind: 'USER', userId: context.customerUserId, requestId: context.requestId },
            request.paymentId,
            read,
            { reason: 'Cancelled by the customer' },
          ),
        );
      }
    }
    const outcome = await this.customer(token, undefined, (context) =>
      cancelOwnUnpaidOrder(context, id),
    );
    if (outcome === 'PAYMENT_PENDING') throw new AuthError('PAYMENT_PROVIDER_PENDING');
    const after = await this.order(token, id);
    // Idempotent: cancelling an order that is already cancelled answers with it; a paid order cannot be cancelled here.
    if (outcome === 'NOT_APPLICABLE' && after.state !== 'CANCELLED') {
      throw new AuthError('ONLINE_ORDER_STATE_INVALID');
    }
    return after;
  }

  /** The member presses "Tôi đã nhận hàng" (OQ-96). */
  async received(token: string | undefined, orderId: string): Promise<OnlineOrderResponse> {
    const id = this.id(orderId);
    await this.customer(token, undefined, (context) => confirmReceived(context, id));
    return this.order(token, id);
  }

  // ----------------------------------------------------------------------- staff: the orders to pack and ship

  fulfilmentContext(token: string | undefined): Promise<OnlineContextResponse> {
    return this.admin(token, undefined, (context) => orderContext(context));
  }

  queue(
    token: string | undefined,
    query: { branchId: string; tab?: unknown; q?: unknown; page?: unknown },
  ): Promise<OnlineQueueResponse> {
    const branchId = this.id(query.branchId);
    return this.admin(token, undefined, (context) =>
      listOnlineQueue(context, { ...query, branchId }),
    );
  }

  staffOrder(token: string | undefined, orderId: string): Promise<OnlineStaffOrderResponse> {
    const id = this.id(orderId);
    return this.admin(token, undefined, (context) => onlineStaffOrder(context, id));
  }

  ship(
    token: string | undefined,
    orderId: string,
    body: OnlineShipRequest,
    requestId?: string,
  ): Promise<OnlineStaffOrderResponse> {
    const id = this.id(orderId);
    return this.admin(token, requestId, (context) => shipOrder(context, id, body));
  }

  correctShipment(
    token: string | undefined,
    orderId: string,
    body: OnlineShipmentCorrectRequest,
    requestId?: string,
  ): Promise<OnlineStaffOrderResponse> {
    const id = this.id(orderId);
    return this.admin(token, requestId, (context) => correctShipment(context, id, body));
  }

  delivered(
    token: string | undefined,
    orderId: string,
    body: OnlineDeliveredRequest,
    requestId?: string,
  ): Promise<OnlineStaffOrderResponse> {
    const id = this.id(orderId);
    return this.admin(token, requestId, (context) => markDelivered(context, id, body));
  }

  log(
    token: string | undefined,
    orderId: string,
    body: OnlineLogRequest,
    requestId?: string,
  ): Promise<OnlineStaffOrderResponse> {
    const id = this.id(orderId);
    return this.admin(token, requestId, (context) => addLog(context, id, body));
  }

  returned(
    token: string | undefined,
    orderId: string,
    body: OnlineReturnedRequest,
    requestId?: string,
  ): Promise<OnlineStaffOrderResponse> {
    const id = this.id(orderId);
    return this.admin(token, requestId, (context) => markReturnedToShop(context, id, body));
  }

  address(
    token: string | undefined,
    orderId: string,
    body: OnlineAddressCorrectRequest,
    requestId?: string,
  ): Promise<OnlineStaffOrderResponse> {
    const id = this.id(orderId);
    return this.admin(token, requestId, (context) => correctAddress(context, id, body));
  }

  /** Cancels a paid line that has not shipped and gives the money back (OQ-97); the same command as the counter's, answered with the online page. */
  cancelLine(
    token: string | undefined,
    lineId: string,
    body: Record<string, unknown>,
    requestId?: string,
  ): Promise<OnlineStaffOrderResponse> {
    return this.requireOrders().cancelLineAs(
      token,
      lineId,
      body,
      requestId,
      (context) => (orderId) => onlineStaffOrder(context, orderId),
    );
  }

  /** The settlement of a failed delivery (OQ-98): the refund of the goods minus the carrier costs, by a person who may refund. */
  settle(
    token: string | undefined,
    orderId: string,
    body: Record<string, unknown>,
    requestId?: string,
  ): Promise<OnlineStaffOrderResponse> {
    const id = this.id(orderId);
    // The Owner is told in the same transaction: the Owner's account is resolved and locked (with the actor, sorted) BEFORE the invoice.
    let owners: readonly string[] = [];
    return this.requireOrders().run(
      token,
      requestId,
      (context) =>
        settleFailedDelivery(
          context,
          id,
          { ...body },
          this.environment.auth.freshAuthSeconds,
          owners,
        ),
      async (tx) => {
        if (!(await this.mayRefundOrder(tx, token, id))) return [];
        owners = await ownerRecipients(tx);
        return owners;
      },
    );
  }

  /** What the shop paid to have goods come back after a delivery (OQ-100). */
  returnCost(
    token: string | undefined,
    caseId: string,
    body: { costVnd: string; note?: string | null },
    requestId?: string,
  ): Promise<OnlineStaffOrderResponse> {
    const id = this.id(caseId);
    return this.admin(token, requestId, async (context) => {
      const { orderId } = await recordReturnCost(context, id, body);
      return onlineStaffOrder(context, orderId);
    });
  }

  private requireOrders(): ProductOrderService {
    if (!this.counterOrders) throw new AuthError('SERVICE_UNAVAILABLE');
    return this.counterOrders;
  }

  private async mayRefundOrder(
    tx: Prisma.TransactionClient,
    token: string | undefined,
    orderId: string,
  ): Promise<boolean> {
    const digest = token === undefined ? null : capabilityDigest(token);
    if (digest === null) return false;
    const session = await tx.session.findUnique({
      where: { tokenHash: new Uint8Array(digest) },
      select: { userId: true },
    });
    if (!session?.userId) return false;
    const order = await tx.productOrder.findUnique({
      where: { id: orderId },
      select: { branchId: true },
    });
    if (!order) return false;
    const graph = await loadAuthorityGraph(tx, session.userId);
    return graph !== null && holdsAt(graph, 'REFUND_PRODUCTS', order.branchId);
  }

  // ------------------------------------------------------------------------------------ staff: carriers

  carriers(token: string | undefined): Promise<ShippingCarrierListResponse> {
    return this.admin(token, undefined, (context) => listCarriers(context));
  }

  createCarrier(
    token: string | undefined,
    body: ShippingCarrierCreateRequest,
    requestId?: string,
  ): Promise<ShippingCarrierListResponse> {
    return this.admin(token, requestId, (context) => createCarrier(context, body));
  }

  editCarrier(
    token: string | undefined,
    carrierId: string,
    body: ShippingCarrierEditRequest,
    requestId?: string,
  ): Promise<ShippingCarrierListResponse> {
    const id = this.id(carrierId);
    return this.admin(token, requestId, (context) => editCarrier(context, id, body));
  }

  // ------------------------------------------------------------------------------------ frames

  private id(value: string): string {
    if (!UUID.test(value)) throw new AuthError('NOT_FOUND');
    return value.toLowerCase();
  }

  private requireProvider(): PaymentProvider {
    if (!this.provider) throw new AuthError('PAYMENT_METHOD_UNAVAILABLE');
    return this.provider;
  }

  private customer<T>(
    token: string | undefined,
    requestId: string | undefined,
    work: (context: CustomerContext) => Promise<T>,
  ): Promise<T> {
    return runCustomerCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      (context) =>
        conflictOnDatabaseGuard(async () => {
          // One member cannot occupy the API: the most successful requests per minute is counted in the same transaction (a request that
          // fails rolls its count back, so only requests that did something are counted; refused ones are cheap and bounded by the lock).
          const admitted = await this.throttle.debitWindow(
            context.tx,
            'ONLINE_MEMBER',
            context.customerUserId,
            ONLINE_LIMITS.memberRequestsPerMinute,
            60,
            context.now,
          );
          if (!admitted) throw new AuthError('RATE_LIMITED');
          return work(context);
        }),
      { requestId },
    );
  }

  private admin<T>(
    token: string | undefined,
    requestId: string | undefined,
    work: (context: AdminContext) => Promise<T>,
  ): Promise<T> {
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      { exclusive: false, requestId },
      (context) => conflictOnDatabaseGuard(() => work(context)),
    );
  }
}
