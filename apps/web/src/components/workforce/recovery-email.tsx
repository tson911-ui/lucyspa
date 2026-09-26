'use client';

import type { CurrentAccountResponse } from '@lucy-spa/contracts';
import { useState, type FormEvent } from 'react';
import { fill } from '../../i18n/workforce';
import { withReauthentication } from '../../lib/workforce/reauth';
import {
  OTP_PATTERN,
  recoveryEmailState,
  recoveryErrorMessage,
  requestRecoveryEmailCode,
  verifyRecoveryEmail,
} from '../../lib/workforce/recovery';
import { useReauthentication } from './reauth-dialog';
import { useWorkforce } from './session';
import { Badge, Field, Notice, Section, SubmitButton, useResource, useSubmit } from './ui';

/**
 * "Email khôi phục" for the signed-in Owner or employee: shows whether the stored recovery
 * email is verified and verifies it with the existing recovery-email endpoints (a recent
 * password confirmation is required, through the shared dialog).
 */
export function RecoveryEmailSection() {
  const { api } = useWorkforce();
  const me = useResource(
    () => api.get<CurrentAccountResponse>('/api/v1/auth/me', {}, { passive: true }),
    [api],
  );
  return <RecoveryEmailView account={me.data} reload={me.reload} />;
}

export function RecoveryEmailView({
  account,
  reload,
}: {
  account: CurrentAccountResponse | null;
  reload: () => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const texts = t.recovery;
  const { confirm, dialog } = useReauthentication();
  const [flowToken, setFlowToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const submit = useSubmit();
  const state = recoveryEmailState(account);
  if (state === 'unknown' || !account) return null;
  const address = account.recoveryEmail?.address ?? '';

  async function send() {
    const result: { token?: string } = {};
    const ok = await submit.run(
      async () => {
        try {
          const flow = await withReauthentication(() => requestRecoveryEmailCode(api), confirm);
          result.token = flow.flowToken;
          return { ok: true };
        } catch (error) {
          return { ok: false, error };
        }
      },
      fill(texts.codeSent, { email: address }),
    );
    if (ok && result.token) {
      setFlowToken(result.token);
      setCode('');
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!flowToken || !OTP_PATTERN.test(code.trim())) return;
    const ok = await submit.run(async () => {
      try {
        await verifyRecoveryEmail(api, flowToken, code);
        return { ok: true };
      } catch (error) {
        return { ok: false, error };
      }
    }, texts.verifiedNow);
    if (ok) {
      setFlowToken(null);
      await reload();
    }
  }

  return (
    <Section title={texts.title}>
      {dialog}
      <p className="wf-muted">{texts.intro}</p>
      {state === 'missing' ? (
        <Notice tone="info">{texts.missing}</Notice>
      ) : (
        <p>
          <strong>{address}</strong>{' '}
          <Badge tone={state === 'verified' ? 'success' : 'warning'}>
            {state === 'verified' ? texts.verified : texts.unverified}
          </Badge>
        </p>
      )}
      {state === 'unverified' ? (
        <>
          <Notice tone="warning">
            {account.kind === 'OWNER' ? texts.ownerWarning : texts.unverifiedWarning}
          </Notice>
          {submit.error ? (
            <Notice tone="error">{recoveryErrorMessage(submit.error, t)}</Notice>
          ) : null}
          {submit.success && flowToken ? <Notice tone="info">{submit.success}</Notice> : null}
          {flowToken ? (
            <form className="wf-filters" onSubmit={(event) => void verify(event)}>
              <Field id="recovery-code" label={texts.code} required>
                <input
                  id="recovery-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </Field>
              <SubmitButton
                pending={submit.pending}
                label={texts.verify}
                pendingLabel={texts.verifying}
              />
            </form>
          ) : null}
          <button
            type="button"
            className={`wf-button ${flowToken ? 'wf-button-quiet' : 'wf-button-primary'}`}
            disabled={submit.pending}
            onClick={() => void send()}
          >
            {submit.pending && !flowToken ? texts.sending : texts.sendCode}
          </button>
        </>
      ) : null}
      {state === 'verified' && submit.success ? (
        <Notice tone="success">{submit.success}</Notice>
      ) : null}
    </Section>
  );
}
