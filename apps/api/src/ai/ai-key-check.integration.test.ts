import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { ClaudeClient, FakeAnthropic, processKeyCheck } from '@lucy-spa/server';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { AiService } from './ai.service.js';

const fake = new FakeAnthropic();
let baseUrl = '';
before(async () => {
  baseUrl = await fake.start();
});
after(async () => {
  await fake.stop();
});

/**
 * Claude integration Wave A (CI-X3) against real PostgreSQL and the fake Anthropic: the worker answers a key check the API recorded.
 * Nothing is called unless a check is pending; each outcome (good key, rejected key, no key, limit reached, unreachable) is written as a
 * status the screen explains. The key is never in an answer. Fixtures roll back.
 */
test(
  'Claude integration Wave A key check: only when asked, every outcome written, no key in any answer; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const { tx } = base;
      const ai = new AiService(base.adapter, base.throttle);
      const manager = await base.staff([], { globalCodes: ['MANAGE_AI_SETTINGS'] });
      const KEY = 'sk-ant-never-in-an-answer';
      ai.env = { ANTHROPIC_API_KEY: KEY };
      const ask = async () => {
        const { settings } = await ai.getSettings(manager.token);
        return ai.requestKeyCheck(manager.token, { expectedRowVersion: settings.rowVersion });
      };

      await suite.test('nothing pending: no request leaves, nothing is written', async () => {
        fake.requests.length = 0;
        assert.equal(await processKeyCheck(tx, new ClaudeClient({ apiKey: KEY, baseUrl })), null);
        assert.equal(fake.requests.length, 0);
      });

      await suite.test(
        'a good key: one free request lists a model; the status is OK and the check is no longer pending',
        async () => {
          const asked = await ask();
          assert.equal(asked.key.checkPending, true);
          fake.enqueue({ kind: 'message', text: '' });
          assert.equal(await processKeyCheck(tx, new ClaudeClient({ apiKey: KEY, baseUrl })), 'OK');
          assert.equal(fake.requests.at(-1)!.path.split('?')[0], '/v1/models');
          assert.equal(fake.requests.at(-1)!.headers['x-api-key'], KEY);
          const answered = await ai.getSettings(manager.token);
          assert.deepEqual(
            [answered.key.lastCheckStatus, answered.key.checkPending],
            ['OK', false],
          );
          assert.ok(answered.key.lastCheckAt !== null);
          assert.ok(!JSON.stringify(answered).includes(KEY));
          // Answered once: the next tick does nothing.
          const sent = fake.requests.length;
          assert.equal(await processKeyCheck(tx, new ClaudeClient({ apiKey: KEY, baseUrl })), null);
          assert.equal(fake.requests.length, sent);
        },
      );

      const outcomes: [string, Parameters<FakeAnthropic['enqueue']>, string | null, string][] = [
        [
          'a rejected key',
          [
            {
              kind: 'error',
              status: 401,
              type: 'authentication_error',
              message: 'invalid x-api-key',
            },
          ],
          KEY,
          'AUTH_FAILED',
        ],
        ['no key in this process', [], null, 'KEY_MISSING'],
        [
          'the Owner’s own Console limit',
          [
            {
              kind: 'error',
              status: 400,
              type: 'invalid_request_error',
              message: 'You have reached your specified API usage limits.',
            },
          ],
          KEY,
          'LIMIT_REACHED',
        ],
        [
          'a server that cannot be reached',
          [{ kind: 'drop' }, { kind: 'drop' }],
          KEY,
          'UNREACHABLE',
        ],
      ];
      for (const [name, replies, key, expected] of outcomes) {
        await suite.test(`${name} is written as ${expected}`, async () => {
          await ask();
          fake.enqueue(...replies);
          const before = fake.requests.length;
          assert.equal(
            await processKeyCheck(tx, new ClaudeClient({ apiKey: key ?? undefined, baseUrl })),
            expected,
          );
          if (key === null) assert.equal(fake.requests.length, before, 'no request without a key');
          const answered = await ai.getSettings(manager.token);
          assert.equal(answered.key.lastCheckStatus, expected);
          assert.equal(answered.key.checkPending, false);
        });
      }
    });
  },
);
