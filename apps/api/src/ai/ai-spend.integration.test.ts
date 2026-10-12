import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  costMicroUsd,
  loadAiSettings,
  monthSpend,
  releaseReservation,
  reserveSpend,
  vndToMicroUsd,
  writeLedger,
} from '@lucy-spa/server';
import { phase6Fixture } from '../testing/phase6-fixture.js';

/**
 * Claude integration Wave A (CI-X3) against real PostgreSQL: the spending cap in the app. The settings start with nothing typed; a
 * reservation needs the Owner's VND-per-USD rate; the month total (ledger + open reservations, shop-time-zone month) plus the new amount
 * must fit the monthly cap and the feature's cap; the actual cost replaces the reservation in the ledger. Fixtures roll back.
 */
test(
  'Claude integration Wave A spending cap: settings, reservation, ledger, month boundary; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const { tx } = base;
      const setSettings = async (assignments: string) =>
        tx.$executeRawUnsafe(
          `UPDATE ai_settings SET ${assignments}, row_version = row_version + 1 WHERE id = 1`,
        );
      const usd = (amount: number) => BigInt(Math.round(amount * 1_000_000));

      await suite.test(
        'the settings start empty: nothing on, no rate, 3,000,000 VND, Opus, "chính hãng" off',
        async () => {
          const settings = await loadAiSettings(tx);
          assert.equal(settings.enabled, false);
          assert.equal(settings.rewriteEnabled, false);
          assert.equal(settings.vndPerUsd, null);
          assert.equal(settings.monthlyCapVnd, 3_000_000n);
          assert.equal(settings.rewriteModel, 'claude-opus-5-5');
          assert.equal(settings.allowAuthenticityClaims, false);
          assert.equal(settings.refusalFallback, true);
          assert.deepEqual(settings.featureCapsVnd, {
            PRODUCT_REWRITE: 2_000_000,
            SEO: 300_000,
            ASSISTANT: 300_000,
            BRIEF: 200_000,
          });
          assert.deepEqual(settings.bannedPhrases, []);
          // Without a typed rate nothing can be converted, so nothing is reserved.
          assert.deepEqual(
            await reserveSpend(tx, {
              feature: 'PRODUCT_REWRITE',
              itemId: null,
              amountMicroUsd: 1n,
              settings,
            }),
            { ok: false, reason: 'NO_RATE' },
          );
        },
      );

      await suite.test(
        'a reservation fits under both caps; a call that would cross either is refused before it is made',
        async () => {
          await setSettings(
            `vnd_per_usd = 26000, monthly_cap_vnd = 2600000, feature_caps_vnd = '{"PRODUCT_REWRITE":1300000}'::jsonb`,
          );
          const settings = await loadAiSettings(tx);
          // Cap: 2,600,000 VND at 26,000 = 100 USD; rewrite cap 50 USD.
          assert.equal(vndToMicroUsd(2_600_000n, 26_000), usd(100));
          const first = await reserveSpend(tx, {
            feature: 'PRODUCT_REWRITE',
            itemId: null,
            amountMicroUsd: usd(30),
            settings,
          });
          assert.equal(first.ok, true);
          const second = await reserveSpend(tx, {
            feature: 'PRODUCT_REWRITE',
            itemId: null,
            amountMicroUsd: usd(15),
            settings,
          });
          assert.equal(second.ok, true);
          // 30 + 15 reserved; 10 more would be 55 > the rewrite cap of 50.
          assert.deepEqual(
            await reserveSpend(tx, {
              feature: 'PRODUCT_REWRITE',
              itemId: null,
              amountMicroUsd: usd(10),
              settings,
            }),
            { ok: false, reason: 'CAP_FEATURE' },
          );
          // Another feature has its own (default = the monthly) cap, but the month total counts everything: 45 + 60 > 100.
          assert.deepEqual(
            await reserveSpend(tx, {
              feature: 'ASSISTANT',
              itemId: null,
              amountMicroUsd: usd(60),
              settings: { ...settings, featureCapsVnd: {} },
            }),
            { ok: false, reason: 'CAP_MONTH' },
          );
          const held = await monthSpend(tx, null);
          assert.equal(held.reservedMicroUsd, usd(45));
          assert.equal(held.spentMicroUsd, 0n);
          if (first.ok) await releaseReservation(tx, first.reservationId);
          if (second.ok) await releaseReservation(tx, second.reservationId);
          assert.equal((await monthSpend(tx, null)).reservedMicroUsd, 0n);
        },
      );

      await suite.test(
        'the actual cost replaces the reservation in the ledger; refused and failed calls are recorded too',
        async () => {
          const settings = await loadAiSettings(tx);
          const hold = await reserveSpend(tx, {
            feature: 'PRODUCT_REWRITE',
            itemId: null,
            amountMicroUsd: usd(1),
            settings,
          });
          assert.equal(hold.ok, true);
          const usage = {
            inputTokens: 1200,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 5000,
          };
          const cost = costMicroUsd('claude-opus-5-5', usage);
          assert.equal(cost, 104_800n);
          await writeLedger(
            tx,
            {
              feature: 'PRODUCT_REWRITE',
              runId: null,
              itemId: null,
              model: 'claude-opus-5-5',
              outcome: 'SUCCEEDED',
              usage,
              costMicroUsd: cost,
              requestId: 'req_1',
            },
            hold.ok ? hold.reservationId : null,
          );
          await writeLedger(
            tx,
            {
              feature: 'PRODUCT_REWRITE',
              runId: null,
              itemId: null,
              model: 'claude-opus-5-5',
              outcome: 'REFUSED',
              usage: { inputTokens: 900, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 5 },
              costMicroUsd: 3_700n,
              requestId: 'req_2',
            },
            null,
          );
          const month = await monthSpend(tx, 'PRODUCT_REWRITE');
          assert.equal(month.reservedMicroUsd, 0n, 'the reservation is gone');
          assert.equal(month.spentMicroUsd, 108_500n);
          assert.equal((await monthSpend(tx, 'ASSISTANT')).spentMicroUsd, 0n, 'per feature');
        },
      );

      await suite.test(
        'the month is the shop month: last month does not count, a reservation that expired does not count',
        async () => {
          await tx.$executeRawUnsafe(
            `INSERT INTO ai_usage_ledger (feature, model, outcome, cost_micro_usd, occurred_at)
           VALUES ('PRODUCT_REWRITE', 'claude-opus-5-5', 'SUCCEEDED', 50000000, now() - interval '40 days')`,
          );
          const before = (await monthSpend(tx, 'PRODUCT_REWRITE')).spentMicroUsd;
          assert.equal(before, 108_500n, 'a 40-day-old row is in another month');
          // The same row counts when "now" is back in its own month.
          const back = await monthSpend(
            tx,
            'PRODUCT_REWRITE',
            new Date(Date.now() - 40 * 86_400_000),
          );
          assert.ok(back.spentMicroUsd >= 50_000_000n);
          // A month boundary in the shop time zone: 2026-10-31 17:30 UTC is already 2026-11-01 in Vietnam.
          await tx.$executeRawUnsafe(
            `INSERT INTO ai_usage_ledger (feature, model, outcome, cost_micro_usd, occurred_at)
           VALUES ('SEO', 'claude-opus-5-5', 'SUCCEEDED', 7000000, '2026-10-31T17:30:00Z')`,
          );
          assert.equal(
            (await monthSpend(tx, 'SEO', new Date('2026-11-15T00:00:00Z'))).spentMicroUsd,
            7_000_000n,
            'November in Vietnam',
          );
          assert.equal(
            (await monthSpend(tx, 'SEO', new Date('2026-10-15T00:00:00Z'))).spentMicroUsd,
            0n,
            'not October',
          );
          // An expired reservation stops counting.
          await tx.$executeRawUnsafe(
            `INSERT INTO ai_reservations (feature, amount_micro_usd, created_at, expires_at)
           VALUES ('ASSISTANT', 9000000, now() - interval '30 minutes', now() - interval '20 minutes')`,
          );
          assert.equal((await monthSpend(tx, 'ASSISTANT')).reservedMicroUsd, 0n);
        },
      );
    });
  },
);
