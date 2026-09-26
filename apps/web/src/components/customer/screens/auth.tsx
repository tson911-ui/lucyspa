'use client';

import { BrandWordmark } from '@lucy-spa/ui';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { fill } from '../../../i18n/customer';
import { ApiError } from '../../../lib/api/client';
import {
  completeCustomerReset,
  customerLogin,
  loadCustomerSession,
  registerCustomer,
  requestCustomerReset,
  resendChallenge,
  safeCustomerNext,
  verifyActivation,
} from '../../../lib/customer/auth';
import { customerErrorMessage } from '../../../lib/customer/booking';
import { Field, Notice, SubmitButton } from '../../workforce/ui';
import { useCustomer } from '../session';

const PASSWORD = { min: 8, max: 128 };
const OTP = /^[0-9]{6}$/;
const passwordLength = (value: string) => [...value.normalize('NFC')].length;

function AuthCard({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  const { locale, t } = useCustomer();
  const pathname = usePathname();
  const other = locale === 'vi' ? 'en' : 'vi';
  return (
    <main className="wf-login" id="main-content" tabIndex={-1}>
      <div className="wf-login-card">
        <div className="wf-login-brand">
          <Link href={`/${locale}`} aria-label="Lucy Spa">
            <BrandWordmark />
          </Link>
          <Link
            href={pathname.replace(`/${locale}/`, `/${other}/`)}
            hrefLang={other}
            lang={other}
            className="wf-lang"
          >
            {t.common.language}
          </Link>
        </div>
        <h1>{title}</h1>
        {intro ? <p className="wf-muted">{intro}</p> : null}
        {children}
      </div>
    </main>
  );
}

/** Password with its confirmation, checked the way the server counts (NFC code points). */
function PasswordPair({
  password,
  confirmation,
  onPassword,
  onConfirmation,
  label,
}: {
  password: string;
  confirmation: string;
  onPassword: (value: string) => void;
  onConfirmation: (value: string) => void;
  label: string;
}) {
  const { t } = useCustomer();
  return (
    <>
      <Field id="password" label={label} required hint={t.auth.passwordHint}>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD.min}
          maxLength={1024}
          aria-describedby="password-hint"
          value={password}
          onChange={(event) => onPassword(event.target.value)}
        />
      </Field>
      <Field id="confirmation" label={t.auth.passwordConfirm} required>
        <input
          id="confirmation"
          type="password"
          autoComplete="new-password"
          required
          maxLength={1024}
          value={confirmation}
          onChange={(event) => onConfirmation(event.target.value)}
        />
      </Field>
    </>
  );
}

function passwordProblem(
  password: string,
  confirmation: string,
  t: ReturnType<typeof useCustomer>['t'],
) {
  const length = passwordLength(password);
  if (length < PASSWORD.min || length > PASSWORD.max) return t.auth.passwordLength;
  if (password !== confirmation) return t.auth.passwordMismatch;
  return null;
}

// ------------------------------------------------------------------ sign in

