import type {
  OnlineOrderLineResponse,
  OnlineOrderState,
  OnlinePaymentResponse,
} from './online-order.js';
import type { ProductOrderCancelCauseName } from './product-order.js';

/**
 * Phase 6 Wave 4 (P6-20 and P6-21): what the people who pack, ship and settle online orders see and do (design 2.38; T39, OQ-90, OQ-94 to
 * OQ-98). Packing and shipping need `MANAGE_PRODUCT_ORDERS`; the cost the shop paid the carrier, the settlement of a failed delivery and
 * the refund need `REFUND_PRODUCTS` at the order's branch (the carrier cost is an internal figure: the customer never sees it and a person
 * who only packs does not either). The carriers are kept by `MANAGE_PRODUCTS`.
 */
export const ONLINE_QUEUE_PAGE_SIZE = 20;

export type OnlineQueueTab =
  'TO_SHIP' | 'WAITING_GOODS' | 'SHIPPED' | 'DELIVERY_FAILED' | 'DONE' | 'CANCELLED';

export const ONLINE_QUEUE_TABS: readonly OnlineQueueTab[] = [
  'TO_SHIP',
  'WAITING_GOODS',
  'SHIPPED',
  'DELIVERY_FAILED',
  'DONE',
  'CANCELLED',
];

export type OnlineLogKind =
  | 'DELIVERY_FAILED'
  | 'CONTACTED'
  | 'REDELIVERY'
  | 'RETURN_STARTED'
  | 'RETURNED_TO_SHOP'
  | 'DELIVERED'
  | 'NOTE';

export type OnlineFailReason =
  'CUSTOMER_UNREACHABLE' | 'CUSTOMER_AWAY' | 'WRONG_ADDRESS' | 'REFUSED' | 'OTHER';

export const ONLINE_FAIL_REASONS: readonly OnlineFailReason[] = [
  'CUSTOMER_UNREACHABLE',
  'CUSTOMER_AWAY',
  'WRONG_ADDRESS',
  'REFUSED',
  'OTHER',
];

// ---------------------------------------------------------------------------------------------- carriers

export interface ShippingCarrierResponse {
  id: string;
  name: string;
  /** An https link with one {code} place, or null. */
  trackingUrlTemplate: string | null;
  isActive: boolean;
  rowVersion: number;
}

export interface ShippingCarrierListResponse {
  carriers: ShippingCarrierResponse[];
}

export interface ShippingCarrierCreateRequest {
  name: string;
  trackingUrlTemplate?: string | null;
}

export interface ShippingCarrierEditRequest {
  expectedRowVersion: number;
  name?: string;
  trackingUrlTemplate?: string | null;
  isActive?: boolean;
}

/** The tracking link of a code, or null when the carrier has no template. The code is encoded; nothing else is added. */
export function trackingUrl(template: string | null, code: string): string | null {
  return template === null ? null : template.replace('{code}', encodeURIComponent(code));
}

// ------------------------------------------------------------------------------------------------ queue

export interface OnlineQueueRow {
  orderId: string;
  code: string;
  invoiceCode: string;
  state: OnlineOrderState;
  placedAt: string;
  paidAt: string | null;
  /** The name typed for the delivery; the phone is masked in a list. */
  recipientName: string;
  recipientPhoneMasked: string;
  provinceName: string;
  lineCount: number;
  quantity: number;
  totalVnd: string;
  hasPreOrder: boolean;
  /** When every line was ready to pack (the latest paid or arrived time). */
  readyAt: string | null;
  shippedAt: string | null;
  carrierName: string | null;
  trackingCode: string | null;
  /** Ready to pack but not shipped within the promised working days (OQ-94). */
  late: boolean;
  /** Shipped more than 7 days ago with no delivery date (OQ-96). */
  overdueDelivery: boolean;
}

export interface OnlineQueueResponse {
  tab: OnlineQueueTab;
  rows: OnlineQueueRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<OnlineQueueTab, number>;
}

export interface OnlineContextResponse {
  branches: { id: string; code: string; name: string; work: boolean; refund: boolean }[];
}

// ------------------------------------------------------------------------------------------------ order

export interface OnlineStaffLine extends OnlineOrderLineResponse {
  /** For the conflict check of a command that moves the lines. */
  rowVersion: number;
  sku: string;
  /** Ready to pack: an in-stock line that is paid, or a pre-order line whose goods arrived. */
  ready: boolean;
  /** The causes this line may be cancelled with now (OQ-32, OQ-97); empty unless the person may refund. */
  cancelCauses: ProductOrderCancelCauseName[];
  /** The whole net share a cancellation of this line gives back. */
  refundShareVnd: string;
}

export interface OnlineLogEntry {
  id: string;
  kind: OnlineLogKind;
  reasonCode: OnlineFailReason | null;
  note: string | null;
  actorKind: 'STAFF' | 'CUSTOMER' | 'SYSTEM';
  actorName: string | null;
  occurredAt: string;
}

export interface OnlineShipmentStaff {
  id: string;
  carrierId: string;
  carrierName: string;
  trackingCode: string;
  trackingUrl: string | null;
  shippedAt: string;
  shippedByName: string;
  /** The cost the shop paid for the way there; only for the people who may refund, null for everyone else. */
  carrierFeeOutVnd: string | null;
  corrections: {
    trackingCode: string;
    carrierFeeOutVnd: string | null;
    reason: string;
    actorName: string;
    occurredAt: string;
  }[];
}

