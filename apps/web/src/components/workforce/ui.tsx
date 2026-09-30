'use client';

import {
  Badge as UiBadge,
  Button,
  EmptyState,
  ErrorState as UiErrorState,
  Field as UiField,
  Notice as UiNotice,
  type Tone as UiTone,
} from '@lucy-spa/ui';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { ApiError } from '../../lib/workforce/api';
import { errorMessage } from '../../lib/workforce/workflows';

export function PageHeader({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children?: ReactNode;
}) {
  return (
    <header className="wf-page-header">
      <div>
        <h1>{title}</h1>
        {intro ? <p className="wf-muted">{intro}</p> : null}
      </div>
      {children ? <div className="wf-page-actions">{children}</div> : null}
    </header>
  );
}

export function Section({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="wf-section" aria-label={title}>
      <div className="wf-section-header">
        <h2>{title}</h2>
        {actions}
      </div>
      {children}
    </section>
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

export function Loading({ t }: { t: WorkforceDictionary }) {
  return (
    <p className="wf-muted" role="status">
      {t.common.loading}
    </p>
  );
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
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  // The wf-field class stays so login and member-form layout rules keep matching until Steps 8-10.
  return (
    <UiField
      id={id}
      label={label}
      className="wf-field"
      {...(required ? { required } : {})}
      {...(hint ? { hint } : {})}
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
 * Form submission state: blocks duplicate submits while pending and keeps the entered
 * values (owned by the form) after a recoverable error.
 */
export function useSubmit() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const busy = useRef(false);
  const run = useCallback(
    async (work: () => Promise<{ ok: boolean; error?: unknown }>, successMessage: string) => {
      if (busy.current) return false;
      busy.current = true;
      setPending(true);
      setError(null);
      setSuccess(null);
      try {
        const outcome = await work();
        if (outcome.ok) setSuccess(successMessage);
        else setError(outcome.error ?? null);
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
} from '@lucy-spa/ui';
export { Button, ButtonLink } from '@lucy-spa/ui';
