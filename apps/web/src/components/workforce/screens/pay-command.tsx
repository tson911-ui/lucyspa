'use client';

import { Drawer } from '@lucy-spa/ui';
import { useRef, useState, type ReactNode } from 'react';
import { payErrorMessage } from '../../../lib/workforce/pay';
import { useWorkforce } from '../session';
import { Button } from '../ui';

/**
 * Runs one pay command (Phase 7 P7-11). The request id is made once per dialog so a retry or a double click never writes twice; a
 * refusal is shown in words inside the dialog. Pay commands need no fresh password (the Owner's click is the decision), unlike
 * moving money out of a fund.
 */
export function usePayCommand() {
  const { api, t, locale } = useWorkforce();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(globalThis.crypto.randomUUID());
  async function run<T>(path: string, body: object, done: (result: T) => void) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      done(await api.post<T>(path, body));
    } catch (failure) {
      setError(payErrorMessage(failure, t, locale));
      setPending(false);
    }
  }
  return { run, pending, error, requestId: requestId.current };
}

/** A read-only side sheet for a history list: one close button, nothing else to decide. */
export function HistoryDrawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useWorkforce();
  return (
    <Drawer
      open
      title={title}
      closeLabel={t.common.close}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t.common.close}
        </Button>
      }
    >
      {children}
    </Drawer>
  );
}
