import type { ProductOrderCancelCauseName, ProductOrderLineStatusName } from './product-order.js';

/**
 * Phase 6 Wave 4 (P6-19 to P6-21): the online order (design 2.36-2.38; T38-T42, OQ-89 to OQ-103; the Owner's words of 2026-10-09).
 *
 * A member (never a guest) fills a cart, enters a delivery address and pays the whole amount with PayOS. The shop ships from the one
 * fulfilment branch, nationwide; delivery is free for every online order (the fee a customer sees and pays is always 0 while the
 * fee setting is off); there is no cash on delivery. An order that is not paid within the deadline (30 minutes) is cancelled by the
 * system. The master switch "Bán online" is OFF until the Owner turns it on.
 */

/** The 34 provincial-level units after the reorganisation of 2025 (Resolution 202/2025/QH15): 28 provinces and 6 cities. */
export const VIETNAM_PROVINCES = [
  { code: 'HA_NOI', nameVi: 'Hà Nội', nameEn: 'Hanoi' },
  { code: 'HAI_PHONG', nameVi: 'Hải Phòng', nameEn: 'Hai Phong' },
  { code: 'DA_NANG', nameVi: 'Đà Nẵng', nameEn: 'Da Nang' },
  { code: 'HO_CHI_MINH', nameVi: 'Thành phố Hồ Chí Minh', nameEn: 'Ho Chi Minh City' },
  { code: 'CAN_THO', nameVi: 'Cần Thơ', nameEn: 'Can Tho' },
  { code: 'HUE', nameVi: 'Huế', nameEn: 'Hue' },
  { code: 'TUYEN_QUANG', nameVi: 'Tuyên Quang', nameEn: 'Tuyen Quang' },
  { code: 'LAO_CAI', nameVi: 'Lào Cai', nameEn: 'Lao Cai' },
  { code: 'THAI_NGUYEN', nameVi: 'Thái Nguyên', nameEn: 'Thai Nguyen' },
  { code: 'PHU_THO', nameVi: 'Phú Thọ', nameEn: 'Phu Tho' },
  { code: 'BAC_NINH', nameVi: 'Bắc Ninh', nameEn: 'Bac Ninh' },
  { code: 'HUNG_YEN', nameVi: 'Hưng Yên', nameEn: 'Hung Yen' },
  { code: 'NINH_BINH', nameVi: 'Ninh Bình', nameEn: 'Ninh Binh' },
  { code: 'QUANG_TRI', nameVi: 'Quảng Trị', nameEn: 'Quang Tri' },
  { code: 'QUANG_NGAI', nameVi: 'Quảng Ngãi', nameEn: 'Quang Ngai' },
  { code: 'GIA_LAI', nameVi: 'Gia Lai', nameEn: 'Gia Lai' },
  { code: 'KHANH_HOA', nameVi: 'Khánh Hòa', nameEn: 'Khanh Hoa' },
  { code: 'DAK_LAK', nameVi: 'Đắk Lắk', nameEn: 'Dak Lak' },
  { code: 'LAM_DONG', nameVi: 'Lâm Đồng', nameEn: 'Lam Dong' },
  { code: 'DONG_NAI', nameVi: 'Đồng Nai', nameEn: 'Dong Nai' },
  { code: 'TAY_NINH', nameVi: 'Tây Ninh', nameEn: 'Tay Ninh' },
  { code: 'VINH_LONG', nameVi: 'Vĩnh Long', nameEn: 'Vinh Long' },
  { code: 'DONG_THAP', nameVi: 'Đồng Tháp', nameEn: 'Dong Thap' },
  { code: 'CA_MAU', nameVi: 'Cà Mau', nameEn: 'Ca Mau' },
  { code: 'AN_GIANG', nameVi: 'An Giang', nameEn: 'An Giang' },
  { code: 'CAO_BANG', nameVi: 'Cao Bằng', nameEn: 'Cao Bang' },
  { code: 'DIEN_BIEN', nameVi: 'Điện Biên', nameEn: 'Dien Bien' },
  { code: 'HA_TINH', nameVi: 'Hà Tĩnh', nameEn: 'Ha Tinh' },
  { code: 'LAI_CHAU', nameVi: 'Lai Châu', nameEn: 'Lai Chau' },
  { code: 'LANG_SON', nameVi: 'Lạng Sơn', nameEn: 'Lang Son' },
  { code: 'NGHE_AN', nameVi: 'Nghệ An', nameEn: 'Nghe An' },
  { code: 'QUANG_NINH', nameVi: 'Quảng Ninh', nameEn: 'Quang Ninh' },
  { code: 'THANH_HOA', nameVi: 'Thanh Hóa', nameEn: 'Thanh Hoa' },
  { code: 'SON_LA', nameVi: 'Sơn La', nameEn: 'Son La' },
] as const;

