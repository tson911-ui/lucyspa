'use client';

import { Field, FormDialog, TextInput } from '@lucy-spa/ui';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import type { WorkforceDictionary } from '../../i18n/workforce';
import type { WorkforceApi } from '../../lib/workforce/api';
import { formOverlayLabels } from '../../lib/workforce/form-labels';
import { reauthenticate, reauthErrorMessage } from '../../lib/workforce/reauth';
import { useWorkforce } from './session';
import { Notice } from './ui';

/**
 * "Confirm your password" for sensitive commands: the signed-in Owner/manager re-enters
 * THEIR OWN password (never the employee's). `confirm()` resolves true after a successful
 * `POST /auth/reauthenticate`, false when cancelled. Reusable by any screen:
 * `const { confirm, dialog } = useReauthentication();` and render `dialog`.
 */
export function useReauthentication(): { confirm: () => Promise<boolean>; dialog: ReactNode } {
  const { api, t } = useWorkforce();
  const [open, setOpen] = useState(false);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);
  const confirm = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setOpen(true);
      }),
    [],
  );
  const finish = (confirmed: boolean) => {
    setOpen(false);
    resolver.current?.(confirmed);
    resolver.current = null;
  };
  const dialog = open ? (
    <ReauthDialog t={t} api={api} onConfirmed={() => finish(true)} onCancel={() => finish(false)} />
  ) : null;
  return { confirm, dialog };
}

export function ReauthDialog({
  t,
  api,
  onConfirmed,
  onCancel,
}: {
  t: WorkforceDictionary;
  api: WorkforceApi;
  onConfirmed: () => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (pending || password.length === 0) return;
    setPending(true);
    setError(null);
    try {
      await reauthenticate(api, password);
      setPassword('');
      onConfirmed();
    } catch (failure) {
      setPassword('');
      setError(reauthErrorMessage(failure, t));
      setPending(false);
    }
  }

  return (
    <FormDialog
      size="sm"
      title={t.reauth.title}
      description={t.reauth.body}
      labels={{
        ...formOverlayLabels(t, t.reauth.confirm),
        submitting: t.reauth.confirming,
      }}
      busy={pending}
      submitDisabled={password.length === 0}
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onCancel}
      onSubmit={submit}
    >
      <Field label={t.reauth.password} required>
        {(control) => (
          <TextInput
            {...control}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
      </Field>
    </FormDialog>
  );
}
