import type { DatabaseClient } from '@lucy-spa/database';
import {
  ClaudeClient,
  processKeyCheck,
  runAiRetention,
  runRewriteTick,
  runSeoTick,
  type RewriteEngineState,
  type SeoEngineState,
  type createLogger,
} from '@lucy-spa/server';

type Logger = ReturnType<typeof createLogger>;

const TICK_MS = 3000;
/** What the AI features keep is cleaned up about once an hour (see runAiRetention). */
const RETENTION_EVERY_MS = 60 * 60 * 1000;

/**
 * Claude integration Wave A: the worker's AI job family. It is the only process (with the API for the interactive features of later
 * waves) that holds `ANTHROPIC_API_KEY`; a missing key is not an error: the family runs, answers a pending key check with KEY_MISSING and
 * does nothing else. Nothing here is on the path of booking, POS, payments, reports or the public site: when Anthropic or the key is down
 * only the AI page notices. One tick answers the key check, then works on the queued rewrite items (draft engine).
 */
export function startAiJobs(database: DatabaseClient, env: NodeJS.ProcessEnv, logger: Logger) {
  const client = new ClaudeClient({ apiKey: env['ANTHROPIC_API_KEY']?.trim() || undefined });
  if (!client.hasKey) logger.info('ANTHROPIC_API_KEY is not set: the AI features stay off');
  const failure = (error: unknown) =>
    logger.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'AI job failed',
    );
  const rewriteState: RewriteEngineState = { consecutiveFailures: 0 };
  const seoState: SeoEngineState = { consecutiveFailures: 0 };
  let stopped = false;
  let lastRetention = 0;
  let running: Promise<void> | undefined;
  let timer: NodeJS.Timeout;
  const tick = () => {
    running = (async () => {
      try {
        const checked = await processKeyCheck(database, client);
        if (checked !== null) logger.info({ status: checked }, 'AI key check answered');
        const rewrite = await runRewriteTick(database, client, rewriteState, { onError: failure });
        if (rewrite.leased > 0)
          logger.info({ items: rewrite.leased }, 'AI rewrite items processed');
        const seo = await runSeoTick(database, client, seoState, { onError: failure });
        if (seo.leased > 0)
          logger.info({ items: seo.leased }, 'AI search-description drafts processed');
        if (Date.now() - lastRetention >= RETENTION_EVERY_MS) {
          lastRetention = Date.now();
          const kept = await runAiRetention(database);
          if (kept.callbackRequestsCleared > 0) {
            logger.info({ cleared: kept.callbackRequestsCleared }, 'Old callback requests cleared');
          }
          if (kept.assistantTextsCleared > 0) {
            logger.info({ cleared: kept.assistantTextsCleared }, 'Old assistant questions cleared');
          }
        }
      } catch (error) {
        failure(error);
      }
    })().finally(() => {
      if (!stopped) timer = setTimeout(tick, TICK_MS);
    });
  };
  timer = setTimeout(tick, 0);
  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
