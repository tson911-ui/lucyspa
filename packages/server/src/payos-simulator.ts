import { randomUUID } from 'node:crypto';
import { createPayosProvider, payosDataSignature, payosSign, type PayosConfig } from './payos.js';
import type { PaymentProvider } from './payment-provider.js';

/**
 * A deterministic, in-memory stand-in for the PayOS merchant API (Phase 4 Step 8, Q7 item 1: automated tests
 * use simulated PayOS responses; live verification happens only after deployment with a small real amount).
 * It speaks the wire format the adapter is written against: it checks the credentials and the create-request
 * signature, and signs every answer and webhook with the checksum key, exactly as the real service does.
 *
 * TEST SUPPORT ONLY. Production wiring never constructs it: the API and worker build the real adapter from
 * the environment or disable the method when no configuration exists.
 */

export interface SimulatedOrder {
  readonly orderCode: number;
  readonly amount: number;
  readonly description: string;
  readonly paymentLinkId: string;
  readonly expiredAt: number;
  status: 'PENDING' | 'PAID' | 'CANCELLED' | 'EXPIRED';
  amountPaid: number;
  reference: string | null;
  cancellationReason: string | null;
}

export type SimulatorFault = 'UNREACHABLE' | 'SERVER_ERROR' | 'BAD_SIGNATURE' | 'REJECT';

export interface PayosSimulator {
  readonly config: PayosConfig;
  readonly fetch: typeof fetch;
  readonly provider: PaymentProvider;
  readonly orders: Map<number, SimulatedOrder>;
  /** Every request as `METHOD path`, in order (never a body or a credential). */
  readonly calls: string[];
  /** The next `count` matching requests fail this way (`create`, `read` or `cancel`). */
  fail(operation: 'create' | 'read' | 'cancel', fault: SimulatorFault, count?: number): void;
  /** The customer pays the order at the provider; returns the signed webhook body PayOS would send. */
  pay(
    orderCode: number,
    options?: { amount?: number; reference?: string },
  ): Record<string, unknown>;
  /** A signed webhook body for any values (also for orders the simulator does not know). */
  webhook(data: {
    orderCode: number;
    amount: number;
    reference: string;
    paymentLinkId?: string;
    success?: boolean;
  }): Record<string, unknown>;
  /** The provider expires the order (status becomes EXPIRED). */
  expire(orderCode: number): void;
}

