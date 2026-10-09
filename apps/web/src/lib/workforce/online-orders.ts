import {
  failedDeliveryRefund,
  ONLINE_FAIL_REASONS,
  ONLINE_QUEUE_TABS,
  type OnlineAddressCorrectRequest,
  type OnlineContextResponse,
  type OnlineDeliveredRequest,
  type OnlineFailReason,
  type OnlineLogKind,
  type OnlineLogRequest,
  type OnlineOrderState,
  type OnlineQueueTab,
  type OnlineSettleRequest,
  type OnlineShipmentCorrectRequest,
  type OnlineShipRequest,
  type OnlineStaffLine,
  type OnlineStaffOrderResponse,
  type ShippingCarrierCreateRequest,
  type ShippingCarrierEditRequest,
  type ShippingCarrierResponse,
} from '@lucy-spa/contracts';
import type { Locale } from '../../i18n/locales';
import { onlineFulfilmentDictionary } from '../../i18n/online-fulfilment';
import { ApiError } from './api';
import { todayIn } from './format';
import { normalizePage } from './list-view';
import type { StatusTone } from './product-orders';

/**
 * Online orders on the staff side (Phase 6 P6-20/P6-21), the parts that are not drawing: the queue state of the address bar, the tone
 * of a state, the drafts of every command and the request each one sends, the live figures of the settlement of a failed delivery, and the
 * words of a refused command. The server decides every rule again; what is here only saves a round trip. Money is whole VND, as a string
 * on the wire and as a BigInt in the arithmetic.
 */

/** The most the API takes for a carrier cost (whole VND). */
export const COST_MAX = 100_000_000;
export const NOTE_MAX = 500;
export const BANK_REFERENCE_MAX = 64;
export const TRACKING_MAX = 80;
export const CARRIER_NAME_MAX = 80;
export const CARRIER_TEMPLATE_MAX = 300;

// ------------------------------------------------------------------------------------------------------- the queue

export const ONLINE_TABS: readonly OnlineQueueTab[] = ONLINE_QUEUE_TABS;

export type OnlineListState = { branch: string; tab: string; q: string; page: number };

export const ONLINE_LIST_DEFAULTS: OnlineListState = { branch: '', tab: 'TO_SHIP', q: '', page: 1 };

export function normalizeOnlineList(state: OnlineListState): OnlineListState {
  return {
    branch: state.branch.slice(0, 64),
    tab: (ONLINE_TABS as readonly string[]).includes(state.tab) ? state.tab : 'TO_SHIP',
    q: state.q.slice(0, 80),
    page: normalizePage(state.page),
  };
}

/** Changing the branch, the tab or the search starts again at the first page. */
export const ONLINE_PAGE_KEYS = ['branch', 'tab', 'q'] as const;

export const onlineTab = (value: string): OnlineQueueTab =>
  (ONLINE_TABS as readonly string[]).includes(value) ? (value as OnlineQueueTab) : 'TO_SHIP';

/** The branches whose online orders the person may see: they pack there or they may refund there (the API serves both). */
export function seeableBranches(context: OnlineContextResponse): OnlineContextResponse['branches'] {
  return context.branches.filter((branch) => branch.work || branch.refund);
}

/** The chosen branch when the person may see it, else the first such branch (null when none). */
export function resolveOnlineBranch(context: OnlineContextResponse, chosen: string) {
  const seeable = seeableBranches(context);
  return seeable.find((branch) => branch.id === chosen) ?? seeable[0] ?? null;
}

export function onlineStateTone(state: OnlineOrderState): StatusTone {
  switch (state) {
    case 'AWAITING_PAYMENT':
    case 'DELIVERY_FAILED':
      return 'warning';
    case 'PAID':
    case 'READY_TO_SHIP':
    case 'WAITING_GOODS':
    case 'SHIPPED':
      return 'info';
    case 'COMPLETED':
      return 'success';
    case 'CANCELLED':
      return 'neutral';
  }
}

