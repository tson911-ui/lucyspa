import assert from 'node:assert/strict';
import type {
  InvoiceResponse,
  ProductHandoverToName,
  ProductOrderCancelCauseName,
  ProductOrderLineStatusName,
  ProductOrderResponse,
} from '@lucy-spa/contracts';
import { ProductOrderService, PublicProductOrderService } from '../product-orders/order.service.js';
import { productSaleKit } from './product-sale-kit.js';
import type { Phase6Kit } from './phase6-fixture.js';

/** The facts of one order line as the database holds them. */
export interface OrderLineFacts {
  id: string;
  status: ProductOrderLineStatusName;
  quantity: number;
  paidAt: Date | null;
  expectedFrom: Date | null;
  expectedTo: Date | null;
  orderedAt: Date | null;
  orderedByUserId: string | null;
  orderedNote: string | null;
  arrivedAt: Date | null;
  arrivedByUserId: string | null;
  arrivalReceiptId: string | null;
  handedOverAt: Date | null;
  handedOverByUserId: string | null;
  handedOverTo: ProductHandoverToName | null;
  handedOverToName: string | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  cancelCause: ProductOrderCancelCauseName | null;
  cancelNote: string | null;
  rowVersion: number;
}

/** The reservation of an order line. */
export interface OrderReservationFacts {
  status: 'RESERVED' | 'CONSUMED' | 'RELEASED';
  quantity: number;
  consumedPaidSeq: number | null;
  releaseCause: string | null;
  source: 'INVOICE_LINE' | 'ORDER_LINE';
}

/**
 * Fixtures for the Wave 3b suites (counter pre-orders) on top of the product-sale kit (one rolled-back transaction): people who may
 * sell, work the queue and refund at branch A, pre-order lines, finalization with the phone number, and the reconciliation of the
 * orders (every order line tells the same story as its invoice, its reservation, its stock sale and the level of the stock).
 * Test fixture only.
 */
