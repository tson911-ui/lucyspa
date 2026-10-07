import type { LeaveType } from './index.js';

/**
 * Code-owned notification type metadata (single source shared by API, worker and web).
 * A notification's category, severity, entity, i18n key and destination are looked up by its
 * `type`; none of them is stored per row, so they can never drift from the type. Constant
 * data only: no runtime dependency, no delivery or routing logic.
 */
export const NOTIFICATION_ENTITY_TYPES = [
  'Booking',
  'Visit',
  'LeaveRequest',
  'Invoice',
  'Branch',
  'ProductVariant',
] as const;
export type NotificationEntityType = (typeof NOTIFICATION_ENTITY_TYPES)[number];

export const NOTIFICATION_CATEGORIES = ['OPERATIONS', 'HR', 'FINANCE'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export function isNotificationCategory(value: unknown): value is NotificationCategory {
  return (NOTIFICATION_CATEGORIES as readonly unknown[]).includes(value);
}
export type NotificationSeverity = 'INFO' | 'ATTENTION' | 'WARNING';
/** Which allowlisted screen an item opens; the destination API still enforces authority. */
export type NotificationTargetKind =
  'BOOKING' | 'VISIT' | 'LEAVE_REQUEST' | 'INVOICE' | 'BRANCH' | 'PRODUCT_VARIANT';
/** Shape of the structured `params` a type carries. Never free text. */
export type NotificationParamsKind =
  | 'NONE'
  | 'LEAVE_REQUESTED'
  | 'LEAVE_DECIDED'
  | 'INVOICE_AMOUNT'
  | 'PAYOS_ANOMALY'
  | 'PAYMENT_REVERSED'
  | 'INVOICE_CANCELLED_ALERT'
  | 'REVENUE_SUMMARY'
  | 'LOW_STOCK'
  | 'EXPIRY_ALERT';

export interface NotificationTypeMetadata {
  readonly category: NotificationCategory;
  readonly severity: NotificationSeverity;
  /**
   * The source entities this type may reference. Phase 3 types can originate from a Booking or
   * a Visit (for example a reassignment on a walk-in), so they allow both; the row's
   * `entityType` says which one applies. Leave types reference the LeaveRequest only.
   */
  readonly entityTypes: readonly NotificationEntityType[];
  /** Key under `types` in the notification dictionaries (VI/EN). */
  readonly i18nKey: string;
  readonly params: NotificationParamsKind;
}

/** Destination screen by source entity; the destination API still enforces authority. */
export const NOTIFICATION_TARGET_BY_ENTITY = {
  Booking: 'BOOKING',
  Visit: 'VISIT',
  LeaveRequest: 'LEAVE_REQUEST',
  Invoice: 'INVOICE',
  Branch: 'BRANCH',
  ProductVariant: 'PRODUCT_VARIANT',
} as const satisfies Record<NotificationEntityType, NotificationTargetKind>;

const operations = (severity: NotificationSeverity, i18nKey: string): NotificationTypeMetadata => ({
  category: 'OPERATIONS',
  severity,
  entityTypes: ['Booking', 'Visit'],
  i18nKey,
  params: 'NONE',
});
const leave = (
  severity: NotificationSeverity,
  i18nKey: string,
  params: NotificationParamsKind,
): NotificationTypeMetadata => ({
  category: 'HR',
  severity,
  entityTypes: ['LeaveRequest'],
  i18nKey,
  params,
});

const finance = (
  severity: NotificationSeverity,
  i18nKey: string,
  params: NotificationParamsKind,
  entity: 'Invoice' | 'Branch' = 'Invoice',
): NotificationTypeMetadata => ({
  category: 'FINANCE',
  severity,
  entityTypes: [entity],
  i18nKey,
  params,
});

// Phase 6 P6-4 (design 4.6, P6-T16): in-app stock alerts for the holders of VIEW_INVENTORY at the branch. A low-stock alert is
// about one variant (the row also carries the branch); the daily expiry alert is about the branch.
const inventory = (
  severity: NotificationSeverity,
  i18nKey: string,
  params: NotificationParamsKind,
  entity: 'ProductVariant' | 'Branch',
): NotificationTypeMetadata => ({
  category: 'OPERATIONS',
  severity,
  entityTypes: [entity],
  i18nKey,
  params,
});

/**
 * Phase 3 types keep their existing behavior; only metadata is declared for them here.
 * Leave types are added for the Leave notification work.
 */
export const NOTIFICATION_TYPE_REGISTRY = {
  BOOKING_CREATED: operations('INFO', 'BOOKING_CREATED'),
  BOOKING_CANCELLED: operations('INFO', 'BOOKING_CANCELLED'),
  LATE_CANCELLATION: operations('ATTENTION', 'LATE_CANCELLATION'),
  BOOKING_NO_SHOW: operations('INFO', 'BOOKING_NO_SHOW'),
  CUSTOMER_ARRIVED: operations('INFO', 'CUSTOMER_ARRIVED'),
  BOOKING_KTV_CONFLICT: operations('ATTENTION', 'BOOKING_KTV_CONFLICT'),
  KTV_REASSIGNED: operations('ATTENTION', 'KTV_REASSIGNED'),
  START_OVERDUE: operations('WARNING', 'START_OVERDUE'),
  PRE_END: operations('ATTENTION', 'PRE_END'),
  END_OVERDUE: operations('WARNING', 'END_OVERDUE'),
  LEAVE_REQUESTED: leave('ATTENTION', 'LEAVE_REQUESTED', 'LEAVE_REQUESTED'),
  LEAVE_DECIDED: leave('INFO', 'LEAVE_DECIDED', 'LEAVE_DECIDED'),
  // Phase 4 Step 10 (Owner answers Q8). Payer (customer): the first two. Request creator: the next two.
  // Management (CORRECT_PAYMENTS holders): the anomaly, the reversal and the cancellation alert.
  // Revenue summary (VIEW_REVENUE holders): the last one, the only type that carries totals.
  INVOICE_PAID: finance('INFO', 'INVOICE_PAID', 'INVOICE_AMOUNT'),
  INVOICE_CANCELLED: finance('INFO', 'INVOICE_CANCELLED', 'NONE'),
  PAYOS_PAYMENT_SUCCEEDED: finance('INFO', 'PAYOS_PAYMENT_SUCCEEDED', 'INVOICE_AMOUNT'),
  PAYOS_PAYMENT_ANOMALY: finance('WARNING', 'PAYOS_PAYMENT_ANOMALY', 'PAYOS_ANOMALY'),
  PAYMENT_REVERSED: finance('ATTENTION', 'PAYMENT_REVERSED', 'PAYMENT_REVERSED'),
  INVOICE_CANCELLED_ALERT: finance(
    'ATTENTION',
    'INVOICE_CANCELLED_ALERT',
    'INVOICE_CANCELLED_ALERT',
  ),
  REVENUE_DAILY_SUMMARY: finance('INFO', 'REVENUE_DAILY_SUMMARY', 'REVENUE_SUMMARY', 'Branch'),
  // Phase 6 P6-4: stock alerts (VIEW_INVENTORY holders at the branch).
  LOW_STOCK_REACHED: inventory('ATTENTION', 'LOW_STOCK_REACHED', 'LOW_STOCK', 'ProductVariant'),
  EXPIRY_ALERT: inventory('ATTENTION', 'EXPIRY_ALERT', 'EXPIRY_ALERT', 'Branch'),
} as const satisfies Record<string, NotificationTypeMetadata>;

export type NotificationType = keyof typeof NOTIFICATION_TYPE_REGISTRY;

export const NOTIFICATION_TYPES = Object.freeze(
  Object.keys(NOTIFICATION_TYPE_REGISTRY),
) as readonly NotificationType[];

export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === 'string' && Object.hasOwn(NOTIFICATION_TYPE_REGISTRY, value);
}

