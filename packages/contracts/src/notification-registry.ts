import type { LeaveType } from './index.js';

/**
 * Code-owned notification type metadata (single source shared by API, worker and web).
 * A notification's category, severity, entity, i18n key and destination are looked up by its
 * `type`; none of them is stored per row, so they can never drift from the type. Constant
 * data only: no runtime dependency, no delivery or routing logic.
 */
export const NOTIFICATION_ENTITY_TYPES = ['Booking', 'Visit', 'LeaveRequest'] as const;
export type NotificationEntityType = (typeof NOTIFICATION_ENTITY_TYPES)[number];

export type NotificationCategory = 'OPERATIONS' | 'HR';
export type NotificationSeverity = 'INFO' | 'ATTENTION' | 'WARNING';
/** Which allowlisted screen an item opens; the destination API still enforces authority. */
export type NotificationTargetKind = 'BOOKING' | 'VISIT' | 'LEAVE_REQUEST';
/** Shape of the structured `params` a type carries. Never free text. */
export type NotificationParamsKind = 'NONE' | 'LEAVE_REQUESTED' | 'LEAVE_DECIDED';

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
export type NotificationParams = LeaveRequestedParams | LeaveDecidedParams;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Strict allowlist validator for `params`: exactly the declared keys, ids/dates/enums only,
 * so a notification can never carry free-form or sensitive text. Returns the normalized
 * object, `null` for a type without params, and throws on anything else.
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
  const expected =
    kind === 'LEAVE_REQUESTED'
      ? ['subjectUserId', 'startDate', 'endDate', 'leaveType']
      : ['decision', 'startDate', 'endDate', 'leaveType'];
  const keys = Object.keys(record).sort();
  if (keys.join() !== [...expected].sort().join()) {
    throw new Error(`Notification params for ${type} must have exactly: ${expected.join(', ')}.`);
  }
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