/** The state an order row shows: ready or waiting to ship are both "to ship" in the list, the detail page tells them apart. */
export const stateIsActive = (state: OnlineOrderState): boolean =>
  state !== 'COMPLETED' && state !== 'CANCELLED';

// --------------------------------------------------------------------------------------------------------- lines

/** The lines that go in the parcel: every line that is not cancelled, with the row version the person saw. */
export function parcelLines(order: Pick<OnlineStaffOrderResponse, 'lines'>) {
  return order.lines
    .filter((line) => line.status !== 'CANCELLED')
    .map((line) => ({ id: line.id, rowVersion: line.rowVersion }));
}

/** The lines still waiting for goods or for payment: the ones that keep the parcel from being packed. */
export const waitingLines = (order: Pick<OnlineStaffOrderResponse, 'lines'>): OnlineStaffLine[] =>
  order.lines.filter((line) => line.status !== 'CANCELLED' && !line.ready);

/** The names of the lines whose ids the API named in `ONLINE_ORDER_NOT_READY` (the field is the ids joined by commas). */
export function namesOfLines(
  field: string | null | undefined,
  order: Pick<OnlineStaffOrderResponse, 'lines'>,
  nameOf: (line: OnlineStaffLine) => string,
): string[] {
  const ids = (field ?? '').split(',').filter(Boolean);
  return ids
    .map((id) => order.lines.find((line) => line.id === id))
    .filter((line): line is OnlineStaffLine => line !== undefined)
    .map(nameOf);
}

// ---------------------------------------------------------------------------------------------------- numbers

/** A whole-dong amount as the API takes it, or null when it is empty, negative, fractional or too large. */
export function costText(value: number | null): string | null {
  if (value === null || !Number.isInteger(value) || value < 0 || value > COST_MAX) return null;
  return String(value);
}

/** Whole dong of a string from the API (never fails: a malformed value counts as 0). */
export function bigOf(value: string | null | undefined): bigint {
  return value !== null && value !== undefined && /^-?[0-9]{1,18}$/.test(value)
    ? BigInt(value)
    : 0n;
}

// ------------------------------------------------------------------------------------------------------- ship

/** The server's rule for a tracking code: letters, digits and . _ - / after a letter or digit, up to 80. */
export const TRACKING_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,79}$/;

export const trackingProblem = (code: string): boolean =>
  !TRACKING_PATTERN.test(code.normalize('NFC').trim());

export interface ShipDraft {
  carrierId: string;
  trackingCode: string;
  /** What the shop pays the carrier for the way there; 0 is allowed. */
  fee: number | null;
}

export const emptyShipDraft = (carriers: readonly { id: string }[]): ShipDraft => ({
  carrierId: carriers.length === 1 ? (carriers[0]?.id ?? '') : '',
  trackingCode: '',
  fee: null,
});

export type ShipProblem = 'carrierId' | 'trackingCode' | 'fee';

export function validateShip(draft: ShipDraft): Partial<Record<ShipProblem, true>> {
  const problems: Partial<Record<ShipProblem, true>> = {};
  if (draft.carrierId === '') problems.carrierId = true;
  if (trackingProblem(draft.trackingCode)) problems.trackingCode = true;
  if (costText(draft.fee) === null) problems.fee = true;
  return problems;
}

export function shipRequest(
  draft: ShipDraft,
  order: Pick<OnlineStaffOrderResponse, 'lines'>,
): OnlineShipRequest | null {
  const fee = costText(draft.fee);
  if (Object.keys(validateShip(draft)).length > 0 || fee === null) return null;
  const lines = parcelLines(order);
  if (lines.length === 0) return null;
  return {
    lines,
    carrierId: draft.carrierId,
    trackingCode: draft.trackingCode.normalize('NFC').trim(),
    carrierFeeVnd: fee,
  };
}

// ------------------------------------------------------------------------------------------ correct shipment

export interface CorrectShipmentDraft {
  trackingCode: string;
  /** Null when the person may not see the cost (then the field is not drawn and the cost never changes). */
  fee: number | null;
  reason: string;
}

