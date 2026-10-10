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
  | 'PERMISSION_RECORD'
  | 'PERMISSION_COVERAGE'
  | 'PERMISSION_CONFIRMATION'
  /** P9-3: no confirmed, successful Test Source yet (the status is not READY). */
  | 'TEST_REQUIRED';

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

// ---------------------------------------------------------------------------------------------------------- Test Source (P9-3)

export const SOURCE_TEST_STATUSES = ['QUEUED', 'RUNNING', 'PASSED', 'FAILED'] as const;
export type SourceTestStatus = (typeof SOURCE_TEST_STATUSES)[number];

/** One product of the 20-product sample a Test Source reads (page 1 of the site's product list). */
export interface SourceTestSampleEntry {
  key: string;
  name: string;
  sku: string | null;
  url: string;
  type: string;
  brandText: string | null;
  categoryNames: string[];
  /** Reference only. Absent for a caller without MANAGE_PRODUCT_PRICES. */
  priceVnd?: number | null;
  promoPriceVnd?: number | null;
  currency: string;
  imageCount: number;
  firstImageUrl: string | null;
  descriptionLength: number;
  variationCount: number;
  problems: string[];
}

export interface SourceTestSummary {
  total: number | null;
  sampled: number;
  usable: number;
  withSku: number;
  withPrice: number;
  withImages: number;
  withCategory: number;
  withDescription: number;
  robots: 'ALLOWED' | 'NO_FILE';
  crawlDelaySeconds: number | null;
}

export interface SourceTestProblemGroup {
  code: string;
  count: number;
  keys: string[];
}

export interface SupplierSourceTestItem {
  id: string;
  status: SourceTestStatus;
  baseUrl: string;
  requestedAt: string;
  requestedBy: { id: string; name: string };
  startedAt: string | null;
  finishedAt: string | null;
  failure: {
    code: string;
    detail: string | null;
    sourceStatus: SupplierSourceStatus | null;
  } | null;
  summary: SourceTestSummary | null;
  sample: SourceTestSampleEntry[];
  problems: SourceTestProblemGroup[];
  requestCount: number;
  confirmedAt: string | null;
  confirmedBy: { id: string; name: string } | null;
  /** True when a person may confirm this test now: passed, unconfirmed, the latest one, for the source's current address. */
  canConfirm: boolean;
}

/** GET /api/v1/supplier-sources/:id/tests: the latest tests of one source, newest first (at most ten). */
export interface SupplierSourceTestListResponse {
  items: SupplierSourceTestItem[];
  /** False when the supplier prices were removed from the sample (the caller lacks MANAGE_PRODUCT_PRICES). */
  pricesVisible: boolean;
}

/** POST /api/v1/supplier-sources/:id/tests: queue a Test Source (MANAGE_SUPPLIER_SOURCES, permission confirmed first). */
export interface SupplierSourceTestRequest {
  expectedVersion: number;
}

export interface SupplierSourceTestResponse {
  item: SupplierSourceTestItem;
}

/** POST /api/v1/supplier-sources/:id/tests/:testId/confirm: a person confirms the passed sample; the source becomes READY. */
export interface SupplierSourceTestConfirmResponse {
  item: SupplierSourceItem;
  test: SupplierSourceTestItem;
}
