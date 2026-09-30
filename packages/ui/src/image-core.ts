// Client-side checks and state for ImageUploader (docs/UXUI_REDESIGN_DESIGN.md 16.4). These prechecks
// only save the user a round trip; the server stays authoritative (type, size, magic bytes).

export const DEFAULT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export interface UploadedImage {
  url: string;
  name: string;
  sizeBytes: number;
  width?: number | undefined;
  height?: number | undefined;
}

export type PrecheckProblem = 'type' | 'size' | 'dimensions';

export function precheckFile(
  file: { type: string; size: number },
  rules: { accept: readonly string[]; maxBytes: number },
): PrecheckProblem | null {
  if (!rules.accept.includes(file.type)) return 'type';
  if (file.size > rules.maxBytes) return 'size';
  return null;
}

export function precheckDimensions(
  size: { width: number; height: number },
  rules: { minWidth?: number | undefined; minHeight?: number | undefined },
): PrecheckProblem | null {
  if (rules.minWidth !== undefined && size.width < rules.minWidth) return 'dimensions';
  if (rules.minHeight !== undefined && size.height < rules.minHeight) return 'dimensions';
  return null;
}

/** `1536000` -> `1.5 MB` (decimal units, one decimal at most). */
export function formatBytes(bytes: number, decimalSeparator = '.'): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const text = unit === 0 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '');
  return `${text.replace('.', decimalSeparator)} ${units[unit]}`;
}

export type UploaderState =
  | { status: 'idle' }
  | { status: 'uploading'; fileName: string; progress: number | null }
  | { status: 'error'; message: string; retryable: boolean };

export type UploaderAction =
  | { type: 'start'; fileName: string }
  | { type: 'progress'; progress: number }
  | { type: 'fail'; message: string; retryable: boolean }
  | { type: 'reset' };

export function uploaderReducer(state: UploaderState, action: UploaderAction): UploaderState {
  switch (action.type) {
    case 'start':
      return { status: 'uploading', fileName: action.fileName, progress: null };
    case 'progress':
      return state.status === 'uploading'
        ? { ...state, progress: Math.min(100, Math.max(0, action.progress)) }
        : state;
    case 'fail':
      return { status: 'error', message: action.message, retryable: action.retryable };
    case 'reset':
      return { status: 'idle' };
  }
}

/** Reads pixel size in the browser; `null` when the file is not a decodable image. */
export async function readImageSize(file: Blob): Promise<{ width: number; height: number } | null> {
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    }
  } catch {
    return null;
  }
  return null;
}
