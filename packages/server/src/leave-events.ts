/**
 * Outbox contract for Leave notifications. Producer (API) and consumer (worker) share these
 * definitions. Payloads are minimal and structured: no reason, manager note, name or dates. The
 * consumer reads dates and type from the authoritative LeaveRequest row.
 */
export const LEAVE_AGGREGATE = 'LeaveRequest';
export const LEAVE_REQUESTED_EVENT = 'LEAVE_REQUESTED';
export const LEAVE_DECIDED_EVENT = 'LEAVE_DECIDED';
export const LEAVE_EVENT_TYPES = [LEAVE_REQUESTED_EVENT, LEAVE_DECIDED_EVENT] as const;
export type LeaveEventType = (typeof LEAVE_EVENT_TYPES)[number];
export const LEAVE_EVENT_SCHEMA_VERSION = 1;

export type LeaveDecision = 'APPROVED' | 'REJECTED';
export type LeaveRequestedPayload = { employeeUserId: string };
export type LeaveDecidedPayload = { employeeUserId: string; decision: LeaveDecision };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function leaveRequestedPayload(employeeUserId: string): LeaveRequestedPayload {
  return { employeeUserId };
}

export function leaveDecidedPayload(
  employeeUserId: string,
  decision: LeaveDecision,
): LeaveDecidedPayload {
  return { employeeUserId, decision };
}

export function isLeaveEventType(value: string): value is LeaveEventType {
  return (LEAVE_EVENT_TYPES as readonly string[]).includes(value);
}

/** Strict: exactly the declared keys. Anything else is a malformed event and is refused. */
export function parseLeaveEventPayload(
  eventType: LeaveEventType,
  value: unknown,
): LeaveRequestedPayload | LeaveDecidedPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Leave event ${eventType} requires an object payload.`);
  }
  const record = value as Record<string, unknown>;
  const expected =
    eventType === LEAVE_REQUESTED_EVENT ? ['employeeUserId'] : ['decision', 'employeeUserId'];
  if (Object.keys(record).sort().join() !== expected.join()) {
    throw new Error(`Leave event ${eventType} payload must have exactly: ${expected.join(', ')}.`);
  }
  const employeeUserId = record['employeeUserId'];
  if (typeof employeeUserId !== 'string' || !UUID.test(employeeUserId)) {
    throw new Error('Leave event employeeUserId must be an account id.');
  }
  if (eventType === LEAVE_REQUESTED_EVENT) {
    return { employeeUserId: employeeUserId.toLowerCase() };
  }
  const decision = record['decision'];
  if (decision !== 'APPROVED' && decision !== 'REJECTED') {
    throw new Error('Leave decision must be APPROVED or REJECTED.');
  }
  return { employeeUserId: employeeUserId.toLowerCase(), decision };
}
