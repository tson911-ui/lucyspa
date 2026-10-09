import type {
  OnlineCheckoutRequest,
  OnlineOrderResponse,
  OnlinePaymentResponse,
} from '@lucy-spa/contracts';
import { generateInvoiceCode, type Prisma } from '@lucy-spa/database';
import {
  cancelUnpaidOnlineInvoice,
  endPendingPayment,
  expireStalePending,
  type OnlineCancelOutcome,
} from '@lucy-spa/server';
import { randomInt, randomUUID } from 'node:crypto';
import { AuthError } from '../auth/auth.error.js';
import {
  appendAdminAudit,
  type AdminActor,
  type AdminContext,
} from '../authorization/admin-command.js';
import type { AuthorityGraph } from '../authorization/authorization.js';
import { CommandRollback, type CustomerContext } from '../booking/customer-command.js';
import * as input from '../inventory/inventory.input.js';
import { CALCULATION_VERSION, grossOf } from '../pos/invoice.calc.js';
import {
  databaseClock,
  draftAmounts,
  finalizeInvoiceCore,
  resolveVoucher,
  canonicalVoucherCode,
} from '../pos/invoice.core.js';
import {
  clearCart,
  cartLines,
  countUnpaidOrders,
  planLines,
  type PlannedLine,
} from './online.cart.js';
import { parseAddress, type ParsedAddress } from './online.input.js';
import { presentOnlineOrder } from './online.present.js';
import { readOnlineSettings, shippingFeeFor, type OnlineSettingsRow } from './online.settings.js';

/**
 * Phase 6 Wave 4 (P6-19; design 2.38; T41, OQ-39, OQ-89 to OQ-93, OQ-102, OQ-103): the checkout of an online order by a signed-in member.
 *
 * ONE transaction, under the lock the customer command already holds on the member's user row (so two checkouts of one account, and
 * the count of its unpaid orders, are serialized): the settings gate, the unpaid-order limit, the stock levels locked, the mode of every
 * line decided under those locks (whole line in stock, else a pre-order of a variant sold on order, else refused), a DRAFT invoice
 * built from the cart at the prices of the day, one voucher at most, the shipping fee of the settings (0 while the fee setting is off),
 * and the finalization of the invoice by the same core the counter uses: it freezes the prices, applies the member discount, reserves the
 * in-stock lines and writes the order, its lines and the delivery details. The cart is emptied. The payment link is a separate step
 * (a provider call never holds a lock).
 *
 * A QUOTE is the very same build, rolled back: it can never differ from the order that would be placed.
 */

type Tx = Prisma.TransactionClient;

const day = (value: Date) => value.toISOString().slice(0, 10);

/** Customers have no authority graph: a core that asks "may they?" is answered no, so anything not written for them fails closed. */
function customerGraph(userId: string): AuthorityGraph {
  return {
    userId,
    kind: 'CUSTOMER',
    authzVersion: 0,
    activeBranchIds: new Set(),
    roleGrants: [],
    overrides: [],
  };
}

/** The context the invoice cores take, for the customer who owns the online invoice. Every permission check inside it fails. */
export function adminContextOf(context: CustomerContext): AdminContext {
  const actor: AdminActor = {
    principal: context.principal,
    graph: customerGraph(context.customerUserId),
    userId: context.customerUserId,
    owner: false,
  };
  return { tx: context.tx, now: context.now, actor, requestId: context.requestId };
}

export interface QuoteResponse {
  lines: {
    variantId: string;
    quantity: number;
    unitPriceVnd: string;
    lineTotalVnd: string;
    mode: 'IN_STOCK' | 'PRE_ORDER';
  }[];
  subtotalVnd: string;
  discountVnd: string;
  shippingFeeVnd: string;
  totalVnd: string;
  hasPreOrder: boolean;
  voucherCode: string | null;
  /** True when the code lowered the price; a code that is valid but not the best benefit is kept out of the way (one benefit per side). */
  voucherEffective: boolean | null;
  unpaidOrders: number;
}

interface Built {
  invoiceId: string;
  rowVersion: number;
  planned: PlannedLine[];
  quote: QuoteResponse;
  settings: OnlineSettingsRow;
}

async function requireOpen(tx: Tx): Promise<OnlineSettingsRow> {
  const settings = await readOnlineSettings(tx);
  if (!settings.enabled || settings.fulfilmentBranchId === null) {
    throw new AuthError('ONLINE_SALES_CLOSED');
  }
  return settings;
}

