/**
 * Phase 7 P7-10b (docs/PHASE7_PAYROLL_FUNDS.md section 14, P7-T16; Owner answer 3, 2026-10-11): the referral code of a staff member for
 * online orders. Only OFFICIAL employees get one, and only when the Owner presses the button (never automatically). A reset switches the
 * old code off and gives a new one; old codes stay as history and are never given again. The customer types the code at checkout; an
 * online line earns commission for the person the code names, with the same base and refund rules as the counter.
 */
export interface StaffCodeHistoryItem {
  code: string;
  active: boolean;
  createdAt: string;
  deactivatedAt: string | null;
  deactivationReason: string | null;
}

export interface StaffCodeItem {
  employee: { id: string; name: string };
  /** The code in use now, or null when this person has none yet. */
  code: string | null;
  createdAt: string | null;
  /** The earlier codes of this person, newest first. */
  history: StaffCodeHistoryItem[];
  /** Orders placed with the code in use (all time). */
  orders: number;
}

export interface StaffCodesResponse {
  today: string;
  /** May the signed-in person create and reset codes? (`MANAGE_PAY_RULES`) */
  canManage: boolean;
  /** The people who may have a code: OFFICIAL employees today. */
  items: StaffCodeItem[];
  /** People who still have an active code although they are no longer official (their code no longer works). */
  retired: { employee: { id: string; name: string }; code: string }[];
}

export interface StaffCodeCreateRequest {
  employeeUserId: string;
}

export interface StaffCodeResetRequest {
  reason: string;
}
