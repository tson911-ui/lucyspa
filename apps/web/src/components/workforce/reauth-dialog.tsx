'use client';

import { useCallback, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { WorkforceDictionary } from '../../i18n/workforce';
import type { WorkforceApi } from '../../lib/workforce/api';
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

  async function submit(event: FormEvent) {
    event.preventDefault();
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
    <div
      className="wf-dialog-backdrop"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !pending) onCancel();
      }}
    >
      <div className="wf-dialog" role="dialog" aria-modal="true" aria-labelledby="reauth-title">
        <h2 id="reauth-title">{t.reauth.title}</h2>
        <p>{t.reauth.body}</p>
        <form className="wf-form" onSubmit={(event) => void submit(event)}>
          <div className="wf-field">
            <label htmlFor="reauth-password">{t.reauth.password}</label>
            <input
              id="reauth-password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className="wf-form-actions">
            <button
              type="submit"
              className="wf-button wf-button-primary"
              disabled={pending}
              aria-busy={pending}
            >
              {pending ? t.reauth.confirming : t.reauth.confirm}
            </button>
            <button
              type="button"
              className="wf-button wf-button-quiet"
              onClick={onCancel}
              disabled={pending}
            >
              {t.common.cancel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