async function nextInvoiceCode(
  tx: Tx,
  branchId: string,
): Promise<{ code: string; day: Date; created: Date }> {
  const [clock] = await tx.$queryRaw<{ created: Date; day: Date }[]>`
    SELECT clock_timestamp() AS created, lucy_branch_local_date(${branchId}::uuid, clock_timestamp()) AS day`;
  if (!clock) throw new AuthError('SERVICE_UNAVAILABLE');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = generateInvoiceCode(day(clock.day));
    if (!(await tx.invoice.findUnique({ where: { code: candidate }, select: { id: true } }))) {
      return { code: candidate, day: clock.day, created: clock.created };
    }
  }
  throw new AuthError('SERVICE_UNAVAILABLE');
}

async function build(
  context: CustomerContext,
  voucherCodeRaw: string | null | undefined,
): Promise<Built> {
  const { tx, customerUserId } = context;
  const settings = await requireOpen(tx);
  const branchId = settings.fulfilmentBranchId!;
  if ((await countUnpaidOrders(tx, customerUserId)) >= settings.maxUnpaidOrders) {
    throw new AuthError('ONLINE_UNPAID_LIMIT');
  }
  const { lines: cart } = await cartLines(tx, customerUserId);
  if (cart.length === 0) throw new AuthError('CART_EMPTY');
  if (cart.length > settings.maxCartLines) throw new AuthError('CART_LIMIT');
  const now = await databaseClock(tx);
  const planned = await planLines(tx, settings, cart, now, { lock: true });
  const problems = planned.filter((line) => line.problem !== null);
  if (problems.length > 0) {
    throw new AuthError('CART_NOT_READY', problems.map((line) => line.variantId).join(','));
  }
  const voucherCode =
    voucherCodeRaw === undefined || voucherCodeRaw === null || voucherCodeRaw.trim() === ''
      ? null
      : canonicalVoucherCode(voucherCodeRaw);
  const voucher = voucherCode === null ? null : await resolveVoucher(tx, voucherCode, now);

  const header = await nextInvoiceCode(tx, branchId);
  const invoice = await tx.invoice.create({
    data: {
      code: header.code,
      kind: 'PRODUCT_SALE',
      channel: 'ONLINE',
      branchId,
      payerUserId: customerUserId,
      businessDate: header.day,
      calculationVersion: CALCULATION_VERSION,
      subtotalVnd: 0n,
      discountTotalVnd: 0n,
      totalVnd: 0n,
      createdByUserId: customerUserId,
      createdAt: header.created,
    },
    select: { id: true, payerUserId: true },
  });
  let sequence = 0;
  for (const line of planned) {
    sequence += 1;
    const { variant } = line;
    const suffixVi = variant.labelVi ? ` - ${variant.labelVi}` : '';
    const suffixEn = variant.labelEn ? ` - ${variant.labelEn}` : '';
    const created = await tx.invoiceLine.create({
      data: {
        invoiceId: invoice.id,
        sequence,
        kind: 'PRODUCT',
        itemCode: variant.sku,
        nameVi: `${variant.product.nameVi}${suffixVi}`,
        nameEn: `${variant.product.nameEn}${suffixEn}`,
        quantity: line.quantity,
        unitPriceVnd: line.unitPriceVnd,
        grossVnd: grossOf(line.quantity, line.unitPriceVnd),
      },
      select: { id: true },
    });
    const full = await tx.productVariant.findUniqueOrThrow({
      where: { id: variant.id },
      select: { product: { select: { id: true, brandId: true, categoryId: true } } },
    });
    await tx.invoiceLineProduct.create({
      data: {
        invoiceLineId: created.id,
        invoiceId: invoice.id,
        productId: full.product.id,
        variantId: variant.id,
        sku: variant.sku,
        brandId: full.product.brandId,
        categoryId: full.product.categoryId,
        productNameVi: variant.product.nameVi,
        productNameEn: variant.product.nameEn,
        variantLabelVi: variant.labelVi,
        variantLabelEn: variant.labelEn,
        sellerUserId: null,
        listPriceVnd: line.listPriceVnd,
        promotionId: line.promotionId,
        campaignId: line.campaignId,
        pricedAt: now,
        fulfilmentMode: line.mode!,
      },
      select: { invoiceLineId: true },
    });
  }
  const before = await draftAmounts(tx, invoice, now);
  let voucherEffective: boolean | null = null;
  if (voucher) {
    await tx.invoiceVoucherEntry.create({
      data: {
        invoiceId: invoice.id,
        voucherId: voucher.id,
        suppliedByUserId: customerUserId,
        suppliedAt: now,
      },
      select: { id: true },
    });
  }
  const amounts = voucher ? await draftAmounts(tx, invoice, now) : before;
  if (voucher) voucherEffective = amounts.discountTotalVnd > before.discountTotalVnd;
  // The fee of the settings (0 while the fee setting is off, T40) is part of the total; it is never discounted (OQ-41).
  const fee = shippingFeeFor(settings, amounts.subtotalVnd - amounts.discountTotalVnd);
  const total = amounts.totalVnd + fee;
  const updated = await tx.invoice.update({
    where: { id: invoice.id },
    data: {
      subtotalVnd: amounts.subtotalVnd,
      discountTotalVnd: amounts.discountTotalVnd,
      shippingFeeVnd: fee,
      totalVnd: total,
      rowVersion: { increment: 1 },
    },
    select: { rowVersion: true },
  });
  const quote: QuoteResponse = {
    lines: planned.map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
      unitPriceVnd: line.unitPriceVnd.toString(),
      lineTotalVnd: (line.unitPriceVnd * BigInt(line.quantity)).toString(),
      mode: line.mode!,
    })),
    subtotalVnd: amounts.subtotalVnd.toString(),
    discountVnd: amounts.discountTotalVnd.toString(),
    shippingFeeVnd: fee.toString(),
    totalVnd: total.toString(),
    hasPreOrder: planned.some((line) => line.mode === 'PRE_ORDER'),
    voucherCode,
    voucherEffective,
    unpaidOrders: await countUnpaidOrders(tx, customerUserId),
  };
  return { invoiceId: invoice.id, rowVersion: updated.rowVersion, planned, quote, settings };
}

