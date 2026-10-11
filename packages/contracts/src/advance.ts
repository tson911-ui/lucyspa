/**
 * Phase 7 P7-13 (docs/PHASE7_PAYROLL_FUNDS.md 4.4; OQ-110): salary advances. Only an official employee with a CONFIRMED monthly salary can
 * have one, at most half of that salary, one open advance at a time. REQUESTED (MANAGE_PAYROLL) -> APPROVED (APPROVE_PAYROLL) -> PAID
 * (APPROVE_PAYROLL + a fresh password; the money leaves a fund in the same transaction) -> RECOVERED by the payroll runs, or WRITTEN_OFF by
 * the Owner with a reason and a fresh password. A request can be cancelled before it is paid. Nothing is ever deleted and nothing is paid
 * by itself. Money is a decimal string.
 */
export const SALARY_ADVANCE_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'PAID',
  'RECOVERED',
  'WRITTEN_OFF',
  'CANCELLED',
] as const;
export type SalaryAdvanceStatusName = (typeof SALARY_ADVANCE_STATUSES)[number];

/** An advance may be at most this share of the monthly base salary (percent). */
export const ADVANCE_LIMIT_PERCENT = 50;

export interface AdvancePerson {
  id: string;
  name: string;
}

export interface SalaryAdvanceItem {
  id: string;
  employee: AdvancePerson & { code: string };
  amountVnd: string;
  status: SalaryAdvanceStatusName;
  reason: string;
  requestedBy: AdvancePerson;
  requestedAt: string;
  approvedBy: AdvancePerson | null;
  approvedAt: string | null;
  paidBy: AdvancePerson | null;
  paidAt: string | null;
  paidFund: { id: string; name: string } | null;
  /** Taken back by closed payroll runs so far. */
  recoveredVnd: string;
  writtenOffVnd: string | null;
  writeOffReason: string | null;
  cancelReason: string | null;
  /** What is still owed by the person (only while PAID). */
  outstandingVnd: string;
  version: number;
}

export interface AdvanceEligibleItem {
  employee: AdvancePerson & { code: string };
  /** Half the confirmed monthly salary in force today. */
  limitVnd: string;
}

export interface AdvanceFundOption {
  id: string;
  name: string;
  kind: 'CASH' | 'BANK';
  balanceVnd: string;
}

export interface SalaryAdvancesResponse {
  items: SalaryAdvanceItem[];
  /** Official employees with a confirmed salary and no open advance: who a request can be made for. */
  eligible: AdvanceEligibleItem[];
  /** Funds an advance can be paid from (only for a person who may pay). */
  funds: AdvanceFundOption[];
  canRequest: boolean;
  canApprove: boolean;
}

export interface SalaryAdvanceRequest {
  employeeUserId: string;
  amountVnd: string;
  reason: string;
  clientRequestId: string;
}

export interface SalaryAdvanceApproveRequest {
  expectedVersion: number;
}

export interface SalaryAdvanceCancelRequest {
  expectedVersion: number;
  reason: string;
}

export interface SalaryAdvancePayRequest {
  expectedVersion: number;
  fundId: string;
  clientRequestId: string;
}

export interface SalaryAdvanceWriteOffRequest {
  expectedVersion: number;
  reason: string;
}
