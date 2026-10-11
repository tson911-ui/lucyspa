'use client';

import { useRef, useState } from 'react';
import { payrollErrorMessage } from '../../../lib/workforce/payroll';
import { ReauthenticationCancelled, withReauthentication } from '../../../lib/workforce/reauth';
import { useReauthentication } from '../reauth-dialog';
import { useWorkforce } from '../session';

/**
 * Runs one payroll command (Phase 7 P7-15). The request id is made once per dialog so a retry or a double click never writes twice; a refusal
 * is shown in words inside the dialog. Commands that move money or freeze the payroll ask for the person's password first (`reauth`); closing
 * the password prompt is not an error, nothing was saved.
 */
export function usePayrollCommand(options: { reauth?: boolean } = {}) {
  const { api, t, locale } = useWorkforce();
  const { confirm, dialog } = useReauthentication();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(globalThis.crypto.randomUUID());
  async function run<T>(path: string, body: object, done: (result: T) => void) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = options.reauth
        ? await withReauthentication(() => api.post<T>(path, body), confirm)
        : await api.post<T>(path, body);
      done(result);
    } catch (failure) {
      if (!(failure instanceof ReauthenticationCancelled)) {
        setError(payrollErrorMessage(failure, t, locale));
      }
      setPending(false);
    }
  }
  return { run, pending, error, requestId: requestId.current, dialog };
}
