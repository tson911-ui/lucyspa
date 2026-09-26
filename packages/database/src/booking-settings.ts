/**
 * Phase 3 configuration registry (docs/PHASE3_BOOKING_VISITS_DESIGN.md, section 18). The keys,
 * defaults and ranges are code-owned; the migration seeds `app_settings` with these defaults
 * and a SQL CHECK enforces the same ranges. Business logic reads the stored values and never
 * hard-codes them. Changing a value later needs MANAGE_BOOKING_SETTINGS (a later step).
 */
export interface BookingSettingDefinition {
  readonly key: string;
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  /** Slot intervals must divide an hour evenly. */
  readonly dividesHour?: true;
}

export const BOOKING_SETTINGS = Object.freeze([
  { key: 'booking.maxAdvanceDays', defaultValue: 60, min: 1, max: 365 },
  { key: 'booking.slotIntervalMinutes', defaultValue: 15, min: 5, max: 60, dividesHour: true },
  { key: 'booking.lateHoldMinutes', defaultValue: 20, min: 0, max: 120 },
  { key: 'booking.lateCancelAlertMinutes', defaultValue: 15, min: 0, max: 1440 },
  { key: 'service.warningLeadMinutes', defaultValue: 5, min: 1, max: 60 },
  { key: 'service.startOverdueMinutes', defaultValue: 5, min: 1, max: 60 },
  { key: 'service.endOverdueMinutes', defaultValue: 5, min: 1, max: 60 },
  { key: 'booking.checkInWindowMinutes', defaultValue: 60, min: 0, max: 1440 },
  { key: 'booking.serviceBufferMinutes', defaultValue: 0, min: 0, max: 60 },
] as const satisfies readonly BookingSettingDefinition[]);

export type BookingSettingKey = (typeof BOOKING_SETTINGS)[number]['key'];

/** True when `value` is a valid stored value for `key` (the same rule as the SQL CHECK). */
export function isValidBookingSetting(key: string, value: unknown): boolean {
  const definition = BOOKING_SETTINGS.find((entry) => entry.key === key);
  if (!definition || typeof value !== 'number' || !Number.isInteger(value)) return false;
  if (value < definition.min || value > definition.max) return false;
  return !('dividesHour' in definition) || 60 % value === 0;
}
