import type {
  InventoryContextResponse,
  InventoryItem,
  InventoryLotResponse,
  StockAdjustmentReasonName,
  StockAdjustmentRequest,
  StockCountLinesRequest,
  StockCountLineResponse,
  StockCountResponse,
  StockCountStatusName,
  StockReceiptCreateRequest,
  StockReceiptEditRequest,
  StockReceiptLineRequest,
  StockReceiptListItem,
  StockReceiptResponse,
  StockReceiptStatusName,
  SupplierCreateRequest,
  SupplierEditRequest,
  SupplierResponse,
} from '@lucy-spa/contracts';
import { DEFAULT_PAGE_SIZE, normalizeSearch, type SortValue } from '@lucy-spa/ui';
import type { Locale } from '../../i18n/locales';
import { inventoryDictionary } from '../../i18n/inventory';
import { ApiError } from './api';
import { vndAmount } from './products';
import { normalizePage, normalizePageSize } from './list-view';

/**
 * Phase 6 P6-4: the inventory screens' pure logic (list state, filters, drafts, requests, display rules). Nothing here decides
 * authority: the context and the responses come from the API and only decide what a screen offers; the API authorizes every
 * request again. A unit cost exists only where the API sent one (the cost permission); without it no request carries a cost key.
 */

export type Issue = 'required' | 'invalid';

const ZONE = 'Asia/Ho_Chi_Minh';

