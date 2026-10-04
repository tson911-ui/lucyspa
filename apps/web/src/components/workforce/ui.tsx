'use client';

import {
  Badge as UiBadge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState as UiErrorState,
  LoadingState,
  Field as UiField,
  Notice as UiNotice,
  PageHeader as UiPageHeader,
  useOptionalToast,
  type Tone as UiTone,
} from '@lucy-spa/ui';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { ApiError } from '../../lib/workforce/api';
import { errorMessage } from '../../lib/workforce/workflows';

/** Screen title row: the shared `PageHeader`; `children` are the page actions (primary last). */
export function PageHeader({
  title,
  intro,
  breadcrumbs,
  children,
}: {
  title: string;
  intro?: string;
  /** Detail pages only (contract 4.1): the Breadcrumbs above the title. */
  breadcrumbs?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <UiPageHeader
      title={title}
      {...(intro ? { description: intro } : {})}
      {...(breadcrumbs ? { breadcrumbs } : {})}
      {...(children ? { actions: children } : {})}
    />
  );
}

/** One card with a heading and optional header actions: the single container surface of a screen. */
export function Section({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const headingId = useId();
  return (
    <Card as="section" aria-labelledby={headingId}>
      <CardHeader id={headingId} title={title} {...(actions ? { actions } : {})} />
      {children}
    </Card>
  );
}

export type Tone = 'success' | 'error' | 'info' | 'warning' | 'neutral';

// The shared components in packages/ui use 'danger' where the screens historically said 'error'.
const uiTone = (tone: Tone) => (tone === 'error' ? 'danger' : tone);

/** Status text always carries the meaning; color only reinforces it. */
export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <UiBadge tone={uiTone(tone)}>{children}</UiBadge>;
}

export function Notice({
  tone,
  children,
}: {
  tone: Exclude<Tone, 'neutral'>;
  children: ReactNode;
}) {
  return <UiNotice tone={uiTone(tone) as Exclude<UiTone, 'neutral'>}>{children}</UiNotice>;
}

/**
 * Skeleton placeholder while a screen's data loads (never a blank area). `page` is for a screen that returns this
 * alone before its first response (a title row and one card); the default fills a card or section body.
 */
export function Loading({ t, page = false }: { t: WorkforceDictionary; page?: boolean }) {
  return <LoadingState label={t.common.loading} variant={page ? 'page' : 'block'} />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <EmptyState icon={false}>{children}</EmptyState>;
}

export function ErrorState({
  error,
  t,
  onRetry,
}: {
  error: unknown;
  t: WorkforceDictionary;
  onRetry?: () => void;
}) {
  const reference = error instanceof ApiError ? error.requestId : null;
  return (
    <UiErrorState
      message={errorMessage(error, t)}
      reference={reference}
      referenceLabel={t.errors.reference}
      {...(onRetry ? { onRetry, retryLabel: t.common.reload } : {})}
    />
  );
}

export function Field({
  id,
  label,
  required,
  hint,
  labelAction,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  /** Link or button at the right end of the label row. */
  labelAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <UiField
      id={id}
      label={label}
      {...(required ? { required } : {})}
      {...(hint ? { hint } : {})}
      {...(labelAction ? { labelAction } : {})}
    >
      {children}
    </UiField>
  );
}

export function SubmitButton({
  pending,
  label,
  pendingLabel,
  tone = 'primary',
  disabled,
}: {
  pending: boolean;
  label: string;
  pendingLabel: string;
  tone?: 'primary' | 'danger' | 'quiet';
  disabled?: boolean;
}) {
  // Solid red is reserved for confirmation dialogs; inline destructive submits are outlined.
  const variant = tone === 'danger' ? 'danger-outline' : tone === 'quiet' ? 'secondary' : 'primary';
  return (
    <Button type="submit" variant={variant} loading={pending} disabled={disabled ?? false}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

export interface Resource<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => Promise<void>;
}

/** Loads one resource and exposes `reload` (used after commands and on 409 conflicts). */
export function useResource<T>(load: () => Promise<T>, deps: readonly unknown[]): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const loader = useRef(load);
  loader.current = load;
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const value = await loader.current();
      if (current === generation.current) {
        setData(value);
        setError(null);
      }
    } catch (failure) {
      if (current === generation.current) setError(failure);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, deps);
  return { data, error, loading, reload };
}

/**
 * Success feedback is a toast (contract section 7); errors stay in place. Returns
 * `notify(message, fallback)`: it pushes the toast, or runs `fallback` where no provider is
 * mounted (component tests, screens rendered outside the shell).
 */
export function useSuccessToast() {
  const toast = useOptionalToast();
  return useCallback(
    (message: string, fallback?: () => void) => {
      if (toast) toast.push({ tone: 'success', message });
      else fallback?.();
    },
    [toast],
  );
}

/**
 * Form submission state: blocks duplicate submits while pending and keeps the entered
 * values (owned by the form) after a recoverable error.
 */
export function useSubmit() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const busy = useRef(false);
  const notifySuccess = useSuccessToast();
  const notify = useRef(notifySuccess);
  notify.current = notifySuccess;
  const run = useCallback(
    async (work: () => Promise<{ ok: boolean; error?: unknown }>, successMessage: string) => {
      if (busy.current) return false;
      busy.current = true;
      setPending(true);
      setError(null);
      setSuccess(null);
      try {
        const outcome = await work();
        // Success is a toast when the shell mounted one; errors always stay in place.
        // An empty message means the caller reports success itself (for example after closing a drawer).
        if (outcome.ok) {
          if (successMessage) notify.current(successMessage, () => setSuccess(successMessage));
        } else setError(outcome.error ?? null);
        return outcome.ok;
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [],
  );
  return { pending, error, success, run, clear: () => (setError(null), setSuccess(null)) };
}

export function FormFeedback({
  error,
  success,
  t,
}: {
  error: unknown;
  success: string | null;
  t: WorkforceDictionary;
}) {
  if (error) return <ErrorState error={error} t={t} />;
  if (success) return <Notice tone="success">{success}</Notice>;
  return null;
}

// Shared components from packages/ui, re-exported so screens import from one place as they migrate.
export {
  ActionBar,
  Card,
  CheckField,
  Checkbox,
  Combobox,
  ConfirmDialog,
  DateInput,
  Dialog,
  Drawer,
  FormActions,
  FormSection,
  IconButton,
  ImageUploader,
  Menu,
  MoneyInput,
  NumberInput,
  RadioGroup,
  RowActions,
  SearchInput,
  Select,
  Skeleton,
  Spinner,
  Switch,
  TextInput,
  Textarea,
  TimeInput,
  ToastProvider,
  Tooltip,
  useToast,
  VisuallyHidden,
} from '@lucy-spa/ui';
export { Button, ButtonLink } from '@lucy-spa/ui';
