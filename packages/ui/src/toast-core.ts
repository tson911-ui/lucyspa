export type ToastTone = 'success' | 'info' | 'warning' | 'danger';

export interface ToastData {
  id: string;
  tone: ToastTone;
  message: string;
  title?: string | undefined;
}

/** More than this many toasts at once is noise: the oldest are dropped. */
export const MAX_TOASTS = 4;
export const TOAST_DURATION_MS = 5000;

export function addToast(list: readonly ToastData[], toast: ToastData): ToastData[] {
  return [...list.filter((item) => item.id !== toast.id), toast].slice(-MAX_TOASTS);
}

export function removeToast(list: readonly ToastData[], id: string): ToastData[] {
  return list.filter((item) => item.id !== id);
}