function LoginForm() {
  const { api, t, base } = useCustomer();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const destination = safeCustomerNext(params.get('next'), base);

  useEffect(() => {
    let active = true;
    loadCustomerSession(api)
      .then((session) => {
        if (active && session.kind === 'customer') router.replace(destination);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, router, destination]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage(null);
    try {
      await customerLogin(api, email, password);
      setPassword('');
      router.replace(destination);
    } catch (error) {
      setPassword('');
      setMessage(
        error instanceof ApiError &&
          (error.code === 'AUTHENTICATION_FAILED' || error.status === 401)
          ? t.auth.loginFailed
          : customerErrorMessage(error, t),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard title={t.auth.loginTitle} intro={t.auth.loginIntro}>
      {params.get('expired') ? <Notice tone="warning">{t.auth.sessionExpired}</Notice> : null}
      {params.get('signedOut') ? <Notice tone="info">{t.auth.signedOut}</Notice> : null}
      {params.get('activated') ? <Notice tone="success">{t.auth.activated}</Notice> : null}
      {params.get('reset') ? <Notice tone="success">{t.auth.passwordReset}</Notice> : null}
      {message ? <Notice tone="error">{message}</Notice> : null}
      <form onSubmit={(event) => void submit(event)}>
        <Field id="email" label={t.auth.email} required>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            maxLength={320}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field id="password" label={t.auth.password} required>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={1024}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <SubmitButton pending={pending} label={t.auth.signIn} pendingLabel={t.auth.signingIn} />
      </form>
      <p>
        <Link href={`${base}/forgot-password`}>{t.auth.forgot}</Link>
      </p>
      <p>
        {t.auth.noAccount} <Link href={`${base}/register`}>{t.auth.register}</Link>
      </p>
    </AuthCard>
  );
}

export function CustomerLoginScreen() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

// ------------------------------------------------------------------ register + activation

/** The OTP step shared by activation: verify, or resend after the server's wait. */
function OtpStep({ flowToken, onVerified }: { flowToken: string; onVerified: () => void }) {
  const { api, t } = useCustomer();
  const [otp, setOtp] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [wait, setWait] = useState(60);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((value) => value - 1), 1_000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!OTP.test(otp.trim())) {
      setMessage({ tone: 'error', text: t.auth.otpFailed });
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      await verifyActivation(api, flowToken, otp);
      onVerified();
    } catch (error) {
      setMessage({
        tone: 'error',
        text:
          error instanceof ApiError && error.code === 'VERIFICATION_FAILED'
            ? t.auth.otpFailed
            : customerErrorMessage(error, t),
      });
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    if (pending || wait > 0) return;
    setPending(true);
    try {
      const response = await resendChallenge(api, flowToken);
      setWait(response.resendAfterSeconds);
      setMessage({ tone: 'info', text: t.auth.resent });
    } catch (error) {
      setMessage({ tone: 'error', text: customerErrorMessage(error, t) });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <form onSubmit={(event) => void verify(event)}>
        <Field id="otp" label={t.auth.otp} required>
          <input
            id="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={otp}
            onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <SubmitButton pending={pending} label={t.auth.verify} pendingLabel={t.auth.verifying} />
      </form>
      <p>
        <button
          type="button"
          className="wf-button wf-button-quiet"
          disabled={pending || wait > 0}
          onClick={() => void resend()}
        >
          {t.auth.resend}
        </button>{' '}
        {wait > 0 ? (
          <span className="wf-muted">{fill(t.auth.resendWait, { seconds: wait })}</span>
        ) : null}
      </p>
    </>
  );
}

export function CustomerRegisterScreen() {
  const { api, t, base, locale } = useCustomer();
  const router = useRouter();
  const [form, setForm] = useState({
    fullName: '',
    dateOfBirth: '',
    address: '',
    email: '',
    phone: '',
  });
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [flowToken, setFlowToken] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const problem = passwordProblem(password, confirmation, t);
    if (problem) {
      setMessage(problem);
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const flow = await registerCustomer(api, {
        fullName: form.fullName.trim(),
        dateOfBirth: form.dateOfBirth,
        address: form.address.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        password,
        locale,
      });
      setPassword('');
      setConfirmation('');
      setFlowToken(flow.flowToken);
    } catch (error) {
      setMessage(customerErrorMessage(error, t));
    } finally {
      setPending(false);
    }
  }

  if (flowToken) {
    return (
      <AuthCard title={t.auth.otpTitle} intro={t.auth.otpIntro}>
        <OtpStep
          flowToken={flowToken}
          onVerified={() => router.replace(`${base}/login?activated=1`)}
        />
      </AuthCard>
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  return (
    <AuthCard title={t.auth.registerTitle} intro={t.auth.registerIntro}>
      {message ? <Notice tone="error">{message}</Notice> : null}
      <form onSubmit={(event) => void submit(event)}>
        <Field id="fullName" label={t.auth.fullName} required>
          <input
            id="fullName"
            autoComplete="name"
            required
            maxLength={200}
            value={form.fullName}
            onChange={(event) => set('fullName')(event.target.value)}
          />
        </Field>
        <Field id="dateOfBirth" label={t.auth.dateOfBirth} required>
          <input
            id="dateOfBirth"
            type="date"
            autoComplete="bday"
            required
            max={today}
            value={form.dateOfBirth}
            onChange={(event) => set('dateOfBirth')(event.target.value)}
          />
        </Field>
        <Field id="address" label={t.auth.address} required>
          <input
            id="address"
            autoComplete="street-address"
            required
            maxLength={500}
            value={form.address}
            onChange={(event) => set('address')(event.target.value)}
          />
        </Field>
        <Field id="email" label={t.auth.email} required>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            maxLength={320}
            value={form.email}
            onChange={(event) => set('email')(event.target.value)}
          />
        </Field>
        <Field id="phone" label={t.auth.phone} required>
          <input
            id="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            required
            maxLength={32}
            value={form.phone}
            onChange={(event) => set('phone')(event.target.value)}
          />
        </Field>
        <PasswordPair
          label={t.auth.password}
          password={password}
          confirmation={confirmation}
          onPassword={setPassword}
          onConfirmation={setConfirmation}
        />
        <SubmitButton
          pending={pending}
          label={t.auth.createAccount}
          pendingLabel={t.auth.creating}
        />
      </form>
      <p>
        {t.auth.haveAccount} <Link href={`${base}/login`}>{t.auth.signIn}</Link>
      </p>
    </AuthCard>
  );
}

// ------------------------------------------------------------------ forgot password

export function CustomerForgotPasswordScreen() {
  const { api, t, base, locale } = useCustomer();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [flowToken, setFlowToken] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const busy = useRef(false);

  async function run(work: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage(null);
    try {
      await work();
    } catch (error) {
      setMessage(
        error instanceof ApiError && error.code === 'VERIFICATION_FAILED'
          ? t.auth.otpFailed
          : customerErrorMessage(error, t),
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const request = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      // The same neutral outcome whatever the account state (anti-enumeration).
      const flow = await requestCustomerReset(api, email, locale);
      setFlowToken(flow.flowToken);
    });
  };
  const complete = (event: FormEvent) => {
    event.preventDefault();
    if (!OTP.test(otp.trim())) {
      setMessage(t.auth.otpFailed);
      return;
    }
    const problem = passwordProblem(password, confirmation, t);
    if (problem) {
      setMessage(problem);
      return;
    }
    void run(async () => {
      await completeCustomerReset(api, flowToken ?? '', otp, password);
      router.replace(`${base}/login?reset=1`);
    });
  };

  return (
    <AuthCard title={t.auth.forgotTitle} intro={flowToken ? t.auth.otpIntro : t.auth.forgotIntro}>
      {message ? <Notice tone="error">{message}</Notice> : null}
      {flowToken ? (
        <form onSubmit={complete}>
          <Field id="otp" label={t.auth.otp} required>
            <input
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <PasswordPair
            label={t.auth.newPassword}
            password={password}
            confirmation={confirmation}
            onPassword={setPassword}
            onConfirmation={setConfirmation}
          />
          <SubmitButton
            pending={pending}
            label={t.auth.resetPassword}
            pendingLabel={t.auth.resetting}
          />
        </form>
      ) : (
        <form onSubmit={request}>
          <Field id="email" label={t.auth.email} required>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              maxLength={320}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <SubmitButton pending={pending} label={t.auth.sendCode} pendingLabel={t.auth.sending} />
        </form>
      )}
      <p>
        <Link href={`${base}/login`}>{t.auth.backToLogin}</Link>
      </p>
    </AuthCard>
  );
}
