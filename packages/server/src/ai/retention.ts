import type { DatabaseClient } from '@lucy-spa/database';

/**
 * Claude integration Waves B to D: what the AI features keep, and for how long (design 6.3 and 9.2; Owner answers OQ-CI-6, OQ-CI-9,
 * OQ-CI-10). One pass, run by the worker about once an hour; every step is idempotent and touches only rows past their age:
 * - a callback request keeps its phone, name and note for 90 days after it was closed, then they are cleared (the request stays as a
 *   count: status, reason, dates);
 * - an assistant question keeps its text for 30 days, then the text is cleared (the cost, tools and who asked stay in the audit trail);
 * - a customer brief is kept until 7 days after the booking's service, then deleted.
 */
export const RETENTION_DAYS = Object.freeze({
  callbackAfterClose: 90,
  assistantQuestion: 30,
  customerBrief: 7,
});

export interface RetentionResult {
  callbackRequestsCleared: number;
  assistantTextsCleared: number;
}

export async function runAiRetention(
  database: Pick<DatabaseClient, '$executeRaw'>,
): Promise<RetentionResult> {
  const cleared = await database.$executeRaw`
    UPDATE chat_callback_requests
       SET phone = NULL, name = NULL, note = NULL, purged_at = clock_timestamp(), row_version = row_version + 1
     WHERE status = 'CLOSED' AND purged_at IS NULL
       AND closed_at < clock_timestamp() - make_interval(days => ${RETENTION_DAYS.callbackAfterClose})`;
  const questions = await database.$executeRaw`
    UPDATE ai_assistant_questions
       SET question = NULL, answer = NULL, purged_at = clock_timestamp()
     WHERE purged_at IS NULL
       AND created_at < clock_timestamp() - make_interval(days => ${RETENTION_DAYS.assistantQuestion})`;
  return { callbackRequestsCleared: Number(cleared), assistantTextsCleared: Number(questions) };
}