export function correctShipmentDraft(
  shipment: NonNullable<OnlineStaffOrderResponse['shipment']>,
): CorrectShipmentDraft {
  return {
    trackingCode: shipment.trackingCode,
    fee: shipment.carrierFeeOutVnd === null ? null : Number(shipment.carrierFeeOutVnd),
    reason: '',
  };
}

export type CorrectShipmentProblem = 'trackingCode' | 'fee' | 'reason' | 'nothing';

/** `mayFee` is true when the order carries the cost (the person may refund); the fee is checked and sent only then. */
export function validateCorrectShipment(
  draft: CorrectShipmentDraft,
  shipment: NonNullable<OnlineStaffOrderResponse['shipment']>,
  mayFee: boolean,
): Partial<Record<CorrectShipmentProblem, true>> {
  const problems: Partial<Record<CorrectShipmentProblem, true>> = {};
  if (trackingProblem(draft.trackingCode)) problems.trackingCode = true;
  if (mayFee && costText(draft.fee) === null) problems.fee = true;
  if (draft.reason.trim() === '') problems.reason = true;
  if (Object.keys(problems).length === 0) {
    const sameCode = draft.trackingCode.normalize('NFC').trim() === shipment.trackingCode;
    const sameFee = !mayFee || costText(draft.fee) === shipment.carrierFeeOutVnd;
    if (sameCode && sameFee) problems.nothing = true;
  }
  return problems;
}

/** Only what changed is sent; null while the draft has a problem or changes nothing. */
export function correctShipmentRequest(
  draft: CorrectShipmentDraft,
  shipment: NonNullable<OnlineStaffOrderResponse['shipment']>,
  mayFee: boolean,
): OnlineShipmentCorrectRequest | null {
  if (Object.keys(validateCorrectShipment(draft, shipment, mayFee)).length > 0) return null;
  const code = draft.trackingCode.normalize('NFC').trim();
  const fee = costText(draft.fee);
  return {
    ...(code !== shipment.trackingCode ? { trackingCode: code } : {}),
    ...(mayFee && fee !== null && fee !== shipment.carrierFeeOutVnd ? { carrierFeeVnd: fee } : {}),
    reason: draft.reason.trim(),
  };
}

// --------------------------------------------------------------------------------------------------- delivered

export const BRANCH_ZONE = 'Asia/Ho_Chi_Minh';

/** The latest day that can be named as the delivery day: today in the branch's day. */
export const latestDeliveryDay = (now: Date = new Date()): string => todayIn(BRANCH_ZONE, now);

/** True when the typed day is empty (= now) or a real day that is not in the future. */
export function deliveryDayOk(day: string, now: Date = new Date()): boolean {
  if (day === '') return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= latestDeliveryDay(now);
}

export function deliveredRequest(day: string): OnlineDeliveredRequest {
  return day === '' ? {} : { deliveredOn: day };
}

// ------------------------------------------------------------------------------------------------------- log

export type LogKindChoice = Exclude<OnlineLogKind, 'RETURNED_TO_SHOP' | 'DELIVERED'>;

/**
 * The entries staff may write now. Writing about a failed attempt, a new attempt or a customer who no longer wants the parcel needs a
 * parcel on its way; a contact or a note is always possible while the order is paid; nothing after the parcel is back at the shop.
 */
export function logKindsFor(
  order: Pick<OnlineStaffOrderResponse, 'lines' | 'returnedToShop'>,
): LogKindChoice[] {
  if (order.returnedToShop) return [];
  const shipped = order.lines.some((line) => line.status === 'SHIPPED');
  return shipped
    ? ['DELIVERY_FAILED', 'CONTACTED', 'REDELIVERY', 'RETURN_STARTED', 'NOTE']
    : ['CONTACTED', 'NOTE'];
}

export interface LogDraft {
  kind: LogKindChoice | '';
  reasonCode: OnlineFailReason | '';
  note: string;
}