/** The price of the cart as the checkout would place it, with nothing saved (the build is rolled back). */
export async function quoteCheckout(
  context: CustomerContext,
  request: { voucherCode?: string | null },
): Promise<never> {
  const raw = input.record(request, 'quote', ['voucherCode']);
  const built = await build(context, raw['voucherCode'] as string | null | undefined);
  throw new CommandRollback<QuoteResponse>(built.quote);
}

const REQUEST_KEYS = [
  'address',
  'saveAddress',
  'voucherCode',
  'acceptedPolicyVersion',
  'clientRequestId',
] as const;

/** At most five addresses are kept per member; a repeat of the same address is not kept twice. */
const SAVED_ADDRESS_LIMIT = 5;

async function keepAddress(tx: Tx, userId: string, address: ParsedAddress): Promise<void> {
  const same = await tx.customerAddress.findFirst({
    where: {
      userId,
      recipientName: address.recipientName,
      recipientPhone: address.recipientPhone,
      provinceCode: address.provinceCode,
      ward: address.ward,
      street: address.street,
    },
    select: { id: true },
  });
  if (same) return;
  const count = await tx.customerAddress.count({ where: { userId } });
  if (count >= SAVED_ADDRESS_LIMIT) return;
  await tx.customerAddress.create({
    data: {
      userId,
      recipientName: address.recipientName,
      recipientPhone: address.recipientPhone,
      provinceCode: address.provinceCode,
      ward: address.ward,
      street: address.street,
    },
    select: { id: true },
  });
}

/** Places the order (see the module comment). A repeated `clientRequestId` of the same member returns the order it made. */
export async function placeOrder(
  context: CustomerContext,
  request: OnlineCheckoutRequest,
): Promise<OnlineOrderResponse> {
  const raw = input.record(request, 'checkout', REQUEST_KEYS);
  const clientRequestId = input.uuid(raw['clientRequestId'], 'clientRequestId');
  const address = parseAddress(raw['address'] as OnlineCheckoutRequest['address']);
  const saveAddress =
    raw['saveAddress'] === undefined ? false : input.boolean(raw['saveAddress'], 'saveAddress');
  const policyVersion = raw['acceptedPolicyVersion'];
  if (typeof policyVersion !== 'number' || !Number.isInteger(policyVersion) || policyVersion < 1) {
    throw new AuthError('VALIDATION_FAILED', 'acceptedPolicyVersion');
  }
  const { tx, customerUserId } = context;
  const prior = await tx.onlineOrderDetail.findUnique({
    where: { clientRequestId },
    select: { order: { select: { id: true, customerUserId: true } } },
  });
  if (prior) {
    if (prior.order.customerUserId !== customerUserId) throw new AuthError('CONFLICT');
    return getOrder(context, prior.order.id);
  }
  const built = await build(context, raw['voucherCode'] as string | null | undefined);
  if (policyVersion !== built.settings.policyVersion) throw new AuthError('ONLINE_POLICY_STALE');
  const now = await databaseClock(tx);
  const deadlineAt = new Date(now.getTime() + built.settings.unpaidTimeoutMinutes * 60_000);
  const admin = adminContextOf(context);
  await finalizeInvoiceCore(
    admin,
    built.invoiceId,
    { expectedVersion: built.rowVersion },
    {
      online: {
        recipientName: address.recipientName,
        recipientPhone: address.recipientPhone,
        provinceCode: address.provinceCode,
        provinceName: address.provinceName,
        ward: address.ward,
        street: address.street,
        deadlineAt,
        policyVersion,
        acceptedAt: now,
        clientRequestId,
      },
    },
  );
  await clearCart(tx, customerUserId);
  if (saveAddress) await keepAddress(tx, customerUserId, address);
  const order = await tx.productOrder.findFirstOrThrow({
    where: { invoiceId: built.invoiceId },
    select: { id: true },
  });
  return getOrder(context, order.id);
}

