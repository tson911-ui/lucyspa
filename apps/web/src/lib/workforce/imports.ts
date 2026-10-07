import {
  PRODUCT_IMPORT_COLUMNS,
  type ProductImportApplyRequest,
  type ProductImportDetailResponse,
  type ProductImportIssue,
  type ProductImportKindName,
  type ProductImportRowResponse,
  type ProductImportStatusName,
} from '@lucy-spa/contracts';
import { normalizeSearch } from '@lucy-spa/ui';
import { importDictionary } from '../../i18n/imports';
import type { Locale } from '../../i18n/locales';
import { fill } from '../../i18n/workforce';
import { ApiError } from './api';

/**
 * Phase 6 P6-5: the import screens' pure logic (the texts of row problems, file prechecks, row filters, the apply request). Nothing
 * here decides authority: the API sends only what the person may see and authorizes every request again. The cells of a price or
 * cost column exist only for someone who may see them, so a screen never has to hide a value.
 */

/** The size limit as people read it: whole megabytes (5 MB = 5 × 1024 × 1024 bytes). */
export const megabytes = (bytes: number): string => `${Math.round(bytes / 1024 / 1024)} MB`;

export const IMPORT_KINDS: readonly ProductImportKindName[] = ['CATALOG', 'OPENING_STOCK'];
export const IMPORT_EXTENSIONS = ['.xlsx', '.csv'] as const;

export type ImportRowFilter = 'all' | 'invalid' | 'valid';
export const IMPORT_FILTERS: readonly ImportRowFilter[] = ['all', 'invalid', 'valid'];

/** URL state of the job page: the row filter and search, and the table page. */
export const IMPORT_ROWS_DEFAULTS: { q: string; filter: string; page: number; pageSize: number } = {
  q: '',
  filter: 'all',
  page: 1,
  pageSize: 20,
};
export type ImportRowsState = typeof IMPORT_ROWS_DEFAULTS;
export const IMPORT_ROWS_PAGE_KEYS: readonly string[] = ['page'];

export function normalizeImportRows(state: ImportRowsState): ImportRowsState {
  return {
    q: state.q.slice(0, 100),
    filter: IMPORT_FILTERS.includes(state.filter as ImportRowFilter) ? state.filter : 'all',
    page: Number.isInteger(state.page) && state.page >= 1 ? state.page : 1,
    pageSize: [10, 20, 50].includes(state.pageSize) ? state.pageSize : 20,
  };
}

/** The template download for a kind (a GET with the session cookie: the browser saves the file). */
export function templateUrl(
  kind: ProductImportKindName,
  format: 'xlsx' | 'csv',
  locale: Locale,
): string {
  return `/api/v1/product-imports/template?kind=${kind}&format=${format}&lang=${locale}`;
}

/** The header the template shows for a column key (the key itself when the column is unknown). */
export function columnLabel(kind: ProductImportKindName, key: string, locale: Locale): string {
  return PRODUCT_IMPORT_COLUMNS[kind].find((column) => column.key === key)?.header[locale] ?? key;
}

// -------------------------------------------------------------------------------------------------- row problems

/** One row problem in words. Names the column exactly as the template headers it; never shows a price or a cost. */
export function issueText(
  issue: ProductImportIssue,
  kind: ProductImportKindName,
  locale: Locale,
): string {
  const values: Record<string, string | number> = {
    column: issue.field ? columnLabel(kind, issue.field, locale) : '',
    ...(issue.params ?? {}),
  };
  return fill(importDictionary(locale).issues[issue.code], values);
}

/** The "Ghi chú" of a row: its errors, then its warnings, or for a valid update the columns that change. */
export function rowNotes(
  row: ProductImportRowResponse,
  kind: ProductImportKindName,
  locale: Locale,
): { tone: 'error' | 'warning' | 'info'; text: string }[] {
  const text = importDictionary(locale);
  const notes: { tone: 'error' | 'warning' | 'info'; text: string }[] = [
    ...row.errors.map((issue) => ({
      tone: 'error' as const,
      text: issueText(issue, kind, locale),
    })),
    ...row.warnings.map((issue) => ({
      tone: 'warning' as const,
      text: issueText(issue, kind, locale),
    })),
  ];
  if (row.status === 'VALID' && row.action === 'UPDATE' && row.changes.length > 0) {
    notes.push({
      tone: 'info',
      text: fill(text.detail.changes, {
        columns: row.changes.map((key) => columnLabel(kind, key, locale)).join(', '),
      }),
    });
  }
  return notes;
}

export type RowOutcome = 'CREATE' | 'UPDATE' | 'NONE' | 'INVALID';
export const rowOutcome = (row: Pick<ProductImportRowResponse, 'status' | 'action'>): RowOutcome =>
  row.status === 'INVALID' ? 'INVALID' : row.action;

