'use client';

import type { InventoryContextResponse } from '@lucy-spa/contracts';
import { useRef, useState } from 'react';
import { ApiError } from '../../../lib/workforce/api';
import { failedField, inventoryErrorText } from '../../../lib/workforce/inventory';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';
import { useResource } from '../ui';

/** What the signed-in person may do in the inventory: the branches and flags the API reports (the API decides again on every request). */
export function useInventoryContext() {
  const { api } = useWorkforce();
  return useResource(() => api.get<InventoryContextResponse>('/api/v1/inventory/context'), [api]);
}

/**
 * One inventory command: it posts, reloads what the screen shows on success, and on a conflict (someone else changed the record
 * first) reloads too, so a form that is still open holds the current version when it is sent again. Duplicate submits are blocked
 * while a request runs. `message` is the localized error text, `field` the field the API named.
 */
export function useInventoryCommand(reload?: () => Promise<void>) {
  const { api, t, locale } = useWorkforce();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const busy = useRef(false);

  async function run<T = unknown>(
    path: string,
    body: object,
  ): Promise<{ ok: true; data: T } | { ok: false }> {
    if (busy.current) return { ok: false };
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const data = await api.post<T>(path, body);
      await reload?.();
      return { ok: true, data };
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'CONFLICT' && failure.field === null) {
        await reload?.().catch(() => undefined);
      }
      setError(failure);
      return { ok: false };
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return {
    pending,
    run,
    clear: () => setError(null),
    field: error ? failedField(error) : null,
    message: error ? inventoryErrorText(error, locale, (cause) => errorMessage(cause, t)) : null,
  };
}

export type InventoryCommand = ReturnType<typeof useInventoryCommand>;
