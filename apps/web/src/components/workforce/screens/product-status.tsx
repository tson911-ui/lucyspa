'use client';

import type { ProductStatusName } from '@lucy-spa/contracts';
import { ConfirmDialog } from '@lucy-spa/ui';
import { productDictionary } from '../../../i18n/products';
import { ApiError } from '../../../lib/workforce/api';
import { localizedName, productErrorText, statusMoveKind } from '../../../lib/workforce/products';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';

/**
 * The confirmation of a status move (Nháp to Đang bán, Đang bán to Ngừng bán, Ngừng bán to Đang bán). The product's row version
 * travels with the request: when someone else changed the product first, the data is reloaded and the dialog says so.
 */
export function ProductStatusConfirm({
  product,
  to,
  onClose,
  onChanged,
  onDone,
}: {
  product: {
    id: string;
    nameVi: string;
    nameEn: string;
    rowVersion: number;
    status: ProductStatusName;
  };
  to: 'PUBLISHED' | 'INACTIVE';
  onClose: () => void;
  /** Reloads what the screen shows; also called after a conflict so the next attempt starts from fresh data. */
  onChanged: () => Promise<void>;
  onDone: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const d = productDictionary(locale).statusDialog;
  const move = statusMoveKind(product.status, to);
  const [title, body] =
    move === 'publish'
      ? [d.publishTitle, d.publishBody]
      : move === 'stop'
        ? [d.stopTitle, d.stopBody]
        : [d.resumeTitle, d.resumeBody];
  const labels = productDictionary(locale).actions;
  return (
    <ConfirmDialog
      title={title}
      description={body}
      facts={[{ label: d.nameLabel, value: localizedName(product, locale) }]}
      tone={move === 'stop' ? 'danger' : 'neutral'}
      confirmLabel={labels[move]}
      busyLabel={d.working}
      cancelLabel={d.cancel}
      referenceLabel={t.errors.reference}
      describeError={(error) => ({
        message: productErrorText(error, locale, (cause) => errorMessage(cause, t)),
        reference: error instanceof ApiError ? error.requestId : null,
      })}
      onCancel={onClose}
      onConfirm={async () => {
        try {
          await api.post(`/api/v1/products/${product.id}/status`, {
            expectedRowVersion: product.rowVersion,
            status: to,
          });
        } catch (error) {
          if (error instanceof ApiError && error.code === 'CONFLICT') await onChanged();
          throw error;
        }
        await onChanged();
        onDone();
      }}
    />
  );
}