// ----------------------------------------------------------------------------------------- reading

const orderInclude = {
  id: true,
  code: true,
  invoiceId: true,
  createdAt: true,
  invoice: {
    select: {
      code: true,
      status: true,
      rowVersion: true,
      subtotalVnd: true,
      discountTotalVnd: true,
      shippingFeeVnd: true,
      totalVnd: true,
      paidAt: true,
      payments: {
        orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
        select: {
          id: true,
          status: true,
          amountVnd: true,
          checkoutUrl: true,
          qrCode: true,
          expiresAt: true,
        },
      },
    },
  },
  onlineDetail: true,
  addressCorrections: {
    orderBy: [{ occurredAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
    select: {
      recipientName: true,
      recipientPhone: true,
      provinceName: true,
      ward: true,
      street: true,
    },
  },
  shipment: {
    select: {
      carrierName: true,
      trackingCode: true,
      shippedAt: true,
      carrier: { select: { trackingUrlTemplate: true } },
      corrections: {
        orderBy: [{ occurredAt: 'desc' as const }, { id: 'desc' as const }],
        take: 1,
        select: { trackingCode: true },
      },
    },
  },
  lines: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      variantId: true,
      quantity: true,
      status: true,
      expectedFrom: true,
      expectedTo: true,
      cancelCause: true,
      deliveredAt: true,
      line: {
        select: {
          sequence: true,
          nameVi: true,
          nameEn: true,
          unitPriceVnd: true,
          grossVnd: true,
        },
      },
      productLine: {
        select: { variantLabelVi: true, variantLabelEn: true, fulfilmentMode: true },
      },
      refund: { select: { amountVnd: true } },
    },
  },
} satisfies Prisma.ProductOrderSelect;

export type OnlineOrderRow = Prisma.ProductOrderGetPayload<{ select: typeof orderInclude }>;

export async function loadOwnOrder(
  tx: Tx,
  customerUserId: string,
  orderId: string,
): Promise<OnlineOrderRow> {
  const row = await tx.productOrder.findFirst({
    where: { id: orderId, customerUserId, channel: 'ONLINE' },
    select: orderInclude,
  });
  if (!row || !row.onlineDetail) throw new AuthError('NOT_FOUND');
  return row;
}

export async function getOrder(
  context: CustomerContext,
  orderId: string,
): Promise<OnlineOrderResponse> {
  const row = await loadOwnOrder(context.tx, context.customerUserId, orderId);
  return presentOnlineOrder(context.tx, row, context.now);
}

// ---------------------------------------------------------------------------------------- payment

const newOrderCode = (now: Date): number => now.getTime() * 1000 + randomInt(0, 1000);

export type ReservedPayment =
  | { kind: 'READY'; payment: OnlinePaymentResponse }
  | {
      kind: 'CREATE';
      paymentId: string;
      orderCode: number;
      amountVnd: number;
      expiresAt: Date;
      invoiceId: string;
    };

const actorOfCustomer = (context: CustomerContext) =>
  ({ kind: 'USER', userId: context.customerUserId, requestId: context.requestId }) as const;

export function presentPayment(payment: {
  id: string;
  status: OnlinePaymentResponse['status'];
  amountVnd: bigint;
  checkoutUrl: string | null;
  qrCode: string | null;
  expiresAt: Date | null;
}): OnlinePaymentResponse {
  return {
    paymentId: payment.id,
    status: payment.status,
    amountVnd: payment.amountVnd.toString(),
    checkoutUrl: payment.checkoutUrl,
    qrCode: payment.qrCode,
    expiresAt: payment.expiresAt ? payment.expiresAt.toISOString() : null,
  };
}