export type ProvinceCode = (typeof VIETNAM_PROVINCES)[number]['code'];

export function provinceByCode(code: string): (typeof VIETNAM_PROVINCES)[number] | undefined {
  return VIETNAM_PROVINCES.find((province) => province.code === code);
}

export interface OnlinePolicyNumbers {
  unpaidTimeoutMinutes: number;
  shipWithinWorkingDays: number;
  transitDaysMin: number;
  transitDaysMax: number;
}

/**
 * The words a customer reads at the checkout until the Owner writes the text in the admin (OQ-103): a draft built ONLY from the
 * decisions the Owner approved, with the numbers of the settings. Nothing is added that the Owner did not decide.
 */
export function onlinePolicyDefault(locale: 'vi' | 'en', n: OnlinePolicyNumbers): string {
  if (locale === 'vi') {
    return [
      'Miễn phí giao hàng cho mọi đơn mua online, giao toàn quốc.',
      'Bạn thanh toán đủ tiền hàng trước bằng PayOS. Chúng tôi không thu tiền khi giao hàng.',
      `Đơn chưa thanh toán sau ${n.unpaidTimeoutMinutes} phút sẽ tự hủy.`,
      `Hàng có sẵn được gửi trong ${n.shipWithinWorkingDays} ngày làm việc. Thời gian vận chuyển dự kiến ${n.transitDaysMin} đến ${n.transitDaysMax} ngày, đây không phải cam kết.`,
      'Đơn có hàng đặt trước sẽ gửi một lần khi đủ hàng. Ngày có hàng chỉ là dự kiến, không phải cam kết.',
      'Bạn có thể hủy đơn chưa gửi bằng cách liên hệ cửa hàng. Đơn đã gửi không hủy được.',
      'Đổi ý: đổi hoặc trả trong 7 ngày kể từ ngày nhận hàng, hàng còn nguyên niêm phong, bạn tự trả phí gửi hàng về.',
      'Hàng sai hoặc hỏng: báo trong 48 giờ kể từ ngày nhận hàng, kèm ảnh, cửa hàng trả phí gửi hàng về.',
      'Giao hàng không thành công: cửa hàng sẽ liên hệ để giao lại. Nếu bạn không còn muốn nhận, cửa hàng hoàn tiền hàng sau khi trừ phí vận chuyển hai chiều mà cửa hàng đã trả.',
    ].join('\n');
  }
  return [
    'Delivery is free for every online order, nationwide.',
    'You pay the full price of the goods in advance with PayOS. We do not collect cash on delivery.',
    `An order that is not paid within ${n.unpaidTimeoutMinutes} minutes is cancelled automatically.`,
    `Goods in stock are shipped within ${n.shipWithinWorkingDays} working days. Transit is expected to take ${n.transitDaysMin} to ${n.transitDaysMax} days; this is not a promise.`,
    'An order with pre-order goods is shipped once, when all the goods are in. The dates are estimates, not promises.',
    'You can cancel an order that has not been shipped by contacting the shop. A shipped order cannot be cancelled.',
    'Change of mind: exchange or return within 7 days of receiving the goods, seal intact; you pay the shipping back.',
    'Wrong or damaged goods: tell us within 48 hours of receiving them, with photos; the shop pays the shipping back.',
    'Failed delivery: the shop will contact you to deliver again. If you no longer want the order, the shop refunds the price of the goods minus the two-way shipping cost the shop paid.',
  ].join('\n');
}

// ------------------------------------------------------------------------------------------------ settings

export interface OnlineSalesSettingsResponse {
  enabled: boolean;
  fulfilmentBranchId: string | null;
  fulfilmentBranchName: string | null;
  unpaidTimeoutMinutes: number;
  maxUnpaidOrders: number;
  maxCartLines: number;
  maxLineQuantity: number;
  shipWithinWorkingDays: number;
  transitDaysMin: number;
  transitDaysMax: number;
  shippingFeeEnabled: boolean;
  shippingFeeVnd: string;
  freeShippingThresholdVnd: string | null;
  policyVersion: number;
  /** The text the Owner wrote; null while the default draft is in use. */
  policyVi: string | null;
  policyEn: string | null;
  rowVersion: number;
  updatedAt: string;
  /** The branches that may be chosen (active ones), for the admin form. */
  branches: { id: string; name: string }[];
  /** True when the PayOS provider is configured (online checkout needs it). */
  paymentConfigured: boolean;
}

