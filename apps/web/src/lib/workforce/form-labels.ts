import type { ConfirmError, FormOverlayLabels } from '@lucy-spa/ui';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { ApiError } from './api';
import { errorMessage } from './workflows';

/**
 * Glue between the workforce dictionary and `FormDialog`/`FormDrawer`, which take every string as a
 * prop. `submit` is the action ("Tạo mới", "Lưu"), never "OK".
 */
export function formOverlayLabels(t: WorkforceDictionary, submit: string): FormOverlayLabels {
  return {
    close: t.common.close,
    cancel: t.common.cancel,
    submit,
    submitting: t.common.saving,
    discardTitle: t.common.form.discardTitle,
    discardBody: t.common.form.discardBody,
    discardConfirm: t.common.form.discardConfirm,
    discardKeep: t.common.form.discardKeep,
  };
}

/** Turns what a rejected request threw into the text and reference `ConfirmDialog` shows. */
export function confirmError(t: WorkforceDictionary): (error: unknown) => ConfirmError {
  return (error) => ({
    message: errorMessage(error, t),
    reference: error instanceof ApiError ? error.requestId : null,
  });
}
