'use client';

import { AuthLayout, BrandWordmark, Icon, PasswordInput, Field as UiField } from '@lucy-spa/ui';
import { PrefetchLink as Link } from '../link';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { oneAtATime, PASSWORD_LENGTH } from '../../../lib/workforce/employee-create';
import {
  completeWorkforceReset,
  recoveryErrorMessage,
  requestWorkforceReset,
  resetProblem,
  type ResetProblem,
} from '../../../lib/workforce/recovery';
import { AuthTopActions } from '../auth-actions';
import { useWorkforce } from '../session';
import { Button, Field, Notice, SubmitButton } from '../ui';

export type ForgotStep = 'email' | 'code' | 'done';

const PROBLEM_FIELD: Record<Exclude<ResetProblem, null>, string> = {
  code: 'forgot-code',
  length: 'forgot-password',
  mismatch: 'forgot-confirm',
};

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
    if (found !== null) {
      // Focus the field that has the problem (its error is shown under it).
      document.getElementById(PROBLEM_FIELD[found])?.focus();
      return;
    }
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
      brand={<BrandWordmark size="display" />}
      topActions={<AuthTopActions />}
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
  /** Language and theme controls, top right (the page passes them; tests omit them). */
  topActions?: ReactNode;
  t: ReturnType<typeof useWorkforce>['t'];
}) {
  const { t } = props;
  const texts = t.recovery;
  return (
    <AuthLayout brand={props.brand} topActions={props.topActions}>
      <h1>{texts.forgotTitle}</h1>
      {props.error ? <Notice tone="error">{props.error}</Notice> : null}
      {props.step === 'email' ? <p className="ls-self-auth-intro">{texts.forgotIntro}</p> : null}
      {props.step === 'email' ? (
        <form onSubmit={props.onRequest}>
          <Field id="forgot-email" label={texts.email} required>
            <input
              id="forgot-email"
              type="email"
              name="email"
              autoComplete="email"
              spellCheck={false}
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
          {/* Each problem is shown at its own field (wig: errors inline, not one Notice under the form). */}
          <UiField
            id="forgot-code"
            label={texts.code}
            required
            error={props.problem === 'code' ? texts.codeInvalid : undefined}
          >
            {(control) => (
              <input
                {...control}
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                spellCheck={false}
                pattern="[0-9]{6}"
                maxLength={6}
                value={props.code}
                onChange={(event) => props.onCode(event.target.value)}
              />
            )}
          </UiField>
          <UiField
            id="forgot-password"
            label={texts.newPassword}
            required
            hint={texts.passwordHint}
            error={props.problem === 'length' ? texts.passwordLength : undefined}
          >
            {(control) => (
              <PasswordInput
                {...control}
                name="new-password"
                showLabel={t.auth.showPassword}
                hideLabel={t.auth.hidePassword}
                autoComplete="new-password"
                minLength={PASSWORD_LENGTH.min}
                maxLength={PASSWORD_LENGTH.max}
                value={props.password}
                onChange={(event) => props.onPassword(event.target.value)}
              />
            )}
          </UiField>
          <UiField
            id="forgot-confirm"
            label={texts.confirmPassword}
            required
            error={props.problem === 'mismatch' ? texts.passwordMismatch : undefined}
          >
            {(control) => (
              <PasswordInput
                {...control}
                name="confirm-password"
                showLabel={t.auth.showPassword}
                hideLabel={t.auth.hidePassword}
                autoComplete="new-password"
                value={props.confirmation}
                onChange={(event) => props.onConfirmation(event.target.value)}
              />
            )}
          </UiField>
          <SubmitButton
            pending={props.pending}
            label={texts.complete}
            pendingLabel={texts.completing}
          />
          <p>
            <Button variant="ghost" onClick={props.onRestart}>
              {texts.otherEmail}
            </Button>
          </p>
        </form>
      ) : null}
      {props.step === 'done' ? <Notice tone="success">{texts.done}</Notice> : null}
      {/* The parent link: a 40 px row with a leading chevron, not a 22 px underlined line (C29, C40). */}
      <p className="ls-self-auth-link">
        <Link className="ls-link ls-self-back" href={props.loginHref}>
          <Icon name="chevron-left" size={16} />
          {texts.backToLogin}
        </Link>
      </p>
    </AuthLayout>
  );
}
