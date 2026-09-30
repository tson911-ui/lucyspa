'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from './icons';
import {
  addToast,
  removeToast,
  TOAST_DURATION_MS,
  type ToastData,
  type ToastTone,
} from './toast-core';

// Non-blocking feedback (contract section 7): bottom-right on desktop, bottom on a phone, 5 s,
// `role="status"`. Hovering or focusing a toast pauses its timer so it can be read and dismissed.

export interface ToastInput {
  tone?: ToastTone | undefined;
  message: string;
  title?: string | undefined;
}

interface ToastApi {
  push: (toast: ToastInput) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const icons: Record<ToastTone, IconName> = {
  success: 'check-circle',
  info: 'info',
  warning: 'alert-triangle',
  danger: 'x-circle',
};

export function ToastProvider({
  children,
  regionLabel,
  dismissLabel,
  duration = TOAST_DURATION_MS,
}: {
  children: ReactNode;
  /** Accessible name of the toast region, e.g. "Notifications". */
  regionLabel: string;
  dismissLabel: string;
  duration?: number | undefined;
}) {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const counter = useRef(0);
  const dismiss = useCallback((id: string) => setToasts((list) => removeToast(list, id)), []);
  const push = useCallback((toast: ToastInput) => {
    counter.current += 1;
    const id = `toast-${counter.current}`;
    setToasts((list) => addToast(list, { ...toast, id, tone: toast.tone ?? 'info' }));
    return id;
  }, []);
  const api = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext value={api}>
      {children}
      <div className="ls-toast-region" role="region" aria-label={regionLabel}>
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            duration={duration}
            dismissLabel={dismissLabel}
            onDismiss={dismiss}
          />
        ))}
      </div>
    </ToastContext>
  );
}

function ToastItem({
  toast,
  duration,
  dismissLabel,
  onDismiss,
}: {
  toast: ToastData;
  duration: number;
  dismissLabel: string;
  onDismiss: (id: string) => void;
}) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return undefined;
    const handle = setTimeout(() => onDismiss(toast.id), duration);
    return () => clearTimeout(handle);
  }, [paused, duration, toast.id, onDismiss]);
  return (
    <div
      className={`ls-toast ls-toast-${toast.tone}`}
      role="status"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon name={icons[toast.tone]} className="ls-toast-icon" />
      <div className="ls-toast-body">
        {toast.title ? <p className="ls-toast-title">{toast.title}</p> : null}
        <p>{toast.message}</p>
      </div>
      <button
        type="button"
        className="ls-notice-close"
        aria-label={dismissLabel}
        onClick={() => onDismiss(toast.id)}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}