/**
 * First half of "pay": the member's own unpaid online order, inside its deadline. A live request with its link is returned as it is; a
 * second request is created only when no live one exists (the first expired or was cancelled). The link NEVER outlives the order's
 * deadline (W4-4): the provider expiry is the deadline itself. Money is only ever credited by the settlement core, from an authentic
 * provider fact.
 */
export async function reserveOnlinePayment(
  context: CustomerContext,
  orderId: string,
): Promise<ReservedPayment> {
  const { tx, customerUserId } = context;
  const order = await tx.productOrder.findFirst({
    where: { id: orderId, customerUserId, channel: 'ONLINE' },
    select: {
      invoiceId: true,
      onlineDetail: { select: { deadlineAt: true } },
      invoice: { select: { branchId: true } },
    },
  });
  if (!order?.onlineDetail) throw new AuthError('NOT_FOUND');
  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${order.invoiceId}::uuid FOR UPDATE`;
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: order.invoiceId },
    select: {
      id: true,
      branchId: true,
      visitId: true,
      status: true,
      totalVnd: true,
      paidSeq: true,
    },
  });
  if (invoice.status !== 'PENDING_PAYMENT') throw new AuthError('ONLINE_ORDER_STATE_INVALID');
  const now = await databaseClock(tx);
  if (order.onlineDetail.deadlineAt.getTime() <= now.getTime()) {
    throw new AuthError('ONLINE_ORDER_EXPIRED');
  }
  await expireStalePending(tx, actorOfCustomer(context), invoice, now);
  const live = await tx.payment.findFirst({
    where: { invoiceId: invoice.id, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      amountVnd: true,
      checkoutUrl: true,
      qrCode: true,
      expiresAt: true,
    },
  });
  if (live) {
    if (live.checkoutUrl !== null) return { kind: 'READY', payment: presentPayment(live) };
    throw new AuthError('PAYMENT_PROVIDER_PENDING');
  }
  const [paid] = await tx.$queryRaw<
    { paid: bigint }[]
  >`SELECT lucy_invoice_effective_paid(${invoice.id}::uuid)::bigint AS paid`;
  const balance = invoice.totalVnd - (paid?.paid ?? 0n);
  if (balance <= 0n) throw new AuthError('ONLINE_ORDER_STATE_INVALID');
  const orderCode = newOrderCode(now);
  const expiresAt = order.onlineDetail.deadlineAt;
  const payment = await tx.payment.create({
    data: {
      invoiceId: invoice.id,
      branchId: invoice.branchId,
      method: 'PAYOS',
      status: 'PENDING',
      amountDueVnd: balance,
      amountVnd: balance,
      tenderedVnd: balance,
      changeVnd: 0n,
      collectedByUserId: customerUserId,
      idempotencyKey: randomUUID(),
      providerOrderCode: BigInt(orderCode),
      expiresAt,
    },
    select: { id: true, collectedAt: true },
  });
  await appendAdminAudit(
    { ...adminContextOf(context), now: payment.collectedAt },
    {
      action: 'PAYMENT_PROVIDER_REQUESTED',
      entityType: 'Invoice',
      entityId: invoice.id,
      subjectUserId: customerUserId,
      branchId: invoice.branchId,
      classification: 'FINANCIAL',
      before: { status: invoice.status },
      after: {
        paymentId: payment.id,
        method: 'PAYOS',
        orderCode: String(orderCode),
        amountVnd: balance.toString(),
        expiresAt: expiresAt.toISOString(),
        channel: 'ONLINE',
      },
    },
  );
  return {
    kind: 'CREATE',
    paymentId: payment.id,
    orderCode,
    amountVnd: Number(balance),
    expiresAt,
    invoiceId: invoice.id,
  };
}

export type OnlineProviderOutcome =
  | { kind: 'CREATED'; paymentLinkId: string; checkoutUrl: string; qrCode: string }
  | { kind: 'REJECTED'; providerCode: string | null }
  | { kind: 'UNREACHABLE' };

/** Second half: what PayOS answered. A created request gets its link (once); a refusal ends the request; an unreachable provider leaves it for the sweep. */
export async function completeOnlinePayment(
  context: CustomerContext,
  invoiceId: string,
  paymentId: string,
  outcome: OnlineProviderOutcome,
): Promise<{ payment: OnlinePaymentResponse; failure: 'REJECTED' | 'UNREACHABLE' | null }> {
  const { tx, customerUserId } = context;
  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`;
  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId, payerUserId: customerUserId, channel: 'ONLINE' },
    select: {
      id: true,
      branchId: true,
      visitId: true,
      status: true,
      totalVnd: true,
      paidSeq: true,
    },
  });
  if (!invoice) throw new AuthError('NOT_FOUND');
  const payment = await tx.payment.findFirst({
    where: { id: paymentId, invoiceId },
    select: {
      id: true,
      status: true,
      amountVnd: true,
      providerOrderCode: true,
      checkoutUrl: true,
      qrCode: true,
      expiresAt: true,
    },
  });
  if (!payment) throw new AuthError('NOT_FOUND');
  const attempt = (
    kind: 'CREATE',
    result: 'OK' | 'UNREACHABLE' | 'REJECTED',
    code?: string | null,
  ) =>
    tx.paymentAttempt.create({
      data: {
        paymentId,
        kind,
        outcome: result,
        providerCode: code ?? null,
        actorUserId: customerUserId,
      },
      select: { id: true },
    });
  if (outcome.kind === 'CREATED') {
    await attempt('CREATE', 'OK');
    if (payment.status === 'PENDING' && payment.checkoutUrl === null) {
      const saved = await tx.payment.update({
        where: { id: paymentId },
        data: {
          providerPaymentLinkId: outcome.paymentLinkId,
          checkoutUrl: outcome.checkoutUrl,
          qrCode: outcome.qrCode,
          rowVersion: { increment: 1 },
        },
        select: {
          id: true,
          status: true,
          amountVnd: true,
          checkoutUrl: true,
          qrCode: true,
          expiresAt: true,
        },
      });
      return { payment: presentPayment(saved), failure: null };
    }
    return { payment: presentPayment(payment), failure: null };
  }
  if (outcome.kind === 'UNREACHABLE') {
    await attempt('CREATE', 'UNREACHABLE');
    return { payment: presentPayment(payment), failure: 'UNREACHABLE' };
  }
  await attempt('CREATE', 'REJECTED', outcome.providerCode);
  if (payment.status === 'PENDING') {
    await endPendingPayment(
      tx,
      actorOfCustomer(context),
      invoice,
      { id: paymentId, amountVnd: payment.amountVnd, providerOrderCode: payment.providerOrderCode },
      'FAILED',
    );
  }
  const after = await tx.payment.findUniqueOrThrow({
    where: { id: paymentId },
    select: {
      id: true,
      status: true,
      amountVnd: true,
      checkoutUrl: true,
      qrCode: true,
      expiresAt: true,
    },
  });
  return { payment: presentPayment(after), failure: 'REJECTED' };
}