export interface OnlineSettlementStaff {
  goodsPaidVnd: string;
  carrierFeeOutVnd: string;
  carrierFeeBackVnd: string;
  refundVnd: string;
  reason: string;
  settledByName: string;
  settledAt: string;
  returnedToStock: 'SELLABLE' | 'NOT_SELLABLE';
}

export interface OnlineStaffOrderResponse {
  id: string;
  code: string;
  invoiceId: string;
  invoiceCode: string;
  branchId: string;
  state: OnlineOrderState;
  placedAt: string;
  paidAt: string | null;
  deadlineAt: string | null;
  subtotalVnd: string;
  discountVnd: string;
  shippingFeeVnd: string;
  totalVnd: string;
  /** In full for those who pack or refund (the order is theirs to deliver); the address as last corrected. */
  recipient: {
    name: string;
    phone: string;
    provinceCode: string;
    provinceName: string;
    ward: string;
    street: string;
    corrected: boolean;
  };
  customer: { id: string; displayName: string } | null;
  lines: OnlineStaffLine[];
  hasPreOrder: boolean;
  shipment: OnlineShipmentStaff | null;
  deliveredAt: string | null;
  deliveredBy: 'STAFF' | 'CUSTOMER' | null;
  logs: OnlineLogEntry[];
  payment: OnlinePaymentResponse | null;
  settlement: OnlineSettlementStaff | null;
  /** True while the last entry of the delivery is a failed attempt. */
  deliveryFailed: boolean;
  /** The customer said they no longer want the parcel (the log says "RETURN_STARTED"). */
  returnStarted: boolean;
  returnedToShop: boolean;
  /** The return cases opened on this order after its delivery (OQ-100); the cost of the way back only for those who may refund. */
  returns: OnlineStaffReturnCase[];
  policyVersion: number;
  /** The active carriers to choose from when shipping (only for a person who may ship). */
  carriers: { id: string; name: string }[];
  can: {
    ship: boolean;
    markDelivered: boolean;
    log: boolean;
    correctShipment: boolean;
    correctAddress: boolean;
    markReturned: boolean;
    refund: boolean;
    settleFailedDelivery: boolean;
    recordReturnCost: boolean;
  };
}

export interface OnlineStaffReturnCase {
  id: string;
  code: string;
  status: 'OPEN' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED';
  reason: 'PERSONAL_PREFERENCE' | 'WRONG_OR_DAMAGED' | 'SKIN_IRRITATION';
  quantity: number;
  /** What the shop paid for the goods to come back (recorded entries added up); null for a person who may not refund. */
  returnCostVnd: string | null;
}

// ---------------------------------------------------------------------------------------------- commands

export interface OnlineLineVersion {
  id: string;
  rowVersion: number;
}

export interface OnlineShipRequest {
  /** Every line of the order that is not cancelled, as the person saw it: any difference is a conflict. */
  lines: OnlineLineVersion[];
  carrierId: string;
  trackingCode: string;
  /** The cost the shop pays the carrier for the way there, whole VND as a string (0 allowed); internal. */
  carrierFeeVnd: string;
}

export interface OnlineShipmentCorrectRequest {
  /** Absent = unchanged. */
  trackingCode?: string;
  carrierFeeVnd?: string;
  reason: string;
}

export interface OnlineDeliveredRequest {
  /** The calendar day the carrier delivered (the branch's day), not in the future; absent = now. */
  deliveredOn?: string | null;
}

export interface OnlineLogRequest {
  kind: Exclude<OnlineLogKind, 'RETURNED_TO_SHOP' | 'DELIVERED'>;
  reasonCode?: OnlineFailReason | null;
  note?: string | null;
}

export interface OnlineReturnedRequest {
  note: string;
}

export interface OnlineAddressCorrectRequest {
  recipientName: string;
  recipientPhone: string;
  provinceCode: string;
  ward: string;
  street: string;
  reason: string;
}

export interface OnlineSettleRequest {
  /** Every line of the order that is not cancelled, as the person saw it: any difference is a conflict. */
  lines: OnlineLineVersion[];
  /** The cost the shop pays the carrier for the way back, whole VND as a string (0 allowed). */
  carrierFeeBackVnd: string;
  reason: string;
  /** Whether the goods that came back can be sold again (only when a refund exists to name the new lot after). */
  restock: 'SELLABLE' | 'NOT_SELLABLE';
  /** Required when a refund is made. */
  method?: 'CASH' | 'BANK_TRANSFER_MANUAL';
  bankReference?: string | null;
  clientRequestId: string;
}

export interface OnlineReturnCostRequest {
  /** What the shop paid for the goods to come back, whole VND as a string. */
  costVnd: string;
  note?: string | null;
}

/** Whole VND of the refund of a failed delivery: the goods paid minus both ways of the carrier, never below 0 (OQ-98). */
export function failedDeliveryRefund(
  goodsPaidVnd: bigint,
  carrierFeeOutVnd: bigint,
  carrierFeeBackVnd: bigint,
): bigint {
  const left = goodsPaidVnd - carrierFeeOutVnd - carrierFeeBackVnd;
  return left < 0n ? 0n : left;
}
