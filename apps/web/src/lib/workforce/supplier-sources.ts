import type {
  SupplierSourceCadence,
  SupplierSourceCreateRequest,
  SupplierSourceEditRequest,
  SupplierSourceItem,
  SupplierSourceKind,
  SupplierSourcePermissionRequest,
  SupplierSourceTestItem,
} from '@lucy-spa/contracts';
import {
  SUPPLIER_NAME_MAX,
  SUPPLIER_SOURCE_NAME_MAX,
  SUPPLIER_SOURCE_PERMISSION_FIELD_MAX,
  SUPPLIER_SOURCE_PERMISSION_NOTE_MAX,
} from '@lucy-spa/contracts';
import { supplierSourcesDictionary } from '../../i18n/supplier-sources';
import type { Locale } from '../../i18n/locales';
import { ApiError } from './api';

/**
 * Phase 9 P9-2: the pure side of the supplier source screen. The server is the authority for every rule (address, permission gate,
 * versions); these checks only keep an obviously wrong form from being sent and give the person a sentence for each problem.
 */

export {
  SUPPLIER_NAME_MAX,
  SUPPLIER_SOURCE_NAME_MAX,
  SUPPLIER_SOURCE_PERMISSION_FIELD_MAX,
  SUPPLIER_SOURCE_PERMISSION_NOTE_MAX,
};

/** Marks "a supplier that is not in the list yet" in the supplier select. */
export const NEW_SUPPLIER = '__new__';

export interface SourceDraft {
  supplierId: string;
  supplierName: string;
  name: string;
  kind: SupplierSourceKind;
  baseUrl: string;
}

export function emptySourceDraft(firstSupplierId: string | null): SourceDraft {
  return {
    supplierId: firstSupplierId ?? NEW_SUPPLIER,
    supplierName: '',
    name: '',
    kind: 'WEBSITE',
    baseUrl: '',
  };
}

/** The shape the server accepts for a source address: https, a host name with a dot, no port, credentials, query or fragment. */
export function looksLikeSourceUrl(text: string): boolean {
  const value = text.trim();
  if (value.length === 0 || value.length > 500 || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.port === '' &&
      url.search === '' &&
      url.hash === '' &&
      url.hostname.includes('.') &&
      !/^[\d.]+$/.test(url.hostname) &&
      !url.hostname.startsWith('[')
    );
  } catch {
    return false;
  }
}

export type SourceProblems = Partial<
  Record<'supplier' | 'supplierName' | 'name' | 'baseUrl', true>
>;

export function validateSource(draft: SourceDraft): SourceProblems {
  const problems: SourceProblems = {};
  if (draft.supplierId === NEW_SUPPLIER) {
    const name = draft.supplierName.trim();
    if (name === '' || name.length > SUPPLIER_NAME_MAX) problems.supplierName = true;
  } else if (draft.supplierId === '') {
    problems.supplier = true;
  }
  const name = draft.name.trim();
  if (name === '' || name.length > SUPPLIER_SOURCE_NAME_MAX) problems.name = true;
  if (draft.kind !== 'FILE' && !looksLikeSourceUrl(draft.baseUrl)) problems.baseUrl = true;
  return problems;
}

export function sourceCreateRequest(draft: SourceDraft): SupplierSourceCreateRequest {
  return {
    ...(draft.supplierId === NEW_SUPPLIER
      ? { supplierName: draft.supplierName.trim() }
      : { supplierId: draft.supplierId }),
    name: draft.name.trim(),
    kind: draft.kind,
    baseUrl: draft.kind === 'FILE' ? null : draft.baseUrl.trim(),
  };
}

export interface EditDraft {
  name: string;
  baseUrl: string;
  scanCadence: SupplierSourceCadence;
}

export const editDraftOf = (item: SupplierSourceItem): EditDraft => ({
  name: item.name,
  baseUrl: item.baseUrl ?? '',
  scanCadence: item.scanCadence,
});

export function validateEdit(draft: EditDraft, item: SupplierSourceItem): SourceProblems {
  const problems: SourceProblems = {};
  const name = draft.name.trim();
  if (name === '' || name.length > SUPPLIER_SOURCE_NAME_MAX) problems.name = true;
  if (item.kind !== 'FILE' && !looksLikeSourceUrl(draft.baseUrl)) problems.baseUrl = true;
  return problems;
}

/** Only what changed, with the version the form was read at; `null` when nothing changed. */
export function editRequest(
  draft: EditDraft,
  item: SupplierSourceItem,
): SupplierSourceEditRequest | null {
  const body: SupplierSourceEditRequest = { expectedVersion: item.rowVersion };
  let changed = false;
  if (draft.name.trim() !== item.name) {
    body.name = draft.name.trim();
    changed = true;
  }
  if (item.kind !== 'FILE' && draft.baseUrl.trim() !== (item.baseUrl ?? '')) {
    body.baseUrl = draft.baseUrl.trim();
    changed = true;
  }
  if (draft.scanCadence !== item.scanCadence) {
    body.scanCadence = draft.scanCadence;
    changed = true;
  }
  return changed ? body : null;
}

