import { LOYALTY_TIERS_V1 } from '@lucy-spa/contracts';
import type {
  CustomerComboStatus,
  CustomerComboUseResponse,
  CustomerLedgerItemResponse,
  CustomerReferralStatus,
  LoyaltyTierName,
  RewardEntitlementStatus,
} from '@lucy-spa/contracts';

import { fill } from '../../i18n/customer';
import type { customerLoyaltyDictionary } from '../../i18n/customer-loyalty';
import type { Locale } from '../../i18n/locales';

/** Pure display helpers of the customer's membership page. Every number, status and name comes from the server. */

type Text = ReturnType<typeof customerLoyaltyDictionary>;
type Tone = 'success' | 'info' | 'warning' | 'neutral' | 'error';

/** The page's time zone: Lucy Spa's branches are in Vietnam and a customer's points have no branch. */
const ZONE = 'Asia/Ho_Chi_Minh';

/** An instant as the calendar day it falls on in Vietnam, `dd/mm/yyyy`. */
export function formatDay(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone: ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

/** A point amount with a plus or a true minus sign, e.g. `+620` / `−20`. */
export function formatSignedPoints(points: number, locale: Locale): string {
  const text = new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US').format(Math.abs(points));
  if (points > 0) return `+${text}`;
  return points < 0 ? `−${text}` : text;
}

/** One line of the points history in simple words (a staff reason never reaches the browser). */
export function historyText(item: CustomerLedgerItemResponse, text: Text): string {
  return text.history.kind[item.kind];
}

/** Who used a combo session: the customer, or a relative (with their masked name when the server knows it). */
export function usedByText(use: CustomerComboUseResponse, text: Text): string {
  if (use.usedBy === 'OWNER') return text.uses.owner;
  return use.recipientMasked
    ? fill(text.uses.relativeNamed, { name: use.recipientMasked })
    : text.uses.relative;
}

export function comboTone(status: CustomerComboStatus): Tone {
  switch (status) {
    case 'ACTIVE':
      return 'success';
    case 'PAUSED':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function giftTone(status: RewardEntitlementStatus): Tone {
  return status === 'ACTIVE' ? 'success' : 'neutral';
}

export function referralTone(status: CustomerReferralStatus): Tone {
  return status === 'REWARDED' ? 'success' : 'neutral';
}

export interface TierRow {
  tier: LoyaltyTierName;
  fromPoints: number;
  discountPercent: number;
}

/** The tier table (version 1) of the shared contract as display rows: every tier with a Member Discount, lowest first. Never typed in the UI. */
export function tierRows(): TierRow[] {
  return LOYALTY_TIERS_V1.filter((entry) => entry.tier !== 'NONE').map((entry) => ({
    tier: entry.tier,
    fromPoints: entry.fromPoints,
    discountPercent: entry.memberDiscountBp / 100,
  }));
}