export async function productOrderKit(base: Phase6Kit) {
  const k = await productSaleKit(base);
  const { tx } = base;
  const orders = new ProductOrderService(base.adapter, base.throttle);
  const publicTickets = new PublicProductOrderService(base.adapter);
  const queue = await base.staff(['MANAGE_PRODUCT_ORDERS', 'VIEW_INVENTORY'], {
    branchId: k.A.id,
  });
  const refunder = await base.staff(
    ['REFUND_PRODUCTS', 'MANAGE_PRODUCT_ORDERS', 'MANAGE_PRODUCT_RETURNS'],
    { branchId: k.A.id },
  );
  const people = { ...k.people, queue, refunder };

  /** A published product with one priced variant that is (by default) sold on order. */
  const preOrderProduct = async (
    label: string,
    price: number,
    options: { sellOnOrder?: boolean; leadMin?: number; leadMax?: number } = {},
  ) => {
    const created = await k.product(label, [price]);
    const variant = created.variants[0]!;
    await tx.productVariant.update({
      where: { id: variant.id },
      data: {
        sellOnOrder: options.sellOnOrder ?? true,
        leadTimeDaysMin: options.leadMin ?? null,
        leadTimeDaysMax: options.leadMax ?? null,
        rowVersion: { increment: 1 },
      },
    });
    return { productId: created.id, variantId: variant.id, sku: variant.sku, price };
  };

  const addPreOrderLine = (
    invoice: InvoiceResponse,
    variantId: string,
    quantity: number,
    actor: { token: string } = people.cashier,
  ): Promise<InvoiceResponse> =>
    k.ok(() =>
      k.invoices.addProductLine(actor.token, invoice.id, {
        expectedVersion: invoice.version,
        variantId,
        quantity,
        fulfilmentMode: 'PRE_ORDER',
      }),
    );
  const finalizeWith = (
    invoice: InvoiceResponse,
    phone: string | null = '0901 234 567',
    name: string | null = null,
    actor: { token: string } = people.cashier,
  ) =>
    k.ok(() =>
      k.invoices.finalize(actor.token, invoice.id, {
        expectedVersion: invoice.version,
        ...(phone === null ? {} : { preOrderContact: { phone, ...(name ? { name } : {}) } }),
      }),
    );
  /** A finalized, unpaid pre-order of `quantity` of one variant (and the order it created). */
  const preOrder = async (
    variantId: string,
    quantity: number,
    options: { payer?: string | null; phone?: string } = {},
  ) => {
    const draft = await k.openSale(people.cashier, options.payer ?? null);
    const withLine = await addPreOrderLine(draft, variantId, quantity);
    const invoice = await finalizeWith(withLine, options.phone ?? '0901 234 567');
    const order = invoice.productOrder;
    assert.ok(order, 'the finalization wrote the order');
    return { invoice, order, line: order.lines[0]! };
  };
  /** A pre-order that is also paid in full. */
  const paidPreOrder = async (
    variantId: string,
    quantity: number,
    options: { payer?: string | null; phone?: string } = {},
  ) => {
    const sale = await preOrder(variantId, quantity, options);
    await k.pay(sale.invoice.id, Number(sale.invoice.totalVnd));
    const invoice = await k.invoices.get(people.cashier.token, sale.invoice.id);
    return {
      ...sale,
      invoice,
      order: invoice.productOrder!,
      line: invoice.productOrder!.lines[0]!,
    };
  };
  const orderOf = async (invoiceId: string): Promise<ProductOrderResponse> => {
    const invoice = await k.invoices.get(people.cashier.token, invoiceId);
    assert.ok(invoice.productOrder);
    return invoice.productOrder;
  };
  const lineRow = (orderLineId: string): Promise<OrderLineFacts> =>
    tx.productOrderLine.findUniqueOrThrow({
      where: { id: orderLineId },
    }) as Promise<OrderLineFacts>;
  const reservationOf = (invoiceLineId: string): Promise<OrderReservationFacts | null> =>
    tx.stockReservation.findUnique({
      where: { invoiceLineId },
    }) as Promise<OrderReservationFacts | null>;

  /**
   * The Owner's reconciliation of the orders over the whole fixture: for every order line its status, its reservation (source
   * ORDER_LINE), its stock sale and the history agree; the history has one event per status reached; nothing about money lives on an
   * order. Used with `k.reconcile` (stock levels, invoices) at the end of every test.
   */
  const reconcileOrders = async () => {
    const lines = await tx.$queryRaw<
      {
        id: string;
        status: string;
        quantity: number;
        reservation: string | null;
        reservation_quantity: number | null;
        consumed_paid_seq: number | null;
        sold: bigint;
        invoice_status: string;
        events: bigint;
        last_event: string | null;
        refunds: bigint;
      }[]
    >`
      SELECT o.id, o.status::text AS status, o.quantity, r.status::text AS reservation, r.quantity AS reservation_quantity,
             r.consumed_paid_seq,
             COALESCE((SELECT -sum(m.quantity_delta) FROM stock_movements m
                       WHERE m.invoice_line_id = o.invoice_line_id AND m.kind = 'SALE'), 0)::bigint AS sold,
             i.status::text AS invoice_status,
             (SELECT count(*) FROM product_order_events e WHERE e.order_line_id = o.id) AS events,
             (SELECT e.to_status::text FROM product_order_events e WHERE e.order_line_id = o.id
              ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1) AS last_event,
             (SELECT count(*) FROM product_refunds f WHERE f.invoice_line_id = o.invoice_line_id) AS refunds
      FROM product_order_lines o
      JOIN invoices i ON i.id = o.invoice_id
      LEFT JOIN stock_reservations r ON r.invoice_line_id = o.invoice_line_id AND r.source = 'ORDER_LINE'
      WHERE o.branch_id = ${k.A.id}::uuid`;
    for (const line of lines) {
      assert.equal(line.last_event, line.status, `last event of ${line.id}`);
      assert.ok(line.events >= 1n, `history of ${line.id}`);
      switch (line.status) {
        case 'AWAITING_PAYMENT':
        case 'PAID':
        case 'ORDERED':
          assert.equal(line.reservation, null, `waiting line ${line.id} holds no goods`);
          assert.equal(line.sold, 0n);
          break;
        case 'ARRIVED':
          assert.equal(line.reservation, 'RESERVED', `arrived line ${line.id} holds its goods`);
          assert.equal(line.reservation_quantity, line.quantity);
          assert.equal(line.sold, 0n, `arrived line ${line.id} has sold nothing`);
          break;
        case 'HANDED_OVER':
          assert.ok(['RESERVED', 'CONSUMED'].includes(line.reservation ?? ''));
          break;
        case 'COMPLETED':
          assert.equal(line.reservation, 'CONSUMED', `completed line ${line.id}`);
          assert.equal(
            line.sold,
            BigInt(line.quantity),
            `completed line ${line.id} sold its units`,
          );
          break;
        case 'CANCELLED':
          assert.ok(line.reservation === null || line.reservation === 'RELEASED');
          assert.equal(line.sold, 0n, `cancelled line ${line.id} sold nothing`);
          break;
        default:
          assert.fail(`unknown status ${line.status}`);
      }
      if (line.invoice_status === 'PENDING_PAYMENT') {
        assert.equal(line.status, 'AWAITING_PAYMENT', `unpaid invoice of ${line.id}`);
      }
      if (line.invoice_status === 'CANCELLED') {
        assert.equal(line.status, 'CANCELLED', `cancelled invoice of ${line.id}`);
      }
      if (line.refunds > 0n) {
        assert.equal(
          line.status,
          'CANCELLED',
          `a refunded unfulfilled line ${line.id} is cancelled`,
        );
      }
    }
    // Every ORDER_LINE reservation belongs to an order line; the level's reserved quantity counts them (k.reconcile checks the sums).
    const stray = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM stock_reservations r
      WHERE r.branch_id = ${k.A.id}::uuid AND r.source = 'ORDER_LINE'
        AND NOT EXISTS (SELECT 1 FROM product_order_lines o WHERE o.invoice_line_id = r.invoice_line_id)`;
    assert.equal(stray[0]!.n, 0n, 'no stray order-line reservation');
  };

  return {
    ...k,
    people,
    orders,
    publicTickets,
    preOrderProduct,
    addPreOrderLine,
    finalizeWith,
    preOrder,
    paidPreOrder,
    orderOf,
    lineRow,
    reservationOf,
    reconcileOrders,
    /** The stock reconciliation and the order reconciliation together. */
    reconcileAll: async () => {
      await k.reconcile();
      await reconcileOrders();
    },
  };
}

export type ProductOrderKit = Awaited<ReturnType<typeof productOrderKit>>;
