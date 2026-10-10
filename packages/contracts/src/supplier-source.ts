/**
 * Phase 9 P9-2 (supplier product import; docs/PHASE9_PRODUCT_IMPORT.md). The supplier sources a product catalog can be read from and
 * the permission record that gates them (P9-T9). Reading needs MANAGE_SUPPLIER_SOURCES or REVIEW_SUPPLIER_IMPORTS; every change needs
 * MANAGE_SUPPLIER_SOURCES. Both are GLOBAL permissions. Nothing here fetches anything: the adapter and the scan arrive with P9-3.
 */

export const SUPPLIER_SOURCE_KINDS = ['WEBSITE', 'API', 'FEED', 'FILE'] as const;
export type SupplierSourceKind = (typeof SUPPLIER_SOURCE_KINDS)[number];

export const SUPPLIER_SOURCE_STATUSES = [
  'PENDING_VALIDATION',
  'READY',
  'ADAPTER_REQUIRED',
  'AUTHENTICATION_REQUIRED',
  'SOURCE_ERROR',
] as const;
export type SupplierSourceStatus = (typeof SUPPLIER_SOURCE_STATUSES)[number];

export const SUPPLIER_SOURCE_CADENCES = ['MANUAL', 'WEEKLY', 'DAILY'] as const;
export type SupplierSourceCadence = (typeof SUPPLIER_SOURCE_CADENCES)[number];

export const SUPPLIER_SOURCE_NAME_MAX = 120;
export const SUPPLIER_SOURCE_URL_MAX = 500;
export const SUPPLIER_SOURCE_PERMISSION_FIELD_MAX = 200;
export const SUPPLIER_SOURCE_PERMISSION_NOTE_MAX = 500;
export const SUPPLIER_NAME_MAX = 200;

/** What still stops a source from being enabled, in the order a person fixes it. */
export type SupplierSourceGap =
  'PERMISSION_RECORD' | 'PERMISSION_COVERAGE' | 'PERMISSION_CONFIRMATION';

export interface SupplierSourcePermission {
  givenBy: string | null;
  method: string | null;
  /** YYYY-MM-DD, the day the supplier gave the permission. */
  date: string | null;
  note: string | null;
  permitsText: boolean;
  permitsImages: boolean;
  /** Whether prices may be reused. Source prices stay internal reference data either way. */
  permitsPrices: boolean;
  confirmedAt: string | null;
  confirmedBy: { id: string; name: string } | null;
}

export interface SupplierSourceItem {
  id: string;
  supplier: { id: string; name: string };
  name: string;
  kind: SupplierSourceKind;
  baseUrl: string | null;
  adapterKey: string | null;
  status: SupplierSourceStatus;
  isEnabled: boolean;
  scanCadence: SupplierSourceCadence;
  permission: SupplierSourcePermission;
  /** Empty when the source can be enabled (or already is). */
  gaps: SupplierSourceGap[];
  lastSuccessAt: string | null;
  rowVersion: number;
  createdAt: string;
}

export interface SupplierSourceSupplier {
  id: string;
  name: string;
}

/** GET /api/v1/supplier-sources: the sources (newest first) and the suppliers a new source can belong to. */
export interface SupplierSourceListResponse {
  items: SupplierSourceItem[];
  suppliers: SupplierSourceSupplier[];
  /** True with MANAGE_SUPPLIER_SOURCES; a reviewer only reads. */
  canManage: boolean;
}

/**
 * POST /api/v1/supplier-sources. Give `supplierId` of an existing supplier, or `supplierName` to use (or create) one by that name.
 * A new source starts disabled, with no permission recorded and the status PENDING_VALIDATION.
 */
export interface SupplierSourceCreateRequest {
  supplierId?: string;
  supplierName?: string;
  name: string;
  kind: SupplierSourceKind;
  /** https only; required for every kind but FILE. */
  baseUrl?: string | null;
}

/** POST /api/v1/supplier-sources/:id/edit. The address and the kind cannot change while the source is enabled. */
export interface SupplierSourceEditRequest {
  expectedVersion: number;
  name?: string;
  baseUrl?: string | null;
  scanCadence?: SupplierSourceCadence;
}

/**
 * POST /api/v1/supplier-sources/:id/permission: records who gave the permission, how, when and for which content. Recording it
 * always clears an earlier confirmation and disables the source; a person confirms the new record afterwards.
 */
export interface SupplierSourcePermissionRequest {
  expectedVersion: number;
  givenBy: string;
  method: string;
  /** YYYY-MM-DD, not in the future. */
  date: string;
  note?: string | null;
  permitsText: boolean;
  permitsImages: boolean;
  permitsPrices: boolean;
}

/** POST /api/v1/supplier-sources/:id/confirm-permission, /enable and /disable. */
export interface SupplierSourceVersionRequest {
  expectedVersion: number;
}

export interface SupplierSourceResponse {
  item: SupplierSourceItem;
}
