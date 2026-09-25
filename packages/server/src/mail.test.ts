import assert from 'node:assert/strict';
import { createServer, type Socket } from 'node:net';
import { test } from 'node:test';
import { AuthEmailSendError, renderAuthEmail, type AuthEmailPurpose } from './auth-email.js';
import {
  classifySmtpFailure,
  FakeAuthEmailTransport,
  parseMailEnvironment,
  SmtpAuthEmailTransport,
} from './mail.js';

const relay = {
  MAIL_TRANSPORT: 'smtp',
  SMTP_HOST: 'smtp-relay.gmail.com',
  MAIL_FROM_ADDRESS: 'system@lucyspa.vn',
};

test('mail configuration is explicit, TLS-only and never echoes values', () => {
  // The production relay: STARTTLS on 587, no credentials, Lucy Spa sender.
  assert.deepEqual(parseMailEnvironment(relay, 'production'), {
    transport: 'smtp',
    host: 'smtp-relay.gmail.com',
    port: 587,
    security: 'starttls',
    ehloName: 'lucyspa.vn',
    timeoutMs: 15_000,
    fromAddress: 'system@lucyspa.vn',
    fromName: 'Lucy Spa',
  });
  const implicit = parseMailEnvironment({ ...relay, SMTP_SECURITY: 'tls' }, 'production');
  assert.equal(implicit.transport === 'smtp' ? implicit.port : 0, 465);
  assert.deepEqual(parseMailEnvironment({}, 'development'), { transport: 'disabled' });
  assert.deepEqual(parseMailEnvironment({ MAIL_TRANSPORT: 'disabled' }, 'production'), {
    transport: 'disabled',
  });
  const rejects = (env: NodeJS.ProcessEnv, field: string) =>
    assert.throws(
      () => parseMailEnvironment(env, 'production'),
      (error: unknown) =>
        error instanceof Error &&
        error.message === `Invalid email configuration: ${field}` &&
        !Object.values(env).some(
          (value) => value && value.length > 3 && error.message.includes(value),
        ),
    );
  // Production must choose explicitly; no silent default.
  rejects({}, 'MAIL_TRANSPORT');
  rejects({ MAIL_TRANSPORT: 'sendmail' }, 'MAIL_TRANSPORT');
  rejects({ ...relay, SMTP_HOST: 'smtp relay;evil' }, 'SMTP_HOST');
  rejects({ ...relay, SMTP_HOST: undefined }, 'SMTP_HOST');
  // Plaintext SMTP cannot be configured.
  rejects({ ...relay, SMTP_SECURITY: 'none' }, 'SMTP_SECURITY');
  rejects({ ...relay, SMTP_PORT: '0' }, 'SMTP_PORT');
  rejects({ ...relay, SMTP_PORT: '70000' }, 'SMTP_PORT');
  rejects({ ...relay, MAIL_FROM_ADDRESS: 'Lucy Spa <system@lucyspa.vn>' }, 'MAIL_FROM_ADDRESS');
  rejects({ ...relay, MAIL_FROM_ADDRESS: undefined }, 'MAIL_FROM_ADDRESS');
  rejects({ ...relay, MAIL_FROM_NAME: 'Lucy\r\nBcc: x@evil.test' }, 'MAIL_FROM_NAME');
  rejects({ ...relay, MAIL_FROM_NAME: '"Quoted"' }, 'MAIL_FROM_NAME');
  rejects({ ...relay, SMTP_TIMEOUT_MS: '10' }, 'SMTP_TIMEOUT_MS');
});

test('provider failures become safe codes: 5xx permanent, 4xx and network transient', () => {
  const secret = 'to linh@example.com code 012345';
  const cases: [unknown, string, boolean][] = [
    [Object.assign(new Error(secret), { responseCode: 550 }), 'PROVIDER_REJECTED', true],
    [Object.assign(new Error(secret), { code: 'EENVELOPE' }), 'RECIPIENT_REJECTED', true],
    [Object.assign(new Error(secret), { responseCode: 421 }), 'PROVIDER_DEFERRED', false],
    [Object.assign(new Error(secret), { code: 'ETIMEDOUT' }), 'PROVIDER_UNAVAILABLE', false],
    ['not even an error', 'PROVIDER_UNAVAILABLE', false],
  ];
  for (const [input, code, permanent] of cases) {
    const error = classifySmtpFailure(input);
    assert.ok(error instanceof AuthEmailSendError);
    assert.equal(error.safeCode, code);
    assert.equal(error.permanent, permanent);
    assert.equal(error.message.includes('012345') || error.message.includes('linh@'), false);
  }
});