export const emptyLogDraft = (kinds: readonly LogKindChoice[]): LogDraft => ({
  kind: kinds.length === 1 ? (kinds[0] ?? '') : '',
  reasonCode: '',
  note: '',
});

export type LogProblem = 'kind' | 'reasonCode' | 'note';

export function validateLog(draft: LogDraft): Partial<Record<LogProblem, true>> {
  const problems: Partial<Record<LogProblem, true>> = {};
  if (draft.kind === '') problems.kind = true;
  if (draft.kind === 'DELIVERY_FAILED' && draft.reasonCode === '') problems.reasonCode = true;
  if (draft.kind !== '' && draft.kind !== 'REDELIVERY' && draft.note.trim() === '') {
    problems.note = true;
  }
  return problems;
}

export function logRequest(draft: LogDraft): OnlineLogRequest | null {
  if (Object.keys(validateLog(draft)).length > 0 || draft.kind === '') return null;
  const note = draft.note.trim();
  return {
    kind: draft.kind,
    ...(draft.kind === 'DELIVERY_FAILED' && draft.reasonCode !== ''
      ? { reasonCode: draft.reasonCode }
      : {}),
    note: note === '' ? null : note,
  };
}

export const FAIL_REASONS: readonly OnlineFailReason[] = ONLINE_FAIL_REASONS;

// --------------------------------------------------------------------------------------------------- address

export interface AddressDraft {
  recipientName: string;
  recipientPhone: string;
  provinceCode: string;
  ward: string;
  street: string;
  reason: string;
}

export function addressDraft(recipient: OnlineStaffOrderResponse['recipient']): AddressDraft {
  return {
    recipientName: recipient.name,
    recipientPhone: recipient.phone,
    provinceCode: recipient.provinceCode,
    ward: recipient.ward,
    street: recipient.street,
    reason: '',
  };
}

export type AddressProblem = keyof AddressDraft | 'nothing';

/** The phone is checked loosely (digits and the usual separators, 9 to 15 digits); the server normalizes it. */
export const phoneProblem = (phone: string): boolean => {
  const text = phone.trim();
  const digits = text.replace(/\D/g, '');
  return !/^[0-9+ ().-]+$/.test(text) || digits.length < 9 || digits.length > 15;
};

export function validateAddress(
  draft: AddressDraft,
  current: OnlineStaffOrderResponse['recipient'],
): Partial<Record<AddressProblem, true>> {
  const problems: Partial<Record<AddressProblem, true>> = {};
  if (draft.recipientName.trim() === '') problems.recipientName = true;
  if (phoneProblem(draft.recipientPhone)) problems.recipientPhone = true;
  if (draft.provinceCode === '') problems.provinceCode = true;
  if (draft.ward.trim() === '') problems.ward = true;
  if (draft.street.trim() === '') problems.street = true;
  if (draft.reason.trim() === '') problems.reason = true;
  if (Object.keys(problems).length === 0) {
    const same =
      draft.recipientName.trim() === current.name &&
      draft.recipientPhone.trim() === current.phone &&
      draft.provinceCode === current.provinceCode &&
      draft.ward.trim() === current.ward &&
      draft.street.trim() === current.street;
    if (same) problems.nothing = true;
  }
  return problems;
}

export function addressRequest(
  draft: AddressDraft,
  current: OnlineStaffOrderResponse['recipient'],
): OnlineAddressCorrectRequest | null {
  if (Object.keys(validateAddress(draft, current)).length > 0) return null;
  return {
    recipientName: draft.recipientName.trim(),
    recipientPhone: draft.recipientPhone.trim(),
    provinceCode: draft.provinceCode,
    ward: draft.ward.trim(),
    street: draft.street.trim(),
    reason: draft.reason.trim(),
  };
}

// ------------------------------------------------------------------------------------------------ settlement