// ------------------------------------------------------------------------------------------ cancel

/**
 * The member cancels an UNPAID order. A live PayOS request must be cancelled at the provider first (the service does that between two
 * transactions); this is the transaction that ends the order. Answers whether it was cancelled.
 */
export async function cancelOwnUnpaidOrder(
  context: CustomerContext,
  orderId: string,
): Promise<OnlineCancelOutcome> {
  const order = await context.tx.productOrder.findFirst({
    where: { id: orderId, customerUserId: context.customerUserId, channel: 'ONLINE' },
    select: { invoiceId: true },
  });
  if (!order) throw new AuthError('NOT_FOUND');
  return cancelUnpaidOnlineInvoice(context.tx, order.invoiceId, {
    kind: 'CUSTOMER',
    userId: context.customerUserId,
    requestId: context.requestId,
  });
}

/** The pending provider requests of an own online order (order codes), for the service to cancel at the provider. */
export async function pendingProviderRequests(
  context: CustomerContext,
  orderId: string,
): Promise<{ paymentId: string; orderCode: bigint }[]> {
  const order = await context.tx.productOrder.findFirst({
    where: { id: orderId, customerUserId: context.customerUserId, channel: 'ONLINE' },
    select: { invoiceId: true },
  });
  if (!order) throw new AuthError('NOT_FOUND');
  const rows = await context.tx.payment.findMany({
    where: { invoiceId: order.invoiceId, status: 'PENDING', providerOrderCode: { not: null } },
    select: { id: true, providerOrderCode: true },
  });
  return rows.flatMap((row) =>
    row.providerOrderCode === null ? [] : [{ paymentId: row.id, orderCode: row.providerOrderCode }],
  );
}