/** Today's business date (`YYYY-MM-DD`) in the shop's time zone. */
export function todayInShop(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

const clean = (text: string): string => text.normalize('NFC').trim();
const length = (text: string): number => [...text].length;

const wholeNumber = (text: string, max: number): number | null => {
  const value = text.trim();
  if (!/^[0-9]{1,9}$/.test(value)) return null;
  const number = Number(value);
  return number <= max ? number : null;
};

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isCalendarDate(text: string): boolean {
  const match = DATE.exec(text.trim());
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    year >= 2000 &&
    year <= 2100 &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

// ----------------------------------------------------------------------------------------------- tabs and branch

export const INVENTORY_TABS = ['stock', 'receipts', 'counts', 'suppliers'] as const;
export type InventoryTab = (typeof INVENTORY_TABS)[number];

type BranchOption = InventoryContextResponse['branches'][number];

/** Whether the branch lets the caller use the tab (suppliers belong to no branch). */
export function branchServesTab(branch: BranchOption, tab: InventoryTab): boolean {
  if (tab === 'stock') return branch.view;
  if (tab === 'receipts') return branch.receipts;
  if (tab === 'counts') return branch.view || branch.adjust;
  return false;
}

/** Tabs the caller can use somewhere, in display order. */
export function availableTabs(context: InventoryContextResponse): InventoryTab[] {
  return INVENTORY_TABS.filter((tab) =>
    tab === 'suppliers'
      ? context.manageProducts || context.branches.some((branch) => branch.receipts)
      : context.branches.some((branch) => branchServesTab(branch, tab)),
  );
}

/** The tab to show: the requested one when it is usable, else the first usable one (null when there is none). */
export function resolveTab(
  context: InventoryContextResponse,
  requested: string,
): InventoryTab | null {
  const tabs = availableTabs(context);
  return tabs.find((tab) => tab === requested) ?? tabs[0] ?? null;
}

/** The branches the tab can work in (the branch chooser lists exactly these). */
export function branchesForTab(
  context: InventoryContextResponse,
  tab: InventoryTab,
): BranchOption[] {
  return context.branches.filter((branch) => branchServesTab(branch, tab));
}

/** The chosen branch when it serves the tab, else the first branch that does (the API lists them by name); null when none. */
export function resolveBranch(
  context: InventoryContextResponse,
  chosen: string,
  tab: InventoryTab,
): BranchOption | null {
  const options = branchesForTab(context, tab);
  return options.find((branch) => branch.id === chosen) ?? options[0] ?? null;
}

// ----------------------------------------------------------------------------------------------------- list state

export const STOCK_STATUSES = ['low', 'out', 'expiry', 'ok'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];
export const STOCK_SORT_KEYS = ['name', 'sku', 'onHand', 'available', 'expiry'] as const;
export const RECEIPT_STATUSES: readonly StockReceiptStatusName[] = [
  'DRAFT',
  'CONFIRMED',
  'CANCELLED',
];

export const INVENTORY_LIST_DEFAULTS = {
  tab: 'stock',
  branch: '',
  q: '',
  status: '',
  rstatus: '',
  sort: 'name',
  dir: 'asc',
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  /** Page and page size of the receipts, counts and suppliers tabs. */
  rpage: 1,
  rpageSize: DEFAULT_PAGE_SIZE,
  cpage: 1,
  cpageSize: DEFAULT_PAGE_SIZE,
  spage: 1,
  spageSize: DEFAULT_PAGE_SIZE,
};
export type InventoryListState = typeof INVENTORY_LIST_DEFAULTS;

export const INVENTORY_PAGE_KEYS: readonly string[] = ['page', 'rpage', 'cpage', 'spage'];

export function normalizeInventoryList(state: InventoryListState): InventoryListState {
  return {
    tab: (INVENTORY_TABS as readonly string[]).includes(state.tab) ? state.tab : 'stock',
    branch: state.branch.slice(0, 64),
    q: state.q.slice(0, 100),
    status: (STOCK_STATUSES as readonly string[]).includes(state.status) ? state.status : '',
    rstatus: (RECEIPT_STATUSES as readonly string[]).includes(state.rstatus) ? state.rstatus : '',
    sort: (STOCK_SORT_KEYS as readonly string[]).includes(state.sort) ? state.sort : 'name',
    dir: state.dir === 'desc' ? 'desc' : 'asc',
    page: normalizePage(state.page),
    pageSize: normalizePageSize(state.pageSize),
    rpage: normalizePage(state.rpage),
    rpageSize: normalizePageSize(state.rpageSize),
    cpage: normalizePage(state.cpage),
    cpageSize: normalizePageSize(state.cpageSize),
    spage: normalizePage(state.spage),
    spageSize: normalizePageSize(state.spageSize),
  };
}

// ---------------------------------------------------------------------------------------------------------- stock

export const itemName = (
  item: Pick<InventoryItem, 'productNameVi' | 'productNameEn'>,
  locale: Locale,
) => (locale === 'vi' ? item.productNameVi : item.productNameEn);

export const itemLabel = (
  item: Pick<InventoryItem, 'labelVi' | 'labelEn'>,
  locale: Locale,
): string | null =>
  (locale === 'vi' ? (item.labelVi ?? item.labelEn) : (item.labelEn ?? item.labelVi)) ?? null;

/** "Product (label)" for titles and option texts. */
export function itemTitle(
  item: Pick<InventoryItem, 'productNameVi' | 'productNameEn' | 'labelVi' | 'labelEn'>,
  locale: Locale,
): string {
  const label = itemLabel(item, locale);
  return label ? `${itemName(item, locale)} (${label})` : itemName(item, locale);
}

export interface StockFlags {
  /** Nothing on hand. */
  out: boolean;
  /** On hand at or below the low-stock level (and something is left). */
  low: boolean;
  /** Units in lots past their date. */
  expired: boolean;
  /** A lot expires within the warning window and none has expired yet. */
  expiring: boolean;
}

export function stockFlags(item: InventoryItem): StockFlags {
  const out = item.onHand === 0;
  return {
    out,
    low: !out && item.lowStock,
    expired: item.expiredQuantity > 0,
    expiring: item.expiryAlert && item.expiredQuantity === 0,
  };
}

/** Whether the item matches a status choice of the toolbar filter. */
export function matchesStockStatus(item: InventoryItem, status: string): boolean {
  const flags = stockFlags(item);
  switch (status) {
    case 'low':
      return item.lowStock;
    case 'out':
      return flags.out;
    case 'expiry':
      return flags.expired || flags.expiring;
    case 'ok':
      return !flags.out && !flags.low && !flags.expired && !flags.expiring;
    default:
      return true;
  }
}

export function filterStock(
  items: readonly InventoryItem[],
  state: Pick<InventoryListState, 'q' | 'status'>,
): InventoryItem[] {
  const query = normalizeSearch(state.q);
  return items.filter((item) => {
    if (state.status !== '' && !matchesStockStatus(item, state.status)) return false;
    if (query === '') return true;
    return [
      item.productNameVi,
      item.productNameEn,
      item.labelVi ?? '',
      item.labelEn ?? '',
      item.sku,
    ].some((field) => normalizeSearch(field).includes(query));
  });
}

export function stockSortValue(item: InventoryItem, key: string, locale: Locale): SortValue {
  if (key === 'sku') return item.sku;
  if (key === 'onHand') return item.onHand;
  if (key === 'available') return item.available;
  if (key === 'expiry') return item.nextExpiry ?? '9999-12-31';
  return itemTitle(item, locale);
}

// ------------------------------------------------------------------------------------------------------- receipts

export const receiptTone = (status: StockReceiptStatusName): 'warning' | 'success' | 'neutral' =>
  status === 'DRAFT' ? 'warning' : status === 'CONFIRMED' ? 'success' : 'neutral';

export function filterReceipts(
  receipts: readonly StockReceiptListItem[],
  state: Pick<InventoryListState, 'q' | 'rstatus'>,
): StockReceiptListItem[] {
  const query = normalizeSearch(state.q);
  return receipts.filter((receipt) => {
    if (state.rstatus !== '' && receipt.status !== state.rstatus) return false;
    if (query === '') return true;
    return [receipt.code, receipt.supplierName ?? ''].some((field) =>
      normalizeSearch(field).includes(query),
    );
  });
}

export interface ReceiptLineDraft {
  /** A stable key for the row (never sent). */
  key: string;
  variantId: string;
  quantity: string;
  lotCode: string;
  expiryDate: string;
  unitCost: string;
}

export interface ReceiptDraft {
  supplierId: string;
  receiptDate: string;
  notes: string;
  lines: ReceiptLineDraft[];
}

export const emptyLineDraft = (key: string): ReceiptLineDraft => ({
  key,
  variantId: '',
  quantity: '',
  lotCode: '',
  expiryDate: '',
  unitCost: '',
});

export const emptyReceiptDraft = (today: string): ReceiptDraft => ({
  supplierId: '',
  receiptDate: today,
  notes: '',
  lines: [emptyLineDraft('line-1')],
});

export const draftFromReceipt = (receipt: StockReceiptResponse): ReceiptDraft => ({
  supplierId: receipt.supplierId ?? '',
  receiptDate: receipt.receiptDate,
  notes: receipt.notes ?? '',
  lines: receipt.lines.map((line) => ({
    key: `line-${line.lineNo}`,
    variantId: line.variantId,
    quantity: String(line.quantity),
    lotCode: line.lotCode ?? '',
    expiryDate: line.expiryDate ?? '',
    unitCost: line.unitCostVnd ?? '',
  })),
});

export type LineField = 'variantId' | 'quantity' | 'lotCode' | 'expiryDate' | 'unitCost';
export interface ReceiptErrors {
  receiptDate?: Issue;
  notes?: Issue;
  /** No line at all. */
  noLines?: boolean;
  lines: Record<string, Partial<Record<LineField, Issue>>>;
}

export const RECEIPT_NOTES_MAX = 500;
export const LOT_CODE_MAX = 64;
export const QUANTITY_MAX = 1_000_000;

/** `cost`: the caller may see and enter a unit cost. `today`: an expiry date before it is refused. */
export function validateReceiptDraft(
  draft: ReceiptDraft,
  mode: { cost: boolean; today: string },
): ReceiptErrors {
  const errors: ReceiptErrors = { lines: {} };
  if (!isCalendarDate(draft.receiptDate)) errors.receiptDate = 'invalid';
  if (length(clean(draft.notes)) > RECEIPT_NOTES_MAX) errors.notes = 'invalid';
  if (draft.lines.length === 0) errors.noLines = true;
  for (const line of draft.lines) {
    const issues: Partial<Record<LineField, Issue>> = {};
    if (line.variantId === '') issues.variantId = 'required';
    const quantity = line.quantity.trim() === '' ? null : wholeNumber(line.quantity, QUANTITY_MAX);
    if (line.quantity.trim() === '') issues.quantity = 'required';
    else if (quantity === null || quantity < 1) issues.quantity = 'invalid';
    if (length(clean(line.lotCode)) > LOT_CODE_MAX) issues.lotCode = 'invalid';
    if (line.expiryDate.trim() !== '') {
      if (!isCalendarDate(line.expiryDate) || line.expiryDate < mode.today) {
        issues.expiryDate = 'invalid';
      }
    }
    if (mode.cost && line.unitCost.trim() !== '' && vndAmount(line.unitCost, 0) === null) {
      issues.unitCost = 'invalid';
    }
    if (Object.keys(issues).length > 0) errors.lines[line.key] = issues;
  }
  return errors;
}

export const receiptDraftValid = (errors: ReceiptErrors): boolean =>
  !errors.receiptDate && !errors.notes && !errors.noLines && Object.keys(errors.lines).length === 0;

function lineRequest(line: ReceiptLineDraft, cost: boolean): StockReceiptLineRequest {
  const request: StockReceiptLineRequest = {
    variantId: line.variantId,
    quantity: wholeNumber(line.quantity, QUANTITY_MAX)!,
    lotCode: clean(line.lotCode) === '' ? null : clean(line.lotCode),
    expiryDate: line.expiryDate.trim() === '' ? null : line.expiryDate.trim(),
  };
  // Without the cost permission the key is never sent (the API refuses it, and keeps the stored cost of an edited line).
  if (cost) request.unitCostVnd = line.unitCost.trim() === '' ? null : vndAmount(line.unitCost, 0)!;
  return request;
}

export function receiptCreateRequest(
  draft: ReceiptDraft,
  branchId: string,
  mode: { cost: boolean; today: string },
): StockReceiptCreateRequest | null {
  if (!receiptDraftValid(validateReceiptDraft(draft, mode))) return null;
  return {
    branchId,
    supplierId: draft.supplierId === '' ? null : draft.supplierId,
    receiptDate: draft.receiptDate.trim(),
    notes: clean(draft.notes) === '' ? null : clean(draft.notes),
    lines: draft.lines.map((line) => lineRequest(line, mode.cost)),
  };
}

export function receiptEditRequest(
  draft: ReceiptDraft,
  rowVersion: number,
  mode: { cost: boolean; today: string },
): StockReceiptEditRequest | null {
  const create = receiptCreateRequest(draft, '', mode);
  if (!create) return null;
  const { branchId: _branch, ...rest } = create;
  void _branch;
  return { expectedRowVersion: rowVersion, ...rest };
}

/** The text of a variant option: `SKU · Product (label)`. */
export function variantOptionLabel(
  option: {
    sku: string;
    productNameVi: string;
    productNameEn: string;
    labelVi: string | null;
    labelEn: string | null;
  },
  locale: Locale,
): string {
  return `${option.sku} · ${itemTitle(option, locale)}`;
}

// ---------------------------------------------------------------------------------------------------- adjustment

export const ADJUST_REASONS: readonly Exclude<StockAdjustmentReasonName, 'COUNT_CORRECTION'>[] = [
  'INTERNAL_USE',
  'TESTER',
  'DAMAGED',
  'EXPIRED',
  'LOSS',
];

export interface AdjustDraft {
  lotId: string;
  quantity: string;
  reason: string;
  note: string;
}

/** The first lot that still holds stock (the API lists them earliest expiry first). */
export const defaultLot = (lots: readonly InventoryLotResponse[]): InventoryLotResponse | null =>
  lots.find((lot) => lot.quantityOnHand > 0) ?? null;

export const emptyAdjustDraft = (lots: readonly InventoryLotResponse[]): AdjustDraft => ({
  lotId: defaultLot(lots)?.id ?? '',
  quantity: '',
  reason: '',
  note: '',
});

export function validateAdjustDraft(
  draft: AdjustDraft,
  lots: readonly InventoryLotResponse[],
): Partial<Record<'lotId' | 'quantity' | 'reason' | 'note', Issue>> {
  const errors: Partial<Record<'lotId' | 'quantity' | 'reason' | 'note', Issue>> = {};
  const lot = lots.find((entry) => entry.id === draft.lotId && entry.quantityOnHand > 0);
  if (!lot) errors.lotId = 'required';
  const quantity = draft.quantity.trim() === '' ? null : wholeNumber(draft.quantity, QUANTITY_MAX);
  if (draft.quantity.trim() === '') errors.quantity = 'required';
  else if (quantity === null || quantity < 1 || (lot && quantity > lot.quantityOnHand)) {
    errors.quantity = 'invalid';
  }
  if (!(ADJUST_REASONS as readonly string[]).includes(draft.reason)) errors.reason = 'required';
  if (length(clean(draft.note)) > RECEIPT_NOTES_MAX) errors.note = 'invalid';
  return errors;
}

export function adjustRequest(
  draft: AdjustDraft,
  lots: readonly InventoryLotResponse[],
  target: { requestKey: string; branchId: string; variantId: string },
): StockAdjustmentRequest | null {
  if (Object.keys(validateAdjustDraft(draft, lots)).length > 0) return null;
  return {
    ...target,
    lotId: draft.lotId,
    quantity: wholeNumber(draft.quantity, QUANTITY_MAX)!,
    reason: draft.reason as StockAdjustmentRequest['reason'],
    note: clean(draft.note) === '' ? null : clean(draft.note),
  };
}

// -------------------------------------------------------------------------------------------------------- counts

export const countTone = (status: StockCountStatusName): 'warning' | 'success' | 'neutral' =>
  status === 'OPEN' ? 'warning' : status === 'APPROVED' ? 'success' : 'neutral';

/** The counted quantity typed for a line, or null when it is not a whole number of 0 or more. */
export const parseCounted = (text: string): number | null =>
  text.trim() === '' ? null : wholeNumber(text, QUANTITY_MAX);

/** counted - system, where the system quantity is the live one while the count is open. Null while the text is not a number. */
export function countDifference(
  line: StockCountLineResponse,
  counted: number | null,
): number | null {
  const system = line.systemQuantity ?? line.currentOnHand;
  if (counted === null || system === null) return null;
  return counted - system;
}

export function differenceText(difference: number | null): string {
  if (difference === null) return '—';
  return difference > 0 ? `+${difference}` : String(difference);
}

/** The draft values of an open count: one text per line, from what is saved. */
export const countValues = (count: StockCountResponse): Record<string, string> =>
  Object.fromEntries(count.lines.map((line) => [line.variantId, String(line.countedQuantity)]));

/** Lines whose typed value differs from the saved one; null when some typed value is not a whole number. */
export function changedCountLines(
  count: StockCountResponse,
  values: Readonly<Record<string, string>>,
): { variantId: string; countedQuantity: number }[] | null {
  const changed: { variantId: string; countedQuantity: number }[] = [];
  for (const line of count.lines) {
    const typed = values[line.variantId] ?? String(line.countedQuantity);
    const counted = parseCounted(typed);
    if (counted === null) return null;
    if (counted !== line.countedQuantity)
      changed.push({ variantId: line.variantId, countedQuantity: counted });
  }
  return changed;
}

export function countLinesRequest(
  count: StockCountResponse,
  values: Readonly<Record<string, string>>,
  removed: readonly string[] = [],
): StockCountLinesRequest | null {
  const changed = changedCountLines(count, values);
  if (changed === null) return null;
  return {
    expectedRowVersion: count.rowVersion,
    lines: changed.filter((line) => !removed.includes(line.variantId)),
    removeVariantIds: [...removed],
  };
}

/** A new line for a variant that is not in the count yet. */
export function countAddRequest(
  count: Pick<StockCountResponse, 'rowVersion' | 'lines'>,
  variantId: string,
  countedText: string,
): StockCountLinesRequest | null {
  const counted = parseCounted(countedText);
  if (variantId === '' || counted === null) return null;
  if (count.lines.some((line) => line.variantId === variantId)) return null;
  return {
    expectedRowVersion: count.rowVersion,
    lines: [{ variantId, countedQuantity: counted }],
    removeVariantIds: [],
  };
}

// ------------------------------------------------------------------------------------------------------ suppliers

export interface SupplierDraft {
  name: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  isActive: boolean;
}

export const emptySupplierDraft = (): SupplierDraft => ({
  name: '',
  contactName: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
  isActive: true,
});

export const draftFromSupplier = (supplier: SupplierResponse): SupplierDraft => ({
  name: supplier.name,
  contactName: supplier.contactName ?? '',
  phone: supplier.phone ?? '',
  email: supplier.email ?? '',
  address: supplier.address ?? '',
  notes: supplier.notes ?? '',
  isActive: supplier.isActive,
});

export type SupplierField = 'name' | 'contactName' | 'phone' | 'email' | 'address' | 'notes';

export function validateSupplierDraft(draft: SupplierDraft): Partial<Record<SupplierField, Issue>> {
  const errors: Partial<Record<SupplierField, Issue>> = {};
  const name = clean(draft.name);
  if (name === '') errors.name = 'required';
  else if (length(name) > 200) errors.name = 'invalid';
  if (length(clean(draft.contactName)) > 200) errors.contactName = 'invalid';
  if (length(clean(draft.phone)) > 40) errors.phone = 'invalid';
  const email = clean(draft.email);
  if (email !== '' && (length(email) > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    errors.email = 'invalid';
  }
  if (length(clean(draft.address)) > 500) errors.address = 'invalid';
  if (length(clean(draft.notes)) > 500) errors.notes = 'invalid';
  return errors;
}

const optionalText = (text: string): string | null => (clean(text) === '' ? null : clean(text));

export function supplierCreateRequest(draft: SupplierDraft): SupplierCreateRequest | null {
  if (Object.keys(validateSupplierDraft(draft)).length > 0) return null;
  return {
    name: clean(draft.name),
    contactName: optionalText(draft.contactName),
    phone: optionalText(draft.phone),
    email: optionalText(draft.email),
    address: optionalText(draft.address),
    notes: optionalText(draft.notes),
  };
}

export function supplierEditRequest(
  draft: SupplierDraft,
  supplier: Pick<SupplierResponse, 'rowVersion'>,
): SupplierEditRequest | null {
  const create = supplierCreateRequest(draft);
  if (!create) return null;
  return { ...create, expectedRowVersion: supplier.rowVersion, isActive: draft.isActive };
}

// ---------------------------------------------------------------------------------------------------------- errors

/** The field a failed request names ("quantity", "lines"...), or null. */
export const failedField = (error: unknown): string | null =>
  error instanceof ApiError ? error.field : null;

/**
 * The text of a failed inventory command: its own texts first (the P6-4 codes, a taken supplier name, the reload message after a
 * conflict, the named field of a refused value), then the shared ones.
 */
export function inventoryErrorText(
  error: unknown,
  locale: Locale,
  fallback: (error: unknown) => string,
): string {
  if (error instanceof ApiError) {
    const texts = inventoryDictionary(locale).errors;
    if (error.code === 'CONFLICT') {
      if (error.field === 'name') return texts.name;
      if (error.field === 'requestKey') return texts.requestKey;
      return texts.conflict;
    }
    if (error.code === 'VALIDATION_FAILED' && error.field) {
      const named = (texts.fields as Record<string, string>)[error.field];
      if (named) return named;
    }
    const own = (texts as Record<string, unknown>)[error.code];
    if (typeof own === 'string') return own;
  }
  return fallback(error);
}

export const isConflict = (error: unknown): boolean =>
  error instanceof ApiError && error.code === 'CONFLICT' && error.field === null;