export interface PermissionDraft {
  givenBy: string;
  method: string;
  date: string;
  note: string;
  permitsText: boolean;
  permitsImages: boolean;
  permitsPrices: boolean;
}

export const permissionDraftOf = (item: SupplierSourceItem): PermissionDraft => ({
  givenBy: item.permission.givenBy ?? '',
  method: item.permission.method ?? '',
  date: item.permission.date ?? '',
  note: item.permission.note ?? '',
  permitsText: item.permission.permitsText,
  permitsImages: item.permission.permitsImages,
  permitsPrices: item.permission.permitsPrices,
});

/** Today's date in the shop's time zone (`YYYY-MM-DD`): the latest day a permission may be dated. */
export function shopToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export type PermissionProblems = Partial<Record<'givenBy' | 'method' | 'date', true>>;

export function validatePermission(draft: PermissionDraft, today: string): PermissionProblems {
  const problems: PermissionProblems = {};
  const given = draft.givenBy.trim();
  const method = draft.method.trim();
  if (given === '' || given.length > SUPPLIER_SOURCE_PERMISSION_FIELD_MAX) problems.givenBy = true;
  if (method === '' || method.length > SUPPLIER_SOURCE_PERMISSION_FIELD_MAX) problems.method = true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || draft.date > today) problems.date = true;
  return problems;
}

/** The record as it is, with the version the form was read at; `null` when it equals what is stored. */
export function permissionRequest(
  draft: PermissionDraft,
  item: SupplierSourceItem,
): SupplierSourcePermissionRequest | null {
  const note = draft.note.trim();
  const stored = permissionDraftOf(item);
  if (
    draft.givenBy.trim() === stored.givenBy &&
    draft.method.trim() === stored.method &&
    draft.date === stored.date &&
    note === stored.note &&
    draft.permitsText === stored.permitsText &&
    draft.permitsImages === stored.permitsImages &&
    draft.permitsPrices === stored.permitsPrices
  ) {
    return null;
  }
  return {
    expectedVersion: item.rowVersion,
    givenBy: draft.givenBy.trim(),
    method: draft.method.trim(),
    date: draft.date,
    note: note === '' ? null : note,
    permitsText: draft.permitsText,
    permitsImages: draft.permitsImages,
    permitsPrices: draft.permitsPrices,
  };
}

export type PermissionState = 'confirmed' | 'pending' | 'none';

/** What the permission column shows: confirmed, recorded but waiting for confirmation, or not recorded at all. */
export function permissionState(item: SupplierSourceItem): PermissionState {
  if (item.permission.confirmedAt !== null) return 'confirmed';
  return item.permission.givenBy !== null ? 'pending' : 'none';
}

/** The menu a row offers, in order. Reviewers (who cannot manage) get none. */
export type SourceAction = 'edit' | 'permission' | 'confirm' | 'test' | 'enable' | 'disable';

export function sourceActions(item: SupplierSourceItem, canManage: boolean): SourceAction[] {
  if (!canManage) return [];
  const actions: SourceAction[] = ['edit', 'permission'];
  const state = permissionState(item);
  if (state === 'pending') actions.push('confirm');
  // Nothing is read from a supplier's site before the permission is confirmed (and a file source has nothing to read yet).
  if (state === 'confirmed' && item.kind !== 'FILE') actions.push('test');
  if (item.isEnabled) actions.push('disable');
  else if (item.gaps.length === 0) actions.push('enable');
  return actions;
}

/** This area's own words for a refused command; anything else falls back to the caller's message. */
export function sourceErrorText(
  error: unknown,
  locale: Locale,
  fallback: (error: unknown) => string,
): string {
  if (error instanceof ApiError) {
    const known = supplierSourcesDictionary(locale).errors as Record<string, string>;
    const text = Object.hasOwn(known, error.code) ? known[error.code] : undefined;
    if (text) return text;
  }
  return fallback(error);
}

export const isSourceConflict = (error: unknown): boolean =>
  error instanceof ApiError && error.code === 'CONFLICT';

/** The field a refused command names, so the form can mark it. */
export const fieldOfSourceError = (error: unknown): string | null =>
  error instanceof ApiError ? (error.field ?? null) : null;

/** Tone of the source status badge: READY is good, not tested yet is neutral, everything else needs attention. */
export function statusTone(
  status: SupplierSourceItem['status'],
): 'success' | 'neutral' | 'warning' | 'error' {
  if (status === 'READY') return 'success';
  if (status === 'PENDING_VALIDATION') return 'neutral';
  return status === 'SOURCE_ERROR' ? 'error' : 'warning';
}

/** Whether a test may be queued now: the permission is confirmed (no permission gap), the source has an address, none is running. */
export function canRunTest(
  item: SupplierSourceItem,
  latest: SupplierSourceTestItem | null,
): boolean {
  const permissionGap = item.gaps.some((gap) => gap.startsWith('PERMISSION_'));
  const active = latest?.status === 'QUEUED' || latest?.status === 'RUNNING';
  return item.kind !== 'FILE' && item.baseUrl !== null && !permissionGap && !active;
}
