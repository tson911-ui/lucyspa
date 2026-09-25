'use client';

import { BrandWordmark } from '@lucy-spa/ui';
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
import { useWorkforce } from '../session';
import { Field, Notice, SubmitButton } from '../ui';

/** Only same-area relative paths are accepted as a post-login destination. */
export function safeNext(next: string | null, base: string): string {
  if (!next || next.includes('\\') || !(next === base || next.startsWith(`${base}/`))) return base;
  return next.startsWith(`${base}/login`) ? base : next;
}

function LoginForm() {
  const { api, t, base, locale } = useWorkforce();
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

  const other = locale === 'vi' ? 'en' : 'vi';
  return (
    <main className="wf-login" id="main-content" tabIndex={-1}>
      <div className="wf-login-card">
        <div className="wf-login-brand">
          <BrandWordmark />
          <Link
            href={`/${other}/workforce/login`}
            hrefLang={other}
            lang={other}
            className="wf-lang"
          >
            {other === 'vi' ? 'Tiếng Việt' : 'English'}
          </Link>
        </div>
        <h1>{t.auth.loginTitle}</h1>
        <p className="wf-muted">{t.auth.loginIntro}</p>
        {params.get('expired') ? <Notice tone="warning">{t.auth.sessionExpired}</Notice> : null}
        {params.get('signedOut') ? <Notice tone="info">{t.auth.signedOut}</Notice> : null}
        {message ? <Notice tone="error">{message}</Notice> : null}
        <form onSubmit={(event) => void submit(event)} noValidate={false}>
          <fieldset className="wf-segmented">
            <legend>{t.auth.identifierType}</legend>
            {(['EMPLOYEE_ID', 'EMAIL'] as const).map((type) => (
              <label key={type}>
                <input
                  type="radio"
                  name="identifierType"
                  value={type}
                  checked={identifierType === type}
                  onChange={() => setIdentifierType(type)}
                />
                {type === 'EMAIL' ? t.auth.byEmail : t.auth.byEmployeeId}
              </label>
            ))}
          </fieldset>
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
          <Field id="password" label={t.auth.password} required>
            <input
              id="password"
              name="password"
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
      </div>
    </main>
  );
}

export function LoginScreen() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
