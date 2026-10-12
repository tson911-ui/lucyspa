import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AI_EFFORT_LEVELS, AI_MODEL_IDS } from '@lucy-spa/contracts';
import { AI_EFFORTS, AI_MODELS } from '@lucy-spa/server';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { AiService } from './ai.service.js';

test('the contract lists the same models and efforts as the server price table', () => {
  assert.deepEqual([...AI_MODEL_IDS], [...AI_MODELS]);
  assert.deepEqual([...AI_EFFORT_LEVELS], [...AI_EFFORTS]);
});

/**
 * Claude integration Wave A (CI-X1) against real PostgreSQL: the AI settings. Authority (MANAGE_AI_SETTINGS, GLOBAL), reading never
 * exposes a key, each change needs the row version, validates exactly, is audited with before and after, and the key check is only a
 * request the worker answers. Fixtures roll back.
 */
test(
  'Claude integration Wave A AI settings: authority, validation, versions, audit, key status; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const { tx, fails } = base;
      const ai = new AiService(base.adapter, base.throttle);
      ai.env = { ANTHROPIC_API_KEY: 'sk-ant-secret-key-that-must-never-appear' };
      const manager = await base.staff([], { globalCodes: ['MANAGE_AI_SETTINGS'] });
      const drafter = await base.staff([], { globalCodes: ['USE_AI_CONTENT'] });

      await suite.test(
        'authority: only MANAGE_AI_SETTINGS (USE_AI_CONTENT alone opens nothing here)',
        async () => {
          await fails(() => ai.getSettings(drafter.token), 'FORBIDDEN');
          await fails(
            () => ai.editSettings(drafter.token, { expectedRowVersion: 1, enabled: true }),
            'FORBIDDEN',
          );
          await fails(
            () => ai.requestKeyCheck(drafter.token, { expectedRowVersion: 1 }),
            'FORBIDDEN',
          );
          await fails(() => ai.getSettings(undefined), 'AUTHENTICATION_REQUIRED');
          const owner = await ai.getSettings(base.ownerToken);
          assert.equal(owner.settings.enabled, false, 'the Owner may read');
        },
      );

      await suite.test(
        'reading: defaults, a key that is configured but never shown, an empty cost card',
        async () => {
          const result = await ai.getSettings(manager.token);
          assert.equal(result.settings.enabled, false);
          assert.equal(result.settings.rewriteEnabled, false);
          assert.equal(result.settings.vndPerUsd, null);
          assert.equal(result.settings.monthlyCapVnd, '3000000');
          assert.deepEqual(result.settings.featureCapsVnd, {
            PRODUCT_REWRITE: '2000000',
            SEO: '300000',
            ASSISTANT: '300000',
            BRIEF: '200000',
          });
          assert.equal(result.settings.rewriteModel, 'claude-opus-5-5');
          assert.equal(result.settings.allowAuthenticityClaims, false);
          assert.equal(result.settings.runAllUnlockedAt, null);
          assert.deepEqual(result.key, {
            configured: true,
            lastCheckAt: null,
            lastCheckStatus: null,
            checkPending: false,
          });
          assert.ok(!JSON.stringify(result).includes('sk-ant'), 'the key never appears');
          assert.equal(result.usage.spentVnd, null, 'no rate typed: no VND figure');
          assert.equal(result.usage.spentMicroUsd, '0');
          assert.equal(result.usage.capVnd, '3000000');
          ai.env = {};
          assert.equal((await ai.getSettings(manager.token)).key.configured, false);
          ai.env = { ANTHROPIC_API_KEY: '   ' };
          assert.equal((await ai.getSettings(manager.token)).key.configured, false);
          ai.env = { ANTHROPIC_API_KEY: 'sk-ant-secret-key-that-must-never-appear' };
        },
      );

      await suite.test(
        'changing: only the keys present, audited with before and after, version advances; a stale version is a conflict',
        async () => {
          const read = await ai.getSettings(manager.token);
          const changed = await ai.editSettings(manager.token, {
            expectedRowVersion: read.settings.rowVersion,
            enabled: true,
            rewriteEnabled: true,
            vndPerUsd: 26000,
            monthlyCapVnd: '4000000',
            featureCapsVnd: { PRODUCT_REWRITE: '2500000' },
            rewriteModel: 'claude-sonnet-5-5',
            rewriteEffort: 'high',
            concurrency: 3,
            refusalFallback: false,
            allowAuthenticityClaims: true,
            bannedPhrases: ['Số 1 thế giới', 'số 1 thế giới', ' Đảm bảo da đẹp '],
          });
          assert.equal(changed.settings.rowVersion, read.settings.rowVersion + 1);
          assert.equal(changed.settings.enabled, true);
          assert.equal(changed.settings.vndPerUsd, 26000);
          assert.equal(changed.settings.monthlyCapVnd, '4000000');
          assert.deepEqual(changed.settings.featureCapsVnd, {
            PRODUCT_REWRITE: '2500000',
            SEO: '300000',
            ASSISTANT: '300000',
            BRIEF: '200000',
          });
          assert.equal(changed.settings.rewriteModel, 'claude-sonnet-5-5');
          assert.equal(changed.settings.allowAuthenticityClaims, true);
          assert.deepEqual(
            changed.settings.bannedPhrases,
            ['Số 1 thế giới', 'Đảm bảo da đẹp'],
            'trimmed and de-duplicated',
          );
          assert.equal(changed.usage.spentVnd, '0', 'with a rate the card shows VND');
          const events = await tx.auditEvent.findMany({
            where: { action: 'AI_SETTINGS_CHANGED' },
            select: { before: true, after: true, actorUserId: true },
          });
          assert.equal(events.length, 1);
          assert.equal((events[0]!.before as { monthlyCapVnd: string }).monthlyCapVnd, '3000000');
          assert.equal((events[0]!.after as { monthlyCapVnd: string }).monthlyCapVnd, '4000000');
          assert.equal(events[0]!.actorUserId, manager.id);
          // The same request again changes nothing and writes no audit row.
          const noop = await ai.editSettings(manager.token, {
            expectedRowVersion: changed.settings.rowVersion,
            enabled: true,
          });
          assert.equal(noop.settings.rowVersion, changed.settings.rowVersion);
          assert.equal(await tx.auditEvent.count({ where: { action: 'AI_SETTINGS_CHANGED' } }), 1);
          await fails(
            () =>
              ai.editSettings(manager.token, {
                expectedRowVersion: read.settings.rowVersion,
                enabled: false,
              }),
            'CONFLICT',
          );
        },
      );

      await suite.test('validation: exact rules, nothing written when refused', async () => {
        const { settings } = await ai.getSettings(manager.token);
        const v = settings.rowVersion;
        const bad = (patch: Record<string, unknown>, field: string) =>
          fails(
            () => ai.editSettings(manager.token, { expectedRowVersion: v, ...patch } as never),
            'VALIDATION_FAILED',
            field,
          );
        await bad({ monthlyCapVnd: '-1' }, 'monthlyCapVnd');
        await bad({ monthlyCapVnd: '1.5' }, 'monthlyCapVnd');
        await bad({ monthlyCapVnd: '9999999999999999' }, 'monthlyCapVnd');
        await bad({ monthlyCapVnd: 3000000 }, 'monthlyCapVnd');
        await bad({ featureCapsVnd: { EVERYTHING: '1' } }, 'featureCapsVnd');
        await bad({ featureCapsVnd: { SEO: 'x' } }, 'featureCapsVnd.SEO');
        await bad({ featureCapsVnd: [] }, 'featureCapsVnd');
        await bad({ vndPerUsd: 5 }, 'vndPerUsd');
        await bad({ vndPerUsd: 25000.5 }, 'vndPerUsd');
        await bad({ rewriteModel: 'gpt-4' }, 'rewriteModel');
        await bad({ rewriteEffort: 'extreme' }, 'rewriteEffort');
        await bad({ concurrency: 9 }, 'concurrency');
        await bad({ concurrency: 0 }, 'concurrency');
        await bad({ enabled: 'yes' }, 'enabled');
        await bad({ bannedPhrases: ['a'] }, 'bannedPhrases');
        await bad({ bannedPhrases: [3] }, 'bannedPhrases');
        await bad({ bannedPhrases: 'x' }, 'bannedPhrases');
        await fails(
          () => ai.editSettings(manager.token, { expectedRowVersion: 0 } as never),
          'VALIDATION_FAILED',
          'expectedRowVersion',
        );
        assert.equal(
          (await ai.getSettings(manager.token)).settings.rowVersion,
          v,
          'nothing was written',
        );
        // The rate can be cleared again (back to "not typed").
        const cleared = await ai.editSettings(manager.token, {
          expectedRowVersion: v,
          vndPerUsd: null,
        });
        assert.equal(cleared.settings.vndPerUsd, null);
      });

      await suite.test(
        'the key check is a request the worker answers; a pending check shows until it does',
        async () => {
          const { settings } = await ai.getSettings(manager.token);
          const asked = await ai.requestKeyCheck(manager.token, {
            expectedRowVersion: settings.rowVersion,
          });
          assert.equal(asked.key.checkPending, true);
          assert.equal(asked.settings.rowVersion, settings.rowVersion + 1);
          assert.equal(
            await tx.auditEvent.count({ where: { action: 'AI_KEY_CHECK_REQUESTED' } }),
            1,
          );
          // The worker's answer (what processKeyCheck writes).
          await tx.$executeRawUnsafe(
            `UPDATE ai_settings SET last_check_at = clock_timestamp() + interval '1 second', last_check_status = 'AUTH_FAILED', row_version = row_version + 1`,
          );
          const answered = await ai.getSettings(manager.token);
          assert.equal(answered.key.checkPending, false);
          assert.equal(answered.key.lastCheckStatus, 'AUTH_FAILED');
          await fails(
            () => ai.requestKeyCheck(manager.token, { expectedRowVersion: settings.rowVersion }),
            'CONFLICT',
          );
        },
      );
    });
  },
);
