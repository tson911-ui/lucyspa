'use client';

import { useState } from 'react';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { deleteErrorMessage, type DeleteTarget } from '../../lib/workforce/catalog-delete';
import { Notice } from './ui';

/**
 * Confirmation for permanent deletion. Nothing is sent until the destructive button is
 * pressed; Cancel, Escape or the backdrop close the dialog without any request. A refusal
 * keeps the dialog (and the record) and explains why.
 */
export function ConfirmDeleteDialog({
  target,
  t,
  onCancel,
  onConfirm,
}: {
  target: DeleteTarget;
  t: WorkforceDictionary;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const service = target.kind === 'service';
  const titleId = `delete-${target.id}-title`;

  async function confirm() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
    } catch (failure) {
      setError(failure);
      setPending(false);
    }
  }

  return (
    <div
      className="wf-dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !pending) onCancel();
      }}
    >
      <div className="wf-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>
          {service ? t.services.deleteServiceTitle : t.services.deleteCategoryTitle}
        </h2>
        <dl className="wf-dialog-facts">
          <dt>{t.common.name}</dt>
          <dd>{target.name}</dd>
          <dt>{t.common.code}</dt>
          <dd>{target.code}</dd>
        </dl>
        <p>{service ? t.services.deleteServiceBody : t.services.deleteCategoryBody}</p>
        {error ? <Notice tone="error">{deleteErrorMessage(error, target.kind, t)}</Notice> : null}
        <div className="wf-form-actions">
          <button
            type="button"
            className="wf-button wf-button-quiet"
            onClick={onCancel}
            disabled={pending}
            autoFocus
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            className="wf-button wf-button-danger"
            onClick={() => void confirm()}
            disabled={pending}
            aria-busy={pending}
          >
            {pending
              ? t.common.saving
              : service
                ? t.services.deleteServiceConfirm
                : t.services.deleteCategoryConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}
