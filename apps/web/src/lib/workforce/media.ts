import type { MediaAssetSummary, MediaUploadResponse, MediaVariantName } from '@lucy-spa/contracts';
import { formatBytes, precheckFile } from '@lucy-spa/ui';
import type { WorkforceApi } from './api';
import { normalizePage } from './list-view';

/**
 * Website media library (docs/UXUI_REDESIGN_DESIGN.md 16.3). The API pages the library (24 per page,
 * newest first) and searches filename and alt text, so the list state is the search and the page; it
 * lives in the address bar. The server stays authoritative for type, size and image content.
 */

export const MEDIA_PAGE_SIZE = 24;
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
export const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Uploads sent at the same time; the rest wait in the queue. */
export const MEDIA_UPLOAD_CONCURRENCY = 3;
export const MEDIA_ALT_MAX = 300;

/** The website content page: `tab` is the library (default), the popup list (Step 12) or the slider (Step 13). */
export type WebsiteTab = 'media' | 'popup' | 'slider';

export const MEDIA_LIST_DEFAULTS: { q: string; page: number; tab: string } = {
  q: '',
  page: 1,
  tab: 'media',
};
export type MediaListState = typeof MEDIA_LIST_DEFAULTS;
/** Keys that return to page 1 when the search changes. */
export const MEDIA_PAGE_KEYS: readonly string[] = ['page'];

export function normalizeMediaList(state: MediaListState): MediaListState {
  return {
    q: state.q.slice(0, 100),
    page: normalizePage(state.page),
    tab: state.tab === 'popup' || state.tab === 'slider' ? state.tab : 'media',
  };
}

export const mediaVariantUrl = (id: string, variant: MediaVariantName) =>
  `/api/v1/website/media/${id}/${variant}`;

/** "1,2 MB · 1920 × 800" */
export function mediaMeta(
  asset: Pick<MediaAssetSummary, 'bytes' | 'width' | 'height'>,
  decimalSeparator: string,
): string {
  return `${formatBytes(asset.bytes, decimalSeparator)} · ${asset.width} × ${asset.height}`;
}

/** Vietnamese alt text is required before an image is used on the website (Q-CM10). */
export const missingAlt = (asset: Pick<MediaAssetSummary, 'altVi'>): boolean => !asset.altVi;

export const trimmedAlt = (value: string): string | null => {
  const text = value.replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
};

/** The browser-side check that saves a round trip; the server decides. */
export function precheckMediaFile(file: { type: string; size: number }): 'type' | 'size' | null {
  const problem = precheckFile(file, { accept: MEDIA_TYPES, maxBytes: MEDIA_MAX_BYTES });
  return problem === 'type' || problem === 'size' ? problem : null;
}

// ------------------------------------------------------------------ upload queue

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'duplicate' | 'failed';

export interface UploadItem {
  readonly key: string;
  readonly name: string;
  readonly status: UploadStatus;
  /** 0-100 while uploading, `null` before the browser reports a size. */
  readonly progress: number | null;
  /** The failure (an `ApiError` or a precheck marker), shown as a message. */
  readonly error?: unknown;
}

export type UploadAction =
  | { type: 'add'; items: readonly UploadItem[] }
  | { type: 'start'; key: string }
  | { type: 'progress'; key: string; percent: number }
  | { type: 'finish'; key: string; duplicate: boolean }
  | { type: 'fail'; key: string; error: unknown }
  | { type: 'dismiss'; key: string }
  | { type: 'clear-finished' };

export function uploadReducer(state: readonly UploadItem[], action: UploadAction): UploadItem[] {
  const change = (key: string, patch: Partial<UploadItem>) =>
    state.map((item) => (item.key === key ? { ...item, ...patch } : item));
  switch (action.type) {
    case 'add':
      return [...state, ...action.items];
    case 'start':
      return change(action.key, { status: 'uploading', progress: null });
    case 'progress':
      return change(action.key, {
        progress: Math.min(100, Math.max(0, action.percent)),
      });
    case 'finish':
      return change(action.key, {
        status: action.duplicate ? 'duplicate' : 'done',
        progress: 100,
      });
    case 'fail':
      return change(action.key, { status: 'failed', error: action.error });
    case 'dismiss':
      return state.filter((item) => item.key !== action.key);
    case 'clear-finished':
      return state.filter((item) => item.status === 'queued' || item.status === 'uploading');
  }
}

/** The marker an item carries when the browser-side precheck refused the file. */
export class PrecheckError extends Error {
  constructor(readonly problem: 'type' | 'size') {
    super(problem);
    this.name = 'PrecheckError';
  }
}

export function uploadMedia(
  api: Pick<WorkforceApi, 'upload'>,
  file: File,
  control: { onProgress?: (percent: number) => void; signal?: AbortSignal } = {},
): Promise<MediaUploadResponse> {
  const form = new FormData();
  // Alt text is added afterwards in the detail drawer, where the image is visible.
  form.append('file', file, file.name);
  return api.upload<MediaUploadResponse>('/api/v1/website/media', form, control);
}
