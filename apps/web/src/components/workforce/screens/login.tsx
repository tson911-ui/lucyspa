'use client';

import { AuthLayout, BrandWordmark, PasswordInput, SegmentedControl } from '@lucy-spa/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../../../lib/workforce/api';
import { isWorkforce } from '../../../lib/workforce/permissions';
import {
  errorMessage,
  loadSession,
  workforceLogin,
  workforceLogout,
} from '../../../lib/workforce/workflows';
import { AuthTopActions } from '../auth-actions';
import { useWorkforce } from '../session';
import { Field, Notice, SubmitButton } from '../ui';

/** Only same-area relative paths are accepted as a post-login destination. */
export function safeNext(next: string | null, base: string): string {
  if (!next || next.includes('\\') || !(next === base || next.startsWith(`${base}/`))) return base;
  return next.startsWith(`${base}/login`) ? base : next;
}

function LoginForm() {
  const { api, t, base } = useWorkforce();
  const router = useRouter();
  const params = useSearchParams();
  const [identifierType, setIdentifierType] = useState<'EMPLOYEE_ID' | 'EMAIL'>('EMPLOYEE_ID');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const destination = safeNext(params.get('next'), base);

  // An already signed-in workforce session goes straight in.
  useEffect(() => {
    let active = true;
    loadSession(api)
      .then((session) => {
        if (active && session.kind === 'workforce') router.replace(destination);
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
      const account = await workforceLogin(api, {
        identifierType,
        identifier: identifier.trim(),
        password,
      });
      if (!isWorkforce(account)) {
        // Realms are separate on the server; this is a defensive UX check only.
        await workforceLogout(api);
        setMessage(t.auth.customerNotAllowed);
        return;
      }
      setPassword('');
      router.replace(destination);
    } catch (error) {
      setPassword('');
      setMessage(
        error instanceof ApiError &&
          (error.code === 'AUTHENTICATION_FAILED' || error.status === 401)
          ? t.auth.loginFailed
          : errorMessage(error, t),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout brand={<BrandWordmark size="display" />} topActions={<AuthTopActions />}>
      <h1>{t.auth.loginTitle}</h1>
      <p className="wf-muted">{t.auth.loginIntro}</p>
      {params.get('expired') ? <Notice tone="warning">{t.auth.sessionExpired}</Notice> : null}
      {params.get('signedOut') ? <Notice tone="info">{t.auth.signedOut}</Notice> : null}
      {message ? <Notice tone="error">{message}</Notice> : null}
      <form onSubmit={(event) => void submit(event)} noValidate={false}>
        <SegmentedControl
          label={t.auth.identifierType}
          value={identifierType}
          onChange={setIdentifierType}
          options={[
            { value: 'EMPLOYEE_ID', label: t.auth.byEmployeeId },
            { value: 'EMAIL', label: t.auth.byEmail },
          ]}
        />
        <Field
          id="identifier"
          label={identifierType === 'EMAIL' ? t.auth.email : t.auth.employeeId}
          required
        >
          <input
            id="identifier"
            name="identifier"
            type={identifierType === 'EMAIL' ? 'email' : 'text'}
            autoComplete="username"
            required
            maxLength={256}
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
          />
        </Field>
        <Field
          id="password"
          label={t.auth.password}
          required
          labelAction={<Link href={`${base}/forgot-password`}>{t.auth.forgotPassword}</Link>}
        >
          <PasswordInput
            id="password"
            name="password"
            showLabel={t.auth.showPassword}
            hideLabel={t.auth.hidePassword}
            autoComplete="current-password"
            required
            maxLength={1024}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <SubmitButton pending={pending} label={t.auth.signIn} pendingLabel={t.auth.signingIn} />
      </form>
    </AuthLayout>
  );
}

export function LoginScreen() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
