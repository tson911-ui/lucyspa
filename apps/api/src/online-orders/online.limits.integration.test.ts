import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onlineOrderKit } from '../testing/online-order-kit.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { msToWindowEnd } from '../testing/throttle-window.js';
import { ONLINE_LIMITS } from './online.input.js';

/**
 * Phase 6 Wave 4 / P6-22 against real PostgreSQL: one member cannot occupy the API. The most successful online requests per minute is
 * counted per account in the same transaction; another member is not affected; a request that fails does not use the budget.
 */
test(
  'Phase 6 P6-22 per-account request budget of the online routes; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async () => {
    await phase6Fixture(async (base) => {
      const k = await onlineOrderKit(base);
      const { fails } = base;
      // The budget counts in fixed one-minute windows: start when the current one has room for the whole test.
      const left = msToWindowEnd(Date.now(), 60_000);
      if (left < 15_000) await new Promise((done) => setTimeout(done, left + 1_000));
      await k.open();
      const noisy = await k.member('noisy');
      const quiet = await k.member('quiet');
      for (let i = 0; i < ONLINE_LIMITS.memberRequestsPerMinute; i += 1) {
        await k.online.cart(noisy.token);
      }
      await fails(() => k.online.cart(noisy.token), 'RATE_LIMITED');
      await fails(() => k.online.list(noisy.token, undefined), 'RATE_LIMITED');
      // The budget is the account's own: another member and the public settings are not touched.
      assert.ok((await k.online.cart(quiet.token)).lines.length === 0);
      assert.equal((await k.online.publicSettings()).enabled, true);
    });
  },
);