export const outcomeTone = (outcome: RowOutcome): 'success' | 'info' | 'neutral' | 'error' =>
  outcome === 'CREATE'
    ? 'success'
    : outcome === 'UPDATE'
      ? 'info'
      : outcome === 'NONE'
        ? 'neutral'
        : 'error';

export const statusTone = (
  status: ProductImportStatusName,
): 'success' | 'info' | 'neutral' | 'error' | 'warning' =>
  status === 'APPLIED'
    ? 'success'
    : status === 'PREVIEWED'
      ? 'warning'
      : status === 'FAILED'
        ? 'error'
        : 'neutral';

export function filterImportRows(
  rows: readonly ProductImportRowResponse[],
  filter: string,
  query: string,
): ProductImportRowResponse[] {
  const needle = normalizeSearch(query);
  return rows.filter((row) => {
    if (filter === 'invalid' && row.status !== 'INVALID') return false;
    if (filter === 'valid' && row.status !== 'VALID') return false;
    if (needle === '') return true;
    return [row.sku, row.title ?? ''].some((field) => normalizeSearch(field).includes(needle));
  });
}

// -------------------------------------------------------------------------------------------------- the upload form

export interface ImportUploadDraft {
  kind: ProductImportKindName;
  branchId: string;
  file: File | null;
}

export const emptyUploadDraft = (): ImportUploadDraft => ({
  kind: 'CATALOG',
  branchId: '',
  file: null,
});

/** Why a file is refused before it is sent: its extension or its size. The API checks again. */
export function precheckImportFile(
  file: Pick<File, 'name' | 'size'>,
  maxBytes: number,
): 'type' | 'size' | null {
  const name = file.name.toLowerCase();
  if (!IMPORT_EXTENSIONS.some((extension) => name.endsWith(extension))) return 'type';
  return file.size > maxBytes ? 'size' : null;
}

export function validateUpload(draft: ImportUploadDraft): {
  file?: 'required';
  branchId?: 'required';
} {
  return {
    ...(draft.file === null ? { file: 'required' as const } : {}),
    ...(draft.kind === 'OPENING_STOCK' && draft.branchId === ''
      ? { branchId: 'required' as const }
      : {}),
  };
}

export function uploadForm(draft: ImportUploadDraft): FormData {
  const form = new FormData();
  form.append('kind', draft.kind);
  if (draft.kind === 'OPENING_STOCK') form.append('branchId', draft.branchId);
  form.append('file', draft.file!, draft.file!.name);
  return form;
}

// -------------------------------------------------------------------------------------------------- apply

export const applyRequest = (
  job: Pick<ProductImportDetailResponse, 'rowVersion'>,
  skipInvalid: boolean,
): ProductImportApplyRequest => ({ expectedRowVersion: job.rowVersion, skipInvalid });

/** What a confirmation says: how many rows enter and how many are skipped. */
export function applySummary(
  job: Pick<ProductImportDetailResponse, 'createCount' | 'updateCount' | 'invalidCount'>,
) {
  return {
    entering: job.createCount + job.updateCount,
    create: job.createCount,
    update: job.updateCount,
    skipped: job.invalidCount,
  };
}

// -------------------------------------------------------------------------------------------------- errors

/** The text of a failed import command: the file's own reasons first, then the import codes, then the shared ones. */
export function importErrorText(
  error: unknown,
  locale: Locale,
  fallback: (error: unknown) => string,
  limits: { maxBytes: number; maxRows: number } = { maxBytes: 5_000_000, maxRows: 2_000 },
): string {
  if (error instanceof ApiError) {
    const texts = importDictionary(locale);
    if (error.code === 'IMPORT_FILE_INVALID' && error.field) {
      const template = (texts.fileProblems as Record<string, string>)[error.field];
      if (template) {
        return fill(template, {
          size: megabytes(limits.maxBytes),
          rows: limits.maxRows.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US'),
        });
      }
    }
    if (error.code === 'CONFLICT' && error.field === null) return texts.errors.conflict;
    if (error.code === 'VALIDATION_FAILED' && error.field === 'skipInvalid')
      return texts.errors.skipInvalid;
    if (error.code === 'HTTP_413') {
      return fill(texts.fileProblems.tooLarge, { size: megabytes(limits.maxBytes) });
    }
    const own = (texts.errors as Record<string, unknown>)[error.code];
    if (typeof own === 'string') return own;
  }
  return fallback(error);
}

export const isImportConflict = (error: unknown): boolean =>
  error instanceof ApiError &&
  ((error.code === 'CONFLICT' && error.field === null) ||
    error.code === 'IMPORT_JOB_NOT_PREVIEWED');
