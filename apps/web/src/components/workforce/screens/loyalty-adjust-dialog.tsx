'use client';

import type {
  LoyaltyAdjustmentResponse,
  LoyaltyLedgerEntryResponse,
  LoyaltyWalletName,
} from '@lucy-spa/contracts';
import { Field, FormDialog, FormGrid, Select, Textarea, TextInput } from '@lucy-spa/ui';
import { useRef, useState } from 'react';
import { loyaltyDictionary } from '../../../i18n/loyalty';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import {
  adjustmentBody,
  correctionDraft,
  loyaltyErrorMessage,
  parseAmount,
  type AdjustDirection,
  type AdjustDraft,
} from '../../../lib/workforce/loyalty';
import { withReauthentication } from '../../../lib/workforce/reauth';
import { useReauthentication } from '../reauth-dialog';
import { useWorkforce } from '../session';
import { Notice } from '../ui';

const EMPTY: AdjustDraft = { wallet: 'SPA', direction: 'add', amount: '', reason: '' };

/**
 * A manual points adjustment as a dialog (short form, design 21.4): wallet, direction, amount and a written
 * reason. Correcting an earlier entry starts from the opposite of it. The client UUID is made once per
 * dialog, so a retry after the password confirmation can never write a second entry.
 */
export function AdjustDialog({
  userId,
  correcting,
  onDone,
  onClose,
}: {
  userId: string;
  /** The ledger entry this adjustment offsets (a linked correction), if any. */
  correcting: LoyaltyLedgerEntryResponse | null;
  onDone: (result: LoyaltyAdjustmentResponse) => void;
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const l = loyaltyDictionary(locale);
  const a = l.adjust;
  const { confirm, dialog } = useReauthentication();
  const [draft, setDraft] = useState<AdjustDraft>(correcting ? correctionDraft(correcting) : EMPTY);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const requestId = useRef(globalThis.crypto.randomUUID());
  const dirty = draft.amount !== '' || draft.reason !== '';
  const amountError =
    checked && parseAmount(draft.amount) === null ? t.errors.validation : undefined;
  const reasonError = checked && draft.reason.trim().length === 0 ? t.errors.validation : undefined;

  async function submit() {
    if (pending) return;
    setChecked(true);
    const body = adjustmentBody(draft, requestId.current, correcting?.id);
    if (!body) return;
    setPending(true);
    setError(null);
    try {
      const result = await withReauthentication(
        () =>
          api.post<LoyaltyAdjustmentResponse>(
            `/api/v1/loyalty/customers/${userId}/adjustments`,
            body,
          ),
        confirm,
      );
      onDone(result);
    } catch (failure) {
      // Cancelling the password confirmation is not an error: nothing was saved.
      if (!(failure instanceof Error && failure.name === 'ReauthenticationCancelled')) {
        setError(loyaltyErrorMessage(failure, t, locale));
      }
      setPending(false);
    }
  }

  return (
    <>
      <FormDialog
        title={correcting ? a.correctTitle : a.title}
        description={correcting ? a.correctDescription : a.description}
        labels={{ ...formOverlayLabels(t, a.submit), submitting: a.submitting }}
        busy={pending}
        dirty={dirty}
        error={error ? <Notice tone="error">{error}</Notice> : undefined}
        onClose={onClose}
        onSubmit={submit}
      >
        <FormGrid>
          <Field label={a.wallet}>
            {(control) => (
              <Select
                {...control}
                value={draft.wallet}
                disabled={correcting !== null}
                options={(['SPA', 'BEAUTY'] as const).map((wallet) => ({
                  value: wallet,
                  label: l.wallets[wallet],
                }))}
                onChange={(event) =>
                  setDraft({ ...draft, wallet: event.target.value as LoyaltyWalletName })
                }
              />
            )}
          </Field>
          <Field label={a.direction}>
            {(control) => (
              <Select
                {...control}
                value={draft.direction}
                options={[
                  { value: 'add', label: a.add },
                  { value: 'subtract', label: a.subtract },
                ]}
                onChange={(event) =>
                  setDraft({ ...draft, direction: event.target.value as AdjustDirection })
                }
              />
            )}
          </Field>
          <Field label={a.amount} hint={a.amountHint} error={amountError} required full>
            {(control) => (
              <TextInput
                {...control}
                inputMode="numeric"
                autoComplete="off"
                maxLength={7}
                value={draft.amount}
                onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
              />
            )}
          </Field>
          <Field label={a.reason} hint={a.reasonHint} error={reasonError} required full>
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                maxLength={500}
                value={draft.reason}
                onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
              />
            )}
          </Field>
        </FormGrid>
      </FormDialog>
      {dialog}
    </>
  );
}
