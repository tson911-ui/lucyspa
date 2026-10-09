import type { OnlineOrderResponse } from '@lucy-spa/contracts';

/**
 * What the shipment block of a customer's online order shows (Phase 6 P6-20): nothing more than the order carries. The cost the shop
 * paid the carrier is not part of the customer's order, so it can never appear here. Money is compared as BigInt (the string "0" means
 * nothing was refunded).
 */
export interface FulfilmentView {
  /** The parcel left: carrier, tracking code and link, shipping date. */
  shipped: boolean;
  delivered: boolean;
  /** The customer may press "Tôi đã nhận hàng". */
  canConfirm: boolean;
  /** The last delivery attempt failed and the shop will get in touch. */
  failed: boolean;
  /** The money given back so far, or null when none. */
  refundedVnd: string | null;
  /** The two windows to return the goods, counted from the delivery, or null before it. */
  windows: NonNullable<OnlineOrderResponse['returnWindows']> | null;
  /** True when at least one of the blocks has something to say. */
  any: boolean;
}

export function fulfilmentView(order: OnlineOrderResponse): FulfilmentView {
  const refunded = /^[0-9]{1,18}$/.test(order.refundedVnd) && BigInt(order.refundedVnd) > 0n;
  const shipped = order.shipment !== null;
  const delivered = order.deliveredAt !== null;
  const failed = order.state === 'DELIVERY_FAILED';
  const windows = delivered ? order.returnWindows : null;
  return {
    shipped,
    delivered,
    canConfirm: order.can.confirmReceived,
    failed,
    refundedVnd: refunded ? order.refundedVnd : null,
    windows,
    any: shipped || delivered || failed || refunded,
  };
}