export function createPayosSimulator(
  config: PayosConfig = {
    clientId: 'simulated-client',
    apiKey: 'simulated-api-key',
    checksumKey: 'simulated-checksum-key',
  },
): PayosSimulator {
  const orders = new Map<number, SimulatedOrder>();
  const calls: string[] = [];
  const faults: Record<string, SimulatorFault[]> = { create: [], read: [], cancel: [] };
  let transfers = 0;

  const answer = (
    status: number,
    code: string,
    desc: string,
    data: Record<string, unknown> | null,
  ) =>
    Response.json(
      { code, desc, data, signature: data ? payosDataSignature(data, config.checksumKey) : null },
      { status },
    );

  const snapshot = (order: SimulatedOrder) => ({
    id: order.paymentLinkId,
    orderCode: order.orderCode,
    amount: order.amount,
    amountPaid: order.amountPaid,
    amountRemaining: order.amount - order.amountPaid,
    status: order.status,
    createdAt: '2026-09-30T00:00:00+07:00',
    transactions: order.reference
      ? [{ reference: order.reference, amount: order.amountPaid, counterAccountName: 'Payer' }]
      : [],
    ...(order.cancellationReason ? { cancellationReason: order.cancellationReason } : {}),
  });

  const fault = (operation: string): SimulatorFault | undefined => faults[operation]?.shift();

  const simulatedFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url.pathname}`);
    const headers = new Headers(init?.headers);
    if (
      headers.get('x-client-id') !== config.clientId ||
      headers.get('x-api-key') !== config.apiKey
    ) {
      return answer(401, '401', 'Unauthorized', null);
    }
    const create = method === 'POST' && url.pathname === '/v2/payment-requests';
    const cancel = method === 'POST' && /^\/v2\/payment-requests\/\d+\/cancel$/.test(url.pathname);
    const read = method === 'GET' && /^\/v2\/payment-requests\/\d+$/.test(url.pathname);
    const operation = create ? 'create' : cancel ? 'cancel' : read ? 'read' : null;
    if (!operation) return answer(404, '404', 'Not found', null);
    const injected = fault(operation);
    if (injected === 'UNREACHABLE') throw new TypeError('fetch failed');
    if (injected === 'SERVER_ERROR') return Response.json({}, { status: 502 });
    if (injected === 'REJECT') return answer(200, '20', 'Simulated rejection', null);

    let response: Response;
    if (create) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const expected = payosSign(
        `amount=${body['amount']}&cancelUrl=${body['cancelUrl']}&description=${body['description']}&orderCode=${body['orderCode']}&returnUrl=${body['returnUrl']}`,
        config.checksumKey,
      );
      if (body['signature'] !== expected) return answer(200, '201', 'Invalid signature', null);
      const orderCode = Number(body['orderCode']);
      if (orders.has(orderCode)) return answer(200, '231', 'Order already exists', null);
      const order: SimulatedOrder = {
        orderCode,
        amount: Number(body['amount']),
        description: String(body['description']),
        paymentLinkId: randomUUID(),
        expiredAt: Number(body['expiredAt']),
        status: 'PENDING',
        amountPaid: 0,
        reference: null,
        cancellationReason: null,
      };
      orders.set(orderCode, order);
      response = answer(200, '00', 'success', {
        bin: '970422',
        accountNumber: '0000000000',
        accountName: 'LUCY SPA SIMULATED',
        amount: order.amount,
        description: order.description,
        orderCode,
        currency: 'VND',
        paymentLinkId: order.paymentLinkId,
        status: 'PENDING',
        checkoutUrl: `https://pay.payos.vn/web/${order.paymentLinkId}`,
        qrCode: `00020101021238570010A000000727${orderCode}`,
      });
    } else {
      const orderCode = Number(url.pathname.split('/')[3]);
      const order = orders.get(orderCode);
      if (!order) return answer(200, '101', 'Đơn thanh toán không tồn tại', null);
      if (cancel) {
        if (order.status !== 'PENDING') return answer(200, '231', 'Cannot cancel this order', null);
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        order.status = 'CANCELLED';
        order.cancellationReason =
          typeof body['cancellationReason'] === 'string' ? body['cancellationReason'] : null;
      }
      response = answer(200, '00', 'success', snapshot(order));
    }
    if (injected === 'BAD_SIGNATURE') {
      const tampered = (await response.clone().json()) as Record<string, unknown>;
      return Response.json({ ...tampered, signature: 'f'.repeat(64) }, { status: 200 });
    }
    return response;
  };

  const webhook: PayosSimulator['webhook'] = (data) => {
    const body = {
      orderCode: data.orderCode,
      amount: data.amount,
      description: 'LUCYSPA',
      accountNumber: '0000000000',
      reference: data.reference,
      transactionDateTime: '2026-09-30 10:00:00',
      currency: 'VND',
      paymentLinkId: data.paymentLinkId ?? randomUUID(),
      code: '00',
      desc: 'success',
      counterAccountBankId: '',
      counterAccountName: 'Payer Name',
      counterAccountNumber: '0123456789',
      virtualAccountName: '',
      virtualAccountNumber: '',
    };
    return {
      code: data.success === false ? '01' : '00',
      desc: data.success === false ? 'failed' : 'success',
      success: data.success !== false,
      data: body,
      signature: payosDataSignature(body, config.checksumKey),
    };
  };

  return {
    config,
    fetch: simulatedFetch,
    provider: createPayosProvider(config, { fetch: simulatedFetch }),
    orders,
    calls,
    fail(operation, kind, count = 1) {
      for (let i = 0; i < count; i++) faults[operation]?.push(kind);
    },
    pay(orderCode, options = {}) {
      const order = orders.get(orderCode);
      if (!order) throw new Error('Simulated order does not exist');
      const amount = options.amount ?? order.amount;
      order.status = 'PAID';
      order.amountPaid = amount;
      order.reference = options.reference ?? `TF${String(++transfers).padStart(10, '0')}`;
      return webhook({
        orderCode,
        amount,
        reference: order.reference,
        paymentLinkId: order.paymentLinkId,
      });
    },
    webhook,
    expire(orderCode) {
      const order = orders.get(orderCode);
      if (order && order.status === 'PENDING') order.status = 'EXPIRED';
    },
  };
}
