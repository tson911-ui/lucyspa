'use client';

import { BrandWordmark } from '@lucy-spa/ui';
import Link from 'next/link';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { oneAtATime } from '../../../lib/workforce/employee-create';
import {
  completeWorkforceReset,
  recoveryErrorMessage,
  requestWorkforceReset,
  resetProblem,
  type ResetProblem,
} from '../../../lib/workforce/recovery';
import { useWorkforce } from '../session';
import { Field, Notice, SubmitButton } from '../ui';

export type ForgotStep = 'email' | 'code' | 'done';

/**
 * Workforce "Quên mật khẩu" (public): email → 6-digit code → new password, over the existing
 * WORKFORCE password-reset endpoints. After a request the same neutral message is always
 * shown, whether or not the email belongs to an eligible account (anti-enumeration).
 */
export function ForgotPasswordScreen() {
  const { api, t, base, locale } = useWorkforce();
  const [step, setStep] = useState<ForgotStep>('email');
  const [email, setEmail] = useState('');
  const [flowToken, setFlowToken] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [problem, setProblem] = useState<ResetProblem>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const latest = useRef({ email, flowToken, code, password });
  latest.current = { email, flowToken, code, password };

  const send = useRef(
    oneAtATime(async () => {
      setPending(true);
      setError(null);
      try {
        const flow = await requestWorkforceReset(api, latest.current.email, locale);
        setFlowToken(flow.flowToken);
        setStep('code');
      } catch (failure) {
        setError(recoveryErrorMessage(failure, t));
      } finally {
        setPending(false);
      }
    }),
  );
  const finish = useRef(
    oneAtATime(async () => {
      const current = latest.current;
      setPending(true);
      setError(null);
      try {
        await completeWorkforceReset(api, current.flowToken, current.code, current.password);
        setStep('done');
      } catch (failure) {
        setError(recoveryErrorMessage(failure, t));
      } finally {
        // The new password is never kept after an attempt.
        setPassword('');
        setConfirmation('');
        setPending(false);
      }
    }),
  );

  function request(event: FormEvent) {
    event.preventDefault();
    if (email.trim() === '') return;
    void send.current();
  }

  function complete(event: FormEvent) {
    event.preventDefault();
    const found = resetProblem(code, password, confirmation);
    setProblem(found);
    if (found !== null) return;
    void finish.current();
  }

  return (
    <ForgotPasswordView
      step={step}
      email={email}
      code={code}
      password={password}
      confirmation={confirmation}
      problem={problem}
      error={error}
      pending={pending}
      loginHref={`${base}/login`}
      onEmail={setEmail}
      onCode={setCode}
      onPassword={setPassword}
      onConfirmation={setConfirmation}
      onRequest={request}
      onComplete={complete}
      brand={<BrandWordmark />}
      onRestart={() => {
        setStep('email');
        setFlowToken('');
        setCode('');
        setError(null);
        setProblem(null);
      }}
      t={t}
    />
  );
}

/** Presentational steps (render without a network in tests). */
export function ForgotPasswordView(props: {
  step: ForgotStep;
  email: string;
  code: string;
  password: string;
  confirmation: string;
  problem: ResetProblem;
  error: string | null;
  pending: boolean;
  loginHref: string;
  onEmail: (value: string) => void;
  onCode: (value: string) => void;
  onPassword: (value: string) => void;
  onConfirmation: (value: string) => void;
  onRequest: (event: FormEvent) => void;
  onComplete: (event: FormEvent) => void;
  onRestart: () => void;
  /** The brand mark (the page passes the shared wordmark). */
  brand?: ReactNode;
  t: ReturnType<typeof useWorkforce>['t'];
}) {
  const { t } = props;
  const texts = t.recovery;
  return (
    <main className="wf-login" id="main-content" tabIndex={-1}>
      <div className="wf-login-card">
        <div className="wf-login-brand">{props.brand}</div>
        <h1>{texts.forgotTitle}</h1>
        {props.error ? <Notice tone="error">{props.error}</Notice> : null}
        {props.step === 'email' ? (
          <form onSubmit={props.onRequest}>
            <p className="wf-muted">{texts.forgotIntro}</p>
            <Field id="forgot-email" label={texts.email} required>
              <input
                id="forgot-email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={props.email}
                onChange={(event) => props.onEmail(event.target.value)}
              />
            </Field>
            <SubmitButton
              pending={props.pending}
              label={texts.requestCode}
              pendingLabel={texts.sending}
            />
          </form>
        ) : null}
        {props.step === 'code' ? (
          <form onSubmit={props.onComplete}>
            {/* The same message for every email: nothing reveals whether an account exists. */}
            <Notice tone="info">{texts.requested}</Notice>
            <Field id="forgot-code" label={texts.code} required>
              <input
                id="forgot-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                aria-invalid={props.problem === 'code' || undefined}
                value={props.code}
                onChange={(event) => props.onCode(event.target.value)}
              />
            </Field>
            <Field
              id="forgot-password"
              label={texts.newPassword}
              required
              hint={texts.passwordHint}
            >
              <input
                id="forgot-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={15}
                maxLength={128}
                aria-invalid={props.problem === 'length' || undefined}
                aria-describedby="forgot-password-hint"
                value={props.password}
                onChange={(event) => props.onPassword(event.target.value)}
              />
            </Field>
            <Field id="forgot-confirm" label={texts.confirmPassword} required>
              <input
                id="forgot-confirm"
                type="password"
                autoComplete="new-password"
                required
                aria-invalid={props.problem === 'mismatch' || undefined}
                value={props.confirmation}
                onChange={(event) => props.onConfirmation(event.target.value)}
              />
            </Field>
            {props.problem === 'code' ? <Notice tone="error">{texts.codeInvalid}</Notice> : null}
            {props.problem === 'length' ? (
              <Notice tone="error">{texts.passwordLength}</Notice>
            ) : null}
            {props.problem === 'mismatch' ? (
              <Notice tone="error">{texts.passwordMismatch}</Notice>
            ) : null}
            <SubmitButton
              pending={props.pending}
              label={texts.complete}
              pendingLabel={texts.completing}
            />
            <p>
              <button type="button" className="wf-button wf-button-quiet" onClick={props.onRestart}>
                {texts.otherEmail}
              </button>
            </p>
          </form>
        ) : null}
        {props.step === 'done' ? <Notice tone="success">{texts.done}</Notice> : null}
        <p>
          <Link href={props.loginHref}>{texts.backToLogin}</Link>
        </p>
      </div>
    </main>
  );
}