export interface SettleFigures {
  goods: bigint;
  /** Null when the cost of the way there is not on the order (the person may not see it): no preview is possible. */
  out: bigint | null;
  back: bigint;
  refund: bigint | null;
}

/**
 * The live figures of the settlement: the goods paid (the net share of every line that is not cancelled), the cost out, the cost back
 * typed now, and the refund. The server reads the goods and the cost out again under its locks and decides; this is what it will
 * compute from the same records.
 */
export function settleFigures(
  order: Pick<OnlineStaffOrderResponse, 'lines' | 'shipment'>,
  backVnd: number | null,
): SettleFigures {
  const goods = order.lines
    .filter((line) => line.status !== 'CANCELLED')
    .reduce((sum, line) => sum + bigOf(line.refundShareVnd), 0n);
  const outText = order.shipment?.carrierFeeOutVnd ?? null;
  const out = outText === null ? null : bigOf(outText);
  const back = BigInt(costText(backVnd) ?? '0');
  return {
    goods,
    out,
    back,
    refund: out === null ? null : failedDeliveryRefund(goods, out, back),
  };
}

export interface SettleDraft {
  back: number | null;
  reason: string;
  restock: 'SELLABLE' | 'NOT_SELLABLE';
  method: 'CASH' | 'BANK_TRANSFER_MANUAL';
  bankReference: string;
}

export const emptySettleDraft = (): SettleDraft => ({
  back: null,
  reason: '',
  restock: 'NOT_SELLABLE',
  method: 'CASH',
  bankReference: '',
});

export type SettleProblem = 'back' | 'reason' | 'bankReference' | 'preview';

export function validateSettle(
  draft: SettleDraft,
  figures: SettleFigures,
): Partial<Record<SettleProblem, true>> {
  const problems: Partial<Record<SettleProblem, true>> = {};
  if (costText(draft.back) === null) problems.back = true;
  if (draft.reason.trim() === '') problems.reason = true;
  if (figures.refund === null) problems.preview = true;
  if (figures.refund !== null && figures.refund > 0n && draft.method === 'BANK_TRANSFER_MANUAL') {
    const reference = draft.bankReference.trim();
    if (reference === '' || [...reference].length > BANK_REFERENCE_MAX)
      problems.bankReference = true;
  }
  return problems;
}

/**
 * The request. With nothing to refund the method and the reference are left out and the goods cannot be named "sellable" (the server
 * refuses both); with a refund the method is sent, and the reference only for a bank transfer.
 */
export function settleRequest(
  draft: SettleDraft,
  order: Pick<OnlineStaffOrderResponse, 'lines' | 'shipment'>,
  clientRequestId: string,
): OnlineSettleRequest | null {
  const figures = settleFigures(order, draft.back);
  const back = costText(draft.back);
  if (Object.keys(validateSettle(draft, figures)).length > 0 || back === null) return null;
  const lines = parcelLines(order);
  if (lines.length === 0) return null;
  const refunded = figures.refund !== null && figures.refund > 0n;
  return {
    lines,
    carrierFeeBackVnd: back,
    reason: draft.reason.trim(),
    restock: refunded ? draft.restock : 'NOT_SELLABLE',
    ...(refunded
      ? {
          method: draft.method,
          bankReference:
            draft.method === 'BANK_TRANSFER_MANUAL' ? draft.bankReference.trim() : null,
        }
      : {}),
    clientRequestId,
  };
}

// ----------------------------------------------------------------------------------------------- return cost

export type ReturnCostProblem = 'cost';

export function returnCostRequest(
  cost: number | null,
  note: string,
): { costVnd: string; note?: string | null } | null {
  const text = costText(cost);
  if (text === null) return null;
  const trimmed = note.trim();
  return { costVnd: text, note: trimmed === '' ? null : trimmed };
}

// -------------------------------------------------------------------------------------------------- carriers

/** The server's rule for a tracking link: https, no spaces, exactly one {code} place. */
export function templateProblem(template: string): boolean {
  const text = template.trim();
  if (text === '') return false;
  return (
    text.length > CARRIER_TEMPLATE_MAX ||
    !/^https:\/\/[^\s]+$/.test(text) ||
    text.split('{code}').length !== 2
  );
}

