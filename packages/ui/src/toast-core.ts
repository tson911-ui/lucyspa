export type ToastTone = 'success' | 'info' | 'warning' | 'danger';

export interface ToastData {
  id: string;
  tone: ToastTone;
  message: string;
  title?: string | undefined;
  /** One action in the toast (C72 undo: "Hoàn tác"). A toast with an action stays 8 s (ACTION_TOAST_DURATION_MS). */
  action?: { label: string; onAction: () => void } | undefined;
}

/** More than this many toasts at once is noise: the oldest are dropped. */
export const MAX_TOASTS = 4;
export const TOAST_DURATION_MS = 5000;
/** A toast that offers an action (undo) stays longer, so there is time to reach it (DESIGN 8.6). */
export const ACTION_TOAST_DURATION_MS = 8000;

export function addToast(list: readonly ToastData[], toast: ToastData): ToastData[] {
  return [...list.filter((item) => item.id !== toast.id), toast].slice(-MAX_TOASTS);
}

export function removeToast(list: readonly ToastData[], id: string): ToastData[] {
  return list.filter((item) => item.id !== id);
}