export interface OnlineSalesSettingsUpdateRequest {
  expectedVersion: number;
  enabled?: boolean;
  fulfilmentBranchId?: string | null;
  unpaidTimeoutMinutes?: number;
  maxUnpaidOrders?: number;
  maxCartLines?: number;
  maxLineQuantity?: number;
  shipWithinWorkingDays?: number;
  transitDaysMin?: number;
  transitDaysMax?: number;
  shippingFeeEnabled?: boolean;
  shippingFeeVnd?: string;
  freeShippingThresholdVnd?: string | null;
  /** A new text (either language) makes a new policy version that customers accept again. */
  policyVi?: string | null;
  policyEn?: string | null;
}

/** What the public site and a signed-in customer may know (no secrets, no branch ids of staff meaning). */
export interface OnlineSalesPublicResponse {
  enabled: boolean;
  unpaidTimeoutMinutes: number;
  maxCartLines: number;
  maxLineQuantity: number;
  maxUnpaidOrders: number;
  shipWithinWorkingDays: number;
  transitDaysMin: number;
  transitDaysMax: number;
  /** Always "0" while the fee setting is off (the Owner: free shipping on all online orders). */
  shippingFeeVnd: string;
  freeShipping: boolean;
  policyVersion: number;
  policyVi: string;
  policyEn: string;
  provinces: { code: string; nameVi: string; nameEn: string }[];
}

// -------------------------------------------------------------------------------------------------- cart

export type OnlineCartProblem = 'NOT_SOLD_ONLINE' | 'UNAVAILABLE' | 'OUT_OF_STOCK' | 'OVER_LIMIT';

export interface OnlineCartLineResponse {
  variantId: string;
  productId: string;
  /** The code of the public product page. */
  productCode: string;
  nameVi: string;
  nameEn: string;
  variantLabelVi: string | null;
  variantLabelEn: string | null;
  sku: string;
  imageMediaId: string | null;
  quantity: number;
  /** The price of today; a cart never keeps a price. */
  unitPriceVnd: string;
  listPriceVnd: string;
  onPromotion: boolean;
  lineTotalVnd: string;
  /** How the line would be served now: in stock, or a pre-order of goods the shop does not hold (never a quantity). */
  mode: 'IN_STOCK' | 'PRE_ORDER' | null;
  /** The expected wait of a pre-order, in days from payment. */
  expectedDaysMin: number | null;
  expectedDaysMax: number | null;
  problem: OnlineCartProblem | null;
}

export interface OnlineCartResponse {
  lines: OnlineCartLineResponse[];
  subtotalVnd: string;
  hasPreOrder: boolean;
  /** False while a line has a problem or the cart is empty. */
  checkoutReady: boolean;
  rowVersion: number;
  unpaidOrders: number;
}

export interface OnlineCartSetRequest {
  variantId: string;
  /** 0 removes the line. */
  quantity: number;
}

export interface OnlineCartAddRequest {
  variantId: string;
  quantity: number;
}

// ------------------------------------------------------------------------------------------ addresses

export interface OnlineAddressInput {
  recipientName: string;
  /** Any common Vietnamese format; stored as +84... */
  recipientPhone: string;
  provinceCode: string;
  ward: string;
  street: string;
}

export interface CustomerAddressResponse {
  id: string;
  recipientName: string;
  recipientPhone: string;
  provinceCode: string;
  provinceName: string;
  ward: string;
  street: string;
}

export interface CustomerAddressListResponse {
  addresses: CustomerAddressResponse[];
  /** The member's profile, to fill the first address. */
  profile: { fullName: string; phone: string | null };
}

// ----------------------------------------------------------------------------------------------- order

export interface OnlineCheckoutRequest {
  address: OnlineAddressInput;
  saveAddress?: boolean;
  /** One voucher code at most (OQ-102). */
  voucherCode?: string | null;
  /** The version of the policy text the customer read and accepted (OQ-103); must be the current version. */
  acceptedPolicyVersion: number;
  /** A fresh UUID per attempt: repeating it returns the same order. */
  clientRequestId: string;
}

export interface OnlinePaymentResponse {
  paymentId: string;
  status: 'PENDING' | 'SUCCEEDED' | 'EXPIRED' | 'CANCELLED' | 'FAILED';
  amountVnd: string;
  checkoutUrl: string | null;
  qrCode: string | null;
  expiresAt: string | null;
}