export interface CarrierDraft {
  name: string;
  template: string;
}

export const emptyCarrierDraft = (): CarrierDraft => ({ name: '', template: '' });

export const carrierDraftOf = (carrier: ShippingCarrierResponse): CarrierDraft => ({
  name: carrier.name,
  template: carrier.trackingUrlTemplate ?? '',
});

export type CarrierProblem = 'name' | 'template';

export function validateCarrier(draft: CarrierDraft): Partial<Record<CarrierProblem, true>> {
  const problems: Partial<Record<CarrierProblem, true>> = {};
  const name = draft.name.trim();
  if (name === '' || [...name].length > CARRIER_NAME_MAX) problems.name = true;
  if (templateProblem(draft.template)) problems.template = true;
  return problems;
}

export function carrierCreateRequest(draft: CarrierDraft): ShippingCarrierCreateRequest | null {
  if (Object.keys(validateCarrier(draft)).length > 0) return null;
  const template = draft.template.trim();
  return { name: draft.name.trim(), trackingUrlTemplate: template === '' ? null : template };
}

/** Only what changed; null while the draft has a problem or changes nothing. */
export function carrierEditRequest(
  draft: CarrierDraft,
  carrier: ShippingCarrierResponse,
): ShippingCarrierEditRequest | null {
  if (Object.keys(validateCarrier(draft)).length > 0) return null;
  const name = draft.name.trim();
  const template = draft.template.trim() === '' ? null : draft.template.trim();
  const patch: ShippingCarrierEditRequest = { expectedRowVersion: carrier.rowVersion };
  if (name !== carrier.name) patch.name = name;
  if (template !== carrier.trackingUrlTemplate) patch.trackingUrlTemplate = template;
  return patch.name === undefined && patch.trackingUrlTemplate === undefined ? null : patch;
}

export const carrierSwitchRequest = (
  carrier: ShippingCarrierResponse,
  isActive: boolean,
): ShippingCarrierEditRequest => ({ expectedRowVersion: carrier.rowVersion, isActive });

// ----------------------------------------------------------------------------------------------------- errors

/** True when a command was refused because the order moved on meanwhile: the screen then reloads it. */
export const isOnlineConflict = (error: unknown): boolean =>
  error instanceof ApiError &&
  (error.code === 'CONFLICT' ||
    error.code === 'ONLINE_ORDER_STATE_INVALID' ||
    error.code === 'ORDER_LINE_STATE_INVALID');

/** The field a refused command names, when the code is `VALIDATION_FAILED`. */
export const fieldOfError = (error: unknown): string | null =>
  error instanceof ApiError && error.code === 'VALIDATION_FAILED' && error.field
    ? error.field
    : null;

/**
 * The text of a refused command: this area's own words for its codes, with the names of the lines that are not ready for
 * `ONLINE_ORDER_NOT_READY`; anything else falls back to the caller's message.
 */
export function onlineErrorText(
  error: unknown,
  locale: Locale,
  fallback: (error: unknown) => string,
  nameOf: (id: string) => string | null = () => null,
): string {
  if (error instanceof ApiError) {
    const d = onlineFulfilmentDictionary(locale).errors;
    if (error.code === 'ONLINE_ORDER_NOT_READY') {
      const names = (error.field ?? '')
        .split(',')
        .filter(Boolean)
        .map((id) => nameOf(id))
        .filter((name): name is string => name !== null && name !== '');
      return d.ONLINE_ORDER_NOT_READY.replace('{names}', names.join(', ') || '…');
    }
    if (error.code === 'CONFLICT' && error.field === 'name') return d.CARRIER_NAME_TAKEN;
    const known = d as Record<string, string>;
    const text = Object.hasOwn(known, error.code) ? known[error.code] : undefined;
    if (text) return text;
  }
  return fallback(error);
}
