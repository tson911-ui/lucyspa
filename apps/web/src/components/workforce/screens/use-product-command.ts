'use client';

import { useRef, useState } from 'react';
import { ApiError } from '../../../lib/workforce/api';
import { failedField, productErrorText } from '../../../lib/workforce/products';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';

/**
 * One catalog command of a product's page: it posts, reloads the product on success, and on a conflict (someone else changed the
 * record first) reloads too, so the form that is still open holds the current row version when the user sends it again.
 * Duplicate submits are blocked while a request runs. `message` is the localized error text, `field` the field the API named.
 */
export function useProductCommand(reload: () => Promise<void>) {
  const { api, t, locale } = useWorkforce();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const busy = useRef(false);

  async function run(path: string, body: object): Promise<boolean> {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await api.post(path, body);
      await reload();
      return true;
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'CONFLICT' && failure.field === null) {
        await reload().catch(() => undefined);
      }
      setError(failure);
      return false;
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
    message: error ? productErrorText(error, locale, (cause) => errorMessage(cause, t)) : null,
  };
}

export type ProductCommand = ReturnType<typeof useProductCommand>;