export type OnlineOrderState =
  | 'AWAITING_PAYMENT'
  | 'PAID'
  | 'READY_TO_SHIP'
  | 'WAITING_GOODS'
  | 'SHIPPED'
  | 'DELIVERY_FAILED'
  | 'COMPLETED'
  | 'CANCELLED';

export interface OnlineOrderLineResponse {
  id: string;
  sequence: number;
  variantId: string;
  nameVi: string;
  nameEn: string;
  variantLabelVi: string | null;
  variantLabelEn: string | null;
  quantity: number;
  unitPriceVnd: string;
  lineTotalVnd: string;
  mode: 'IN_STOCK' | 'PRE_ORDER';
  status: ProductOrderLineStatusName;
  expectedFrom: string | null;
  expectedTo: string | null;
  cancelCause: ProductOrderCancelCauseName | null;
  /** The refund of a cancelled line, when one was made (amounts only; never a reason text). */
  refundedVnd: string | null;
}

export interface OnlineOrderShipmentResponse {
  carrierName: string;
  trackingCode: string;
  /** A tracking link when the carrier has a template (the shop enters the carriers, OQ-95). */
  trackingUrl: string | null;
  shippedAt: string;
}

export interface OnlineOrderEventResponse {
  at: string;
  kind: string;
}

/** What the signed-in customer sees of an online order. The cost the shop paid the carrier is never part of it. */
export interface OnlineOrderResponse {
  id: string;
  code: string;
  invoiceId: string;
  invoiceCode: string;
  state: OnlineOrderState;
  placedAt: string;
  deadlineAt: string | null;
  paidAt: string | null;
  subtotalVnd: string;
  discountVnd: string;
  shippingFeeVnd: string;
  totalVnd: string;
  recipient: {
    name: string;
    phone: string;
    provinceName: string;
    ward: string;
    street: string;
  };
  lines: OnlineOrderLineResponse[];
  /** True when at least one line is a pre-order: the order is shipped once, when all the goods are in (OQ-90). */
  hasPreOrder: boolean;
  shipment: OnlineOrderShipmentResponse | null;
  deliveredAt: string | null;
  /** The money given back for this order so far (cancelled lines, a failed delivery, returns). */
  refundedVnd: string;
  /** The end of the windows to return the goods, counted from the delivery (OQ-40); null until delivered. */
  returnWindows: { personalPreferenceUntil: string; wrongOrDamagedUntil: string } | null;
  payment: OnlinePaymentResponse | null;
  can: { pay: boolean; cancel: boolean; confirmReceived: boolean };
  policyVersion: number;
}

export interface OnlineOrderListItem {
  id: string;
  code: string;
  state: OnlineOrderState;
  placedAt: string;
  totalVnd: string;
  lineCount: number;
  firstLineNameVi: string;
  firstLineNameEn: string;
}

export interface OnlineOrderListResponse {
  orders: OnlineOrderListItem[];
  nextCursor: string | null;
}

export interface OnlineOrderCancelRequest {
  /** The row version of the invoice as the customer saw it. */
  expectedVersion: number;
}

/** Whether the customer may pay: the money the order still waits for, while time is left. */
export function onlineOrderState(input: {
  invoiceStatus: 'DRAFT' | 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED';
  lines: readonly { status: ProductOrderLineStatusName; mode: 'IN_STOCK' | 'PRE_ORDER' }[];
  deliveryFailed: boolean;
}): OnlineOrderState {
  if (input.invoiceStatus === 'CANCELLED') return 'CANCELLED';
  if (input.invoiceStatus !== 'PAID') return 'AWAITING_PAYMENT';
  const live = input.lines.filter((line) => line.status !== 'CANCELLED');
  if (live.length === 0) return 'CANCELLED';
  if (live.every((line) => line.status === 'COMPLETED')) return 'COMPLETED';
  if (live.some((line) => line.status === 'SHIPPED')) {
    return input.deliveryFailed ? 'DELIVERY_FAILED' : 'SHIPPED';
  }
  if (
    live.some(
      (line) => line.status === 'ORDERED' || (line.mode === 'PRE_ORDER' && line.status === 'PAID'),
    )
  ) {
    return 'WAITING_GOODS';
  }
  if (
    live.every(
      (line) => line.status === 'ARRIVED' || (line.mode === 'IN_STOCK' && line.status === 'PAID'),
    )
  ) {
    return 'READY_TO_SHIP';
  }
  return 'PAID';
}
