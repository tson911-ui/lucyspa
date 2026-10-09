'use client';

import {
  BrandWordmark,
  Button,
  buttonClass,
  Card,
  Field,
  Icon,
  Notice,
  PasswordInput,
  PublicMain,
  SegmentedControl,
  TextInput,
} from '@lucy-spa/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
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
import { announceSessionChange } from '../../../lib/site-session';
import { dayMonthYearToIso, maskDayMonthYear } from '../../../lib/customer/date-input-core';
import { useCustomer } from '../session';

const PASSWORD = { min: 8, max: 128 };
const OTP = /^[0-9]{6}$/;
const passwordLength = (value: string) => [...value.normalize('NFC')].length;

/** The centered card on the page band (Part 2 contract 5.4): the shared header and footer stay around it. */
function AuthCard({
  title,
  intro,
  mode,
  children,
}: {
  title: string;
  intro?: string;
  /** Sign-in and registration switch between each other; the other steps have no switch. */
  mode?: 'login' | 'register';
  children: ReactNode;
}) {
  const { t, base } = useCustomer();
  const router = useRouter();
  const titleId = useId();
  return (
    <PublicMain>
      <div className="ls-member-auth">
        <aside className="ls-member-aside" aria-hidden="true">
          <BrandWordmark serif />
          <p className="ls-member-aside-title">{t.auth.asideTitle}</p>
          <ul>
            {[t.auth.asideOne, t.auth.asideTwo, t.auth.asideThree].map((line) => (
              <li key={line}>
                <Icon name="check" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </aside>
        <Card as="section" aria-labelledby={titleId} className="ls-member-card">
          <div className="ls-member-head">
            <h1 id={titleId} className="ls-member-title">
              {title}
            </h1>
            {intro ? <p>{intro}</p> : null}
          </div>
          {mode ? (
            <SegmentedControl
              label={t.auth.modes}
              value={mode}
              options={[
                { value: 'login', label: t.auth.signIn },
                { value: 'register', label: t.auth.registerTab },
              ]}
              onChange={(next) => {
                if (next === mode) return;
                // The page to return to travels with the visitor between the two forms.
                const carry = new URLSearchParams(window.location.search).get('next');
                const query = carry ? `?${new URLSearchParams({ next: carry }).toString()}` : '';
                router.push(`${base}/${next}${query}`);
              }}
            />
          ) : null}
          {children}
        </Card>
      </div>
    </PublicMain>
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
      <Field label={label} required requiredLabel={t.common.required} hint={t.auth.passwordHint}>
        {(control) => (
          <PasswordInput
            {...control}
            showLabel={t.auth.showPassword}
            hideLabel={t.auth.hidePassword}
            autoComplete="new-password"
            minLength={PASSWORD.min}
            maxLength={1024}
            value={password}
            onChange={(event) => onPassword(event.target.value)}
          />
        )}
      </Field>
      <Field label={t.auth.passwordConfirm} required requiredLabel={t.common.required}>
        {(control) => (
          <PasswordInput
            {...control}
            showLabel={t.auth.showPassword}
            hideLabel={t.auth.hidePassword}
            autoComplete="new-password"
            maxLength={1024}
            value={confirmation}
            onChange={(event) => onConfirmation(event.target.value)}
          />
        )}
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

function SubmitRow({
  pending,
  label,
  pendingLabel,
  before,
}: {
  pending: boolean;
  label: string;
  pendingLabel: string;
  /** Secondary actions come first; the submit is always last (the footer rule). */
  before?: ReactNode;
}) {
  return (
    <div className="ls-member-actions">
      {before}
      <Button type="submit" variant="primary" loading={pending}>
        {pending ? pendingLabel : label}
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ sign in

/**
 * What the sign-in page's address says. The server page reads the search parameters and passes them down, so the whole
 * card is in the first HTML (no skeleton that swaps for the form after the scripts load).
 */
export interface LoginQuery {
  next?: string | undefined;
  expired?: boolean | undefined;
  signedOut?: boolean | undefined;
  activated?: boolean | undefined;
  reset?: boolean | undefined;
}

function LoginForm({ query }: { query: LoginQuery }) {
  const { api, t, base } = useCustomer();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const destination = safeCustomerNext(query.next ?? null, base);

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
      announceSessionChange();
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
    <AuthCard title={t.auth.loginTitle} intro={t.auth.loginIntro} mode="login">
      {query.expired ? <Notice tone="warning">{t.auth.sessionExpired}</Notice> : null}
      {query.signedOut ? <Notice tone="info">{t.auth.signedOut}</Notice> : null}
      {query.activated ? <Notice tone="success">{t.auth.activated}</Notice> : null}
      {query.reset ? <Notice tone="success">{t.auth.passwordReset}</Notice> : null}
      {message ? <Notice tone="danger">{message}</Notice> : null}
      <form className="ls-member-form" onSubmit={(event) => void submit(event)}>
        <Field label={t.auth.email} required requiredLabel={t.common.required}>
          {(control) => (
            <TextInput
              {...control}
              type="email"
              autoComplete="username"
              maxLength={320}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>
        <Field
          label={t.auth.password}
          required
          requiredLabel={t.common.required}
          labelAction={<Link href={`${base}/forgot-password`}>{t.auth.forgot}</Link>}
        >
          {(control) => (
            <PasswordInput
              {...control}
              showLabel={t.auth.showPassword}
              hideLabel={t.auth.hidePassword}
              autoComplete="current-password"
              maxLength={1024}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
        <SubmitRow pending={pending} label={t.auth.signIn} pendingLabel={t.auth.signingIn} />
      </form>
    </AuthCard>
  );
}

export function CustomerLoginScreen({ query = {} }: { query?: LoginQuery }) {
  return <LoginForm query={query} />;
}

// ------------------------------------------------------------------ register + activation

/** The OTP step shared by activation: verify, or resend after the server's wait. */
function OtpStep({ flowToken, onVerified }: { flowToken: string; onVerified: () => void }) {
  const { api, t } = useCustomer();
  const [otp, setOtp] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: 'danger' | 'info'; text: string } | null>(null);
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
      setMessage({ tone: 'danger', text: t.auth.otpFailed });
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      await verifyActivation(api, flowToken, otp);
      onVerified();
    } catch (error) {
      setMessage({
        tone: 'danger',
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
      setMessage({ tone: 'danger', text: customerErrorMessage(error, t) });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <form className="ls-member-form" onSubmit={(event) => void verify(event)}>
        <Field
          label={t.auth.otp}
          required
          requiredLabel={t.common.required}
          {...(wait > 0 ? { hint: fill(t.auth.resendWait, { seconds: wait }) } : {})}
        >
          {(control) => (
            <TextInput
              {...control}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))}
            />
          )}
        </Field>
        <SubmitRow
          pending={pending}
          label={t.auth.verify}
          pendingLabel={t.auth.verifying}
          before={
            <Button
              type="button"
              variant="secondary"
              disabled={pending || wait > 0}
              onClick={() => void resend()}
            >
              {t.auth.resend}
            </Button>
          }
        />
      </form>
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
    referrerPhone: '',
  });
  // The birth date is typed as dd/mm/yyyy (what a browser set to English would not show); the form keeps the ISO date.
  const [dobText, setDobText] = useState('');
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
        // Optional; the server never says whether it matched a member.
        ...(form.referrerPhone.trim() ? { referrerPhone: form.referrerPhone.trim() } : {}),
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
          onVerified={() => {
            // The page the visitor wanted comes back through sign-in after the account is activated.
            const carry = new URLSearchParams(window.location.search).get('next');
            const query = new URLSearchParams({
              activated: '1',
              ...(carry ? { next: carry } : {}),
            });
            router.replace(`${base}/login?${query.toString()}`);
          }}
        />
      </AuthCard>
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  const required = { required: true, requiredLabel: t.common.required } as const;
  return (
    <AuthCard title={t.auth.registerTitle} intro={t.auth.registerIntro} mode="register">
      {message ? <Notice tone="danger">{message}</Notice> : null}
      <form className="ls-member-form" onSubmit={(event) => void submit(event)}>
        <Field label={t.auth.fullName} {...required}>
          {(control) => (
            <TextInput
              {...control}
              autoComplete="name"
              maxLength={200}
              value={form.fullName}
              onChange={(event) => set('fullName')(event.target.value)}
            />
          )}
        </Field>
        <Field
          label={t.auth.dateOfBirth}
          hint={t.auth.dateOfBirthHint}
          error={
            dobText.length === 10 && form.dateOfBirth === '' ? t.auth.dateOfBirthInvalid : undefined
          }
          {...required}
        >
          {(control) => (
            <TextInput
              {...control}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="dd/mm/yyyy"
              maxLength={10}
              value={dobText}
              onChange={(event) => {
                const text = maskDayMonthYear(event.target.value);
                setDobText(text);
                set('dateOfBirth')(dayMonthYearToIso(text, today) ?? '');
              }}
            />
          )}
        </Field>
        <Field label={t.auth.address} {...required}>
          {(control) => (
            <TextInput
              {...control}
              autoComplete="street-address"
              maxLength={500}
              value={form.address}
              onChange={(event) => set('address')(event.target.value)}
            />
          )}
        </Field>
        <Field label={t.auth.email} {...required}>
          {(control) => (
            <TextInput
              {...control}
              type="email"
              autoComplete="email"
              maxLength={320}
              value={form.email}
              onChange={(event) => set('email')(event.target.value)}
            />
          )}
        </Field>
        <Field label={t.auth.phone} {...required}>
          {(control) => (
            <TextInput
              {...control}
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              maxLength={32}
              value={form.phone}
              onChange={(event) => set('phone')(event.target.value)}
            />
          )}
        </Field>
        <Field label={t.auth.referrerPhone} hint={t.auth.referrerHint}>
          {(control) => (
            <TextInput
              {...control}
              type="tel"
              autoComplete="off"
              inputMode="tel"
              maxLength={32}
              value={form.referrerPhone}
              onChange={(event) => set('referrerPhone')(event.target.value)}
            />
          )}
        </Field>
        <PasswordPair
          label={t.auth.password}
          password={password}
          confirmation={confirmation}
          onPassword={setPassword}
          onConfirmation={setConfirmation}
        />
        <SubmitRow pending={pending} label={t.auth.createAccount} pendingLabel={t.auth.creating} />
      </form>
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

  const back = (
    <Link href={`${base}/login`} className={buttonClass('ghost')}>
      {t.auth.backToLogin}
    </Link>
  );
  const required = { required: true, requiredLabel: t.common.required } as const;
  return (
    <AuthCard title={t.auth.forgotTitle} intro={flowToken ? t.auth.otpIntro : t.auth.forgotIntro}>
      {message ? <Notice tone="danger">{message}</Notice> : null}
      {flowToken ? (
        <form className="ls-member-form" onSubmit={complete}>
          <Field label={t.auth.otp} {...required}>
            {(control) => (
              <TextInput
                {...control}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))}
              />
            )}
          </Field>
          <PasswordPair
            label={t.auth.newPassword}
            password={password}
            confirmation={confirmation}
            onPassword={setPassword}
            onConfirmation={setConfirmation}
          />
          <SubmitRow
            pending={pending}
            label={t.auth.resetPassword}
            pendingLabel={t.auth.resetting}
            before={back}
          />
        </form>
      ) : (
        <form className="ls-member-form" onSubmit={request}>
          <Field label={t.auth.email} {...required}>
            {(control) => (
              <TextInput
                {...control}
                type="email"
                autoComplete="email"
                maxLength={320}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>
          <SubmitRow
            pending={pending}
            label={t.auth.sendCode}
            pendingLabel={t.auth.sending}
            before={back}
          />
        </form>
      )}
    </AuthCard>
  );
}
