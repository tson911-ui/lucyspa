'use client';

import type { ReferralLookupResponse, ReferralResultResponse } from '@lucy-spa/contracts';
import { Field, FormDialog, FormGrid, Textarea, TextInput } from '@lucy-spa/ui';
import { useState } from 'react';
import { loyaltyDictionary } from '../../../i18n/loyalty';
import { fill } from '../../../i18n/workforce';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { referralErrorMessage } from '../../../lib/workforce/loyalty';
import { withReauthentication } from '../../../lib/workforce/reauth';
import { useReauthentication } from '../reauth-dialog';
import { useWorkforce } from '../session';
import { Notice } from '../ui';

/**
 * Records a brand-new customer's referrer at the counter (Phase 5 P5-5, `MANAGE_REFERRALS`): the staff member types the exact
 * phone of the member, sees who it is (name and masked phone), and only then confirms. The first press looks the member up; the
 * second records the binding, so nobody is ever bound to a number they did not see resolved.
 */
export function BindReferrerDialog({
  branchId,
  userId,
  onDone,
  onClose,
}: {
  branchId: string;
  userId: string;
  onDone: (result: ReferralResultResponse) => void;
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const b = loyaltyDictionary(locale).referral.bind;
  const [phone, setPhone] = useState('');
  const [member, setMember] = useState<ReferralLookupResponse['members'][number] | null>(null);
  const [searched, setSearched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const phoneError = checked && phone.trim().length === 0 ? t.errors.validation : undefined;

  async function submit() {
    if (pending) return;
    setChecked(true);
    if (phone.trim().length === 0) return;
    setPending(true);
    setError(null);
    try {
      if (!member) {
        const found = await api.get<ReferralLookupResponse>(
          `/api/v1/referrals/branches/${branchId}/lookup`,
          { phone: phone.trim() },
        );
        setMember(found.members[0] ?? null);
        setSearched(true);
        setPending(false);
        return;
      }
      const result = await api.post<ReferralResultResponse>(
        `/api/v1/referrals/branches/${branchId}/customers/${userId}/bind`,
        { referrerPhone: phone.trim() },
      );
      onDone(result);
    } catch (failure) {
      setError(referralErrorMessage(failure, t, locale));
      setPending(false);
    }
  }

  return (
    <FormDialog
      title={b.title}
      description={b.description}
      labels={{
        ...formOverlayLabels(t, member ? b.submit : b.search),
        submitting: member ? b.submitting : b.searching,
      }}
      busy={pending}
      dirty={phone !== ''}
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <Field label={b.phone} error={phoneError} required full>
          {(control) => (
            <TextInput
              {...control}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              maxLength={32}
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                setMember(null);
                setSearched(false);
              }}
            />
          )}
        </Field>
        {member ? (
          <Notice tone="success">
            {fill(b.found, { name: member.displayName, phone: member.phoneMasked ?? '—' })}
          </Notice>
        ) : searched ? (
          <Notice tone="info">{b.notFound}</Notice>
        ) : null}
      </FormGrid>
    </FormDialog>
  );
}

/**
 * The Owner's correction of a referrer (Phase 5 P5-5, `CHANGE_REFERRER`): the new member's phone, a written reason and the
 * Owner's password again. Only possible before the reward; the history keeps the old value, the new one, who and when.
 */
export function ChangeReferrerDialog({
  userId,
  onDone,
  onClose,
}: {
  userId: string;
  onDone: (result: ReferralResultResponse) => void;
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const c = loyaltyDictionary(locale).referral.changeDialog;
  const { confirm, dialog } = useReauthentication();
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const phoneError = checked && phone.trim().length === 0 ? t.errors.validation : undefined;
  const reasonError = checked && reason.trim().length === 0 ? t.errors.validation : undefined;

  async function submit() {
    if (pending) return;
    setChecked(true);
    if (phone.trim().length === 0 || reason.trim().length === 0) return;
    setPending(true);
    setError(null);
    try {
      const result = await withReauthentication(
        () =>
          api.post<ReferralResultResponse>(`/api/v1/referrals/customers/${userId}/change`, {
            referrerPhone: phone.trim(),
            reason: reason.trim(),
          }),
        confirm,
      );
      onDone(result);
    } catch (failure) {
      // Cancelling the password confirmation is not an error: nothing was saved.
      if (!(failure instanceof Error && failure.name === 'ReauthenticationCancelled')) {
        setError(referralErrorMessage(failure, t, locale));
      }
      setPending(false);
    }
  }

  return (
    <>
      <FormDialog
        title={c.title}
        description={c.description}
        labels={{ ...formOverlayLabels(t, c.submit), submitting: c.submitting }}
        busy={pending}
        dirty={phone !== '' || reason !== ''}
        error={error ? <Notice tone="error">{error}</Notice> : undefined}
        onClose={onClose}
        onSubmit={submit}
      >
        <FormGrid>
          <Field label={c.phone} error={phoneError} required full>
            {(control) => (
              <TextInput
                {...control}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                maxLength={32}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            )}
          </Field>
          <Field label={c.reason} hint={c.reasonHint} error={reasonError} required full>
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </Field>
        </FormGrid>
      </FormDialog>
      {dialog}
    </>
  );
}