export function notificationMetadata(type: NotificationType): NotificationTypeMetadata {
  return NOTIFICATION_TYPE_REGISTRY[type];
}

/** The types of one category, for `type IN (...)` filtering (no category column exists). */
export function notificationTypesInCategory(
  category: NotificationCategory,
): readonly NotificationType[] {
  return NOTIFICATION_TYPES.filter(
    (type) => NOTIFICATION_TYPE_REGISTRY[type].category === category,
  );
}

const LEAVE_TYPES = ['ANNUAL', 'SICK', 'PERSONAL', 'FAMILY_EVENT', 'MATERNITY', 'OTHER'] as const;
// Compile-time guard: the params allowlist can never disagree with the public LeaveType.
const _leaveTypesMatch: readonly LeaveType[] = LEAVE_TYPES;
void _leaveTypesMatch;
export interface LeaveRequestedParams {
  /** The employee the request is about (an account id, never a name). */
  subjectUserId: string;
  startDate: string;
  endDate: string;
  leaveType: (typeof LEAVE_TYPES)[number];
}
export interface LeaveDecidedParams {
  decision: 'APPROVED' | 'REJECTED';
  startDate: string;
  endDate: string;
  leaveType: (typeof LEAVE_TYPES)[number];
}
/** Money is integer VND carried as a decimal string (BigInt-safe on the wire, like the financial events). */
export interface InvoiceAmountParams {
  amountVnd: string;
}
export interface PayosAnomalyParams {
  anomaly: 'AMOUNT_MISMATCH' | 'INVOICE_NOT_PAYABLE' | 'EXCEEDS_BALANCE';
  expectedAmountVnd: string | null;
  receivedAmountVnd: string;
}
export interface PaymentReversedParams {
  method: 'CASH' | 'PAYOS';
  amountVnd: string;
}
export interface InvoiceCancelledAlertParams {
  cancelledFrom: 'PENDING_PAYMENT' | 'PAID';
  amountVnd: string;
}
/** The only params that carry revenue totals; delivered to VIEW_REVENUE holders only (Q8 item 6). */
export interface RevenueSummaryParams {
  businessDate: string;
  totalVnd: string;
  cashVnd: string;
  payosVnd: string;
  paidInvoiceCount: number;
  pendingPaymentCount: number;
}
/** A variant reached its low-stock threshold (the SKU is the notification's context code). */
export interface LowStockParams {
  onHand: number;
  threshold: number;
}
/** The daily expiry scan of a branch: lots with stock that expired, and lots that expire within `withinDays`. */
export interface ExpiryAlertParams {
  withinDays: number;
  expiredLots: number;
  expiringLots: number;
}
export type NotificationParams =
  | LowStockParams
  | ExpiryAlertParams
  | LeaveRequestedParams
  | LeaveDecidedParams
  | InvoiceAmountParams
  | PayosAnomalyParams
  | PaymentReversedParams
  | InvoiceCancelledAlertParams
  | RevenueSummaryParams;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const VND = /^(0|[1-9]\d{0,14})$/;

