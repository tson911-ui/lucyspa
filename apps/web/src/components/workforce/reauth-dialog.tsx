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
 *
 * HIG C60 (one modal at a time): `asking` is true while the password check is open. A screen whose
 * own dialog asked for it passes `suspended={asking}` to that dialog, so the dialog steps out of
 * sight (its reason, state and pending request kept) and the check is the only modal on screen; it
 * is back when the check closes, with the result of the retried command or, after a cancel, with
 * what the user had typed and nothing sent again.
 */
export function useReauthentication(): {
  confirm: () => Promise<boolean>;
  dialog: ReactNode;
  asking: boolean;
} {
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
  return { confirm, dialog, asking: open };
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
  // Validate on submit: the button stays enabled and an empty password says so at the field (focus moves there).
  const [tried, setTried] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function submit() {
    if (pending) return;
    if (password.length === 0) {
      setTried(true);
      input.current?.focus();
      return;
    }
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
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onCancel}
      onSubmit={submit}
    >
      <Field
        label={t.reauth.password}
        required
        error={tried && password.length === 0 ? t.reauth.passwordRequired : undefined}
      >
        {(control) => (
          <TextInput
            {...control}
            ref={input}
            type="password"
            name="current-password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
      </Field>
    </FormDialog>
  );
}
