import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pino } from 'pino';
import type {
  OnlineCartResponse,
  OnlineCheckoutRequest,
  OnlineOrderResponse,
} from '@lucy-spa/contracts';
import type { DatabaseClient } from '@lucy-spa/database';
import {
  createPayosSimulator,
  LocalDiskMediaStorage,
  FINANCIAL_NOTIFICATION_EVENT_TYPES,
  processFinancialNotificationEvent,
  type OnlineTimeoutSummary,
  type PayosSimulator,
} from '@lucy-spa/server';
import { OnlineOrderService } from '../online-orders/online.service.js';
import { ProductOrderService } from '../product-orders/order.service.js';
import { ProductRefundService } from '../product-returns/refund.service.js';
import { ProductReturnService } from '../product-returns/return.service.js';
import { PayosWebhookService } from '../pos/payos.webhook.js';
import { validVnMobile } from './phone.js';
import type { Phase6Kit } from './phase6-fixture.js';
import { productOrderKit, type ProductOrderKit } from './product-order-kit.js';

/**
 * Fixtures for the Wave 4 suites (online orders) on top of the order kit (one rolled-back transaction): the master switch and the
 * settings, members with a session, stocked products, the cart, the checkout, the simulated PayOS with a real webhook service, the
 * sweep of overdue orders, and the reconciliation of online orders. Test fixture only.
 */
export interface InvoiceFacts {
  status: string;
  channel: string;
  totalVnd: bigint;
  subtotalVnd: bigint;
  discountTotalVnd: bigint;
  shippingFeeVnd: bigint;
  cancelledByUserId: string | null;
  cancelReason: string | null;
  paidSeq: number;
}

export interface ReservationFacts {
  source: string;
  status: string;
  quantity: number;
  releaseCause: string | null;
}

type Member = { id: string; fullName: string; token: string };
type Stocked = { productId: string; variantId: string; sku: string; price: number };

export type OnlineOrderKit = Omit<ProductOrderKit, 'levelOf' | 'reconcileAll'> & {
  levelOf: (variantId: string) => Promise<{ onHand: number; reserved: number }>;
  simulator: PayosSimulator;
  online: OnlineOrderService;
  closedProvider: OnlineOrderService;
  returns: ProductReturnService;
  refunds: ProductRefundService;
  /** A NEW password confirmation for a person, as the password dialog gives (one confirmation covers one refund). */
  reconfirm: (token: string) => Promise<void>;
  webhook: PayosWebhookService;
  configure: (patch: Record<string, unknown>) => Promise<void>;
  updateVariant: (variantId: string, patch: Record<string, unknown>) => Promise<void>;
  open: (patch?: Record<string, unknown>) => Promise<void>;
  member: (label?: string) => Promise<Member>;
  address: (patch?: Record<string, string>) => OnlineCheckoutRequest['address'];
  stocked: (label: string, price: number, stock: number) => Promise<Stocked>;
  addToCart: (
    who: { token: string },
    variantId: string,
    quantity?: number,
  ) => Promise<OnlineCartResponse>;
  cart: (who: { token: string }) => Promise<OnlineCartResponse>;
  place: (
    who: { token: string },
    patch?: Partial<OnlineCheckoutRequest>,
  ) => Promise<OnlineOrderResponse>;
  order: (
    who: { token: string },
    lines: readonly { variantId: string; quantity?: number }[],
    patch?: Partial<OnlineCheckoutRequest>,
  ) => Promise<OnlineOrderResponse>;
  checkoutRequest: (patch?: Partial<OnlineCheckoutRequest>) => Promise<OnlineCheckoutRequest>;
  payViaWebhook: (
    who: { token: string },
    placed: OnlineOrderResponse,
    reference?: string,
  ) => Promise<{ orderCode: number }>;
  sweep: (graceMs?: number) => Promise<OnlineTimeoutSummary>;
  makeOverdue: (orderId: string, minutesAgo?: number) => Promise<void>;
  invoiceRow: (invoiceId: string) => Promise<InvoiceFacts>;
  reservationsOf: (invoiceId: string) => Promise<ReservationFacts[]>;
  saleMovements: (invoiceId: string) => Promise<number>;
  /** Runs the in-app notification consumer over the invoice events not handled yet (the worker does this in production). */
  runNotifications: () => Promise<string[]>;
  reconcileOnline: () => Promise<void>;
  reconcileAll: () => Promise<void>;
};