const oneOf = <T extends string>(name: string, value: unknown, allowed: readonly T[]): T => {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`Notification param ${name} is not an allowed value.`);
  }
  return value as T;
};
const vnd = (name: string, value: unknown): string => {
  if (typeof value !== 'string' || !VND.test(value)) {
    throw new Error(`Notification param ${name} must be integer VND.`);
  }
  return value;
};
const count = (name: string, value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Notification param ${name} must be a non-negative integer.`);
  }
  return value;
};
const exactKeys = (type: string, record: Record<string, unknown>, expected: readonly string[]) => {
  if (Object.keys(record).sort().join() !== [...expected].sort().join()) {
    throw new Error(`Notification params for ${type} must have exactly: ${expected.join(', ')}.`);
  }
};

/**
 * Strict allowlist validator for `params`: exactly the declared keys, and only ids, dates, enums, integer
 * VND strings and counts, so a notification can never carry free-form or sensitive text (no reason, no
 * name). Returns the normalized object, `null` for a type without params, and throws on anything else.
 */
export function parseNotificationParams(
  type: NotificationType,
  value: unknown,
): NotificationParams | null {
  const kind = NOTIFICATION_TYPE_REGISTRY[type].params;
  if (kind === 'NONE') {
    if (value === null || value === undefined) return null;
    throw new Error(`Notification type ${type} carries no params.`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Notification type ${type} requires structured params.`);
  }
  const record = value as Record<string, unknown>;
  switch (kind) {
    case 'INVOICE_AMOUNT':
      exactKeys(type, record, ['amountVnd']);
      return { amountVnd: vnd('amountVnd', record['amountVnd']) };
    case 'PAYOS_ANOMALY':
      exactKeys(type, record, ['anomaly', 'expectedAmountVnd', 'receivedAmountVnd']);
      return {
        anomaly: oneOf('anomaly', record['anomaly'], [
          'AMOUNT_MISMATCH',
          'INVOICE_NOT_PAYABLE',
          'EXCEEDS_BALANCE',
        ]),
        expectedAmountVnd:
          record['expectedAmountVnd'] === null
            ? null
            : vnd('expectedAmountVnd', record['expectedAmountVnd']),
        receivedAmountVnd: vnd('receivedAmountVnd', record['receivedAmountVnd']),
      };
    case 'PAYMENT_REVERSED':
      exactKeys(type, record, ['method', 'amountVnd']);
      return {
        method: oneOf('method', record['method'], ['CASH', 'PAYOS']),
        amountVnd: vnd('amountVnd', record['amountVnd']),
      };
    case 'INVOICE_CANCELLED_ALERT':
      exactKeys(type, record, ['cancelledFrom', 'amountVnd']);
      return {
        cancelledFrom: oneOf('cancelledFrom', record['cancelledFrom'], ['PENDING_PAYMENT', 'PAID']),
        amountVnd: vnd('amountVnd', record['amountVnd']),
      };
    case 'LOW_STOCK':
      exactKeys(type, record, ['onHand', 'threshold']);
      return {
        onHand: count('onHand', record['onHand']),
        threshold: count('threshold', record['threshold']),
      };
    case 'EXPIRY_ALERT': {
      exactKeys(type, record, ['withinDays', 'expiredLots', 'expiringLots']);
      const withinDays = count('withinDays', record['withinDays']);
      if (withinDays < 1) throw new Error('Notification param withinDays must be at least 1.');
      return {
        withinDays,
        expiredLots: count('expiredLots', record['expiredLots']),
        expiringLots: count('expiringLots', record['expiringLots']),
      };
    }
    case 'REVENUE_SUMMARY': {
      exactKeys(type, record, [
        'businessDate',
        'totalVnd',
        'cashVnd',
        'payosVnd',
        'paidInvoiceCount',
        'pendingPaymentCount',
      ]);
      const businessDate = record['businessDate'];
      if (typeof businessDate !== 'string' || !DATE.test(businessDate)) {
        throw new Error('Revenue summary businessDate must be YYYY-MM-DD.');
      }
      return {
        businessDate,
        totalVnd: vnd('totalVnd', record['totalVnd']),
        cashVnd: vnd('cashVnd', record['cashVnd']),
        payosVnd: vnd('payosVnd', record['payosVnd']),
        paidInvoiceCount: count('paidInvoiceCount', record['paidInvoiceCount']),
        pendingPaymentCount: count('pendingPaymentCount', record['pendingPaymentCount']),
      };
    }
    default:
      break;
  }
  const expected =
    kind === 'LEAVE_REQUESTED'
      ? ['subjectUserId', 'startDate', 'endDate', 'leaveType']
      : ['decision', 'startDate', 'endDate', 'leaveType'];
  exactKeys(type, record, expected);
  const text = (key: string) => {
    const entry = record[key];
    if (typeof entry !== 'string') throw new Error(`Notification param ${key} must be a string.`);
    return entry;
  };
  const startDate = text('startDate');
  const endDate = text('endDate');
  const leaveType = text('leaveType');
  if (!DATE.test(startDate) || !DATE.test(endDate) || endDate < startDate) {
    throw new Error('Notification leave dates must be ordered YYYY-MM-DD.');
  }
  if (!(LEAVE_TYPES as readonly string[]).includes(leaveType)) {
    throw new Error('Unknown leave type in notification params.');
  }
  const typed = leaveType as (typeof LEAVE_TYPES)[number];
  if (kind === 'LEAVE_REQUESTED') {
    const subjectUserId = text('subjectUserId').toLowerCase();
    if (!UUID.test(subjectUserId)) throw new Error('subjectUserId must be an account id.');
    return { subjectUserId, startDate, endDate, leaveType: typed };
  }
  const decision = text('decision');
  if (decision !== 'APPROVED' && decision !== 'REJECTED') {
    throw new Error('Leave decision must be APPROVED or REJECTED.');
  }
  return { decision, startDate, endDate, leaveType: typed };
}

/** Whether a row's (type, entity) pairing is one the registry allows. */
export function isAllowedNotificationEntity(
  type: NotificationType,
  entityType: NotificationEntityType,
): boolean {
  return (
    NOTIFICATION_TYPE_REGISTRY[type].entityTypes as readonly NotificationEntityType[]
  ).includes(entityType);
}

export function notificationTarget(entityType: NotificationEntityType): NotificationTargetKind {
  return NOTIFICATION_TARGET_BY_ENTITY[entityType];
}