test('templates: Lucy Spa branding, purpose, code, deadline and ignore guidance', () => {
  const expiresAt = new Date('2026-09-25T07:35:00Z'); // 14:35 in Vietnam
  const purposes: AuthEmailPurpose[] = [
    'ACTIVATE_CUSTOMER',
    'RESET_PASSWORD',
    'VERIFY_RECOVERY_EMAIL',
  ];
  const subjects = new Set<string>();
  for (const purpose of purposes) {
    for (const locale of ['vi', 'en'] as const) {
      const email = renderAuthEmail({
        deliveryId: 'd',
        purpose,
        to: 'linh@example.com',
        code: '012345',
        locale,
        expiresAt,
      });
      subjects.add(email.subject);
      assert.match(email.subject, /^Lucy Spa – /);
      assert.equal(/test/i.test(email.subject), false, 'no test branding');
      assert.ok(email.text.includes('    012345'));
      assert.ok(email.text.includes('14:35, 25/09/2026'));
      assert.match(email.text, locale === 'vi' ? /bỏ qua email này/ : /ignore this email/);
      assert.equal(email.text.includes('linh@example.com'), false, 'no recipient echo');
    }
  }
  assert.equal(subjects.size, 6, 'distinct subject per purpose and locale');
  const reset = renderAuthEmail({
    deliveryId: 'd',
    purpose: 'RESET_PASSWORD',
    to: 'x@example.com',
    code: '000001',
    locale: 'vi',
    expiresAt,
  });
  assert.equal(reset.subject, 'Lucy Spa – Mã đặt lại mật khẩu');
});

test('the fake transport records sends and replays queued failures', async () => {
  const transport = new FakeAuthEmailTransport();
  const message = {
    deliveryId: 'd1',
    purpose: 'RESET_PASSWORD' as const,
    to: 'linh@example.com',
    code: '012345',
    locale: 'en' as const,
    expiresAt: new Date(),
    subject: 's',
    text: 't',
  };
  transport.failNext(new AuthEmailSendError('PROVIDER_DEFERRED', false));
  await assert.rejects(transport.send(message, 'd1'), AuthEmailSendError);
  assert.deepEqual(await transport.send(message, 'd1'), { providerMessageId: 'fake-1' });
  assert.equal(transport.sent[0]?.idempotencyKey, 'd1');
});

test('SMTP transport refuses to send when the server does not offer STARTTLS', async () => {
  // Local plaintext SMTP server: no network egress, never a real provider.
  const commands: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.write('220 local.test ESMTP\r\n');
    socket.on('data', (chunk) => {
      for (const line of chunk.toString('utf8').split('\r\n').filter(Boolean)) {
        commands.push(line.split(' ')[0]!.toUpperCase());
        if (/^EHLO/i.test(line)) socket.write('250-local.test\r\n250 SIZE 1000000\r\n');
        else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const transport = new SmtpAuthEmailTransport({
    host: '127.0.0.1',
    port: address.port,
    security: 'starttls',
    ehloName: 'lucyspa.vn',
    timeoutMs: 5_000,
    fromAddress: 'system@lucyspa.vn',
    fromName: 'Lucy Spa',
  });
  try {
    await assert.rejects(
      transport.send(
        {
          deliveryId: 'd',
          purpose: 'RESET_PASSWORD',
          to: 'linh@example.com',
          code: '012345',
          locale: 'en',
          expiresAt: new Date(),
          subject: 's',
          text: 'code 012345',
        },
        '11111111-1111-4111-8111-111111111111',
      ),
      (error: unknown) =>
        error instanceof AuthEmailSendError &&
        error.permanent === false &&
        !error.message.includes('012345'),
    );
    assert.equal(commands.includes('MAIL'), false, 'no envelope over plaintext');
    assert.equal(commands.includes('DATA'), false, 'no content over plaintext');
    assert.equal(commands.includes('AUTH'), false, 'no SMTP AUTH');
  } finally {
    transport.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
