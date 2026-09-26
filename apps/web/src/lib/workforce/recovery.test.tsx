import type { CurrentAccountResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { RecoveryEmailView } from '../../components/workforce/recovery-email';
import {
  ForgotPasswordView,
  type ForgotStep,
} from '../../components/workforce/screens/forgot-password';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { context, employee, json, owner, render, scriptedFetch } from '../../test/support';
import { ApiError, WorkforceApi } from './api';
import { ReauthenticationCancelled } from './reauth';
import {
  completeWorkforceReset,
  recoveryEmailState,
  recoveryErrorMessage,
  requestRecoveryEmailCode,
  requestWorkforceReset,
  resetProblem,
  verifyRecoveryEmail,
} from './recovery';

const vi = getWorkforceDictionary('vi');
const en = getWorkforceDictionary('en');
const PASSWORD = 'hoa sen xanh buổi sáng 2026';
const accepted = {
  status: 'accepted',
  flowToken: 'flow-1',
  codeLifetimeSeconds: 300,
  resendAfterSeconds: 60,
};
const withEmail = (
  base: CurrentAccountResponse,
  recoveryEmail: { address: string; verified: boolean } | null,
): CurrentAccountResponse => ({ ...base, recoveryEmail });
const recoveryView = (
  account: CurrentAccountResponse | null,
  as = owner,
  locale: 'vi' | 'en' = 'vi',
) => render(<RecoveryEmailView account={account} reload={() => Promise.resolve()} />, as, locale);
const forgotView = (
  step: ForgotStep,
  extra: Partial<Parameters<typeof ForgotPasswordView>[0]> = {},
) =>
  render(
    <ForgotPasswordView
      step={step}
      email="owner@lucyspa.vn"
      code=""
      password=""
      confirmation=""
      problem={null}
      error={null}
      pending={false}
      loginHref="/vi/workforce/login"
      onEmail={() => undefined}
      onCode={() => undefined}
      onPassword={() => undefined}
      onConfirmation={() => undefined}
      onRequest={() => undefined}
      onComplete={() => undefined}
      onRestart={() => undefined}
      t={vi}
      {...extra}
    />,
    owner,
  );

test('recovery email: status shown; the Owner is urged to verify while signed in', () => {
  const unverified = recoveryView(
    withEmail(owner, { address: 'owner@lucyspa.vn', verified: false }),
  );
  assert.ok(unverified.includes('owner@lucyspa.vn'));
  assert.ok(unverified.includes(`>${vi.recovery.unverified}<`));
  assert.ok(unverified.includes(vi.recovery.ownerWarning));
  assert.ok(unverified.includes(`>${vi.recovery.sendCode}<`));
  const staff = employee([]);
  const employeeView = recoveryView(
    withEmail(staff, { address: 'lan@example.com', verified: false }),
    staff,
  );
  assert.ok(employeeView.includes(vi.recovery.unverifiedWarning));
  assert.ok(!employeeView.includes(vi.recovery.ownerWarning));
  const verified = recoveryView(withEmail(owner, { address: 'owner@lucyspa.vn', verified: true }));
  assert.ok(verified.includes(`>${vi.recovery.verified}<`));
  assert.ok(!verified.includes(vi.recovery.sendCode), 'nothing to do once verified');
  assert.ok(recoveryView(withEmail(staff, null), staff).includes(vi.recovery.missing));
  assert.equal(recoveryView(owner), '', 'no status known: nothing shown');
  assert.equal(recoveryView(null), '');
  assert.ok(
    recoveryView(withEmail(owner, { address: 'o@x.vn', verified: false }), owner, 'en').includes(
      'Verify it now.',
    ),
  );
  assert.equal(recoveryEmailState(withEmail(owner, { address: 'a', verified: true })), 'verified');
  assert.equal(recoveryEmailState(withEmail(owner, null)), 'missing');
  assert.equal(recoveryEmailState(owner), 'unknown');
});

test('recovery email uses the existing endpoints (request needs a password confirmation)', async () => {
  const { fetcher, calls } = scriptedFetch([
    context('c', true),
    () => json(202, accepted),
    () => new Response(null, { status: 204 }),
  ]);
  const api = new WorkforceApi({ fetch: fetcher });
  await requestRecoveryEmailCode(api);
  await verifyRecoveryEmail(api, 'flow-1', ' 123456 ');
  assert.deepEqual(
    calls.slice(1).map((call) => [call.url, call.body]),
    [
      ['/api/v1/auth/recovery-email/request', {}],
      ['/api/v1/auth/recovery-email/verify', { flowToken: 'flow-1', otp: '123456' }],
    ],
  );
  assert.equal(recoveryErrorMessage(new ReauthenticationCancelled(), vi), vi.reauth.cancelled);
});

test('forgot password: WORKFORCE request and completion over the existing endpoints', async () => {
  const { fetcher, calls } = scriptedFetch([
    context('c'),
    () => json(202, accepted),
    () => new Response(null, { status: 204 }),
  ]);
  const api = new WorkforceApi({ fetch: fetcher });
  const flow = await requestWorkforceReset(api, ' Owner@LucySpa.vn ', 'vi');
  await completeWorkforceReset(api, flow.flowToken, '654321', PASSWORD);
  assert.deepEqual(
    calls.slice(1).map((call) => [call.url, call.body]),
    [
      [
        '/api/v1/auth/password-reset/request',
        { realm: 'WORKFORCE', email: 'Owner@LucySpa.vn', locale: 'vi' },
      ],
      [
        '/api/v1/auth/password-reset/complete',
        { flowToken: 'flow-1', otp: '654321', newPassword: PASSWORD },
      ],
    ],
  );
  // Immediate checks mirror the policy; the API decides the rest.
  assert.equal(resetProblem('12345', PASSWORD, PASSWORD), 'code');
  assert.equal(resetProblem('123456', 'short', 'short'), 'length');
  assert.equal(resetProblem('123456', PASSWORD, `${PASSWORD}!`), 'mismatch');
  assert.equal(resetProblem(' 123456 ', PASSWORD, PASSWORD), null);
  // Steps: email → code (+ new password) → done, always with a way back to sign in.
  const first = forgotView('email');
  assert.match(first, /id="forgot-email" type="email"/);
  assert.ok(first.includes('href="/vi/workforce/login"'));
  const second = forgotView('code');
  assert.match(second, /id="forgot-code"[^>]*autoComplete="one-time-code"/);
  assert.match(second, /id="forgot-password" type="password"[^>]*minLength="15"/);
  assert.ok(second.includes(vi.recovery.confirmPassword));
  assert.ok(forgotView('done').includes(vi.recovery.done));
  assert.ok(forgotView('code', { problem: 'mismatch' }).includes(vi.recovery.passwordMismatch));
  // The login page links to it.
  const login = readFileSync(
    fileURLToPath(new URL('../../components/workforce/screens/login.tsx', import.meta.url)),
    'utf8',
  );
  assert.match(login, /href=\{`\$\{base\}\/forgot-password`\}/);
  assert.equal(vi.auth.forgotPassword, 'Quên mật khẩu?');
  assert.equal(en.auth.forgotPassword, 'Forgot password?');
});

test('anti-enumeration: one neutral message; code failures are never specific', () => {
  const second = forgotView('code', { email: 'someone-who-does-not-exist@example.com' });
  assert.ok(second.includes(vi.recovery.requested));
  assert.doesNotMatch(second, /someone-who-does-not-exist/, 'the email is not echoed back');
  for (const text of [vi.recovery.requested, en.recovery.requested]) {
    assert.match(text, /Nếu email này|If this email/);
  }
  // Wrong, expired, used or malformed codes all read the same.
  for (const error of [
    new ApiError(400, 'VERIFICATION_FAILED'),
    new ApiError(400, 'VALIDATION_FAILED', 'otp'),
    new ApiError(400, 'HTTP_400'),
  ]) {
    assert.equal(recoveryErrorMessage(error, vi), vi.recovery.codeRejected);
  }
  assert.equal(
    recoveryErrorMessage(new ApiError(400, 'VALIDATION_FAILED', 'newPassword'), vi),
    vi.employees.create.passwordRejected,
  );
  assert.equal(recoveryErrorMessage(new ApiError(429, 'RATE_LIMITED'), vi), vi.errors.rateLimited);
});