export async function onlineOrderKit(base: Phase6Kit): Promise<OnlineOrderKit> {
  const k = await productOrderKit(base);
  const { tx } = base;
  const simulator = createPayosSimulator();
  const counterOrders = new ProductOrderService(base.adapter, base.throttle, base.environment);
  const online = new OnlineOrderService(
    base.adapter,
    base.throttle,
    base.environment,
    simulator.provider,
    counterOrders,
  );
  const returns = new ProductReturnService(
    base.adapter,
    base.throttle,
    new LocalDiskMediaStorage(mkdtempSync(path.join(tmpdir(), 'lucy-online-returns-'))),
    pino({ level: 'silent' }),
  );
  const refunds = new ProductRefundService(base.adapter, base.throttle, base.environment);
  const reconfirm = async (token: string) => {
    const principal = await base.adapter.resolve(token);
    assert.ok(principal?.userId, 'a signed-in person');
    await tx.$executeRawUnsafe('SELECT pg_sleep(0.003)');
    await tx.$executeRawUnsafe('SAVEPOINT confirm');
    try {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.$executeRawUnsafe(
        `UPDATE sessions SET reauthenticated_at = date_trunc('milliseconds', clock_timestamp()) WHERE user_id = '${principal.userId}'`,
      );
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT confirm');
    } catch (error) {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT confirm');
      throw error;
    }
  };
  const closedProvider = new OnlineOrderService(
    base.adapter,
    base.throttle,
    base.environment,
    null,
  );
  const webhook = new PayosWebhookService(
    { client: { $transaction: (work: never) => base.adapter.withTransaction(work) } } as never,
    simulator.provider,
    null,
  );
  const sweepDatabase = {
    payment: tx.payment,
    $queryRaw: tx.$queryRaw.bind(tx),
    $transaction: (work: never) => base.adapter.withTransaction(work),
  } as unknown as DatabaseClient;

  /** Changes the settings row directly (the fixture owner), leaving the version consistent. */
  const configure = async (patch: Record<string, unknown>) => {
    const current = await tx.onlineSalesSettings.findUniqueOrThrow({ where: { id: 1 } });
    await tx.onlineSalesSettings.update({
      where: { id: 1 },
      data: { ...patch, rowVersion: current.rowVersion + 1 },
    });
  };
  /** Changes a variant row directly (the database wants the version to advance by one). */
  const updateVariant = async (variantId: string, patch: Record<string, unknown>) => {
    await tx.productVariant.update({
      where: { id: variantId },
      data: { ...patch, rowVersion: { increment: 1 } },
    });
  };
  const open = (patch: Record<string, unknown> = {}) =>
    configure({ enabled: true, fulfilmentBranchId: k.A.id, ...patch });

  let memberNo = 0;
  const member = async (label = 'online') => {
    memberNo += 1;
    const user = await k.customer(`${label}${memberNo}`);
    return { ...user, token: await base.signIn(user.id) };
  };
  const address = (patch: Record<string, string> = {}) => ({
    recipientName: 'Nguyễn Thị Hoa',
    recipientPhone: validVnMobile(),
    provinceCode: 'HA_NOI',
    ward: 'Phường Cửa Nam',
    street: '12 Phố Huế',
    ...patch,
  });

  /** A published product with one priced variant, `stock` units received at branch A (0 = never received). */
  const stocked = async (label: string, price: number, stock: number) => {
    const created = await k.product(label, [price]);
    const variant = created.variants[0]!;
    if (stock > 0) await k.receive(variant.id, stock);
    return { productId: created.id, variantId: variant.id, sku: variant.sku, price };
  };
  const policyVersion = async () =>
    (await tx.onlineSalesSettings.findUniqueOrThrow({ where: { id: 1 } })).policyVersion;

  const addToCart = (who: { token: string }, variantId: string, quantity = 1) =>
    online.addToCart(who.token, { variantId, quantity });
  let requestNo = 0;
  const requestId = () => {
    requestNo += 1;
    return `00000000-0000-4000-8000-${String(requestNo).padStart(12, '0')}`;
  };
  const checkoutRequest = async (
    patch: Partial<OnlineCheckoutRequest> = {},
  ): Promise<OnlineCheckoutRequest> => ({
    address: address(),
    acceptedPolicyVersion: await policyVersion(),
    clientRequestId: requestId(),
    ...patch,
  });
  /** Places the order from the member's cart. */
  const place = async (
    who: { token: string },
    patch: Partial<OnlineCheckoutRequest> = {},
  ): Promise<OnlineOrderResponse> =>
    k.ok(async () => online.place(who.token, await checkoutRequest(patch)));
  /** A cart with the given lines, then the order. */
  const order = async (
    who: { token: string },
    lines: readonly { variantId: string; quantity?: number }[],
    patch: Partial<OnlineCheckoutRequest> = {},
  ) => {
    for (const line of lines) await addToCart(who, line.variantId, line.quantity ?? 1);
    return place(who, patch);
  };
  /** The member pays the order at the simulated bank and the webhook arrives. */
  const payViaWebhook = async (
    who: { token: string },
    placed: OnlineOrderResponse,
    reference = `TF-${placed.code}`,
  ) => {
    const payment = await k.ok(() => online.pay(who.token, placed.id, 'vi'));
    const orderCode = [...simulator.orders.keys()].at(-1)!;
    const outcome = await k.ok(() => webhook.receive(simulator.pay(orderCode, { reference })));
    return { payment, orderCode, outcome };
  };
  const sweep = async (graceMs = 0) => {
    const { cancelOverdueOnlineOrders } = await import('@lucy-spa/server');
    return cancelOverdueOnlineOrders(sweepDatabase, simulator.provider, { graceMs });
  };
  /** Moves the deadline of an unpaid online order into the past (fixture statement; triggers lifted for this one update). */
  const makeOverdue = async (orderId: string, minutesAgo = 5) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
    await tx.$executeRawUnsafe(
      `UPDATE online_order_details SET deadline_at = clock_timestamp() - interval '${minutesAgo} minutes' WHERE order_id = '${orderId}'::uuid`,
    );
    await tx.$executeRawUnsafe(
      `UPDATE payments SET expires_at = clock_timestamp() - interval '${minutesAgo} minutes' WHERE invoice_id = (SELECT invoice_id FROM product_orders WHERE id = '${orderId}'::uuid) AND status = 'PENDING'`,
    );
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = DEFAULT');
  };
  const runNotifications = async (): Promise<string[]> => {
    const events = await tx.outboxEvent.findMany({
      where: {
        eventType: { in: FINANCIAL_NOTIFICATION_EVENT_TYPES },
        consumptions: { none: { consumer: 'notifications' } },
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    const outcomes: string[] = [];
    for (const event of events)
      outcomes.push(await processFinancialNotificationEvent(tx, event.id));
    return outcomes;
  };
  const invoiceRow = (invoiceId: string): Promise<InvoiceFacts> =>
    tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: {
        status: true,
        channel: true,
        totalVnd: true,
        subtotalVnd: true,
        discountTotalVnd: true,
        shippingFeeVnd: true,
        cancelledByUserId: true,
        cancelReason: true,
        paidSeq: true,
      },
    });
  const reservationsOf = (invoiceId: string): Promise<ReservationFacts[]> =>
    tx.stockReservation.findMany({
      where: { invoiceId },
      orderBy: { reservedAt: 'asc' },
      select: { source: true, status: true, quantity: true, releaseCause: true },
    });
  const saleMovements = (invoiceId: string) =>
    tx.stockMovement.count({ where: { kind: 'SALE', invoiceLine: { invoiceId } } });
  const cart = (who: { token: string }): Promise<OnlineCartResponse> => online.cart(who.token);

  /**
   * The reconciliation of every online order of the fixture: the order, its invoice, its lines, its reservations and the sales of stock
   * tell one story. Used with `k.reconcileAll` at the end of every test.
   */
  const reconcileOnline = async () => {
    const rows = await tx.$queryRaw<
      {
        id: string;
        status: string;
        mode: string;
        invoice_status: string;
        reservation: string | null;
        source: string | null;
        quantity: number;
        reservation_quantity: number | null;
        sold: bigint;
        cancel_cause: string | null;
      }[]
    >`
      SELECT o.id, o.status::text AS status, d.fulfilment_mode::text AS mode, i.status::text AS invoice_status,
             r.status::text AS reservation, r.source::text AS source, o.quantity, r.quantity AS reservation_quantity,
             COALESCE((SELECT -sum(m.quantity_delta) FROM stock_movements m
                       WHERE m.invoice_line_id = o.invoice_line_id AND m.kind = 'SALE'), 0)::bigint AS sold,
             o.cancel_cause::text AS cancel_cause
      FROM product_order_lines o
        JOIN product_orders p ON p.id = o.order_id AND p.channel = 'ONLINE'
        JOIN invoices i ON i.id = o.invoice_id
        JOIN invoice_line_products d ON d.invoice_line_id = o.invoice_line_id
        LEFT JOIN stock_reservations r ON r.invoice_line_id = o.invoice_line_id`;
    for (const row of rows) {
      const where = `online line ${row.id} (${row.mode}, ${row.status})`;
      if (row.invoice_status === 'PENDING_PAYMENT')
        assert.equal(row.status, 'AWAITING_PAYMENT', where);
      if (row.invoice_status === 'CANCELLED') assert.equal(row.status, 'CANCELLED', where);
      if (row.mode === 'IN_STOCK') {
        switch (row.status) {
          case 'AWAITING_PAYMENT':
          case 'PAID':
            assert.equal(row.reservation, 'RESERVED', where);
            assert.equal(row.source, 'INVOICE_LINE', where);
            assert.equal(row.sold, 0n, `${where}: nothing is sold before the parcel leaves`);
            break;
          case 'SHIPPED':
            assert.ok(['RESERVED', 'CONSUMED'].includes(row.reservation ?? ''), where);
            break;
          case 'COMPLETED':
            assert.equal(row.reservation, 'CONSUMED', where);
            assert.equal(row.sold, BigInt(row.quantity), where);
            break;
          case 'CANCELLED':
            if (row.cancel_cause === 'DELIVERY_FAILED')
              assert.equal(row.reservation, 'CONSUMED', where);
            else assert.equal(row.reservation, 'RELEASED', where);
            break;
          default:
            assert.fail(`${where}: an in-stock online line cannot be ${row.status}`);
        }
      } else {
        // A pre-order line holds nothing until its goods arrive, then an ORDER_LINE reservation; sold at shipping.
        if (['AWAITING_PAYMENT', 'PAID', 'ORDERED'].includes(row.status)) {
          assert.equal(row.reservation, null, where);
          assert.equal(row.sold, 0n, where);
        }
        if (row.status === 'ARRIVED') {
          assert.equal(row.reservation, 'RESERVED', where);
          assert.equal(row.source, 'ORDER_LINE', where);
          assert.equal(row.sold, 0n, where);
        }
        if (row.status === 'COMPLETED') assert.equal(row.sold, BigInt(row.quantity), where);
      }
    }
    // An online invoice never has a sale movement before one of its lines shipped.
    const early = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM stock_movements m
        JOIN invoice_lines l ON l.id = m.invoice_line_id
        JOIN product_orders p ON p.invoice_id = l.invoice_id AND p.channel = 'ONLINE'
        JOIN product_order_lines o ON o.invoice_line_id = l.id
      WHERE m.kind = 'SALE' AND o.status NOT IN ('SHIPPED', 'COMPLETED', 'CANCELLED')`;
    assert.equal(early[0]!.n, 0n, 'no sale of stock before shipping');
  };

  /** The level of a variant that was received (never null here). */
  const levelOf = async (variantId: string) => (await k.levelOf(variantId))!;

  return {
    ...k,
    levelOf,
    simulator,
    online,
    closedProvider,
    returns,
    refunds,
    reconfirm,
    webhook,
    configure,
    updateVariant,
    open,
    member,
    address,
    stocked,
    addToCart,
    cart,
    place,
    order,
    checkoutRequest,
    payViaWebhook,
    sweep,
    makeOverdue,
    invoiceRow,
    reservationsOf,
    saleMovements,
    reconcileOnline,
    runNotifications,
    reconcileAll: async () => {
      await k.reconcileAll();
      await reconcileOnline();
    },
  };
}
