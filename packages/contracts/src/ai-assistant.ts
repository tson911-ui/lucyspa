/**
 * Claude integration Wave C (CI-S1, design section 7.1; Owner answer OQ-CI-9): the report assistant. A question box for the holders of
 * `USE_AI_ASSISTANT`; the model reads the reports only through a fixed catalogue of read-only tools, each limited to what the asking
 * person may open and to the branches they cover. Version 1 answers with totals and labels only: no individual pay, no customer name or
 * phone, no free text.
 */

export const ASSISTANT_LIMITS = {
  /** The longest question, in characters. */
  questionMax: 300,
  /** Questions one person may ask in an hour and in a day (the shop's money cap still applies on top). */
  perHour: 30,
  perDay: 100,
  /** The most tool calls and the longest time one question may take. */
  toolCalls: 6,
  timeoutMs: 30_000,
} as const;

/** Why the box cannot be used right now; the screen says each in plain words. */
export type AssistantBlock = 'AI_OFF' | 'ASSISTANT_OFF' | 'NO_RATE' | 'NO_KEY';

/** GET /api/v1/ai/assistant */
export interface AssistantStatus {
  /** Questions can be asked now. */
  available: boolean;
  block: AssistantBlock | null;
  /** Questions this person may still ask this hour. */
  leftThisHour: number;
}

/** POST /api/v1/ai/assistant/ask */
export interface AssistantAskRequest {
  question: string;
}

export type AssistantAnswerStatus = 'ANSWERED' | 'UNSURE';

export interface AssistantAnswer {
  status: AssistantAnswerStatus;
  /** Plain Vietnamese text. For `UNSURE` it is the fixed "em chưa chắc chắn" sentence. */
  answer: string;
  /** The reports the answer used (ids from the report catalogue), so the screen can link to them. */
  reports: string[];
  /** The exact period each tool call used, shown so nobody has to guess which dates "tuần này" meant. */
  periods: { from: string; to: string }[];
}
